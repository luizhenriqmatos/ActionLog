/**
 * Jogo ao vivo — conversa com o Supabase.
 * Escrita: cada toque vai para uma fila no localStorage e é enviado na hora; sem rede, fica na fila
 * e é reenviado quando a rede volta (o id do evento é gerado no aparelho, então reenviar não duplica).
 * Leitura: a tela busca jogo + relação + eventos a cada 5 s.
 */
import { supabase } from './supabase'
import type { CalendarEvent, CategoryId, Foot } from '../types'
import type { ClockState, EventKind, LineupPlayer, MatchEvent, Period, Phase, Sector } from './match'

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

type QueueItem =
  | { op: 'event'; row: Record<string, unknown> }
  | { op: 'undo'; id: string; deletedAt: string }
  | { op: 'match'; id: string; patch: Record<string, unknown> }
  | { op: 'players'; rows: Array<Record<string, unknown>> }
  | { op: 'players_delete'; matchId: string; athleteIds: string[] }

const QUEUE_KEY = 'actionlog_match_queue_v1'

const toMatch = (r: Record<string, unknown>): MatchRow => ({
  id: String(r.id), teamId: String(r.team_id), category: r.category as CategoryId, calendarEventId: String(r.calendar_event_id),
  opponent: String(r.opponent ?? ''), matchDate: String(r.match_date), status: r.status as MatchRow['status'], phase: r.phase as Phase,
  period: Number(r.period) === 2 ? 2 : 1, clockRunning: Boolean(r.clock_running), clockStartedAt: (r.clock_started_at as string | null) ?? null,
  clockBaseSeconds: Number(r.clock_base_seconds ?? 0), opponentGoals: Number(r.opponent_goals ?? 0),
  commanderUserId: (r.commander_user_id as string | null) ?? null, commanderName: String(r.commander_name ?? ''),
  sessionsGeneratedAt: (r.sessions_generated_at as string | null) ?? null, updatedAt: String(r.updated_at),
})

const toPlayer = (r: Record<string, unknown>): MatchPlayer => ({
  athleteId: String(r.athlete_id), athleteName: String(r.athlete_name ?? ''), number: String(r.number ?? ''), positions: String(r.positions ?? ''),
  dominantFoot: (r.dominant_foot as Foot) ?? 'Direita', sector: r.sector as Sector, starter: Boolean(r.starter), onField: Boolean(r.on_field),
})

const toEvent = (r: Record<string, unknown>): MatchEvent => ({
  id: String(r.id), kind: r.kind as EventKind, athleteId: (r.athlete_id as string | null) ?? null, period: Number(r.period) === 2 ? 2 : 1,
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

/** Diferença (ms) entre o relógio do servidor e o deste aparelho. */
export async function serverOffset(): Promise<number> {
  if (!supabase) return 0
  const t0 = Date.now()
  const { data, error } = await supabase.rpc('server_now')
  const t1 = Date.now()
  if (error || !data) return 0
  const server = Date.parse(String(data))
  return Number.isNaN(server) ? 0 : server - (t0 + t1) / 2
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
  const [m, p, e] = await Promise.all([
    supabase.from('matches').select('*').eq('id', matchId).single(),
    supabase.from('match_players').select('*').eq('match_id', matchId),
    supabase.from('match_events').select('*').eq('match_id', matchId).order('created_at', { ascending: true }).limit(5000),
  ])
  if (m.error || p.error || e.error) throw new Error((m.error ?? p.error ?? e.error)?.message)
  return { match: toMatch(m.data), players: (p.data ?? []).map(toPlayer), events: (e.data ?? []).map(toEvent) }
}

/* ---------- fila ---------- */

function readQueue(): QueueItem[] {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]') as QueueItem[] } catch { return [] }
}
function writeQueue(items: QueueItem[]) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(items)) } catch { /* armazenamento cheio: segue só em memória */ }
}

