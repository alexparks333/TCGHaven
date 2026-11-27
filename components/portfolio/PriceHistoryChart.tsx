'use client'

import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceDot,
} from 'recharts'
import { useEffect, useState } from 'react'
import { formatCurrency } from '@/lib/utils'

/** How long the line takes to draw itself, left to right at an even speed — the "Entered" card pops in
 *  just as the line reaches it (2026-11-27: it used to sit on the empty chart until the line caught up) */
const DRAW_MS = 1200

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

  // The X axis is TIME, not one slot per point: the history before we recorded it is one price a
  // week (2024 – Oct 2026) and daily after, so evenly spaced points squeezed two years into the
  // same width as a few weeks on "All". `at` = the point's time in ms.
  // Labels carry the year once the chart spans more than one (history goes back to 2024)
  const formatted = data
    .map((d) => ({ ...d, at: Date.parse(d.date.length === 10 ? d.date + 'T12:00:00' : d.date) }))
    .filter((d) => Number.isFinite(d.at))
  const years = new Set(formatted.map((d) => new Date(d.at).getFullYear()))
  const dateLabel = (ms: number) =>
    new Date(ms).toLocaleDateString('en-US', years.size > 1 ? { month: 'short', day: 'numeric', year: '2-digit' } : { month: 'short', day: 'numeric' })
  // The day you got it: the point on (or just after) that date — nothing when it's outside the range shown
  const gotAt = gotIt ? Date.parse(gotIt.date.length === 10 ? gotIt.date + 'T12:00:00' : gotIt.date) : NaN
  const firstAt = formatted[0]?.at ?? NaN
  const lastAt = formatted[formatted.length - 1]?.at ?? NaN
  const mark = Number.isFinite(gotAt) && gotAt >= firstAt - 86400000 && gotAt <= lastAt + 86400000
    ? formatted.find((d) => d.at >= gotAt - 43200000) ?? formatted[formatted.length - 1]
    : null

  // The marker (and its faint line down) appear when the drawing line reaches its date: that date's
  // share of the chart's width × DRAW_MS. Re-timed whenever the range shown changes.
  const [markOn, setMarkOn] = useState(false)
  const markFrac = mark && lastAt > firstAt ? Math.min(1, Math.max(0, (mark.at - firstAt) / (lastAt - firstAt))) : 1
  const drawKey = `${firstAt}|${lastAt}|${formatted.length}|${mark?.at ?? ''}`
  useEffect(() => {
    setMarkOn(false)
    if (!Number.isFinite(markFrac)) return
    const t = setTimeout(() => setMarkOn(true), markFrac * DRAW_MS)
    return () => clearTimeout(t)
  }, [drawKey, markFrac])

  if (data.length < 2) {
    return (
      <div className="flex items-center justify-center h-48 text-slate-600 text-sm">
        Not enough price data to show a chart.
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={formatted}
        // room for the "Entered" card, which stands ~25px above its point and 7px either side — at the top
        // or the last day of the chart it was cut off (2026-11-27)
        margin={{ top: mark ? 30 : 5, right: mark ? 14 : 5, left: 5, bottom: 5 }}>
        <defs>
          <linearGradient id={`grad-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.3} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#d6c49f" vertical={false} />
        <XAxis
          dataKey="at"
          type="number"
          scale="time"
          domain={['dataMin', 'dataMax']}
          tickFormatter={dateLabel}
          tick={{ fill: '#7a654a', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          minTickGap={24}
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
          labelFormatter={(ms: number) => dateLabel(ms)}
          formatter={(val: number) => [formatCurrency(val), 'Price']}
        />
        {mark && markOn && <ReferenceLine x={mark.at} stroke={color} strokeOpacity={0.35} strokeDasharray="3 3" />}
        <Area
          type="monotone"
          dataKey="price"
          stroke={color}
          strokeWidth={2}
          fill={`url(#grad-${color.replace('#', '')})`}
          dot={false}
          activeDot={{ r: 4, fill: color }}
          animationDuration={DRAW_MS}
          animationEasing="linear"
        />
        {mark && gotIt && markOn && (
          <ReferenceDot x={mark.at} y={mark.price} r={0} ifOverflow="extendDomain"
            shape={(props: { cx?: number; cy?: number }) => <g className="chart-mark-pop"><title>{gotIt.title}</title><CardMark cx={props.cx} cy={props.cy} color={color} /></g>} />
        )}
      </AreaChart>
    </ResponsiveContainer>
  )
}
