import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveTheme } from './theme.ts'

test('tema: preferência salva vence; sem ela, claro (padrão do design)', () => {
  // O salvo manda, inclusive quando contraria o aparelho e o padrão novo.
  assert.equal(resolveTheme('light', false), 'light')
  assert.equal(resolveTheme('dark', true), 'dark')
  assert.equal(resolveTheme('dark', null), 'dark')
  // Sem preferência salva: claro, independentemente do aparelho.
  assert.equal(resolveTheme(null, true), 'light')
  assert.equal(resolveTheme(null, false), 'light')
  assert.equal(resolveTheme(null, null), 'light')
  // Valor estragado no armazenamento não conta como preferência.
  assert.equal(resolveTheme('lixo', true), 'light')
})
