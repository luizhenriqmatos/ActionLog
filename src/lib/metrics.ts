import type { FinishingMetric, Foot, GameMetric, ScoutMode, SessionRecord } from '../types'

/**
 * Regras de cálculo do ActionLog.
 * 1. Percentual com denominador zero é null (exibido como "—"), nunca 0%.
 * 2. Em períodos, soma as contagens antes de dividir (1/1 + 0/9 = 10%, não 50%).
 * 3. Abaixo de MIN_SAMPLE tentativas, a taxa recebe aviso de amostra pequena.
 */
export const MIN_SAMPLE = 5

export function pct(numerator: number, denominator: number): number | null {
  if (!denominator || denominator <= 0) return null
  return Math.round((1000 * numerator) / denominator) / 10
}

export function isLowSample(denominator: number) {
  return denominator > 0 && denominator < MIN_SAMPLE
}

export function formatPct(value: number | null) {
  if (value === null) return '—'
  return `${String(Number.isInteger(value) ? value : value.toFixed(1)).replace('.', ',')}%`
}

export function formatPP(value: number | null) {
  if (value === null) return ''
  const rounded = Math.round(value * 10) / 10
  return `${rounded > 0 ? '+' : ''}${String(rounded).replace('.', ',')} p.p.`
}

/* ---------- agregação ---------- */

export type GameTotals = Record<GameMetric, number> & { sessions: number; passTotal: number }

export function sumGame(sessions: SessionRecord[]): GameTotals {
  const totals = {
    sessions: 0, passTotal: 0, goals: 0, assists: 0, shots: 0, shotsOnTarget: 0, accuratePasses: 0,
    wrongPasses: 0, tackles: 0, possessionLoss: 0, foulsCommitted: 0, foulsSuffered: 0, interceptions: 0,
  } as GameTotals
  for (const session of sessions) {
    if (session.mode !== 'game') continue
    totals.sessions += 1
    for (const key of Object.keys(session.stats.game) as GameMetric[]) {
      if (key in totals) totals[key] += safe(session.stats.game[key])
    }
  }
  totals.passTotal = totals.accuratePasses + totals.wrongPasses
  return totals
}

type Leg = { shots: number; onTarget: number; goals: number }
export type FinishingTotals = {
  sessions: number
  shots: number
  onTarget: number
  goals: number
  /** Só sessões de atletas com pé dominante definido (ambidestros ficam fora). */
  dominant: Leg
  nonDominant: Leg
  /** Sessões de ambidestros: dominant = direita, nonDominant = esquerda. */
  right: Leg
  left: Leg
  ambidextrousSessions: number
}

const emptyLeg = (): Leg => ({ shots: 0, onTarget: 0, goals: 0 })

export function sumFinishing(sessions: SessionRecord[]): FinishingTotals {
  const totals: FinishingTotals = {
    sessions: 0, shots: 0, onTarget: 0, goals: 0,
    dominant: emptyLeg(), nonDominant: emptyLeg(), right: emptyLeg(), left: emptyLeg(), ambidextrousSessions: 0,
  }
  for (const session of sessions) {
    if (session.mode !== 'finishing') continue
    const f = session.stats.finishing
    const dom: Leg = { shots: safe(f.dominantFinishes), onTarget: safe(f.dominantOnTarget), goals: safe(f.dominantGoals) }
    const non: Leg = { shots: safe(f.nonDominantFinishes), onTarget: safe(f.nonDominantOnTarget), goals: safe(f.nonDominantGoals) }
    totals.sessions += 1
    totals.shots += dom.shots + non.shots
    totals.onTarget += dom.onTarget + non.onTarget
    totals.goals += dom.goals + non.goals
    const foot: Foot = session.dominantFootSnapshot
    const [right, left] = foot === 'Esquerda' ? [non, dom] : [dom, non]
    addLeg(totals.right, right)
    addLeg(totals.left, left)
    if (foot === 'Ambidestro') totals.ambidextrousSessions += 1
    else {
      addLeg(totals.dominant, dom)
      addLeg(totals.nonDominant, non)
    }
  }
  return totals
}

function addLeg(target: Leg, source: Leg) {
  target.shots += source.shots
  target.onTarget += source.onTarget
  target.goals += source.goals
}

function safe(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0
}

/* ---------- indicadores ---------- */

