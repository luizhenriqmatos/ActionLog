/**
 * Formações do campo para a escalação (estilo FIFA/PES). Regras puras, sem React.
 * Cada lugar tem um id `formação.POSIÇÃO[n]` (ex.: '433.ZAG1'). O id é o que fica salvo na relação do jogo.
 * Coordenadas em %: x da esquerda para a direita, y de cima (ataque) para baixo (goleiro).
 */
import { POSITIONS, primaryPosition, sectorOf, type PositionCode, type Sector } from './match.ts'

export type Slot = { id: string; code: PositionCode; x: number; y: number }
export type Formation = { id: string; label: string; slots: Slot[] }

const make = (formation: string, items: Array<[string, number, number]>): Slot[] =>
  items.map(([name, x, y]) => ({ id: `${formation}.${name}`, code: name.replace(/\d+$/, '') as PositionCode, x, y }))

export const FORMATIONS: Formation[] = [
  { id: '433', label: '4-3-3', slots: make('433', [['GOL', 50, 91], ['LE', 14, 71], ['ZAG1', 37, 75], ['ZAG2', 63, 75], ['LD', 86, 71], ['ME', 26, 50], ['VOL', 50, 57], ['MD', 74, 50], ['PE', 18, 22], ['ATA', 50, 14], ['PD', 82, 22]]) },
  { id: '442', label: '4-4-2', slots: make('442', [['GOL', 50, 91], ['LE', 14, 71], ['ZAG1', 37, 75], ['ZAG2', 63, 75], ['LD', 86, 71], ['ME', 14, 48], ['MC1', 38, 52], ['MC2', 62, 52], ['MD', 86, 48], ['ATA1', 38, 17], ['ATA2', 62, 17]]) },
  { id: '4231', label: '4-2-3-1', slots: make('4231', [['GOL', 50, 91], ['LE', 14, 71], ['ZAG1', 37, 75], ['ZAG2', 63, 75], ['LD', 86, 71], ['VOL1', 36, 57], ['VOL2', 64, 57], ['PE', 17, 36], ['MEI', 50, 34], ['PD', 83, 36], ['ATA', 50, 14]]) },
  { id: '352', label: '3-5-2', slots: make('352', [['GOL', 50, 91], ['ZAG1', 27, 75], ['ZAG2', 50, 78], ['ZAG3', 73, 75], ['LE', 10, 50], ['MC1', 32, 47], ['VOL', 50, 58], ['MC2', 68, 47], ['LD', 90, 50], ['ATA1', 38, 17], ['ATA2', 62, 17]]) },
  { id: '343', label: '3-4-3', slots: make('343', [['GOL', 50, 91], ['ZAG1', 27, 75], ['ZAG2', 50, 78], ['ZAG3', 73, 75], ['LE', 12, 52], ['MC1', 38, 55], ['MC2', 62, 55], ['LD', 88, 52], ['PE', 18, 22], ['ATA', 50, 15], ['PD', 82, 22]]) },
]
export const DEFAULT_FORMATION = '433'

export const formationById = (id: string): Formation => FORMATIONS.find((f) => f.id === id) ?? FORMATIONS[0]
export const formationOfSlot = (slotId: string): string => slotId.split('.')[0] ?? ''
export const isKnownSlot = (slotId: string | undefined | null): slotId is string =>
  !!slotId && FORMATIONS.some((f) => f.slots.some((s) => s.id === slotId))
const slotOf = (slotId: string): Slot | undefined => FORMATIONS.flatMap((f) => f.slots).find((s) => s.id === slotId)
export const slotPosition = (slotId: string): PositionCode | null => slotOf(slotId)?.code ?? null
export const slotSector = (slotId: string): Sector | null => { const code = slotPosition(slotId); return code ? sectorOf(code) : null }
export const slotLabel = (slotId: string): string => { const code = slotPosition(slotId); return code ? (POSITIONS.find((p) => p.code === code)?.label ?? code) : '' }

/** lugar -> atleta. Um atleta ocupa no máximo um lugar e um lugar tem no máximo um atleta. */
export type Assignment = Record<string, string>

/** Coloca o atleta no lugar. Se ele já estava em outro lugar e o destino estava ocupado, os dois trocam. */
export function assignToSlot(current: Assignment, slotId: string, athleteId: string): Assignment {
  const next: Assignment = { ...current }
  const from = Object.keys(next).find((key) => next[key] === athleteId)
  const occupant = next[slotId]
  if (from) delete next[from]
  if (occupant && occupant !== athleteId && from) next[from] = occupant
  next[slotId] = athleteId
  return next
}

export function removeFromSlots(current: Assignment, athleteId: string): Assignment {
  return Object.fromEntries(Object.entries(current).filter(([, id]) => id !== athleteId))
}

/**
 * Sugere a escalação pelas posições já cadastradas: cada atleta vai para um lugar da mesma posição;
 * quem não tem posição, ou não achou lugar igual, fica de fora do campo (a comissão decide). Ordem de entrada = ordem recebida.
 */
export function suggestAssignment(athletes: Array<{ id: string; positions: string }>, formationId: string): Assignment {
  const formation = formationById(formationId)
  const out: Assignment = {}
  const used = new Set<string>()
  for (const slot of formation.slots) {
    const pick = athletes.find((a) => !used.has(a.id) && primaryPosition(a.positions) === slot.code)
    if (pick) { out[slot.id] = pick.id; used.add(pick.id) }
  }
  return out
}

/** Troca de formação: quem estava num lugar de mesma posição continua; o resto sai do campo (volta para a lista). */
export function changeFormation(current: Assignment, toFormationId: string): { assignment: Assignment; displaced: string[] } {
  const target = formationById(toFormationId)
  const free = new Map<PositionCode, Slot[]>()
  for (const slot of target.slots) free.set(slot.code, [...(free.get(slot.code) ?? []), slot])
  const assignment: Assignment = {}
  const displaced: string[] = []
  for (const [slotId, athleteId] of Object.entries(current)) {
    const code = slotPosition(slotId)
    const spot = code ? free.get(code)?.shift() : undefined
    if (spot) assignment[spot.id] = athleteId
    else displaced.push(athleteId)
  }
  return { assignment, displaced }
}

/** Titular antigo sem lugar salvo: tenta um lugar livre do mesmo setor; se não houver, qualquer lugar livre; senão fica sem lugar. */
export function placeLoose(current: Assignment, formationId: string, athleteId: string, sector: Sector): Assignment {
  const formation = formationById(formationId)
  const freeSlots = formation.slots.filter((s) => !current[s.id])
  const spot = freeSlots.find((s) => sectorOf(s.code) === sector) ?? freeSlots[0]
  return spot ? { ...current, [spot.id]: athleteId } : current
}
