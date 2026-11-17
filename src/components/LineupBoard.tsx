import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Shirt, Sparkles, X } from 'lucide-react'
import type { Athlete } from '../types'
import { byTacticalOrder, suggestSector, type Sector } from '../lib/match'
import type { MatchPlayer } from '../lib/matchSync'
import {
  DEFAULT_FORMATION, FORMATIONS, assignToSlot, changeFormation, formationById, formationOfSlot, isKnownSlot, placeLoose,
  removeFromSlots, slotLabel, slotSector, suggestAssignment, type Assignment,
} from '../lib/formation'

export type LineupChoice = 'starter' | 'reserve' | 'out'
export type LineupPick = { choice: LineupChoice; sector: Sector; slot: string | null }

type Props = {
  athletes: Athlete[]
  players: MatchPlayer[]
  started: boolean
  onSave: (picks: Map<string, LineupPick>, savePositions: boolean) => void
  /** Relação do último jogo da categoria, se houver. */
  loadLast?: () => Promise<MatchPlayer[]>
  onCancel: () => void
}

const firstName = (name: string) => (name.trim().split(/\s+/)[0] ?? '').slice(0, 10)

/** Escalação em campo (estilo FIFA/PES): toque no atleta e depois no lugar do campo. Quem não tem posição cadastrada é escalado aqui. */
export function LineupBoard({ athletes, players, started, onSave, onCancel, loadLast }: Props) {
  const [formationId, setFormationId] = useState(() => {
    const saved = players.find((p) => p.starter && isKnownSlot(p.slot))
    return saved?.slot ? formationOfSlot(saved.slot) : DEFAULT_FORMATION
  })
  const [assign, setAssign] = useState<Assignment>(() => {
    const first = players.find((p) => p.starter && isKnownSlot(p.slot))
    const formation = first?.slot ? formationOfSlot(first.slot) : DEFAULT_FORMATION
    let result: Assignment = {}
    const loose: MatchPlayer[] = []
    for (const p of players) {
      if (!p.starter) continue
      if (isKnownSlot(p.slot) && formationOfSlot(p.slot) === formation && !result[p.slot]) result = { ...result, [p.slot]: p.athleteId }
      else loose.push(p)
    }
    for (const p of loose) result = placeLoose(result, formation, p.athleteId, p.sector)
    return result
  })
  const [bench, setBench] = useState<Map<string, 'reserve' | 'out'>>(() => new Map(athletes.map((a) => {
    const p = players.find((x) => x.athleteId === a.id)
    return [a.id, p ? 'reserve' : players.length ? 'out' : 'reserve'] as const
  })))
  const [selected, setSelected] = useState<string | null>(null)
  const [savePositions, setSavePositions] = useState(true)
  const [lastMsg, setLastMsg] = useState('')
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null)
  const [hoverSlot, setHoverSlot] = useState<string | null>(null)
  const dragRef = useRef<{ id: string; sx: number; sy: number; active: boolean; pointer: number } | null>(null)
  const justDragged = useRef(false)

  const byId = useMemo(() => new Map(athletes.map((a) => [a.id, a])), [athletes])
  const formation = formationById(formationId)
  const lockedStarter = (id: string) => started && players.some((p) => p.athleteId === id && p.starter)
  const onPitch = new Set(Object.values(assign))
  const startersCount = onPitch.size + (started ? players.filter((p) => p.starter && !onPitch.has(p.athleteId)).length : 0)
  const tray = [...athletes].filter((a) => !onPitch.has(a.id) && !lockedStarter(a.id)).sort(byTacticalOrder)
  const reserves = tray.filter((a) => bench.get(a.id) !== 'out').length
  const selectedAthlete = selected ? byId.get(selected) : undefined
  const selectedOnPitch = selected ? onPitch.has(selected) : false

  function tapSlot(slotId: string) {
    if (started || justDragged.current) return
    const occupant = assign[slotId]
    if (selected) {
      setAssign((current) => assignToSlot(current, slotId, selected))
      setSelected(null)
    } else if (occupant) setSelected(occupant)
  }
  function pickFormation(id: string) {
    if (started) return
    const { assignment, displaced } = changeFormation(assign, id)
    setFormationId(id)
    setAssign(assignment)
    setBench((m) => { const next = new Map(m); displaced.forEach((d) => next.set(d, 'reserve')); return next })
    setSelected(null)
  }
  function suggest() {
    if (started) return
    const next = suggestAssignment([...athletes].sort(byTacticalOrder), formationId)
    setAssign(next)
    setSelected(null)
  }
  async function useLast() {
    if (started || !loadLast) return
    const last = await loadLast()
    const starters = last.filter((p) => p.starter && isKnownSlot(p.slot) && byId.has(p.athleteId))
    if (starters.length === 0) { setLastMsg('O último jogo não tem escalação em campo salva.'); return }
    const id = formationOfSlot(starters[0].slot as string)
    const next: Assignment = {}
    for (const p of starters) if (formationOfSlot(p.slot as string) === id && !next[p.slot as string]) next[p.slot as string] = p.athleteId
    setFormationId(id); setAssign(next); setSelected(null)
    setLastMsg(`Escalação do último jogo aplicada (${Object.keys(next).length} titulares). Ajuste o que mudou.`)
  }
  const missingPosition = Object.values(assign).filter((id) => !(byId.get(id)?.positions ?? '').trim()).length
  function setBenchState(id: string, state: 'reserve' | 'out') { setBench((m) => new Map(m).set(id, state)); setSelected(null) }
  function takeOff(id: string) { setAssign((current) => removeFromSlots(current, id)); setBench((m) => new Map(m).set(id, 'reserve')); setSelected(null) }

  /** Arrastar: mouse em qualquer lugar do atleta; no toque, só pela bolinha/número (o resto continua rolando a tela). */
  function startDrag(e: React.PointerEvent, id: string) {
    if (started || e.button > 0) return
    if (e.pointerType === 'touch' && !(e.target as HTMLElement).closest('[data-handle]')) return
    dragRef.current = { id, sx: e.clientX, sy: e.clientY, active: false, pointer: e.pointerId }
  }
  const slotAt = (x: number, y: number) => (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-slot]')?.dataset.slot ?? null
  const overTray = (x: number, y: number) => Boolean((document.elementFromPoint(x, y) as HTMLElement | null)?.closest('[data-tray]'))
  useEffect(() => {
    function move(e: PointerEvent) {
      const d = dragRef.current
      if (!d || e.pointerId !== d.pointer) return
      if (!d.active && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 8) return
      d.active = true
      e.preventDefault()
      setSelected(null)
      setDrag({ id: d.id, x: e.clientX, y: e.clientY })
      setHoverSlot(slotAt(e.clientX, e.clientY))
    }
    function up(e: PointerEvent) {
      const d = dragRef.current
      if (!d || e.pointerId !== d.pointer) return
      dragRef.current = null
      if (!d.active) return
      justDragged.current = true
      window.setTimeout(() => { justDragged.current = false }, 0)
      const slot = slotAt(e.clientX, e.clientY)
      if (slot) setAssign((cur) => assignToSlot(cur, slot, d.id))
      else if (overTray(e.clientX, e.clientY)) { setAssign((cur) => removeFromSlots(cur, d.id)); setBench((m) => new Map(m).set(d.id, 'reserve')) }
      setDrag(null)
      setHoverSlot(null)
    }
    function cancel() { dragRef.current = null; setDrag(null); setHoverSlot(null) }
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function save() {
    const picks = new Map<string, LineupPick>()
    for (const a of athletes) {
      const slot = Object.keys(assign).find((key) => assign[key] === a.id) ?? null
      const existing = players.find((p) => p.athleteId === a.id)
      if (slot) picks.set(a.id, { choice: 'starter', sector: slotSector(slot) ?? suggestSector(a.positions), slot })
      else if (lockedStarter(a.id)) picks.set(a.id, { choice: 'starter', sector: existing?.sector ?? suggestSector(a.positions), slot: existing?.slot ?? null })
      else picks.set(a.id, { choice: bench.get(a.id) ?? 'reserve', sector: existing?.sector ?? suggestSector(a.positions), slot: null })
    }
    onSave(picks, savePositions)
  }

  return (
    <section className="lineup board">
      <div className="lineup-head">
        <div>
          <strong>Escalação</strong>
          <small>{startersCount} titulares · {reserves} no banco{started ? ' · jogo em andamento: titulares travados' : ''}</small>
        </div>
        <div className="board-tools">
          <label className="board-formation"><span>Formação</span>
            <select value={formationId} onChange={(e) => pickFormation(e.target.value)} disabled={started} aria-label="Formação">
              {FORMATIONS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </label>
          {loadLast && !started && players.length === 0 && <button className="secondary-button" onClick={useLast} type="button">Último jogo</button>}<button className="secondary-button" onClick={suggest} disabled={started || athletes.length === 0} type="button"><Sparkles size={14} /> Sugerir</button>
        </div>
      </div>
      {athletes.length === 0 && <p className="live-muted">Cadastre atletas no Elenco desta categoria primeiro.</p>}

      <div className="board-layout">
      <div className="pitch" role="group" aria-label={`Campo, formação ${formation.label}`}>
        <i className="pitch-box top" /><i className="pitch-box bottom" /><i className="pitch-circle" />
        {formation.slots.map((slot) => {
          const athlete = byId.get(assign[slot.id] ?? '')
          const isSel = !!athlete && selected === athlete.id
          return (
            <button
              key={slot.id} type="button" disabled={started} data-slot={slot.id}
              onPointerDown={athlete ? (e) => startDrag(e, athlete.id) : undefined}
              className={`slot ${athlete ? 'filled' : 'empty'} ${isSel ? 'selected' : ''} ${selected && !isSel ? 'target' : ''} ${hoverSlot === slot.id ? 'hover' : ''} ${drag && athlete?.id === drag.id ? 'dragging' : ''}`}
              style={{ left: `${slot.x}%`, top: `${slot.y}%` }}
              onClick={() => tapSlot(slot.id)}
              aria-label={athlete ? `${slotLabel(slot.id)}: ${athlete.name}` : `${slotLabel(slot.id)}: vazio`}
            >
              <span className="slot-dot" data-handle>{athlete ? (athlete.number || firstName(athlete.name).slice(0, 1)) : '+'}</span>
              <span className="slot-name">{athlete ? firstName(athlete.name) : slot.code}</span>
              {athlete && <small className="slot-code">{slot.code}</small>}
            </button>
          )
        })}
      </div>

      <div className="board-side">
      {selectedAthlete ? (
        <div className="board-bar" role="status">
          <span><strong>{selectedAthlete.name}</strong>{selectedOnPitch ? ' · toque em outro lugar para trocar' : ' · toque num lugar do campo'}</span>
          {selectedOnPitch && !started && <button className="secondary-button" onClick={() => takeOff(selectedAthlete.id)} type="button"><Shirt size={14} /> Tirar do campo</button>}
          {!selectedOnPitch && (
            <>
              <button className={`chip-button ${bench.get(selectedAthlete.id) !== 'out' ? 'on' : ''}`} onClick={() => setBenchState(selectedAthlete.id, 'reserve')} type="button">Banco</button>
              <button className={`chip-button ${bench.get(selectedAthlete.id) === 'out' ? 'on' : ''}`} onClick={() => setBenchState(selectedAthlete.id, 'out')} type="button">Fora da relação</button>
            </>
          )}
          <button className="icon-button" onClick={() => setSelected(null)} type="button" aria-label="Cancelar seleção"><X size={14} /></button>
        </div>
      ) : (
        <p className="board-hint">{started ? 'Titulares não mudam com o jogo rolando. Use as substituições.' : 'Arraste o atleta da lista para o lugar dele no campo. Arraste um titular para outro lugar para trocar, ou de volta para a lista para tirar. Se preferir, toque no atleta e depois no lugar.'}</p>
      )}

      {lastMsg && <p className="board-hint" role="status">{lastMsg}</p>}
      {missingPosition > 0 && !started && <label className="board-check"><input type="checkbox" checked={savePositions} onChange={(e) => setSavePositions(e.target.checked)} /> Gravar a posição escolhida na ficha de {missingPosition} atleta{missingPosition > 1 ? 's' : ''} sem posição</label>}
      <ul className="board-tray" data-tray aria-label="Elenco fora do campo">
        {tray.map((a) => (
          <li key={a.id}>
            <button type="button" className={`tray-chip ${selected === a.id ? 'selected' : ''} ${bench.get(a.id) === 'out' ? 'out' : ''} ${drag?.id === a.id ? 'dragging' : ''}`} onPointerDown={(e) => startDrag(e, a.id)} onClick={() => { if (!justDragged.current) setSelected(selected === a.id ? null : a.id) }}>
              <span className="live-number" data-handle>{a.number || '—'}</span>
              <span className="tray-name"><strong>{a.name}</strong><small>{a.positions || 'sem posição'} · {bench.get(a.id) === 'out' ? 'fora' : 'banco'}</small></span>
            </button>
          </li>
        ))}
        {tray.length === 0 && athletes.length > 0 && <li className="live-muted">Todo o elenco está em campo.</li>}
      </ul>

      </div>
      </div>
      {drag && byId.get(drag.id) && <div className="drag-ghost" style={{ left: drag.x, top: drag.y }}><span className="slot-dot">{byId.get(drag.id)?.number || firstName(byId.get(drag.id)?.name ?? '').slice(0, 1)}</span><span className="slot-name">{firstName(byId.get(drag.id)?.name ?? '')}</span></div>}

      <div className="lineup-actions">
        {players.length > 0 && <button className="secondary-button" onClick={onCancel} type="button">Cancelar</button>}
        <button className="primary-button" onClick={save} disabled={startersCount === 0 && !started} type="button"><Check size={16} /> Salvar escalação</button>
      </div>
    </section>
  )
}
