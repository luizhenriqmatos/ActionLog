import type { SupabaseClient } from '@supabase/supabase-js'
import type { AppData, Athlete, CalendarEvent, CategoryId, Foot, SessionRecord } from '../types'
import { CATEGORIES } from '../types'

/**
 * Sincronização local-first.
 * O aparelho continua sendo a fonte imediata (funciona sem internet). Quando há login:
 * - pull: baixa linhas do time e mescla por entidade; vence quem tiver updated_at mais recente;
 * - push: envia só o que mudou desde o último envio (comparando uma "impressão" de cada linha);
 * - exclusões viram deleted_at no servidor (tombstone), para sumirem nos outros aparelhos.
 */

type Row = Record<string, unknown>
export type RemoteRows = { athletes: Row[]; events: Row[]; sessions: Row[]; teamName: string | null }

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

/* ---------- impressão para detectar mudanças ---------- */

export const fingerprint = (row: Row) => JSON.stringify(row)
export const rowKey = (table: string, id: string) => `${table}:${id}`

/** Todas as linhas que este aparelho tem hoje, com a chave de cada uma. */
export function localRows(teamId: string, data: AppData) {
  const out: Array<{ table: 'athletes' | 'calendar_events' | 'scout_sessions'; key: string; row: Row }> = []
  for (const category of CATEGORIES) {
    const c = data.categories[category]
    c.athletes.forEach((a) => out.push({ table: 'athletes', key: rowKey('athletes', a.id), row: athleteRow(teamId, category, a) }))
    c.events.forEach((e) => out.push({ table: 'calendar_events', key: rowKey('calendar_events', e.id), row: eventRow(teamId, category, e) }))
    c.sessions.forEach((s) => out.push({ table: 'scout_sessions', key: rowKey('scout_sessions', s.id), row: sessionRow(teamId, { ...s, category }) }))
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

  type Spec<T extends { id: string }> = { rows: Row[]; kind: 'athlete' | 'event' | 'session'; table: string; list: (c: CategoryId) => T[]; set: (c: CategoryId, items: T[]) => void; toEntity: (r: Row) => T; localTime: (item: T) => number; toRow: (c: CategoryId, item: T) => Row }

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

  if (remote.teamName && !local.teamName) data.teamName = remote.teamName
  return { data, fromServer }
}

/* ---------- rede ---------- */

export async function findOrCreateTeam(client: SupabaseClient, userId: string, name: string): Promise<{ id: string; name: string }> {
  const { data: memberships, error } = await client.from('team_members').select('team_id, role, teams(name)').eq('user_id', userId).order('created_at', { ascending: true })
  if (error) throw error
  if (memberships && memberships.length > 0) {
    const first = memberships[0] as unknown as { team_id: string; teams: { name: string } | null }
    return { id: first.team_id, name: first.teams?.name ?? '' }
  }
  const { data: created, error: createError } = await client.from('teams').insert({ name: name || 'Meu time' }).select('id, name').single()
  if (createError) throw createError
  return created as { id: string; name: string }
}

export async function pullTeam(client: SupabaseClient, teamId: string): Promise<RemoteRows> {
  const [athletes, events, sessions, team] = await Promise.all([
    client.from('athletes').select('*').eq('team_id', teamId),
    client.from('calendar_events').select('*').eq('team_id', teamId),
    client.from('scout_sessions').select('*').eq('team_id', teamId),
    client.from('teams').select('name').eq('id', teamId).maybeSingle(),
  ])
  for (const result of [athletes, events, sessions, team]) if (result.error) throw result.error
  return { athletes: athletes.data ?? [], events: events.data ?? [], sessions: (sessions.data ?? []).map(({ passes_total: _ignored, ...rest }) => rest), teamName: (team.data as { name?: string } | null)?.name ?? null }
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
  for (const table of ['athletes', 'calendar_events', 'scout_sessions']) {
    const rows = byTable.get(table)
    if (!rows?.length) continue
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await client.from(table).upsert(rows.slice(i, i + 200), { onConflict: 'team_id,id' })
      if (error) throw error
    }
    keysByTable.get(table)!.forEach(([key, print]) => { next[key] = print })
  }
  const tableOf = { athlete: 'athletes', event: 'calendar_events', session: 'scout_sessions' } as const
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
