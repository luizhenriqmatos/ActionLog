import type { Athlete, Evaluation, SessionRecord } from '../types'
import { CRITERIA, GROUPS, TREND_LABEL, formatScore, groupAverage, trend } from './evaluations.ts'
import { finishingRates, formatPct, gameRates, sumFinishing, sumGame } from './metrics.ts'

/** Conteúdo congelado de um relatório entregue. Só dados do próprio atleta: é isto que vai para o log e para o link. */
export type ReportContent = {
  versao: 1
  clube: string
  atleta: { nome: string; categoria: string; posicoes: string }
  periodo: string
  emitidoEm: string
  treinador: string
  avaliacao: null | {
    rotulo: string
    comparadoCom: string | null
    grupos: Array<{ grupo: string; nota: number; notaTexto: string; tendencia: string | null }>
    criterios: string
    fortes: string
    melhorias: string
    metas: string
  }
  emCampo: string[]
  mensagem: string
}

export type ReportInput = {
  athlete: Athlete
  category: string
  clubName: string
  coachName: string
  evaluation: Evaluation | null
  previous: Evaluation | null
  sessions: SessionRecord[]
  /** ids de partida (match_id) que a política do clube esconde da família, como jogo-treino. */
  hiddenMatchIds: ReadonlySet<string>
  periodText: string
  today: string
  message: string
}

const br = (iso: string) => iso.split('-').reverse().join('/')

export function buildReportContent(i: ReportInput): ReportContent {
  const mine = i.sessions.filter((s) => s.athleteId === i.athlete.id && !(s.matchId && i.hiddenMatchIds.has(s.matchId)))
  const g = sumGame(mine.filter((s) => s.mode === 'game'))
  const f = sumFinishing(mine.filter((s) => s.mode === 'finishing'))
  const [, , passRate] = gameRates(g)
  const fr = finishingRates(f, i.athlete.dominantFoot === 'Ambidestro')
  const ambi = i.athlete.dominantFoot === 'Ambidestro'
  const emCampo: string[] = []
  if (g.sessions > 0) {
    emCampo.push(`Participou de ${g.sessions} jogo${g.sessions > 1 ? 's' : ''} acompanhado${g.sessions > 1 ? 's' : ''} pela comissão: ${g.goals} gol${g.goals === 1 ? '' : 's'} e ${g.assists} assistência${g.assists === 1 ? '' : 's'}.`)
    if (g.passTotal > 0) emCampo.push(`Acertou ${formatPct(passRate.value)} dos passes (${g.accuratePasses} de ${g.passTotal}).`)
    if (g.tackles > 0) emCampo.push(`Recuperou a bola ${g.tackles} vez${g.tackles > 1 ? 'es' : ''} com desarmes.`)
  }
  if (f.sessions > 0 && f.shots > 0) {
    emCampo.push(`Nos treinos de finalização, fez ${f.goals} gol${f.goals === 1 ? '' : 's'} em ${f.shots} chutes (${formatPct(fr[1].value)} de aproveitamento).`)
    if (!ambi && f.dominant.shots > 0 && f.nonDominant.shots > 0) emCampo.push(`Com a perna dominante converteu ${formatPct(fr[2].value)}; com a outra perna, ${formatPct(fr[3].value)}.`)
    if (ambi && f.right.shots > 0 && f.left.shots > 0) emCampo.push(`Com a perna direita converteu ${formatPct(fr[2].value)}; com a esquerda, ${formatPct(fr[3].value)}.`)
  }
  const ev = i.evaluation
  const grupos = ev ? GROUPS.map((gr) => {
    const now = groupAverage(ev, gr)
    const t = trend(now, i.previous ? groupAverage(i.previous, gr) : null)
    return now == null ? null : { grupo: gr, nota: now, notaTexto: formatScore(now), tendencia: t ? TREND_LABEL[t] : null }
  }).filter((x): x is NonNullable<typeof x> => x !== null) : []
  return {
    versao: 1,
    clube: i.clubName || 'ScoutHouse',
    atleta: { nome: i.athlete.name, categoria: i.category, posicoes: i.athlete.positions ?? '' },
    periodo: ev?.period || i.periodText,
    emitidoEm: i.today,
    treinador: i.coachName,
    avaliacao: ev ? {
      rotulo: ev.period || `Avaliação de ${br(ev.date)}`,
      comparadoCom: i.previous ? br(i.previous.date) : null,
      grupos,
      criterios: CRITERIA.filter((c) => ev.scores[c.key]).map((c) => `${c.label}: ${ev.scores[c.key]}`).join(' · '),
      fortes: ev.strengths, melhorias: ev.improvements, metas: ev.goals,
    } : null,
    emCampo,
    mensagem: i.message.trim(),
  }
}

const norm = (text: string) => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Textos livres do treinador que citam outro atleta do elenco pelo nome (nome completo ou primeiro nome com 4+ letras). */
export function otherAthletesMentioned(texts: string[], athlete: Pick<Athlete, 'id' | 'name'>, roster: Array<Pick<Athlete, 'id' | 'name'>>): string[] {
  const haystack = ` ${norm(texts.join(' \n '))} `
  const mine = new Set(norm(athlete.name).split(/\s+/))
  const found: string[] = []
  for (const other of roster) {
    if (other.id === athlete.id) continue
    const full = norm(other.name).trim()
    const first = full.split(/\s+/)[0] ?? ''
    const hitFull = full.length >= 4 && haystack.includes(full)
    const hitFirst = first.length >= 4 && !mine.has(first) && new RegExp(`[^a-z]${first}[^a-z]`).test(haystack)
    if (hitFull || hitFirst) found.push(other.name)
  }
  return found
}

/** Texto para copiar/colar: o mesmo conteúdo que vai para o log. */
export function reportPlainText(c: ReportContent): string {
  const lines = [`${c.clube} · Relatório de desenvolvimento`, `Atleta: ${c.atleta.nome} (${c.atleta.categoria})`, `Período: ${c.periodo}`]
  if (c.treinador) lines.push(`Treinador: ${c.treinador}`)
  if (c.avaliacao) {
    lines.push('', 'Avaliação do treinador')
    c.avaliacao.grupos.forEach((r) => lines.push(`${r.grupo}: ${r.notaTexto}${r.tendencia ? ` (${r.tendencia})` : ''}`))
    if (c.avaliacao.fortes) lines.push('', `Pontos fortes: ${c.avaliacao.fortes}`)
    if (c.avaliacao.melhorias) lines.push(`Estamos trabalhando: ${c.avaliacao.melhorias}`)
    if (c.avaliacao.metas) lines.push(`Metas: ${c.avaliacao.metas}`)
  }
  if (c.emCampo.length) lines.push('', 'Em campo', ...c.emCampo)
  if (c.mensagem) lines.push('', `Mensagem do treinador: ${c.mensagem}`)
  return lines.join('\n')
}
