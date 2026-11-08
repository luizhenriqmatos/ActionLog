import { useMemo, useState } from 'react'
import { BarChart3, FileDown, Pencil, Swords, Target, Trash2, Users } from 'lucide-react'
import type { Athlete, CategoryId, ScoutMode, SessionRecord } from '../types'
import { GAME_LABELS, legLabels } from '../types'
import {
  type DateRange, type PeriodPreset, type Rate, type RateKey, MIN_SAMPLE, RATE_INFO, evolution, filterSessions, finishingRates,
  formatPct, formatPP, gameRates, isLowSample, periodRange, previousRange, rateDelta, sumFinishing, sumGame, toIso,
} from '../lib/metrics'
import { downloadBlob } from '../lib/download'
import { EvolutionChart, PercentBars } from '../components/Charts'

type Props = {
  category: CategoryId
  athletes: Athlete[]
  sessions: SessionRecord[]
  onEdit: (session: SessionRecord) => void
  onDelete: (session: SessionRecord) => void
}

const PERIODS: Array<[PeriodPreset, string]> = [['30', 'Últimos 30 dias'], ['7', 'Últimos 7 dias'], ['90', 'Últimos 90 dias'], ['year', 'Ano atual'], ['all', 'Todo o histórico'], ['custom', 'Personalizado']]

