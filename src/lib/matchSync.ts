/**
 * Jogo ao vivo — conversa com o Supabase.
 * Escrita: cada toque vai para uma fila no localStorage e é enviado na hora; sem rede, fica na fila
 * e é reenviado quando a rede volta (o id do evento é gerado no aparelho, então reenviar não duplica).
 * Leitura: a tela busca jogo + relação + eventos a cada 5 s.
 */
import { supabase } from './supabase'
import type { CalendarEvent, CategoryId, Foot } from '../types'
import type { ClockState, EventKind, LineupPlayer, MatchEvent, Period, Phase, Sector, SectorOwner } from './match'
import type { OffsetSample } from './clock'
import { createQueue, type QueueItem, type RejectedItem, type SendFailure } from './matchQueue'
import { fetchAll } from './paging'

export type MatchRow = ClockState & {
  id: string
  teamId: string
  category: CategoryId
  calendarEventId: string
  opponent: string
  matchDate: string
  status: 'preparing' | 'live' | 'finished'
  opponentGoals: number
  commanderUserId: string | null
  commanderName: string
  sessionsGeneratedAt: string | null
  updatedAt: string
}

export type MatchPlayer = LineupPlayer & { positions: string; dominantFoot: Foot }

export type MatchPatch = Partial<Pick<MatchRow, 'status' | 'phase' | 'period' | 'clockRunning' | 'clockStartedAt' | 'clockBaseSeconds' | 'opponentGoals' | 'commanderUserId' | 'commanderName' | 'sessionsGeneratedAt'>>

const QUEUE_KEY = 'actionlog_match_queue_v1'
const REJECTED_KEY = 'actionlog_match_rejected_v1'

const toMatch = (r: Record<string, unknown>): MatchRow => ({
  id: String(r.id), teamId: String(r.team_id), category: r.category as CategoryId, calendarEventId: String(r.calendar_event_id),
  opponent: String(r.opponent ?? ''), matchDate: String(r.match_date), status: r.status as MatchRow['status'], phase: r.phase as Phase,
  period: ([1, 2, 3, 4].includes(Number(r.period)) ? Number(r.period) : 1) as Period, clockRunning: Boolean(r.clock_running), clockStartedAt: (r.clock_started_at as string | null) ?? null,
  clockBaseSeconds: Number(r.clock_base_seconds ?? 0), opponentGoals: Number(r.opponent_goals ?? 0),
  commanderUserId: (r.commander_user_id as string | null) ?? null, commanderName: String(r.commander_name ?? ''),
  sessionsGeneratedAt: (r.sessions_generated_at as string | null) ?? null, updatedAt: String(r.updated_at),
})

const toPlayer = (r: Record<string, unknown>): MatchPlayer => ({
  athleteId: String(r.athlete_id), athleteName: String(r.athlete_name ?? ''), number: String(r.number ?? ''), positions: String(r.positions ?? ''),
  dominantFoot: (r.dominant_foot as Foot) ?? 'Direita', sector: r.sector as Sector, starter: Boolean(r.starter), onField: Boolean(r.on_field),
  slot: (r.slot as string | null) ?? null,
})

const toEvent = (r: Record<string, unknown>): MatchEvent => ({
  id: String(r.id), kind: r.kind as EventKind, athleteId: (r.athlete_id as string | null) ?? null, period: ([1, 2, 3, 4].includes(Number(r.period)) ? Number(r.period) : 1) as Period,
  clockSeconds: Number(r.clock_seconds ?? 0), createdBy: String(r.created_by), createdByName: String(r.created_by_name ?? ''),
  createdAt: String(r.created_at), deletedAt: (r.deleted_at as string | null) ?? null,
})

const patchRow = (patch: MatchPatch) => {
  const map: Record<string, string> = {
    status: 'status', phase: 'phase', period: 'period', clockRunning: 'clock_running', clockStartedAt: 'clock_started_at',
    clockBaseSeconds: 'clock_base_seconds', opponentGoals: 'opponent_goals', commanderUserId: 'commander_user_id',
    commanderName: 'commander_name', sessionsGeneratedAt: 'sessions_generated_at',
  }
  const row: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patch)) if (key in map) row[map[key]] = value
  return row
}

