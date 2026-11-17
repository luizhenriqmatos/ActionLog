/**
 * Trava de versão mínima do cliente (Fase 3.5).
 * Sem ela, um aparelho desatualizado reintroduz o formato antigo durante a dupla escrita ou depois de um rollback.
 * APP_BUILD sobe a mão quando uma mudança de formato exige que todos os aparelhos atualizem;
 * o servidor guarda o mínimo aceito em app_config.build_minimo. Só protege versões que já têm esta trava.
 */
export const APP_BUILD = 1

export const isOutdated = (minBuild: number | null | undefined, build: number = APP_BUILD) =>
  typeof minBuild === 'number' && Number.isFinite(minBuild) && build < minBuild

type Reader = { from: (table: string) => { select: (cols: string) => { eq: (col: string, value: string) => { maybeSingle: () => PromiseLike<{ data: { valor: number } | null; error: unknown }> } } } }

/** Lê o build mínimo. Falha de rede = null (não trava ninguém por causa de internet ruim). */
export async function fetchMinBuild(client: unknown): Promise<number | null> {
  try {
    const { data, error } = await (client as Reader).from('app_config').select('valor').eq('chave', 'build_minimo').maybeSingle()
    return error || !data ? null : Number(data.valor)
  } catch { return null }
}
