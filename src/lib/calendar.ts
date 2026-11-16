/**
 * Calendário — regras puras.
 * Um compromisso é identificado pelo `id`, nunca pela data: a mesma categoria pode ter
 * mais de um compromisso no mesmo dia (dois jogos de torneio, treino + jogo).
 */
import type { CalendarEvent } from '../types'

const byDateThenId = (a: CalendarEvent, b: CalendarEvent) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)

/** Salva um compromisso: troca o que tem o mesmo `id`; se não existir, acrescenta. Nunca toca nos outros. */
export function upsertEvent(events: CalendarEvent[], event: CalendarEvent): CalendarEvent[] {
  const exists = events.some((item) => item.id === event.id)
  const next = exists ? events.map((item) => (item.id === event.id ? event : item)) : [...events, event]
  return next.sort(byDateThenId)
}

/** Compromissos agrupados por data, em ordem estável. */
export function eventsByDate(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>()
  for (const event of [...events].sort(byDateThenId)) map.set(event.date, [...(map.get(event.date) ?? []), event])
  return map
}

/**
 * Só as datas com exatamente um compromisso. Usado para vincular sessões antigas (sem eventId) pela data:
 * com dois compromissos no dia não dá para adivinhar qual era, então a sessão fica sem vínculo.
 */
export function singleEventByDate(events: CalendarEvent[]): Map<string, CalendarEvent> {
  const map = new Map<string, CalendarEvent>()
  for (const [date, list] of eventsByDate(events)) if (list.length === 1) map.set(date, list[0])
  return map
}
