import type { Evaluation } from '../types'

export type CriterionGroup = 'Técnico' | 'Tático' | 'Físico' | 'Comportamental'
export type Criterion = { key: string; label: string; group: CriterionGroup }

/** Critérios padrão da avaliação periódica. Linguagem pensada para também ser lida pelos pais. */
export const CRITERIA: Criterion[] = [
  { key: 'passe', label: 'Passe', group: 'Técnico' },
  { key: 'dominio', label: 'Domínio de bola', group: 'Técnico' },
  { key: 'finalizacao', label: 'Finalização', group: 'Técnico' },
  { key: 'conducao', label: 'Condução e drible', group: 'Técnico' },
  { key: 'posicionamento', label: 'Posicionamento', group: 'Tático' },
  { key: 'decisao', label: 'Tomada de decisão', group: 'Tático' },
  { key: 'velocidade', label: 'Velocidade', group: 'Físico' },
  { key: 'resistencia', label: 'Resistência', group: 'Físico' },
  { key: 'disciplina', label: 'Disciplina e pontualidade', group: 'Comportamental' },
  { key: 'equipe', label: 'Trabalho em equipe', group: 'Comportamental' },
  { key: 'dedicacao', label: 'Dedicação nos treinos', group: 'Comportamental' },
]

export const GROUPS: CriterionGroup[] = ['Técnico', 'Tático', 'Físico', 'Comportamental']

export const SCORE_LABEL: Record<number, string> = { 1: 'Precisa de atenção', 2: 'Em desenvolvimento', 3: 'Adequado', 4: 'Bom', 5: 'Excelente' }

/** Intervalo sugerido entre avaliações (dias). */
export const EVALUATION_INTERVAL_DAYS = 30

function average(values: number[]) {
  return values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null
}

export function overall(evaluation: Evaluation) {
  return average(CRITERIA.map((c) => evaluation.scores[c.key]).filter((v): v is number => typeof v === 'number'))
}

export function groupAverage(evaluation: Evaluation, group: CriterionGroup) {
  return average(CRITERIA.filter((c) => c.group === group).map((c) => evaluation.scores[c.key]).filter((v): v is number => typeof v === 'number'))
}

export function sortedByDate(evaluations: Evaluation[]) {
  return [...evaluations].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
}

export function forAthlete(evaluations: Evaluation[], athleteId: string) {
  return sortedByDate(evaluations.filter((e) => e.athleteId === athleteId))
}

/** Avaliação anterior à informada, para comparar evolução. */
export function previousOf(evaluations: Evaluation[], current: Evaluation) {
  const list = forAthlete(evaluations, current.athleteId)
  const index = list.findIndex((e) => e.id === current.id)
  return index > 0 ? list[index - 1] : null
}

export type Trend = 'up' | 'down' | 'same' | null
export function trend(current: number | null | undefined, previous: number | null | undefined): Trend {
  if (current == null || previous == null) return null
  if (current > previous) return 'up'
  if (current < previous) return 'down'
  return 'same'
}

export const TREND_LABEL: Record<Exclude<Trend, null>, string> = { up: 'evoluiu', down: 'caiu', same: 'manteve' }

export function formatScore(value: number | null | undefined) {
  if (value == null) return '—'
  return String(value).replace('.', ',')
}

/** Situação da avaliação periódica de um atleta. */
export function evaluationStatus(evaluations: Evaluation[], athleteId: string, today: string): { last: Evaluation | null; due: boolean; daysSince: number | null } {
  const list = forAthlete(evaluations, athleteId)
  const last = list[list.length - 1] ?? null
  if (!last) return { last: null, due: true, daysSince: null }
  const days = Math.round((new Date(`${today}T12:00:00`).getTime() - new Date(`${last.date}T12:00:00`).getTime()) / 86_400_000)
  return { last, due: days >= EVALUATION_INTERVAL_DAYS, daysSince: days }
}

export function periodLabel(date: string) {
  const d = new Date(`${date}T12:00:00`)
  const month = d.toLocaleDateString('pt-BR', { month: 'long' })
  return `${month.charAt(0).toUpperCase()}${month.slice(1)} de ${d.getFullYear()}`
}
