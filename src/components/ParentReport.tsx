import { useMemo, useState } from 'react'
import { Check, Copy, MessageCircle, Printer, X } from 'lucide-react'
import type { Athlete, Evaluation, SessionRecord } from '../types'
import { CRITERIA, GROUPS, SCORE_LABEL, TREND_LABEL, forAthlete, formatScore, groupAverage, overall, previousOf, trend } from '../lib/evaluations'
import { addDaysIso, finishingRates, formatPct, gameRates, sumFinishing, sumGame } from '../lib/metrics'

type Props = {
  athlete: Athlete
  category: string
  clubName: string
  coachName: string
  sessions: SessionRecord[]
  evaluations: Evaluation[]
  today: string
  onClose: () => void
}

type PeriodKey = 'since-eval' | '30' | '90' | 'all'

const stars = (value: number | null) => {
  if (value == null) return '—'
  const full = Math.round(value)
  return '★'.repeat(full) + '☆'.repeat(5 - full)
}
const br = (iso: string) => iso.split('-').reverse().join('/')

/** Relatório para os responsáveis: linguagem simples, pronto para imprimir, salvar em PDF ou mandar no WhatsApp. */
export function ParentReport({ athlete, category, clubName, coachName, sessions, evaluations, today, onClose }: Props) {
  const evals = forAthlete(evaluations, athlete.id)
  const [evalId, setEvalId] = useState(evals[evals.length - 1]?.id ?? '')
  const evaluation = evals.find((e) => e.id === evalId) ?? null
  const previous = evaluation ? previousOf(evaluations, evaluation) : null
  const [periodKey, setPeriodKey] = useState<PeriodKey>(previous ? 'since-eval' : '90')
  const [message, setMessage] = useState(evaluation?.coachNote ?? '')
  const [copied, setCopied] = useState(false)

  const range = useMemo(() => {
    if (periodKey === 'since-eval' && previous) return { from: addDaysIso(previous.date, 1), to: evaluation?.date ?? today }
    if (periodKey === '30') return { from: addDaysIso(today, -29), to: today }
    if (periodKey === 'all') return { from: '0000-01-01', to: '9999-12-31' }
    return { from: addDaysIso(today, -89), to: today }
  }, [periodKey, previous?.date, evaluation?.date, today])

  const mine = sessions.filter((s) => s.athleteId === athlete.id && s.calendarDate >= range.from && s.calendarDate <= range.to)
  const g = sumGame(mine.filter((s) => s.mode === 'game'))
  const f = sumFinishing(mine.filter((s) => s.mode === 'finishing'))
  const [, , passRate] = gameRates(g)
  const fr = finishingRates(f, athlete.dominantFoot === 'Ambidestro')
  const ambi = athlete.dominantFoot === 'Ambidestro'
  const periodText = range.from === '0000-01-01' ? 'Todo o histórico' : `${br(range.from)} a ${br(range.to)}`

  const onField: string[] = []
  if (g.sessions > 0) {
    onField.push(`Participou de ${g.sessions} jogo${g.sessions > 1 ? 's' : ''} acompanhado${g.sessions > 1 ? 's' : ''} pela comissão: ${g.goals} gol${g.goals === 1 ? '' : 's'} e ${g.assists} assistência${g.assists === 1 ? '' : 's'}.`)
    if (g.passTotal > 0) onField.push(`Acertou ${formatPct(passRate.value)} dos passes (${g.accuratePasses} de ${g.passTotal}).`)
    if (g.tackles > 0) onField.push(`Recuperou a bola ${g.tackles} vez${g.tackles > 1 ? 'es' : ''} com desarmes.`)
  }
  if (f.sessions > 0 && f.shots > 0) {
    onField.push(`Nos treinos de finalização, fez ${f.goals} gol${f.goals === 1 ? '' : 's'} em ${f.shots} chutes (${formatPct(fr[1].value)} de aproveitamento).`)
    if (!ambi && f.dominant.shots > 0 && f.nonDominant.shots > 0) onField.push(`Com a perna dominante converteu ${formatPct(fr[2].value)}; com a outra perna, ${formatPct(fr[3].value)}.`)
    if (ambi && f.right.shots > 0 && f.left.shots > 0) onField.push(`Com a perna direita converteu ${formatPct(fr[2].value)}; com a esquerda, ${formatPct(fr[3].value)}.`)
  }

  const groupRows = evaluation ? GROUPS.map((gr) => {
    const now = groupAverage(evaluation, gr)
    const before = previous ? groupAverage(previous, gr) : null
    return { group: gr, now, before, t: trend(now, before) }
  }).filter((r) => r.now != null) : []

  function plainText() {
    const lines = [`*${clubName || 'ActionLog'} · Relatório de desenvolvimento*`, `Atleta: ${athlete.name} (${category})`, `Período: ${evaluation?.period || periodText}`]
    if (coachName) lines.push(`Treinador: ${coachName}`)
    if (evaluation) {
      lines.push('', '*Avaliação do treinador*')
      groupRows.forEach((r) => lines.push(`${r.group}: ${stars(r.now)} ${formatScore(r.now)}${r.t ? ` (${TREND_LABEL[r.t]})` : ''}`))
      if (evaluation.strengths) lines.push('', `*Pontos fortes:* ${evaluation.strengths}`)
      if (evaluation.improvements) lines.push(`*Estamos trabalhando:* ${evaluation.improvements}`)
      if (evaluation.goals) lines.push(`*Metas:* ${evaluation.goals}`)
    }
    if (onField.length) lines.push('', '*Em campo*', ...onField)
    if (message.trim()) lines.push('', `*Mensagem do treinador:* ${message.trim()}`)
    return lines.join('\n')
  }

  async function copy() {
    try { await navigator.clipboard.writeText(plainText().replace(/\*/g, '')); setCopied(true); window.setTimeout(() => setCopied(false), 2000) } catch { /* ignora */ }
  }

  function print() {
    document.body.classList.add('printing-report')
    const done = () => { document.body.classList.remove('printing-report'); window.removeEventListener('afterprint', done) }
    window.addEventListener('afterprint', done)
    window.print()
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="report-modal parent-modal" role="dialog" aria-modal="true" aria-labelledby="parent-title">
        <div className="modal-top no-print">
          <span className="status-pill"><i /> relatório para os pais</span>
          <button className="icon-button" onClick={onClose} type="button" aria-label="Fechar relatório"><X size={18} /></button>
        </div>

        <div className="parent-controls no-print">
          <label htmlFor="pr-eval">Avaliação usada
            <select id="pr-eval" value={evalId} onChange={(e) => { setEvalId(e.target.value); const next = evals.find((x) => x.id === e.target.value); setMessage(next?.coachNote ?? '') }}>
              {evals.length === 0 && <option value="">Nenhuma avaliação ainda</option>}
              {[...evals].reverse().map((e) => <option key={e.id} value={e.id}>{br(e.date)} · {e.period || 'avaliação'} · média {formatScore(overall(e))}</option>)}
            </select>
          </label>
          <label htmlFor="pr-period">Números de campo
            <select id="pr-period" value={periodKey} onChange={(e) => setPeriodKey(e.target.value as PeriodKey)}>
              {previous && <option value="since-eval">Desde a avaliação anterior</option>}
              <option value="30">Últimos 30 dias</option>
              <option value="90">Últimos 90 dias</option>
              <option value="all">Todo o histórico</option>
            </select>
          </label>
          <label htmlFor="pr-msg" className="wide">Mensagem do treinador
            <textarea id="pr-msg" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Ex.: Parabéns pela dedicação neste mês. Seguimos trabalhando a finalização com a perna esquerda." />
          </label>
        </div>

        <article className="report-sheet" aria-label="Prévia do relatório">
          <header className="sheet-head">
            <div><span className="sheet-club">{clubName || 'ActionLog'}</span><h2 id="parent-title">Relatório de desenvolvimento</h2></div>
            <span className="sheet-date">{br(today)}</span>
          </header>
          <dl className="sheet-facts">
            <div><dt>Atleta</dt><dd>{athlete.name}</dd></div>
            <div><dt>Categoria</dt><dd>{category}{athlete.positions ? ` · ${athlete.positions}` : ''}</dd></div>
            <div><dt>Período</dt><dd>{evaluation?.period || periodText}</dd></div>
            {coachName && <div><dt>Treinador</dt><dd>{coachName}</dd></div>}
          </dl>

          {evaluation ? (
            <section>
              <h3>Avaliação do treinador</h3>
              <p className="sheet-hint">Notas de 1 a 5: 1 {SCORE_LABEL[1].toLowerCase()}, 3 {SCORE_LABEL[3].toLowerCase()}, 5 {SCORE_LABEL[5].toLowerCase()}.{previous ? ` Comparação com a avaliação de ${br(previous.date)}.` : ''}</p>
              <table className="sheet-table">
                <tbody>{groupRows.map((r) => (
                  <tr key={r.group}><th>{r.group}</th><td className="sheet-stars">{stars(r.now)}</td><td>{formatScore(r.now)}</td><td className={r.t ? `trend-${r.t}` : ''}>{r.t ? TREND_LABEL[r.t] : ''}</td></tr>
                ))}</tbody>
              </table>
              <p className="sheet-criteria">{CRITERIA.filter((c) => evaluation.scores[c.key]).map((c) => `${c.label}: ${evaluation.scores[c.key]}`).join(' · ')}</p>
              {(evaluation.strengths || evaluation.improvements || evaluation.goals) && (
                <div className="sheet-notes">
                  {evaluation.strengths && <div><h4>Pontos fortes</h4><p>{evaluation.strengths}</p></div>}
                  {evaluation.improvements && <div><h4>O que estamos trabalhando</h4><p>{evaluation.improvements}</p></div>}
                  {evaluation.goals && <div><h4>Metas para o próximo período</h4><p>{evaluation.goals}</p></div>}
                </div>
              )}
            </section>
          ) : <section><h3>Avaliação do treinador</h3><p className="sheet-hint">Ainda não há avaliação registrada para este atleta. Faça uma avaliação para o relatório ficar completo.</p></section>}

          {onField.length > 0 && (
            <section>
              <h3>Em campo</h3>
              <ul className="sheet-list">{onField.map((line) => <li key={line}>{line}</li>)}</ul>
            </section>
          )}

          {message.trim() && <section className="sheet-message"><h3>Mensagem do treinador</h3><p>{message.trim()}</p>{coachName && <p className="sheet-sign">{coachName}</p>}</section>}
          <footer className="sheet-foot">Relatório gerado pelo ActionLog</footer>
        </article>

        <div className="modal-actions no-print">
          <button className="secondary-button" onClick={() => void copy()} type="button">{copied ? <Check size={15} /> : <Copy size={15} />} {copied ? 'Copiado' : 'Copiar texto'}</button>
          <a className="secondary-button" href={`https://wa.me/?text=${encodeURIComponent(plainText())}`} target="_blank" rel="noreferrer"><MessageCircle size={15} /> WhatsApp</a>
          <button className="primary-button" onClick={print} type="button"><Printer size={15} /> Imprimir ou salvar PDF</button>
        </div>
      </div>
    </div>
  )
}
