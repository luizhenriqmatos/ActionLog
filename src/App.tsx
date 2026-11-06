import { FormEvent, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Activity,
  ArrowLeft,
  BarChart3,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  ClipboardCheck,
  Crosshair,
  FileDown,
  Goal,
  LayoutGrid,
  MessageCircle,
  Minus,
  Plus,
  RotateCcw,
  Ruler,
  Scale,
  Shield,
  Swords,
  Tag,
  Target,
  Trash2,
  TrendingUp,
  Trophy,
  UserRound,
  Users,
  X,
  Zap,
} from 'lucide-react'
import {
  type AppData,
  type Athlete,
  type CalendarEvent,
  type CalendarView,
  type CategoryData,
  type CategoryId,
  type EventType,
  type FinishingMetric,
  type Foot,
  type GameMetric,
  type ScoutMode,
  type SessionRecord,
  type Stats,
  type TabId,
  type Tombstone,
  CATEGORIES,
  EMPTY_FINISHING,
  EMPTY_GAME,
  FEET,
  freshStats,
  legLabels,
} from './types'
import { finishingRates, formatPct, gameRates, sumFinishing, sumGame, validateFinishing, validateGame } from './lib/metrics'
import { downloadBlob } from './lib/download'
import { PerformanceTab } from './screens/PerformanceTab'
import { SessionEditor } from './components/SessionEditor'
import { SyncPanel, SyncPill } from './components/SyncPanel'
import { useSync } from './hooks/useSync'

const STORAGE_KEY = 'actionlog_hub_state_v1'
const LEGACY_KEYS = ['actionlog_state', 'actionlog_data', 'actionlog_roster']
const MD_OPTIONS = ['', 'MD', 'MD-1', 'MD-2', 'MD-3', 'MD-4', 'MD-5', 'MD-6', 'MD-7']
const WEEKDAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']
const CATEGORY_INFO: Record<CategoryId, { tone: string; detail: string; accent: string }> = {
  'Sub-15': { tone: 'Formação', detail: 'Base e fundamentos', accent: 'blue' },
  'Sub-16': { tone: 'Desenvolvimento', detail: 'Intensidade e leitura', accent: 'green' },
  'Sub-17': { tone: 'Competição', detail: 'Performance de jogo', accent: 'orange' },
  'Sub-20': { tone: 'Transição', detail: 'Alto rendimento', accent: 'purple' },
}

const GAME_METRICS: Array<{ key: GameMetric; label: string; icon: typeof Activity; tone: string }> = [
  { key: 'goals', label: 'Gols', icon: Goal, tone: 'yellow' },
  { key: 'assists', label: 'Assistências', icon: Trophy, tone: 'yellow' },
  { key: 'shots', label: 'Finalizações', icon: Crosshair, tone: 'blue' },
  { key: 'shotsOnTarget', label: 'Finalizações no gol', icon: Target, tone: 'green' },
  { key: 'accuratePasses', label: 'Passes certos', icon: Check, tone: 'green' },
  { key: 'wrongPasses', label: 'Passes errados', icon: X, tone: 'red' },
  { key: 'tackles', label: 'Desarmes', icon: Shield, tone: 'purple' },
  { key: 'possessionLoss', label: 'Perdas da posse', icon: RotateCcw, tone: 'orange' },
  { key: 'foulsCommitted', label: 'Faltas cometidas', icon: Swords, tone: 'red' },
  { key: 'foulsSuffered', label: 'Faltas sofridas', icon: Zap, tone: 'green' },
]

function freshCategory(): CategoryData {
  return { athletes: [], events: [], stats: {}, sessions: [] }
}

function freshData(): AppData {
  return {
    teamName: '',
    categories: {
      'Sub-15': freshCategory(),
      'Sub-16': freshCategory(),
      'Sub-17': freshCategory(),
      'Sub-20': freshCategory(),
    },
    tombstones: [],
  }
}

function isCategory(value: string): value is CategoryId {
  return CATEGORIES.includes(value as CategoryId)
}

function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function todayIso() {
  const date = new Date()
  return toIsoDate(date)
}

function toIsoDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function fromIsoDate(value: string) {
  return new Date(`${value}T12:00:00`)
}

function addDays(date: Date, amount: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + amount)
  return next
}

function formatDate(date: string) {
  if (!date) return 'Sem data'
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).format(fromIsoDate(date)).replace('.', '')
}

