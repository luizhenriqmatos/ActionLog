import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  evolution, filterSessions, finishingRates, formatPct, gameRates, isLowSample, pct, periodRange, previousRange,
  sumFinishing, sumGame, validateFinishing, validateGame,
} from './metrics.ts'
import type { Foot, SessionRecord } from '../types/index.ts'

const game = (date: string, g: Partial<SessionRecord['stats']['game']>, athleteId = 'a1'): SessionRecord => ({
  id: `${date}-${athleteId}-g`, createdAt: `${date}T10:00:00Z`, category: 'Sub-15', mode: 'game', athleteId, athleteName: 'Atleta',
  dominantFootSnapshot: 'Direita', calendarDate: date, periodizationTag: 'MD', eventTitle: '', eventId: '', eventType: 'Jogo', schemaVersion: 2,
  stats: {
    game: { goals: 0, assists: 0, shots: 0, shotsOnTarget: 0, accuratePasses: 0, wrongPasses: 0, tackles: 0, possessionLoss: 0, foulsCommitted: 0, foulsSuffered: 0, ...g },
    finishing: { dominantFinishes: 0, dominantOnTarget: 0, dominantGoals: 0, nonDominantFinishes: 0, nonDominantOnTarget: 0, nonDominantGoals: 0 },
  },
})

const finishing = (date: string, foot: Foot, f: Partial<SessionRecord['stats']['finishing']>): SessionRecord => ({
  ...game(date, {}, 'a9'), id: `${date}-f-${foot}`, mode: 'finishing', dominantFootSnapshot: foot,
  stats: { game: game(date, {}).stats.game, finishing: { dominantFinishes: 0, dominantOnTarget: 0, dominantGoals: 0, nonDominantFinishes: 0, nonDominantOnTarget: 0, nonDominantGoals: 0, ...f } },
})

test('percentual com denominador zero é null e aparece como —', () => {
  assert.equal(pct(0, 0), null)
  assert.equal(formatPct(pct(3, 0)), '—')
  assert.equal(pct(1, 3), 33.3)
  assert.equal(formatPct(33.3), '33,3%')
})

test('período soma antes de dividir: 1/1 + 0/9 = 10%', () => {
  const sessions = [game('2026-10-01', { shots: 1, shotsOnTarget: 1, goals: 1 }), game('2026-10-08', { shots: 9 })]
  const conversion = gameRates(sumGame(sessions)).find((r) => r.key === 'conversion')!
  assert.equal(conversion.value, 10)
  assert.equal(conversion.denominator, 10)
})

test('precisão de passe usa certos ÷ (certos + errados)', () => {
  const rates = gameRates(sumGame([game('2026-10-01', { accuratePasses: 30, wrongPasses: 10 })]))
  assert.equal(rates.find((r) => r.key === 'passAccuracy')!.value, 75)
})

test('perna dominante segue o snapshot e ignora ambidestro', () => {
  const totals = sumFinishing([
    finishing('2026-10-01', 'Direita', { dominantFinishes: 10, dominantOnTarget: 6, dominantGoals: 4, nonDominantFinishes: 5, nonDominantOnTarget: 2, nonDominantGoals: 1 }),
    finishing('2026-10-02', 'Ambidestro', { dominantFinishes: 8, dominantOnTarget: 4, dominantGoals: 2, nonDominantFinishes: 8, nonDominantOnTarget: 4, nonDominantGoals: 3 }),
  ])
  assert.equal(totals.shots, 31)
  assert.equal(totals.dominant.shots, 10)
  assert.equal(totals.ambidextrousSessions, 1)
  const rates = finishingRates(totals)
  assert.equal(rates.find((r) => r.key === 'dominantEfficiency')!.value, 40)
  assert.equal(rates.find((r) => r.key === 'nonDominantEfficiency')!.value, 20)
})

test('canhoto: dominante = esquerda na visão direita/esquerda', () => {
  const totals = sumFinishing([finishing('2026-10-01', 'Esquerda', { dominantFinishes: 10, dominantGoals: 0, nonDominantFinishes: 2 })])
  assert.equal(totals.left.shots, 10)
  assert.equal(totals.right.shots, 2)
})

test('validação bloqueia no gol > finalizações e gols > no gol', () => {
  const v = validateGame({ ...game('x', {}).stats.game, shots: 2, shotsOnTarget: 3, goals: 4 })
  assert.equal(v.errors.length, 2)
  assert.ok(v.invalid.has('shotsOnTarget') && v.invalid.has('goals'))
  const f = validateFinishing({ ...finishing('x', 'Direita', {}).stats.finishing, nonDominantFinishes: 1, nonDominantOnTarget: 1, nonDominantGoals: 2 }, 'Direita')
  assert.equal(f.errors.length, 1)
})

test('amostra pequena abaixo de 5 tentativas', () => {
  assert.equal(isLowSample(0), false)
  assert.equal(isLowSample(4), true)
  assert.equal(isLowSample(5), false)
})

test('períodos e período anterior de mesmo tamanho', () => {
  const r = periodRange('30', '2026-11-06', { from: '', to: '' })
  assert.deepEqual(r, { from: '2026-10-08', to: '2026-11-06' })
  assert.deepEqual(previousRange(r), { from: '2026-09-08', to: '2026-10-07' })
  assert.equal(previousRange(periodRange('all', '2026-11-06', { from: '', to: '' })), null)
})

test('filtro por atleta, modo e período', () => {
  const s = [game('2026-10-01', {}, 'a1'), game('2026-10-01', {}, 'a2'), finishing('2026-12-01', 'Direita', {})]
  assert.equal(filterSessions(s, { athleteId: 'a1' }).length, 1)
  assert.equal(filterSessions(s, { mode: 'finishing' }).length, 1)
  assert.equal(filterSessions(s, { range: { from: '2026-10-01', to: '2026-10-31' } }).length, 2)
})

test('evolução agrupa por data e média móvel soma contagens', () => {
  const s = [game('2026-10-01', { shots: 1, goals: 1, shotsOnTarget: 1 }), game('2026-10-08', { shots: 9 })]
  const points = evolution(s, 'game', 'conversion', 5)
  assert.equal(points.length, 2)
  assert.equal(points[0].value, 100)
  assert.equal(points[1].value, 0)
  assert.equal(points[1].moving, 10)
})
