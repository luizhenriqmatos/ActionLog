/**
 * Idade do atleta. Com data de nascimento, a idade é calculada (sempre certa);
 * sem ela, vale o número digitado no cadastro antigo.
 */
import type { Athlete } from '../types/index.ts'

/** Anos completos na data `today`. Data inválida ou futura: null. */
export function ageFromBirthDate(birthDate: string, today = new Date()): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate)
  if (!match) return null
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const ty = today.getFullYear()
  const tm = today.getMonth() + 1
  const td = today.getDate()
  if (year > ty || (year === ty && (month > tm || (month === tm && day > td)))) return null
  let age = ty - year
  if (tm < month || (tm === month && td < day)) age -= 1
  return age
}

export function athleteAge(athlete: Pick<Athlete, 'age' | 'birthDate'>, today = new Date()): string {
  if (athlete.birthDate) {
    const age = ageFromBirthDate(athlete.birthDate, today)
    if (age !== null) return String(age)
  }
  return athlete.age
}

/** Data em pt-BR (dd/mm/aaaa) sem passar por fuso horário. */
export function formatBirthDate(birthDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : ''
}
