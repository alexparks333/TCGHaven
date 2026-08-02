'use client'

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { formatCurrency } from '@/lib/utils'

interface Props {
  data: { name: string; value: number; color: string }[]
}

export function PortfolioPieChart({ data }: Props) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={55}
          outerRadius={80}
          paddingAngle={3}
          dataKey="value"
        >
          {data.map((entry, i) => (
            <Cell key={i} fill={entry.color} stroke="transparent" />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: '0.75rem', fontSize: 12 }}
          formatter={(val: number) => formatCurrency(val)}
        />
        <Legend
          iconType="circle"
          iconSize={8}
          formatter={(val) => <span style={{ color: '#94a3b8', fontSize: 12 }}>{val}</span>}
        />
      </PieChart>
    </ResponsiveContainer>
  )
}
