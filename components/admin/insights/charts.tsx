'use client'

import type { ReactNode } from 'react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { cn } from '@/lib/utils'

// Shared pieces for the staff portal's Statistics and Finances pages. One look everywhere: thin
// marks, recessive grid, a parchment tooltip, text in ink (never in the series colour).

// Each game's chart colour — stronger takes on GAME_COLORS (lib/types.ts), which read too grey to
// tell apart in a chart. Checked with the data-viz palette validator on the portal's card surface
// (#efe4cc): lightness, chroma, colour-blind and normal-vision separation, 3:1 contrast — all pass.
export const GAME_CHART: Record<string, string> = {
  pokemon: '#a87600', lorcana: '#8a4fb0', riftbound: '#c94a2c', onepiece: '#16876a', mtg: '#3d6db8', yugioh: '#5b4a8a',
}
export const GAME_ORDER = ['pokemon', 'lorcana', 'riftbound', 'onepiece', 'mtg', 'yugioh']
export const ONE = '#7a5230'       // single-series colour (walnut)
const INK = '#2b2014'
const MUTED = '#7a6a55'
const GRID = '#d6c49f'

export const tooltipStyle = {
  contentStyle: { background: '#f3e9d3', border: '1px solid #d6c49f', borderRadius: 12, fontSize: 12, color: INK, boxShadow: '0 6px 18px rgba(60,40,20,0.15)' },
  labelStyle: { color: INK, fontWeight: 700, marginBottom: 2 },
  itemStyle: { color: INK, padding: 0 },
  cursor: { fill: 'rgba(122,82,48,0.08)' },
}
const axis = { tick: { fill: MUTED, fontSize: 11 }, tickLine: false, axisLine: false }

export const fmtInt = (n: number) => Math.round(n).toLocaleString()
export const fmtPct = (n: number, digits = 1) => `${(n * 100).toFixed(digits)}%`
export const fmtMoney = (n: number) => n.toLocaleString(undefined, { style: 'currency', currency: 'USD' })
export function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  const m = Math.round(seconds / 60)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`
}
export const shortDay = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })

export function Panel({ title, sub, children, className, right }: { title: string; sub?: string; children: ReactNode; className?: string; right?: ReactNode }) {
  return (
    <section className={cn('card-glass p-4 md:p-5', className)}>
      <div className="flex items-start gap-2 mb-3">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-ink">{title}</h3>
          {sub && <p className="text-[11px] text-slate-500 mt-0.5">{sub}</p>}
        </div>
        {right && <div className="ml-auto shrink-0">{right}</div>}
      </div>
      {children}
    </section>
  )
}

/** A headline number. `delta` (optional) is a signed change shown under it. */
export function Tile({ label, value, sub, delta }: { label: string; value: string; sub?: string; delta?: { text: string; good: boolean } }) {
  return (
    <div className="card-glass p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 truncate">{label}</div>
      <div className="mt-1 text-2xl font-bold text-ink tabular-nums">{value}</div>
      {delta && <div className={cn('text-[11px] font-semibold mt-0.5', delta.good ? 'text-emerald-700' : 'text-red-600')}>{delta.text}</div>}
      {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  )
}

/** Ranked horizontal bars: a label, a thin bar, the value — biggest first. Hover shows the detail. */
export function RankBars({ items, format = fmtInt, empty = 'Nothing yet.' }: {
  items: { key: string; label: string; value: number; color?: string; detail?: string }[]
  format?: (n: number) => string
  empty?: string
}) {
  const max = Math.max(0, ...items.map((i) => i.value))
  if (!items.length || max <= 0) return <div className="text-xs text-slate-500 py-6 text-center">{empty}</div>
  return (
    <ul className="flex flex-col gap-2.5">
      {items.map((i) => (
        <li key={i.key} title={i.detail ?? `${i.label}: ${format(i.value)}`} className="group">
          <div className="flex items-baseline gap-2 text-xs">
            {i.color && <span className="w-2 h-2 rounded-full shrink-0 self-center" style={{ backgroundColor: i.color }} />}
            <span className="font-semibold text-ink truncate">{i.label}</span>
            <span className="ml-auto tabular-nums text-slate-400 group-hover:text-ink">{format(i.value)}</span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-slate-800/60 overflow-hidden">
            <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${(i.value / max) * 100}%`, backgroundColor: i.color ?? ONE }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

/** One series over time, as a soft area with a 2px line. */
export function TrendArea({ data, dataKey, name, format = fmtInt, color = ONE, height = 200 }: {
  data: Record<string, unknown>[]; dataKey: string; name: string; format?: (n: number) => string; color?: string; height?: number
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: -8 }}>
        <defs>
          <linearGradient id={`fill-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.25} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
        <XAxis dataKey="label" {...axis} minTickGap={24} />
        <YAxis {...axis} width={44} tickFormatter={(v: number) => format(v)} allowDecimals={false} />
        <Tooltip {...tooltipStyle} cursor={{ stroke: MUTED, strokeDasharray: '3 3' }} formatter={(v: number) => [format(v), name]} />
        <Area type="monotone" dataKey={dataKey} name={name} stroke={color} strokeWidth={2} fill={`url(#fill-${dataKey})`} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: '#efe4cc' }} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

/** Bars over time, one series or stacked by key (with a legend for 2+). */
export function TimeBars({ data, series, format = fmtInt, height = 220 }: {
  data: Record<string, unknown>[]
  series: { key: string; name: string; color: string }[]
  format?: (n: number) => string
  height?: number
}) {
  const stacked = series.length > 1
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: -8 }} barCategoryGap="22%">
        <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
        <XAxis dataKey="label" {...axis} minTickGap={18} />
        <YAxis {...axis} width={44} tickFormatter={(v: number) => format(v)} allowDecimals={false} />
        <Tooltip {...tooltipStyle} formatter={(v: number, n: string) => [format(v), n]} />
        {stacked && <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, color: INK }} formatter={(v) => <span style={{ color: INK }}>{v}</span>} />}
        {series.map((s, i) => (
          <Bar
            key={s.key} dataKey={s.key} name={s.name} fill={s.color} stackId={stacked ? 'a' : undefined}
            stroke="#efe4cc" strokeWidth={stacked ? 1 : 0}
            radius={!stacked || i === series.length - 1 ? [4, 4, 0, 0] : 0}
            maxBarSize={28}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

/** Category bars (not over time) — e.g. collection sizes. */
export function CategoryBars({ data, format = fmtInt, color = ONE, name, height = 200 }: {
  data: { label: string; value: number }[]; format?: (n: number) => string; color?: string; name: string; height?: number
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: -8 }} barCategoryGap="25%">
        <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
        <XAxis dataKey="label" {...axis} interval={0} />
        <YAxis {...axis} width={44} tickFormatter={(v: number) => format(v)} allowDecimals={false} />
        <Tooltip {...tooltipStyle} formatter={(v: number) => [format(v), name]} />
        <Bar dataKey="value" name={name} fill={color} radius={[4, 4, 0, 0]} maxBarSize={44} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="card-glass p-8 text-center text-sm text-slate-500">{children}</div>
}
