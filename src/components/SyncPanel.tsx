import { FormEvent, useEffect, useState } from 'react'
import { Check, Cloud, CloudOff, Copy, KeyRound, LogOut, MessageCircle, RefreshCw, Trash2, UserPlus, X } from 'lucide-react'
import type { SyncStatus, useSync } from '../hooks/useSync'
import { errorText } from '../hooks/useSync'
import type { Invite, Member, Role } from '../lib/sync'

type SyncApi = ReturnType<typeof useSync>

const LABEL: Record<SyncStatus, string> = {
  disabled: 'só neste aparelho',
  'signed-out': 'só neste aparelho',
  syncing: 'sincronizando…',
  synced: 'sincronizado',
  offline: 'offline · salvo no aparelho',
  error: 'erro ao sincronizar',
}

export const ROLE_LABEL: Record<Role, string> = { admin: 'Admin', treinador: 'Treinador', analista: 'Analista', leitura: 'Só leitura' }
const ROLE_HINT: Record<Role, string> = {
  admin: 'edita tudo, convida e remove pessoas',
  treinador: 'registra e edita elenco, calendário e scout',
  analista: 'registra e edita elenco, calendário e scout',
  leitura: 'só consulta; o que mudar no aparelho não vai para o time',
}

export function SyncPill({ sync, onOpen }: { sync: SyncApi; onOpen: () => void }) {
  if (!sync.enabled) return <span className="status-pill"><i /> local-first</span>
  const tone = sync.status === 'synced' ? 'ok' : sync.status === 'error' ? 'bad' : sync.status === 'offline' || sync.status === 'signed-out' ? 'idle' : 'busy'
  const text = !sync.session ? (sync.pendingInvite ? 'convite pendente · entrar' : 'entrar para sincronizar') : sync.readOnly ? 'só leitura' : LABEL[sync.status]
  return (
    <button className={`status-pill sync-pill sync-${tone}`} onClick={onOpen} type="button" aria-label={`Sincronização: ${text}. Abrir painel`}>
      {sync.session ? <Cloud size={13} /> : <CloudOff size={13} />}<span className="pill-text"> {text}</span>
    </button>
  )
}

export function NewPasswordPanel({ sync, onDone }: { sync: SyncApi; onDone: () => void }) {
  return <NewPassword sync={sync} onDone={onDone} />
}

export function SyncPanel({ sync, onClose }: { sync: SyncApi; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="report-modal sync-modal" role="dialog" aria-modal="true" aria-labelledby="sync-title">
        <div className="modal-top">
          <span className="status-pill"><i /> {sync.recovery ? 'nova senha' : sync.session ? 'time e sincronização' : 'acesso'}</span>
          <button className="icon-button" onClick={onClose} type="button" aria-label="Fechar"><X size={18} /></button>
        </div>
        {sync.recovery && sync.session ? <NewPassword sync={sync} onDone={onClose} /> : sync.session ? <SignedIn sync={sync} /> : <SignedOut sync={sync} />}
      </div>
    </div>
  )
}

export function SignedOut({ sync }: { sync: SyncApi }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'in' | 'up' | 'forgot'>('in')
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setMessage(null)
    const address = email.trim()
    if (mode === 'in') {
      const err = await sync.signIn(address, password)
      if (err) setMessage({ tone: 'error', text: err })
    } else if (mode === 'up') {
      const result = await sync.signUp(address, password)
      if (result.error) setMessage({ tone: 'error', text: result.error })
      else if (result.needsConfirmation) { setMessage({ tone: 'info', text: `Conta criada. Abra o e-mail enviado para ${address}, clique no link de confirmação e depois entre aqui.` }); setMode('in') }
    } else {
      const err = await sync.requestPasswordReset(address)
      setMessage(err ? { tone: 'error', text: err } : { tone: 'info', text: `Se existir uma conta com ${address}, chegou um e-mail com o link para criar uma nova senha. O link abre o ActionLog já pedindo a senha nova.` })
    }
    setBusy(false)
  }

  const title = mode === 'in' ? 'Entrar' : mode === 'up' ? 'Criar conta' : 'Esqueci minha senha'
  return (
    <form onSubmit={submit} className="sync-form">
      <h2 id="sync-title" className="editor-title">{title}</h2>
      {sync.pendingInvite && <div className="notice info">Você recebeu um convite (código {sync.pendingInvite}). Entre ou crie sua conta e você entra direto no time.</div>}
      {mode === 'forgot'
        ? <p className="report-meta">Informe o e-mail da conta. Vamos mandar um link para você criar uma senha nova.</p>
        : !sync.pendingInvite && <p className="report-meta">Entre para guardar os dados na nuvem e usar o ActionLog em mais de um aparelho. O que já está neste aparelho sobe automaticamente na primeira vez.</p>}
      <label htmlFor="sync-email">E-mail<input id="sync-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      {mode !== 'forgot' && <label htmlFor="sync-password">Senha<input id="sync-password" type="password" autoComplete={mode === 'in' ? 'current-password' : 'new-password'} minLength={6} required value={password} onChange={(e) => setPassword(e.target.value)} /></label>}
      {message && <div className={`notice ${message.tone === 'error' ? 'error' : 'info'}`}>{message.text}</div>}
      <button className="primary-button full-button" disabled={busy} type="submit">{busy ? 'Aguarde…' : mode === 'forgot' ? 'Enviar link' : title}</button>
      <div className="sync-links">
        {mode === 'in' && <button className="link-button" onClick={() => { setMode('forgot'); setMessage(null) }} type="button">Esqueci minha senha</button>}
        <button className="link-button" onClick={() => { setMode(mode === 'up' ? 'in' : mode === 'forgot' ? 'in' : 'up'); setMessage(null) }} type="button">{mode === 'in' ? 'Criar conta' : 'Voltar para entrar'}</button>
      </div>
    </form>
  )
}

