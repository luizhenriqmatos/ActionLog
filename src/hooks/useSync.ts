import { useCallback, useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { AppData } from '../types'
import { supabase } from '../lib/supabase'
import { findOrCreateTeam, mergeRemote, pullTeam, pushChanges, pushTeamName } from '../lib/sync'

export type SyncStatus = 'disabled' | 'signed-out' | 'syncing' | 'synced' | 'offline' | 'error'

const SYNC_KEY = 'actionlog_sync_v1'
type Saved = { userId: string; teamId: string; teamName: string; pushed: Record<string, string>; lastSyncAt: string; pushedTeamName: string }

function readSaved(): Partial<Saved> {
  try { return JSON.parse(window.localStorage.getItem(SYNC_KEY) ?? '{}') as Partial<Saved> } catch { return {} }
}
function writeSaved(value: Partial<Saved>) {
  try { window.localStorage.setItem(SYNC_KEY, JSON.stringify(value)) } catch { /* sem localStorage: sincroniza só nesta aba */ }
}

export function useSync(data: AppData, setData: (updater: (previous: AppData) => AppData) => void) {
  const [session, setSession] = useState<Session | null>(null)
  const [status, setStatus] = useState<SyncStatus>(supabase ? 'signed-out' : 'disabled')
  const [error, setError] = useState('')
  const [team, setTeam] = useState<{ id: string; name: string } | null>(null)
  const [lastSyncAt, setLastSyncAt] = useState(readSaved().lastSyncAt ?? '')
  const saved = useRef<Partial<Saved>>(readSaved())
  const dataRef = useRef(data)
  dataRef.current = data
  const busy = useRef(false)
  const again = useRef(false)

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data: result }) => setSession(result.session))
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => listener.subscription.unsubscribe()
  }, [])

  const persist = (patch: Partial<Saved>) => {
    saved.current = { ...saved.current, ...patch }
    writeSaved(saved.current)
  }

  const fail = (err: unknown) => {
    const message = err instanceof Error ? err.message : typeof err === 'object' && err && 'message' in err ? String((err as { message: unknown }).message) : String(err)
    if (!navigator.onLine || /fetch|network/i.test(message)) { setStatus('offline'); setError('Sem conexão. Tudo fica salvo no aparelho e sobe quando a internet voltar.') }
    else { setStatus('error'); setError(message) }
  }

  /** Envia mudanças locais. Se outra sincronização estiver rodando, agenda mais uma rodada. */
  const push = useCallback(async () => {
    if (!supabase || !team) return
    if (busy.current) { again.current = true; return }
    busy.current = true
    try {
      setStatus('syncing')
      const current = dataRef.current
      const result = await pushChanges(supabase, team.id, current, saved.current.pushed ?? {})
      if (current.teamName && current.teamName !== saved.current.pushedTeamName) {
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
      persist({ pushed, ...(remote.teamName ? { pushedTeamName: merged.teamName === remote.teamName ? remote.teamName : saved.current.pushedTeamName } : {}) })
      dataRef.current = merged
      setData(() => merged)
    } catch (err) { fail(err) } finally {
      busy.current = false
    }
    await push()
  }, [team, setData, push])

  // Ao entrar: acha (ou cria) o time e faz a primeira sincronização.
  useEffect(() => {
    if (!supabase) return
    if (!session) { setTeam(null); setStatus('signed-out'); return }
    let cancelled = false
    ;(async () => {
      try {
        setStatus('syncing')
        if (saved.current.userId !== session.user.id) persist({ userId: session.user.id, teamId: '', pushed: {}, pushedTeamName: '' })
        const found = await findOrCreateTeam(supabase!, session.user.id, dataRef.current.teamName)
        if (cancelled) return
        persist({ teamId: found.id, teamName: found.name })
        setTeam(found)
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

  const signIn = async (email: string, password: string) => {
    if (!supabase) return 'Sincronização indisponível.'
    const { error: err } = await supabase.auth.signInWithPassword({ email, password })
    if (!err) return ''
    if (/confirm/i.test(err.message)) return 'Confirme o seu e-mail pelo link que enviamos antes de entrar.'
    if (/invalid/i.test(err.message)) return 'E-mail ou senha incorretos.'
    return err.message
  }

  const signUp = async (email: string, password: string) => {
    if (!supabase) return { error: 'Sincronização indisponível.', needsConfirmation: false }
    const { data: result, error: err } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } })
    if (err) return { error: /password/i.test(err.message) ? 'A senha precisa ter pelo menos 6 caracteres.' : err.message, needsConfirmation: false }
    return { error: '', needsConfirmation: !result.session }
  }

  const signOut = async () => {
    if (!supabase) return
    await supabase.auth.signOut()
  }

  return { enabled: Boolean(supabase), session, status, error, team, lastSyncAt, syncNow: () => pull(), signIn, signUp, signOut }
}
