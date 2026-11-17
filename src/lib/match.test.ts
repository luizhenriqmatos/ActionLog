import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  clockSeconds, collective, formatClock, minuteLabel, minutesPlayed, onFieldFromEvents, playerTotals, sessionTotals, suggestSector,
  type EventKind, type MatchEvent, type Period,
} from './match.ts'

let seq = 0
const ev = (kind: EventKind, period: Period, min: number, athleteId: string | null = null, extra: Partial<MatchEvent> = {}): MatchEvent => ({
  id: `e${++seq}`, kind, athleteId, period, clockSeconds: Math.round(min * 60), createdBy: 'u1',
  createdAt: new Date(Date.UTC(2026, 10, 11, 15, 0, seq)).toISOString(), deletedAt: null, ...extra,
})
const ends = (first = 35, second = 35) => [
  ev('period_start', 1, 0), ev('period_end', 1, first), ev('period_start', 2, 0), ev('period_end', 2, second),
]
const lineup = [
  { athleteId: 'A', starter: true }, { athleteId: 'B', starter: true }, { athleteId: 'C', starter: false }, { athleteId: 'D', starter: false },
]
const mins = (m: Map<string, number>, id: string) => (m.get(id) ?? 0) / 60

test('setor sugerido pela posição principal', () => {
  assert.equal(suggestSector('Goleiro'), 'DEF')
  assert.equal(suggestSector('Lateral direito, Meia'), 'DEF')
  assert.equal(suggestSector('Meia, Atacante'), 'MEI')
  assert.equal(suggestSector('Volante'), 'MEI')
  assert.equal(suggestSector('Centroavante'), 'ATA')
  assert.equal(suggestSector('segundo atacante'), 'ATA')
  assert.equal(suggestSector('Zagueiro'), 'DEF')
  assert.equal(suggestSector(''), 'MEI')
})

test('cronômetro: base + tempo rodando', () => {
  const now = Date.parse('2026-11-11T15:10:00Z')
  assert.equal(clockSeconds({ phase: 'first', period: 1, clockRunning: true, clockStartedAt: '2026-11-11T15:05:00Z', clockBaseSeconds: 120 }, now), 420)
  assert.equal(clockSeconds({ phase: 'first', period: 1, clockRunning: false, clockStartedAt: null, clockBaseSeconds: 75 }, now), 75)
  assert.equal(formatClock(425), '07:05')
  assert.equal(minuteLabel(2, 59), "2ºT 1'")
  assert.equal(minuteLabel(1, 600), "1ºT 11'")
})

test('minutagem: titular joga tudo', () => {
  const m = minutesPlayed(lineup, ends())
  assert.equal(mins(m, 'A'), 70)
  assert.equal(mins(m, 'C'), 0)
})

test('minutagem: substituído no 1ºT', () => {
  const m = minutesPlayed(lineup, [...ends(), ev('sub_out', 1, 20, 'A'), ev('sub_in', 1, 20, 'C')])
  assert.equal(mins(m, 'A'), 20)
  assert.equal(mins(m, 'C'), 15 + 35)
})

test('minutagem: entra no 2ºT', () => {
  const m = minutesPlayed(lineup, [...ends(), ev('sub_out', 2, 10, 'B'), ev('sub_in', 2, 10, 'D')])
  assert.equal(mins(m, 'B'), 45)
  assert.equal(mins(m, 'D'), 25)
})

test('minutagem: troca no intervalo vale de 2ºT 0:00', () => {
  const m = minutesPlayed(lineup, [...ends(), ev('sub_out', 2, 0, 'A'), ev('sub_in', 2, 0, 'C')])
  assert.equal(mins(m, 'A'), 35)
  assert.equal(mins(m, 'C'), 35)
})

test('minutagem: atleta que sai e volta', () => {
  const m = minutesPlayed(lineup, [
    ...ends(),
    ev('sub_out', 1, 10, 'A'), ev('sub_in', 1, 10, 'C'),
    ev('sub_out', 2, 5, 'C'), ev('sub_in', 2, 5, 'A'),
  ])
  assert.equal(mins(m, 'A'), 10 + 30)
  assert.equal(mins(m, 'C'), 25 + 5)
})

test('minutagem: jogo em andamento usa o relógio atual; desfazer ignora o evento', () => {
  const m = minutesPlayed(lineup, [ev('period_start', 1, 0), ev('sub_out', 1, 5, 'A', { deletedAt: '2026-11-11T15:06:00Z' })], { period: 1, seconds: 12 * 60 })
  assert.equal(mins(m, 'A'), 12)
  const field = onFieldFromEvents(lineup, [ev('sub_out', 1, 5, 'A'), ev('sub_in', 1, 5, 'C')])
  assert.deepEqual([...field].sort(), ['B', 'C'])
})

