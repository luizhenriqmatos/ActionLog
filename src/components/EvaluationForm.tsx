import { useState } from 'react'
import { X } from 'lucide-react'
import type { Athlete, Evaluation } from '../types'
import { CRITERIA, GROUPS, SCORE_LABEL, formatScore, groupAverage, overall, periodLabel } from '../lib/evaluations'

type Props = {
  athlete: Athlete
  existing?: Evaluation | null
  previous?: Evaluation | null
  evaluator: string
  today: string
  onSave: (evaluation: Evaluation) => void
  onClose: () => void
}

/** Avaliação periódica: nota de 1 a 5 por critério + observações que alimentam o relatório dos pais. */
export function EvaluationForm({ athlete, existing, previous, evaluator, today, onSave, onClose }: Props) {
  const [date, setDate] = useState(existing?.date ?? today)
  const [period, setPeriod] = useState(existing?.period ?? periodLabel(today))
  const [periodTouched, setPeriodTouched] = useState(Boolean(existing))
  const [scores, setScores] = useState<Record<string, number>>(existing?.scores ?? {})
  const [strengths, setStrengths] = useState(existing?.strengths ?? '')
  const [improvements, setImprovements] = useState(existing?.improvements ?? '')
  const [goals, setGoals] = useState(existing?.goals ?? '')
  const [coachNote, setCoachNote] = useState(existing?.coachNote ?? '')
  const [error, setError] = useState('')

  const draft: Evaluation = {
    id: existing?.id ?? `eval-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    athleteId: athlete.id, athleteName: athlete.name, date, period, scores, strengths, improvements, goals, coachNote,
    evaluator: existing?.evaluator || evaluator, createdAt: existing?.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString(),
  }
  const filled = Object.keys(scores).length

  function pick(key: string, value: number) {
    setScores((current) => {
      const next = { ...current }
      if (next[key] === value) delete next[key]
      else next[key] = value
      return next
    })
  }

  function save() {
    if (filled === 0) { setError('Dê nota a pelo menos um critério.'); return }
    if (!date) { setError('Informe a data da avaliação.'); return }
    onSave({ ...draft, updatedAt: new Date().toISOString() })
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="report-modal eval-modal" role="dialog" aria-modal="true" aria-labelledby="eval-title">
        <div className="modal-top">
          <span className="status-pill"><i /> avaliação periódica</span>
          <button className="icon-button" onClick={onClose} type="button" aria-label="Fechar avaliação"><X size={18} /></button>
        </div>
        <h2 id="eval-title" className="editor-title">{athlete.name}</h2>
        <p className="report-meta">{athlete.positions || 'Posição não informada'}{previous ? ` · última avaliação em ${previous.date.split('-').reverse().join('/')} (média ${formatScore(overall(previous))})` : ' · primeira avaliação'}</p>

        <div className="eval-meta">
          <label htmlFor="eval-date">Data<input id="eval-date" type="date" value={date} onChange={(e) => { setDate(e.target.value); if (!periodTouched && e.target.value) setPeriod(periodLabel(e.target.value)) }} /></label>
          <label htmlFor="eval-period">Período avaliado<input id="eval-period" value={period} onChange={(e) => { setPeriod(e.target.value); setPeriodTouched(true) }} placeholder="Ex.: 1º bimestre" /></label>
        </div>

        <div className="eval-scale" aria-hidden="true">{[1, 2, 3, 4, 5].map((n) => <span key={n}><b>{n}</b> {SCORE_LABEL[n]}</span>)}</div>

        {GROUPS.map((group) => (
          <fieldset className="eval-group" key={group}>
            <legend>{group} <small>média {formatScore(groupAverage(draft, group))}{previous ? ` · antes ${formatScore(groupAverage(previous, group))}` : ''}</small></legend>
            {CRITERIA.filter((c) => c.group === group).map((c) => (
              <div className="eval-row" key={c.key} role="radiogroup" aria-label={c.label}>
                <span className="eval-label">{c.label}{previous?.scores[c.key] ? <small> antes: {previous.scores[c.key]}</small> : null}</span>
                <span className="eval-buttons">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} type="button" role="radio" aria-checked={scores[c.key] === n} aria-label={`${c.label}: ${n}, ${SCORE_LABEL[n]}`} className={`score-btn ${scores[c.key] === n ? 'on' : ''} ${scores[c.key] && scores[c.key] >= n ? 'fill' : ''}`} onClick={() => pick(c.key, n)}>{n}</button>
                  ))}
                </span>
              </div>
            ))}
          </fieldset>
        ))}

        <div className="eval-texts">
          <label htmlFor="eval-strengths">Pontos fortes<textarea id="eval-strengths" value={strengths} onChange={(e) => setStrengths(e.target.value)} placeholder="O que o atleta já faz bem" rows={2} /></label>
          <label htmlFor="eval-improve">O que estamos trabalhando<textarea id="eval-improve" value={improvements} onChange={(e) => setImprovements(e.target.value)} placeholder="Aspectos a desenvolver" rows={2} /></label>
          <label htmlFor="eval-goals">Metas para o próximo período<textarea id="eval-goals" value={goals} onChange={(e) => setGoals(e.target.value)} placeholder="Ex.: usar mais a perna esquerda no passe curto" rows={2} /></label>
          <label htmlFor="eval-note">Mensagem para os responsáveis<textarea id="eval-note" value={coachNote} onChange={(e) => setCoachNote(e.target.value)} placeholder="Texto curto que entra no relatório dos pais" rows={2} /></label>
        </div>

        <div className="rate-strip"><span>Critérios avaliados: <b>{filled}/{CRITERIA.length}</b></span><span>Média geral: <b>{formatScore(overall(draft))}</b></span></div>
        {error && <div className="notice error">{error}</div>}
        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose} type="button">Cancelar</button>
          <button className="primary-button" onClick={save} type="button">{existing ? 'Salvar alterações' : 'Salvar avaliação'}</button>
        </div>
      </div>
    </div>
  )
}
