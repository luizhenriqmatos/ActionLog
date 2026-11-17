import test from 'node:test'
import assert from 'node:assert/strict'
import { agregadoPorParticipante, type EventoParticipante } from './participantes.ts'

const A = 'pa', B = 'pb'
const ev = (kind: string, participanteId: string, extra: Partial<EventoParticipante> = {}): EventoParticipante => ({ kind, participanteId, ...extra })

test('lado único: contra de um é o a favor do outro', () => {
  const m = agregadoPorParticipante([ev('goal', A), ev('opponent_goal', A), ev('opponent_goal', A), ev('corner_against', A), ev('corner_for', A)], [A, B], 'um')
  assert.deepEqual([m.get(A)!.gols_pro, m.get(A)!.gols_contra, m.get(A)!.escanteios_pro, m.get(A)!.escanteios_contra], [1, 2, 1, 1])
  assert.deepEqual([m.get(B)!.gols_pro, m.get(B)!.gols_contra, m.get(B)!.escanteios_pro, m.get(B)!.escanteios_contra], [2, 1, 1, 1])
})

test('dois lados: opponent_* ignorados, sem contagem dupla', () => {
  const m = agregadoPorParticipante([ev('goal', A), ev('goal', B), ev('opponent_goal', A)], [A, B], 'dois')
  assert.deepEqual([m.get(A)!.gols_pro, m.get(A)!.gols_contra, m.get(B)!.gols_pro, m.get(B)!.gols_contra], [1, 1, 1, 1])
})

test('anulado, em revisão e duplicata suspeita não contam', () => {
  const m = agregadoPorParticipante([ev('goal', A, { deletedAt: '2026-01-01T00:00:00Z' }), ev('goal', A, { status: 'revisao' }), ev('goal', A, { status: 'duplicata_suspeita' }), ev('goal', A)], [A, B], 'um')
  assert.equal(m.get(A)!.gols_pro, 1)
})

test('vermelho direto e do 2º amarelo contam como vermelho; amarelo separado', () => {
  const m = agregadoPorParticipante([ev('cartao_vermelho', A), ev('cartao_vermelho_2o_amarelo', A), ev('cartao_amarelo', A)], [A, B], 'um')
  assert.deepEqual([m.get(A)!.cartoes_vermelhos, m.get(A)!.cartoes_amarelos], [2, 1])
})

test('reprodutibilidade: recalcular até o fechamento ignora tardio e anulação posterior', () => {
  const fecha = '2026-01-01T12:00:00Z'
  const eventos = [
    ev('goal', A, { tsServidor: '2026-01-01T11:00:00Z' }),
    ev('opponent_goal', A, { tsServidor: '2026-01-01T11:10:00Z', deletedAt: '2026-01-01T13:00:00Z' }), // anulado depois
    ev('goal', A, { tsServidor: '2026-01-01T12:30:00Z' }), // tardio
  ]
  const congelado = agregadoPorParticipante(eventos, [A, B], 'um', fecha)
  assert.deepEqual([congelado.get(A)!.gols_pro, congelado.get(A)!.gols_contra], [1, 1])
  const vivo = agregadoPorParticipante(eventos, [A, B], 'um')
  assert.deepEqual([vivo.get(A)!.gols_pro, vivo.get(A)!.gols_contra], [2, 0])
})
