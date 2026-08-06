'use client'

import { useMemo, useState } from 'react'
import Image from 'next/image'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, TrendingUp, TrendingDown } from 'lucide-react'
import { useStore } from '@/lib/store'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { formatCurrency, formatPercent, formatDate } from '@/lib/utils'
import { CONDITION_LABELS, GAME_LABELS, GAME_COLORS } from '@/lib/types'
import { PriceHistoryChart } from '@/components/portfolio/PriceHistoryChart'

type Range = '30d' | '90d' | '1y' | 'all'

export default function CardDetailPage() {
  const { cardId } = useParams<{ cardId: string }>()
  const router = useRouter()
  const { cards, priceHistory } = useStore()
  const [range, setRange] = useState<Range>('all')

  const card = cards.find((c) => c.id === cardId)
  const history = priceHistory.find((h) => h.cardId === cardId)

  const chartData = useMemo(() => {
    if (!card) return []
    const now = new Date()
    const cutoff = new Date(
      range === '30d' ? now.getTime() - 30 * 86400000
        : range === '90d' ? now.getTime() - 90 * 86400000
        : range === '1y' ? now.getTime() - 365 * 86400000
        : 0
    )
    const points = history?.points.filter((p) => new Date(p.date) >= cutoff) ?? []
    if (points.length === 0) {
      return [
        { date: card.purchaseDate, price: card.purchasePrice },
        { date: new Date().toISOString().slice(0, 10), price: card.currentPrice ?? card.purchasePrice },
      ]
    }
    return points
  }, [history, range, card])

  if (!card) {
    return (
      <AuthGuard>
        <div className="text-center py-20">
          <div className="text-slate-400">Card not found.</div>
          <button onClick={() => router.back()} className="btn-secondary mt-4">
            <ArrowLeft size={14} /> Back
          </button>
        </div>
      </AuthGuard>
    )
  }

  const currentVal = (card.currentPrice ?? card.purchasePrice) * card.quantity
  const cost = card.purchasePrice * card.quantity
  const pnl = currentVal - cost
  const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0

  return (
    <AuthGuard>
      <div className="pb-20 md:pb-0">
        <button onClick={() => router.back()} className="flex items-center gap-1.5 text-slate-400 hover:text-white text-sm mb-6 transition-colors">
          <ArrowLeft size={14} /> Back to Portfolio
        </button>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <div className="card-glass p-6 flex gap-5">
            {card.imageUrl ? (
              <Image src={card.imageUrl} alt={card.name} width={112} height={160} className="w-28 h-40 object-contain rounded-xl" />
            ) : (
              <div className="w-28 h-40 bg-slate-800 rounded-xl flex items-center justify-center text-2xl text-slate-600">🃏</div>
            )}
            <div className="flex flex-col gap-2">
              <span className="text-xs font-bold px-2 py-0.5 rounded-full w-fit" style={{ backgroundColor: GAME_COLORS[card.game] + '22', color: GAME_COLORS[card.game] }}>
                {GAME_LABELS[card.game]}
              </span>
              <h1 className="text-xl font-bold text-white">{card.name}</h1>
              <div className="text-sm text-slate-400">{card.set}</div>
              <div className="text-xs text-slate-500">#{card.number} {card.isFoil && '✨ Foil'}</div>
              <div className="text-xs text-slate-500">{CONDITION_LABELS[card.condition]}</div>
              <div className="text-xs text-slate-500">Qty: {card.quantity}</div>
              <div className="text-xs text-slate-500">Bought: {formatDate(card.purchaseDate)}</div>
            </div>
          </div>

          <div className="lg:col-span-2 grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="stat-card">
              <span className="text-xs text-slate-500 uppercase tracking-wide font-semibold">Current Value</span>
              <span className="text-2xl font-bold text-white">{formatCurrency(currentVal)}</span>
              <span className="text-xs text-slate-500">{formatCurrency(card.currentPrice ?? card.purchasePrice)} each</span>
            </div>
            <div className="stat-card">
              <span className="text-xs text-slate-500 uppercase tracking-wide font-semibold">Paid</span>
              <span className="text-2xl font-bold text-white">{formatCurrency(cost)}</span>
              <span className="text-xs text-slate-500">{formatCurrency(card.purchasePrice)} each</span>
            </div>
            <div className="stat-card">
              <span className="text-xs text-slate-500 uppercase tracking-wide font-semibold">P&amp;L</span>
              <span className={`text-2xl font-bold ${pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {pnl >= 0 ? '+' : ''}{formatCurrency(pnl)}
              </span>
              {pnl >= 0 ? <TrendingUp size={14} className="text-emerald-500" /> : <TrendingDown size={14} className="text-red-500" />}
            </div>
            <div className="stat-card">
              <span className="text-xs text-slate-500 uppercase tracking-wide font-semibold">Return</span>
              <span className={`text-2xl font-bold ${pnlPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {formatPercent(pnlPct)}
              </span>
            </div>
          </div>
        </div>

        <div className="card-glass p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-sm font-semibold text-white">Price History</h2>
            <div className="flex gap-1.5">
              {(['30d', '90d', '1y', 'all'] as Range[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${range === r ? 'bg-violet-600 text-white' : 'bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800'}`}
                >
                  {r === 'all' ? 'All' : r.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <PriceHistoryChart data={chartData} color={GAME_COLORS[card.game]} />
          <div className="text-center text-xs text-slate-600 mt-3">
            {chartData.length <= 2 ? 'Price history builds as you refresh prices over time.' : `${chartData.length} data points`}
          </div>
        </div>
      </div>
    </AuthGuard>
  )
}