/* ---------- relógio do servidor ---------- */

/**
 * Mede a diferença (ms) entre o relógio do servidor e o deste aparelho, com correção de ida-e-volta.
 * Devolve null se a medição falhar: quem chama mantém o desvio anterior em vez de zerar.
 */
export async function measureOffset(): Promise<OffsetSample | null> {
  if (!supabase) return null
  try {
    const t0 = Date.now()
    const { data, error } = await supabase.rpc('server_now')
    const t1 = Date.now()
    if (error || !data) return null
    const server = Date.parse(String(data))
    return Number.isNaN(server) ? null : { offset: server - (t0 + t1) / 2, rtt: t1 - t0, at: t1 }
  } catch {
    return null
  }
}

/* ---------- abrir / ler ---------- */

export async function openMatch(teamId: string, category: CategoryId, event: CalendarEvent): Promise<MatchRow> {
  if (!supabase) throw new Error('Sem conexão com o servidor.')
  const { error } = await supabase.from('matches').upsert(
    { team_id: teamId, category, calendar_event_id: event.id, opponent: event.opponent || event.title, match_date: event.date },
    { onConflict: 'team_id,calendar_event_id', ignoreDuplicates: true },
  )
  if (error && !/duplicate/i.test(error.message)) throw new Error(error.message)
  const { data, error: readError } = await supabase.from('matches').select('*').eq('team_id', teamId).eq('calendar_event_id', event.id).single()
  if (readError || !data) throw new Error(readError?.message ?? 'Jogo não encontrado.')
  return toMatch(data)
}

export async function fetchMatchBundle(matchId: string) {
  if (!supabase) throw new Error('offline')
  const client = supabase
  // relação e eventos vêm paginados e conferidos contra a contagem: o servidor corta respostas longas sem avisar
  const page = (table: string, order: string[]) => fetchAll<Record<string, unknown>>(table, async (from, to) => {
    let query = client.from(table).select('*', { count: 'exact' }).eq('match_id', matchId)
    for (const column of order) query = query.order(column, { ascending: true })
    const { data, count, error } = await query.range(from, to)
    if (error) throw new Error(error.message)
    return { rows: (data ?? []) as Array<Record<string, unknown>>, total: count }
  })
  const [m, p, e, o] = await Promise.all([
    client.from('matches').select('*').eq('id', matchId).single(),
    page('match_players', ['athlete_id']),
    page('match_events', ['created_at', 'id']),
    client.from('sessao_registro').select('id,user_id,user_name,escopo').eq('match_id', matchId).is('fim', null),
  ])
  if (m.error) throw new Error(m.error.message)
  // donos de setor: se a tabela ainda não existir (banco antigo), segue sem eles
  const owners = o.error ? [] : (o.data ?? []).map((r) => ({ sessionId: String(r.id), userId: String(r.user_id), userName: String(r.user_name ?? ''), scope: r.escopo as Sector | 'ALL' }))
  return { match: toMatch(m.data), players: p.map(toPlayer), events: e.map(toEvent), owners }
}

/* ---------- fila ---------- */

const memoryStorage = () => {
  const map = new Map<string, string>()
  return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value) } }
}
const queue = createQueue(typeof localStorage !== 'undefined' ? localStorage : memoryStorage(), { queue: QUEUE_KEY, rejected: REJECTED_KEY })
const readQueue = () => queue.read()

export { QueueFullError } from './matchQueue'
export type { RejectedItem } from './matchQueue'

export const pendingCount = () => readQueue().length
/** Armazenamento do aparelho cheio: novos registros estão sendo recusados. */
export const queueFull = () => queue.isFull()
/** Confere se o armazenamento voltou a aceitar escrita. */
export const probeQueue = () => queue.probe()
export const pendingMatchOps = (matchId: string) => readQueue().filter((q) => (q.op === 'match' && q.id === matchId) || (q.op === 'players' && q.rows.some((r) => r.match_id === matchId)) || (q.op === 'players_delete' && q.matchId === matchId)).length

