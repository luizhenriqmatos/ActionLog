export type KV = { getItem(key: string): string | null; setItem(key: string, value: string): void }

/**
 * Migração de chave de armazenamento sem perder o dado do aparelho (o aparelho é réplica, não cache).
 * Lê a chave nova; se ela não existe, lê a primeira chave velha que existir e COPIA para a nova.
 * Nunca apaga nem altera a chave velha: ela segue como cópia de segurança por pelo menos um ciclo de versão.
 * Quem chama escreve só na chave nova.
 */
export function readMigrated(store: KV, newKey: string, oldKeys: string[]): string | null {
  const current = store.getItem(newKey)
  if (current !== null) return current
  for (const oldKey of oldKeys) {
    const old = store.getItem(oldKey)
    if (old !== null) {
      try { store.setItem(newKey, old) } catch { /* sem espaço: o dado continua na chave velha e é lido de novo na próxima vez */ }
      return old
    }
  }
  return null
}
