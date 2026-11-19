'use client'

import { useEffect, useMemo, useState } from 'react'
import { PieChart, Pie, Cell, Sector, ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts'
import { PieChart as PieIcon, TrendingUp } from 'lucide-react'
import { cn, formatCurrency } from '@/lib/utils'
import type { Card } from '@/lib/types'
import { usePortfolioTimeline } from './usePortfolioTimeline'
import { PremiumLock } from '@/components/premium/PremiumLock'

interface Slice { name: string; value: number; color: string; count?: number }
type Mode = 'game' | 'time'
const MODE_KEY = 'tcghaven-portfolio-chart'

/** Portfolio's value card: the collection's value split by game (a donut), or its value over time
 *  (an area chart) — a toggle top right switches them (remembered on this device). The Portfolio's
 *  only by-game view since 2026-11-15 (it replaced the By Game cards) — on phones too. `cards` are
 *  the same filtered cards the by-game split counts, for the over-time chart. */
export function PortfolioPieChart({ data, cards }: { data: Slice[]; cards: Card[] }) {
  const [mode, setMode] = useState<Mode>('game')
  useEffect(() => {
    try { if (localStorage.getItem(MODE_KEY) === 'time') setMode('time') } catch { /* private window */ }
  }, [])
  const pick = (m: Mode) => {
    setMode(m)
    try { localStorage.setItem(MODE_KEY, m) } catch { /* private window */ }
  }
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wide">{mode === 'game' ? 'Value by Game' : 'Value over Time'}</h3>
        <div role="radiogroup" aria-label="Chart" className="relative inline-flex shrink-0 rounded-full bg-slate-800/70 p-0.5 border border-slate-700/60">
          <span
            aria-hidden
            className="absolute top-0.5 bottom-0.5 left-0.5 w-[calc(50%-0.125rem)] rounded-full bg-slate-900 shadow transition-transform duration-300 ease-out"
            style={{ transform: mode === 'time' ? 'translateX(100%)' : undefined }}
          />
          {([['game', 'By game', PieIcon], ['time', 'Over time', TrendingUp]] as const).map(([m, label, Icon]) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              aria-label={label}
              title={label}
              onClick={() => pick(m)}
              className={cn('relative z-10 flex items-center justify-center w-8 h-7 rounded-full transition-colors', mode === m ? 'text-ink' : 'text-slate-500 hover:text-slate-300')}
            >
              <Icon size={14} strokeWidth={2.25} />
            </button>
          ))}
        </div>
      </div>
      {mode === 'game' ? <ByGame data={data} /> : <OverTime cards={cards} />}
    </div>
  )
}

// ── By game: a donut whose centre shows the hovered game ─────────────────────────────────────────

