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

/* ---------- hora do compromisso ---------- */

const BAHIA = 'America/Bahia'
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
export const isValidTime = (time: string | undefined): time is string => !!time && TIME_RE.test(time)

/** Instante ISO (fuso da Bahia, -03:00) de data + hora real. Sem hora válida: null (a hora é presumida no servidor). */
export function eventInstant(date: string, time: string | undefined): string | null {
  return isValidTime(time) ? `${date}T${time}:00-03:00` : null
}

/** HH:MM no horário da Bahia a partir do instante guardado no servidor. */
export function timeFromInstant(instant: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: BAHIA, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(instant))
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00'
  return `${get('hour') === '24' ? '00' : get('hour')}:${get('minute')}`
}

/** Duração suposta de um compromisso para avisar sobreposição (o app ainda não guarda duração). */
export const ASSUMED_DURATION_MIN = 120
const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3))

/** Compromissos do mesmo dia cujos horários (reais) se sobrepõem a este. Só avisa, nunca bloqueia. */
export function overlappingEvents(events: CalendarEvent[], candidate: { id: string; date: string; time?: string }): CalendarEvent[] {
  if (!isValidTime(candidate.time)) return []
  const start = minutes(candidate.time)
  return events.filter((item) => item.id !== candidate.id && item.date === candidate.date && isValidTime(item.time)
    && start < minutes(item.time) + ASSUMED_DURATION_MIN && minutes(item.time) < start + ASSUMED_DURATION_MIN)
}
