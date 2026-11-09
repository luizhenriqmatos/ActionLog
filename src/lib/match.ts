/**
 * Jogo ao vivo — regras puras (sem rede, sem React).
 * Cronômetro, setor sugerido, totais por atleta, coletivo e minutagem.
 */
import type { GameMetric } from '../types'

export type Sector = 'DEF' | 'MEI' | 'ATA'
export type Phase = 'pre' | 'first' | 'break' | 'second' | 'done'
export type Period = 1 | 2

export type PlayerAction =
  | 'goal' | 'assist' | 'shot' | 'shot_on_target' | 'pass_ok' | 'pass_bad'
  | 'tackle' | 'interception' | 'possession_loss' | 'foul_committed' | 'foul_suffered'
export type TeamAction = 'corner_for' | 'corner_against' | 'opponent_goal'
export type SystemAction = 'sub_out' | 'sub_in' | 'period_start' | 'period_end'
export type EventKind = PlayerAction | TeamAction | SystemAction

export type MatchEvent = {
  id: string
  kind: EventKind
  athleteId: string | null
  period: Period
  clockSeconds: number
  createdBy: string
  createdByName?: string
  createdAt: string
  deletedAt: string | null
}

export type ClockState = {
  phase: Phase
  period: Period
  clockRunning: boolean
  clockStartedAt: string | null
  clockBaseSeconds: number
}

export type LineupPlayer = {
  athleteId: string
  athleteName: string
  number: string
  sector: Sector
  starter: boolean
  onField: boolean
}

export const SECTORS: Array<{ id: Sector; label: string }> = [
  { id: 'DEF', label: 'Defesa' },
  { id: 'MEI', label: 'Meio' },
  { id: 'ATA', label: 'Ataque' },
]

/** Ações individuais na ordem dos botões, com o contador do scout que cada uma alimenta. */
export const PLAYER_ACTIONS: Array<{ kind: PlayerAction; metric: GameMetric; label: string; short: string; tone: string }> = [
  { kind: 'goal', metric: 'goals', label: 'Gol', short: 'Gol', tone: 'yellow' },
  { kind: 'assist', metric: 'assists', label: 'Assistência', short: 'Assist.', tone: 'yellow' },
  { kind: 'shot', metric: 'shots', label: 'Finalização', short: 'Final.', tone: 'blue' },
  { kind: 'shot_on_target', metric: 'shotsOnTarget', label: 'Finalização no gol', short: 'No gol', tone: 'blue' },
  { kind: 'pass_ok', metric: 'accuratePasses', label: 'Passe certo', short: 'Passe ✓', tone: 'green' },
  { kind: 'pass_bad', metric: 'wrongPasses', label: 'Passe errado', short: 'Passe ✗', tone: 'red' },
  { kind: 'tackle', metric: 'tackles', label: 'Desarme', short: 'Desarme', tone: 'purple' },
  { kind: 'interception', metric: 'interceptions', label: 'Interceptação', short: 'Intercep.', tone: 'purple' },
  { kind: 'possession_loss', metric: 'possessionLoss', label: 'Perda de posse', short: 'Perda', tone: 'orange' },
  { kind: 'foul_committed', metric: 'foulsCommitted', label: 'Falta cometida', short: 'Falta com.', tone: 'red' },
  { kind: 'foul_suffered', metric: 'foulsSuffered', label: 'Falta sofrida', short: 'Falta sof.', tone: 'green' },
]

export const TEAM_ACTIONS: Array<{ kind: TeamAction; label: string }> = [
  { kind: 'corner_for', label: 'Escanteio a favor' },
  { kind: 'corner_against', label: 'Escanteio contra' },
  { kind: 'opponent_goal', label: 'Gol do adversário' },
]

const ACTION_LABEL: Record<EventKind, string> = {
  ...Object.fromEntries(PLAYER_ACTIONS.map((a) => [a.kind, a.label])),
  ...Object.fromEntries(TEAM_ACTIONS.map((a) => [a.kind, a.label])),
  sub_out: 'Saiu', sub_in: 'Entrou', period_start: 'Início do período', period_end: 'Fim do período',
} as Record<EventKind, string>
export const actionLabel = (kind: EventKind) => ACTION_LABEL[kind] ?? kind

export const isPlayerAction = (kind: EventKind): kind is PlayerAction => PLAYER_ACTIONS.some((a) => a.kind === kind)