function NewPassword({ sync, onDone }: { sync: SyncApi; onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (password !== confirm) { setMessage('As duas senhas não são iguais.'); return }
    setBusy(true)
    const err = await sync.setNewPassword(password)
    setBusy(false)
    if (err) setMessage(err)
    else onDone()
  }
  return (
    <form onSubmit={submit} className="sync-form">
      <h2 id="sync-title" className="editor-title"><KeyRound size={22} /> Nova senha</h2>
      <p className="report-meta">Conta {sync.session?.user.email}. Escolha a senha nova (mínimo de 6 caracteres).</p>
      <label htmlFor="new-pass">Nova senha<input id="new-pass" type="password" autoComplete="new-password" minLength={6} required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      <label htmlFor="new-pass-2">Repita a senha<input id="new-pass-2" type="password" autoComplete="new-password" minLength={6} required value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>
      {message && <div className="notice error">{message}</div>}
      <button className="primary-button full-button" disabled={busy} type="submit">{busy ? 'Salvando…' : 'Salvar nova senha'}</button>
    </form>
  )
}

function SignedIn({ sync }: { sync: SyncApi }) {
  const isAdmin = sync.team?.role === 'admin'
  const [members, setMembers] = useState<Member[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [inviteRole, setInviteRole] = useState<Role>('treinador')
  const [justCreated, setJustCreated] = useState<Invite | null>(null)
  const [copied, setCopied] = useState('')
  const [code, setCode] = useState('')
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(sync.inviteError ? { tone: 'error', text: `Convite: ${sync.inviteError}` } : null)
  const [busy, setBusy] = useState(false)

  async function reload() {
    try {
      const [m, i] = await Promise.all([sync.team$.members(), sync.team$.invites()])
      setMembers(m)
      setInvites(i)
    } catch (err) { setMessage({ tone: 'error', text: errorText(err) }) }
  }
  useEffect(() => { void reload() }, [sync.team?.id])

  const link = (invite: Invite) => `${window.location.origin}/?convite=${invite.code}`

  async function makeInvite() {
    setBusy(true); setMessage(null)
    try { const invite = await sync.team$.invite(inviteRole); setJustCreated(invite); await reload() }
    catch (err) { setMessage({ tone: 'error', text: errorText(err) }) }
    setBusy(false)
  }

  async function copy(text: string, key: string) {
    try { await navigator.clipboard.writeText(text); setCopied(key); window.setTimeout(() => setCopied(''), 2000) }
    catch { setMessage({ tone: 'error', text: 'Não foi possível copiar. Selecione o link e copie manualmente.' }) }
  }

  async function act(fn: () => Promise<unknown>) {
    setMessage(null)
    try { await fn(); await reload() } catch (err) { setMessage({ tone: 'error', text: errorText(err) }) }
  }

  async function join(event: FormEvent) {
    event.preventDefault()
    if (!code.trim()) return
    setBusy(true)
    const err = await sync.joinWithCode(code)
    setBusy(false)
    setMessage(err ? { tone: 'error', text: err } : { tone: 'info', text: 'Você entrou no time. Os dados dele já estão carregando.' })
    if (!err) setCode('')
  }

  const last = sync.lastSyncAt ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(sync.lastSyncAt)) : '—'
  const whatsapp = (invite: Invite) => `https://wa.me/?text=${encodeURIComponent(`Convite para a comissão técnica no ActionLog (${ROLE_LABEL[invite.role]}). Abra o link e crie sua conta: ${link(invite)}`)}`

  return (
    <div className="sync-signed">
      <h2 id="sync-title" className="editor-title">{sync.team?.name || 'Seu time'}</h2>
      <p className="report-meta">{sync.session?.user.email} · {sync.team ? ROLE_LABEL[sync.team.role] : '—'}</p>
      <div className="sync-facts">
        <div><span>Estado</span><strong>{sync.readOnly ? 'só leitura' : LABEL[sync.status]}</strong></div>
        <div><span>Última sincronização</span><strong>{last}</strong></div>
      </div>
      {sync.error && <div className={`notice ${sync.status === 'offline' ? 'warn' : 'error'}`}>{sync.error}</div>}
      {sync.readOnly && <div className="notice warn">Seu acesso é só de leitura: você vê os dados do time, mas o que mudar aqui não é enviado.</div>}
      {message && <div className={`notice ${message.tone === 'error' ? 'error' : 'info'}`}>{message.text}</div>}

      <section className="sync-section">
        <h3>Comissão técnica <small>{members.length}</small></h3>
        <ul className="member-list">
          {members.map((m) => {
            const self = m.userId === sync.session?.user.id
            return (
              <li key={m.userId}>
                <span className="member-email">{m.email}{self && <small> (você)</small>}</span>
                {isAdmin && !self ? (
                  <select aria-label={`Papel de ${m.email}`} value={m.role} onChange={(e) => void act(() => sync.team$.setRole(m.userId, e.target.value as Role))}>
                    {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </select>
                ) : <span className="member-role">{ROLE_LABEL[m.role]}</span>}
                {isAdmin && !self && <button className="icon-button danger" onClick={() => { if (window.confirm(`Remover ${m.email} do time?`)) void act(() => sync.team$.remove(m.userId)) }} type="button" aria-label={`Remover ${m.email}`}><Trash2 size={14} /></button>}
              </li>
            )
          })}
        </ul>
      </section>

      {isAdmin && (
        <section className="sync-section">
          <h3><UserPlus size={16} /> Convidar para o time</h3>
          <div className="invite-row">
            <select aria-label="Papel do convidado" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Role)}>
              {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
            <button className="primary-button" disabled={busy} onClick={() => void makeInvite()} type="button">Gerar convite</button>
          </div>
          <p className="perf-note">{ROLE_LABEL[inviteRole]}: {ROLE_HINT[inviteRole]}. Cada convite vale para 1 pessoa por 7 dias.</p>
          {justCreated && (
            <div className="invite-created">
              <span>Envie este link para a pessoa:</span>
              <code>{link(justCreated)}</code>
              <div className="invite-actions">
                <button className="secondary-button" onClick={() => void copy(link(justCreated), justCreated.id)} type="button">{copied === justCreated.id ? <Check size={15} /> : <Copy size={15} />} {copied === justCreated.id ? 'Copiado' : 'Copiar link'}</button>
                <a className="secondary-button" href={whatsapp(justCreated)} target="_blank" rel="noreferrer"><MessageCircle size={15} /> WhatsApp</a>
              </div>
              <small>Ou o código <b>{justCreated.code}</b>, para digitar no perfil, em "Tenho um código de convite".</small>
            </div>
          )}
          {invites.length > 0 && (
            <ul className="member-list invites">
              {invites.map((i) => (
                <li key={i.id}>
                  <span className="member-email"><b>{i.code}</b> · {ROLE_LABEL[i.role]} <small>até {new Date(i.expiresAt).toLocaleDateString('pt-BR')}</small></span>
                  <button className="icon-button" onClick={() => void copy(link(i), i.id)} type="button" aria-label={`Copiar link do convite ${i.code}`}>{copied === i.id ? <Check size={14} /> : <Copy size={14} />}</button>
                  <button className="icon-button danger" onClick={() => void act(() => sync.team$.revoke(i.id))} type="button" aria-label={`Cancelar convite ${i.code}`}><Trash2 size={14} /></button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="sync-section">
        <h3>Entrar em outro clube com código</h3>
        <form className="invite-row" onSubmit={join}>
          <input aria-label="Código do convite" placeholder="Código do convite" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={12} />
          <button className="secondary-button" disabled={busy || !code.trim()} type="submit">Entrar</button>
        </form>
      </section>

      <p className="perf-note">Os contadores de uma sessão em andamento ficam só no aparelho que está registrando. Eles sobem quando você toca em "Finalizar sessão".</p>
      <div className="modal-actions">
        <button className="primary-button" onClick={() => void sync.syncNow()} disabled={sync.status === 'syncing' || !sync.team} type="button"><RefreshCw size={16} /> Sincronizar agora</button>
      </div>
    </div>
  )
}
