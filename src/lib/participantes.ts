/**
 * Números de equipe por participante (espelho em TS de public.partida_agregado).
 * "Contra" de um lado = "a favor" do outro. Só eventos ativos e confirmados.
 */
export type LadosRegistrados = 'um' | 'dois'
export type EventoParticipante = {
  kind: string
  participanteId: string | null
  status?: string | null
  deletedAt?: string | null
  /** ts_servidor em ISO; usado só com `ate`. */
  tsServidor?: string | null
}
export type Metricas = {
  gols_pro: number; gols_contra: number; escanteios_pro: number; escanteios_contra: number
  assistencias: number; finalizacoes_fora: number; finalizacoes_no_alvo: number
  passes_certos: number; passes_errados: number; desarmes: number; interceptacoes: number
  perdas_de_posse: number; faltas_cometidas: number; faltas_sofridas: number
  cartoes_amarelos: number; cartoes_vermelhos: number; impedimentos: number
}

const DIRETOS: Array<[keyof Metricas, string[]]> = [
  ['assistencias', ['assist']], ['finalizacoes_fora', ['shot']], ['finalizacoes_no_alvo', ['shot_on_target']],
  ['passes_certos', ['pass_ok']], ['passes_errados', ['pass_bad']], ['desarmes', ['tackle']],
  ['interceptacoes', ['interception']], ['perdas_de_posse', ['possession_loss']],
  ['faltas_cometidas', ['foul_committed']], ['faltas_sofridas', ['foul_suffered']],
  ['cartoes_amarelos', ['cartao_amarelo']], ['cartoes_vermelhos', ['cartao_vermelho', 'cartao_vermelho_2o_amarelo']],
  ['impedimentos', ['impedimento']],
]

export function agregadoPorParticipante(
  eventos: EventoParticipante[],
  participantes: string[],
  lados: LadosRegistrados,
  ate?: string,
): Map<string, Metricas> {
  const limite = ate ? Date.parse(ate) : null
  const vale = (e: EventoParticipante) => {
    if ((e.status ?? 'confirmado') !== 'confirmado' || !e.participanteId) return false
    if (limite === null) return !e.deletedAt
    const ts = e.tsServidor ? Date.parse(e.tsServidor) : NaN
    return ts <= limite && (!e.deletedAt || Date.parse(e.deletedAt) > limite)
  }
  const ativos = eventos.filter(vale)
  const conta = (id: string, kinds: string[]) => ativos.filter((e) => e.participanteId === id && kinds.includes(e.kind)).length
  const pro = new Map<string, { gols: number; esc: number }>()
  for (const id of participantes) {
    const outros = participantes.filter((o) => o !== id)
    const doOutroLado = (kind: string) => (lados === 'um' ? outros.reduce((s, o) => s + conta(o, [kind]), 0) : 0)
    pro.set(id, { gols: conta(id, ['goal']) + doOutroLado('opponent_goal'), esc: conta(id, ['corner_for']) + doOutroLado('corner_against') })
  }
  const out = new Map<string, Metricas>()
  for (const id of participantes) {
    const outros = participantes.filter((o) => o !== id)
    const m = {
      gols_pro: pro.get(id)!.gols,
      gols_contra: outros.reduce((s, o) => s + pro.get(o)!.gols, 0),
      escanteios_pro: pro.get(id)!.esc,
      escanteios_contra: outros.reduce((s, o) => s + pro.get(o)!.esc, 0),
    } as Metricas
    for (const [campo, kinds] of DIRETOS) m[campo] = conta(id, kinds)
    out.set(id, m)
  }
  return out
}