/* ---------- setor ---------- */

const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const SECTOR_RULES: Array<[Sector, RegExp]> = [
  ['DEF', /^(goleir|gk$|zag|lateral|ld$|le$|defens|beque|libero|ala$|alas$)/],
  ['MEI', /^(volant|vol$|mei|medio|armador|mc$|meio)/],
  ['ATA', /^(atacant|ponta|centroavant|ca$|extrem|ponteir|pd$|pe$|avante|ataque)/],
]

/** Setor sugerido a partir do texto de posições. Vale a primeira posição reconhecida (a principal). */
export function suggestSector(positions: string): Sector {
  const parts = normalize(positions).split(/[,/;|]+/).map((p) => p.trim()).filter(Boolean)
  for (const part of parts) {
    for (const word of part.split(/[\s-]+/)) {
      for (const [sector, rule] of SECTOR_RULES) if (rule.test(word)) return sector
    }
  }
  return 'MEI'
}

/* ---------- cronômetro ---------- */

/** Segundos do período atual: base acumulada + tempo desde que o relógio começou a rodar. */
export function clockSeconds(state: ClockState, nowMs: number): number {
  if (!state.clockRunning || !state.clockStartedAt) return Math.max(0, Math.floor(state.clockBaseSeconds))
  const started = Date.parse(state.clockStartedAt)
  if (Number.isNaN(started)) return Math.max(0, Math.floor(state.clockBaseSeconds))
  return Math.max(0, Math.floor(state.clockBaseSeconds + (nowMs - started) / 1000))
}

export function formatClock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export const periodLabel = (period: Period) => (period === 1 ? '1ºT' : '2ºT')
export const PHASE_LABEL: Record<Phase, string> = { pre: 'Antes do jogo', first: '1º tempo', break: 'Intervalo', second: '2º tempo', done: 'Encerrado' }

/** "1ºT 12'" — minuto de jogo como no futebol (0:00–0:59 = 1'). */
export function minuteLabel(period: Period, seconds: number) {
  return `${periodLabel(period)} ${Math.floor(seconds / 60) + 1}'`
}

/* ---------- totais ---------- */

export const activeEvents = (events: MatchEvent[]) => events.filter((e) => !e.deletedAt)

export type PlayerTotals = Record<GameMetric, number>
export const emptyTotals = (): PlayerTotals => ({
  goals: 0, assists: 0, shots: 0, shotsOnTarget: 0, accuratePasses: 0, wrongPasses: 0,
  tackles: 0, possessionLoss: 0, foulsCommitted: 0, foulsSuffered: 0, interceptions: 0,
})
const METRIC_OF = Object.fromEntries(PLAYER_ACTIONS.map((a) => [a.kind, a.metric])) as Record<PlayerAction, GameMetric>

export function playerTotals(events: MatchEvent[], period?: Period): Map<string, PlayerTotals> {
  const map = new Map<string, PlayerTotals>()
  for (const event of activeEvents(events)) {
    if (!event.athleteId || !isPlayerAction(event.kind)) continue
    if (period && event.period !== period) continue
    const totals = map.get(event.athleteId) ?? emptyTotals()
    totals[METRIC_OF[event.kind]] += 1
    map.set(event.athleteId, totals)
  }
  return map
}

export type CollectiveTotals = PlayerTotals & { cornersFor: number; cornersAgainst: number; goalsFor: number; goalsAgainst: number }

/** Coletivo = soma das ações individuais + escanteios + gol do adversário. */
export function collective(events: MatchEvent[], period?: Period): CollectiveTotals {
  const totals: CollectiveTotals = { ...emptyTotals(), cornersFor: 0, cornersAgainst: 0, goalsFor: 0, goalsAgainst: 0 }
  for (const event of activeEvents(events)) {
    if (period && event.period !== period) continue
    if (isPlayerAction(event.kind)) totals[METRIC_OF[event.kind]] += 1
    else if (event.kind === 'corner_for') totals.cornersFor += 1
    else if (event.kind === 'corner_against') totals.cornersAgainst += 1
    else if (event.kind === 'opponent_goal') totals.goalsAgainst += 1
  }
  totals.goalsFor = totals.goals
  return totals
}

export function score(events: MatchEvent[]) {
  const c = collective(events)
  return { for: c.goalsFor, against: c.goalsAgainst }
}

