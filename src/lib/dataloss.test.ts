/**
 * Fase 1 da v2 — parar a perda de dado.
 * Compromissos por id, pull paginado com detecção de truncamento, fila que não perde nem descarta em silêncio, relógio remedido.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { eventsByDate, singleEventByDate, upsertEvent } from './calendar.ts'
import { fetchAll, TruncatedError } from './paging.ts'
import { classifyFailure, createQueue, QueueFullError, type QueueItem, type SendFailure } from './matchQueue.ts'
import { applySample, MAX_RTT_MS, OFFSET_JUMP_MS } from './clock.ts'
import { eventRow, localRows, mergeRemote } from './sync.ts'
import type { AppData, CalendarEvent, CategoryData } from '../types/index.ts'

const TEAM = 'team-1'
const event = (id: string, date: string, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({ id, type: 'Jogo', title: `Jogo ${id}`, date, opponent: 'Adversário', location: '', mdTag: 'MD', updatedAt: '2026-11-10T10:00:00.000Z', ...extra })
const emptyCategory = (): CategoryData => ({ athletes: [], events: [], stats: {}, sessions: [], evaluations: [] })
const appData = (events: CalendarEvent[]): AppData => ({ teamName: 'Clube', tombstones: [], categories: { 'Sub-15': { ...emptyCategory(), events }, 'Sub-16': emptyCategory(), 'Sub-17': emptyCategory(), 'Sub-20': emptyCategory() } })
const remote = (events: CalendarEvent[]) => ({ athletes: [], sessions: [], evaluations: [], teamName: null, events: events.map((e) => eventRow(TEAM, 'Sub-15', e)) })

/* ---------- 1.1 compromissos ---------- */

test('dois compromissos da mesma categoria na mesma data: os dois persistem', () => {
  let events = upsertEvent([], event('a', '2026-11-20'))
  events = upsertEvent(events, event('b', '2026-11-20'))
  assert.deepEqual(events.map((e) => e.id), ['a', 'b'])
  assert.equal(eventsByDate(events).get('2026-11-20')?.length, 2)
})

test('editar um compromisso não toca no outro do mesmo dia', () => {
  const start = [event('a', '2026-11-20'), event('b', '2026-11-20')]
  const next = upsertEvent(start, event('a', '2026-11-20', { title: 'Editado' }))
  assert.equal(next.length, 2)
  assert.equal(next.find((e) => e.id === 'a')?.title, 'Editado')
  assert.deepEqual(next.find((e) => e.id === 'b'), start[1])
})

test('mudar a data de um compromisso leva só ele', () => {
  const next = upsertEvent([event('a', '2026-11-20'), event('b', '2026-11-20')], event('a', '2026-11-21'))
  assert.deepEqual(next.map((e) => [e.id, e.date]), [['b', '2026-11-20'], ['a', '2026-11-21']])
})

test('os dois compromissos do dia sobrevivem a um ciclo de sincronização', () => {
  const local = appData(upsertEvent([event('a', '2026-11-20')], event('b', '2026-11-20')))
  // sobe: as duas linhas vão para o servidor
  const pushed = localRows(TEAM, local).filter((r) => r.table === 'calendar_events').map((r) => r.row)
  assert.equal(pushed.length, 2)
  // desce: o servidor devolve as duas e a mescla mantém as duas
  const { data } = mergeRemote(local, { athletes: [], sessions: [], evaluations: [], teamName: null, events: pushed }, TEAM)
  assert.deepEqual(data.categories['Sub-15'].events.map((e) => e.id).sort(), ['a', 'b'])
})

test('compromisso criado no aparelho A não é apagado pelo que vem do aparelho B', () => {
  // A criou "a"; B criou "b" na mesma data e já enviou ao servidor
  const onA = appData([event('a', '2026-11-20')])
  const merged = mergeRemote(onA, remote([event('b', '2026-11-20')]), TEAM).data
  assert.deepEqual(merged.categories['Sub-15'].events.map((e) => e.id).sort(), ['a', 'b'])
  // A edita o seu depois da mescla: o de B continua lá (antes, o salvamento por data substituía os dois)
  const afterEdit = upsertEvent(merged.categories['Sub-15'].events, event('a', '2026-11-20', { title: 'Editado em A' }))
  assert.deepEqual(afterEdit.map((e) => e.id).sort(), ['a', 'b'])
  assert.equal(afterEdit.find((e) => e.id === 'b')?.title, 'Jogo b')
})

