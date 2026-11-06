import { FileText, Pencil, Plus, Trash2, X } from 'lucide-react'
import type { Athlete, Evaluation, SessionRecord } from '../types'
import { CRITERIA, GROUPS, TREND_LABEL, forAthlete, formatScore, groupAverage, overall, trend } from '../lib/evaluations'
import { type EvolutionPoint, evolution, finishingRates, formatPct, gameRates, sumFinishing, sumGame } from '../lib/metrics'
import { EvolutionChart } from './Charts'

type Props = {
  athlete: Athlete
  category: string
  sessions: SessionRecord[]
  evaluations: Evaluation[]
  readOnly: boolean
  onNewEvaluation: () => void
  onEditEvaluation: (evaluation: Evaluation) => void
  onDeleteEvaluation: (evaluation: Evaluation) => void
  onReport: () => void
  onClose: () => void
}

type TimelineItem = { date: string; kind: 'evaluation' | 'game' | 'finishing'; title: string; detail: string; evaluation?: Evaluation }

/** Histórico completo do atleta: avaliações, evolução e tudo o que foi registrado no Scout. */
export function AthleteFile({ athlete, category, sessions, evaluations, readOnly, onNewEvaluation, onEditEvaluation, onDeleteEvaluation, onReport, onClose }: Props) {
  const evals = forAthlete(evaluations, athlete.id)
  const mine = sessions.filter((s) => s.athleteId === athlete.id)
  const games = mine.filter((s) => s.mode === 'game')
  const trainings = mine.filter((s) => s.mode === 'finishing')
  const last = evals[evals.length - 1] ?? null
  const prev = evals.length > 1 ? evals[evals.length - 2] : null
  const g = sumGame(games)
  const f = sumFinishing(trainings)
  const ambi = athlete.dominantFoot === 'Ambidestro'

  const evalPoints: EvolutionPoint[] = evals.map((e) => {
    const [, m, d] = e.date.split('-')
    return { date: e.date, label: `${d}/${m}`, value: overall(e), moving: null, denominator: Object.keys(e.scores).length }
  })

  const timeline: TimelineItem[] = [
    ...evals.map((e) => ({ date: e.date, kind: 'evaluation' as const, title: `Avaliação · ${e.period || 'periódica'}`, detail: `Média ${formatScore(overall(e))} · ${GROUPS.map((gr) => `${gr} ${formatScore(groupAverage(e, gr))}`).join(' · ')}`, evaluation: e })),
    ...games.map((s) => ({ date: s.calendarDate, kind: 'game' as const, title: s.eventTitle || 'Scout de Jogo', detail: `${s.stats.game.goals} gol(s) · ${s.stats.game.assists} assist. · ${s.stats.game.shots} finalizações · passe ${formatPct(gameRates(sumGame([s]))[2].value)}` })),
    ...trainings.map((s) => ({ date: s.calendarDate, kind: 'finishing' as const, title: s.eventTitle || 'Treino de Finalização', detail: `${s.stats.finishing.dominantFinishes + s.stats.finishing.nonDominantFinishes} finalizações · ${s.stats.finishing.dominantGoals + s.stats.finishing.nonDominantGoals} gols · conversão ${formatPct(finishingRates(sumFinishing([s]))[1].value)}` })),
  ].sort((a, b) => b.date.localeCompare(a.date))

  const t = last && prev ? trend(overall(last), overall(prev)) : null
  const gameConv = evolution(games, 'game', 'passAccuracy')

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="report-modal file-modal" role="dialog" aria-modal="true" aria-labelledby="file-title">
        <div className="modal-top">
          <span className="status-pill"><i /> histórico do atleta · {category}</span>
          <button className="icon-button" onClick={onClose} type="button" aria-label="Fechar histórico"><X size={18} /></button>
        </div>
        <div className="file-head">
          <span className="avatar large">{athlete.name.slice(0, 1).toUpperCase()}</span>
          <div>
            <h2 id="file-title" className="editor-title">{athlete.name}</h2>
            <p className="report-meta">{athlete.number ? `Camisa ${athlete.number} · ` : ''}{athlete.positions || 'Posição não informada'} · {athlete.age ? `${athlete.age} anos · ` : ''}{athlete.height ? `${athlete.height} cm · ` : ''}{athlete.weight ? `${athlete.weight} kg · ` : ''}{athlete.dominantFoot === 'Ambidestro' ? 'ambidestro' : `perna dominante ${athlete.dominantFoot.toLowerCase()}`}</p>
          </div>
          <div className="file-actions">
            {!readOnly && <button className="secondary-button" onClick={onNewEvaluation} type="button"><Plus size={15} /> Nova avaliação</button>}
            <button className="primary-button" onClick={onReport} type="button"><FileText size={15} /> Relatório para os pais</button>
          </div>
        </div>

        <div className="totals-grid">
          <div className="total-card"><span>Média da última avaliação</span><strong>{formatScore(last ? overall(last) : null)}</strong><small>{t ? `${TREND_LABEL[t]} em relação à anterior (${formatScore(overall(prev!))})` : last ? 'primeira avaliação' : 'ainda não avaliado'}</small></div>
          <div className="total-card"><span>Avaliações</span><strong>{evals.length}</strong><small>{last ? `última em ${last.date.split('-').reverse().join('/')}` : '—'}</small></div>
          <div className="total-card"><span>Jogos com scout</span><strong>{g.sessions}</strong><small>{g.goals} gol{g.goals === 1 ? '' : 's'} · {g.assists} assistência{g.assists === 1 ? '' : 's'}</small></div>
          <div className="total-card"><span>Treinos de finalização</span><strong>{f.sessions}</strong><small>conversão {formatPct(finishingRates(f, ambi)[1].value)}</small></div>
        </div>

        {last && (
          <div className="perf-card">
            <div className="perf-card-head"><strong>Última avaliação por área</strong><small>{last.period}</small></div>
            <div className="group-bars">
              {GROUPS.map((gr) => {
                const now = groupAverage(last, gr)
                const before = prev ? groupAverage(prev, gr) : null
                const tr = trend(now, before)
                return (
                  <div className="group-bar" key={gr}>
                    <span className="pbar-name">{gr}</span>
                    <span className="pbar-track"><span className="pbar-fill tone-green" style={{ width: `${((now ?? 0) / 5) * 100}%` }} />{before != null && <i className="pbar-marker" style={{ left: `${(before / 5) * 100}%` }} title={`Antes: ${formatScore(before)}`} />}</span>
                    <strong className="pbar-value">{formatScore(now)}</strong>
                    <span className={`trend ${tr ? `trend-${tr}` : ''}`}>{tr ? TREND_LABEL[tr] : ''}</span>
                  </div>
                )
              })}
            </div>
            <div className="criteria-chips">{CRITERIA.filter((c) => last.scores[c.key]).map((c) => <span key={c.key}>{c.label} <b>{last.scores[c.key]}</b></span>)}</div>
            {(last.strengths || last.improvements || last.goals) && (
              <div className="file-notes">
                {last.strengths && <div><span>Pontos fortes</span><p>{last.strengths}</p></div>}
                {last.improvements && <div><span>O que estamos trabalhando</span><p>{last.improvements}</p></div>}
                {last.goals && <div><span>Metas</span><p>{last.goals}</p></div>}
              </div>
            )}
          </div>
        )}

        <div className="perf-charts">
          <div className="perf-card">
            <div className="perf-card-head"><strong>Média das avaliações</strong><small>escala de 1 a 5</small></div>
            <EvolutionChart points={evalPoints} label="Média geral" scale={{ min: 0, max: 5, ticks: [1, 2, 3, 4, 5], format: (v) => (v == null ? '—' : String(v).replace('.', ',')), movingLabel: '', unitLabel: (p) => `${p.label}: média ${formatScore(p.value)} (${p.denominator} critérios)` }} />
          </div>
          <div className="perf-card">
            <div className="perf-card-head"><strong>Precisão de passe nos jogos</strong></div>
            <EvolutionChart points={gameConv} label="Precisão de passe" />
          </div>
        </div>

        <div className="perf-card">
          <div className="perf-card-head"><strong>Linha do tempo</strong><small>{timeline.length} registros</small></div>
          {timeline.length === 0 ? <p className="perf-note">Nada registrado ainda para este atleta.</p> : (
            <ol className="timeline">
              {timeline.map((item, index) => (
                <li key={`${item.kind}-${item.date}-${index}`} className={`tl-${item.kind}`}>
                  <span className="tl-date">{item.date.split('-').reverse().join('/')}</span>
                  <span className="tl-dot" />
                  <span className="tl-body"><strong>{item.title}</strong><small>{item.detail}</small></span>
                  {item.evaluation && !readOnly && <span className="row-actions">
                    <button className="icon-button" onClick={() => onEditEvaluation(item.evaluation!)} type="button" aria-label="Editar avaliação"><Pencil size={13} /></button>
                    <button className="icon-button danger" onClick={() => onDeleteEvaluation(item.evaluation!)} type="button" aria-label="Excluir avaliação"><Trash2 size={13} /></button>
                  </span>}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  )
}