function formatDayMonth(date: string) {
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(fromIsoDate(date))
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function monthTitle(date: Date) {
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(date).replace(/^./, (letter) => letter.toUpperCase())
}

function weekStart(date: Date) {
  const mondayOffset = (date.getDay() + 6) % 7
  return addDays(date, -mondayOffset)
}

function cloneStats(stats: Stats): Stats {
  return { game: { ...stats.game }, finishing: { ...stats.finishing } }
}

function normalizeAthlete(raw: unknown, index: number): Athlete | null {
  if (!raw || typeof raw !== 'object') return null
  const athlete = raw as Record<string, unknown>
  const name = String(athlete.name ?? athlete.playerName ?? '').trim()
  if (!name) return null
  return {
    id: String(athlete.id ?? uid(`legacy-${index}`)),
    name,
    number: String(athlete.number ?? athlete.jerseyNumber ?? ''),
    positions: String(athlete.positions ?? athlete.position ?? ''),
    age: String(athlete.age ?? ''),
    height: String(athlete.height ?? athlete.heightCm ?? ''),
    weight: String(athlete.weight ?? athlete.weightKg ?? ''),
    dominantFoot: FEET.includes(athlete.dominantFoot as Foot) ? athlete.dominantFoot as Foot : 'Direita',
    ...(typeof athlete.updatedAt === 'string' ? { updatedAt: athlete.updatedAt } : {}),
  }
}

function normalizeEvent(raw: unknown, index: number): CalendarEvent | null {
  if (!raw || typeof raw !== 'object') return null
  const event = raw as Record<string, unknown>
  const date = String(event.date ?? '')
  const title = String(event.title ?? '').trim()
  if (!date || !title) return null
  return {
    id: String(event.id ?? uid(`event-${index}`)),
    type: event.type === 'Jogo' ? 'Jogo' : 'Treino',
    title,
    date,
    opponent: String(event.opponent ?? ''),
    location: String(event.location ?? ''),
    mdTag: typeof event.mdTag === 'string' ? event.mdTag : event.type === 'Jogo' ? 'MD' : '',
    ...(typeof event.updatedAt === 'string' ? { updatedAt: event.updatedAt } : {}),
  }
}

function count(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0
}

/**
 * Migra contadores da v2.1 para o formato atual.
 * O antigo contador "passes" não tem divisão certo/errado; é devolvido à parte (legacyPasses)
 * para ficar visível no histórico sem distorcer a precisão de passe.
 */
function normalizeStats(raw: unknown): { stats: Stats; legacyPasses: number } {
  const value = (raw && typeof raw === 'object' ? raw : {}) as { game?: Record<string, unknown>; finishing?: Record<string, unknown> }
  const game = { ...EMPTY_GAME }
  const finishing = { ...EMPTY_FINISHING }
  for (const key of Object.keys(game) as GameMetric[]) game[key] = count(value.game?.[key])
  for (const key of Object.keys(finishing) as FinishingMetric[]) finishing[key] = count(value.finishing?.[key])
  return { stats: { game, finishing }, legacyPasses: count(value.game?.passes) }
}

function normalizeSession(raw: unknown, category: CategoryId, footById: Map<string, Foot>, eventByDate: Map<string, CalendarEvent>): SessionRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const session = raw as Record<string, unknown>
  const athleteId = String(session.athleteId ?? '')
  const calendarDate = String(session.calendarDate ?? '') || String(session.createdAt ?? '').slice(0, 10)
  if (!athleteId || !calendarDate) return null
  const { stats, legacyPasses } = normalizeStats(session.stats)
  const snapshot = FEET.includes(session.dominantFootSnapshot as Foot) ? session.dominantFootSnapshot as Foot : footById.get(athleteId) ?? 'Direita'
  const linked = typeof session.eventId === 'string' ? session.eventId : eventByDate.get(calendarDate)?.id ?? ''
  const eventType = session.eventType === 'Jogo' || session.eventType === 'Treino' ? session.eventType : eventByDate.get(calendarDate)?.type ?? ''
  return {
    id: String(session.id ?? uid('session')),
    createdAt: String(session.createdAt ?? new Date().toISOString()),
    updatedAt: typeof session.updatedAt === 'string' ? session.updatedAt : undefined,
    category: isCategory(String(session.category)) ? String(session.category) as CategoryId : category,
    mode: session.mode === 'finishing' ? 'finishing' : 'game',
    athleteId,
    athleteName: String(session.athleteName ?? ''),
    dominantFootSnapshot: snapshot,
    calendarDate,
    periodizationTag: String(session.periodizationTag ?? ''),
    eventTitle: String(session.eventTitle ?? ''),
    eventId: linked,
    eventType,
    stats,
    ...(typeof session.legacyPasses === 'number' ? { legacyPasses: session.legacyPasses } : legacyPasses ? { legacyPasses } : {}),
    schemaVersion: 2,
  }
}

function normalizeStored(raw: unknown): AppData {
  const data = freshData()
  if (!raw || typeof raw !== 'object') return data
  const source = raw as Partial<AppData>
  data.teamName = typeof source.teamName === 'string' ? source.teamName : ''
  data.tombstones = Array.isArray(source.tombstones) ? source.tombstones.filter((t) => t && typeof t.id === 'string' && isCategory(String(t.category))) : []
  for (const category of CATEGORIES) {
    const saved = source.categories?.[category] as Partial<CategoryData> | undefined
    if (!saved) continue
    const athletes = Array.isArray(saved.athletes) ? saved.athletes.map(normalizeAthlete).filter((item): item is Athlete => Boolean(item)) : []
    const events = Array.isArray(saved.events) ? saved.events.map(normalizeEvent).filter((item): item is CalendarEvent => Boolean(item)) : []
    const footById = new Map(athletes.map((athlete) => [athlete.id, athlete.dominantFoot]))
    const eventByDate = new Map(events.map((event) => [event.date, event]))
    const sessions = Array.isArray(saved.sessions) ? saved.sessions.map((session) => normalizeSession(session, category, footById, eventByDate)).filter((item): item is SessionRecord => Boolean(item)) : []
    const rawStats = saved.stats && typeof saved.stats === 'object' ? saved.stats as Record<string, unknown> : {}
    const stats: Record<string, Stats> = {}
    Object.entries(rawStats).forEach(([id, value]) => { stats[id] = normalizeStats(value).stats })
    data.categories[category] = { athletes, events, stats, sessions }
  }
  return data
}

function normalizeLegacy(raw: unknown): AppData {
  const data = freshData()
  if (!raw || typeof raw !== 'object') return data
  const source = raw as Record<string, unknown>
  if (source.categories && typeof source.categories === 'object') return normalizeStored(raw)
  if (typeof source.teamName === 'string') data.teamName = source.teamName
  const category = isCategory(String(source.category)) ? String(source.category) as CategoryId : 'Sub-15'
  const possibleAthletes = Array.isArray(source.athletes) ? source.athletes : Array.isArray(source.roster) ? source.roster : []
  data.categories[category].athletes = possibleAthletes.map(normalizeAthlete).filter((item): item is Athlete => Boolean(item))
  const possibleEvents = Array.isArray(source.events) ? source.events : Array.isArray(source.calendar) ? source.calendar : []
  data.categories[category].events = possibleEvents.map(normalizeEvent).filter((item): item is CalendarEvent => Boolean(item))
  if (source.stats && typeof source.stats === 'object') {
    const rawStats = source.stats as Record<string, unknown>
    Object.entries(rawStats).forEach(([id, value]) => { data.categories[category].stats[id] = normalizeStats(value).stats })
  }
  if (Array.isArray(source.sessions)) {
    const footById = new Map(data.categories[category].athletes.map((athlete) => [athlete.id, athlete.dominantFoot]))
    const eventByDate = new Map(data.categories[category].events.map((event) => [event.date, event]))
    data.categories[category].sessions = source.sessions.map((session) => normalizeSession(session, category, footById, eventByDate)).filter((item): item is SessionRecord => Boolean(item))
  }
  return data
}

function loadData(): AppData {
  try {
    const current = window.localStorage.getItem(STORAGE_KEY)
    if (current) return normalizeStored(JSON.parse(current))
    for (const key of LEGACY_KEYS) {
      const legacy = window.localStorage.getItem(key)
      if (legacy) return normalizeLegacy(JSON.parse(legacy))
    }
  } catch {
    // Mantém uma sessão limpa quando localStorage estiver corrompido ou indisponível.
  }
  return freshData()
}