test('sessão antiga sem vínculo só é ligada pela data quando o dia tem um único compromisso', () => {
  const map = singleEventByDate([event('a', '2026-11-20'), event('b', '2026-11-20'), event('c', '2026-11-21')])
  assert.equal(map.get('2026-11-20'), undefined)
  assert.equal(map.get('2026-11-21')?.id, 'c')
})

/* ---------- 1.2 pull paginado ---------- */

/** Servidor de mentira com teto de linhas por resposta, como o PostgREST. */
const server = (rows: number, cap: number, reportCount = true) => {
  const all = Array.from({ length: rows }, (_, i) => i)
  let calls = 0
  return {
    calls: () => calls,
    page: async (from: number, to: number) => { calls += 1; return { rows: all.slice(from, Math.min(to + 1, from + cap)), total: reportCount ? rows : null } },
  }
}

test('volume acima do teto: nenhuma linha perdida', async () => {
  const s = server(2345, 1000)
  const got = await fetchAll('athletes', s.page, 500)
  assert.equal(got.length, 2345)
  assert.deepEqual(got, Array.from({ length: 2345 }, (_, i) => i))
})

test('teto do servidor menor que a página pedida: continua de onde parou, sem perder', async () => {
  const s = server(1200, 300)
  assert.equal((await fetchAll('athletes', s.page, 500)).length, 1200)
})

test('tabela vazia e tabela pequena: uma leitura só', async () => {
  const empty = server(0, 1000)
  assert.equal((await fetchAll('athletes', empty.page)).length, 0)
  const small = server(60, 1000)
  assert.equal((await fetchAll('athletes', small.page)).length, 60)
  assert.equal(small.calls(), 1)
})

test('truncamento vira erro, não silêncio', async () => {
  // o servidor diz que há 1500, mas para de entregar em 1000
  const page = async (from: number) => ({ rows: from < 1000 ? Array.from({ length: Math.min(500, 1000 - from) }, (_, i) => from + i) : [], total: 1500 })
  await assert.rejects(fetchAll('scout_sessions', page, 500), (e: unknown) => e instanceof TruncatedError && /vieram 1000 de 1500/.test((e as Error).message))
})

/* ---------- 1.3 e 1.5 fila ---------- */

/** localStorage de mentira com cota em caracteres. */
const storage = (quota = Infinity) => {
  const map = new Map<string, string>()
  return {
    map,
    setQuota: (q: number) => { quota = q },
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      const used = [...map].filter(([k]) => k !== key).reduce((n, [, v]) => n + v.length, 0)
      if (used + value.length > quota) throw new Error('QuotaExceededError')
      map.set(key, value)
    },
  }
}
const KEYS = { queue: 'q', rejected: 'r' }
const ev = (id: string): QueueItem => ({ op: 'event', row: { id, match_id: 'm1', kind: 'pass_ok' } })
const accept = async () => null

test('fila com cota estourada: o registro é recusado com erro e nenhum pendente se perde', () => {
  const store = storage()
  const queue = createQueue(store, KEYS)
  queue.enqueue(ev('1'))
  queue.enqueue(ev('2'))
  store.setQuota(store.map.get('q')!.length + 10) // não cabe mais um evento
  assert.throws(() => queue.enqueue(ev('3')), QueueFullError)
  assert.equal(queue.isFull(), true)
  // os dois pendentes continuam gravados no aparelho (sobrevivem a recarregar a página)
  assert.deepEqual(createQueue(store, KEYS).read().map((q) => (q as { row: { id: string } }).row.id), ['1', '2'])
})

