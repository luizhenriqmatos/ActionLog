import { useCallback, useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { type AppData, emptyAppData } from '../types'
import { supabase } from '../lib/supabase'
import {
  type Club, type Invite, type Member, type Role, type TeamInfo,
  acceptInvite, canCreateClub, createClub, createInvite, listInvites, listMembers, listMyClubs, mergeRemote, pullTeam, pushChanges,
  pushTeamName, removeMember, revokeInvite, setMemberRole,
} from '../lib/sync'

export type SyncStatus = 'disabled' | 'signed-out' | 'syncing' | 'synced' | 'offline' | 'error'

const SYNC_KEY = 'actionlog_sync_v1'
const INVITE_KEY = 'actionlog_pending_invite'
type Saved = { userId: string; teamId: string; pushed: Record<string, string>; lastSyncAt: string; pushedTeamName: string; clubs: Club[] }

function readSaved(): Partial<Saved> {
  try { return JSON.parse(window.localStorage.getItem(SYNC_KEY) ?? '{}') as Partial<Saved> } catch { return {} }
}
function writeSaved(value: Partial<Saved>) {
  try { window.localStorage.setItem(SYNC_KEY, JSON.stringify(value)) } catch { /* sem localStorage: sincroniza só nesta aba */ }
}

/** Lê ?convite=CÓDIGO do endereço, guarda até o login e limpa a barra de endereço. */
function captureInviteFromUrl(): string {
  try {
    const url = new URL(window.location.href)
    const code = url.searchParams.get('convite')
    if (code) {
      window.sessionStorage.setItem(INVITE_KEY, code.trim().toUpperCase())
      url.searchParams.delete('convite')
      window.history.replaceState(null, '', url.pathname + url.search + url.hash)
    }
    return window.sessionStorage.getItem(INVITE_KEY) ?? ''
  } catch { return '' }
}

export function errorText(err: unknown) {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message)
  return String(err)
}

