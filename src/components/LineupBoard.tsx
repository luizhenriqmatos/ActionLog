import { useMemo, useState } from 'react'
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
  onSave: (picks: Map<string, LineupPick>) => void
  onCancel: () => void
}

const firstName = (name: string) => (name.trim().split(/\s+/)[0] ?? '').slice(0, 10)

/** Escalação em campo (estilo FIFA/PES): toque no atleta e depois no lugar do campo. Quem não tem posição cadastrada é escalado aqui. */
export function LineupBoard({ athletes, players, started, onSave, onCancel }: Props) {
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
    if (started) return
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
  function setBenchState(id: string, state: 'reserve' | 'out') { setBench((m) => new Map(m).set(id, state)); setSelected(null) }
  function takeOff(id: string) { setAssign((current) => removeFromSlots(current, id)); setBench((m) => new Map(m).set(id, 'reserve')); setSelected(null) }

  function save() {
    const picks = new Map<string, LineupPick>()
    for (const a of athletes) {
      const slot = Object.keys(assign).find((key) => assign[key] === a.id) ?? null
      const existing = players.find((p) => p.athleteId === a.id)
      if (slot) picks.set(a.id, { choice: 'starter', sector: slotSector(slot) ?? suggestSector(a.positions), slot })
      else if (lockedStarter(a.id)) picks.set(a.id, { choice: 'starter', sector: existing?.sector ?? suggestSector(a.positions), slot: existing?.slot ?? null })
      else picks.set(a.id, { choice: bench.get(a.id) ?? 'reserve', sector: existing?.sector ?? suggestSector(a.positions), slot: null })
    }
    onSave(picks)
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
          <button className="secondary-button" onClick={suggest} disabled={started || athletes.length === 0} type="button"><Sparkles size={14} /> Sugerir</button>
        </div>
      </div>
      {athletes.length === 0 && <p className="live-muted">Cadastre atletas no Elenco desta categoria primeiro.</p>}

      <div className="pitch" role="group" aria-label={`Campo, formação ${formation.label}`}>
        <i className="pitch-box top" /><i className="pitch-box bottom" /><i className="pitch-circle" />
        {formation.slots.map((slot) => {
          const athlete = byId.get(assign[slot.id] ?? '')
          const isSel = !!athlete && selected === athlete.id
          return (
            <button
              key={slot.id} type="button" disabled={started}
              className={`slot ${athlete ? 'filled' : 'empty'} ${isSel ? 'selected' : ''} ${selected && !isSel ? 'target' : ''}`}
              style={{ left: `${slot.x}%`, top: `${slot.y}%` }}
              onClick={() => tapSlot(slot.id)}
              aria-label={athlete ? `${slotLabel(slot.id)}: ${athlete.name}` : `${slotLabel(slot.id)}: vazio`}
            >
              <span className="slot-dot">{athlete ? (athlete.number || firstName(athlete.name).slice(0, 1)) : '+'}</span>
              <span className="slot-name">{athlete ? firstName(athlete.name) : slot.code}</span>
              {athlete && <small className="slot-code">{slot.code}</small>}
            </button>
          )
        })}
      </div>

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
        <p className="board-hint">{started ? 'Titulares não mudam com o jogo rolando. Use as substituições.' : 'Toque num atleta da lista e depois no lugar dele no campo. Toque num titular para trocar de lugar.'}</p>
      )}

      <ul className="board-tray" aria-label="Elenco fora do campo">
        {tray.map((a) => (
          <li key={a.id}>
            <button type="button" className={`tray-chip ${selected === a.id ? 'selected' : ''} ${bench.get(a.id) === 'out' ? 'out' : ''}`} onClick={() => setSelected(selected === a.id ? null : a.id)}>
              <span className="live-number">{a.number || '—'}</span>
              <span className="tray-name"><strong>{a.name}</strong><small>{a.positions || 'sem posição'} · {bench.get(a.id) === 'out' ? 'fora' : 'banco'}</small></span>
            </button>
          </li>
        ))}
        {tray.length === 0 && athletes.length > 0 && <li className="live-muted">Todo o elenco está em campo.</li>}
      </ul>

      <div className="lineup-actions">
        {players.length > 0 && <button className="secondary-button" onClick={onCancel} type="button">Cancelar</button>}
        <button className="primary-button" onClick={save} disabled={startersCount === 0 && !started} type="button"><Check size={16} /> Salvar escalação</button>
      </div>
    </section>
  )
}