test('depois que a fila esvazia, o armazenamento volta a aceitar registros', async () => {
  const store = storage()
  const queue = createQueue(store, KEYS)
  queue.enqueue(ev('1'))
  store.setQuota(store.map.get('q')!.length + 10)
  assert.throws(() => queue.enqueue(ev('2')), QueueFullError)
  assert.deepEqual(await queue.flush(accept), { sent: 1, rejected: 0, failed: '' })
  assert.equal(queue.probe(), true)
  assert.equal(queue.isFull(), false)
  queue.enqueue(ev('2'))
  assert.equal(queue.read().length, 1)
})

test('recusa de regra: o item não é descartado, fica visível com o motivo', async () => {
  const store = storage()
  const queue = createQueue(store, KEYS)
  queue.enqueue(ev('ok-1'))
  queue.enqueue(ev('ruim'))
  queue.enqueue(ev('ok-2'))
  const sent: string[] = []
  const send = async (batch: QueueItem[]): Promise<SendFailure | null> => {
    const ids = batch.map((q) => String((q as { row: { id: string } }).row.id))
    if (ids.includes('ruim')) return { status: 403, message: 'new row violates row-level security policy' }
    sent.push(...ids)
    return null
  }
  const result = await queue.flush(send)
  assert.equal(result.sent, 2)
  assert.equal(result.rejected, 1)
  assert.deepEqual(sent, ['ok-1', 'ok-2']) // os vizinhos do lote não se perdem
  assert.equal(queue.read().length, 0)
  const rejected = createQueue(store, KEYS).rejected() // sobrevive a recarregar a página
  assert.equal(rejected.length, 1)
  assert.equal((rejected[0].item as { row: { id: string } }).row.id, 'ruim')
  assert.match(rejected[0].reason, /row-level security/)
})

test('recusado pode ser reenviado ou descartado por decisão de uma pessoa', async () => {
  const queue = createQueue(storage(), KEYS)
  queue.enqueue(ev('a'))
  queue.enqueue(ev('b'))
  await queue.flush(async () => ({ status: 400, message: 'check constraint' }))
  assert.equal(queue.rejected().length, 2)
  assert.equal(queue.retryRejected(0), true)
  assert.equal(queue.read().length, 1)
  assert.equal(queue.rejected().length, 1)
  queue.discardRejected(0)
  assert.equal(queue.rejected().length, 0)
})

test('falha passageira não vira recusa: a fila espera', async () => {
  for (const failure of [{ status: 0, message: 'TypeError: Failed to fetch' }, { status: 401, message: 'JWT expired' }, { status: 503, message: 'upstream' }, { status: 429, message: 'too many' }]) {
    const queue = createQueue(storage(), KEYS)
    queue.enqueue(ev('1'))
    const result = await queue.flush(async () => failure)
    assert.equal(result.sent, 0)
    assert.equal(queue.read().length, 1, failure.message)
    assert.equal(queue.rejected().length, 0, failure.message)
  }
  assert.equal(classifyFailure({ status: 403, message: 'policy' }), 'rejected')
  assert.equal(classifyFailure({ status: 400, message: 'violates check constraint' }), 'rejected')
})

test('sem espaço para guardar o recusado: o item fica na fila, nunca some', async () => {
  const store = storage()
  const queue = createQueue(store, KEYS)
  queue.enqueue(ev('1'))
  store.setQuota(store.map.get('q')!.length + 5)
  const result = await queue.flush(async () => ({ status: 403, message: 'policy' }))
  assert.equal(result.rejected, 0)
  assert.equal(queue.read().length, 1)
})

test('reenviar não duplica: 50 eventos offline chegam como 50, em ordem', async () => {
  const queue = createQueue(storage(), KEYS)
  for (let i = 0; i < 50; i += 1) queue.enqueue(ev(String(i).padStart(2, '0')))
  const received: string[] = []
  let first = true
  const send = async (batch: QueueItem[]): Promise<SendFailure | null> => {
    if (first) { first = false; return { status: 0, message: 'Failed to fetch' } } // cai a rede no primeiro envio
    received.push(...batch.map((q) => String((q as { row: { id: string } }).row.id)))
    return null
  }
  assert.equal((await queue.flush(send)).failed, 'offline')
  assert.equal((await queue.flush(send)).sent, 50)
  assert.deepEqual(received, Array.from({ length: 50 }, (_, i) => String(i).padStart(2, '0')))
})

