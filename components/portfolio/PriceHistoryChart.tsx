'use client'

import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceDot,
} from 'recharts'
import { formatCurrency } from '@/lib/utils'

interface Props {
  data: { date: string; price: number }[]
  color: string
  /** When you got the card (2026-11-24): a little card on the line at that day, and a faint line down from it */
  gotIt?: { date: string; title: string }
}

/** The "you got it here" marker: a tiny upright card in the line's colour */
function CardMark({ cx, cy, color }: { cx?: number; cy?: number; color: string }) {
  if (cx == null || cy == null) return null
  return (
    <g transform={`translate(${cx - 7}, ${cy - 23})`}>
      <rect x="0" y="0" width="14" height="19" rx="2.5" fill="#fbf6ea" stroke={color} strokeWidth="1.75" />
      <rect x="3" y="3" width="8" height="7" rx="1" fill={color} opacity="0.55" />
      <line x1="3" y1="13" x2="11" y2="13" stroke={color} strokeWidth="1.25" opacity="0.7" />
      <line x1="3" y1="15.5" x2="9" y2="15.5" stroke={color} strokeWidth="1.25" opacity="0.7" />
      <circle cx="7" cy="23" r="2.5" fill={color} stroke="#fbf6ea" strokeWidth="1.25" />
    </g>
  )
}

export function PriceHistoryChart({ data, color, gotIt }: Props) {
  if (data.length < 2) {
    return (
      <div className="flex items-center justify-center h-48 text-slate-600 text-sm">
        Not enough price data to show a chart.
      </div>
    )
  }

  // Labels carry the year once the chart spans more than one (history goes back to 2024)
  const years = new Set(data.map((d) => new Date(d.date).getFullYear()))
  const formatted = data.map((d) => ({
    ...d,
    label: new Date(d.date).toLocaleDateString('en-US', years.size > 1 ? { month: 'short', day: 'numeric', year: '2-digit' } : { month: 'short', day: 'numeric' }),
  }))
  // The day you got it: the point on (or just after) that date — nothing when it's outside the range shown
  const gotAt = gotIt ? Date.parse(gotIt.date.length === 10 ? gotIt.date + 'T12:00:00' : gotIt.date) : NaN
  const firstAt = Date.parse(data[0].date)
  const lastAt = Date.parse(data[data.length - 1].date)
  const mark = Number.isFinite(gotAt) && gotAt >= firstAt - 86400000 && gotAt <= lastAt + 86400000
    ? formatted.find((d) => Date.parse(d.date) >= gotAt - 43200000) ?? formatted[formatted.length - 1]
    : null

  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={formatted} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
        <defs>
          <linearGradient id={`grad-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.3} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#d6c49f" vertical={false} />
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
          tickFormatter={(v) => formatCurrency(v).replace(/\.00$/, '')}
          width={50}
        />
        <Tooltip
          contentStyle={{ background: '#ede1c6', border: '1px solid #d6c49f', color: '#2b2014', borderRadius: '0.75rem', fontSize: 12 }}
          labelStyle={{ color: '#634f38' }}
          formatter={(val: number) => [formatCurrency(val), 'Price']}
        />
        {mark && <ReferenceLine x={mark.label} stroke={color} strokeOpacity={0.35} strokeDasharray="3 3" />}
        <Area
          type="monotone"
          dataKey="price"
          stroke={color}
          strokeWidth={2}
          fill={`url(#grad-${color.replace('#', '')})`}
          dot={false}
          activeDot={{ r: 4, fill: color }}
        />
        {mark && gotIt && (
          <ReferenceDot x={mark.label} y={mark.price} r={0} ifOverflow="extendDomain"
            shape={(props: { cx?: number; cy?: number }) => <g><title>{gotIt.title}</title><CardMark cx={props.cx} cy={props.cy} color={color} /></g>} />
        )}
      </AreaChart>
    </ResponsiveContainer>
  )
}
