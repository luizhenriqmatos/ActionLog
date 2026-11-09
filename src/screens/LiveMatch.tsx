import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeftRight, Check, ChevronLeft, CloudOff, Copy, Crown, Flag, Minus, Pause, Play, Plus, RotateCcw, Square, Undo2, Users } from 'lucide-react'
import type { Athlete, CalendarEvent, CategoryId, SessionRecord } from '../types'
import { FINISHING_KEYS, GAME_KEYS, GAME_LABELS } from '../types'
import {
  GROUP_ORDER, PHASE_LABEL, PLAYER_ACTIONS, byTacticalOrder, groupOf, primaryPosition, SECTORS, TEAM_ACTIONS, activeEvents, actionLabel, clockSeconds, collective, formatClock, isPlayerAction,
  minuteLabel, minutesPlayed, playerTotals, roundMinutes, sessionTotals, suggestSector,
  type EventKind, type MatchEvent, type Period, type PlayerAction, type Sector, type TeamAction,
} from '../lib/match'
import {
  fetchMatchBundle, flushQueue, openMatch, pendingCount, pendingMatchOps, queuedEvents, queuedUndos, recordEvent, removeFromLineup,
  saveLineup, serverOffset, undoEvent, updateMatch, type MatchPatch, type MatchPlayer, type MatchRow,
} from '../lib/matchSync'

type Props = {
  teamId: string
  clubName: string
  category: CategoryId
  event: CalendarEvent
  athletes: Athlete[]
  user: { id: string; name: string }
  readOnly: boolean
  onClose: () => void
  onSessions: (sessions: SessionRecord[]) => void
}

type SectorFilter = Sector | 'ALL'
type LineupChoice = 'starter' | 'reserve' | 'out'

const POLL_MS = 5000

