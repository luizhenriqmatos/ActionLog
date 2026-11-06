import type { SupabaseClient } from '@supabase/supabase-js'
import type { AppData, Athlete, CalendarEvent, CategoryId, Evaluation, Foot, SessionRecord } from '../types'
import { CATEGORIES } from '../types'

/**
 * Sincronização local-first.
 * O aparelho continua sendo a fonte imediata (funciona sem internet). Quando há login:
 * - pull: baixa linhas do time e mescla por entidade; vence quem tiver updated_at mais recente;
 * - push: envia só o que mudou desde o último envio (comparando uma "impressão" de cada linha);
 * - exclusões viram deleted_at no servidor (tombstone), para sumirem nos outros aparelhos.
 */

type Row = Record<string, unknown>
export type RemoteRows = { athletes: Row[]; events: Row[]; sessions: Row[]; evaluations: Row[]; teamName: string | null }

const time = (value: unknown) => {
  const parsed = Date.parse(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : 0
}

/* ---------- entidade -> linha ---------- */

export function athleteRow(teamId: string, category: CategoryId, a: Athlete): Row {
  return {
    team_id: teamId, id: a.id, category, name: a.name, number: a.number, positions: a.positions, age: a.age,
    height: a.height, weight: a.weight, dominant_foot: a.dominantFoot, updated_at: a.updatedAt ?? '1970-01-01T00:00:00.000Z', deleted_at: null,
  }
}

export function eventRow(teamId: string, category: CategoryId, e: CalendarEvent): Row {
  return {
    team_id: teamId, id: e.id, category, type: e.type, title: e.title, date: e.date, opponent: e.opponent,
    location: e.location, md_tag: e.mdTag, updated_at: e.updatedAt ?? '1970-01-01T00:00:00.000Z', deleted_at: null,
  }
}

export function sessionRow(teamId: string, s: SessionRecord): Row {
  const g = s.stats.game
  const f = s.stats.finishing
  return {
    team_id: teamId, id: s.id, category: s.category, mode: s.mode, athlete_id: s.athleteId, athlete_name: s.athleteName,
    dominant_foot_snapshot: s.dominantFootSnapshot, calendar_date: s.calendarDate, periodization_tag: s.periodizationTag,
    event_id: s.eventId, event_title: s.eventTitle, event_type: s.eventType,
    goals: g.goals, assists: g.assists, shots: g.shots, shots_on_target: g.shotsOnTarget, accurate_passes: g.accuratePasses,
    wrong_passes: g.wrongPasses, tackles: g.tackles, possession_loss: g.possessionLoss, fouls_committed: g.foulsCommitted, fouls_suffered: g.foulsSuffered,
    dominant_finishes: f.dominantFinishes, dominant_on_target: f.dominantOnTarget, dominant_goals: f.dominantGoals,
    non_dominant_finishes: f.nonDominantFinishes, non_dominant_on_target: f.nonDominantOnTarget, non_dominant_goals: f.nonDominantGoals,
    legacy_passes: s.legacyPasses ?? null, created_at: s.createdAt, updated_at: s.updatedAt ?? s.createdAt, deleted_at: null,
  }
}

export function evaluationRow(teamId: string, category: CategoryId, e: Evaluation): Row {
  const scores: Record<string, number> = {}
  for (const [key, value] of Object.entries(e.scores)) if (typeof value === 'number' && value >= 1 && value <= 5) scores[key] = value
  return {
    team_id: teamId, id: e.id, category, athlete_id: e.athleteId, athlete_name: e.athleteName, date: e.date, period: e.period, scores,
    strengths: e.strengths, improvements: e.improvements, goals: e.goals, coach_note: e.coachNote, evaluator: e.evaluator,
    created_at: e.createdAt, updated_at: e.updatedAt, deleted_at: null,
  }
}

/* ---------- linha -> entidade ---------- */

const str = (value: unknown) => (value === null || value === undefined ? '' : String(value))
const num = (value: unknown) => Math.max(0, Math.floor(Number(value) || 0))
const foot = (value: unknown): Foot => (value === 'Esquerda' || value === 'Ambidestro' ? value : 'Direita')

export function rowAthlete(r: Row): Athlete {
  return { id: str(r.id), name: str(r.name), number: str(r.number), positions: str(r.positions), age: str(r.age), height: str(r.height), weight: str(r.weight), dominantFoot: foot(r.dominant_foot), updatedAt: new Date(time(r.updated_at)).toISOString() }
}

export function rowEvent(r: Row): CalendarEvent {
  return { id: str(r.id), type: r.type === 'Jogo' ? 'Jogo' : 'Treino', title: str(r.title), date: str(r.date).slice(0, 10), opponent: str(r.opponent), location: str(r.location), mdTag: str(r.md_tag), updatedAt: new Date(time(r.updated_at)).toISOString() }
}

export function rowSession(r: Row): SessionRecord {
  const legacy = r.legacy_passes === null || r.legacy_passes === undefined ? undefined : num(r.legacy_passes)
  return {
    id: str(r.id), createdAt: new Date(time(r.created_at)).toISOString(), updatedAt: new Date(time(r.updated_at)).toISOString(),
    category: str(r.category) as CategoryId, mode: r.mode === 'finishing' ? 'finishing' : 'game', athleteId: str(r.athlete_id), athleteName: str(r.athlete_name),
    dominantFootSnapshot: foot(r.dominant_foot_snapshot), calendarDate: str(r.calendar_date).slice(0, 10), periodizationTag: str(r.periodization_tag),
    eventTitle: str(r.event_title), eventId: str(r.event_id), eventType: r.event_type === 'Jogo' || r.event_type === 'Treino' ? r.event_type : '',
    stats: {
      game: { goals: num(r.goals), assists: num(r.assists), shots: num(r.shots), shotsOnTarget: num(r.shots_on_target), accuratePasses: num(r.accurate_passes), wrongPasses: num(r.wrong_passes), tackles: num(r.tackles), possessionLoss: num(r.possession_loss), foulsCommitted: num(r.fouls_committed), foulsSuffered: num(r.fouls_suffered) },
      finishing: { dominantFinishes: num(r.dominant_finishes), dominantOnTarget: num(r.dominant_on_target), dominantGoals: num(r.dominant_goals), nonDominantFinishes: num(r.non_dominant_finishes), nonDominantOnTarget: num(r.non_dominant_on_target), nonDominantGoals: num(r.non_dominant_goals) },
    },
    ...(legacy !== undefined ? { legacyPasses: legacy } : {}),
    schemaVersion: 2,
  }
}

export function rowEvaluation(r: Row): Evaluation {
  const raw = (r.scores && typeof r.scores === 'object' ? r.scores : {}) as Record<string, unknown>
  const scores: Record<string, number> = {}
  for (const [key, value] of Object.entries(raw)) { const n = Number(value); if (n >= 1 && n <= 5) scores[key] = n }
  return {
    id: str(r.id), athleteId: str(r.athlete_id), athleteName: str(r.athlete_name), date: str(r.date).slice(0, 10), period: str(r.period), scores,
    strengths: str(r.strengths), improvements: str(r.improvements), goals: str(r.goals), coachNote: str(r.coach_note), evaluator: str(r.evaluator),
    createdAt: new Date(time(r.created_at)).toISOString(), updatedAt: new Date(time(r.updated_at)).toISOString(),
  }
}

/* ---------- impressão para detectar mudanças ---------- */

export const fingerprint = (row: Row) => JSON.stringify(row)
export const rowKey = (table: string, id: string) => `${table}:${id}`

/** Todas as linhas que este aparelho tem hoje, com a chave de cada uma. */
export function localRows(teamId: string, data: AppData) {
  const out: Array<{ table: 'athletes' | 'calendar_events' | 'scout_sessions' | 'athlete_evaluations'; key: string; row: Row }> = []
  for (const category of CATEGORIES) {
    const c = data.categories[category]
    c.athletes.forEach((a) => out.push({ table: 'athletes', key: rowKey('athletes', a.id), row: athleteRow(teamId, category, a) }))
    c.events.forEach((e) => out.push({ table: 'calendar_events', key: rowKey('calendar_events', e.id), row: eventRow(teamId, category, e) }))
    c.sessions.forEach((s) => out.push({ table: 'scout_sessions', key: rowKey('scout_sessions', s.id), row: sessionRow(teamId, { ...s, category }) }))
    ;(c.evaluations ?? []).forEach((e) => out.push({ table: 'athlete_evaluations', key: rowKey('athlete_evaluations', e.id), row: evaluationRow(teamId, category, e) }))
  }
  return out
}

/* ---------- mescla ---------- */

/**
 * Junta o que veio do servidor com o que está no aparelho.
 * Retorna os dados mesclados e as chaves cujo valor final veio do servidor (já estão lá, não precisam subir).
 */
export function mergeRemote(local: AppData, remote: RemoteRows, teamId: string): { data: AppData; fromServer: Map<string, string> } {
  const data: AppData = { ...local, categories: { ...local.categories }, tombstones: [...local.tombstones] }
  const fromServer = new Map<string, string>()
  const pendingDelete = new Set(local.tombstones.map((t) => `${t.kind}:${t.id}`))

  type Spec<T extends { id: string }> = { rows: Row[]; kind: 'athlete' | 'event' | 'session' | 'evaluation'; table: string; list: (c: CategoryId) => T[]; set: (c: CategoryId, items: T[]) => void; toEntity: (r: Row) => T; localTime: (item: T) => number; toRow: (c: CategoryId, item: T) => Row }

  function apply<T extends { id: string }>(spec: Spec<T>) {
    for (const r of spec.rows) {
      const category = str(r.category) as CategoryId
      if (!CATEGORIES.includes(category)) continue
      const id = str(r.id)
      if (pendingDelete.has(`${spec.kind}:${id}`)) continue
      const items = spec.list(category)
      const index = items.findIndex((item) => item.id === id)
      const remoteTime = time(r.updated_at)
      if (r.deleted_at) {
        if (index >= 0 && spec.localTime(items[index]) <= time(r.deleted_at)) spec.set(category, items.filter((item) => item.id !== id))
        continue
      }
      if (index < 0 || remoteTime > spec.localTime(items[index])) {
        const entity = spec.toEntity(r)
        spec.set(category, index < 0 ? [...items, entity] : items.map((item, i) => (i === index ? entity : item)))
        fromServer.set(rowKey(spec.table, id), fingerprint(spec.toRow(category, entity)))
      } else if (remoteTime === spec.localTime(items[index])) {
        fromServer.set(rowKey(spec.table, id), fingerprint(spec.toRow(category, items[index])))
      }
    }
  }

  const cat = (c: CategoryId) => data.categories[c]
  const setCat = (c: CategoryId, patch: Partial<AppData['categories'][CategoryId]>) => { data.categories[c] = { ...cat(c), ...patch } }

  apply<Athlete>({ rows: remote.athletes, kind: 'athlete', table: 'athletes', list: (c) => cat(c).athletes, set: (c, items) => setCat(c, { athletes: items }), toEntity: rowAthlete, localTime: (a) => time(a.updatedAt), toRow: (c, a) => athleteRow(teamId, c, a) })
  apply<CalendarEvent>({ rows: remote.events, kind: 'event', table: 'calendar_events', list: (c) => cat(c).events, set: (c, items) => setCat(c, { events: [...items].sort((a, b) => a.date.localeCompare(b.date)) }), toEntity: rowEvent, localTime: (e) => time(e.updatedAt), toRow: (c, e) => eventRow(teamId, c, e) })
  apply<SessionRecord>({ rows: remote.sessions, kind: 'session', table: 'scout_sessions', list: (c) => cat(c).sessions, set: (c, items) => setCat(c, { sessions: [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) }), toEntity: rowSession, localTime: (s) => time(s.updatedAt ?? s.createdAt), toRow: (_c, s) => sessionRow(teamId, s) })

  apply<Evaluation>({ rows: remote.evaluations, kind: 'evaluation', table: 'athlete_evaluations', list: (c) => cat(c).evaluations ?? [], set: (c, items) => setCat(c, { evaluations: [...items].sort((a, b) => a.date.localeCompare(b.date)) }), toEntity: rowEvaluation, localTime: (e) => time(e.updatedAt), toRow: (c, e) => evaluationRow(teamId, c, e) })

  if (remote.teamName && !local.teamName) data.teamName = remote.teamName
  return { data, fromServer }
}

/* ---------- rede ---------- */

export type Role = 'admin' | 'treinador' | 'analista' | 'leitura'
export type TeamInfo = { id: string; name: string; role: Role }
export type Member = { userId: string; email: string; role: Role; joinedAt: string }
export type Invite = { id: string; code: string; role: Role; createdAt: string; expiresAt: string; usedAt: string | null }

export type Club = TeamInfo & { athletes: number; sessions: number; evaluations: number }

export async function listMyClubs(client: SupabaseClient): Promise<Club[]> {
  const { data, error } = await client.rpc('my_clubs')
  if (error) throw error
  return ((data ?? []) as Array<{ team_id: string; name: string; role: Role; athletes: number; sessions: number; evaluations: number }>).map((t) => ({ id: t.team_id, name: t.name, role: t.role, athletes: Number(t.athletes), sessions: Number(t.sessions), evaluations: Number(t.evaluations) }))
}

export async function canCreateClub(client: SupabaseClient): Promise<boolean> {
  const { data, error } = await client.rpc('can_create_club')
  if (error) throw error
  return Boolean(data)
}

export async function createClub(client: SupabaseClient, name: string): Promise<string> {
  const { data, error } = await client.from('teams').insert({ name: name.trim() || 'Meu clube' }).select('id').single()
  if (error) throw error
  return (data as { id: string }).id
}

export async function listMyTeams(client: SupabaseClient): Promise<TeamInfo[]> {
  const { data, error } = await client.rpc('my_teams')
  if (error) throw error
  return ((data ?? []) as Array<{ team_id: string; name: string; role: Role }>).map((t) => ({ id: t.team_id, name: t.name, role: t.role }))
}

/** Retorna o primeiro time do usuário ou cria um. O banco trava por usuário, então não duplica. */
export async function ensureMyTeam(client: SupabaseClient, name: string): Promise<string> {
  const { data, error } = await client.rpc('ensure_my_team', { p_name: name })
  if (error) throw error
  return data as string
}

export async function acceptInvite(client: SupabaseClient, code: string): Promise<string> {
  const { data, error } = await client.rpc('accept_team_invite', { p_code: code })
  if (error) throw error
  return data as string
}

export async function createInvite(client: SupabaseClient, teamId: string, role: Role): Promise<Invite> {
  const { data, error } = await client.from('team_invites').insert({ team_id: teamId, role }).select('*').single()
  if (error) throw error
  return toInvite(data as Row)
}

export async function listInvites(client: SupabaseClient, teamId: string): Promise<Invite[]> {
  const { data, error } = await client.from('team_invites').select('*').eq('team_id', teamId).is('used_at', null).gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((r) => toInvite(r as Row))
}

export async function revokeInvite(client: SupabaseClient, id: string) {
  const { error } = await client.from('team_invites').delete().eq('id', id)
  if (error) throw error
}

export async function listMembers(client: SupabaseClient, teamId: string): Promise<Member[]> {
  const { data, error } = await client.rpc('list_team_members', { p_team: teamId })
  if (error) throw error
  return ((data ?? []) as Array<{ user_id: string; email: string; role: Role; joined_at: string }>).map((m) => ({ userId: m.user_id, email: m.email, role: m.role, joinedAt: m.joined_at }))
}

export async function setMemberRole(client: SupabaseClient, teamId: string, userId: string, role: Role) {
  const { error } = await client.from('team_members').update({ role }).eq('team_id', teamId).eq('user_id', userId)
  if (error) throw error
}

export async function removeMember(client: SupabaseClient, teamId: string, userId: string) {
  const { error } = await client.from('team_members').delete().eq('team_id', teamId).eq('user_id', userId)
  if (error) throw error
}

function toInvite(r: Row): Invite {
  return { id: str(r.id), code: str(r.code), role: str(r.role) as Role, createdAt: str(r.created_at), expiresAt: str(r.expires_at), usedAt: r.used_at ? str(r.used_at) : null }
}

export async function pullTeam(client: SupabaseClient, teamId: string): Promise<RemoteRows> {
  const [athletes, events, sessions, evaluations, team] = await Promise.all([
    client.from('athletes').select('*').eq('team_id', teamId),
    client.from('calendar_events').select('*').eq('team_id', teamId),
    client.from('scout_sessions').select('*').eq('team_id', teamId),
    client.from('athlete_evaluations').select('*').eq('team_id', teamId),
    client.from('teams').select('name').eq('id', teamId).maybeSingle(),
  ])
  for (const result of [athletes, events, sessions, evaluations, team]) if (result.error) throw result.error
  return { athletes: athletes.data ?? [], events: events.data ?? [], evaluations: evaluations.data ?? [], sessions: (sessions.data ?? []).map(({ passes_total: _ignored, ...rest }) => rest), teamName: (team.data as { name?: string } | null)?.name ?? null }
}

/** Envia o que mudou. Devolve as impressões atualizadas e quantos tombstones foram aplicados. */
export async function pushChanges(client: SupabaseClient, teamId: string, data: AppData, pushed: Record<string, string>) {
  const next = { ...pushed }
  const byTable = new Map<string, Row[]>()
  const keysByTable = new Map<string, Array<[string, string]>>()
  for (const item of localRows(teamId, data)) {
    const print = fingerprint(item.row)
    if (pushed[item.key] === print) continue
    byTable.set(item.table, [...(byTable.get(item.table) ?? []), item.row])
    keysByTable.set(item.table, [...(keysByTable.get(item.table) ?? []), [item.key, print]])
  }
  for (const table of ['athletes', 'calendar_events', 'scout_sessions', 'athlete_evaluations']) {
    const rows = byTable.get(table)
    if (!rows?.length) continue
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await client.from(table).upsert(rows.slice(i, i + 200), { onConflict: 'team_id,id' })
      if (error) throw error
    }
    keysByTable.get(table)!.forEach(([key, print]) => { next[key] = print })
  }
  const tableOf = { athlete: 'athletes', event: 'calendar_events', session: 'scout_sessions', evaluation: 'athlete_evaluations' } as const
  const applied: string[] = []
  for (const t of data.tombstones) {
    const { error } = await client.from(tableOf[t.kind]).update({ deleted_at: t.deletedAt, updated_at: t.deletedAt }).eq('team_id', teamId).eq('id', t.id)
    if (error) throw error
    applied.push(`${t.kind}:${t.id}`)
    delete next[rowKey(tableOf[t.kind], t.id)]
  }
  return { pushed: next, appliedTombstones: applied, sent: [...byTable.values()].reduce((n, rows) => n + rows.length, 0) }
}

export async function pushTeamName(client: SupabaseClient, teamId: string, name: string) {
  const { error } = await client.from('teams').update({ name, updated_at: new Date().toISOString() }).eq('id', teamId)
  if (error) throw error
}
