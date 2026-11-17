import { useEffect, useMemo, useState } from 'react'
import { Check, Copy, Link2, MessageCircle, Printer, X } from 'lucide-react'
import type { Athlete, Evaluation, SessionRecord } from '../types'
import { formatScore, forAthlete, overall, previousOf } from '../lib/evaluations'
import { addDaysIso } from '../lib/metrics'
import { buildReportContent, otherAthletesMentioned, reportPlainText } from '../lib/report'
import { emitReport, fetchEmissions, fetchHiddenMatchIds, fetchResponsaveis, revokeReport, type EmissionRow, type Responsavel } from '../lib/reportSync'
import { ReportSheet } from './ReportSheet'

type Props = {
  athlete: Athlete
  roster: Athlete[]
  category: string
  clubName: string
  coachName: string
  teamId: string | null
  readOnly?: boolean
  sessions: SessionRecord[]
  evaluations: Evaluation[]
  today: string
  onClose: () => void
}

type PeriodKey = 'since-eval' | '30' | '90' | 'all'
type Channel = 'texto' | 'whatsapp' | 'impressao' | 'link'
const br = (iso: string) => iso.split('-').reverse().join('/')
const CANAL_LABEL: Record<string, string> = { texto: 'Texto copiado', whatsapp: 'WhatsApp', impressao: 'Impressão / PDF', link: 'Link', pdf: 'PDF', imagem: 'Imagem' }