export function useSync(data: AppData, setData: (updater: (previous: AppData) => AppData) => void) {
  const [session, setSession] = useState<Session | null>(null)
  const [status, setStatus] = useState<SyncStatus>(supabase ? 'signed-out' : 'disabled')
  const [error, setError] = useState('')
  const [team, setTeam] = useState<TeamInfo | null>(null)
  const [clubs, setClubs] = useState<Club[]>(() => readSaved().clubs ?? [])
  const [canCreate, setCanCreate] = useState(true)
  const [clubsLoaded, setClubsLoaded] = useState(false)
  const [pendingInvite, setPendingInvite] = useState(() => captureInviteFromUrl())
  const [inviteError, setInviteError] = useState('')
  const [recovery, setRecovery] = useState(false)
  const [lastSyncAt, setLastSyncAt] = useState(readSaved().lastSyncAt ?? '')
  const saved = useRef<Partial<Saved>>(readSaved())
  const dataRef = useRef(data)
  dataRef.current = data
  const busy = useRef(false)
  const again = useRef(false)

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data: result }) => setSession(result.session))
    const { data: listener } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
      setSession(next)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  const persist = (patch: Partial<Saved>) => {
    saved.current = { ...saved.current, ...patch }
    writeSaved(saved.current)
  }

  const fail = (err: unknown) => {
    const message = errorText(err)
    if (!navigator.onLine || /fetch|network/i.test(message)) { setStatus('offline'); setError('Sem conexão. Tudo fica salvo no aparelho e sobe quando a internet voltar.') }
    else { setStatus('error'); setError(message) }
  }

  const readOnly = team?.role === 'leitura'

  /** Envia mudanças locais. Se outra sincronização estiver rodando, agenda mais uma rodada. */
  const push = useCallback(async () => {
    if (!supabase || !team || team.role === 'leitura') return
    if (busy.current) { again.current = true; return }
    busy.current = true
    try {
      const current = dataRef.current
      const result = await pushChanges(supabase, team.id, current, saved.current.pushed ?? {})
      if (team.role === 'admin' && current.teamName && current.teamName !== saved.current.pushedTeamName) {
        await pushTeamName(supabase, team.id, current.teamName)
        persist({ pushedTeamName: current.teamName })
      }
      if (result.appliedTombstones.length) {
        const done = new Set(result.appliedTombstones)
        setData((previous) => ({ ...previous, tombstones: previous.tombstones.filter((t) => !done.has(`${t.kind}:${t.id}`)) }))
      }
      const now = new Date().toISOString()
      persist({ pushed: result.pushed, lastSyncAt: now })
      setLastSyncAt(now)
      setStatus('synced')
      setError('')
    } catch (err) { fail(err) } finally {
      busy.current = false
      if (again.current) { again.current = false; void push() }
    }
  }, [team, setData])

  /** Baixa do servidor, mescla com o aparelho e sobe o que ficou só aqui. */
  const pull = useCallback(async (target = team) => {
    if (!supabase || !target) return
    if (busy.current) { again.current = true; return }
    busy.current = true
    try {
      setStatus('syncing')
      const remote = await pullTeam(supabase, target.id)
      const { data: merged, fromServer } = mergeRemote(dataRef.current, remote, target.id)
      const pushed = { ...(saved.current.pushed ?? {}) }
      fromServer.forEach((print, key) => { pushed[key] = print })
      if (remote.teamName && target.role !== 'admin') merged.teamName = remote.teamName
      persist({ pushed, ...(remote.teamName && merged.teamName === remote.teamName ? { pushedTeamName: remote.teamName } : {}) })
      dataRef.current = merged
      setData(() => merged)
      if (target.role === 'leitura') {
        const now = new Date().toISOString()
        persist({ lastSyncAt: now }); setLastSyncAt(now); setStatus('synced'); setError('')
      }
    } catch (err) { fail(err) } finally {
      busy.current = false
    }
    await push()
  }, [team, setData, push])

  const refreshClubs = useCallback(async () => {
    if (!supabase) return [] as Club[]
    try {
      const [list, allowed] = await Promise.all([listMyClubs(supabase), canCreateClub(supabase)])
      setClubs(list)
      setCanCreate(allowed)
      persist({ clubs: list })
      setClubsLoaded(true)
      return list
    } catch (err) {
      fail(err)
      setClubsLoaded(true)
      return saved.current.clubs ?? []
    }
  }, [])

  /** Abre um clube. Se o aparelho tinha dados de outro clube, começa do zero e baixa os deste. */
  const enterClub = useCallback((id: string, list?: Club[]) => {
    const club = (list ?? clubs).find((c) => c.id === id)
    if (!club) return
    if (saved.current.teamId && saved.current.teamId !== id) {
      persist({ pushed: {}, pushedTeamName: '' })
      dataRef.current = emptyAppData(club.name)
      setData(() => dataRef.current)
    }
    persist({ teamId: id })
    setTeam({ id: club.id, name: club.name, role: club.role })
  }, [clubs, setData])

  // Ao entrar na conta: aceita convite pendente (e abre esse clube) e carrega a lista de clubes.
  useEffect(() => {
    if (!supabase) return
    if (!session) { setTeam(null); setClubsLoaded(false); setStatus('signed-out'); return }
    let cancelled = false
    ;(async () => {
      if (saved.current.userId && saved.current.userId !== session.user.id) persist({ userId: session.user.id, teamId: '', pushed: {}, pushedTeamName: '', clubs: [] })
      else persist({ userId: session.user.id })
      let joined = ''
      if (pendingInvite) {
        try { joined = await acceptInvite(supabase!, pendingInvite); setInviteError('') } catch (err) { setInviteError(errorText(err)) }
        try { window.sessionStorage.removeItem(INVITE_KEY) } catch { /* ignora */ }
        setPendingInvite('')
      }
      const list = await refreshClubs()
      if (cancelled) return
      setStatus('synced')
      if (joined) enterClub(joined, list)
    })()
    return () => { cancelled = true }
  }, [session?.user.id])

  useEffect(() => { if (team) void pull(team) }, [team?.id])

  // Mudança local: espera 1,5 s de calma e envia.
  useEffect(() => {
    if (!team) return
    const timer = window.setTimeout(() => { void push() }, 1500)
    return () => window.clearTimeout(timer)
  }, [data, team?.id])

  // Ao voltar para a aba, ao reconectar e a cada minuto: busca novidades de outros aparelhos.
  useEffect(() => {
    if (!team) return
    const refresh = () => { if (document.visibilityState === 'visible') void pull() }
    window.addEventListener('focus', refresh)
    window.addEventListener('online', refresh)
    const interval = window.setInterval(refresh, 60_000)
    return () => { window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh); window.clearInterval(interval) }
  }, [team?.id, pull])

  /** Volta para a lista de clubes: envia o que falta antes de sair. */
  const leaveClub = async () => {
    await push()
    setTeam(null)
    void refreshClubs()
  }

  const newClub = async (name: string) => {
    if (!supabase) return 'Indisponível.'
    try {
      const id = await createClub(supabase, name)
      const list = await refreshClubs()
      enterClub(id, list)
      return ''
    } catch (err) { return errorText(err) }
  }

  const joinWithCode = async (code: string) => {
    if (!supabase || !session) return 'Entre primeiro.'
    try {
      await push()
      const id = await acceptInvite(supabase, code)
      const list = await refreshClubs()
      enterClub(id, list)
      return ''
    } catch (err) { return errorText(err) }
  }

  const profileName = String((session?.user.user_metadata as { full_name?: string } | undefined)?.full_name ?? '')
  const setProfileName = async (name: string) => {
    if (!supabase) return 'Indisponível.'
    const { error: err } = await supabase.auth.updateUser({ data: { full_name: name.trim() } })
    return err ? friendlyAuthError(err.message) : ''
  }

  const signIn = async (email: string, password: string) => {
    if (!supabase) return 'Sincronização indisponível.'
    const { error: err } = await supabase.auth.signInWithPassword({ email, password })
    if (!err) return ''
    if (/confirm/i.test(err.message)) return 'Confirme o seu e-mail pelo link que enviamos antes de entrar.'
    if (/invalid/i.test(err.message)) return 'E-mail ou senha incorretos.'
    return friendlyAuthError(err.message)
  }

  const signUp = async (email: string, password: string) => {
    if (!supabase) return { error: 'Sincronização indisponível.', needsConfirmation: false }
    const { data: result, error: err } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } })
    if (err) return { error: /password/i.test(err.message) ? 'A senha precisa ter pelo menos 6 caracteres.' : friendlyAuthError(err.message), needsConfirmation: false }
    return { error: '', needsConfirmation: !result.session }
  }

  const requestPasswordReset = async (email: string) => {
    if (!supabase) return 'Sincronização indisponível.'
    const { error: err } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })
    return err ? friendlyAuthError(err.message) : ''
  }

  const setNewPassword = async (password: string) => {
    if (!supabase) return 'Sincronização indisponível.'
    const { error: err } = await supabase.auth.updateUser({ password })
    if (err) return /same/i.test(err.message) ? 'A nova senha precisa ser diferente da anterior.' : /password/i.test(err.message) ? 'A senha precisa ter pelo menos 6 caracteres.' : friendlyAuthError(err.message)
    setRecovery(false)
    return ''
  }

  const signOut = async () => {
    if (!supabase) return
    await supabase.auth.signOut()
  }

  const team$ = {
    members: () => (supabase && team ? listMembers(supabase, team.id) : Promise.resolve([] as Member[])),
    invites: () => (supabase && team && team.role === 'admin' ? listInvites(supabase, team.id) : Promise.resolve([] as Invite[])),
    invite: (role: Role) => createInvite(supabase!, team!.id, role),
    revoke: (id: string) => revokeInvite(supabase!, id),
    setRole: (userId: string, role: Role) => setMemberRole(supabase!, team!.id, userId, role),
    remove: (userId: string) => removeMember(supabase!, team!.id, userId),
  }

  return {
    enabled: Boolean(supabase), session, status, error, team, clubs, clubsLoaded, canCreate, readOnly, lastSyncAt, pendingInvite, inviteError,
    recovery, dismissRecovery: () => setRecovery(false), profileName, setProfileName,
    syncNow: () => pull(), enterClub, leaveClub, newClub, joinWithCode, refreshClubs, signIn, signUp, signOut, requestPasswordReset, setNewPassword, team$,
  }
}

function friendlyAuthError(message: string) {
  if (/rate limit|too many|security purposes/i.test(message)) return 'Muitos e-mails enviados em pouco tempo. Espere alguns minutos e tente de novo.'
  if (/not authorized/i.test(message)) return 'O servidor de e-mail ainda não está liberado para este endereço. Fale com o administrador do ActionLog.'
  if (/already registered|already exists/i.test(message)) return 'Este e-mail já tem conta. Use "Entrar" ou "Esqueci minha senha".'
  return message
}
