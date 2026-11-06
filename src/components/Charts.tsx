import { useEffect, useState } from 'react'
import type { EvolutionPoint } from '../lib/metrics'
import { formatPct } from '../lib/metrics'

/** Tamanho do desenho: no celular o gráfico usa um quadro menor, para o texto não encolher demais. */
function useCompact() {
  const query = '(max-width: 760px)'
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const update = () => setCompact(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return compact
}

/** Linha de evolução (0–100%) com média móvel tracejada. Sem dependências externas. */
type ScaleOptions = { min?: number; max?: number; ticks?: number[]; format?: (value: number | null) => string; movingLabel?: string; unitLabel?: (point: EvolutionPoint) => string }

export function EvolutionChart({ points, label, scale = {} }: { points: EvolutionPoint[]; label: string; scale?: ScaleOptions }) {
  const min = scale.min ?? 0
  const max = scale.max ?? 100
  const ticks = scale.ticks ?? [0, 25, 50, 75, 100]
  const fmt = scale.format ?? formatPct
  const compact = useCompact()
  const W = compact ? 340 : 640
  const H = compact ? 220 : 240
  const PAD = compact ? { top: 14, right: 12, bottom: 28, left: 40 } : { top: 16, right: 16, bottom: 30, left: 40 }
  if (points.length === 0) return <div className="chart-empty">Sem sessões no período para desenhar a evolução.</div>
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const x = (index: number) => PAD.left + (points.length === 1 ? innerW / 2 : (index * innerW) / (points.length - 1))
  const y = (value: number) => PAD.top + innerH - ((value - min) / (max - min)) * innerH
  const path = (key: 'value' | 'moving') => {
    let d = ''
    let open = false
    points.forEach((point, index) => {
      const value = point[key]
      if (value === null) { open = false; return }
      d += `${open ? 'L' : 'M'}${x(index).toFixed(1)},${y(value).toFixed(1)} `
      open = true
    })
    return d.trim()
  }
  const step = Math.max(1, Math.ceil(points.length / (compact ? 4 : 8)))
  const last = [...points].reverse().find((point) => point.value !== null)
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label} por data`}>
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(tick)} y2={y(tick)} className="chart-grid" />
            <text x={PAD.left - 8} y={y(tick) + 4} textAnchor="end" className="chart-tick">{scale.format ? fmt(tick) : `${tick}%`}</text>
          </g>
        ))}
        {points.map((point, index) => index % step === 0 || index === points.length - 1 ? (
          <text key={point.date} x={x(index)} y={H - 8} textAnchor="middle" className="chart-tick">{point.label}</text>
        ) : null)}
        <path d={path('moving')} className="chart-line-moving" />
        <path d={path('value')} className="chart-line" />
        {points.map((point, index) => point.value === null ? null : (
          <circle key={point.date} cx={x(index)} cy={y(point.value)} r={point === last ? 5 : 3} className={point === last ? 'chart-dot last' : 'chart-dot'}>
            <title>{scale.unitLabel ? scale.unitLabel(point) : `${point.label}: ${fmt(point.value)} (${point.denominator} tentativas)`}</title>
          </circle>
        ))}
      </svg>
      <figcaption className="chart-legend"><span><i className="sw line" /> {label} por data</span>{scale.movingLabel !== '' && <span><i className="sw moving" /> {scale.movingLabel ?? 'média móvel de 5 datas (soma das contagens)'}</span>}</figcaption>
    </figure>
  )
}

export type BarGroup = { label: string; values: Array<{ name: string; value: number | null; tone: string }> }

/** Barras horizontais agrupadas em percentual (0–100%). */
export function PercentBars({ groups }: { groups: BarGroup[] }) {
  return (
    <div className="pbars">
      {groups.map((group) => (
        <div className="pbar-group" key={group.label}>
          <span className="pbar-title">{group.label}</span>
          {group.values.map((item) => (
            <div className="pbar-row" key={item.name}>
              <span className="pbar-name">{item.name}</span>
              <span className="pbar-track"><span className={`pbar-fill tone-${item.tone}`} style={{ width: `${item.value ?? 0}%` }} /></span>
              <strong className="pbar-value">{formatPct(item.value)}</strong>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
