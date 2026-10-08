'use client'

import { useState, useMemo, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, TrendingUp, TrendingDown } from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { useStore, portfolioGames } from '@/lib/store'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { formatCurrency, formatPercent } from '@/lib/utils'
import { authFetch } from '@/lib/firebase/authFetch'
import { LogoLoader } from '@/components/LogoLoader'

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
  { key: 'value',  label: 'Collection Value', dataKey: 'value',     staticColor: '#7a5230' },
  { key: 'pnl',    label: 'P&L',              dataKey: 'pnl',       staticColor: '#5f7a32' },
  { key: 'return', label: 'Return %',          dataKey: 'returnPct', staticColor: '#5f7a32' },
  { key: 'cost',   label: 'Total Invested',    dataKey: 'cost',      staticColor: '#5c4d5a' },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

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

  const { cards, priceBaselines, priceLoad, activeGames: filterGames, trackedGames, calcFloor } = useStore()
  const activeGames = useMemo(() => portfolioGames(filterGames, trackedGames), [filterGames, trackedGames])

  // Apply the same filters as PortfolioPage so numbers line up exactly
  const filteredCards = useMemo(() => {
    return cards.filter((c) => {
      if (!activeGames.includes(c.game)) return false
      if (calcFloor > 0 && (c.currentPrice ?? c.purchasePrice) < calcFloor) return false
      return true
    })
  }, [cards, activeGames, calcFloor])

  // Daily portfolio value comes from the shared, catalog-level price history, summed on the
  // server (app/api/price-history, mode "portfolio") — only one number per day is downloaded.
  // Cards without a catalog price (manual / unmatched) count at their own price every day.
  const catalogCards = useMemo(() => filteredCards.filter((c) => c.apiId && !c.priceLocked), [filteredCards])
  const fixedValue = useMemo(
    () => filteredCards.filter((c) => !c.apiId || c.priceLocked).reduce((s, c) => s + (c.currentPrice ?? c.purchasePrice) * c.quantity, 0),
    [filteredCards],
  )
  const requestKey = catalogCards.map((c) => `${c.id}:${c.quantity}:${c.isFoil ? 1 : 0}`).join('|')
  const [dailyValues, setDailyValues] = useState<{ day: string; value: number }[]>([])
  // Which request the current dailyValues answer — the page waits behind the loader until the
  // timeline for the current cards has actually come back.
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  useEffect(() => {
    let stale = false
    if (catalogCards.length === 0) { setDailyValues([]); setLoadedKey(requestKey); return }
    authFetch('/api/price-history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'portfolio',
        days: 730,
        items: catalogCards.map((c) => ({
          key: c.id, game: c.game, apiId: c.apiId, isFoil: c.isFoil,
          qty: c.quantity, fallback: c.currentPrice ?? c.purchasePrice,
        })),
      }),
    })
      .then((r) => (r.ok ? r.json() : { timeline: [] }))
      .then((data: { timeline: { day: string; value: number }[] }) => { if (!stale) setDailyValues(data.timeline ?? []) })
      .catch(() => {})
      .finally(() => { if (!stale) setLoadedKey(requestKey) })
    return () => { stale = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey])

  // P&L and Return use the same "Since Entry" baseline as PortfolioPage:
  // priceAtEntry (market price when added) → earliest shared-history price → purchasePrice.
  const timeline = useMemo<TimelinePoint[]>(() => {
    if (dailyValues.length === 0) return []
    const cost = filteredCards.reduce((s, c) => s + c.purchasePrice * c.quantity, 0)
    const entryBase = filteredCards.reduce(
      (s, c) => s + (c.priceAtEntry ?? priceBaselines[c.id]?.first ?? c.purchasePrice) * c.quantity,
      0,
    )
    return dailyValues.map(({ day, value: catalogValue }) => {
      const value = catalogValue + fixedValue
      const pnl = value - entryBase
      return {
        day,
        label: new Date(day + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        value,
        cost,
        pnl,
        returnPct: entryBase > 0 ? (pnl / entryBase) * 100 : 0,
      }
    })
  }, [dailyValues, fixedValue, filteredCards, priceBaselines])

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
      ? (current >= 0 ? '#5f7a32' : '#a8452a')
      : staticColor

  const hasData = timeline.length >= 2
  const gradId  = `grad-analytics-${metric}`

  const summaryStats = [
    { label: 'Current',       value: current,     isChange: false },
    { label: 'First Record',  value: start,       isChange: false },
    { label: 'All-Time High', value: allTimeHigh, isChange: false },
    { label: 'Total Change',  value: totalChange, isChange: true  },
  ]

  if (!priceLoad.complete || loadedKey !== requestKey) {
    return (
      <AuthGuard>
        <LogoLoader label="Loading your portfolio history…" progress={!priceLoad.complete && priceLoad.total > 0 ? { done: priceLoad.done, total: priceLoad.total } : undefined} />
      </AuthGuard>
    )
  }

  return (
    <AuthGuard>
      <div>

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Link
            href="/"
            className="p-2 rounded-xl text-slate-500 hover:text-ink hover:bg-slate-800 transition-colors"
          >
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-ink">Portfolio Analytics</h1>
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
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-ink hover:border-slate-700'
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
            <div className="text-4xl font-black text-ink mb-2">
              {formatValue(current, metric)}
            </div>
            {hasData && (
              <div className={`flex items-center gap-1.5 text-sm font-medium ${
                totalChange >= 0 ? 'text-emerald-600' : 'text-red-600'
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
                Prices update automatically several times a day, and a data point is recorded each day.
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
                <CartesianGrid strokeDasharray="3 3" stroke="#d6c49f" vertical={false} />
                {(metric === 'pnl' || metric === 'return') && (
                  <ReferenceLine y={0} stroke="#bba883" strokeDasharray="4 4" />
                )}
                <XAxis
                  dataKey="label"
                  tick={{ fill: '#7a654a', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fill: '#7a654a', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => yAxisLabel(v, metric)}
                  width={60}
                />
                <Tooltip
                  contentStyle={{
                    background: '#ede1c6',
                    border: '1px solid #d6c49f',
                    borderRadius: '0.75rem',
                    fontSize: 12,
                  }}
                  labelStyle={{ color: '#634f38', marginBottom: 4 }}
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
                    ? (value >= 0 ? 'text-emerald-600' : 'text-red-600')
                    : 'text-ink'
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
