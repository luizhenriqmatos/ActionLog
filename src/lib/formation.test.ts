import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FORMATIONS, assignToSlot, changeFormation, formationById, isKnownSlot, placeLoose, removeFromSlots, slotPosition, slotSector, suggestAssignment } from './formation.ts'

test('toda formação tem 11 lugares, 1 goleiro e ids únicos dentro do campo', () => {
  for (const f of FORMATIONS) {
    assert.equal(f.slots.length, 11, f.id)
    assert.equal(f.slots.filter((s) => s.code === 'GOL').length, 1, f.id)
    assert.equal(new Set(f.slots.map((s) => s.id)).size, 11, f.id)
    for (const s of f.slots) { assert.ok(s.x >= 0 && s.x <= 100 && s.y >= 0 && s.y <= 100); assert.ok(s.id.startsWith(`${f.id}.`)) }
  }
})

test('lugar -> posição e setor; id desconhecido é recusado', () => {
  assert.equal(slotPosition('433.ZAG2'), 'ZAG')
  assert.equal(slotSector('433.ZAG2'), 'DEF')
  assert.equal(slotSector('433.PE'), 'ATA')
  assert.equal(slotSector('4231.VOL1'), 'MEI')
  assert.equal(isKnownSlot('433.ZAG1'), true)
  assert.equal(isKnownSlot('433.XXX'), false)
  assert.equal(isKnownSlot(null), false)
})

test('colocar atleta: move, troca quando o destino está ocupado e nunca duplica', () => {
  let a = assignToSlot({}, '433.GOL', 'g')
  a = assignToSlot(a, '433.ATA', 'x')
  a = assignToSlot(a, '433.PE', 'x') // x muda de lugar
  assert.deepEqual(a, { '433.GOL': 'g', '433.PE': 'x' })
  a = assignToSlot(a, '433.ATA', 'y')
  a = assignToSlot(a, '433.PE', 'y') // troca: y vai para PE, x vai para ATA
  assert.equal(a['433.PE'], 'y'); assert.equal(a['433.ATA'], 'x')
  assert.equal(new Set(Object.values(a)).size, Object.values(a).length)
  assert.deepEqual(removeFromSlots(a, 'x'), { '433.GOL': 'g', '433.PE': 'y' })
})

test('sugestão usa a posição cadastrada; sem posição fica de fora', () => {
  const athletes = [{ id: '1', positions: 'Goleiro' }, { id: '2', positions: 'Zagueiro' }, { id: '3', positions: 'ZAG' }, { id: '4', positions: '' }, { id: '5', positions: 'Atacante' }]
  const s = suggestAssignment(athletes, '433')
  assert.equal(s['433.GOL'], '1'); assert.equal(s['433.ZAG1'], '2'); assert.equal(s['433.ZAG2'], '3'); assert.equal(s['433.ATA'], '5')
  assert.ok(!Object.values(s).includes('4'))
})

test('trocar de formação mantém quem tem lugar de mesma posição e devolve o resto', () => {
  const { assignment, displaced } = changeFormation({ '433.GOL': 'g', '433.ZAG1': 'a', '433.ZAG2': 'b', '433.PE': 'c', '433.ATA': 'd' }, '442')
  assert.equal(assignment['442.GOL'], 'g'); assert.equal(assignment['442.ZAG1'], 'a'); assert.equal(assignment['442.ZAG2'], 'b')
  assert.equal(assignment['442.ATA1'], 'd') // o código da posição é ATA: d entra no primeiro ATA livre
  assert.deepEqual(displaced.sort(), ['c'])
})

test('titular antigo sem lugar: setor igual primeiro, depois qualquer livre, depois nenhum', () => {
  const a = placeLoose({}, '433', 'x', 'ATA')
  assert.equal(['433.PE', '433.ATA', '433.PD'].includes(Object.keys(a)[0]), true)
  const cheio = Object.fromEntries(formationById('433').slots.map((s) => [s.id, s.id]))
  assert.deepEqual(placeLoose(cheio, '433', 'x', 'DEF'), cheio)
})
