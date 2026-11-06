import { FormEvent, useState } from 'react'
import { Cloud, CloudOff, LogOut, RefreshCw, X } from 'lucide-react'
import type { SyncStatus } from '../hooks/useSync'
import type { useSync } from '../hooks/useSync'

type SyncApi = ReturnType<typeof useSync>

const LABEL: Record<SyncStatus, string> = {
  disabled: 'só neste aparelho',
  'signed-out': 'só neste aparelho',
  syncing: 'sincronizando…',
  synced: 'sincronizado',
  offline: 'offline · salvo no aparelho',
  error: 'erro ao sincronizar',
}

export function SyncPill({ sync, onOpen }: { sync: SyncApi; onOpen: () => void }) {
  if (!sync.enabled) return <span className="status-pill"><i /> local-first</span>
  const tone = sync.status === 'synced' ? 'ok' : sync.status === 'error' ? 'bad' : sync.status === 'offline' || sync.status === 'signed-out' ? 'idle' : 'busy'
  return (
    <button className={`status-pill sync-pill sync-${tone}`} onClick={onOpen} type="button" aria-label={`Sincronização: ${LABEL[sync.status]}. Abrir painel`}>
      {sync.status === 'signed-out' ? <CloudOff size={13} /> : <Cloud size={13} />} {sync.session ? LABEL[sync.status] : 'entrar para sincronizar'}
    </button>
  )
}

export function SyncPanel({ sync, onClose }: { sync: SyncApi; onClose: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setMessage(null)
    if (mode === 'in') {
      const err = await sync.signIn(email.trim(), password)
      if (err) setMessage({ tone: 'error', text: err })
    } else {
      const result = await sync.signUp(email.trim(), password)
      if (result.error) setMessage({ tone: 'error', text: result.error })
      else if (result.needsConfirmation) { setMessage({ tone: 'info', text: `Conta criada. Abra o e-mail enviado para ${email.trim()}, clique no link de confirmação e depois entre aqui.` }); setMode('in') }
    }
    setBusy(false)
  }

  const last = sync.lastSyncAt ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(sync.lastSyncAt)) : '—'

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="report-modal sync-modal" role="dialog" aria-modal="true" aria-labelledby="sync-title">
        <div className="modal-top">
          <span className="status-pill"><i /> sincronização</span>
          <button className="icon-button" onClick={onClose} type="button" aria-label="Fechar"><X size={18} /></button>
        </div>
        {sync.session ? (
          <>
            <h2 id="sync-title" className="editor-title">{sync.team?.name || 'Seu time'}</h2>
            <p className="report-meta">Conectado como {sync.session.user.email}. Elenco, calendário e sessões finalizadas ficam salvos na nuvem e aparecem nos outros aparelhos em que você entrar.</p>
            <div className="sync-facts">
              <div><span>Estado</span><strong>{LABEL[sync.status]}</strong></div>
              <div><span>Última sincronização</span><strong>{last}</strong></div>
            </div>
            {sync.error && <div className={`notice ${sync.status === 'offline' ? 'warn' : 'error'}`}>{sync.error}</div>}
            <p className="perf-note">Os contadores de uma sessão em andamento ficam só no aparelho que está registrando. Eles sobem quando você toca em "Finalizar sessão".</p>
            <div className="modal-actions">
              <button className="secondary-button" onClick={() => void sync.signOut()} type="button"><LogOut size={16} /> Sair</button>
              <button className="primary-button" onClick={() => void sync.syncNow()} disabled={sync.status === 'syncing'} type="button"><RefreshCw size={16} /> Sincronizar agora</button>
            </div>
          </>
        ) : (
          <form onSubmit={submit} className="sync-form">
            <h2 id="sync-title" className="editor-title">{mode === 'in' ? 'Entrar' : 'Criar conta'}</h2>
            <p className="report-meta">Entre para guardar os dados na nuvem e usar o ActionLog em mais de um aparelho. O que já está neste aparelho sobe automaticamente na primeira vez.</p>
            <label htmlFor="sync-email">E-mail<input id="sync-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            <label htmlFor="sync-password">Senha<input id="sync-password" type="password" autoComplete={mode === 'in' ? 'current-password' : 'new-password'} minLength={6} required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
            {message && <div className={`notice ${message.tone === 'error' ? 'error' : 'info'}`}>{message.text}</div>}
            <button className="primary-button full-button" disabled={busy} type="submit">{busy ? 'Aguarde…' : mode === 'in' ? 'Entrar' : 'Criar conta'}</button>
            <button className="link-button sync-switch" onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setMessage(null) }} type="button">{mode === 'in' ? 'Ainda não tem conta? Criar conta' : 'Já tem conta? Entrar'}</button>
          </form>
        )}
      </div>
    </div>
  )
}
