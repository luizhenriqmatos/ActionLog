/**
 * Fila de escrita do Jogo ao vivo — parte pura, sem Supabase, para poder ser testada.
 *
 * Três garantias (Fase 1 da v2):
 *  1. Armazenamento cheio nunca perde registro em silêncio: o novo registro é recusado na hora,
 *     com erro visível, e o que já estava na fila continua gravado.
 *  2. Item recusado pelo servidor por regra não é descartado: vai para a lista de recusados,
 *     com o motivo, e fica no aparelho até alguém reenviar ou descartar de propósito.
 *  3. Falha passageira (rede, sessão expirada, servidor fora) não vira recusa: a fila espera.
 */

export type QueueItem =
  | { op: 'event'; row: Record<string, unknown> }
  | { op: 'undo'; id: string; deletedAt: string }
  | { op: 'match'; id: string; patch: Record<string, unknown> }
  | { op: 'players'; rows: Array<Record<string, unknown>> }
  | { op: 'players_delete'; matchId: string; athleteIds: string[] }

export type RejectedItem = { item: QueueItem; reason: string; at: string }

/** Resposta do envio: `null` = aceito. `status` 0 = sem resposta do servidor. */
export type SendFailure = { status: number; message: string }
export type Sender = (batch: QueueItem[]) => Promise<SendFailure | null>

export type QueueStorage = { getItem(key: string): string | null; setItem(key: string, value: string): void }

export class QueueFullError extends Error {
  constructor() {
    super('O armazenamento deste aparelho está cheio. O registro não foi salvo.')
    this.name = 'QueueFullError'
  }
}

const NETWORK = /fetch|network|failed to|load failed|timeout|offline/i

/**
 * Decide se a falha é passageira (tentar de novo depois) ou recusa de regra (não adianta repetir).
 * Passageira: sem resposta, sessão expirada (401), tempo esgotado (408), excesso de pedidos (429), erro do servidor (5xx).
 */
export function classifyFailure(failure: SendFailure): 'transient' | 'rejected' {
  const { status, message } = failure
  if (!status || status === 401 || status === 408 || status === 429 || status >= 500) return 'transient'
  if (NETWORK.test(message) || /jwt/i.test(message)) return 'transient'
  return 'rejected'
}

export type FlushResult = { sent: number; rejected: number; failed: string }

const BATCH = 200

export function createQueue(storage: QueueStorage, keys: { queue: string; rejected: string }) {
  /** Cópia em memória, usada só se o armazenamento falhar ao encolher a fila (não deixa reenviar em laço). */
  let memory: QueueItem[] | null = null
  let full = false

  function read(): QueueItem[] {
    if (memory) return memory
    try { return JSON.parse(storage.getItem(keys.queue) || '[]') as QueueItem[] } catch { return [] }
  }

  function write(items: QueueItem[]): boolean {
    try {
      storage.setItem(keys.queue, JSON.stringify(items))
      memory = null
      full = false
      return true
    } catch {
      return false
    }
  }

  function readRejected(): RejectedItem[] {
    try { return JSON.parse(storage.getItem(keys.rejected) || '[]') as RejectedItem[] } catch { return [] }
  }

  function writeRejected(items: RejectedItem[]): boolean {
    try { storage.setItem(keys.rejected, JSON.stringify(items)); return true } catch { return false }
  }

  /** Coloca na fila. Lança QueueFullError se não couber: nada é guardado só em memória. */
  function enqueue(item: QueueItem) {
    const next = [...read(), item]
    if (memory) {
      // a fila já está só em memória: não aceitar mais nada até o armazenamento voltar
      if (!write(memory)) { full = true; throw new QueueFullError() }
    }
    if (!write(next)) { full = true; throw new QueueFullError() }
  }

  /** Testa se o armazenamento voltou a aceitar escrita (ex.: depois de a fila esvaziar). */
  function probe(): boolean {
    if (!full && !memory) return true
    return write(read())
  }

  async function flush(send: Sender): Promise<FlushResult> {
    let sent = 0
    let rejected = 0
    let failed = ''
    let single = false
    for (;;) {
      const queue = read()
      const item = queue[0]
      if (!item) break
      // eventos seguidos vão juntos num envio só
      let size = 1
      if (item.op === 'event' && !single) while (size < queue.length && size < BATCH && queue[size].op === 'event') size += 1
      let failure: SendFailure | null
      try {
        failure = await send(queue.slice(0, size))
      } catch (e) {
        failure = { status: 0, message: e instanceof Error ? e.message : String(e) }
      }
      if (failure && classifyFailure(failure) === 'transient') { failed = failure.status ? failure.message : 'offline'; break }
      if (failure && size > 1) { single = true; continue } // um item com problema: reenviar um a um para não perder os outros
      if (failure) {
        // recusa de regra: guarda com o motivo ANTES de tirar da fila; se não couber, a fila para aqui
        const entry: RejectedItem = { item, reason: failure.message, at: new Date().toISOString() }
        const key = JSON.stringify(item)
        const list = readRejected().filter((r) => JSON.stringify(r.item) !== key)
        if (!writeRejected([...list, entry])) { failed = 'Armazenamento cheio: não foi possível guardar um registro recusado.'; break }
        rejected += 1
        failed = failure.message
      } else {
        sent += size
      }
      // só esta função remove itens, e ela roda uma por vez: os primeiros `size` são os tratados
      const rest = read().slice(size)
      if (!write(rest)) memory = rest
    }
    return { sent, rejected, failed }
  }

  /** Devolve um recusado para a fila (para tentar de novo). */
  function retryRejected(index: number): boolean {
    const list = readRejected()
    const entry = list[index]
    if (!entry) return false
    try { enqueue(entry.item) } catch { return false }
    writeRejected(list.filter((_, i) => i !== index))
    return true
  }

  /** Descarte explícito, decidido por uma pessoa. */
  function discardRejected(index: number) {
    writeRejected(readRejected().filter((_, i) => i !== index))
  }

  return { read, enqueue, flush, probe, isFull: () => full || memory !== null, rejected: readRejected, retryRejected, discardRejected }
}

export type MatchQueue = ReturnType<typeof createQueue>