/** Relatório para os responsáveis. Toda entrega (texto, WhatsApp, PDF, link) é registrada no log de emissão antes de sair. */
export function ParentReport({ athlete, roster, category, clubName, coachName, teamId, readOnly, sessions, evaluations, today, onClose }: Props) {
  const evals = forAthlete(evaluations, athlete.id)
  const [evalId, setEvalId] = useState(evals[evals.length - 1]?.id ?? '')
  const evaluation = evals.find((e) => e.id === evalId) ?? null
  const previous = evaluation ? previousOf(evaluations, evaluation) : null
  const [periodKey, setPeriodKey] = useState<PeriodKey>(previous ? 'since-eval' : '90')
  const [message, setMessage] = useState(evaluation?.coachNote ?? '')
  const [copied, setCopied] = useState(false)
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set())
  const [responsaveis, setResponsaveis] = useState<Responsavel[]>([])
  const [responsavelId, setResponsavelId] = useState('')
  const [history, setHistory] = useState<EmissionRow[]>([])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [link, setLink] = useState<{ url: string; id: string; expira: string } | null>(null)

  useEffect(() => {
    if (!teamId) return
    void fetchHiddenMatchIds(teamId).then(setHidden)
    void fetchResponsaveis(teamId, athlete.id).then((list) => { setResponsaveis(list); if (list.length === 1) setResponsavelId(list[0].id) })
    void fetchEmissions(teamId, athlete.id).then(setHistory)
  }, [teamId, athlete.id])

  const range = useMemo(() => {
    if (periodKey === 'since-eval' && previous) return { from: addDaysIso(previous.date, 1), to: evaluation?.date ?? today }
    if (periodKey === '30') return { from: addDaysIso(today, -29), to: today }
    if (periodKey === 'all') return { from: '0000-01-01', to: '9999-12-31' }
    return { from: addDaysIso(today, -89), to: today }
  }, [periodKey, previous?.date, evaluation?.date, today])
  const periodText = range.from === '0000-01-01' ? 'Todo o histórico' : `${br(range.from)} a ${br(range.to)}`
  const inRange = sessions.filter((s) => s.calendarDate >= range.from && s.calendarDate <= range.to)

  const content = useMemo(() => buildReportContent({ athlete, category, clubName, coachName, evaluation, previous, sessions: inRange, hiddenMatchIds: hidden, periodText, today, message }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [athlete, category, clubName, coachName, evaluation, previous, sessions, hidden, periodKey, today, message])

  const mentioned = useMemo(() => otherAthletesMentioned([message, evaluation?.strengths ?? '', evaluation?.improvements ?? '', evaluation?.goals ?? ''], athlete, roster), [message, evaluation, athlete, roster])
  const canEmit = Boolean(teamId) && !readOnly

  /** Registra a entrega ANTES de sair. Sem conexão não há como provar a quem foi entregue, então não entrega. */
  async function emit(canal: Channel, withLink = false) {
    if (!teamId) throw new Error('Entre na conta do clube para emitir relatórios.')
    const emission = await emitReport({ teamId, athleteId: athlete.id, responsavelId: responsavelId || null, canal: canal === 'link' ? 'texto' : canal, content, withLink })
    if (emission.aviso) setNotice(emission.aviso)
    void fetchEmissions(teamId, athlete.id).then(setHistory)
    return emission
  }
  async function run(action: () => Promise<void>) {
    setBusy(true); setNotice('')
    try { await action() } catch (error) { setNotice(error instanceof Error ? error.message : 'Não foi possível registrar a entrega.') } finally { setBusy(false) }
  }
  const makeLink = async () => {
    const e = await emit('link', true)
    if (!e.token) throw new Error('O servidor não devolveu o link.')
    const next = { url: `${window.location.origin}/?r=${e.token}`, id: e.id, expira: e.expiraEm ?? '' }
    setLink(next)
    return next
  }
  const copyText = () => run(async () => { await emit('texto'); await navigator.clipboard.writeText(reportPlainText(content)); setCopied(true); window.setTimeout(() => setCopied(false), 2000) })
  const copyLink = () => run(async () => { const l = link ?? await makeLink(); await navigator.clipboard.writeText(l.url); setCopied(true); window.setTimeout(() => setCopied(false), 2000) })
  const whatsapp = () => run(async () => {
    // o texto do relatório não vai na URL: vai só o link, que o servidor controla e pode revogar
    const l = link ?? await makeLink()
    window.open(`https://wa.me/?text=${encodeURIComponent(`Relatório de desenvolvimento de ${athlete.name}: ${l.url}`)}`, '_blank', 'noopener')
  })
  const print = () => run(async () => {
    await emit('impressao')
    document.body.classList.add('printing-report')
    const done = () => { document.body.classList.remove('printing-report'); window.removeEventListener('afterprint', done) }
    window.addEventListener('afterprint', done)
    window.print()
  })
  const revoke = () => run(async () => { if (!link) return; await revokeReport(link.id); setLink(null); if (teamId) setHistory(await fetchEmissions(teamId, athlete.id)) })

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
          <label htmlFor="pr-resp" className="wide">Entregue para
            <select id="pr-resp" value={responsavelId} onChange={(e) => setResponsavelId(e.target.value)}>
              <option value="">Responsável não identificado (fica registrado com aviso)</option>
              {responsaveis.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}
            </select>
          </label>
          <label htmlFor="pr-msg" className="wide">Mensagem do treinador
            <textarea id="pr-msg" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Ex.: Parabéns pela dedicação neste mês. Seguimos trabalhando a finalização com a perna esquerda." />
          </label>
        </div>

        {mentioned.length > 0 && <p className="parent-warn no-print" role="alert">Os textos citam {mentioned.join(', ')}. O relatório de um atleta não pode expor outro atleta pelo nome. Revise a mensagem e a avaliação antes de entregar.</p>}
        {!canEmit && <p className="parent-warn no-print" role="alert">{readOnly ? 'Seu acesso é só de leitura: não emite relatório.' : 'Entre na conta do clube para emitir: toda entrega fica registrada.'}</p>}

        <ReportSheet content={content} titleId="parent-title" />

        {notice && <p className="parent-warn no-print" role="status">{notice}</p>}
        {link && (
          <div className="parent-link no-print">
            <input readOnly value={link.url} aria-label="Link do relatório" onFocus={(e) => e.currentTarget.select()} />
            <span>vale até {link.expira ? new Date(link.expira).toLocaleDateString('pt-BR') : '—'}</span>
            <button className="secondary-button" onClick={() => void revoke()} disabled={busy} type="button">Revogar link</button>
          </div>
        )}

        <div className="modal-actions no-print">
          <button className="secondary-button" onClick={() => void copyText()} disabled={busy || !canEmit} type="button">{copied ? <Check size={15} /> : <Copy size={15} />} {copied ? 'Copiado' : 'Copiar texto'}</button>
          <button className="secondary-button" onClick={() => void copyLink()} disabled={busy || !canEmit} type="button"><Link2 size={15} /> Copiar link</button>
          <button className="secondary-button" onClick={() => void whatsapp()} disabled={busy || !canEmit} type="button"><MessageCircle size={15} /> WhatsApp (link)</button>
          <button className="primary-button" onClick={() => void print()} disabled={busy || !canEmit} type="button"><Printer size={15} /> Imprimir ou salvar PDF</button>
        </div>

        {history.length > 0 && (
          <div className="parent-emissions no-print" aria-label="Relatórios já emitidos para este atleta">
            <strong>Já emitidos</strong>
            {history.slice(0, 5).map((h) => <span key={h.id}>{new Date(h.emitidoEm).toLocaleString('pt-BR')} · {CANAL_LABEL[h.canal] ?? h.canal}{h.temLink ? ` · ${h.revogadoEm ? 'revogado' : `${h.acessos} acesso${h.acessos === 1 ? '' : 's'}`}` : ''}{h.aviso ? ` · ${h.aviso}` : ''}</span>)}
          </div>
        )}
      </div>
    </div>
  )
}