/* ---------- 1.4 relógio ---------- */

test('desvio do relógio é reaprendido; salto grande é sinalizado; medição lenta é ignorada', () => {
  assert.deepEqual(applySample(null, { offset: 1200, rtt: 80, at: 0 }), { offset: 1200, accepted: true, jumped: false })
  assert.deepEqual(applySample(1200, { offset: 1500, rtt: 80, at: 0 }), { offset: 1500, accepted: true, jumped: false })
  assert.deepEqual(applySample(1200, { offset: 1200 + OFFSET_JUMP_MS + 1, rtt: 80, at: 0 }), { offset: 3201, accepted: true, jumped: true })
  assert.deepEqual(applySample(1200, { offset: 9000, rtt: MAX_RTT_MS + 1, at: 0 }), { offset: 1200, accepted: false, jumped: false })
})

/* ---------- v2: decisões D-K e data de nascimento ---------- */

test('D-K: membro restrito não guarda no aparelho as categorias que não vê; sem restrição nada muda', async () => {
  const { restrictToCategories, canSeeCategory } = await import('./sync.ts')
  const data = appData([event('a', '2026-11-20')])
  data.categories['Sub-16'] = { ...emptyCategory(), events: [event('b', '2026-11-21')] }
  assert.equal(restrictToCategories(data, null), data)
  const only16 = restrictToCategories(data, ['Sub-16'])
  assert.equal(only16.categories['Sub-15'].events.length, 0)
  assert.equal(only16.categories['Sub-16'].events.length, 1)
  // o envio nunca trata ausência como exclusão: o que saiu do aparelho não vira linha apagada
  assert.equal(only16.tombstones.length, 0)
  assert.equal(canSeeCategory(['Sub-16'], 'Sub-15'), false)
  assert.equal(canSeeCategory(null, 'Sub-15'), true)
})

test('data de nascimento: idade calculada, aniversário respeitado, data futura recusada', async () => {
  const { ageFromBirthDate, athleteAge, formatBirthDate } = await import('./athlete.ts')
  const day = new Date(2026, 10, 16) // 16/11/2026
  assert.equal(ageFromBirthDate('2010-11-16', day), 16)
  assert.equal(ageFromBirthDate('2010-11-17', day), 15)
  assert.equal(ageFromBirthDate('2027-01-01', day), null)
  assert.equal(athleteAge({ age: '14', birthDate: '2010-03-15' }, day), '16')
  assert.equal(athleteAge({ age: '14' }, day), '14')
  assert.equal(formatBirthDate('2010-03-15'), '15/03/2010')
})

test('data de nascimento sobe e desce na sincronização sem perder', async () => {
  const { athleteRow, rowAthlete } = await import('./sync.ts')
  const row = athleteRow(TEAM, 'Sub-16', { id: 'x', name: 'X', number: '', positions: '', age: '16', birthDate: '2010-03-15', height: '', weight: '', dominantFoot: 'Direita' })
  assert.equal(row.birth_date, '2010-03-15')
  assert.equal(rowAthlete(row).birthDate, '2010-03-15')
  assert.equal(athleteRow(TEAM, 'Sub-16', { id: 'y', name: 'Y', number: '', positions: '', age: '', height: '', weight: '', dominantFoot: 'Direita' }).birth_date, null)
})

test('D-L: atleta de setor com dono só é registrado pelo dono; setor sem dono é livre', async () => {
  const { sectorOwnerFor } = await import('./match.ts')
  const owners = [{ sessionId: 's1', userId: 'ana', userName: 'Ana', scope: 'DEF' as const }, { sessionId: 's2', userId: 'bia', userName: 'Bia', scope: 'ALL' as const }]
  assert.equal(sectorOwnerFor(owners, 'DEF', 'bia')?.userName, 'Ana')
  assert.equal(sectorOwnerFor(owners, 'DEF', 'ana'), null)
  assert.equal(sectorOwnerFor(owners, 'ATA', 'bia'), null)
})