export function LiveMatch({ teamId, clubName, category, event, athletes, user, readOnly, onClose, onSessions }: Props) {
  const [match, setMatch] = useState<MatchRow | null>(null)
  const [players, setPlayers] = useState<MatchPlayer[]>([])
  const [serverEvents, setServerEvents] = useState<MatchEvent[]>([])
  const [localEvents, setLocalEvents] = useState<MatchEvent[]>([])
  const [localUndos, setLocalUndos] = useState<Map<string, string>>(new Map())
  const [offset, setOffset] = useState(0)
  const [now, setNow] = useState(Date.now())
  const [error, setError] = useState('')
  const [online, setOnline] = useState(true)
  const [pending, setPending] = useState(0)
  const pendingSince = useRef<number | null>(null)
  const [view, setView] = useState<'live' | 'lineup' | 'summary'>('live')
  const [sector, setSector] = useState<SectorFilter>(() => {
    try { return (localStorage.getItem(`actionlog_sector_${event.id}`) as SectorFilter) || 'ALL' } catch { return 'ALL' }
  })
  const [rosterAll, setRosterAll] = useState(false)
  const [subOut, setSubOut] = useState('')
  const [subIn, setSubIn] = useState('')
  const [historyOpen, setHistoryOpen] = useState(true)
  const [flash, setFlash] = useState('')
  const [toast, setToast] = useState('')
  const matchRef = useRef<MatchRow | null>(null)
  const eventRef = useRef(event)
  eventRef.current = event
  matchRef.current = match

  const serverNow = useCallback(() => Date.now() + offset, [offset])
  const serverIso = useCallback(() => new Date(Date.now() + offset).toISOString(), [offset])

  /* ---------- carregar e acompanhar ---------- */
  const refresh = useCallback(async () => {
    const current = matchRef.current
    if (!current) return
    try {
      const bundle = await fetchMatchBundle(current.id)
      setOnline(true)
      const busy = pendingMatchOps(current.id) > 0
      if (!busy) {
        setMatch(bundle.match)
        setPlayers(bundle.players)
      }
      setServerEvents(bundle.events)
      const serverIds = new Set(bundle.events.map((e) => e.id))
      setLocalEvents((list) => [...list.filter((e) => !serverIds.has(e.id)), ...queuedEvents(current.id).filter((e) => !serverIds.has(e.id))].filter((e, i, arr) => arr.findIndex((x) => x.id === e.id) === i))
      setLocalUndos(queuedUndos())
    } catch {
      setOnline(false)
    }
    setPending(pendingCount())
  }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [diff, opened] = await Promise.all([serverOffset(), openMatch(teamId, category, eventRef.current)])
        if (!alive) return
        setOffset(diff)
        let row = opened
        if (!row.commanderUserId && !readOnly) {
          const patch: MatchPatch = { commanderUserId: user.id, commanderName: user.name }
          updateMatch(row.id, patch, new Date(Date.now() + diff).toISOString())
          row = { ...row, ...patch }
        }
        setMatch(row)
        matchRef.current = row
        if (row.status === 'finished') setView('summary')
        await refresh()
        if (alive && row.status === 'preparing' && row.commanderUserId === user.id) {
          const bundle = await fetchMatchBundle(row.id).catch(() => null)
          if (alive && bundle && bundle.players.length === 0) setView('lineup')
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Não foi possível abrir o jogo.')
      }
    })()
    return () => { alive = false }
  }, [teamId, category, event.id, user.id, user.name, readOnly, refresh])

  useEffect(() => {
    const poll = window.setInterval(() => void refresh(), POLL_MS)
    const flush = window.setInterval(() => { void flushQueue().then(() => setPending(pendingCount())) }, 3000)
    const tick = window.setInterval(() => setNow(Date.now()), 250)
    const back = () => { setOnline(true); void flushQueue().then(() => refresh()) }
    const off = () => setOnline(false)
    window.addEventListener('online', back)
    window.addEventListener('offline', off)
    return () => { window.clearInterval(poll); window.clearInterval(flush); window.clearInterval(tick); window.removeEventListener('online', back); window.removeEventListener('offline', off) }
  }, [refresh])

  useEffect(() => { try { localStorage.setItem(`actionlog_sector_${event.id}`, sector) } catch { /* ignora */ } }, [sector, event.id])
  useEffect(() => { if (!toast) return; const t = window.setTimeout(() => setToast(''), 2600); return () => window.clearTimeout(t) }, [toast])

  /* ---------- derivados ---------- */
  const events = useMemo(() => {
    const ids = new Set(serverEvents.map((e) => e.id))
    return [...serverEvents, ...localEvents.filter((e) => !ids.has(e.id))]
      .map((e) => (localUndos.has(e.id) && !e.deletedAt ? { ...e, deletedAt: localUndos.get(e.id) as string } : e))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }, [serverEvents, localEvents, localUndos])

  const isCommander = Boolean(match && match.commanderUserId === user.id)
  const seconds = match ? clockSeconds(match, now + offset) : 0
  const totals = useMemo(() => playerTotals(events), [events])
  const team = useMemo(() => collective(events), [events])
  const myEvents = useMemo(() => activeEvents(events).filter((e) => e.createdBy === user.id && (isPlayerAction(e.kind) || TEAM_ACTIONS.some((t) => t.kind === e.kind))), [events, user.id])
  const onField = players.filter((p) => p.onField)
  const visible = onField.filter((p) => sector === 'ALL' || p.sector === sector).sort(byNumber)
  if (pending > 0 && pendingSince.current === null) pendingSince.current = now
  if (pending === 0) pendingSince.current = null
  const showPending = !online || (pending > 0 && pendingSince.current !== null && now - pendingSince.current > 4000)
  const canRecord = Boolean(match) && !readOnly && match?.status !== 'finished'
  const history = useMemo(() => activeEvents(events).filter((e) => e.kind !== 'period_start').sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [events])
  const wholeSecond = Math.floor(seconds)
  const liveMinutes = useMemo(() => {
    if (!match) return new Map<string, number>()
    const live = match.phase === 'first' || match.phase === 'second' ? { period: match.period, seconds: wholeSecond } : undefined
    return minutesPlayed(players, events, live)
    // recalcula a cada segundo do relógio, não a cada quadro
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players, events, match?.phase, match?.period, Math.floor(wholeSecond / 15)])

  /** O "−" desfaz o último evento ainda válido daquela ação para aquele atleta, registrado por este celular. */
  const lastMine = (athleteId: string, kind: PlayerAction) => {
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const e = events[i]
      if (!e.deletedAt && e.athleteId === athleteId && e.kind === kind && e.createdBy === user.id) return e
    }
    return null
  }
  const canUndo = (athleteId: string, kind: PlayerAction) => canRecord && lastMine(athleteId, kind) !== null

  /* ---------- ações ---------- */
  function stamp(): { period: Period; clockSeconds: number } {
    if (!match) return { period: 1, clockSeconds: 0 }
    if (match.phase === 'break') return { period: 2, clockSeconds: 0 }
    if (match.phase === 'done') return { period: 2, clockSeconds: seconds }
    return { period: match.period, clockSeconds: seconds }
  }

  function record(kind: EventKind, athleteId: string | null, at = stamp()) {
    if (!match) return null
    const created = recordEvent({ matchId: match.id, teamId, userId: user.id, userName: user.name, kind, athleteId, period: at.period, clockSeconds: at.clockSeconds, createdAt: serverIso() })
    setLocalEvents((list) => [...list, created])
    setPending(pendingCount())
    return created
  }

  function tap(kind: PlayerAction | TeamAction, athleteId: string | null) {
    if (!canRecord) return
    record(kind, athleteId)
    const key = `${athleteId ?? 'team'}:${kind}`
    setFlash(key)
    window.setTimeout(() => setFlash((f) => (f === key ? '' : f)), 260)
    try { navigator.vibrate?.(12) } catch { /* sem vibração */ }
  }

  function undoMine() {
    const last = myEvents[myEvents.length - 1]
    if (!last) return
    const at = serverIso()
    undoEvent(last.id, at)
    setLocalUndos((m) => new Map(m).set(last.id, at))
    setToast(`Desfeito: ${actionLabel(last.kind)}${last.athleteId ? ` · ${nameOf(last.athleteId)}` : ''}`)
  }

  function undoAction(athleteId: string, kind: PlayerAction) {
    const last = lastMine(athleteId, kind)
    if (!last) return
    const at = serverIso()
    undoEvent(last.id, at)
    setLocalUndos((m) => new Map(m).set(last.id, at))
    try { navigator.vibrate?.(8) } catch { /* sem vibração */ }
  }

  async function copyReport() {
    if (!match) return
    const text = reportText(match, players, events, clubName, event.date)
    try {
      await navigator.clipboard.writeText(text)
      setToast('Relatório copiado')
    } catch {
      const area = document.createElement('textarea')
      area.value = text
      document.body.appendChild(area)
      area.select()
      try { document.execCommand('copy'); setToast('Relatório copiado') } catch { setToast('Não foi possível copiar') }
      area.remove()
    }
  }

  function patchMatch(patch: MatchPatch) {
    if (!match) return
    const at = serverIso()
    updateMatch(match.id, patch, at)
    setMatch({ ...match, ...patch, updatedAt: at })
    setPending(pendingCount())
  }

  const nameOf = (athleteId: string) => players.find((p) => p.athleteId === athleteId)?.athleteName ?? athletes.find((a) => a.id === athleteId)?.name ?? '—'

  /* ---------- cronômetro (comando) ---------- */
  function startPeriod(period: Period) {
    if (!match) return
    if (period === 1 && players.filter((p) => p.starter).length === 0) { setToast('Monte a relação com pelo menos 1 titular'); setView('lineup'); return }
    record('period_start', null, { period, clockSeconds: 0 })
    patchMatch({ status: 'live', phase: period === 1 ? 'first' : 'second', period, clockRunning: true, clockStartedAt: serverIso(), clockBaseSeconds: 0 })
  }
  function pause() { patchMatch({ clockRunning: false, clockStartedAt: null, clockBaseSeconds: seconds }) }
  function resume() { patchMatch({ clockRunning: true, clockStartedAt: serverIso(), clockBaseSeconds: seconds }) }
  function endPeriod() {
    if (!match) return
    const period = match.period
    if (!window.confirm(`Encerrar o ${period === 1 ? '1º' : '2º'} tempo em ${formatClock(seconds)}?`)) return
    record('period_end', null, { period, clockSeconds: seconds })
    patchMatch({ phase: period === 1 ? 'break' : 'done', clockRunning: false, clockStartedAt: null, clockBaseSeconds: seconds })
  }
  function adjustClock(total: number) {
    if (!match) return
    patchMatch({ clockBaseSeconds: Math.max(0, total), clockStartedAt: match.clockRunning ? serverIso() : null })
  }
  function resetClock() {
    if (!match) return
    if (!window.confirm(`Zerar o cronômetro do ${match.period === 1 ? '1º' : '2º'} tempo? As ações já registradas não mudam.`)) return
    patchMatch({ clockBaseSeconds: 0, clockStartedAt: match.clockRunning ? serverIso() : null })
  }

  function takeCommand() {
    if (readOnly) return
    if (!window.confirm(`Assumir o comando do jogo${match?.commanderName ? ` (hoje com ${match.commanderName})` : ''}?`)) return
    patchMatch({ commanderUserId: user.id, commanderName: user.name })
    setToast('Você comanda o jogo')
  }

  /* ---------- substituição ---------- */
  function substitute(outId: string, inId: string) {
    if (!match) return
    const at = stamp()
    record('sub_out', outId, at)
    record('sub_in', inId, at)
    const next = players.map((p) => (p.athleteId === outId ? { ...p, onField: false } : p.athleteId === inId ? { ...p, onField: true } : p))
    setPlayers(next)
    saveLineup(match.id, teamId, next.filter((p) => p.athleteId === outId || p.athleteId === inId), serverIso())
    setToast(`${minuteLabel(at.period, at.clockSeconds)} · sai ${nameOf(outId)}, entra ${nameOf(inId)}`)
  }

  /* ---------- relação ---------- */
  function saveRelation(choices: Map<string, { choice: LineupChoice; sector: Sector }>) {
    if (!match) return
    const started = match.phase !== 'pre'
    const kept: MatchPlayer[] = []
    for (const athlete of athletes) {
      const pick = choices.get(athlete.id)
      if (!pick || pick.choice === 'out') continue
      const existing = players.find((p) => p.athleteId === athlete.id)
      const starter = started ? Boolean(existing?.starter) : pick.choice === 'starter'
      kept.push({
        athleteId: athlete.id, athleteName: athlete.name, number: athlete.number, positions: athlete.positions, dominantFoot: athlete.dominantFoot,
        sector: pick.sector, starter, onField: started ? Boolean(existing?.onField) : starter,
      })
    }
    if (!kept.some((p) => p.starter)) { setToast('Marque pelo menos 1 titular'); return }
    const removed = players.filter((p) => !kept.some((k) => k.athleteId === p.athleteId) && !(started && p.onField)).map((p) => p.athleteId)
    saveLineup(match.id, teamId, kept, serverIso())
    removeFromLineup(match.id, removed)
    setPlayers(kept)
    setView('live')
    setToast(`Relação salva: ${kept.filter((p) => p.starter).length} titulares, ${kept.filter((p) => !p.starter).length} reservas`)
  }

  /* ---------- finalizar ---------- */
  async function finishMatch() {
    if (!match) return
    if (!window.confirm('Finalizar o jogo e gerar o scout de cada atleta?')) return
    let all = events
    if (match.phase !== 'done') {
      if (match.phase === 'first' || match.phase === 'second') {
        const end = record('period_end', null, { period: match.period, clockSeconds: seconds })
        if (end) all = [...all, end]
      }
    }
    patchMatch({ status: 'finished', phase: 'done', clockRunning: false, clockStartedAt: null, clockBaseSeconds: seconds, sessionsGeneratedAt: serverIso() })
    await flushQueue()
    const fresh = await fetchMatchBundle(match.id).catch(() => null)
    if (fresh) {
      const ids = new Set(fresh.events.map((e) => e.id))
      all = [...fresh.events, ...all.filter((e) => !ids.has(e.id))]
    }
    onSessions(buildSessions(all))
    setView('summary')
    setToast('Jogo finalizado. Scout de cada atleta salvo em Desempenho.')
  }

  function buildSessions(all: MatchEvent[]): SessionRecord[] {
    if (!match) return []
    const minutes = minutesPlayed(players, all)
    const byPlayer = playerTotals(all)
    const createdAt = serverIso()
    return players
      .filter((p) => (minutes.get(p.athleteId) ?? 0) > 0 || byPlayer.has(p.athleteId))
      .map((p) => {
        const { totals: game } = sessionTotals(byPlayer.get(p.athleteId) ?? emptyGame())
        return {
          id: `match-${match.id}-${p.athleteId}`,
          createdAt, updatedAt: createdAt, category, mode: 'game' as const,
          athleteId: p.athleteId, athleteName: p.athleteName, dominantFootSnapshot: p.dominantFoot,
          calendarDate: event.date, periodizationTag: event.mdTag || 'MD', eventTitle: event.title, eventId: event.id, eventType: 'Jogo' as const,
          stats: { game, finishing: Object.fromEntries(FINISHING_KEYS.map((k) => [k, 0])) as SessionRecord['stats']['finishing'] },
          minutesPlayed: roundMinutes(minutes.get(p.athleteId) ?? 0), matchId: match.id, schemaVersion: 2 as const,
        }
      })
  }

  /* ---------- telas ---------- */
  if (error) {
    return <div className="live-shell"><div className="live-error"><AlertTriangle size={20} /><strong>Não foi possível abrir o jogo</strong><p>{error}</p><button className="secondary-button" onClick={onClose} type="button">Voltar</button></div></div>
  }
  if (!match) {
    return <div className="live-shell"><div className="live-loading">Abrindo o jogo…</div></div>
  }

  const scoreFor = team.goalsFor
  const scoreAgainst = team.goalsAgainst
  const running = match.clockRunning

  const inPlay = match.phase === 'first' || match.phase === 'second'
  const periodText = inPlay ? (match.period === 1 ? '1ºT' : '2ºT') : PHASE_LABEL[match.phase]
  const filtered = (list: MatchPlayer[]) => list.filter((p) => sector === 'ALL' || p.sector === sector).sort(byTacticalOrder)
  const fieldList = filtered(onField)
  const benchList = filtered(players.filter((p) => !p.onField))
  const groups = GROUP_ORDER.map((g) => ({ group: g, list: fieldList.filter((p) => groupOf(p.positions) === g) })).filter((g) => g.list.length)

  return (
    <div className="live-shell">
      <header className="live-bar">
        <div className="live-bar-top">
          <button className="icon-button" onClick={onClose} type="button" aria-label="Sair do jogo"><ChevronLeft size={18} /></button>
          <div className="live-score" aria-label={`Placar: ${clubName} ${scoreFor} a ${scoreAgainst} ${match.opponent}`}>
            <span className="live-team">{clubName || 'Nós'}</span>
            <strong>{scoreFor}<i>×</i>{scoreAgainst}</strong>
            <span className="live-team">{match.opponent || 'Adversário'}</span>
          </div>
          <div className={`live-clock big ${running ? 'running' : inPlay ? 'paused' : ''}`} role="timer" aria-live="off" aria-label={`${periodText} ${formatClock(seconds)}${inPlay && !running ? ', pausado' : ''}`}>
            <small>{periodText}{inPlay && !running ? ' · pausado' : ''}</small>
            <strong>{formatClock(seconds)}</strong>
          </div>
        </div>
        {isCommander && match.status !== 'finished' && view === 'live' && (
          <div className="clock-controls" aria-label="Controles do cronômetro">
            {match.phase === 'pre' && <button className="primary-button" onClick={() => startPeriod(1)} type="button"><Play size={16} /> Iniciar 1ºT</button>}
            {match.phase === 'break' && <button className="primary-button" onClick={() => startPeriod(2)} type="button"><Play size={16} /> Iniciar 2ºT</button>}
            {inPlay && (running
              ? <button className="secondary-button" onClick={pause} type="button"><Pause size={16} /> Pausar</button>
              : <button className="primary-button" onClick={resume} type="button"><Play size={16} /> Retomar</button>)}
            {inPlay && <button className="secondary-button" onClick={endPeriod} type="button"><Square size={13} /> Encerrar {match.period === 1 ? '1ºT' : '2ºT'}</button>}
            {inPlay && <ClockAdjust seconds={seconds} onSave={adjustClock} onReset={resetClock} />}
          </div>
        )}
        <div className="live-bar-meta">
          {isCommander ? <span className="live-command me"><Crown size={13} /> Você comanda</span> : <span className="live-command"><Crown size={13} /> Comando: {match.commanderName || '—'}</span>}
          {!isCommander && !readOnly && match.status !== 'finished' && <button className="link-button" onClick={takeCommand} type="button">Assumir comando</button>}
          {showPending && <span className="live-pending"><CloudOff size={13} /> {pending > 0 ? `${pending} aguardando envio` : 'sem conexão'}</span>}
        </div>
      </header>

      {readOnly && <p className="live-note">Seu acesso é só de leitura: você acompanha, mas não registra ações.</p>}

      {view === 'lineup' && isCommander && (
        <LineupEditor athletes={athletes} players={players} started={match.phase !== 'pre'} onSave={saveRelation} onCancel={() => setView('live')} />
      )}

      {view === 'summary' && (
        <MatchSummary match={match} players={players} events={events} clubName={clubName} onBack={match.status === 'finished' ? onClose : () => setView('live')} finished={match.status === 'finished'} />
      )}

      {view === 'live' && (
        <div className="live-grid">
          <aside className="live-col live-col-left">
            <section className="panel roster-panel" aria-label="Elenco do jogo">
              <div className="panel-head"><strong>Elenco</strong><small>{onField.length} em campo · {players.length} na relação</small>{isCommander && <button className="secondary-button compact" onClick={() => setView('lineup')} type="button"><Users size={14} /> Relação</button>}</div>
              <div className="seg roster-seg" role="tablist">
                <button role="tab" aria-selected={!rosterAll} className={!rosterAll ? 'on' : ''} onClick={() => setRosterAll(false)} type="button">Em campo ({onField.length})</button>
                <button role="tab" aria-selected={rosterAll} className={rosterAll ? 'on' : ''} onClick={() => setRosterAll(true)} type="button">Todos ({players.length})</button>
              </div>
              <ul className="roster-list">
                {(rosterAll ? [...players] : onField).sort(byTacticalOrder).map((p) => (
                  <li key={p.athleteId} className={p.onField ? 'on' : ''}><span className="live-number">{p.number || '—'}</span><strong>{p.athleteName}</strong><small>{primaryPosition(p.positions) ?? '—'}</small>{p.onField && <Check size={14} aria-label="em campo" />}</li>
                ))}
              </ul>
            </section>
          </aside>

          <main className="live-col live-col-center">
            <div className="sector-chips" role="tablist" aria-label="Filtrar por setor">
              {[{ id: 'ALL' as const, label: 'Todos' }, ...SECTORS].map((s) => (
                <button key={s.id} role="tab" aria-selected={sector === s.id} className={sector === s.id ? 'active' : ''} onClick={() => setSector(s.id)} type="button">
                  {s.label}<b>{s.id === 'ALL' ? onField.length : onField.filter((p) => p.sector === s.id).length}</b>
                </button>
              ))}
            </div>

            {players.length === 0 ? (
              <div className="live-empty">{isCommander ? <><p>Monte a relação do jogo para começar.</p><button className="primary-button" onClick={() => setView('lineup')} type="button"><Users size={16} /> Montar relação</button></> : <p>Aguardando o comando montar a relação. A tela atualiza sozinha.</p>}</div>
            ) : fieldList.length === 0 ? (
              <div className="live-empty"><p>Nenhum atleta em campo neste setor.</p></div>
            ) : (
              <div className="live-players">
                {groups.map(({ group, list }) => (
                  <section key={group} className="pos-group" aria-label={group}>
                    <h3 className="pos-title">{group}</h3>
                    {list.map((p) => <PlayerCard key={p.athleteId} player={p} totals={totals.get(p.athleteId)} minutes={liveMinutes.get(p.athleteId) ?? 0} canRecord={canRecord} flash={flash} canUndo={(kind) => canUndo(p.athleteId, kind)} onPlus={(kind) => tap(kind, p.athleteId)} onMinus={(kind) => undoAction(p.athleteId, kind)} />)}
                  </section>
                ))}
              </div>
            )}

            {benchList.length > 0 && (
              <details className="bench">
                <summary>Reservas <b>{benchList.length}</b></summary>
                <div className="live-players">
                  {benchList.map((p) => <PlayerCard key={p.athleteId} player={p} totals={totals.get(p.athleteId)} minutes={liveMinutes.get(p.athleteId) ?? 0} canRecord={false} flash="" canUndo={() => false} onPlus={() => {}} onMinus={() => {}} />)}
                </div>
              </details>
            )}

            <section className="panel stats-panel order-stats" aria-label="Estatísticas da partida">
              <div className="panel-head"><strong>Estatísticas da partida</strong></div>
              <StatsTable events={events} />
            </section>
          </main>

          <aside className="live-col live-col-right">
            <section className="panel order-team" aria-label="Ações coletivas">
              <div className="panel-head"><strong>Ações coletivas</strong><small>equipe</small></div>
              <div className="live-team-actions">
                {TEAM_ACTIONS.map((a) => {
                  const value = a.kind === 'corner_for' ? team.cornersFor : a.kind === 'corner_against' ? team.cornersAgainst : team.goalsAgainst
                  const label = a.kind === 'corner_for' ? 'Escanteio a favor' : a.kind === 'corner_against' ? 'Escanteio contra' : 'Gol sofrido'
                  return isCommander && canRecord
                    ? <button key={a.kind} className={`team-action ${a.kind} ${flash === `team:${a.kind}` ? 'flash' : ''}`} onClick={() => tap(a.kind, null)} type="button" aria-label={`${label}: registrar`}><span>{label}</span><b>{value}</b></button>
                    : <div key={a.kind} className={`team-action ${a.kind} readonly`}><span>{label}</span><b>{value}</b></div>
                })}
              </div>
              {!isCommander && <p className="live-muted">Escanteios e gol sofrido: só o comando registra.</p>}
            </section>

            {isCommander && match.status !== 'finished' && (
              <section className="panel order-subs" aria-label="Substituições">
                <div className="panel-head"><strong>Substituições</strong><small>{match.phase === 'pre' ? 'depois do início' : minuteLabel(stamp().period, stamp().clockSeconds)}</small><button className="secondary-button compact" onClick={() => setView('lineup')} type="button"><Users size={14} /> Relação</button></div>
                <div className="sub-inline">
                  <label><span>Sai do campo</span><select className="chip-select" value={subOut} onChange={(e) => setSubOut(e.target.value)}><option value="">Selecione</option>{[...onField].sort(byTacticalOrder).map((p) => <option key={p.athleteId} value={p.athleteId}>{p.number ? `${p.number} · ` : ''}{p.athleteName}</option>)}</select></label>
                  <label><span>Entra em campo</span><select className="chip-select" value={subIn} onChange={(e) => setSubIn(e.target.value)}><option value="">Selecione</option>{players.filter((p) => !p.onField).sort(byTacticalOrder).map((p) => <option key={p.athleteId} value={p.athleteId}>{p.number ? `${p.number} · ` : ''}{p.athleteName}</option>)}</select></label>
                </div>
                <button className="primary-button full-button" disabled={!subOut || !subIn || match.phase === 'pre'} onClick={() => { substitute(subOut, subIn); setSubOut(''); setSubIn('') }} type="button"><ArrowLeftRight size={16} /> Registrar substituição</button>
              </section>
            )}

            <section className="panel order-history" aria-label="Histórico de eventos">
              <div className="panel-head"><strong>Histórico de eventos</strong><small>{history.length}</small><button className="secondary-button compact" onClick={() => setHistoryOpen((v) => !v)} type="button">{historyOpen ? 'Ocultar' : 'Mostrar'}</button></div>
              {historyOpen && (history.length === 0 ? <p className="live-muted">Nenhum evento ainda.</p> : (
                <ol className="timeline">{history.slice(0, 80).map((e) => <li key={e.id} className={e.createdBy === user.id ? 'mine' : ''}><span>{minuteLabel(e.period, e.clockSeconds)}</span><strong>{actionLabel(e.kind)}</strong><small>{e.athleteId ? nameOf(e.athleteId) : 'Equipe'}{e.createdByName ? ` · ${e.createdBy === user.id ? 'você' : e.createdByName}` : ''}</small></li>)}</ol>
              ))}
            </section>
          </aside>
        </div>
      )}

      {view === 'live' && (
        <footer className="live-footer">
          <button onClick={undoMine} disabled={!myEvents.length || !canRecord} type="button"><Undo2 size={16} /><span>Desfazer meu último</span></button>
          <button onClick={() => setView('summary')} type="button"><Flag size={16} /><span>Resumo</span></button>
          <button onClick={() => void copyReport()} type="button"><Copy size={16} /><span>Copiar relatório</span></button>
          {isCommander && match.status !== 'finished' && <button className="finish" onClick={() => void finishMatch()} type="button"><Check size={16} /><span>Finalizar partida</span></button>}
          {match.status === 'finished' && <button onClick={() => setView('summary')} type="button"><Check size={16} /><span>Jogo finalizado</span></button>}
        </footer>
      )}

      {toast && <div className="toast live-toast"><Check size={16} /> {toast}</div>}
    </div>
  )
}

