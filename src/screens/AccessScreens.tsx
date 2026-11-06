import { FormEvent, useState } from 'react'
import { ChevronRight, KeyRound, LogOut, Plus, ShieldCheck, Users, X } from 'lucide-react'
import type { useSync } from '../hooks/useSync'
import { NewPasswordPanel, ROLE_LABEL, SignedOut } from '../components/SyncPanel'

type SyncApi = ReturnType<typeof useSync>

function Brand() {
  return <div className="topline"><span className="brand-mark">A</span><span className="wordmark">ACTIONLOG</span></div>
}

/** Primeira tela: entrar, criar conta ou recuperar senha. */
export function LoginScreen({ sync }: { sync: SyncApi }) {
  return (
    <main className="app-shell access-shell">
      <Brand />
      <section className="access-grid">
        <div className="access-copy">
          <div className="eyebrow">DESENVOLVIMENTO DE ATLETAS DE BASE</div>
          <h1>Evolução que<br /><em>os pais enxergam.</em></h1>
          <p>Avaliações periódicas, histórico de cada atleta e relatórios prontos para enviar aos responsáveis.</p>
          <ul className="access-points">
            <li><ShieldCheck size={16} /> Dados do clube salvos na nuvem, acessíveis só pela sua comissão</li>
            <li><Users size={16} /> Convide treinadores e analistas com o papel certo</li>
          </ul>
        </div>
        <div className="access-card"><SignedOut sync={sync} /></div>
      </section>
    </main>
  )
}

/** Depois do login: perfil do treinador e seus clubes. */
export function ProfileScreen({ sync }: { sync: SyncApi }) {
  const [creating, setCreating] = useState(false)
  const [clubName, setClubName] = useState('')
  const [code, setCode] = useState('')
  const [joining, setJoining] = useState(false)
  const [name, setName] = useState(sync.profileName)
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(sync.inviteError ? { tone: 'error', text: `Convite: ${sync.inviteError}` } : null)
  const [busy, setBusy] = useState(false)

  if (sync.recovery) {
    return <main className="app-shell access-shell"><Brand /><div className="access-card narrow"><NewPasswordPanel sync={sync} onDone={() => sync.dismissRecovery()} /></div></main>
  }

  async function create(event: FormEvent) {
    event.preventDefault()
    setBusy(true); setMessage(null)
    const err = await sync.newClub(clubName)
    setBusy(false)
    if (err) setMessage({ tone: 'error', text: err })
  }

  async function join(event: FormEvent) {
    event.preventDefault()
    setBusy(true); setMessage(null)
    const err = await sync.joinWithCode(code)
    setBusy(false)
    if (err) setMessage({ tone: 'error', text: err })
  }

  async function saveName() {
    if (name.trim() === sync.profileName) return
    const err = await sync.setProfileName(name)
    setMessage(err ? { tone: 'error', text: err } : { tone: 'info', text: 'Nome salvo. Ele aparece como assinatura nos relatórios para os pais.' })
  }

  const firstName = (sync.profileName || sync.session?.user.email || '').split(/[\s@]/).filter((part) => part && !part.endsWith('.'))[0] ?? ''
  const adminCount = sync.clubs.filter((c) => c.role === 'admin').length

  return (
    <main className="app-shell profile-shell">
      <div className="topline"><span className="brand-mark">A</span><span className="wordmark">ACTIONLOG</span>
        <button className="secondary-button topline-sync" onClick={() => void sync.signOut()} type="button"><LogOut size={15} /> Sair</button>
      </div>
      <section className="picker-hero">
        <div className="eyebrow">PERFIL · {sync.session?.user.email}</div>
        <h1>Olá{firstName ? `, ${firstName}` : ''}.<br /><em>Escolha o clube.</em></h1>
      </section>

      <section className="profile-name">
        <label htmlFor="profile-name">Seu nome <small>aparece nos relatórios para os pais</small></label>
        <div className="invite-row">
          <input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => void saveName()} placeholder="Ex.: Prof. Marcos Teixeira" />
        </div>
      </section>

      {message && <div className={`notice ${message.tone === 'error' ? 'error' : 'info'}`}>{message.text}</div>}

      <section className="club-grid" aria-label="Meus clubes">
        {!sync.clubsLoaded && sync.clubs.length === 0 && <div className="club-card skeleton">Carregando clubes…</div>}
        {sync.clubs.map((club) => (
          <button className="club-card" key={club.id} onClick={() => sync.enterClub(club.id)} type="button">
            <span className="club-badge">{(club.name || 'C').slice(0, 1).toUpperCase()}</span>
            <span className="club-copy"><strong>{club.name || 'Clube sem nome'}</strong><small>{ROLE_LABEL[club.role]} · {club.athletes} atleta{club.athletes === 1 ? '' : 's'} · {club.evaluations} avaliaç{club.evaluations === 1 ? 'ão' : 'ões'}</small></span>
            <ChevronRight size={20} className="club-arrow" />
          </button>
        ))}
        {sync.clubsLoaded && sync.canCreate && (creating ? (
          <form className="club-card club-form" onSubmit={create}>
            <div className="club-form-head"><strong>Novo clube</strong><button className="icon-button" onClick={() => setCreating(false)} type="button" aria-label="Cancelar"><X size={16} /></button></div>
            <input autoFocus required value={clubName} onChange={(e) => setClubName(e.target.value)} placeholder="Nome do clube ou escolinha" aria-label="Nome do clube" />
            <button className="primary-button" disabled={busy} type="submit">{busy ? 'Criando…' : 'Criar clube'}</button>
          </form>
        ) : (
          <button className="club-card club-new" onClick={() => setCreating(true)} type="button">
            <span className="club-badge"><Plus size={18} /></span>
            <span className="club-copy"><strong>{sync.clubs.length ? 'Novo clube' : 'Criar meu primeiro clube'}</strong><small>Cada clube tem as categorias Sub-15, Sub-16, Sub-17 e Sub-20</small></span>
          </button>
        ))}
      </section>

      <section className="profile-join">
        {joining ? (
          <form className="invite-row" onSubmit={join}>
            <input autoFocus value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Código do convite" aria-label="Código do convite" maxLength={12} />
            <button className="secondary-button" disabled={busy || !code.trim()} type="submit"><KeyRound size={15} /> Entrar no clube</button>
          </form>
        ) : <button className="link-button" onClick={() => setJoining(true)} type="button">Tenho um código de convite</button>}
      </section>
      {adminCount > 0 && <p className="perf-note profile-foot">Você administra {adminCount === 1 ? '1 clube' : `${adminCount} clubes`}.</p>}
    </main>
  )
}
