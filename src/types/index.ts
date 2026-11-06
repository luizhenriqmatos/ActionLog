export type CategoryId = 'Sub-15' | 'Sub-16' | 'Sub-17' | 'Sub-20'
export type ScoutMode = 'game' | 'finishing'
export type Foot = 'Direita' | 'Esquerda' | 'Ambidestro'
export type EventType = 'Jogo' | 'Treino'
export type TabId = 'roster' | 'calendar' | 'scout' | 'performance'
export type CalendarView = 'month' | 'week'

/**
 * Contagens brutas do Scout de Jogo. Percentuais nunca são guardados:
 * são sempre calculados a partir destas contagens (ver src/lib/metrics.ts).
 * O total de passes é derivado (certos + errados), por isso não existe campo "passes".
 */
export type GameMetric =
  | 'goals'
  | 'assists'
  | 'shots'
  | 'shotsOnTarget'
  | 'accuratePasses'
  | 'wrongPasses'
  | 'tackles'
  | 'possessionLoss'
  | 'foulsCommitted'
  | 'foulsSuffered'

/**
 * Contagens do Treino de Finalização por perna.
 * Para atleta ambidestro, "dominant" = perna direita e "nonDominant" = perna esquerda
 * (ver dominantFootSnapshot na sessão).
 */
export type FinishingMetric =
  | 'dominantFinishes'
  | 'dominantOnTarget'
  | 'dominantGoals'
  | 'nonDominantFinishes'
  | 'nonDominantOnTarget'
  | 'nonDominantGoals'

export type Athlete = {
  id: string
  name: string
  number: string
  positions: string
  age: string
  height: string
  weight: string
  dominantFoot: Foot
}

export type CalendarEvent = {
  id: string
  type: EventType
  title: string
  date: string
  opponent: string
  location: string
  mdTag: string
}

export type Stats = {
  game: Record<GameMetric, number>
  finishing: Record<FinishingMetric, number>
}

export type SessionRecord = {
  id: string
  createdAt: string
  updatedAt?: string
  category: CategoryId
  mode: ScoutMode
  athleteId: string
  athleteName: string
  /** Cópia do pé dominante no momento do registro. Mudar o cadastro depois não altera o histórico. */
  dominantFootSnapshot: Foot
  calendarDate: string
  periodizationTag: string
  eventTitle: string
  /** Vínculo com o compromisso do calendário (vazio em sessão avulsa). */
  eventId: string
  eventType: EventType | ''
  stats: Stats
  /** Valor do antigo contador "Passes" (v2.1), preservado só para consulta. Não entra nas taxas. */
  legacyPasses?: number
  schemaVersion: 2
}

export type CategoryData = {
  athletes: Athlete[]
  events: CalendarEvent[]
  stats: Record<string, Stats>
  sessions: SessionRecord[]
}

export type AppData = {
  teamName: string
  categories: Record<CategoryId, CategoryData>
}

export const CATEGORIES: CategoryId[] = ['Sub-15', 'Sub-16', 'Sub-17', 'Sub-20']
export const FEET: Foot[] = ['Direita', 'Esquerda', 'Ambidestro']

export const GAME_KEYS: GameMetric[] = [
  'goals',
  'assists',
  'shots',
  'shotsOnTarget',
  'accuratePasses',
  'wrongPasses',
  'tackles',
  'possessionLoss',
  'foulsCommitted',
  'foulsSuffered',
]

export const FINISHING_KEYS: FinishingMetric[] = [
  'dominantFinishes',
  'dominantOnTarget',
  'dominantGoals',
  'nonDominantFinishes',
  'nonDominantOnTarget',
  'nonDominantGoals',
]

export const GAME_LABELS: Record<GameMetric, string> = {
  goals: 'Gols',
  assists: 'Assistências',
  shots: 'Finalizações',
  shotsOnTarget: 'Finalizações no gol',
  accuratePasses: 'Passes certos',
  wrongPasses: 'Passes errados',
  tackles: 'Desarmes',
  possessionLoss: 'Perdas da posse',
  foulsCommitted: 'Faltas cometidas',
  foulsSuffered: 'Faltas sofridas',
}

export const EMPTY_GAME: Record<GameMetric, number> = {
  goals: 0,
  assists: 0,
  shots: 0,
  shotsOnTarget: 0,
  accuratePasses: 0,
  wrongPasses: 0,
  tackles: 0,
  possessionLoss: 0,
  foulsCommitted: 0,
  foulsSuffered: 0,
}

export const EMPTY_FINISHING: Record<FinishingMetric, number> = {
  dominantFinishes: 0,
  dominantOnTarget: 0,
  dominantGoals: 0,
  nonDominantFinishes: 0,
  nonDominantOnTarget: 0,
  nonDominantGoals: 0,
}

export function freshStats(): Stats {
  return { game: { ...EMPTY_GAME }, finishing: { ...EMPTY_FINISHING } }
}

/** Rótulos das pernas conforme o pé registrado. Ambidestro não tem dominante. */
export function legLabels(foot: Foot): { dominant: string; nonDominant: string } {
  if (foot === 'Ambidestro') return { dominant: 'Perna direita', nonDominant: 'Perna esquerda' }
  return { dominant: `Perna dominante (${foot.toLowerCase()})`, nonDominant: `Perna não dominante (${foot === 'Direita' ? 'esquerda' : 'direita'})` }
}
