import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readMigrated, type KV } from './storageKeys.ts'

const memory = (initial: Record<string, string> = {}): KV & { data: Record<string, string> } => {
  const data = { ...initial }
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = v } }
}

test('chave: dado só na chave velha sobrevive, é copiado para a nova e a velha fica intacta', () => {
  const s = memory({ actionlog_hub_state_v1: '{"atletas":[1,2,3]}' })
  assert.equal(readMigrated(s, 'scouthouse_hub_state_v1', ['actionlog_hub_state_v1']), '{"atletas":[1,2,3]}')
  assert.equal(s.data.scouthouse_hub_state_v1, '{"atletas":[1,2,3]}')
  assert.equal(s.data.actionlog_hub_state_v1, '{"atletas":[1,2,3]}')
})

test('chave: com as duas, a nova vence e a velha não é lida nem alterada', () => {
  const s = memory({ actionlog_sync_v1: 'velho', scouthouse_sync_v1: 'novo' })
  assert.equal(readMigrated(s, 'scouthouse_sync_v1', ['actionlog_sync_v1']), 'novo')
  assert.equal(s.data.actionlog_sync_v1, 'velho')
})

test('chave: sem nenhuma, devolve null e não cria nada', () => {
  const s = memory()
  assert.equal(readMigrated(s, 'scouthouse_x', ['actionlog_x']), null)
  assert.deepEqual(s.data, {})
})

test('chave: falha ao gravar a nova (armazenamento cheio) ainda devolve o dado velho', () => {
  const s = memory({ actionlog_x: 'dado' })
  const full: KV = { getItem: s.getItem, setItem: () => { throw new Error('QuotaExceededError') } }
  assert.equal(readMigrated(full, 'scouthouse_x', ['actionlog_x']), 'dado')
})

test('chave: valor vazio na chave nova ("") conta como existente e não é substituído', () => {
  const s = memory({ actionlog_x: 'velho', scouthouse_x: '' })
  assert.equal(readMigrated(s, 'scouthouse_x', ['actionlog_x']), '')
})
