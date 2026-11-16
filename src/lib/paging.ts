/**
 * Leitura paginada com detecção de truncamento.
 * O PostgREST corta a resposta no teto de linhas do projeto (db.max_rows) SEM erro. Por isso cada página
 * pede também a contagem exata, e o total recebido é conferido contra ela: se faltar linha, é erro, não silêncio.
 */
export type Page<T> = { rows: T[]; total: number | null }

export const PAGE_SIZE = 500

export class TruncatedError extends Error {
  constructor(what: string, got: number, total: number) {
    super(`Resposta incompleta do servidor em ${what}: vieram ${got} de ${total} registros. Nada foi alterado neste aparelho.`)
    this.name = 'TruncatedError'
  }
}

export async function fetchAll<T>(what: string, fetchPage: (from: number, to: number) => Promise<Page<T>>, pageSize = PAGE_SIZE): Promise<T[]> {
  const all: T[] = []
  let total: number | null = null
  // limite de segurança: nunca gira para sempre se o servidor responder algo incoerente
  for (let guard = 0; guard < 10000; guard += 1) {
    const page = await fetchPage(all.length, all.length + pageSize - 1)
    total = page.total
    all.push(...page.rows)
    if (page.rows.length === 0) break
    if (total !== null && all.length >= total) break
    // página menor que o pedido e ainda falta: o servidor tem teto abaixo de pageSize; segue de onde parou
  }
  if (total !== null && all.length < total) throw new TruncatedError(what, all.length, total)
  return all
}