export const pendingCount = () => readQueue().length
export const pendingMatchOps = (matchId: string) => readQueue().filter((q) => (q.op === 'match' && q.id === matchId) || (q.op === 'players' && q.rows.some((r) => r.match_id === matchId)) || (q.op === 'players_delete' && q.matchId === matchId)).length

/** Eventos ainda na fila (para a tela mostrar como já registrados). */
export function queuedEvents(matchId: string): MatchEvent[] {
  return readQueue().filter((q): q is Extract<QueueItem, { op: 'event' }> => q.op === 'event' && q.row.match_id === matchId).map((q) => toEvent(q.row))
}
export function queuedUndos(): Map<string, string> {
  return new Map(readQueue().filter((q): q is Extract<QueueItem, { op: 'undo' }> => q.op === 'undo').map((q) => [q.id, q.deletedAt]))
}

function enqueue(item: QueueItem) {
  writeQueue([...readQueue(), item])
  void flushQueue()
}

let flushing: Promise<{ sent: number; failed: string }> | null = null

const isNetworkError = (message: string) => /fetch|network|failed to|load failed|timeout|offline/i.test(message)

/** Envia a fila em ordem. Para no primeiro erro de rede (tenta de novo depois); erro de regra descarta o item. */
export function flushQueue(): Promise<{ sent: number; failed: string }> {
  if (flushing) return flushing
  flushing = (async () => {
    let sent = 0
    let failed = ''
    if (!supabase || (typeof navigator !== 'undefined' && navigator.onLine === false)) return { sent, failed: 'offline' }
    let single = false
    for (;;) {
      const queue = readQueue()
      const item = queue[0]
      if (!item) break
      // eventos seguidos vão juntos num envio só
      let size = 1
      if (item.op === 'event' && !single) while (size < queue.length && size < 200 && queue[size].op === 'event') size += 1
      const batch = queue.slice(0, size)
      let error: { message: string } | null = null
      try {
        if (item.op === 'event') ({ error } = await supabase.from('match_events').upsert(batch.map((q) => (q as Extract<QueueItem, { op: 'event' }>).row), { onConflict: 'id', ignoreDuplicates: true }))
        else if (item.op === 'undo') ({ error } = await supabase.from('match_events').update({ deleted_at: item.deletedAt }).eq('id', item.id))
        else if (item.op === 'match') ({ error } = await supabase.from('matches').update(item.patch).eq('id', item.id))
        else if (item.op === 'players') ({ error } = await supabase.from('match_players').upsert(item.rows, { onConflict: 'match_id,athlete_id' }))
        else ({ error } = await supabase.from('match_players').delete().eq('match_id', item.matchId).in('athlete_id', item.athleteIds))
      } catch (e) {
        error = { message: e instanceof Error ? e.message : String(e) }
      }
      if (error && isNetworkError(error.message)) { failed = 'offline'; break }
      if (error && size > 1) { single = true; continue } // um item com problema: reenviar um a um para não perder os outros
      if (error) failed = error.message
      // só esta função remove itens, e ela roda uma por vez: os primeiros `size` são os enviados
      writeQueue(readQueue().slice(size))
      sent += size
    }
    return { sent, failed }
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

export function recordEvent(input: { matchId: string; teamId: string; userId: string; userName: string; kind: EventKind; athleteId: string | null; period: Period; clockSeconds: number; createdAt: string }): MatchEvent {
  const row = {
    id: newEventId(), match_id: input.matchId, team_id: input.teamId, kind: input.kind, athlete_id: input.athleteId,
    period: input.period, clock_seconds: Math.max(0, Math.floor(input.clockSeconds)), created_by: input.userId,
    created_by_name: input.userName, created_at: input.createdAt,
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
      dominant_foot: p.dominantFoot, sector: p.sector, starter: p.starter, on_field: p.onField, updated_at: updatedAt,
    })),
  })
}

export function removeFromLineup(matchId: string, athleteIds: string[]) {
  if (athleteIds.length) enqueue({ op: 'players_delete', matchId, athleteIds })
}
