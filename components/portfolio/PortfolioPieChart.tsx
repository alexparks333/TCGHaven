'use client'

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { formatCurrency } from '@/lib/utils'

interface Props {
  data: { name: string; value: number; color: string; count?: number }[]
}

/** Portfolio's circle chart: collection value split by game, with each game's value and share
 *  listed beneath. Hover (tap on phones) a slice for its value and card count. The Portfolio's only
 *  by-game view since 2026-11-15 (it replaced the By Game cards) — on phones too. */
export function PortfolioPieChart({ data }: Props) {
  const total = data.reduce((s, d) => s + d.value, 0)
  return (
    <div className="flex flex-col h-full">
      <div className="relative">
        <ResponsiveContainer width="100%" height={200}>
          <PieChart>
            <Pie data={data} cx="50%" cy="50%" innerRadius={58} outerRadius={84} paddingAngle={data.length > 1 ? 3 : 0} dataKey="value">
              {data.map((entry, i) => (
                <Cell key={i} fill={entry.color} stroke="transparent" />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{ background: '#ede1c6', border: '1px solid #d6c49f', color: '#2b2014', borderRadius: '0.75rem', fontSize: 12 }}
              formatter={(val: number, _name, item) => {
                const count = (item?.payload as { count?: number } | undefined)?.count
                return count !== undefined ? `${formatCurrency(val)} · ${count} card${count === 1 ? '' : 's'}` : formatCurrency(val)
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Total</div>
          <div className="text-base font-bold text-ink">{formatCurrency(total)}</div>
        </div>
      </div>
      <div className="flex flex-col gap-1.5 mt-3">
        {data.map((d) => (
          <div key={d.name} className="flex items-center gap-2 text-xs">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
            <span className="text-slate-400 truncate">{d.name}</span>
            <span className="ml-auto font-semibold text-ink">{formatCurrency(d.value)}</span>
            <span className="w-9 text-right text-slate-500">{total > 0 ? Math.round((d.value / total) * 100) : 0}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}