function ByGame({ data }: { data: Slice[] }) {
  const total = data.reduce((s, d) => s + d.value, 0)
  const cards = data.reduce((s, d) => s + (d.count ?? 0), 0)
  // The slice (or legend row) pointed at — its details take the centre. (A floating tooltip sat
  // under the centre's total and couldn't be read, 2026-11-19.)
  const [hover, setHover] = useState<number | null>(null)
  const h = hover !== null ? data[hover] : null
  const pct = (v: number) => (total > 0 ? Math.round((v / total) * 100) : 0)
  return (
    <>
      <div className="relative">
        <ResponsiveContainer width="100%" height={210}>
          <PieChart>
            <defs>
              {data.map((d, i) => (
                <linearGradient key={i} id={`pv-slice-${i}`} x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor={d.color} stopOpacity={0.78} />
                  <stop offset="100%" stopColor={d.color} stopOpacity={1} />
                </linearGradient>
              ))}
            </defs>
            {/* the track the slices sit in */}
            <Pie data={[{ v: 1 }]} dataKey="v" cx="50%" cy="50%" innerRadius={60} outerRadius={88} isAnimationActive={false} stroke="none" fill="rgba(74,50,31,0.07)" />
            <Pie
              data={data}
              dataKey="value"
              cx="50%"
              cy="50%"
              innerRadius={63}
              outerRadius={85}
              paddingAngle={data.length > 1 ? 3 : 0}
              cornerRadius={5}
              stroke="none"
              activeIndex={hover ?? undefined}
              activeShape={ActiveSlice}
              onMouseEnter={(_, i) => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onClick={(_, i) => setHover((x) => (x === i ? null : i))}
              animationDuration={700}
            >
              {data.map((d, i) => (
                <Cell key={i} fill={`url(#pv-slice-${i})`} style={{ cursor: 'pointer', opacity: hover === null || hover === i ? 1 : 0.45, transition: 'opacity 200ms' }} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center">
          {h ? (
            <div key={h.name} className="pv-center-in flex flex-col items-center">
              <div className="flex items-center gap-1.5 text-[0.625rem] uppercase tracking-wide font-semibold" style={{ color: h.color }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: h.color }} />
                {h.name}
              </div>
              <div className="text-base font-bold text-ink tabular-nums">{formatCurrency(h.value)}</div>
              <div className="text-[0.625rem] text-slate-500 font-medium">
                {pct(h.value)}%{h.count !== undefined ? ` · ${h.count} card${h.count === 1 ? '' : 's'}` : ''}
              </div>
            </div>
          ) : (
            <div key="total" className="pv-center-in flex flex-col items-center">
              <div className="text-[0.625rem] uppercase tracking-wide text-slate-500 font-semibold">Total</div>
              <div className="text-base font-bold text-ink tabular-nums">{formatCurrency(total)}</div>
              {cards > 0 && <div className="text-[0.625rem] text-slate-500 font-medium">{cards} card{cards === 1 ? '' : 's'}</div>}
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-2 mt-3">
        {data.map((d, i) => (
          <div
            key={d.name}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            className={cn('rounded-lg px-2 py-1 -mx-2 transition-colors cursor-default', hover === i && 'bg-slate-800/50')}
          >
            <div className="flex items-center gap-2 text-xs">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: d.color, boxShadow: `0 0 0 2px ${d.color}26` }} />
              <span className="text-slate-400 truncate">{d.name}</span>
              <span className="ml-auto font-semibold text-ink tabular-nums">{formatCurrency(d.value)}</span>
              <span className="w-9 text-right text-slate-500 tabular-nums">{pct(d.value)}%</span>
            </div>
            {/* its share, as a thin bar */}
            <div className="mt-1 h-1 rounded-full bg-slate-800/60 overflow-hidden">
              <div className="h-full rounded-full transition-[width] duration-700 ease-out" style={{ width: `${Math.max(pct(d.value), d.value > 0 ? 1 : 0)}%`, background: `linear-gradient(90deg, ${d.color}aa, ${d.color})` }} />
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

// The pointed-at slice: a little bigger, with a soft halo ring outside it
function ActiveSlice(props: unknown) {
  const p = props as { cx: number; cy: number; innerRadius: number; outerRadius: number; startAngle: number; endAngle: number; fill: string; payload: Slice }
  return (
    <g>
      <Sector cx={p.cx} cy={p.cy} innerRadius={p.innerRadius - 2} outerRadius={p.outerRadius + 5} startAngle={p.startAngle} endAngle={p.endAngle} cornerRadius={5} fill={p.fill} />
      <Sector cx={p.cx} cy={p.cy} innerRadius={p.outerRadius + 8} outerRadius={p.outerRadius + 11} startAngle={p.startAngle} endAngle={p.endAngle} cornerRadius={2} fill={p.payload.color} opacity={0.35} />
    </g>
  )
}

// ── Over time: the collection's value, day by day ───────────────────────────────────────────────

const RANGES = [['1M', 30], ['3M', 90], ['1Y', 365], ['All', 0]] as const
type Range = typeof RANGES[number][0]

function OverTime({ cards }: { cards: Card[] }) {
  const { dailyValues, fixedValue, ready, locked } = usePortfolioTimeline(cards)
  const [range, setRange] = useState<Range>('3M')
  const points = useMemo(() => {
    const days = RANGES.find(([r]) => r === range)![1]
    const all = dailyValues.map(({ day, value }) => ({ day, value: value + fixedValue }))
    return days ? all.slice(-days) : all
  }, [dailyValues, fixedValue, range])
  const first = points[0]?.value ?? 0
  const last = points[points.length - 1]?.value ?? 0
  const change = last - first
  const changePct = first > 0 ? (change / first) * 100 : 0
  // a little room above and below the line
  const lo = Math.min(...points.map((p) => p.value)), hi = Math.max(...points.map((p) => p.value))
  const pad = (hi - lo) * 0.12 || hi * 0.02 || 1
  const up = change >= 0
  const color = up ? '#4f7a2a' : '#b4432a'
  const fmtDay = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  if (locked) {
    return <PremiumLock reason="portfolio-time" className="flex-1 min-h-[16rem]" title="Watch your collection grow" sub="Your collection’s value day by day comes with Haven Premium." />
  }
  if (!ready) {
    return <div className="flex-1 min-h-[16rem] flex items-center justify-center text-xs text-slate-500">Loading your history…</div>
  }
  if (points.length < 2) {
    return <div className="flex-1 min-h-[16rem] flex items-center justify-center text-center text-xs text-slate-500 px-6">Not enough price history yet — check back in a day or two.</div>
  }
  return (
    <div className="flex flex-col flex-1">
      <div className="flex items-end justify-between gap-3 mb-2">
        <div>
          <div className="text-xl font-bold text-ink tabular-nums leading-tight">{formatCurrency(last)}</div>
          <div className="text-xs font-semibold tabular-nums" style={{ color }}>
            {up ? '▲' : '▼'} {formatCurrency(Math.abs(change))} ({Math.abs(changePct).toFixed(1)}%)
            <span className="ml-1 font-medium text-slate-500">{range === 'All' ? 'all time' : `past ${range === '1M' ? 'month' : range === '3M' ? '3 months' : 'year'}`}</span>
          </div>
        </div>
        <div className="flex gap-0.5 rounded-lg bg-slate-800/50 p-0.5">
          {RANGES.map(([r]) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={cn('px-2 py-1 rounded-md text-[0.6875rem] font-semibold transition-colors', range === r ? 'bg-slate-900 text-ink shadow-sm' : 'text-slate-500 hover:text-slate-300')}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 min-h-[13rem] -mx-2">
        <ResponsiveContainer width="100%" height="100%" minHeight={208}>
          <AreaChart data={points} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
            <defs>
              <linearGradient id="pv-area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.32} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="day" tickFormatter={fmtDay} tick={{ fontSize: 10, fill: '#8a7558' }} axisLine={false} tickLine={false} minTickGap={36} />
            <YAxis hide domain={[Math.max(0, lo - pad), hi + pad]} />
            <Tooltip
              cursor={{ stroke: color, strokeOpacity: 0.35, strokeDasharray: '3 3' }}
              wrapperStyle={{ zIndex: 20, outline: 'none' }}
              contentStyle={{ background: '#ede1c6', border: '1px solid #d6c49f', color: '#2b2014', borderRadius: '0.75rem', fontSize: 12, padding: '6px 10px' }}
              labelFormatter={(d: string) => fmtDay(d)}
              separator=": "
              formatter={(v: number) => [formatCurrency(v), 'Value']}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke={color}
              strokeWidth={2.25}
              fill="url(#pv-area)"
              activeDot={{ r: 4, strokeWidth: 2, stroke: '#ede1c6', fill: color }}
              animationDuration={700}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
