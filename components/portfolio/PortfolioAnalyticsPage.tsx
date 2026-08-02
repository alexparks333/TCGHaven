'use client'

import { useState, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, TrendingUp, TrendingDown } from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { useStore } from '@/lib/store'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { formatCurrency, formatPercent } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

type Metric = 'value' | 'pnl' | 'return' | 'cost'

interface TimelinePoint {
  day: string
  label: string
  value: number
  cost: number
  pnl: number
  returnPct: number
}

// ── Metric config ─────────────────────────────────────────────────────────────

const METRICS: { key: Metric; label: string; dataKey: keyof TimelinePoint; staticColor: string }[] = [
  { key: 'value',  label: 'Collection Value', dataKey: 'value',     staticColor: '#8B5CF6' },
  { key: 'pnl',    label: 'P&L',              dataKey: 'pnl',       staticColor: '#10B981' },
  { key: 'return', label: 'Return %',          dataKey: 'returnPct', staticColor: '#10B981' },
  { key: 'cost',   label: 'Total Invested',    dataKey: 'cost',      staticColor: '#6366F1' },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function priceAtOrBefore(
  points: { date: string; price: number }[],
  day: string,
): number | null {
  let best: number | null = null
  let bestDay = ''
  for (const p of points) {
    const d = p.date.slice(0, 10)
    if (d <= day && d > bestDay) { best = p.price; bestDay = d }
  }
  return best
}

function yAxisLabel(v: number, metric: Metric): string {
  if (metric === 'return') return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`
  const abs = Math.abs(v)
  const prefix = v < 0 ? '-' : ''
  if (abs >= 1000) return `${prefix}$${(abs / 1000).toFixed(1)}k`
  return `${prefix}$${abs.toFixed(0)}`
}

function formatValue(v: number, metric: Metric): string {
  return metric === 'return' ? formatPercent(v) : formatCurrency(v)
}

function formatChange(v: number, metric: Metric): string {
  const sign = v >= 0 ? '+' : ''
  return metric === 'return' ? `${sign}${v.toFixed(2)}%` : `${sign}${formatCurrency(v)}`
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PortfolioAnalyticsPage() {
  const searchParams = useSearchParams()
  const raw = searchParams.get('metric') ?? ''
  const initial: Metric = ['value', 'pnl', 'return', 'cost'].includes(raw) ? (raw as Metric) : 'value'
  const [metric, setMetric] = useState<Metric>(initial)

  const { cards, priceHistory, activeGames, calcFloor } = useStore()

  // Apply the same filters as PortfolioPage so numbers line up exactly
  const filteredCards = useMemo(() => {
    return cards.filter((c) => {
      if (!activeGames.includes(c.game)) return false
      if (calcFloor > 0 && (c.currentPrice ?? c.purchasePrice) < calcFloor) return false
      return true
    })
  }, [cards, activeGames, calcFloor])

  // Build one timeline point per calendar day from all price history.
  // P&L and Return use the same "Since Entry" baseline as PortfolioPage:
  // priceAtEntry (market price when card was added) → earliest history point → purchasePrice.
  const timeline = useMemo<TimelinePoint[]>(() => {
    const historyMap = new Map<string, { date: string; price: number }[]>()
    const daySet = new Set<string>()

    const filteredIds = new Set(filteredCards.map((c) => c.id))
    for (const h of priceHistory) {
      if (!filteredIds.has(h.cardId)) continue
      historyMap.set(h.cardId, h.points)
      for (const p of h.points) daySet.add(p.date.slice(0, 10))
    }

    if (daySet.size === 0) return []

    // Pre-compute per-card baseline (same logic as PortfolioPage "Since Entry")
    const cardMeta = filteredCards.map((card) => {
      const history = historyMap.get(card.id)
      const sorted = history
        ? Array.from(history).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        : []
      const earliestHistPrice = sorted.length > 0 ? sorted[0].price : null
      const baseline = card.priceAtEntry ?? earliestHistPrice ?? card.purchasePrice
      return { card, baseline }
    })

    const byDay = new Map<string, TimelinePoint>()

    for (const day of Array.from(daySet).sort()) {
      let value = 0
      let cost = 0
      let entryBase = 0

      for (const { card, baseline } of cardMeta) {
        const qty = card.quantity
        const history = historyMap.get(card.id)
        const price =
          (history ? priceAtOrBefore(history, day) : null) ??
          card.currentPrice ??
          card.purchasePrice
        value += price * qty
        cost += card.purchasePrice * qty
        entryBase += baseline * qty
      }

      const pnl = value - entryBase
      byDay.set(day, {
        day,
        label: new Date(day + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        value,
        cost,
        pnl,
        returnPct: entryBase > 0 ? (pnl / entryBase) * 100 : 0,
      })
    }

    return Array.from(byDay.values())
  }, [filteredCards, priceHistory])

  const cfg = METRICS.find((m) => m.key === metric)!
  const { dataKey, staticColor } = cfg

  const values = timeline.map((t) => t[dataKey] as number)
  const current = values.at(-1) ?? 0
  const start   = values[0] ?? 0
  const allTimeHigh = values.length ? Math.max(...values) : 0
  const totalChange = current - start

  // P&L and Return flip red when negative
  const color =
    metric === 'pnl' || metric === 'return'
      ? (current >= 0 ? '#10B981' : '#EF4444')
      : staticColor

  const hasData = timeline.length >= 2
  const gradId  = `grad-analytics-${metric}`

  const summaryStats = [
    { label: 'Current',       value: current,     isChange: false },
    { label: 'First Record',  value: start,       isChange: false },
    { label: 'All-Time High', value: allTimeHigh, isChange: false },
    { label: 'Total Change',  value: totalChange, isChange: true  },
  ]

  return (
    <AuthGuard>
      <div className="pb-20 md:pb-0">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Link
            href="/"
            className="p-2 rounded-xl text-slate-500 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-white">Portfolio Analytics</h1>
            <p className="text-slate-500 text-xs mt-0.5">
              {hasData
                ? `${timeline.length} day${timeline.length !== 1 ? 's' : ''} of history`
                : 'Refresh prices daily to build your timeline'}
            </p>
          </div>
        </div>

        {/* Metric selector */}
        <div className="flex gap-2 mb-6 flex-wrap">
          {METRICS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setMetric(key)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all border ${
                metric === key
                  ? 'bg-violet-600 border-violet-500 text-white'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Main chart card */}
        <div className="card-glass p-6 mb-4">

          {/* Hero number + trend */}
          <div className="mb-6">
            <div className="text-xs text-slate-500 uppercase tracking-wide font-semibold mb-1">
              {cfg.label}
            </div>
            <div className="text-4xl font-black text-white mb-2">
              {formatValue(current, metric)}
            </div>
            {hasData && (
              <div className={`flex items-center gap-1.5 text-sm font-medium ${
                totalChange >= 0 ? 'text-emerald-400' : 'text-red-400'
              }`}>
                {totalChange >= 0
                  ? <TrendingUp size={15} />
                  : <TrendingDown size={15} />
                }
                <span>{formatChange(totalChange, metric)} since first record</span>
              </div>
            )}
          </div>

          {/* Chart */}
          {!hasData ? (
            <div className="flex flex-col items-center justify-center h-64 text-center gap-3">
              <div className="text-3xl">📈</div>
              <div className="text-slate-400 text-sm font-medium">Not enough history yet</div>
              <div className="text-slate-600 text-xs max-w-xs">
                Every time you hit Refresh Prices, a new data point is recorded.
                Come back after a few days to see your timeline.
              </div>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={340}>
              <AreaChart data={timeline} margin={{ top: 10, right: 8, left: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={color} stopOpacity={0.25} />
                    <stop offset="95%" stopColor={color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                {(metric === 'pnl' || metric === 'return') && (
                  <ReferenceLine y={0} stroke="#334155" strokeDasharray="4 4" />
                )}
                <XAxis
                  dataKey="label"
                  tick={{ fill: '#64748b', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fill: '#64748b', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => yAxisLabel(v, metric)}
                  width={60}
                />
                <Tooltip
                  contentStyle={{
                    background: '#0f172a',
                    border: '1px solid #1e293b',
                    borderRadius: '0.75rem',
                    fontSize: 12,
                  }}
                  labelStyle={{ color: '#94a3b8', marginBottom: 4 }}
                  formatter={(val: number) => [formatValue(val, metric), cfg.label]}
                />
                <Area
                  type="monotone"
                  dataKey={dataKey as string}
                  stroke={color}
                  strokeWidth={2.5}
                  fill={`url(#${gradId})`}
                  dot={timeline.length <= 14}
                  activeDot={{ r: 5, fill: color, strokeWidth: 0 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Summary stat row */}
        {hasData && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {summaryStats.map(({ label, value, isChange }) => (
              <div key={label} className="card-glass p-4">
                <div className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold mb-1.5">
                  {label}
                </div>
                <div className={`text-lg font-bold ${
                  isChange
                    ? (value >= 0 ? 'text-emerald-400' : 'text-red-400')
                    : 'text-white'
                }`}>
                  {isChange ? formatChange(value, metric) : formatValue(value, metric)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AuthGuard>
  )
}
