'use client'

import { useState, useMemo } from 'react'
import { RotateCcw, Banknote } from 'lucide-react'
import { useStore } from '@/lib/store'
import { formatCurrency } from '@/lib/utils'
import { CONDITION_LABELS, GAME_COLORS, GAME_LABELS, type Game, type SoldCard } from '@/lib/types'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { useAuth } from '@/components/auth/AuthProvider'
import { saveSoldCard, deleteSoldCard, saveCard } from '@/lib/firebase/db'
import { cn } from '@/lib/utils'

const GAMES: Game[] = ['pokemon', 'lorcana', 'riftbound']

type TimeFilter = 'today' | 'week' | 'month' | 'year' | 'all'

function startOf(filter: TimeFilter): Date | null {
  const now = new Date()
  if (filter === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (filter === 'week') {
    const d = new Date(now)
    d.setDate(d.getDate() - d.getDay())
    d.setHours(0, 0, 0, 0)
    return d
  }
  if (filter === 'month') return new Date(now.getFullYear(), now.getMonth(), 1)
  if (filter === 'year') return new Date(now.getFullYear(), 0, 1)
  return null
}

export default function SoldPage() {
  const { soldCards, removeSoldCard, addCard, activeGame, setActiveGame } = useStore()
  const { user } = useAuth()
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all')
  const [restoringId, setRestoringId] = useState<string | null>(null)

  const timeFilters: { key: TimeFilter; label: string }[] = [
    { key: 'today', label: 'Today' },
    { key: 'week', label: 'This Week' },
    { key: 'month', label: 'This Month' },
    { key: 'year', label: 'This Year' },
    { key: 'all', label: 'All Time' },
  ]

  const visibleSold = useMemo(() => {
    const cutoff = startOf(timeFilter)
    return soldCards
      .filter((c) => {
        if (c.game !== activeGame) return false
        if (!cutoff) return true
        return new Date(c.soldDate) >= cutoff
      })
      .sort((a, b) => b.soldAt.localeCompare(a.soldAt))
  }, [soldCards, activeGame, timeFilter])

  const stats = useMemo(() => {
    const cutoff = startOf(timeFilter)
    const inWindow = soldCards.filter((c) => {
      if (!cutoff) return true
      return new Date(c.soldDate) >= cutoff
    })
    return {
      totalRevenue: inWindow.reduce((s, c) => s + c.soldPrice, 0),
      totalCards: inWindow.reduce((s, c) => s + c.quantity, 0),
      totalPnl: inWindow.reduce((s, c) => s + (c.soldPrice - c.purchasePrice * c.quantity), 0),
    }
  }, [soldCards, timeFilter])

  const gameCounts = useMemo(() => {
    const counts = { pokemon: 0, lorcana: 0, riftbound: 0 } as Record<Game, number>
    for (const c of soldCards) counts[c.game] = (counts[c.game] || 0) + 1
    return counts
  }, [soldCards])

  async function handleRestore(soldCard: SoldCard) {
    if (!user) return
    setRestoringId(soldCard.id)
    try {
      const { soldDate: _sd, soldPrice: _sp, soldAt: _sa, ...cardData } = soldCard
      // Optimistic
      addCard(cardData)
      removeSoldCard(soldCard.id)
      // Firestore
      await saveCard(user.uid, soldCard.id, cardData)
      await deleteSoldCard(user.uid, soldCard.id)
    } catch (err) {
      console.error('Failed to restore card:', err)
    } finally {
      setRestoringId(null)
    }
  }

  return (
    <AuthGuard>
      <div className="pb-20 md:pb-0">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Sold</h1>
            <p className="text-slate-400 text-sm mt-0.5">
              {stats.totalCards} cards sold · {formatCurrency(stats.totalRevenue)} revenue
            </p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="card-glass px-4 py-4">
            <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Amount Sold</div>
            <div className="text-xl font-bold text-white">{formatCurrency(stats.totalRevenue)}</div>
          </div>
          <div className="card-glass px-4 py-4">
            <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Cards Sold</div>
            <div className="text-xl font-bold text-white">{stats.totalCards}</div>
          </div>
          <div className="card-glass px-4 py-4">
            <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Total P&L</div>
            <div className={`text-xl font-bold ${stats.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {stats.totalPnl >= 0 ? '+' : ''}{formatCurrency(stats.totalPnl)}
            </div>
          </div>
        </div>

        {/* Time Filter Pills */}
        <div className="flex gap-2 mb-5 flex-wrap">
          {timeFilters.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTimeFilter(key)}
              className={cn(
                'px-3 py-1.5 rounded-full text-xs font-medium transition-all',
                timeFilter === key
                  ? 'bg-violet-600 text-white'
                  : 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700'
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Game Tabs */}
        <div className="flex gap-2 mb-6">
          {GAMES.map((game) => {
            const count = gameCounts[game]
            return (
              <button
                key={game}
                onClick={() => setActiveGame(game)}
                className={cn(
                  'px-4 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-2',
                  activeGame === game
                    ? 'text-white shadow-lg'
                    : 'bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800'
                )}
                style={
                  activeGame === game
                    ? { backgroundColor: GAME_COLORS[game] + '33', color: GAME_COLORS[game], borderColor: GAME_COLORS[game] + '55', border: '1px solid' }
                    : {}
                }
              >
                {GAME_LABELS[game]}
                <span className="text-xs opacity-60">{count}</span>
              </button>
            )
          })}
        </div>

        {/* Sold Card List */}
        {visibleSold.length === 0 ? (
          <div className="card-glass flex flex-col items-center justify-center py-20 text-center">
            <Banknote size={40} className="text-slate-700 mb-3" />
            <div className="text-slate-400 font-medium">No sold cards</div>
            <div className="text-slate-600 text-sm mt-1">
              Cards you sell from Inventory will appear here.
            </div>
          </div>
        ) : (
          <div className="card-glass">
            <div className="hidden md:grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_80px] gap-4 px-5 py-3 border-b border-slate-800 text-xs font-semibold text-slate-500 uppercase tracking-wide">
              <span>Card</span><span>Set</span><span>Condition</span><span>Paid</span><span>Sold For</span><span>P&L</span><span></span>
            </div>

            {visibleSold.map((card) => {
              const pnl = card.soldPrice - card.purchasePrice * card.quantity
              return (
                <div
                  key={card.id}
                  className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_80px] gap-2 md:gap-4 px-5 py-4 border-b border-slate-800/50 last:border-0"
                >
                  <div className="flex items-center gap-3">
                    {card.imageUrl ? (
                      <img src={card.imageUrl} alt={card.name} className="w-10 h-14 object-contain rounded-md" />
                    ) : (
                      <div className="w-10 h-14 rounded-md bg-slate-800 flex items-center justify-center text-xs text-slate-600">#{card.number}</div>
                    )}
                    <div>
                      <div className="font-semibold text-white text-sm">{card.name}</div>
                      <div className="text-xs text-slate-500">#{card.number} {card.isFoil && '✨ Foil'}</div>
                      <div className="text-[10px] text-slate-600 mt-0.5">Sold {card.soldDate}</div>
                    </div>
                  </div>
                  <div className="text-sm text-slate-300 flex items-center">{card.set}</div>
                  <div className="text-sm text-slate-300 flex items-center">{CONDITION_LABELS[card.condition]}</div>
                  <div className="text-sm text-slate-300 flex items-center">{formatCurrency(card.purchasePrice * card.quantity)}</div>
                  <div className="text-sm text-white font-medium flex items-center">{formatCurrency(card.soldPrice)}</div>
                  <div className={`text-sm font-semibold flex items-center ${pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {pnl >= 0 ? '+' : ''}{formatCurrency(pnl)}
                  </div>
                  <div className="flex items-center justify-end">
                    <button
                      onClick={() => handleRestore(card)}
                      disabled={restoringId === card.id}
                      title="Restore to inventory"
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-slate-500 hover:text-violet-400 hover:bg-violet-950/30 transition-colors disabled:opacity-40"
                    >
                      <RotateCcw size={13} />
                      Restore
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </AuthGuard>
  )
}
