import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveTheme } from './theme.ts'

test('tema: preferência salva vence; sem ela vale o aparelho; sem nada, escuro', () => {
  assert.equal(resolveTheme('light', false), 'light')
  assert.equal(resolveTheme('dark', true), 'dark')
  assert.equal(resolveTheme(null, true), 'light')
  assert.equal(resolveTheme(null, false), 'dark')
  assert.equal(resolveTheme(null, null), 'dark')
  assert.equal(resolveTheme('lixo', true), 'light')
})