const byNumber = (a: MatchPlayer, b: MatchPlayer) => (Number(a.number) || 999) - (Number(b.number) || 999) || a.athleteName.localeCompare(b.athleteName)
const emptyGame = () => Object.fromEntries(GAME_KEYS.map((k) => [k, 0])) as SessionRecord['stats']['game']

/* ---------- relação ---------- */
function LineupEditor({ athletes, players, started, onSave, onCancel }: { athletes: Athlete[]; players: MatchPlayer[]; started: boolean; onSave: (c: Map<string, { choice: LineupChoice; sector: Sector }>) => void; onCancel: () => void }) {
  const [choices, setChoices] = useState(() => new Map(athletes.map((a) => {
    const p = players.find((x) => x.athleteId === a.id)
    return [a.id, { choice: (p ? (p.starter ? 'starter' : 'reserve') : players.length ? 'out' : 'reserve') as LineupChoice, sector: p?.sector ?? suggestSector(a.positions) }]
  })))
  const set = (id: string, patch: Partial<{ choice: LineupChoice; sector: Sector }>) => setChoices((m) => new Map(m).set(id, { ...(m.get(id) as { choice: LineupChoice; sector: Sector }), ...patch }))
  const starters = [...choices.values()].filter((c) => c.choice === 'starter').length
  const reserves = [...choices.values()].filter((c) => c.choice === 'reserve').length
  const sorted = [...athletes].sort(byTacticalOrder)
  return (
    <section className="lineup">
      <div className="lineup-head">
        <div><strong>Relação do jogo</strong><small>{starters} titulares · {reserves} reservas{started ? ' · jogo em andamento: titulares travados' : ''}</small></div>
      </div>
      {athletes.length === 0 && <p className="live-muted">Cadastre atletas no Elenco desta categoria primeiro.</p>}
      <ul className="lineup-list">
        {sorted.map((a) => {
          const c = choices.get(a.id) as { choice: LineupChoice; sector: Sector }
          return (
            <li key={a.id} className={`lineup-row ${c.choice}`}>
              <div className="lineup-name"><span className="live-number">{a.number || '—'}</span><span><strong>{a.name}</strong><small>{a.positions || 'sem posição'}</small></span></div>
              <div className="lineup-controls">
                <div className="seg" role="radiogroup" aria-label={`Situação de ${a.name}`}>
                  {(['starter', 'reserve', 'out'] as LineupChoice[]).map((opt) => (
                    <button key={opt} role="radio" aria-checked={c.choice === opt} className={c.choice === opt ? 'on' : ''} disabled={started && (opt === 'starter' || c.choice === 'starter')} onClick={() => set(a.id, { choice: opt })} type="button">
                      {opt === 'starter' ? 'Titular' : opt === 'reserve' ? 'Reserva' : 'Fora'}
                    </button>
                  ))}
                </div>
                <select className="chip-select" value={c.sector} onChange={(e) => set(a.id, { sector: e.target.value as Sector })} aria-label={`Setor de ${a.name}`} disabled={c.choice === 'out'}>
                  {SECTORS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>
            </li>
          )
        })}
      </ul>
      <div className="lineup-actions">
        {players.length > 0 && <button className="secondary-button" onClick={onCancel} type="button">Cancelar</button>}
        <button className="primary-button" onClick={() => onSave(choices)} disabled={starters === 0 && !started} type="button"><Check size={16} /> Salvar relação</button>
      </div>
    </section>
  )
}

/* ---------- resumo ---------- */
function MatchSummary({ match, players, events, clubName, finished, onBack }: { match: MatchRow; players: MatchPlayer[]; events: MatchEvent[]; clubName: string; finished: boolean; onBack: () => void }) {
  const live = match.phase === 'first' || match.phase === 'second' ? { period: match.period, seconds: clockSeconds(match, Date.now()) } : undefined
  const minutes = minutesPlayed(players, events, live)
  const first = collective(events, 1)
  const second = collective(events, 2)
  const total = collective(events)
  const byPlayer = playerTotals(events)
  const rows = players.filter((p) => (minutes.get(p.athleteId) ?? 0) > 0 || byPlayer.has(p.athleteId)).sort(byTacticalOrder)
  const warnings = rows.flatMap((p) => sessionTotals(byPlayer.get(p.athleteId) ?? emptyGame()).warnings.map((w) => `${p.athleteName}: ${w}`))
  const lines: Array<[string, (c: ReturnType<typeof collective>) => number]> = [
    ...GAME_KEYS.map((k) => [GAME_LABELS[k], (c: ReturnType<typeof collective>) => c[k]] as [string, (c: ReturnType<typeof collective>) => number]),
    ['Escanteios a favor', (c) => c.cornersFor], ['Escanteios contra', (c) => c.cornersAgainst], ['Gols sofridos', (c) => c.goalsAgainst],
  ]
  const timeline = activeEvents(events).filter((e) => e.kind !== 'period_start').sort((a, b) => a.period - b.period || a.clockSeconds - b.clockSeconds)
  return (
    <section className="summary">
      <div className="lineup-head"><div><strong>{finished ? 'Resumo do jogo' : 'Resumo parcial'}</strong><small>{clubName || 'Nós'} {total.goalsFor} × {total.goalsAgainst} {match.opponent}</small></div><button className="secondary-button compact" onClick={onBack} type="button">{finished ? 'Fechar' : 'Voltar ao jogo'}</button></div>
      {finished && <p className="live-note ok"><Check size={14} /> O scout de cada atleta foi salvo e aparece em Desempenho, no histórico e no relatório para os pais.</p>}
      {warnings.length > 0 && <div className="live-note warn"><AlertTriangle size={14} /><div><strong>Conferir (não bloqueia):</strong>{warnings.map((w) => <span key={w}>{w}</span>)}<small>Gol conta também como finalização no gol, e no gol como finalização.</small></div></div>}
      <h4>Coletivo</h4>
      <div className="table-wrap"><table className="perf-table summary-table"><thead><tr><th>Ação</th><th>1ºT</th><th>2ºT</th><th>Total</th></tr></thead><tbody>
        {lines.map(([label, get]) => <tr key={label}><td>{label}</td><td>{get(first)}</td><td>{get(second)}</td><td><strong>{get(total)}</strong></td></tr>)}
      </tbody></table></div>
      <h4>Por atleta</h4>
      <div className="table-wrap"><table className="perf-table summary-table"><thead><tr><th>Atleta</th><th>Min</th>{PLAYER_ACTIONS.map((a) => <th key={a.kind} title={a.label}>{a.short}</th>)}</tr></thead><tbody>
        {rows.map((p) => { const t = byPlayer.get(p.athleteId); return <tr key={p.athleteId}><td><strong>{p.number ? `${p.number} · ` : ''}{p.athleteName}</strong></td><td>{roundMinutes(minutes.get(p.athleteId) ?? 0)}'</td>{PLAYER_ACTIONS.map((a) => <td key={a.kind}>{t ? t[a.metric] : 0}</td>)}</tr> })}
      </tbody></table></div>
      <h4>Lance a lance</h4>
      <ol className="timeline">{timeline.map((e) => <li key={e.id}><span>{minuteLabel(e.period, e.clockSeconds)}</span><strong>{actionLabel(e.kind)}</strong><small>{e.athleteId ? players.find((p) => p.athleteId === e.athleteId)?.athleteName ?? '' : 'Time'}{e.createdByName ? ` · por ${e.createdByName}` : ''}</small></li>)}</ol>
    </section>
  )
}

/* ---------- cartão do atleta ---------- */
function PlayerCard({ player, totals, minutes, canRecord, flash, canUndo, onPlus, onMinus }: {
  player: MatchPlayer; totals: ReturnType<typeof playerTotals> extends Map<string, infer T> ? T | undefined : never; minutes: number; canRecord: boolean; flash: string
  canUndo: (kind: PlayerAction) => boolean; onPlus: (kind: PlayerAction) => void; onMinus: (kind: PlayerAction) => void
}) {
  const code = primaryPosition(player.positions)
  return (
    <article className={`live-player ${player.onField ? '' : 'benched'}`}>
      <header>
        <span className="live-number">{player.number || '—'}</span>
        <strong>{player.athleteName}</strong>
        <small className="pos-code">{code ?? 'sem posição'}</small>
        <b className="live-min" title="Minutos jogados">{roundMinutes(minutes)}'</b>
      </header>
      <div className="act-grid">
        {PLAYER_ACTIONS.map((a) => {
          const value = totals ? totals[a.metric] : 0
          return (
            <div key={a.kind} className={`act tone-${a.tone} ${flash === `${player.athleteId}:${a.kind}` ? 'flash' : ''}`}>
              <button className="act-minus" onClick={() => onMinus(a.kind)} disabled={!canUndo(a.kind)} type="button" aria-label={`Desfazer ${a.label}: ${player.athleteName}`}><Minus size={15} /></button>
              <button className="act-plus" onClick={() => onPlus(a.kind)} disabled={!canRecord} type="button" aria-label={`${a.label}: ${player.athleteName}`}>
                <span className="act-label"><span className="full">{a.label}</span><span className="short">{a.short}</span></span>
                <b className="act-value">{value}</b>
                <i className="act-icon" aria-hidden="true"><Plus size={15} /></i>
              </button>
            </div>
          )
        })}
      </div>
    </article>
  )
}

/* ---------- ajuste do cronômetro, em linha ---------- */
function ClockAdjust({ seconds, onSave, onReset }: { seconds: number; onSave: (total: number) => void; onReset: () => void }) {
  const [min, setMin] = useState('')
  const [sec, setSec] = useState('')
  const dirty = min !== '' || sec !== ''
  const save = () => {
    const m = min === '' ? Math.floor(seconds / 60) : Number(min) || 0
    const s = sec === '' ? seconds % 60 : Math.min(59, Number(sec) || 0)
    onSave(m * 60 + s)
    setMin('')
    setSec('')
  }
  return (
    <div className="clock-adjust">
      <label><span>Min</span><input inputMode="numeric" value={min} placeholder={String(Math.floor(seconds / 60))} onChange={(e) => setMin(e.target.value.replace(/\D/g, '').slice(0, 3))} aria-label="Minutos" /></label>
      <label><span>Seg</span><input inputMode="numeric" value={sec} placeholder={String(seconds % 60).padStart(2, '0')} onChange={(e) => setSec(e.target.value.replace(/\D/g, '').slice(0, 2))} aria-label="Segundos" /></label>
      <button className="icon-button" onClick={save} disabled={!dirty} type="button" aria-label="Confirmar ajuste do cronômetro"><Check size={16} /></button>
      <button className="icon-button" onClick={onReset} type="button" aria-label="Zerar cronômetro"><RotateCcw size={15} /></button>
    </div>
  )
}

/* ---------- tabela 1ºT | 2ºT | Total ---------- */
function StatsTable({ events }: { events: MatchEvent[] }) {
  const first = collective(events, 1)
  const second = collective(events, 2)
  const total = collective(events)
  type C = ReturnType<typeof collective>
  const lines: Array<[string, (c: C) => number]> = [
    ...PLAYER_ACTIONS.map((a) => [a.label, (c: C) => c[a.metric]] as [string, (c: C) => number]),
    ['Escanteio a favor', (c) => c.cornersFor], ['Escanteio contra', (c) => c.cornersAgainst], ['Gol sofrido', (c) => c.goalsAgainst],
  ]
  return (
    <div className="table-wrap"><table className="perf-table summary-table"><thead><tr><th>Ação</th><th>1ºT</th><th>2ºT</th><th>Total</th></tr></thead><tbody>
      {lines.map(([label, get]) => <tr key={label}><td>{label}</td><td>{get(first)}</td><td>{get(second)}</td><td><strong>{get(total)}</strong></td></tr>)}
    </tbody></table></div>
  )
}

/* ---------- relatório em texto ---------- */
function reportText(match: MatchRow, players: MatchPlayer[], events: MatchEvent[], clubName: string, date: string) {
  const total = collective(events)
  const first = collective(events, 1)
  const second = collective(events, 2)
  const minutes = minutesPlayed(players, events)
  const byPlayer = playerTotals(events)
  const [y, m, d] = date.split('-')
  const lines = [
    `${clubName || 'Nós'} ${total.goalsFor} × ${total.goalsAgainst} ${match.opponent || 'Adversário'} · ${d}/${m}/${y}`,
    '',
    'COLETIVO (1ºT / 2ºT / Total)',
    ...PLAYER_ACTIONS.map((a) => `${a.label}: ${first[a.metric]} / ${second[a.metric]} / ${total[a.metric]}`),
    `Escanteio a favor: ${first.cornersFor} / ${second.cornersFor} / ${total.cornersFor}`,
    `Escanteio contra: ${first.cornersAgainst} / ${second.cornersAgainst} / ${total.cornersAgainst}`,
    '',
    'POR ATLETA',
    ...[...players].sort(byTacticalOrder).filter((p) => (minutes.get(p.athleteId) ?? 0) > 0 || byPlayer.has(p.athleteId)).map((p) => {
      const t = byPlayer.get(p.athleteId)
      const parts = PLAYER_ACTIONS.filter((a) => (t?.[a.metric] ?? 0) > 0).map((a) => `${a.label} ${t?.[a.metric]}`)
      return `${p.number ? `${p.number} ` : ''}${p.athleteName} (${primaryPosition(p.positions) ?? '—'}, ${roundMinutes(minutes.get(p.athleteId) ?? 0)}'): ${parts.join(', ') || 'sem ações'}`
    }),
  ]
  return lines.join('\n')
}
