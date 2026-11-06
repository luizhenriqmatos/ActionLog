import { useState } from 'react'
import { Minus, Plus, X } from 'lucide-react'
import type { FinishingMetric, GameMetric, SessionRecord, Stats } from '../types'
import { FINISHING_KEYS, GAME_KEYS, GAME_LABELS, legLabels } from '../types'
import { finishingRates, formatPct, gameRates, sumFinishing, sumGame, validateFinishing, validateGame } from '../lib/metrics'

/** Edição de uma sessão já salva. As taxas são recalculadas a cada mudança. */
export function SessionEditor({ session, onSave, onClose }: { session: SessionRecord; onSave: (stats: Stats) => void; onClose: () => void }) {
  const [stats, setStats] = useState<Stats>(() => ({ game: { ...session.stats.game }, finishing: { ...session.stats.finishing } }))
  const isGame = session.mode === 'game'
  const validation = isGame ? validateGame(stats.game) : validateFinishing(stats.finishing, session.dominantFootSnapshot)
  const preview = { ...session, stats }
  const rates = isGame ? gameRates(sumGame([preview])) : finishingRates(sumFinishing([preview]), session.dominantFootSnapshot === 'Ambidestro')
  const legs = legLabels(session.dominantFootSnapshot)

  function change(key: GameMetric | FinishingMetric, amount: number) {
    setStats((current) => {
      if (isGame) return { ...current, game: { ...current.game, [key]: Math.max(0, current.game[key as GameMetric] + amount) } }
      return { ...current, finishing: { ...current.finishing, [key]: Math.max(0, current.finishing[key as FinishingMetric] + amount) } }
    })
  }

  function setValue(key: GameMetric | FinishingMetric, raw: string) {
    const value = Math.max(0, Math.floor(Number(raw) || 0))
    setStats((current) => isGame ? { ...current, game: { ...current.game, [key]: value } } : { ...current, finishing: { ...current.finishing, [key]: value } })
  }

  const finishingLabel: Record<FinishingMetric, string> = {
    dominantFinishes: `${legs.dominant} · finalizações`,
    dominantOnTarget: `${legs.dominant} · no gol`,
    dominantGoals: `${legs.dominant} · gols`,
    nonDominantFinishes: `${legs.nonDominant} · finalizações`,
    nonDominantOnTarget: `${legs.nonDominant} · no gol`,
    nonDominantGoals: `${legs.nonDominant} · gols`,
  }
  const keys: Array<GameMetric | FinishingMetric> = isGame ? GAME_KEYS : FINISHING_KEYS

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="report-modal editor-modal" role="dialog" aria-modal="true" aria-labelledby="editor-title">
        <div className="modal-top">
          <span className="status-pill"><i /> editar sessão</span>
          <button className="icon-button" onClick={onClose} type="button" aria-label="Fechar edição"><X size={18} /></button>
        </div>
        <h2 id="editor-title" className="editor-title">{session.athleteName}</h2>
        <p className="report-meta">{isGame ? 'Scout de Jogo' : 'Treino de Finalização'} · {session.periodizationTag || 'Sessão avulsa'} · {session.calendarDate.split('-').reverse().join('/')}{session.eventTitle ? ` · ${session.eventTitle}` : ''}</p>
        <div className="editor-grid">
          {keys.map((key) => {
            const value = isGame ? stats.game[key as GameMetric] : stats.finishing[key as FinishingMetric]
            const label = isGame ? GAME_LABELS[key as GameMetric] : finishingLabel[key as FinishingMetric]
            const id = `edit-${key}`
            return (
              <div className={`stepper ${validation.invalid.has(key) ? 'invalid' : ''}`} key={key}>
                <label htmlFor={id}>{label}</label>
                <div className="stepper-control">
                  <button type="button" onClick={() => change(key, -1)} aria-label={`Diminuir ${label}`}><Minus size={14} /></button>
                  <input id={id} inputMode="numeric" value={value} onChange={(event) => setValue(key, event.target.value)} />
                  <button type="button" onClick={() => change(key, 1)} aria-label={`Aumentar ${label}`}><Plus size={14} /></button>
                </div>
              </div>
            )
          })}
        </div>
        <div className="rate-strip">{rates.map((item) => <span key={item.key}>{item.label}: <b>{formatPct(item.value)}</b></span>)}</div>
        {validation.errors.map((message) => <div className="notice error" key={message}>{message}</div>)}
        {validation.warnings.map((message) => <div className="notice warn" key={message}>{message}</div>)}
        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose} type="button">Cancelar</button>
          <button className="primary-button" disabled={validation.errors.length > 0} onClick={() => onSave(stats)} type="button">{validation.errors.length ? 'Corrija os erros' : 'Salvar alterações'}</button>
        </div>
      </div>
    </div>
  )
}
