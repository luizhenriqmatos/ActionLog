import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluationStatus, groupAverage, overall, periodLabel, previousOf, trend } from './evaluations.ts'
import type { Evaluation } from '../types/index.ts'

const ev = (id: string, date: string, scores: Record<string, number>): Evaluation => ({ id, athleteId: 'a1', athleteName: 'Enzo', date, period: '', scores, strengths: '', improvements: '', goals: '', coachNote: '', evaluator: '', createdAt: `${date}T10:00:00Z`, updatedAt: `${date}T10:00:00Z` })

test('média ignora critérios sem nota', () => {
  const e = ev('1', '2026-10-01', { passe: 4, dominio: 2 })
  assert.equal(overall(e), 3)
  assert.equal(groupAverage(e, 'Técnico'), 3)
  assert.equal(groupAverage(e, 'Físico'), null)
})

test('avaliação anterior e tendência', () => {
  const list = [ev('2', '2026-11-01', { passe: 5 }), ev('1', '2026-10-01', { passe: 3 })]
  assert.equal(previousOf(list, list[0])?.id, '1')
  assert.equal(previousOf(list, list[1]), null)
  assert.equal(trend(5, 3), 'up')
  assert.equal(trend(3, 3), 'same')
  assert.equal(trend(3, null), null)
})

test('pendente sem avaliação ou após 30 dias', () => {
  assert.equal(evaluationStatus([], 'a1', '2026-11-06').due, true)
  const list = [ev('1', '2026-10-01', { passe: 3 })]
  assert.equal(evaluationStatus(list, 'a1', '2026-10-20').due, false)
  assert.equal(evaluationStatus(list, 'a1', '2026-10-31').due, true)
})

test('rótulo do período em português', () => {
  assert.equal(periodLabel('2026-11-06'), 'Novembro de 2026')
})