function makePdf(text: string) {
  // O PDF usa Helvetica Type1; normalizamos os acentos para manter o stream ASCII
  // compatível com leitores simples e calculamos o conteúdo em bytes.
  const safeText = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E\n]/g, '?')
  const lines = safeText.split('\n').slice(0, 34).map((line) => line.replace(/[\\()]/g, '\\$&').slice(0, 104))
  const content = ['BT', '/F1 12 Tf', '50 760 Td', ...lines.map((line, index) => `(${line}) Tj${index < lines.length - 1 ? ' 0 -20 Td' : ''}`), 'ET'].join('\n')
  const byteLength = new TextEncoder().encode(content).byteLength
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${byteLength} >>\nstream\n${content}\nendstream`,
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  offsets.slice(1).forEach((offset) => { pdf += `${String(offset).padStart(10, '0')} 00000 n \n` })
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return new Blob([pdf], { type: 'application/pdf' })
}

function MetricButton({ label, value, tone, icon: Icon, invalid, onAdd, onRemove }: { label: string; value: number; tone: string; icon: typeof Activity; invalid?: boolean; onAdd: () => void; onRemove: () => void }) {
  return <div className={`metric-card metric-${tone} ${invalid ? 'invalid' : ''}`}><button className="metric-hit" onClick={onAdd} type="button" aria-label={`${label}: ${value}. Somar 1`}><span className="metric-icon"><Icon size={18} /></span><span className="metric-label">{label}</span><strong>{value}</strong><span className="metric-add">+1</span></button><button className="metric-minus" onClick={onRemove} disabled={value === 0} type="button" aria-label={`Desfazer 1 em ${label}`}><Minus size={13} /></button></div>
}

function CategoryPicker({ data, onSelect, syncPill }: { data: AppData; onSelect: (category: CategoryId) => void; syncPill: ReactNode }) {
  const totalAthletes = Object.values(data.categories).reduce((sum, category) => sum + category.athletes.length, 0)
  return <main className="app-shell picker-shell"><div className="topline"><span className="brand-mark">A</span><span className="wordmark">ACTIONLOG</span><span className="topline-sync">{syncPill}</span></div><section className="picker-hero"><div className="eyebrow">PAINEL DE PERFORMANCE · {totalAthletes} ATLETAS</div><h1>Escolha a categoria<br /><em>para começar.</em></h1><p>Um espaço de trabalho para acompanhar elenco, periodização e ações de cada faixa do seu time.</p></section><section className="category-grid" aria-label="Categorias do time">{CATEGORIES.map((category) => { const info = CATEGORY_INFO[category]; const count = data.categories[category].athletes.length; return <button className={`category-card category-${info.accent}`} key={category} onClick={() => onSelect(category)}><span className="category-index">0{CATEGORIES.indexOf(category) + 1}</span><span className="category-copy"><strong>{category}</strong><small>{info.tone} · {info.detail}</small></span><span className="category-count">{count}<small>atletas</small></span><ChevronRight className="category-arrow" size={20} /></button> })}</section></main>
}

function App() {
  const [data, setData] = useState<AppData>(() => loadData())
  const [category, setCategory] = useState<CategoryId | null>(null)
  const [tab, setTab] = useState<TabId>('roster')
  const [mode, setMode] = useState<ScoutMode>('game')
  const [activeAthleteId, setActiveAthleteId] = useState('')
  const [scoutDay, setScoutDay] = useState<CalendarEvent | null>(null)
  const [report, setReport] = useState<SessionRecord | null>(null)
  const [toast, setToast] = useState('')
  const [editing, setEditing] = useState<SessionRecord | null>(null)
  const [syncOpen, setSyncOpen] = useState(false)
  const sync = useSync(data, setData)
  const syncPill = <SyncPill sync={sync} onOpen={() => setSyncOpen(true)} />
  useEffect(() => {
    if (sync.recovery || (sync.pendingInvite && !sync.session)) setSyncOpen(true)
  }, [sync.recovery, sync.pendingInvite, sync.session?.user.id])
  const syncPanel = syncOpen ? <SyncPanel sync={sync} onClose={() => setSyncOpen(false)} /> : null

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  }, [data])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 2800)
    return () => window.clearTimeout(timer)
  }, [toast])

  const current = category ? data.categories[category] : null
  const activeAthlete = current?.athletes.find((athlete) => athlete.id === activeAthleteId) ?? current?.athletes[0]
  const activeStats = activeAthlete && current ? current.stats[activeAthlete.id] ?? freshStats() : freshStats()

  function selectCategory(next: CategoryId) {
    setCategory(next)
    setTab('roster')
    setActiveAthleteId(data.categories[next].athletes[0]?.id ?? '')
    setScoutDay(null)
  }

  function updateCategory(updater: (value: CategoryData) => CategoryData) {
    if (!category) return
    setData((previous) => ({ ...previous, categories: { ...previous.categories, [category]: updater(previous.categories[category]) } }))
  }

  function tombstone(kind: Tombstone['kind'], id: string) {
    if (!category) return
    setData((previous) => ({ ...previous, tombstones: [...previous.tombstones, { kind, id, category, deletedAt: new Date().toISOString() }] }))
  }

  function addAthlete(input: Athlete) {
    const athlete = { ...input, updatedAt: new Date().toISOString() }
    updateCategory((value) => ({ ...value, athletes: [...value.athletes, athlete], stats: { ...value.stats, [athlete.id]: freshStats() } }))
    setActiveAthleteId(athlete.id)
    setToast('Perfil físico adicionado ao elenco')
  }

  function removeAthlete(id: string) {
    const athlete = current?.athletes.find((item) => item.id === id)
    if (!athlete || !window.confirm(`Remover ${athlete.name} do elenco? As sessões já finalizadas continuam no histórico e nos indicadores.`)) return
    updateCategory((value) => {
      const nextStats = { ...value.stats }
      delete nextStats[id]
      return { ...value, athletes: value.athletes.filter((item) => item.id !== id), stats: nextStats }
    })
    tombstone('athlete', id)
    if (activeAthleteId === id) setActiveAthleteId('')
  }

  function saveCalendarDay(input: CalendarEvent) {
    const event = { ...input, updatedAt: new Date().toISOString() }
    updateCategory((value) => {
      const exists = value.events.some((item) => item.date === event.date)
      const events = exists ? value.events.map((item) => item.date === event.date ? event : item) : [...value.events, event]
      return { ...value, events: events.sort((a, b) => a.date.localeCompare(b.date)) }
    })
    setToast(`${event.mdTag || 'Data'} salvo no calendário`)
  }

  function removeCalendarDay(id: string) {
    updateCategory((value) => ({ ...value, events: value.events.filter((event) => event.id !== id) }))
    tombstone('event', id)
    if (scoutDay?.id === id) setScoutDay(null)
    setToast('Data removida do calendário')
  }

  function startScout(event: CalendarEvent, nextMode: ScoutMode) {
    setScoutDay(event)
    setMode(nextMode)
    setTab('scout')
    setToast(`${nextMode === 'game' ? 'Scout de jogo' : 'Treino de finalização'} aberto em ${event.mdTag}`)
  }

  function increment(metric: GameMetric | FinishingMetric, amount = 1) {
    if (!category || !activeAthlete) return
    updateCategory((value) => {
      const stats = cloneStats(value.stats[activeAthlete.id] ?? freshStats())
      if (mode === 'game') stats.game[metric as GameMetric] = Math.max(0, stats.game[metric as GameMetric] + amount)
      else stats.finishing[metric as FinishingMetric] = Math.max(0, stats.finishing[metric as FinishingMetric] + amount)
      return { ...value, stats: { ...value.stats, [activeAthlete.id]: stats } }
    })
  }

  function resetStats() {
    if (!category || !activeAthlete) return
    if (!window.confirm(`Zerar os contadores de ${activeAthlete.name}?`)) return
    updateCategory((value) => ({ ...value, stats: { ...value.stats, [activeAthlete.id]: freshStats() } }))
    setToast('Contadores zerados')
  }

  function finishSession() {
    if (!category || !activeAthlete) {
      setToast('Cadastre e selecione um atleta antes de finalizar')
      return
    }
    const validation = mode === 'game' ? validateGame(activeStats.game) : validateFinishing(activeStats.finishing, activeAthlete.dominantFoot)
    if (validation.errors.length) {
      setToast(`Corrija antes de finalizar: ${validation.errors[0]}`)
      return
    }
    const total = mode === 'game' ? Object.values(activeStats.game).reduce((a, b) => a + b, 0) : Object.values(activeStats.finishing).reduce((a, b) => a + b, 0)
    if (total === 0 && !window.confirm(`Nenhuma ação registrada para ${activeAthlete.name}. Finalizar mesmo assim?`)) return
    const session: SessionRecord = {
      id: uid('session'),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      category,
      mode,
      athleteId: activeAthlete.id,
      athleteName: activeAthlete.name,
      dominantFootSnapshot: activeAthlete.dominantFoot,
      calendarDate: scoutDay?.date ?? todayIso(),
      periodizationTag: scoutDay?.mdTag ?? '',
      eventTitle: scoutDay?.title ?? '',
      eventId: scoutDay?.id ?? '',
      eventType: scoutDay?.type ?? '',
      stats: cloneStats(activeStats),
      schemaVersion: 2,
    }
    updateCategory((value) => ({ ...value, sessions: [session, ...value.sessions], stats: { ...value.stats, [activeAthlete.id]: freshStats() } }))
    setReport(session)
  }

  function updateSession(id: string, stats: Stats) {
    updateCategory((value) => ({ ...value, sessions: value.sessions.map((item) => item.id === id ? { ...item, stats: cloneStats(stats), updatedAt: new Date().toISOString() } : item) }))
    setEditing(null)
    setToast('Sessão atualizada. Indicadores recalculados.')
  }

  function deleteSession(session: SessionRecord) {
    if (!window.confirm(`Excluir a sessão de ${session.athleteName} em ${formatDayMonth(session.calendarDate)}? Os indicadores serão recalculados.`)) return
    updateCategory((value) => ({ ...value, sessions: value.sessions.filter((item) => item.id !== session.id) }))
    tombstone('session', session.id)
    setToast('Sessão excluída')
  }

  function reportTitle(session: SessionRecord) {
    const kind = session.mode === 'game' ? 'Jogo' : 'Treino'
    const tag = session.periodizationTag || 'Sessão avulsa'
    return `Relatório de ${kind} - ${session.category} - ${tag} (${formatDayMonth(session.calendarDate)})`
  }

  function reportText(session: SessionRecord) {
    const lines = [reportTitle(session), `Atleta: ${session.athleteName}`, `Data registrada: ${formatDate(session.calendarDate)}`, session.eventTitle ? `Compromisso: ${session.eventTitle}` : '', '']
    if (session.mode === 'game') {
      lines.push('AÇÕES DE JOGO')
      GAME_METRICS.forEach(({ key, label }) => lines.push(`${label}: ${session.stats.game[key]}`))
      lines.push(`Passes (total): ${session.stats.game.accuratePasses + session.stats.game.wrongPasses}`)
      lines.push('', 'INDICADORES')
      gameRates(sumGame([session])).forEach((rate) => lines.push(`${rate.label}: ${formatPct(rate.value)} (${rate.numerator}/${rate.denominator})`))
    } else {
      const f = session.stats.finishing
      const legs = legLabels(session.dominantFootSnapshot)
      lines.push('FINALIZAÇÃO')
      lines.push(`${legs.dominant} · finalizações ${f.dominantFinishes} · no gol ${f.dominantOnTarget} · gols ${f.dominantGoals}`)
      lines.push(`${legs.nonDominant} · finalizações ${f.nonDominantFinishes} · no gol ${f.nonDominantOnTarget} · gols ${f.nonDominantGoals}`)
      lines.push(`Total · finalizações ${f.dominantFinishes + f.nonDominantFinishes} · no gol ${f.dominantOnTarget + f.nonDominantOnTarget} · gols ${f.dominantGoals + f.nonDominantGoals}`)
      lines.push('', 'INDICADORES')
      finishingRates(sumFinishing([session]), session.dominantFootSnapshot === 'Ambidestro').forEach((rate) => lines.push(`${rate.label}: ${formatPct(rate.value)} (${rate.numerator}/${rate.denominator})`))
    }
    return lines.filter(Boolean).join('\n')
  }

  async function copyReport(session: SessionRecord) {
    try {
      if (!navigator.clipboard) throw new Error('clipboard-unavailable')
      await navigator.clipboard.writeText(reportText(session))
      setToast('Relatório copiado para compartilhar')
    } catch {
      setToast('Não foi possível copiar automaticamente')
    }
  }

  function downloadReport(session: SessionRecord) {
    downloadBlob(`actionlog-${session.category.toLowerCase()}-${session.periodizationTag || 'sessao'}-${session.athleteName.toLowerCase().replace(/\s+/g, '-')}.pdf`, makePdf(reportText(session)))
    setToast('PDF gerado')
  }

  if (!category || !current) return <><CategoryPicker data={data} onSelect={selectCategory} syncPill={syncPill} />{syncPanel}</>

  return <main className="app-shell"><header className="app-header"><button className="back-button" onClick={() => setCategory(null)} type="button"><ArrowLeft size={18} /> Categorias</button><div className="header-brand"><span className="brand-mark">A</span><span className="wordmark">ACTIONLOG</span></div><div className="header-status"><i /> {data.teamName || 'Meu time'} <span className="slash">/</span> {category}</div>{syncPill}</header><section className="hub-intro"><div><div className="eyebrow">HUB DE CATEGORIA · {CATEGORY_INFO[category].tone.toUpperCase()}</div><h1>{category}<span>.</span></h1><p>Elenco, periodização e registro de ações em um único espaço.</p></div><div className="team-field"><label htmlFor="team-name">Nome do time</label><input id="team-name" value={data.teamName} onChange={(event) => setData((previous) => ({ ...previous, teamName: event.target.value }))} placeholder="Nome do time" /></div></section><nav className="tabs" aria-label="Navegação do hub"><button className={tab === 'roster' ? 'active' : ''} onClick={() => setTab('roster')} type="button"><Users size={17} /> Elenco <b>{current.athletes.length}</b></button><button className={tab === 'calendar' ? 'active' : ''} onClick={() => setTab('calendar')} type="button"><CalendarDays size={17} /> Calendário MD <b>{current.events.length}</b></button><button className={tab === 'scout' ? 'active' : ''} onClick={() => setTab('scout')} type="button"><BarChart3 size={17} /> Central de Scout <b>{current.sessions.length}</b></button><button className={tab === 'performance' ? 'active' : ''} onClick={() => setTab('performance')} type="button"><TrendingUp size={17} /> Desempenho</button></nav>{tab === 'roster' && <RosterTab athletes={current.athletes} activeId={activeAthlete?.id ?? ''} onActive={setActiveAthleteId} onAdd={addAthlete} onRemove={removeAthlete} />}{tab === 'calendar' && <CalendarTab events={current.events} onSaveDay={saveCalendarDay} onRemoveDay={removeCalendarDay} onStartScout={startScout} />}{tab === 'scout' && <ScoutTab mode={mode} setMode={setMode} scoutDay={scoutDay} onClearContext={() => setScoutDay(null)} onOpenCalendar={() => setTab('calendar')} athletes={current.athletes} activeAthlete={activeAthlete} stats={activeStats} onActive={setActiveAthleteId} onIncrement={increment} onReset={resetStats} onFinish={finishSession} />}{tab === 'performance' && <PerformanceTab category={category} athletes={current.athletes} sessions={current.sessions} onEdit={setEditing} onDelete={deleteSession} />}{editing && <SessionEditor session={editing} onSave={(stats) => updateSession(editing.id, stats)} onClose={() => setEditing(null)} />}{report && <ReportModal session={report} onClose={() => setReport(null)} onCopy={copyReport} onDownload={downloadReport} />}{syncPanel}{toast && <div className="toast"><Check size={16} /> {toast}</div>}</main>
}

function RosterTab({ athletes, activeId, onActive, onAdd, onRemove }: { athletes: Athlete[]; activeId: string; onActive: (id: string) => void; onAdd: (athlete: Athlete) => void; onRemove: (id: string) => void }) {
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ name: '', number: '', positions: '', age: '', height: '', weight: '', dominantFoot: 'Direita' as Foot })
  function submit(event: FormEvent) {
    event.preventDefault()
    if (!form.name.trim() || !form.positions.trim()) return
    onAdd({ id: uid('athlete'), ...form, name: form.name.trim(), positions: form.positions.trim() })
    setForm({ name: '', number: '', positions: '', age: '', height: '', weight: '', dominantFoot: 'Direita' })
    setAdding(false)
  }
  return <section className="content-section"><div className="section-heading"><div><div className="eyebrow">GESTÃO DE ELENCO · PERFIL ESTENDIDO</div><h2>Quem está em campo?</h2><p>Dados físicos e táticos para contextualizar cada observação.</p></div><button className="primary-button" onClick={() => setAdding(!adding)} type="button"><Plus size={17} /> Novo atleta</button></div>{adding && <form className="form-card athlete-form" onSubmit={submit}><div className="form-heading"><div><strong>Novo perfil de atleta</strong><small>Nome, posição e medidas entram no cadastro da categoria.</small></div><button className="icon-button" onClick={() => setAdding(false)} type="button"><X size={17} /></button></div><div className="form-grid extended-form-grid"><label>Nome completo<input autoFocus required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Ex.: Gabriel Silva" /></label><label>Nº camisa<input value={form.number} onChange={(event) => setForm({ ...form, number: event.target.value })} placeholder="10" /></label><label>Posição de atuação<input required value={form.positions} onChange={(event) => setForm({ ...form, positions: event.target.value })} placeholder="Meia, Atacante" /></label><label>Idade<input type="number" min="10" max="40" value={form.age} onChange={(event) => setForm({ ...form, age: event.target.value })} placeholder="16" /></label><label>Altura (cm)<span className="input-with-icon"><Ruler size={14} /><input type="number" min="100" max="230" value={form.height} onChange={(event) => setForm({ ...form, height: event.target.value })} placeholder="178" /></span></label><label>Peso (kg)<span className="input-with-icon"><Scale size={14} /><input type="number" min="30" max="150" value={form.weight} onChange={(event) => setForm({ ...form, weight: event.target.value })} placeholder="72" /></span></label><label>Pé dominante<select value={form.dominantFoot} onChange={(event) => setForm({ ...form, dominantFoot: event.target.value as Foot })}>{FEET.map((foot) => <option key={foot}>{foot}</option>)}</select></label></div><button className="primary-button" type="submit">Adicionar ao elenco <ChevronRight size={17} /></button></form>}{athletes.length === 0 ? <EmptyState icon={Users} title="Seu elenco começa aqui" text="Cadastre o primeiro perfil para liberar o contexto físico e a seleção no Scout." action={<button className="secondary-button" onClick={() => setAdding(true)} type="button"><Plus size={16} /> Cadastrar atleta</button>} /> : <div className="athlete-list">{athletes.map((athlete) => <article className={`athlete-card ${activeId === athlete.id ? 'selected' : ''}`} key={athlete.id}><button className="athlete-main" onClick={() => onActive(athlete.id)} type="button"><span className="avatar">{athlete.name.slice(0, 1).toUpperCase()}</span><span className="athlete-copy"><strong>{athlete.name}</strong><small>{athlete.positions} · {athlete.age || '—'} anos · {athlete.height || '—'} cm · {athlete.weight || '—'} kg</small></span><span className="foot-chip" title={`Pé dominante: ${athlete.dominantFoot}`}>{athlete.dominantFoot === 'Direita' ? 'D' : athlete.dominantFoot === 'Esquerda' ? 'E' : 'A'}</span><span className="jersey">{athlete.number || '—'}</span></button><div className="athlete-actions">{activeId === athlete.id && <span className="active-label"><i /> ativo</span>}<button className="icon-button danger" onClick={() => onRemove(athlete.id)} type="button" aria-label={`Remover ${athlete.name}`}><Trash2 size={16} /></button></div></article>)}</div>}</section>
}

function CalendarTab({ events, onSaveDay, onRemoveDay, onStartScout }: { events: CalendarEvent[]; onSaveDay: (event: CalendarEvent) => void; onRemoveDay: (id: string) => void; onStartScout: (event: CalendarEvent, mode: ScoutMode) => void }) {
  const [view, setView] = useState<CalendarView>('month')
  const [cursor, setCursor] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState<string | null>(todayIso())
  const eventByDate = useMemo(() => new Map(events.map((event) => [event.date, event])), [events])
  const selectedEvent = selectedDate ? eventByDate.get(selectedDate) : undefined
  const monthDays = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
    const leading = (first.getDay() + 6) % 7
    const total = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate()
    return [...Array(leading).fill(null), ...Array.from({ length: total }, (_, index) => toIsoDate(new Date(cursor.getFullYear(), cursor.getMonth(), index + 1)))]
  }, [cursor])
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => toIsoDate(addDays(weekStart(cursor), index))), [cursor])
  const visibleDates = view === 'month' ? monthDays : weekDays
  const calendarTitle = view === 'month' ? monthTitle(cursor) : `${formatDate(weekDays[0])} — ${formatDate(weekDays[6])}`

  function moveCursor(amount: number) {
    setCursor((current) => view === 'month' ? new Date(current.getFullYear(), current.getMonth() + amount, 1) : addDays(current, amount * 7))
  }

  function selectDate(date: string) {
    setSelectedDate(date)
  }

  function saveDay(form: Omit<CalendarEvent, 'id'>) {
    onSaveDay({ ...form, id: selectedEvent?.id ?? uid('calendar') })
  }

  return <section className="content-section calendar-section"><div className="section-heading"><div><div className="eyebrow">PERIODIZAÇÃO · MATCH DAY</div><h2>Semana com intenção.</h2><p>Classifique cada data como MD, MD-1, MD-2 e abra o Scout no contexto certo.</p></div><div className="calendar-legend"><span><i className="legend-dot md" /> MD · jogo</span><span><i className="legend-dot prep" /> preparação</span></div></div><div className="calendar-toolbar"><div className="calendar-nav"><button className="icon-button" onClick={() => moveCursor(-1)} type="button" aria-label="Período anterior"><ChevronLeft size={17} /></button><strong>{calendarTitle}</strong><button className="icon-button" onClick={() => moveCursor(1)} type="button" aria-label="Próximo período"><ChevronRight size={17} /></button><button className="today-button" onClick={() => { setCursor(new Date()); setSelectedDate(todayIso()) }} type="button">Hoje</button></div><div className="view-switch"><button className={view === 'month' ? 'active' : ''} onClick={() => setView('month')} type="button"><LayoutGrid size={15} /> Mês</button><button className={view === 'week' ? 'active' : ''} onClick={() => setView('week')} type="button"><CalendarDays size={15} /> Semana</button></div></div><div className={`calendar-workspace ${selectedDate ? 'has-selection' : ''}`}><div className="calendar-card"><div className="weekday-row">{WEEKDAYS.map((day) => <span key={day}>{day}</span>)}</div><div className={`calendar-grid ${view === 'week' ? 'week-grid' : ''}`}>{visibleDates.map((date, index) => date ? <CalendarCell key={date} date={date} event={eventByDate.get(date)} selected={selectedDate === date} onSelect={selectDate} /> : <div className="calendar-empty" key={`empty-${index}`} />)}</div></div>{selectedDate && <DayPanel date={selectedDate} event={selectedEvent} onSave={saveDay} onRemove={onRemoveDay} onStartScout={onStartScout} />}</div>{events.length > 0 && <div className="calendar-footnote"><Tag size={15} /><span>{events.length} datas classificadas · clique em qualquer data para editar a etiqueta de periodização e abrir a sessão.</span></div>}</section>
}

function CalendarCell({ date, event, selected, onSelect }: { date: string; event?: CalendarEvent; selected: boolean; onSelect: (date: string) => void }) {
  const dayNumber = fromIsoDate(date).getDate()
  const isToday = date === todayIso()
  return <button className={`calendar-cell ${selected ? 'selected' : ''} ${isToday ? 'today' : ''} ${event ? 'has-event' : ''}`} onClick={() => onSelect(date)} type="button"><span className="calendar-day-number">{dayNumber}</span>{event ? <span className={`calendar-event-pill ${event.mdTag === 'MD' ? 'match' : 'prep'}`}><b>{event.mdTag || '—'}</b><small>{event.title}</small></span> : <span className="calendar-empty-hint">classificar</span>}</button>
}

function DayPanel({ date, event, onSave, onRemove, onStartScout }: { date: string; event?: CalendarEvent; onSave: (event: Omit<CalendarEvent, 'id'>) => void; onRemove: (id: string) => void; onStartScout: (event: CalendarEvent, mode: ScoutMode) => void }) {
  const [form, setForm] = useState({ type: event?.type ?? 'Treino' as EventType, title: event?.title ?? '', opponent: event?.opponent ?? '', location: event?.location ?? '', mdTag: event?.mdTag ?? '' })
  useEffect(() => {
    setForm({ type: event?.type ?? 'Treino', title: event?.title ?? '', opponent: event?.opponent ?? '', location: event?.location ?? '', mdTag: event?.mdTag ?? '' })
  }, [date, event])
  const dayLabel = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }).format(fromIsoDate(date)).replace(/^./, (letter) => letter.toUpperCase())
  function handleTypeChange(type: EventType) {
    const mdTag = type === 'Jogo' ? 'MD' : form.mdTag === 'MD' ? 'MD-1' : form.mdTag
    setForm({ ...form, type, mdTag })
  }
  function submit(eventSubmit: FormEvent) {
    eventSubmit.preventDefault()
    if (!form.title.trim() || !form.mdTag) return
    onSave({ ...form, date, title: form.title.trim() })
  }
  return <aside className="day-panel"><div className="day-panel-top"><div><div className="eyebrow">DATA SELECIONADA</div><h3>{dayLabel}</h3></div>{event && <span className={`md-badge ${event.mdTag === 'MD' ? 'match' : 'prep'}`}>{event.mdTag}</span>}</div><form className="day-form" onSubmit={submit}><label>Etiqueta de periodização<select required value={form.mdTag} onChange={(input) => setForm({ ...form, mdTag: input.target.value })}><option value="">Selecionar MD</option>{MD_OPTIONS.filter(Boolean).map((tag) => <option key={tag}>{tag}</option>)}</select></label><label>Tipo de sessão<select value={form.type} onChange={(input) => handleTypeChange(input.target.value as EventType)}><option>Treino</option><option>Jogo</option></select></label><label>Nome do compromisso<input required value={form.title} onChange={(input) => setForm({ ...form, title: input.target.value })} placeholder="Ex.: Organização ofensiva" /></label><label>{form.type === 'Jogo' ? 'Adversário' : 'Foco do treino'}<input value={form.opponent} onChange={(input) => setForm({ ...form, opponent: input.target.value })} placeholder={form.type === 'Jogo' ? 'Nome do adversário' : 'Ex.: Finalização sob pressão'} /></label><label>Local<input value={form.location} onChange={(input) => setForm({ ...form, location: input.target.value })} placeholder="Campo / CT" /></label><button className="primary-button full-button" type="submit">{event ? 'Atualizar data' : 'Classificar data'} <Check size={16} /></button></form>{event && <><div className="quick-scout"><div><div className="eyebrow">ABERTURA RÁPIDA</div><strong>Iniciar sessão em {event.mdTag}</strong><small>O relatório carregará automaticamente a etiqueta {event.mdTag} e a data {formatDayMonth(event.date)}.</small></div><button className="quick-button game" onClick={() => onStartScout(event, 'game')} type="button"><Swords size={16} /> Iniciar Scout de Jogo</button><button className="quick-button finishing" onClick={() => onStartScout(event, 'finishing')} type="button"><Target size={16} /> Iniciar Scout de Treino de Finalização</button></div><button className="delete-day" onClick={() => onRemove(event.id)} type="button"><Trash2 size={14} /> Remover esta data</button></>}</aside>
}

function ScoutTab({ mode, setMode, scoutDay, onClearContext, onOpenCalendar, athletes, activeAthlete, stats, onActive, onIncrement, onReset, onFinish }: { mode: ScoutMode; setMode: (mode: ScoutMode) => void; scoutDay: CalendarEvent | null; onClearContext: () => void; onOpenCalendar: () => void; athletes: Athlete[]; activeAthlete?: Athlete; stats: Stats; onActive: (id: string) => void; onIncrement: (metric: GameMetric | FinishingMetric, amount?: number) => void; onReset: () => void; onFinish: () => void }) {
  const finishingTotal = stats.finishing.dominantFinishes + stats.finishing.nonDominantFinishes
  const targetTotal = stats.finishing.dominantOnTarget + stats.finishing.nonDominantOnTarget
  const goalTotal = stats.finishing.dominantGoals + stats.finishing.nonDominantGoals
  const foot: Foot = activeAthlete?.dominantFoot ?? 'Direita'
  const legs = legLabels(foot)
  const validation = mode === 'game' ? validateGame(stats.game) : validateFinishing(stats.finishing, foot)
  const preview = [{ mode, dominantFootSnapshot: foot, stats } as SessionRecord]
  const liveRates = mode === 'game' ? gameRates(sumGame(preview)) : finishingRates(sumFinishing(preview), foot === 'Ambidestro')
  const mismatch = scoutDay && ((mode === 'game' && scoutDay.type === 'Treino') || (mode === 'finishing' && scoutDay.type === 'Jogo'))
  return <section className="content-section scout-section"><div className="section-heading scout-heading"><div><div className="eyebrow">CENTRAL DE SCOUT</div><h2>Registrar é observar.</h2><p>Escolha o atleta e o tipo de sessão para começar a contar. Toque no card para somar 1; use o − para desfazer.</p></div><div className="scout-actions"><button className="secondary-button" onClick={onReset} type="button"><RotateCcw size={16} /> Zerar contadores</button><button className="primary-button" onClick={onFinish} disabled={validation.errors.length > 0} type="button"><ClipboardCheck size={16} /> {validation.errors.length ? 'Corrija para finalizar' : 'Finalizar sessão'}</button></div></div>{scoutDay ? <div className="scout-day-context"><div><span className="md-badge prep">{scoutDay.mdTag}</span><strong>{scoutDay.title}</strong><small>{formatDate(scoutDay.date)} · {scoutDay.type}</small></div><button className="icon-button" onClick={onClearContext} type="button" aria-label="Desvincular data"><X size={16} /></button></div> : <div className="scout-unlinked"><CalendarDays size={15} /> Sessão avulsa · abra o Scout pelo Calendário MD para vincular uma data <button onClick={onOpenCalendar} type="button">ver calendário</button></div>}{mismatch && <div className="notice warn">Este compromisso está marcado como {scoutDay.type}. Confira se o tipo de scout está certo; a sessão fica registrada com o vínculo do dia.</div>}<div className="scout-toolbar"><div className="mode-switch"><button className={mode === 'game' ? 'active' : ''} onClick={() => setMode('game')} type="button"><Swords size={16} /> Scout de Jogo</button><button className={mode === 'finishing' ? 'active' : ''} onClick={() => setMode('finishing')} type="button"><Target size={16} /> Treino de Finalização</button></div><label className="athlete-select"><UserRound size={16} /><span>Atleta ativo</span><select value={activeAthlete?.id ?? ''} onChange={(event) => onActive(event.target.value)} disabled={athletes.length === 0}><option value="">Selecione um atleta</option>{athletes.map((athlete) => <option key={athlete.id} value={athlete.id}>{athlete.number ? `#${athlete.number} · ` : ''}{athlete.name}</option>)}</select></label></div>{!activeAthlete ? <EmptyState icon={UserRound} title="Selecione um atleta ativo" text="Volte à aba Elenco, cadastre um jogador e escolha quem será observado." /> : <>{mode === 'game' ? <div className="scout-body"><div className="scout-context"><span className="avatar large">{activeAthlete.name.slice(0, 1)}</span><div><strong>{activeAthlete.name}</strong><small>{activeAthlete.positions} · {activeAthlete.height || '—'} cm · {activeAthlete.weight || '—'} kg · camisa {activeAthlete.number || '—'}</small></div><span className="live-badge"><i /> registrando</span></div><div className="metrics-grid">{GAME_METRICS.map(({ key, label, icon, tone }) => <MetricButton key={key} label={label} value={stats.game[key]} icon={icon} tone={tone} invalid={validation.invalid.has(key)} onAdd={() => onIncrement(key)} onRemove={() => onIncrement(key, -1)} />)}</div><p className="passes-total">Passes no total: <b>{stats.game.accuratePasses + stats.game.wrongPasses}</b> (certos + errados)</p></div> : <div className="scout-body"><div className="finishing-total"><div><span className="eyebrow">TOTAL DA SESSÃO</span><strong>{finishingTotal}</strong><small>finalizações</small></div><div className="total-breakdown"><span><b>{targetTotal}</b> no gol</span><span><b>{goalTotal}</b> gols</span></div></div>{foot === 'Ambidestro' && <div className="notice info">{activeAthlete.name} é ambidestro: registre por perna direita e esquerda. Os indicadores de dominante e não dominante não se aplicam.</div>}<div className="leg-grid"><FinishingLeg title={legs.dominant} tone="green" metrics={[['dominantFinishes', 'Finalizações'], ['dominantOnTarget', 'No gol'], ['dominantGoals', 'Gols']]} stats={stats.finishing} invalid={validation.invalid} onIncrement={onIncrement} /><FinishingLeg title={legs.nonDominant} tone="blue" metrics={[['nonDominantFinishes', 'Finalizações'], ['nonDominantOnTarget', 'No gol'], ['nonDominantGoals', 'Gols']]} stats={stats.finishing} invalid={validation.invalid} onIncrement={onIncrement} /></div></div>}<div className="live-rates" aria-live="polite">{liveRates.map((rate) => <div key={rate.key}><span>{rate.label}</span><strong>{formatPct(rate.value)}</strong><small>{rate.numerator}/{rate.denominator}</small></div>)}</div>{validation.errors.map((message) => <div className="notice error" key={message}>{message}</div>)}{validation.warnings.map((message) => <div className="notice warn" key={message}>{message}</div>)}</>}</section>
}