export function PerformanceTab({ category, athletes, sessions, onEdit, onDelete }: Props) {
  const today = toIso(new Date())
  const [mode, setMode] = useState<ScoutMode>('game')
  const [athleteId, setAthleteId] = useState('')
  const [preset, setPreset] = useState<PeriodPreset>('all')
  const [custom, setCustom] = useState<DateRange>({ from: `${today.slice(0, 4)}-01-01`, to: today })
  const [chartKey, setChartKey] = useState<RateKey>('conversion')
  const [rankKey, setRankKey] = useState<string>('goals')
  const [compare, setCompare] = useState<string[]>([])

  const range = periodRange(preset, today, custom)
  const prev = previousRange(range)
  const athlete = athletes.find((item) => item.id === athleteId)
  const ambi = athlete?.dominantFoot === 'Ambidestro'
  const inPeriod = useMemo(() => filterSessions(sessions, { mode, athleteId: athleteId || undefined, range }), [sessions, mode, athleteId, range.from, range.to])
  const inPrevious = useMemo(() => prev ? filterSessions(sessions, { mode, athleteId: athleteId || undefined, range: prev }) : [], [sessions, mode, athleteId, prev?.from, prev?.to])

  const rates: Rate[] = mode === 'game' ? gameRates(sumGame(inPeriod)) : finishingRates(sumFinishing(inPeriod), ambi)
  const prevRates: Rate[] = mode === 'game' ? gameRates(sumGame(inPrevious)) : finishingRates(sumFinishing(inPrevious), ambi)
  const rateKeys = rates.map((item) => item.key)
  const activeChartKey = rateKeys.includes(chartKey) ? chartKey : rateKeys[1]
  const points = evolution(inPeriod, mode, activeChartKey)
  const g = sumGame(inPeriod)
  const f = sumFinishing(inPeriod)

  const periodLabel = preset === 'all' ? 'todo o histórico' : preset === 'custom' ? `${range.from.split('-').reverse().join('/')} a ${range.to.split('-').reverse().join('/')}` : PERIODS.find((p) => p[0] === preset)![1].toLowerCase()

  function changeMode(next: ScoutMode) {
    setMode(next)
    setRankKey('goals')
  }

  function toggleCompare(id: string) {
    setCompare((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length >= 4 ? current : [...current, id])
  }

  const ranking = athletes.map((item) => {
    const list = filterSessions(sessions, { mode, athleteId: item.id, range })
    return { athlete: item, list, game: sumGame(list), fin: sumFinishing(list) }
  }).filter((row) => row.list.length > 0)

  const rankOptions: Array<[string, string]> = mode === 'game'
    ? [['goals', 'Gols'], ['assists', 'Assistências'], ['tackles', 'Desarmes'], ['shotAccuracy', 'Aproveitamento'], ['conversion', 'Conversão'], ['passAccuracy', 'Precisão de passe']]
    : [['goals', 'Gols'], ['shotAccuracy', 'Aproveitamento'], ['conversion', 'Conversão'], ['dominantEfficiency', 'Efic. dominante'], ['nonDominantEfficiency', 'Efic. não dominante']]

  function rankValue(row: (typeof ranking)[number]): { value: number; low: boolean } {
    if (rankKey in RATE_INFO) {
      const list = mode === 'game' ? gameRates(row.game) : finishingRates(row.fin)
      const item = list.find((r) => r.key === rankKey)
      if (!item || item.value === null) return { value: -1, low: true }
      return { value: item.value, low: isLowSample(item.denominator) }
    }
    return { value: mode === 'game' ? (row.game as unknown as Record<string, number>)[rankKey] ?? 0 : row.fin.goals, low: false }
  }
  const sortedRanking = [...ranking].sort((a, b) => {
    const va = rankValue(a), vb = rankValue(b)
    if (va.low !== vb.low) return va.low ? 1 : -1
    return vb.value - va.value
  })

  function exportData(format: 'csv' | 'json') {
    const rows = ranking.map(({ athlete: a, game, fin }) => {
      const base = { atleta: a.name, camisa: a.number, posicao: a.positions, pe_dominante: a.dominantFoot }
      if (mode === 'game') {
        const r = gameRates(game)
        return { ...base, jogos: game.sessions, gols: game.goals, assistencias: game.assists, finalizacoes: game.shots, finalizacoes_no_gol: game.shotsOnTarget, passes_total: game.passTotal, passes_certos: game.accuratePasses, passes_errados: game.wrongPasses, desarmes: game.tackles, perdas_posse: game.possessionLoss, faltas_cometidas: game.foulsCommitted, faltas_sofridas: game.foulsSuffered, aproveitamento_pct: r[0].value, conversao_pct: r[1].value, precisao_passe_pct: r[2].value }
      }
      const r = finishingRates(fin)
      return { ...base, sessoes: fin.sessions, finalizacoes: fin.shots, finalizacoes_no_gol: fin.onTarget, gols: fin.goals, finalizacoes_dominante: fin.dominant.shots, gols_dominante: fin.dominant.goals, finalizacoes_nao_dominante: fin.nonDominant.shots, gols_nao_dominante: fin.nonDominant.goals, aproveitamento_pct: r[0].value, conversao_pct: r[1].value, eficiencia_dominante_pct: r[2].value, eficiencia_nao_dominante_pct: r[3].value }
    })
    const meta = { schema_version: 2, categoria: category, tipo: mode === 'game' ? 'partidas' : 'treino_finalizacao', periodo: preset === 'all' ? 'todo' : range, gerado_em: new Date().toISOString() }
    const name = `actionlog-${category.toLowerCase()}-${mode === 'game' ? 'partidas' : 'finalizacao'}-${today}.${format}`
    if (format === 'json') { downloadBlob(name, new Blob([JSON.stringify({ ...meta, atletas: rows }, null, 2)], { type: 'application/json' })); return }
    const cols = rows.length ? Object.keys(rows[0]) : []
    const cell = (value: unknown) => {
      if (value === null || value === undefined) return ''
      const text = typeof value === 'number' ? String(value).replace('.', ',') : String(value)
      return /[;"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
    }
    const csv = '﻿' + [cols.join(';'), ...rows.map((row) => cols.map((c) => cell((row as Record<string, unknown>)[c])).join(';'))].join('\n')
    downloadBlob(name, new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  }

  const history = [...inPeriod].sort((a, b) => b.calendarDate.localeCompare(a.calendarDate) || b.createdAt.localeCompare(a.createdAt))
  const compareRows = compare.map((id) => athletes.find((a) => a.id === id)).filter((a): a is Athlete => Boolean(a)).map((a) => {
    const list = filterSessions(sessions, { mode, athleteId: a.id, range })
    return { athlete: a, list, game: sumGame(list), fin: sumFinishing(list) }
  })

  return (
    <section className="content-section perf-section">
      <div className="section-heading">
        <div>
          <div className="eyebrow">DESEMPENHO · {category} · {periodLabel.toUpperCase()}</div>
          <h2>{athlete ? athlete.name : 'Números da categoria.'}</h2>
          <p>Indicadores calculados a partir das sessões finalizadas no Scout. As taxas somam as contagens do período antes de dividir.</p>
        </div>
        <div className="scout-actions">
          <button className="secondary-button" onClick={() => exportData('csv')} type="button" disabled={ranking.length === 0}><FileDown size={16} /> CSV</button>
          <button className="secondary-button" onClick={() => exportData('json')} type="button" disabled={ranking.length === 0}><FileDown size={16} /> JSON</button>
        </div>
      </div>

      <div className="scout-toolbar perf-toolbar">
        <div className="mode-switch">
          <button className={mode === 'game' ? 'active' : ''} onClick={() => changeMode('game')} type="button"><Swords size={16} /> Partidas</button>
          <button className={mode === 'finishing' ? 'active' : ''} onClick={() => changeMode('finishing')} type="button"><Target size={16} /> Treino de Finalização</button>
        </div>
        <div className="perf-filters">
          <label className="athlete-select"><span>Atleta</span>
            <select value={athleteId} onChange={(event) => setAthleteId(event.target.value)}>
              <option value="">Categoria inteira</option>
              {athletes.map((a) => <option key={a.id} value={a.id}>{a.number ? `#${a.number} · ` : ''}{a.name}</option>)}
            </select>
          </label>
          <label className="athlete-select"><span>Período</span>
            <select value={preset} onChange={(event) => setPreset(event.target.value as PeriodPreset)}>
              {PERIODS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          {preset === 'custom' && <>
            <label className="athlete-select"><span>De</span><input type="date" value={custom.from} onChange={(event) => setCustom({ ...custom, from: event.target.value })} /></label>
            <label className="athlete-select"><span>Até</span><input type="date" value={custom.to} onChange={(event) => setCustom({ ...custom, to: event.target.value })} /></label>
          </>}
        </div>
      </div>

      {sessions.length === 0 ? (
        <div className="empty-state"><span className="empty-icon"><BarChart3 size={22} /></span><strong>Nenhuma sessão finalizada ainda</strong><p>Registre um Scout de Jogo ou um Treino de Finalização e toque em "Finalizar sessão". Os indicadores aparecem aqui automaticamente.</p></div>
      ) : <>
        <div className="kpi-grid">
          {rates.map((item) => {
            const delta = rateDelta(item, prevRates.find((p) => p.key === item.key))
            return (
              <div className="kpi-card" key={item.key}>
                <span className="kpi-label">{item.label}</span>
                <strong className="kpi-value">{formatPct(item.value)}</strong>
                <span className="kpi-sub">
                  <span>{item.numerator}/{item.denominator}</span>
                  {delta !== null && <span className={`kpi-delta ${delta > 0 ? 'up' : delta < 0 ? 'down' : ''}`}>{formatPP(delta)}</span>}
                  {isLowSample(item.denominator) && <span className="low-pill">amostra pequena</span>}
                </span>
                <span className="kpi-formula">{item.formula}</span>
              </div>
            )
          })}
        </div>

        <div className="totals-grid">
          {mode === 'game' ? <>
            <Total label="Jogos registrados" value={g.sessions} sub="sessões finalizadas" />
            <Total label="Gols" value={g.goals} sub={`${g.assists} assistências`} />
            <Total label="Finalizações" value={g.shots} sub={`${g.shotsOnTarget} no gol`} />
            <Total label="Passes" value={g.passTotal} sub={`${g.accuratePasses} certos · ${g.wrongPasses} errados`} />
            <Total label="Desarmes" value={g.tackles} sub={`${g.possessionLoss} perdas da posse`} />
            <Total label="Faltas" value={g.foulsCommitted} sub={`cometidas · ${g.foulsSuffered} sofridas`} />
          </> : <>
            <Total label="Sessões" value={f.sessions} sub="treinos finalizados" />
            <Total label="Finalizações" value={f.shots} sub={`${f.onTarget} no gol · ${f.goals} gols`} />
            {ambi ? <>
              <Total label="Perna direita" value={f.right.shots} sub={`${f.right.goals} gols`} />
              <Total label="Perna esquerda" value={f.left.shots} sub={`${f.left.goals} gols`} />
            </> : <>
              <Total label="Perna dominante" value={f.dominant.shots} sub={`${f.dominant.goals} gols`} />
              <Total label="Perna não dominante" value={f.nonDominant.shots} sub={`${f.nonDominant.goals} gols`} />
            </>}
          </>}
        </div>
        {mode === 'finishing' && !athlete && f.ambidextrousSessions > 0 && <p className="perf-note">{f.ambidextrousSessions} sessão(ões) de atletas ambidestros entram nos totais, mas ficam fora da eficiência dominante/não dominante.</p>}

        <div className="perf-charts">
          <div className="perf-card">
            <div className="perf-card-head"><strong>Evolução</strong>
              <select value={activeChartKey} onChange={(event) => setChartKey(event.target.value as RateKey)} aria-label="Indicador do gráfico">
                {rates.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
              </select>
            </div>
            <EvolutionChart points={points} label={RATE_INFO[activeChartKey].label} />
          </div>
          <div className="perf-card">
            <div className="perf-card-head"><strong>{mode === 'finishing' ? (ambi ? 'Direita × esquerda' : 'Dominante × não dominante') : 'Taxas do período'}</strong></div>
            {mode === 'finishing' ? (
              <PercentBars groups={(() => {
                const a = ambi ? f.right : f.dominant
                const b = ambi ? f.left : f.nonDominant
                const [na, nb] = ambi ? ['Direita', 'Esquerda'] : ['Dominante', 'Não dominante']
                return [
                  { label: 'Aproveitamento (no gol ÷ finalizações)', values: [{ name: na, value: pctOf(a.onTarget, a.shots), tone: 'green' }, { name: nb, value: pctOf(b.onTarget, b.shots), tone: 'blue' }] },
                  { label: 'Eficiência (gols ÷ finalizações)', values: [{ name: na, value: pctOf(a.goals, a.shots), tone: 'green' }, { name: nb, value: pctOf(b.goals, b.shots), tone: 'blue' }] },
                ]
              })()} />
            ) : (
              <PercentBars groups={rates.map((item) => ({ label: item.formula, values: [{ name: item.label.replace(' de finalização', ''), value: item.value, tone: 'blue' }] }))} />
            )}
          </div>
        </div>

        {!athlete && (
          <div className="perf-card">
            <div className="perf-card-head"><strong>Ranking da categoria</strong>
              <select value={rankKey} onChange={(event) => setRankKey(event.target.value)} aria-label="Ordenar ranking por">
                {rankOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            {sortedRanking.length === 0 ? <p className="perf-note">Sem sessões no período.</p> : (
              <div className="table-wrap"><table className="perf-table">
                <thead><tr><th>#</th><th className="left">Atleta</th>{mode === 'game'
                  ? <><th>Jogos</th><th>G</th><th>A</th><th>Fin</th><th>No gol</th><th>Passes</th><th>Des</th><th>Aprov.</th><th>Conv.</th><th>Passe</th></>
                  : <><th>Sessões</th><th>Fin</th><th>No gol</th><th>Gols</th><th>Aprov.</th><th>Conv.</th><th>Dom.</th><th>Não dom.</th></>}<th /></tr></thead>
                <tbody>{sortedRanking.map((row, index) => {
                  const low = rankValue(row).low && rankKey in RATE_INFO
                  return (
                    <tr key={row.athlete.id}>
                      <td>{low ? '—' : `${index + 1}º`}</td>
                      <td className="left"><strong>{row.athlete.name}</strong> <small>{row.athlete.positions}</small></td>
                      {mode === 'game' ? <>
                        <td>{row.game.sessions}</td><td>{row.game.goals}</td><td>{row.game.assists}</td><td>{row.game.shots}</td><td>{row.game.shotsOnTarget}</td><td>{row.game.passTotal}</td><td>{row.game.tackles}</td>
                        {gameRates(row.game).map((r) => <RateCell key={r.key} rate={r} />)}
                      </> : <>
                        <td>{row.fin.sessions}</td><td>{row.fin.shots}</td><td>{row.fin.onTarget}</td><td>{row.fin.goals}</td>
                        {finishingRates(row.fin).map((r) => row.athlete.dominantFoot === 'Ambidestro' && (r.key === 'dominantEfficiency' || r.key === 'nonDominantEfficiency') ? <td key={r.key}>n/a</td> : <RateCell key={r.key} rate={r} />)}
                      </>}
                      <td><button className="link-button" onClick={() => setAthleteId(row.athlete.id)} type="button">ver</button></td>
                    </tr>
                  )
                })}</tbody>
              </table></div>
            )}
            <p className="perf-note">Com menos de {MIN_SAMPLE} tentativas no indicador escolhido, o atleta vai para o fim do ranking, sem posição.</p>
          </div>
        )}

        <div className="perf-card">
          <div className="perf-card-head"><strong><Users size={16} /> Comparar atletas</strong><small>até 4 · mesmo período e tipo de sessão</small></div>
          <div className="chip-row">{athletes.map((a) => <button key={a.id} className={`chip ${compare.includes(a.id) ? 'active' : ''}`} aria-pressed={compare.includes(a.id)} onClick={() => toggleCompare(a.id)} type="button">{a.number ? `#${a.number} ` : ''}{a.name}</button>)}</div>
          {compareRows.length > 0 && (
            <div className="table-wrap"><table className="perf-table">
              <thead><tr><th className="left">Indicador</th>{compareRows.map((row) => <th key={row.athlete.id}>{row.athlete.name.split(' ')[0]}</th>)}</tr></thead>
              <tbody>
                {(mode === 'game'
                  ? ([['Jogos', (r) => r.game.sessions], ...(['goals', 'assists', 'shots', 'shotsOnTarget', 'accuratePasses', 'wrongPasses', 'tackles', 'possessionLoss', 'foulsCommitted', 'foulsSuffered'] as const).map((k) => [GAME_LABELS[k], (r: (typeof compareRows)[number]) => r.game[k]] as const)] as Array<readonly [string, (r: (typeof compareRows)[number]) => number]>)
                  : ([['Sessões', (r) => r.fin.sessions], ['Finalizações', (r) => r.fin.shots], ['No gol', (r) => r.fin.onTarget], ['Gols', (r) => r.fin.goals]] as Array<readonly [string, (r: (typeof compareRows)[number]) => number]>)
                ).map(([label, get]) => <tr key={label}><td className="left">{label}</td>{compareRows.map((row) => <td key={row.athlete.id}>{get(row)}</td>)}</tr>)}
                {(mode === 'game' ? gameRates(compareRows[0].game) : finishingRates(compareRows[0].fin)).map((first, index) => (
                  <tr key={first.key}><td className="left"><strong>{first.label}</strong></td>{compareRows.map((row) => {
                    const r = (mode === 'game' ? gameRates(row.game) : finishingRates(row.fin))[index]
                    if (row.athlete.dominantFoot === 'Ambidestro' && (r.key === 'dominantEfficiency' || r.key === 'nonDominantEfficiency')) return <td key={row.athlete.id}>n/a</td>
                    return <RateCell key={row.athlete.id} rate={r} />
                  })}</tr>
                ))}
              </tbody>
            </table></div>
          )}
        </div>

        <div className="perf-card">
          <div className="perf-card-head"><strong>Histórico de sessões</strong><small>{history.length} no período</small></div>
          {history.length === 0 ? <p className="perf-note">Nenhuma sessão desse tipo no período.</p> : (
            <div className="table-wrap"><table className="perf-table">
              <thead><tr><th className="left">Data</th><th className="left">Atleta</th><th className="left">Compromisso</th>{mode === 'game'
                ? <><th>G</th><th>A</th><th>Fin/No gol</th><th>Passes C/E</th><th>Des</th><th>Perdas</th><th>FC/FS</th><th>Conv.</th><th>Passe</th></>
                : <><th className="left">Pé</th><th>Dom. F/NG/G</th><th>Não dom. F/NG/G</th><th>Aprov.</th><th>Conv.</th></>}<th /></tr></thead>
              <tbody>{history.map((session) => {
                const s = session.stats
                return (
                  <tr key={session.id}>
                    <td className="left">{session.calendarDate.split('-').reverse().slice(0, 2).join('/')} <small>{session.periodizationTag}</small></td>
                    <td className="left">{session.athleteName}</td>
                    <td className="left"><small>{session.eventTitle || 'Sessão avulsa'}</small></td>
                    {mode === 'game' ? <>
                      <td>{s.game.goals}</td><td>{s.game.assists}</td><td>{s.game.shots}/{s.game.shotsOnTarget}</td><td>{s.game.accuratePasses}/{s.game.wrongPasses}{session.legacyPasses ? <small title="Contador antigo de passes, sem divisão certo/errado"> · {session.legacyPasses} ant.</small> : null}</td><td>{s.game.tackles}</td><td>{s.game.possessionLoss}</td><td>{s.game.foulsCommitted}/{s.game.foulsSuffered}</td>
                      {gameRates(sumGame([session])).slice(1).map((r) => <RateCell key={r.key} rate={r} />)}
                    </> : <>
                      <td className="left"><small>{session.dominantFootSnapshot}</small></td>
                      <td>{s.finishing.dominantFinishes}/{s.finishing.dominantOnTarget}/{s.finishing.dominantGoals}</td>
                      <td>{s.finishing.nonDominantFinishes}/{s.finishing.nonDominantOnTarget}/{s.finishing.nonDominantGoals}</td>
                      {finishingRates(sumFinishing([session])).slice(0, 2).map((r) => <RateCell key={r.key} rate={r} />)}
                    </>}
                    <td className="row-actions">
                      <button className="icon-button" onClick={() => onEdit(session)} type="button" aria-label={`Editar sessão de ${session.athleteName}`}><Pencil size={14} /></button>
                      <button className="icon-button danger" onClick={() => onDelete(session)} type="button" aria-label={`Excluir sessão de ${session.athleteName}`}><Trash2 size={14} /></button>
                    </td>
                  </tr>
                )
              })}</tbody>
            </table></div>
          )}
          {mode === 'finishing' && <p className="perf-note">Dom. = {legLabels('Direita').dominant.split(' (')[0].toLowerCase()}; para ambidestros, a primeira coluna é a perna direita. F/NG/G = finalizações / no gol / gols.</p>}
        </div>
      </>}
    </section>
  )
}

function pctOf(n: number, d: number) {
  return d > 0 ? Math.round((1000 * n) / d) / 10 : null
}

function Total({ label, value, sub }: { label: string; value: number; sub: string }) {
  return <div className="total-card"><span>{label}</span><strong>{value}</strong><small>{sub}</small></div>
}

function RateCell({ rate }: { rate: Rate }) {
  return <td>{formatPct(rate.value)}{isLowSample(rate.denominator) && <span className="low-dot" title={`Menos de ${MIN_SAMPLE} tentativas`}>!</span>}</td>
}