export type RateKey = 'shotAccuracy' | 'conversion' | 'passAccuracy' | 'dominantEfficiency' | 'nonDominantEfficiency' | 'rightEfficiency' | 'leftEfficiency'

export type Rate = { key: RateKey; label: string; formula: string; numerator: number; denominator: number; value: number | null }

export const RATE_INFO: Record<RateKey, { label: string; formula: string }> = {
  shotAccuracy: { label: 'Aproveitamento de finalização', formula: 'No gol ÷ finalizações × 100' },
  conversion: { label: 'Taxa de conversão', formula: 'Gols ÷ finalizações × 100' },
  passAccuracy: { label: 'Precisão de passe', formula: 'Passes certos ÷ total de passes × 100' },
  dominantEfficiency: { label: 'Eficiência perna dominante', formula: 'Gols ÷ finalizações com a dominante × 100' },
  nonDominantEfficiency: { label: 'Eficiência perna não dominante', formula: 'Gols ÷ finalizações com a não dominante × 100' },
  rightEfficiency: { label: 'Eficiência perna direita', formula: 'Gols ÷ finalizações com a direita × 100' },
  leftEfficiency: { label: 'Eficiência perna esquerda', formula: 'Gols ÷ finalizações com a esquerda × 100' },
}

function rate(key: RateKey, numerator: number, denominator: number): Rate {
  return { key, ...RATE_INFO[key], numerator, denominator, value: pct(numerator, denominator) }
}

export function gameRates(t: GameTotals): Rate[] {
  return [
    rate('shotAccuracy', t.shotsOnTarget, t.shots),
    rate('conversion', t.goals, t.shots),
    rate('passAccuracy', t.accuratePasses, t.passTotal),
  ]
}

/** Para um atleta ambidestro, troca dominante/não dominante por direita/esquerda. */
export function finishingRates(t: FinishingTotals, ambidextrous = false): Rate[] {
  const base = [rate('shotAccuracy', t.onTarget, t.shots), rate('conversion', t.goals, t.shots)]
  if (ambidextrous) return [...base, rate('rightEfficiency', t.right.goals, t.right.shots), rate('leftEfficiency', t.left.goals, t.left.shots)]
  return [...base, rate('dominantEfficiency', t.dominant.goals, t.dominant.shots), rate('nonDominantEfficiency', t.nonDominant.goals, t.nonDominant.shots)]
}

export function ratesFor(mode: ScoutMode, sessions: SessionRecord[], ambidextrous = false): Rate[] {
  return mode === 'game' ? gameRates(sumGame(sessions)) : finishingRates(sumFinishing(sessions), ambidextrous)
}

export function rateDelta(current: Rate, previous: Rate | undefined) {
  if (!previous || current.value === null || previous.value === null) return null
  return Math.round((current.value - previous.value) * 10) / 10
}

/* ---------- validação ---------- */

export type Validation = { errors: string[]; warnings: string[]; invalid: Set<string> }

export function validateGame(game: Record<GameMetric, number>): Validation {
  const errors: string[] = []
  const warnings: string[] = []
  const invalid = new Set<string>()
  if (game.shotsOnTarget > game.shots) {
    errors.push(`Finalizações no gol (${game.shotsOnTarget}) maior que finalizações (${game.shots}).`)
    invalid.add('shotsOnTarget')
  }
  if (game.goals > game.shotsOnTarget) {
    errors.push(`Gols (${game.goals}) maior que finalizações no gol (${game.shotsOnTarget}).`)
    invalid.add('goals')
  }
  for (const [key, value] of Object.entries(game)) {
    if (value < 0) { errors.push('Valores não podem ser negativos.'); invalid.add(key) }
    const limit = key === 'accuratePasses' || key === 'wrongPasses' ? 120 : 30
    if (value > limit) warnings.push(`Valor ${value} parece alto. Confira se não houve toque duplicado.`)
  }
  return { errors, warnings, invalid }
}