function FinishingLeg({ title, tone, metrics, stats, invalid, onIncrement }: { title: string; tone: string; metrics: Array<[FinishingMetric, string]>; stats: Record<FinishingMetric, number>; invalid: Set<string>; onIncrement: (metric: FinishingMetric, amount?: number) => void }) {
  const shots = stats[metrics[0][0]]
  const goals = stats[metrics[2][0]]
  return <div className={`leg-card leg-${tone}`}><div className="leg-heading"><Target size={18} /><strong>{title}</strong><span className="leg-eff">eficiência {formatPct(shots > 0 ? Math.round((1000 * goals) / shots) / 10 : null)}</span></div><div className="leg-metrics">{metrics.map(([key, label]) => <div className={`leg-metric ${invalid.has(key) ? 'invalid' : ''}`} key={key}><button onClick={() => onIncrement(key)} type="button" aria-label={`${title} ${label}: ${stats[key]}. Somar 1`}><span>{label}</span><strong>{stats[key]}</strong><small>+1</small></button><button className="metric-minus" onClick={() => onIncrement(key, -1)} disabled={stats[key] === 0} type="button" aria-label={`Desfazer 1 em ${label}`}><Minus size={12} /></button></div>)}</div></div>
}

function EmptyState({ icon: Icon, title, text, action }: { icon: typeof Users; title: string; text: string; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon"><Icon size={22} /></span><strong>{title}</strong><p>{text}</p>{action}</div>
}

function ReportModal({ session, onClose, onCopy, onDownload }: { session: SessionRecord; onClose: () => void; onCopy: (session: SessionRecord) => void; onDownload: (session: SessionRecord) => void }) {
  const isGame = session.mode === 'game'
  const f = session.stats.finishing
  const kindLabel = isGame ? 'Scout de Jogo' : 'Treino de Finalização'
  return <div className="modal-backdrop" role="presentation"><div className="report-modal" role="dialog" aria-modal="true" aria-labelledby="report-title"><div className="modal-top"><span className="status-pill"><i /> sessão finalizada</span><button className="icon-button" onClick={onClose} type="button" aria-label="Fechar relatório"><X size={18} /></button></div><div className="eyebrow">RELATÓRIO CONSOLIDADO</div><h2 id="report-title">{isGame ? 'Leitura de jogo.' : 'Treino registrado.'}</h2><div className="report-session-label"><Tag size={15} /> {session.periodizationTag || 'Sessão avulsa'} · {formatDayMonth(session.calendarDate)} · {session.category}</div><p className="report-meta">{kindLabel} · {session.athleteName} · {formatDateTime(session.createdAt)}</p><div className="report-summary">{isGame ? <>{GAME_METRICS.slice(0, 6).map(({ key, label }) => <div key={key}><span>{label}</span><strong>{session.stats.game[key]}</strong></div>)}</> : <><div><span>Finalizações</span><strong>{f.dominantFinishes + f.nonDominantFinishes}</strong></div><div><span>No gol</span><strong>{f.dominantOnTarget + f.nonDominantOnTarget}</strong></div><div><span>Gols</span><strong>{f.dominantGoals + f.nonDominantGoals}</strong></div></>}</div><div className="report-rates">{(isGame ? gameRates(sumGame([session])) : finishingRates(sumFinishing([session]), session.dominantFootSnapshot === 'Ambidestro')).map((rate) => <div key={rate.key}><span>{rate.label}</span><strong>{formatPct(rate.value)}</strong></div>)}</div><div className="modal-actions"><button className="secondary-button" onClick={() => onDownload(session)} type="button"><FileDown size={16} /> Baixar PDF</button><button className="primary-button" onClick={() => onCopy(session)} type="button"><MessageCircle size={16} /> Copiar para WhatsApp</button></div><div className="report-foot"><Clipboard size={14} /> {reportTitleForDisplay(session)}</div></div></div>
}

function reportTitleForDisplay(session: SessionRecord) {
  const kind = session.mode === 'game' ? 'Jogo' : 'Treino'
  return `Relatório de ${kind} - ${session.category} - ${session.periodizationTag || 'Sessão avulsa'} (${formatDayMonth(session.calendarDate)})`
}

export default App
