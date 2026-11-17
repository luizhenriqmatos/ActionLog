import { useEffect, useState } from 'react'
import { fetchPublicReport } from '../lib/reportSync'
import type { ReportContent } from '../lib/report'
import { ReportSheet } from './ReportSheet'

/** Página do link do relatório: sem login, sempre clara. Só abre com o código válido, não revogado e dentro do prazo. */
export function PublicReport({ token }: { token: string }) {
  const [state, setState] = useState<{ status: 'loading' } | { status: 'missing' } | { status: 'ok'; content: ReportContent; expiraEm: string }>({ status: 'loading' })
  useEffect(() => {
    document.title = 'Relatório de desenvolvimento'
    void fetchPublicReport(token).then((r) => setState(r ? { status: 'ok', content: r.conteudo, expiraEm: r.expiraEm } : { status: 'missing' }))
  }, [token])
  return (
    <div className="public-report" data-theme="light">
      {state.status === 'loading' && <p>Abrindo relatório…</p>}
      {state.status === 'missing' && <p>Este link não está mais disponível. Peça um novo ao treinador.</p>}
      {state.status === 'ok' && (
        <>
          <ReportSheet content={state.content} />
          <p className="public-note no-print">Link válido até {new Date(state.expiraEm).toLocaleDateString('pt-BR')}. <button type="button" onClick={() => window.print()}>Salvar em PDF ou imprimir</button></p>
        </>
      )}
    </div>
  )
}