export function validateFinishing(f: Record<FinishingMetric, number>, foot: Foot): Validation {
  const errors: string[] = []
  const warnings: string[] = []
  const invalid = new Set<string>()
  const ambi = foot === 'Ambidestro'
  const legs: Array<[FinishingMetric, FinishingMetric, FinishingMetric, string]> = [
    ['dominantFinishes', 'dominantOnTarget', 'dominantGoals', ambi ? 'direita' : 'dominante'],
    ['nonDominantFinishes', 'nonDominantOnTarget', 'nonDominantGoals', ambi ? 'esquerda' : 'não dominante'],
  ]
  for (const [shots, onTarget, goals, label] of legs) {
    if (f[onTarget] > f[shots]) { errors.push(`Perna ${label}: no gol (${f[onTarget]}) maior que finalizações (${f[shots]}).`); invalid.add(onTarget) }
    if (f[goals] > f[onTarget]) { errors.push(`Perna ${label}: gols (${f[goals]}) maior que no gol (${f[onTarget]}).`); invalid.add(goals) }
  }
  for (const [key, value] of Object.entries(f)) {
    if (value < 0) { errors.push('Valores não podem ser negativos.'); invalid.add(key) }
    if (value > 100) warnings.push(`Valor ${value} parece alto. Confira.`)
  }
  return { errors, warnings, invalid }
}

/* ---------- período e filtros ---------- */

export type PeriodPreset = '7' | '30' | '90' | 'year' | 'all' | 'custom'
export type DateRange = { from: string; to: string }

export function addDaysIso(iso: string, amount: number) {
  const date = new Date(`${iso}T12:00:00`)
  date.setDate(date.getDate() + amount)
  return toIso(date)
}

export function toIso(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function daysBetween(from: string, to: string) {
  return Math.round((new Date(`${to}T12:00:00`).getTime() - new Date(`${from}T12:00:00`).getTime()) / 86_400_000)
}

export function periodRange(preset: PeriodPreset, today: string, custom: DateRange): DateRange {
  switch (preset) {
    case '7': return { from: addDaysIso(today, -6), to: today }
    case '30': return { from: addDaysIso(today, -29), to: today }
    case '90': return { from: addDaysIso(today, -89), to: today }
    case 'year': return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` }
    case 'all': return { from: '0000-01-01', to: '9999-12-31' }
    default: return custom.from <= custom.to ? custom : { from: custom.to, to: custom.from }
  }
}

/** Período imediatamente anterior, de mesmo tamanho. "Tudo" não tem anterior. */
export function previousRange(range: DateRange): DateRange | null {
  if (range.from === '0000-01-01') return null
  const length = daysBetween(range.from, range.to) + 1
  return { from: addDaysIso(range.from, -length), to: addDaysIso(range.from, -1) }
}

export type SessionFilter = { mode?: ScoutMode; athleteId?: string; range?: DateRange | null }

export function filterSessions(sessions: SessionRecord[], filter: SessionFilter) {
  return sessions.filter((session) => {
    if (filter.mode && session.mode !== filter.mode) return false
    if (filter.athleteId && session.athleteId !== filter.athleteId) return false
    if (filter.range && (session.calendarDate < filter.range.from || session.calendarDate > filter.range.to)) return false
    return true
  })
}

/* ---------- evolução ---------- */

export type EvolutionPoint = { date: string; label: string; value: number | null; moving: number | null; denominator: number }

/**
 * Uma posição por data. A média móvel usa a soma das contagens das últimas `window` datas,
 * seguindo a mesma regra de "somar antes de dividir".
 */
export function evolution(sessions: SessionRecord[], mode: ScoutMode, key: RateKey, window = 5): EvolutionPoint[] {
  const byDate = new Map<string, SessionRecord[]>()
  for (const session of [...sessions].sort((a, b) => a.calendarDate.localeCompare(b.calendarDate))) {
    const list = byDate.get(session.calendarDate) ?? []
    list.push(session)
    byDate.set(session.calendarDate, list)
  }
  const dates = [...byDate.keys()]
  const pick = (list: SessionRecord[]) => {
    const ambi = key === 'rightEfficiency' || key === 'leftEfficiency'
    return ratesFor(mode, list, ambi).find((item) => item.key === key)
  }
  return dates.map((date, index) => {
    const point = pick(byDate.get(date) ?? [])
    const windowSessions = dates.slice(Math.max(0, index - window + 1), index + 1).flatMap((day) => byDate.get(day) ?? [])
    const moving = pick(windowSessions)
    const [, month, day] = date.split('-')
    return { date, label: `${day}/${month}`, value: point?.value ?? null, moving: moving?.value ?? null, denominator: point?.denominator ?? 0 }
  })
}
