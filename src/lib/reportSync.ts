import { supabase } from './supabase'
import type { ReportContent } from './report.ts'

export type Responsavel = { id: string; nome: string }
export type Emission = { id: string; hash: string; token: string | null; expiraEm: string | null; aviso: string | null }
export type EmissionRow = { id: string; canal: string; emitidoEm: string; responsavelId: string | null; revogadoEm: string | null; expiraEm: string | null; acessos: number; aviso: string | null; temLink: boolean }

const need = () => { if (!supabase) throw new Error('Sem conexão com o servidor.'); return supabase }

/** Jogos cuja política do clube não aparece para a família (jogo-treino por padrão). Só existem para clubes com a partida espelhada. */
export async function fetchHiddenMatchIds(teamId: string): Promise<Set<string>> {
  if (!supabase) return new Set()
  const pol = await supabase.from('politica_contagem').select('tipo_partida_codigo').eq('clube_id', teamId).eq('visivel_familia', false)
  const tipos = (pol.data ?? []).map((r) => r.tipo_partida_codigo as string)
  if (pol.error || tipos.length === 0) return new Set()
  const { data } = await supabase.from('partida').select('id_legado').eq('clube_id', teamId).in('tipo_partida_codigo', tipos).not('id_legado', 'is', null)
  return new Set((data ?? []).map((r) => r.id_legado as string))
}

export async function fetchResponsaveis(teamId: string, athleteId: string): Promise<Responsavel[]> {
  if (!supabase) return []
  const today = new Date().toISOString().slice(0, 10)
  const { data } = await supabase.from('responsavel_atleta').select('responsavel_id, vigencia_fim, responsavel:responsavel_id(id, nome, deleted_at)').eq('clube_id', teamId).eq('atleta_id', athleteId)
  const rows = (data ?? []) as unknown as Array<{ vigencia_fim: string | null; responsavel: { id: string; nome: string; deleted_at: string | null } | null }>
  return rows.filter((r) => r.responsavel && !r.responsavel.deleted_at && (!r.vigencia_fim || r.vigencia_fim >= today)).map((r) => ({ id: (r.responsavel as { id: string }).id, nome: (r.responsavel as { nome: string }).nome }))
}

export async function emitReport(input: { teamId: string; athleteId: string; responsavelId: string | null; canal: 'pdf' | 'imagem' | 'link' | 'texto' | 'whatsapp' | 'impressao'; content: ReportContent; withLink: boolean }): Promise<Emission> {
  const { data, error } = await need().rpc('emitir_relatorio', { p_clube: input.teamId, p_atleta: input.athleteId, p_responsavel: input.responsavelId, p_canal: input.canal, p_conteudo: input.content, p_com_link: input.withLink })
  if (error) throw new Error(error.message)
  const row = (Array.isArray(data) ? data[0] : data) as { id: string; hash: string; token: string | null; expira_em: string | null; aviso: string | null }
  return { id: row.id, hash: row.hash, token: row.token, expiraEm: row.expira_em, aviso: row.aviso }
}

export async function revokeReport(id: string): Promise<void> {
  const { error } = await need().rpc('revogar_relatorio', { p_id: id })
  if (error) throw new Error(error.message)
}

export async function fetchEmissions(teamId: string, athleteId: string): Promise<EmissionRow[]> {
  if (!supabase) return []
  const { data } = await supabase.from('relatorio_emissao').select('id, canal, emitido_em, responsavel_id, revogado_em, expira_em, acessos, aviso, token_hash').eq('clube_id', teamId).eq('atleta_id', athleteId).order('emitido_em', { ascending: false }).limit(20)
  return (data ?? []).map((r) => ({ id: r.id as string, canal: r.canal as string, emitidoEm: r.emitido_em as string, responsavelId: (r.responsavel_id as string | null) ?? null, revogadoEm: (r.revogado_em as string | null) ?? null, expiraEm: (r.expira_em as string | null) ?? null, acessos: Number(r.acessos ?? 0), aviso: (r.aviso as string | null) ?? null, temLink: Boolean(r.token_hash) }))
}

export async function fetchPublicReport(token: string): Promise<{ conteudo: ReportContent; emitidoEm: string; expiraEm: string } | null> {
  if (!supabase) return null
  const { data, error } = await supabase.rpc('relatorio_publico', { p_token: token })
  if (error || !data) return null
  const d = data as { conteudo: ReportContent; emitido_em: string; expira_em: string }
  return { conteudo: d.conteudo, emitidoEm: d.emitido_em, expiraEm: d.expira_em }
}