test('coletivo = soma dos atletas + escanteios; placar', () => {
  const events = [
    ev('goal', 1, 3, 'A'), ev('shot', 1, 3, 'A'), ev('pass_ok', 1, 4, 'B'), ev('interception', 2, 1, 'B'),
    ev('corner_for', 1, 5), ev('corner_against', 2, 6), ev('opponent_goal', 2, 7), ev('goal', 2, 8, 'B', { deletedAt: 'x' }),
  ]
  const all = collective(events)
  const byPlayer = [...playerTotals(events).values()]
  assert.equal(all.goals, byPlayer.reduce((s, t) => s + t.goals, 0))
  assert.equal(all.accuratePasses + all.interceptions, 2)
  assert.equal(all.cornersFor, 1)
  assert.equal(all.cornersAgainst, 1)
  assert.equal(all.goalsFor, 1)
  assert.equal(all.goalsAgainst, 1)
  assert.equal(collective(events, 1).cornersFor, 1)
  assert.equal(collective(events, 2).interceptions, 1)
})

test('sessão gerada: finalizações = fora + no gol + gol, e gols entram em "no gol"', () => {
  const base = { assists: 0, accuratePasses: 0, wrongPasses: 0, tackles: 0, possessionLoss: 0, foulsCommitted: 0, foulsSuffered: 0, interceptions: 0 }
  const soGol = sessionTotals({ ...base, goals: 1, shots: 0, shotsOnTarget: 0 })
  assert.equal(soGol.adjusted, false)
  assert.equal(soGol.totals.goals, 1)
  assert.equal(soGol.totals.shotsOnTarget, 1)
  assert.equal(soGol.totals.shots, 1)
  assert.deepEqual(soGol.warnings, [])
  const misto = sessionTotals({ ...base, goals: 1, shots: 3, shotsOnTarget: 2 })
  assert.equal(misto.totals.shots, 6)
  assert.equal(misto.totals.shotsOnTarget, 3)
  assert.equal(misto.totals.goals, 1)
  const nada = sessionTotals({ ...base, goals: 0, shots: 0, shotsOnTarget: 0 })
  assert.equal(nada.totals.shots, 0)
})

test('taxa com registro incoerente fica sem valor, sem passar de 100%', async () => {
  const { gameRates } = await import('./metrics.ts')
  const rates = gameRates({ goals: 1, assists: 0, shots: 0, shotsOnTarget: 2, accuratePasses: 0, wrongPasses: 0, passTotal: 0, tackles: 0, possessionLoss: 0, foulsCommitted: 0, foulsSuffered: 0, interceptions: 0 } as never)
  const accuracy = rates.find((r) => r.key === 'shotAccuracy')!
  assert.equal(accuracy.value, null)
  assert.equal(accuracy.inconsistent, true)
})

test('posição → setor (lista nova e texto antigo)', async () => {
  const { positionCodes, primaryPosition, sectorOf, groupOf, positionsText } = await import('./match.ts')
  assert.equal(primaryPosition('Goleiro'), 'GOL')
  assert.equal(primaryPosition('Zagueiro, Lateral direito'), 'ZAG')
  assert.deepEqual(positionCodes('Zagueiro, Lateral direito'), ['ZAG', 'LD'])
  assert.equal(primaryPosition('lateral esq.'), 'LE')
  assert.equal(primaryPosition('Centroavante'), 'ATA')
  assert.equal(primaryPosition('Ponta esquerda'), 'PE')
  assert.equal(primaryPosition('Meia ofensivo'), 'MEI')
  assert.equal(primaryPosition('Meia'), 'MC')
  assert.equal(primaryPosition('Volante'), 'VOL')
  assert.equal(primaryPosition('Massagista'), null)
  for (const [code, sector] of [['GOL', 'DEF'], ['LD', 'DEF'], ['ZAG', 'DEF'], ['LE', 'DEF'], ['VOL', 'MEI'], ['MC', 'MEI'], ['MD', 'MEI'], ['ME', 'MEI'], ['MEI', 'MEI'], ['PD', 'ATA'], ['PE', 'ATA'], ['ATA', 'ATA']] as const) {
    assert.equal(sectorOf(code), sector)
  }
  assert.equal(groupOf('Massagista'), 'Sem posição')
  assert.equal(groupOf('Goleiro'), 'Goleiro')
  assert.equal(positionsText('ZAG', 'LD'), 'Zagueiro, Lateral direito')
  assert.equal(positionsText('ZAG', ''), 'Zagueiro')
})

