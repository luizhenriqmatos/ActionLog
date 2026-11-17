import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildReportContent, otherAthletesMentioned, reportPlainText } from './report.ts'
import type { Athlete, SessionRecord } from '../types/index.ts'

const athlete = { id: 'a1', name: 'Enzo Lima', positions: 'ZAG', dominantFoot: 'Direita' } as unknown as Athlete
const emptyGame = { goals: 0, assists: 0, shots: 0, shotsOnTarget: 0, accuratePasses: 0, wrongPasses: 0, tackles: 0, possessionLoss: 0, foulsCommitted: 0, foulsSuffered: 0, interceptions: 0 }
const session = (id: string, matchId: string | null, goals: number): SessionRecord => ({
  id, createdAt: '2026-11-01T10:00:00Z', category: 'Sub-15', mode: 'game', athleteId: 'a1', athleteName: 'Enzo Lima', dominantFootSnapshot: 'Direita',
  calendarDate: '2026-11-01', periodizationTag: 'MD', eventTitle: '', eventId: '', eventType: 'Jogo', matchId, schemaVersion: 2,
  stats: { game: { ...emptyGame, goals }, finishing: {} },
} as unknown as SessionRecord)
const input = (sessions: SessionRecord[], hidden: string[], message = '') => ({
  athlete, category: 'Sub-15', clubName: 'Clube', coachName: 'Prof', evaluation: null, previous: null, sessions,
  hiddenMatchIds: new Set(hidden), periodText: '01/11/2026 a 30/11/2026', today: '2026-11-17', message,
})

test('relatório: jogo-treino (escondido pela política) não entra; amistoso entra', () => {
  const c = buildReportContent(input([session('s1', 'm-treino', 5), session('s2', 'm-amistoso', 1)], ['m-treino']))
  assert.match(c.emCampo[0], /Participou de 1 jogo/)
  assert.match(c.emCampo[0], /1 gol/)
})

test('relatório: nunca contém dado de outro atleta', () => {
  const other = { ...session('s9', 'm1', 3), athleteId: 'a2', athleteName: 'Caio Souza' }
  const c = buildReportContent(input([session('s1', 'm1', 1), other], []))
  assert.equal(JSON.stringify(c).includes('Caio'), false)
  assert.match(c.emCampo[0], /1 gol/)
})

test('relatório: avisa quando texto livre cita outro atleta do elenco', () => {
  const roster = [athlete, { id: 'a2', name: 'Caio Souza' }, { id: 'a3', name: 'Enzo Prado' }, { id: 'a4', name: 'Léo' }]
  assert.deepEqual(otherAthletesMentioned(['Jogou bem, melhor que o Caio hoje'], athlete, roster), ['Caio Souza'])
  assert.deepEqual(otherAthletesMentioned(['Enzo evoluiu muito'], athlete, roster), [])
  assert.deepEqual(otherAthletesMentioned(['Parabéns pela dedicação'], athlete, roster), [])
})

test('relatório: texto copiado é o mesmo conteúdo estruturado', () => {
  const c = buildReportContent(input([session('s1', 'm1', 2)], [], 'Seguimos juntos'))
  const text = reportPlainText(c)
  assert.match(text, /Enzo Lima \(Sub-15\)/)
  assert.match(text, /Mensagem do treinador: Seguimos juntos/)
})