/** Eventos ainda na fila (para a tela mostrar como já registrados). */
export function queuedEvents(matchId: string): MatchEvent[] {
  return readQueue().filter((q): q is Extract<QueueItem, { op: 'event' }> => q.op === 'event' && q.row.match_id === matchId).map((q) => toEvent(q.row))
}
export function queuedUndos(): Map<string, string> {
  return new Map(readQueue().filter((q): q is Extract<QueueItem, { op: 'undo' }> => q.op === 'undo').map((q) => [q.id, q.deletedAt]))
}

/* ---------- recusados pelo servidor ---------- */

export type RejectedView = { index: number; label: string; reason: string; at: string; eventId: string | null; event: MatchEvent | null }

const OP_LABEL: Record<QueueItem['op'], string> = { event: 'Ação', undo: 'Desfazer', match: 'Cronômetro / comando', players: 'Relação', players_delete: 'Retirada da relação' }

const belongsTo = (item: QueueItem, matchId: string) =>
  item.op === 'event' ? item.row.match_id === matchId
    : item.op === 'match' ? item.id === matchId
      : item.op === 'players' ? item.rows.some((r) => r.match_id === matchId)
        : item.op === 'players_delete' ? item.matchId === matchId
          : true // desfazer só guarda o id do evento: aparece em qualquer jogo aberto

/** Registros que o servidor recusou por regra. Continuam no aparelho até alguém reenviar ou descartar. */
export function rejectedItems(matchId: string): RejectedView[] {
  return queue.rejected()
    .map((entry: RejectedItem, index: number) => ({ entry, index }))
    .filter(({ entry }) => belongsTo(entry.item, matchId))
    .map(({ entry, index }) => ({
      index, label: OP_LABEL[entry.item.op], reason: entry.reason, at: entry.at,
      eventId: entry.item.op === 'event' ? String(entry.item.row.id) : entry.item.op === 'undo' ? entry.item.id : null,
      event: entry.item.op === 'event' ? toEvent({ ...entry.item.row, deleted_at: null }) : null,
    }))
}
export const retryRejected = (index: number) => { const ok = queue.retryRejected(index); if (ok) void flushQueue(); return ok }
export const discardRejected = (index: number) => queue.discardRejected(index)

function enqueue(item: QueueItem) {
  queue.enqueue(item) // lança QueueFullError se o armazenamento estiver cheio
  void flushQueue()
}

let flushing: Promise<{ sent: number; rejected: number; failed: string }> | null = null

async function sendBatch(batch: QueueItem[]): Promise<SendFailure | null> {
  if (!supabase) return { status: 0, message: 'offline' }
  const item = batch[0]
  const result =
    item.op === 'event' ? await supabase.from('match_events').upsert(batch.map((q) => (q as Extract<QueueItem, { op: 'event' }>).row), { onConflict: 'id', ignoreDuplicates: true })
      : item.op === 'undo' ? await supabase.from('match_events').update({ deleted_at: item.deletedAt }).eq('id', item.id)
        : item.op === 'match' ? await supabase.from('matches').update(item.patch).eq('id', item.id)
          : item.op === 'players' ? await supabase.from('match_players').upsert(item.rows, { onConflict: 'match_id,athlete_id' })
            : await supabase.from('match_players').delete().eq('match_id', item.matchId).in('athlete_id', item.athleteIds)
  return result.error ? { status: result.status ?? 0, message: result.error.message } : null
}

/**
 * Envia a fila em ordem. Falha passageira (rede, sessão, servidor) para e tenta de novo depois.
 * Recusa de regra NÃO descarta o item: ele vai para a lista de recusados, com o motivo.
 */
export function flushQueue(): Promise<{ sent: number; rejected: number; failed: string }> {
  if (flushing) return flushing
  flushing = (async () => {
    if (!supabase || (typeof navigator !== 'undefined' && navigator.onLine === false)) return { sent: 0, rejected: 0, failed: 'offline' }
    return queue.flush(sendBatch)
  })().finally(() => { flushing = null })
  return flushing
}

