'use client'

import { useState, useMemo } from 'react'
import { RotateCcw, Banknote } from 'lucide-react'
import { useStore } from '@/lib/store'
import { formatCurrency, openEbaySearch } from '@/lib/utils'
import { conditionLabel, GAME_COLORS, GAME_LABELS, type Game, type SoldCard } from '@/lib/types'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { useAuth } from '@/components/auth/AuthProvider'
import { saveSoldCard, deleteSoldCard, saveCard } from '@/lib/firebase/db'
import { cn } from '@/lib/utils'
import { cardImage } from '@/lib/cardImage'
import { CardName } from '@/components/CardName'
import { GamePicker } from '@/components/GamePicker'

const GAMES: Game[] = ['pokemon', 'lorcana', 'riftbound', 'onepiece', 'mtg', 'yugioh', 'swu', 'gundam', 'fab', 'digimon', 'palworld', 'cyberpunk']

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
  const { soldCards, removeSoldCard, addCard, activeGame, setActiveGame, trackedGames } = useStore()
  const { user } = useAuth()
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all')
  const [restoringId, setRestoringId] = useState<string | null>(null)

  // `short` is what fits on a phone — all five stay on one row there.
  const timeFilters: { key: TimeFilter; label: string; short: string }[] = [
    { key: 'today', label: 'Today', short: 'Today' },
    { key: 'week', label: 'This Week', short: 'Week' },
    { key: 'month', label: 'This Month', short: 'Month' },
    { key: 'year', label: 'This Year', short: 'Year' },
    { key: 'all', label: 'All Time', short: 'All' },
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
    const counts = { pokemon: 0, lorcana: 0, riftbound: 0, onepiece: 0, mtg: 0 } as Record<Game, number>
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
      <div>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-ink">Sold</h1>
            <p className="text-slate-400 text-sm mt-0.5">
              {stats.totalCards} cards sold · {formatCurrency(stats.totalRevenue)} revenue
            </p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 wide:gap-3 mb-6">
          <div className="card-glass px-3 py-3 wide:px-4 wide:py-4 min-w-0">
            <div className="text-[0.625rem] text-slate-500 uppercase tracking-wide mb-1 truncate">Amount Sold</div>
            <div className="text-base wide:text-xl font-bold text-ink truncate">{formatCurrency(stats.totalRevenue)}</div>
          </div>
          <div className="card-glass px-3 py-3 wide:px-4 wide:py-4 min-w-0">
            <div className="text-[0.625rem] text-slate-500 uppercase tracking-wide mb-1 truncate">Cards Sold</div>
            <div className="text-base wide:text-xl font-bold text-ink truncate">{stats.totalCards}</div>
          </div>
          <div className="card-glass px-3 py-3 wide:px-4 wide:py-4 min-w-0">
            <div className="text-[0.625rem] text-slate-500 uppercase tracking-wide mb-1 truncate">Total P&L</div>
            <div className={`text-base wide:text-xl font-bold truncate ${stats.totalPnl >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              {stats.totalPnl >= 0 ? '+' : ''}{formatCurrency(stats.totalPnl)}
            </div>
          </div>
        </div>

        {/* Time Filter Pills */}
        <div className="flex gap-1.5 wide:gap-2 mb-5">
          {timeFilters.map(({ key, label, short }) => (
            <button
              key={key}
              onClick={() => setTimeFilter(key)}
              className={cn(
                'flex-1 wide:flex-none px-2 wide:px-3 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap',
                timeFilter === key
                  ? 'bg-violet-600 text-white'
                  : 'bg-slate-800 text-slate-400 hover:text-ink hover:bg-slate-700'
              )}
            >
              <span className="wide:hidden">{short}</span>
              <span className="hidden wide:inline">{label}</span>
            </button>
          ))}
        </div>

        {/* Game Tabs — tracked games, plus any other game you've sold cards from. The shared row
            (components/GamePicker.tsx): one sideways-scrolling line on a phone, upright or sideways,
            like Inventory and the Cardex (it always wrapped into a block, 2026-11-20) */}
        <GamePicker<Game>
          options={GAMES.filter((g) => trackedGames.includes(g) || gameCounts[g] > 0).map((game) => ({
            id: game,
            label: GAME_LABELS[game],
            shortLabel: game === 'mtg' ? 'Magic' : undefined,
            color: GAME_COLORS[game],
            count: gameCounts[game],
          }))}
          active={activeGame}
          onSelect={setActiveGame}
        />

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
            <div className="hidden wide:grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_80px] gap-4 px-5 py-3 border-b border-slate-800 text-xs font-semibold text-slate-500 uppercase tracking-wide">
              <span>Card</span><span>Set</span><span>Condition</span><span>Paid</span><span>Sold For</span><span>P&L</span><span></span>
            </div>

            {visibleSold.map((card) => {
              const pnl = card.soldPrice - card.purchasePrice * card.quantity
              return (
                <div
                  key={card.id}
                  className="relative grid grid-cols-[1fr_auto] wide:grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_80px] items-center wide:items-stretch gap-x-3 gap-y-1 wide:gap-4 px-4 wide:px-5 py-3.5 wide:py-4 border-b border-slate-800/50 last:border-0 cursor-pointer hover:bg-slate-800/20 transition-colors"
                  onClick={(e) => { if (e.ctrlKey || e.metaKey) openEbaySearch(card) }}
                  title="⌘/Ctrl+Click to search eBay sold listings"
                >
                  <div className="flex items-center gap-3 min-w-0 row-span-2 wide:row-span-1">
                    <div className="relative shrink-0">
                      {card.imageUrl ? (
                        <img src={cardImage(card.imageUrl, 'thumb')} alt={card.name} className="w-11 h-[3.75rem] wide:w-10 wide:h-14 object-contain rounded-md" />
                      ) : (
                        <div className="w-11 h-[3.75rem] wide:w-10 wide:h-14 rounded-md bg-slate-800 flex items-center justify-center text-xs text-slate-600">#{card.number}</div>
                      )}
                      {card.quantity > 1 && <span className="wide:hidden absolute -top-1.5 -right-2 min-w-[1.125rem] text-center text-[0.5625rem] font-bold leading-none px-1 py-[0.1875rem] rounded-full bg-violet-700 text-white ring-2 ring-slate-900">×{card.quantity}</span>}
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold text-ink text-[0.9375rem] wide:text-sm truncate"><CardName name={card.name} /></div>
                      <div className="wide:hidden text-xs text-slate-500 truncate">
                        {card.set} · {conditionLabel(card)}
                      </div>
                      <div className="hidden wide:block text-xs text-slate-500">#{card.number}</div>
                      <div className="text-[0.625rem] text-slate-600 mt-0.5">
                        Sold {card.soldDate}<span className="wide:hidden"> · paid {formatCurrency(card.purchasePrice * card.quantity)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="text-sm text-slate-300 hidden wide:flex items-center">{card.set}</div>
                  <div className="text-sm text-slate-300 hidden wide:flex items-center">{conditionLabel(card)}</div>
                  <div className="text-sm text-slate-300 hidden wide:flex items-center">{formatCurrency(card.purchasePrice * card.quantity)}</div>
                  {/* Sold for — on mobile the P&L sits under it, like Inventory's value + P&L */}
                  <div className="flex flex-col justify-end wide:justify-center items-end wide:items-start self-end wide:self-auto">
                    <span className="text-[0.9375rem] wide:text-sm text-ink font-semibold wide:font-medium">{formatCurrency(card.soldPrice)}</span>
                    <span className={`wide:hidden text-xs font-medium ${pnl >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {pnl >= 0 ? '+' : ''}{formatCurrency(pnl)}
                    </span>
                  </div>
                  <div className={`text-sm font-semibold hidden wide:flex items-center ${pnl >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {pnl >= 0 ? '+' : ''}{formatCurrency(pnl)}
                  </div>
                  <div className="col-start-2 row-start-1 wide:col-start-auto wide:row-start-auto self-start wide:self-auto flex items-center justify-end -mr-1.5 wide:mr-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleRestore(card) }}
                      disabled={restoringId === card.id}
                      title="Restore to inventory"
                      className="flex items-center gap-1.5 p-1.5 wide:px-2.5 wide:py-1.5 rounded-lg text-xs text-slate-500 hover:text-violet-600 hover:bg-violet-100/30 transition-colors disabled:opacity-40"
                    >
                      <RotateCcw size={14} />
                      <span className="hidden wide:inline">Restore</span>
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