/* ---------- minutagem ---------- */

/**
 * Segundos em campo por atleta.
 * - Titular entra no 1ºT 0:00; sub_in começa a contar naquele instante, sub_out para.
 * - Cada período vai até o seu period_end (ou até `live.seconds` se ainda está em andamento).
 * - Substituição no intervalo deve ser gravada como 2ºT 0:00.
 */
export function minutesPlayed(
  lineup: Array<Pick<LineupPlayer, 'athleteId' | 'starter'>>,
  events: MatchEvent[],
  live?: { period: Period; seconds: number },
): Map<string, number> {
  const active = activeEvents(events)
  const result = new Map<string, number>()
  let onField = new Set(lineup.filter((p) => p.starter).map((p) => p.athleteId))

  for (const period of [1, 2] as Period[]) {
    const ends = active.filter((e) => e.kind === 'period_end' && e.period === period)
    const starts = active.filter((e) => e.kind === 'period_start' && e.period === period)
    let length: number | null = ends.length ? Math.max(...ends.map((e) => e.clockSeconds)) : null
    if (length === null && live && live.period === period) length = live.seconds
    if (length === null) {
      // período não começou: só aplica substituições feitas antes dele (intervalo) para o estado seguir correto
      if (!starts.length) break
      length = 0
    }

    const subs = active
      .filter((e) => (e.kind === 'sub_in' || e.kind === 'sub_out') && e.period === period && e.athleteId)
      .sort((a, b) => a.clockSeconds - b.clockSeconds || a.createdAt.localeCompare(b.createdAt))

    const enteredAt = new Map<string, number>()
    for (const id of onField) enteredAt.set(id, 0)
    for (const sub of subs) {
      const t = Math.min(Math.max(sub.clockSeconds, 0), length)
      const id = sub.athleteId as string
      if (sub.kind === 'sub_out' && enteredAt.has(id)) {
        result.set(id, (result.get(id) ?? 0) + (t - (enteredAt.get(id) as number)))
        enteredAt.delete(id)
      } else if (sub.kind === 'sub_in' && !enteredAt.has(id)) {
        enteredAt.set(id, t)
      }
    }
    for (const [id, t] of enteredAt) result.set(id, (result.get(id) ?? 0) + (length - t))
    onField = new Set(enteredAt.keys())
  }
  return result
}

/** Quem está em campo segundo os eventos (titulares + entradas − saídas). */
export function onFieldFromEvents(lineup: Array<Pick<LineupPlayer, 'athleteId' | 'starter'>>, events: MatchEvent[]): Set<string> {
  const set = new Set(lineup.filter((p) => p.starter).map((p) => p.athleteId))
  const subs = activeEvents(events)
    .filter((e) => (e.kind === 'sub_in' || e.kind === 'sub_out') && e.athleteId)
    .sort((a, b) => a.period - b.period || a.clockSeconds - b.clockSeconds || a.createdAt.localeCompare(b.createdAt))
  for (const sub of subs) {
    if (sub.kind === 'sub_in') set.add(sub.athleteId as string)
    else set.delete(sub.athleteId as string)
  }
  return set
}

export const roundMinutes = (seconds: number) => Math.round(seconds / 60)

/* ---------- sessão gerada ao finalizar ---------- */

/**
 * Totais do atleta prontos para scout_sessions. O banco exige no gol ≤ finalizações e gols ≤ no gol;
 * no jogo nada pode travar, então gol conta como finalização no gol e no gol conta como finalização
 * quando o observador não marcou as duas. Devolve `adjusted` para mostrar aviso.
 */
export function sessionTotals(raw: PlayerTotals): { totals: PlayerTotals; adjusted: boolean; warnings: string[] } {
  const totals = { ...raw }
  const warnings: string[] = []
  if (totals.goals > totals.shotsOnTarget) {
    warnings.push(`${totals.goals} gol(s) e só ${totals.shotsOnTarget} finalização(ões) no gol`)
    totals.shotsOnTarget = totals.goals
  }
  if (totals.shotsOnTarget > totals.shots) {
    warnings.push(`${totals.shotsOnTarget} no gol e só ${totals.shots} finalização(ões)`)
    totals.shots = totals.shotsOnTarget
  }
  return { totals, adjusted: warnings.length > 0, warnings }
}
