import { ClipboardList, FileText, FolderOpen, Plus } from 'lucide-react'
import type { Athlete, Evaluation } from '../types'
import { EVALUATION_INTERVAL_DAYS, TREND_LABEL, evaluationStatus, forAthlete, formatScore, overall, trend } from '../lib/evaluations'

type Props = {
  athletes: Athlete[]
  evaluations: Evaluation[]
  today: string
  readOnly: boolean
  onNew: (athlete: Athlete) => void
  onOpenFile: (athlete: Athlete) => void
  onReport: (athlete: Athlete) => void
}

/** Visão da categoria: quem já foi avaliado, quem está pendente e como cada um evoluiu. */
export function EvaluationsTab({ athletes, evaluations, today, readOnly, onNew, onOpenFile, onReport }: Props) {
  const rows = athletes.map((athlete) => {
    const status = evaluationStatus(evaluations, athlete.id, today)
    const list = forAthlete(evaluations, athlete.id)
    const prev = list.length > 1 ? list[list.length - 2] : null
    return { athlete, status, count: list.length, avg: status.last ? overall(status.last) : null, t: status.last && prev ? trend(overall(status.last), overall(prev)) : null }
  })
  const pending = rows.filter((r) => r.status.due).length
  const evaluated = rows.filter((r) => r.status.last).length
  const sorted = [...rows].sort((a, b) => Number(b.status.due) - Number(a.status.due) || a.athlete.name.localeCompare(b.athlete.name))

  return (
    <section className="content-section">
      <div className="section-heading">
        <div>
          <div className="eyebrow">AVALIAÇÕES PERIÓDICAS</div>
          <h2>Como cada atleta está evoluindo.</h2>
          <p>Notas de 1 a 5 em critérios técnicos, táticos, físicos e de comportamento. A sugestão é avaliar cada atleta a cada {EVALUATION_INTERVAL_DAYS} dias.</p>
        </div>
      </div>
      {athletes.length === 0 ? (
        <div className="empty-state"><span className="empty-icon"><ClipboardList size={22} /></span><strong>Cadastre atletas primeiro</strong><p>As avaliações ficam no histórico de cada atleta do elenco.</p></div>
      ) : <>
        <div className="totals-grid">
          <div className="total-card"><span>Atletas avaliados</span><strong>{evaluated}</strong><small>de {athletes.length} no elenco</small></div>
          <div className={`total-card ${pending ? 'attention' : ''}`}><span>Avaliações pendentes</span><strong>{pending}</strong><small>sem avaliação ou há {EVALUATION_INTERVAL_DAYS}+ dias</small></div>
          <div className="total-card"><span>Avaliações feitas</span><strong>{evaluations.length}</strong><small>no histórico da categoria</small></div>
        </div>
        <div className="perf-card">
          <div className="table-wrap"><table className="perf-table stack-table">
            <thead><tr><th className="left">Atleta</th><th className="left">Situação</th><th>Última</th><th>Média</th><th className="left">Evolução</th><th>Avaliações</th><th /></tr></thead>
            <tbody>{sorted.map(({ athlete, status, count, avg, t }) => (
              <tr key={athlete.id}>
                <td className="left stack-title"><strong>{athlete.name}</strong> <small>{athlete.number ? `#${athlete.number} · ` : ''}{athlete.positions}</small></td>
                <td className="left" data-label="Situação">{status.due ? <span className="low-pill">{status.last ? `há ${status.daysSince} dias` : 'nunca avaliado'}</span> : <span className="ok-pill">em dia</span>}</td>
                <td data-label="Última">{status.last ? status.last.date.split('-').reverse().slice(0, 2).join('/') : '—'}</td>
                <td data-label="Média"><b>{formatScore(avg)}</b></td>
                <td className="left" data-label="Evolução">{t ? <span className={`trend trend-${t}`}>{TREND_LABEL[t]}</span> : <small>—</small>}</td>
                <td data-label="Avaliações">{count}</td>
                <td className="row-actions stack-actions">
                  {!readOnly && <button className="secondary-button compact" onClick={() => onNew(athlete)} type="button"><Plus size={14} /> Avaliar</button>}
                  <button className="icon-button" onClick={() => onOpenFile(athlete)} type="button" aria-label={`Histórico de ${athlete.name}`}><FolderOpen size={14} /></button>
                  <button className="icon-button" onClick={() => onReport(athlete)} type="button" aria-label={`Relatório para os pais de ${athlete.name}`}><FileText size={14} /></button>
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>
      </>}
    </section>
  )
}