test('ordem tática: GOL → LD → ZAG → LE → VOL → MC → MD → ME → MEI → PD → PE → ATA → sem posição', async () => {
  const { byTacticalOrder } = await import('./match.ts')
  const list = [
    { name: 'Atacante 9', positions: 'Atacante', number: '9' }, { name: 'Sem', positions: '', number: '1' },
    { name: 'Zag 4', positions: 'Zagueiro', number: '4' }, { name: 'Zag 3', positions: 'Zagueiro', number: '3' },
    { name: 'LE', positions: 'Lateral esquerdo', number: '6' }, { name: 'Gol', positions: 'Goleiro', number: '12' },
    { name: 'PE', positions: 'Ponta esquerda', number: '11' }, { name: 'MEI', positions: 'Meia ofensivo', number: '10' },
    { name: 'VOL', positions: 'Volante', number: '5' }, { name: 'LD', positions: 'Lateral direito', number: '2' },
    { name: 'MC', positions: 'Meia central', number: '8' }, { name: 'PD', positions: 'Ponta direita', number: '7' },
  ]
  assert.deepEqual([...list].sort(byTacticalOrder).map((a) => a.name), ['Gol', 'LD', 'Zag 3', 'Zag 4', 'LE', 'VOL', 'MC', 'MEI', 'PD', 'PE', 'Atacante 9', 'Sem'])
})

/* ---------- Fase 4: minutos com substituição, expulsão e prorrogação ---------- */
import type { MatchEvent } from './match.ts'
const evt = (id: string, kind: string, athleteId: string | null, period: 1 | 2 | 3 | 4, minute: number, n = 0): MatchEvent => ({
  id, kind: kind as MatchEvent['kind'], athleteId, period, clockSeconds: Math.round(minute * 60), createdBy: 'u', createdByName: '', createdAt: `2026-01-01T00:00:${String(n).padStart(2, '0')}Z`, deletedAt: null,
})
const lineupOf = (ids: string[], starters: string[]) => ids.map((athleteId) => ({ athleteId, starter: starters.includes(athleteId) }))
const full = (end1: number, end2: number) => [evt('s1', 'period_start', null, 1, 0), evt('e1', 'period_end', null, 1, end1), evt('s2', 'period_start', null, 2, 0), evt('e2', 'period_end', null, 2, end2)]

test('minutos: entra aos 60 e sai aos 75 = 15; reserva expulso aos 80 após entrar aos 70 = 10; quem não entrou = 0', () => {
  const events = [...full(45, 45), evt('a', 'sub_in', 'R', 2, 15, 1), evt('b', 'sub_out', 'R', 2, 30, 2), evt('c', 'sub_in', 'S', 2, 25, 3), evt('d', 'cartao_vermelho', 'S', 2, 35, 4)]
  const m = minutesPlayed(lineupOf(['R', 'S', 'N'], []), events)
  assert.equal((m.get('R') as number) / 60, 15)
  assert.equal((m.get('S') as number) / 60, 10)
  assert.equal(m.get('N'), 0)
})

test('minutos: titular expulso aos 30 = 30; 2x25 = 50; 47 + 45 = 92', () => {
  assert.equal((minutesPlayed(lineupOf(['T'], ['T']), [...full(45, 45), evt('r', 'cartao_vermelho', 'T', 1, 30, 1)]).get('T') as number) / 60, 30)
  assert.equal((minutesPlayed(lineupOf(['T'], ['T']), full(25, 25)).get('T') as number) / 60, 50)
  assert.equal((minutesPlayed(lineupOf(['T'], ['T']), full(47, 45)).get('T') as number) / 60, 92)
})

test('minutos: soma do lado = duração × jogadores em campo − minutos perdidos por expulsão (90 min, 1 expulsão aos 30)', () => {
  const ids = Array.from({ length: 11 }, (_, i) => `J${i}`)
  const m = minutesPlayed(lineupOf(ids, ids), [...full(45, 45), evt('r', 'cartao_vermelho_2o_amarelo', 'J3', 1, 30, 1)])
  const total = [...m.values()].reduce((a, b) => a + b, 0) / 60
  assert.equal(total, 11 * 90 - 60)
})

test('minutos: expulso não volta por uma entrada atrasada; prorrogação soma depois dos 90', () => {
  const events = [...full(45, 45), evt('r', 'cartao_vermelho', 'T', 1, 20, 1), evt('x', 'sub_in', 'T', 2, 10, 2), evt('p3', 'period_start', null, 3, 0), evt('p3e', 'period_end', null, 3, 15)]
  assert.equal((minutesPlayed(lineupOf(['T', 'U'], ['T', 'U']), events).get('T') as number) / 60, 20)
  assert.equal((minutesPlayed(lineupOf(['U'], ['U']), events).get('U') as number) / 60, 105)
})
