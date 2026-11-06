import { useCallback, useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { type AppData, emptyAppData } from '../types'
import { supabase } from '../lib/supabase'
import {
  type Invite, type Member, type Role, type TeamInfo,
  acceptInvite, createInvite, ensureMyTeam, listInvites, listMembers, listMyTeams, mergeRemote, pullTeam, pushChanges,
  pushTeamName, removeMember, revokeInvite, setMemberRole,
} from '../lib/sync'

export type SyncStatus = 'disabled' | 'signed-out' | 'syncing' | 'synced' | 'offline' | 'error'

const SYNC_KEY = 'actionlog_sync_v1'
const INVITE_KEY = 'actionlog_pending_invite'
type Saved = { userId: string; teamId: string; pushed: Record<string, string>; lastSyncAt: string; pushedTeamName: string }

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
  const [teams, setTeams] = useState<TeamInfo[]>([])
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
      setSession((current) => (current?.user.id === next?.user.id && current?.access_token === next?.access_token ? current : next))
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

  const refreshTeams = useCallback(async () => {
    if (!supabase) return []
    const list = await listMyTeams(supabase)
    setTeams(list)
    return list
  }, [])

  // Ao entrar: aceita convite pendente, senão volta ao último time usado, senão cria o primeiro.
  useEffect(() => {
    if (!supabase) return
    if (!session) { setTeam(null); setTeams([]); setStatus('signed-out'); return }
    let cancelled = false
    ;(async () => {
      try {
        setStatus('syncing')
        if (saved.current.userId !== session.user.id) persist({ userId: session.user.id, teamId: '', pushed: {}, pushedTeamName: '' })
        let targetId = ''
        const code = pendingInvite
        if (code) {
          try {
            targetId = await acceptInvite(supabase!, code)
            setInviteError('')
          } catch (err) { setInviteError(errorText(err)) }
          try { window.sessionStorage.removeItem(INVITE_KEY) } catch { /* ignora */ }
          setPendingInvite('')
        }
        let list = await listMyTeams(supabase!)
        if (!targetId) targetId = list.find((t) => t.id === saved.current.teamId)?.id ?? list[0]?.id ?? ''
        if (!targetId) { targetId = await ensureMyTeam(supabase!, dataRef.current.teamName); list = await listMyTeams(supabase!) }
        if (cancelled) return
        setTeams(list)
        const chosen = list.find((t) => t.id === targetId)!
        if (saved.current.teamId && saved.current.teamId !== chosen.id) {
          // Entrou em outro time (ex.: convite): o aparelho passa a mostrar só os dados desse time.
          persist({ pushed: {}, pushedTeamName: '' })
          dataRef.current = emptyAppData(chosen.name)
          setData(() => dataRef.current)
        }
        persist({ teamId: chosen.id })
        setTeam(chosen)
      } catch (err) { if (!cancelled) fail(err) }
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

  /** Troca de time: envia o que falta do time atual e carrega o outro do zero. */
  const switchTeam = async (id: string) => {
    if (!team || id === team.id) return
    const next = teams.find((t) => t.id === id)
    if (!next) return
    await push()
    persist({ teamId: id, pushed: {}, pushedTeamName: '' })
    dataRef.current = emptyAppData(next.name)
    setData(() => dataRef.current)
    setTeam(next)
  }

  const joinWithCode = async (code: string) => {
    if (!supabase || !session) return 'Entre primeiro.'
    try {
      const id = await acceptInvite(supabase, code)
      const list = await refreshTeams()
      const next = list.find((t) => t.id === id)
      if (next && next.id !== team?.id) {
        await push()
        persist({ teamId: id, pushed: {}, pushedTeamName: '' })
        dataRef.current = emptyAppData(next.name)
        setData(() => dataRef.current)
        setTeam(next)
      }
      return ''
    } catch (err) { return errorText(err) }
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
    enabled: Boolean(supabase), session, status, error, team, teams, readOnly, lastSyncAt, pendingInvite, inviteError,
    recovery, dismissRecovery: () => setRecovery(false),
    syncNow: () => pull(), switchTeam, joinWithCode, refreshTeams, signIn, signUp, signOut, requestPasswordReset, setNewPassword, team$,
  }
}

function friendlyAuthError(message: string) {
  if (/rate limit|too many|security purposes/i.test(message)) return 'Muitos e-mails enviados em pouco tempo. Espere alguns minutos e tente de novo.'
  if (/not authorized/i.test(message)) return 'O servidor de e-mail ainda não está liberado para este endereço. Fale com o administrador do ActionLog.'
  if (/already registered|already exists/i.test(message)) return 'Este e-mail já tem conta. Use "Entrar" ou "Esqueci minha senha".'
  return message
}