/* ---------- escrita ---------- */

export function newEventId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

/* ---------- setor do observador (D-L) ---------- */

export { sectorOwnerFor, type SectorOwner } from './match'

export class SectorTakenError extends Error {
  holder: string
  constructor(holder: string) {
    super(`Este setor já está com ${holder}.`)
    this.name = 'SectorTakenError'
    this.holder = holder
  }
}

/**
 * Assume um setor no servidor. Precisa de internet: é o servidor que garante um dono por setor.
 * `force` tira o setor de quem está com ele (os lances dele nesse setor passam a ser recusados).
 */
export async function claimSector(matchId: string, scope: Sector | 'ALL', userName: string, force = false): Promise<SectorOwner> {
  if (!supabase) throw new Error('offline')
  const { data, error } = await supabase.rpc('assumir_setor', { p_match: matchId, p_escopo: scope, p_nome: userName, p_forcar: force })
  if (error) {
    const taken = /SETOR_OCUPADO:(.*)$/.exec(error.message)
    if (taken) throw new SectorTakenError(taken[1].trim())
    throw new Error(error.message)
  }
  const r = data as Record<string, unknown>
  return { sessionId: String(r.id), userId: String(r.user_id), userName: String(r.user_name ?? ''), scope: r.escopo as Sector | 'ALL' }
}


export function recordEvent(input: { matchId: string; teamId: string; userId: string; userName: string; kind: EventKind; athleteId: string | null; period: Period; clockSeconds: number; createdAt: string; sessionId?: string | null }): MatchEvent {
  const row = {
    id: newEventId(), match_id: input.matchId, team_id: input.teamId, kind: input.kind, athlete_id: input.athleteId,
    period: input.period, clock_seconds: Math.max(0, Math.floor(input.clockSeconds)), created_by: input.userId,
    created_by_name: input.userName, created_at: input.createdAt,
    ...(input.sessionId ? { sessao_registro_id: input.sessionId } : {}),
  }
  enqueue({ op: 'event', row })
  return toEvent({ ...row, deleted_at: null })
}

export function undoEvent(id: string, deletedAt: string) {
  enqueue({ op: 'undo', id, deletedAt })
}

export function updateMatch(matchId: string, patch: MatchPatch, updatedAt: string) {
  enqueue({ op: 'match', id: matchId, patch: { ...patchRow(patch), updated_at: updatedAt } })
}

export function saveLineup(matchId: string, teamId: string, players: MatchPlayer[], updatedAt: string) {
  enqueue({
    op: 'players',
    rows: players.map((p) => ({
      match_id: matchId, team_id: teamId, athlete_id: p.athleteId, athlete_name: p.athleteName, number: p.number, positions: p.positions,
      dominant_foot: p.dominantFoot, sector: p.sector, starter: p.starter, on_field: p.onField, slot: p.slot ?? null, updated_at: updatedAt,
    })),
  })
}

export function removeFromLineup(matchId: string, athleteIds: string[]) {
  if (athleteIds.length) enqueue({ op: 'players_delete', matchId, athleteIds })
}

/** Relação do último jogo da categoria (para "usar a escalação do último jogo"). Vazio se não houver. */
export async function fetchLastLineup(teamId: string, category: string, excludeMatchId: string): Promise<MatchPlayer[]> {
  if (!supabase) return []
  const { data: games, error } = await supabase.from('matches').select('id').eq('team_id', teamId).eq('category', category)
    .neq('id', excludeMatchId).order('match_date', { ascending: false }).order('created_at', { ascending: false }).limit(5)
  if (error || !games) return []
  for (const game of games) {
    const { data: rows, error: e2 } = await supabase.from('match_players').select('*').eq('match_id', game.id).limit(60)
    if (!e2 && rows && rows.some((r) => r.starter)) return rows.map(toPlayer)
  }
  return []
}
