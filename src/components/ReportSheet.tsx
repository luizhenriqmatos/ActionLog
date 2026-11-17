import { SCORE_LABEL } from '../lib/evaluations'
import type { ReportContent } from '../lib/report'

const stars = (value: number | null) => {
  if (value == null) return '—'
  const full = Math.round(value)
  return '★'.repeat(full) + '☆'.repeat(5 - full)
}
const br = (iso: string) => iso.split('-').reverse().join('/')

/** Folha do relatório. Sempre clara, no app, na impressão e na página do link (escopo de tema forçado). */
export function ReportSheet({ content: c, titleId }: { content: ReportContent; titleId?: string }) {
  return (
    <article className="report-sheet" data-theme="light" aria-label="Relatório">
      <header className="sheet-head">
        <div><span className="sheet-club">{c.clube}</span><h2 id={titleId}>Relatório de desenvolvimento</h2></div>
        <span className="sheet-date">{br(c.emitidoEm)}</span>
      </header>
      <dl className="sheet-facts">
        <div><dt>Atleta</dt><dd>{c.atleta.nome}</dd></div>
        <div><dt>Categoria</dt><dd>{c.atleta.categoria}{c.atleta.posicoes ? ` · ${c.atleta.posicoes}` : ''}</dd></div>
        <div><dt>Período</dt><dd>{c.periodo}</dd></div>
        {c.treinador && <div><dt>Treinador</dt><dd>{c.treinador}</dd></div>}
      </dl>
      {c.avaliacao ? (
        <section>
          <h3>Avaliação do treinador</h3>
          <p className="sheet-hint">Notas de 1 a 5: 1 {SCORE_LABEL[1].toLowerCase()}, 3 {SCORE_LABEL[3].toLowerCase()}, 5 {SCORE_LABEL[5].toLowerCase()}.{c.avaliacao.comparadoCom ? ` Comparação com a avaliação de ${c.avaliacao.comparadoCom}.` : ''}</p>
          <table className="sheet-table"><tbody>{c.avaliacao.grupos.map((r) => (
            <tr key={r.grupo}><th>{r.grupo}</th><td className="sheet-stars">{stars(r.nota)}</td><td>{r.notaTexto}</td><td className={r.tendencia ? `trend-${r.tendencia === 'evoluiu' ? 'up' : r.tendencia === 'caiu' ? 'down' : 'same'}` : ''}>{r.tendencia ?? ''}</td></tr>
          ))}</tbody></table>
          {c.avaliacao.criterios && <p className="sheet-criteria">{c.avaliacao.criterios}</p>}
          {(c.avaliacao.fortes || c.avaliacao.melhorias || c.avaliacao.metas) && (
            <div className="sheet-notes">
              {c.avaliacao.fortes && <div><h4>Pontos fortes</h4><p>{c.avaliacao.fortes}</p></div>}
              {c.avaliacao.melhorias && <div><h4>O que estamos trabalhando</h4><p>{c.avaliacao.melhorias}</p></div>}
              {c.avaliacao.metas && <div><h4>Metas para o próximo período</h4><p>{c.avaliacao.metas}</p></div>}
            </div>
          )}
        </section>
      ) : <section><h3>Avaliação do treinador</h3><p className="sheet-hint">Ainda não há avaliação registrada para este atleta.</p></section>}
      {c.emCampo.length > 0 && <section><h3>Em campo</h3><ul className="sheet-list">{c.emCampo.map((line) => <li key={line}>{line}</li>)}</ul></section>}
      {c.mensagem && <section className="sheet-message"><h3>Mensagem do treinador</h3><p>{c.mensagem}</p>{c.treinador && <p className="sheet-sign">{c.treinador}</p>}</section>}
      <footer className="sheet-foot">Relatório gerado pelo ScoutHouse</footer>
    </article>
  )
}
