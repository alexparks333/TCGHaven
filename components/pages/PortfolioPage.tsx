'use client'

import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { RefreshCw, TrendingUp, TrendingDown, ArrowUpRight, Search, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useStore } from '@/lib/store'
import { useAuth } from '@/components/auth/AuthProvider'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { editCard, addPricePoint } from '@/lib/firebase/db'
import { formatCurrency, formatPercent, openEbaySearch } from '@/lib/utils'
import { GAME_COLORS, GAME_LABELS, type Card, type Game } from '@/lib/types'
import { PortfolioPieChart } from '@/components/portfolio/PortfolioPieChart'

type SortKey = 'pnl' | 'pnlAsc' | 'pnlPct' | 'pnlPctAsc' | 'value' | 'valueAsc' | 'name' | 'nameDesc'

const TIME_LABELS: Record<string, string> = { 'entry': 'Since Entry', '1d': '24H', '7d': '7D', '30d': '30D' }
const TIME_DAYS: Record<string, number> = { '1d': 1, '7d': 7, '30d': 30 }

/** Returns the most-recent price recorded at or before `cutoff`, or null if none. */
function priceAtCutoff(
  points: { date: string; price: number }[],
  cutoff: Date,
): number | null {
  const cutoffMs = cutoff.getTime()
  let bestMs = -Infinity
  let bestPrice: number | null = null
  for (const p of points) {
    const ms = new Date(p.date).getTime()
    if (ms <= cutoffMs && ms > bestMs) {
      bestMs = ms
      bestPrice = p.price
    }
  }
  return bestPrice
}

// Per-game batch price endpoints. All three go through Next.js API routes:
// the Pokemon TCG API blocks browser CORS and its key is server-only.
const PRICE_ROUTES: Record<Game, { url: string; payload: (c: Card) => object }> = {
  pokemon:   { url: '/api/prices/pokemon',   payload: (c) => ({ id: c.id, apiId: c.apiId, isFoil: c.isFoil }) },
  lorcana:   { url: '/api/prices/lorcana',   payload: (c) => ({ id: c.id, apiId: c.apiId, isFoil: c.isFoil }) },
  riftbound: { url: '/api/prices/riftbound', payload: (c) => ({ id: c.id, apiId: c.apiId, setCode: c.setCode, isFoil: c.isFoil }) },
}

export default function PortfolioPage() {
  const {
    cards, priceHistory, updateCardPrice, addPriceHistoryPoint,
    setLastPriceRefresh, lastPriceRefresh,
    purchases, calcFloor, activeGames, timeFrame,
    priceMode, setPriceMode,
    hiddenGroups,
  } = useStore()
  const { user, dataLoading } = useAuth()
  const [sort, setSort] = useState<SortKey>('pnl')
  const [cardSearch, setCardSearch] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [includePacks, setIncludePacks] = useState(false)
  const [barWidth, setBarWidth] = useState(0)   // 0–100, drives progress bar

  const totalPackSpend = useMemo(
    () => purchases.reduce((s, p) => s + p.pricePaid * p.quantity, 0),
    [purchases],
  )

  // All cards enriched + sorted (respects activeGames filter)
  const enriched = useMemo(() => {
    const cutoff = timeFrame !== 'entry'
      ? new Date(Date.now() - TIME_DAYS[timeFrame] * 86_400_000)
      : null
    const historyByCard = new Map(priceHistory.map((h) => [h.cardId, h]))

    return cards
      .filter((c) => activeGames.includes(c.game) && (!c.group || !hiddenGroups.includes(c.group)))
      .map((c) => {
        const currentPrice = c.currentPrice ?? c.purchasePrice
        const currentVal = currentPrice * c.quantity
        const cost = c.purchasePrice * c.quantity

        let pnl: number
        let pnlPct: number
        let hasPeriodData: boolean
        let periodStartVal: number  // value at period start (for correct total % denominator)

        if (timeFrame === 'entry') {
          // Baseline = market price when card was first added, or what was paid if unknown
          const baseline = c.priceAtEntry ?? c.purchasePrice
          pnl = (currentPrice - baseline) * c.quantity
          pnlPct = baseline > 0 ? ((currentPrice - baseline) / baseline) * 100 : 0
          periodStartVal = baseline * c.quantity
          hasPeriodData = true
        } else if (cutoff) {
          const history = historyByCard.get(c.id)
          // Only use a price genuinely recorded before the window cutoff — no fallback
          // to the oldest point, which would cause 0% P&L when the only point was just recorded
          const baseline = history ? priceAtCutoff(history.points, cutoff) : null
          if (baseline !== null) {
            pnl = (currentPrice - baseline) * c.quantity
            pnlPct = baseline > 0 ? ((currentPrice - baseline) / baseline) * 100 : 0
            periodStartVal = baseline * c.quantity
            hasPeriodData = true
          } else {
            pnl = 0
            pnlPct = 0
            periodStartVal = cost
            hasPeriodData = false
          }
        } else {
          pnl = currentVal - cost
          pnlPct = cost > 0 ? (pnl / cost) * 100 : 0
          periodStartVal = cost
          hasPeriodData = true
        }

        return { ...c, currentVal, cost, pnl, pnlPct, hasPeriodData, periodStartVal }
      })
      .sort((a, b) => {
        if (sort === 'pnl')        return b.pnl - a.pnl
        if (sort === 'pnlAsc')     return a.pnl - b.pnl
        if (sort === 'pnlPct')     return b.pnlPct - a.pnlPct
        if (sort === 'pnlPctAsc')  return a.pnlPct - b.pnlPct
        if (sort === 'value')      return b.currentVal - a.currentVal
        if (sort === 'valueAsc')   return a.currentVal - b.currentVal
        if (sort === 'nameDesc')   return b.name.localeCompare(a.name)
        return a.name.localeCompare(b.name)
      })
  }, [cards, sort, activeGames, timeFrame, priceHistory, hiddenGroups])

  // Apply calculation floor
  const filtered = useMemo(() => {
    if (!calcFloor) return enriched
    return enriched.filter((c) => (c.currentPrice ?? c.purchasePrice) >= calcFloor)
  }, [enriched, calcFloor])

  const hiddenCount = enriched.length - filtered.length

  const searched = useMemo(() => {
    const q = cardSearch.trim().toLowerCase()
    if (!q) return filtered
    return filtered.filter((c) =>
      c.name.toLowerCase().includes(q) || c.set.toLowerCase().includes(q)
    )
  }, [filtered, cardSearch])

  // Totals: for a time period, only count cards that have period data
  const totals = useMemo(() => {
    const value = filtered.reduce((s, c) => s + c.currentVal, 0)
    const cardCost = filtered.reduce((s, c) => s + c.cost, 0)
    const adjustedCost = cardCost + (includePacks ? totalPackSpend : 0)

    let pnl: number
    let pnlPct: number

    if (timeFrame !== 'entry') {
      // 1D / 7D / 30D — only count cards that have a genuine price from before the window
      const periodCards = filtered.filter((c) => c.hasPeriodData)
      pnl = periodCards.reduce((s, c) => s + c.pnl, 0)
      // Use the period-start value as denominator so % return is relative to where we were
      const periodBase = periodCards.reduce((s, c) => s + c.periodStartVal, 0)
      pnlPct = periodBase > 0 ? (pnl / periodBase) * 100 : 0
    } else {
      pnl = filtered.reduce((s, c) => s + c.pnl, 0)
      // periodStartVal for 'entry' = baseline * qty (priceAtEntry ?? earliest ?? purchasePrice)
      const entryBase = filtered.reduce((s, c) => s + c.periodStartVal, 0)
      pnlPct = entryBase > 0 ? (pnl / entryBase) * 100 : 0
    }

    return { value, cardCost, adjustedCost, pnl, pnlPct }
  }, [filtered, includePacks, totalPackSpend, timeFrame])

  // By-game breakdown — respects floor + activeGames but always shows selected games
  const byGame = useMemo(() => {
    return (['pokemon', 'lorcana', 'riftbound'] as Game[])
      .filter((g) => activeGames.includes(g))
      .map((game) => {
        const gc = cards.filter(
          (c) =>
            c.game === game &&
            (!c.group || !hiddenGroups.includes(c.group)) &&
            (calcFloor === 0 || (c.currentPrice ?? c.purchasePrice) >= calcFloor),
        )
        const value = gc.reduce((s, c) => s + (c.currentPrice ?? c.purchasePrice) * c.quantity, 0)
        return { name: GAME_LABELS[game], value, color: GAME_COLORS[game], count: gc.length, game }
      })
  }, [cards, calcFloor, activeGames, hiddenGroups])

  const refreshPrices = useCallback(async () => {
    if (!user) return
    const uid = user.uid
    setRefreshing(true)
    setRefreshError(null)
    const now = new Date().toISOString()
    const failed: string[] = []

    function savePriceUpdate(cardId: string, price: number) {
      updateCardPrice(cardId, price)
      addPriceHistoryPoint(cardId, price, now)
      editCard(uid, cardId, { currentPrice: price, priceUpdatedAt: now }).catch((err) => {
        const code = (err as { code?: string })?.code
        if (code === 'resource-exhausted') failed.push('Firestore quota exceeded — prices shown but not saved')
      })
      addPricePoint(uid, cardId, price, now).catch(() => {})
    }

    async function refreshGame(game: Game) {
      const gameCards = cards.filter((c) => c.game === game && c.apiId && !c.priceLocked)
      if (gameCards.length === 0) return
      const { url, payload } = PRICE_ROUTES[game]
      const body: Record<string, unknown> = { cards: gameCards.map(payload), priceMode }
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          failed.push(`${game}: price API returned ${res.status}`)
          return
        }
        const prices: Record<string, number> = await res.json()
        Object.entries(prices).forEach(([cardId, price]) => savePriceUpdate(cardId, price))
      } catch {
        failed.push(`${game}: network error fetching prices`)
      }
    }

    await Promise.all((['pokemon', 'lorcana', 'riftbound'] as Game[]).map(refreshGame))
    setLastPriceRefresh(now)
    setRefreshing(false)
    if (failed.length > 0) setRefreshError(failed.join(' · '))
  }, [user, cards, updateCardPrice, addPriceHistoryPoint, setLastPriceRefresh, priceMode])

  // Progress bar animation: ramp to 85% while refreshing, complete to 100% when done
  useEffect(() => {
    if (refreshing) {
      setBarWidth(0)
      const t = setTimeout(() => setBarWidth(82), 30)
      return () => clearTimeout(t)
    } else {
      if (barWidth === 0) return
      setBarWidth(100)
      const t = setTimeout(() => setBarWidth(0), 500)
      return () => clearTimeout(t)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshing])

  // Auto-refresh on page load (at most once every 30 minutes)
  const autoRefreshed = useRef(false)
  useEffect(() => {
    if (!user || dataLoading || autoRefreshed.current || cards.length === 0) return
    autoRefreshed.current = true
    const lastMs = lastPriceRefresh ? new Date(lastPriceRefresh).getTime() : 0
    if (Date.now() - lastMs > 30 * 60 * 1000) refreshPrices()
  }, [user, dataLoading, cards.length, lastPriceRefresh, refreshPrices])

  // Re-fetch when price mode changes; skip mount to avoid double-refresh with auto-refresh above
  const prevPriceMode = useRef(priceMode)
  useEffect(() => {
    if (prevPriceMode.current === priceMode) return
    prevPriceMode.current = priceMode
    if (!user || dataLoading || cards.length === 0 || refreshing) return
    refreshPrices()
  }, [priceMode, user, dataLoading, cards.length, refreshing, refreshPrices])

  const router = useRouter()
  const periodLabel = TIME_LABELS[timeFrame]
  const showHistoryNote = timeFrame !== 'entry'
  const periodCardCount = filtered.filter((c) => c.hasPeriodData).length

  return (
    <AuthGuard>
      <div className="pb-20 md:pb-0">

        {/* Progress bar — fixed at very top of viewport */}
        {barWidth > 0 && (
          <div className="fixed top-0 left-0 right-0 z-[200] h-[3px] bg-slate-800">
            <div
              className="h-full bg-gradient-to-r from-violet-600 to-violet-400 rounded-full"
              style={{
                width: `${barWidth}%`,
                transition: barWidth === 82
                  ? 'width 3.5s cubic-bezier(0.1, 0.8, 0.2, 1)'
                  : 'width 0.25s ease-in',
              }}
            />
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Portfolio</h1>
            <p className="text-slate-500 text-xs mt-0.5">
              {refreshing
                ? 'Refreshing prices…'
                : lastPriceRefresh
                  ? `Updated ${new Date(lastPriceRefresh).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${priceMode === 'lowestNM' ? 'Lowest NM' : '30d avg'}`
                  : 'Prices not yet loaded'
              }
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 text-[11px] bg-slate-800/60 border border-slate-700/50 rounded-lg p-1">
              <span className="text-slate-500 px-1">Price:</span>
              <button
                onClick={() => setPriceMode('market')}
                className={`px-2 py-0.5 rounded-md font-medium transition-all ${
                  priceMode === 'market'
                    ? 'bg-violet-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                30d avg
              </button>
              <button
                onClick={() => setPriceMode('lowestNM')}
                className={`px-2 py-0.5 rounded-md font-medium transition-all ${
                  priceMode === 'lowestNM'
                    ? 'bg-violet-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Lowest NM
              </button>
            </div>
            <button onClick={refreshPrices} disabled={refreshing} className="btn-secondary">
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
              {refreshing ? 'Refreshing…' : 'Refresh Prices'}
            </button>
          </div>
          {refreshError && (
            <div className="flex items-start gap-2 bg-red-950/50 border border-red-800 rounded-xl px-3 py-2 text-xs text-red-300 mt-2">
              <span className="text-red-400 flex-shrink-0">⚠</span>
              <span>{refreshError}</span>
              <button onClick={() => setRefreshError(null)} className="ml-auto text-red-500 hover:text-red-300">✕</button>
            </div>
          )}
        </div>

        {/* Stat tiles */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div
            className="stat-card col-span-2 lg:col-span-1 cursor-pointer hover:ring-1 hover:ring-violet-500/50 transition-all"
            onClick={() => router.push('/portfolio/analytics?metric=value')}
          >
            <span className="text-xs text-slate-500 uppercase tracking-wide font-semibold">Collection Value</span>
            <span className="text-3xl font-bold text-white">{formatCurrency(totals.value)}</span>
            {calcFloor > 0 && <span className="text-[10px] text-slate-600">floor {formatCurrency(calcFloor)}</span>}
          </div>
          <div
            className="stat-card cursor-pointer hover:ring-1 hover:ring-violet-500/50 transition-all"
            onClick={() => router.push('/portfolio/analytics?metric=cost')}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-slate-500 uppercase tracking-wide font-semibold">Total Invested</span>
              {timeFrame === 'entry' && (
                <button
                  onClick={(e) => { e.stopPropagation(); setIncludePacks((v) => !v) }}
                  title={includePacks ? 'Click to remove pack spend' : 'Click to add pack spend to cost basis'}
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full border transition-all ${
                    includePacks
                      ? 'bg-violet-600 border-violet-500 text-white'
                      : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300 hover:border-slate-600'
                  }`}
                >
                  + packs
                </button>
              )}
            </div>
            <span className="text-2xl font-bold text-white">{formatCurrency(totals.adjustedCost)}</span>
            {includePacks && totalPackSpend > 0 && timeFrame === 'entry' && (
              <span className="text-[11px] text-slate-500 mt-0.5">
                cards {formatCurrency(totals.cardCost)} · packs {formatCurrency(totalPackSpend)}
              </span>
            )}
          </div>
          <div
            className="stat-card cursor-pointer hover:ring-1 hover:ring-violet-500/50 transition-all"
            onClick={() => router.push('/portfolio/analytics?metric=pnl')}
          >
            <span className="text-xs text-slate-500 uppercase tracking-wide font-semibold">
              {periodLabel} P&L
            </span>
            <span className={`text-2xl font-bold ${totals.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {formatCurrency(totals.pnl)}
            </span>
            {showHistoryNote
              ? <span className="text-[10px] text-slate-500">{periodCardCount} card{periodCardCount !== 1 ? 's' : ''} w/ history</span>
              : (totals.pnl >= 0 ? <TrendingUp size={14} className="text-emerald-500" /> : <TrendingDown size={14} className="text-red-500" />)
            }
          </div>
          <div
            className="stat-card cursor-pointer hover:ring-1 hover:ring-violet-500/50 transition-all"
            onClick={() => router.push('/portfolio/analytics?metric=return')}
          >
            <span className="text-xs text-slate-500 uppercase tracking-wide font-semibold">
              {periodLabel} Return
            </span>
            <span className={`text-2xl font-bold ${
              showHistoryNote && periodCardCount === 0
                ? 'text-slate-600'
                : totals.pnlPct >= 0 ? 'text-emerald-400' : 'text-red-400'
            }`}>
              {formatPercent(totals.pnlPct)}
            </span>
            {showHistoryNote && (
              <span className="text-[10px] text-slate-500">
                {periodCardCount} card{periodCardCount !== 1 ? 's' : ''} w/ history
              </span>
            )}
          </div>
        </div>

        {/* Per-game value cards */}
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-4">By Game</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {byGame.map(({ game, name, count, value, color }) => (
              <div key={game} className="card-glass p-5 flex items-center justify-between">
                <div>
                  <div
                    className="text-xs font-bold px-2 py-0.5 rounded-full inline-block mb-2"
                    style={{ backgroundColor: color + '22', color }}
                  >
                    {name}
                  </div>
                  <div className="text-xl font-bold text-white">{formatCurrency(value)}</div>
                  <div className="text-xs text-slate-500">{count} cards</div>
                </div>
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center text-xl font-black"
                  style={{ backgroundColor: color + '22', color }}
                >
                  {count}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <div className="card-glass p-6 lg:col-span-1">
            <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-4">By Game</h3>
            {byGame.some((g) => g.value > 0)
              ? <PortfolioPieChart data={byGame.filter((g) => g.value > 0)} />
              : <div className="text-center text-slate-600 py-10 text-sm">No cards yet</div>
            }
          </div>

          <div className="card-glass p-6 lg:col-span-2">
            <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-4">
              Top Performers
              {showHistoryNote && <span className="ml-2 text-[10px] text-violet-400 font-normal normal-case">{periodLabel} change</span>}
              {calcFloor > 0 && <span className="ml-2 text-[10px] text-slate-600 font-normal normal-case">≥ {formatCurrency(calcFloor)}</span>}
            </h3>
            <div className="flex flex-col gap-3">
              {filtered.filter((c) => c.hasPeriodData).slice(0, 5).map((c) => (
                <div key={c.id}
                  onClick={(e) => {
                    if (e.ctrlKey || e.metaKey) { openEbaySearch(c); return }
                    router.push(`/portfolio/${c.id}`)
                  }}
                  title="Click to view card · ⌘/Ctrl+Click to search eBay sold listings"
                  className="flex items-center gap-3 hover:bg-slate-800/40 rounded-xl p-2 -mx-2 transition-colors group cursor-pointer"
                >
                  {c.imageUrl ? (
                    <img src={c.imageUrl} alt={c.name} className="w-8 h-11 object-contain rounded" />
                  ) : (
                    <div className="w-8 h-11 bg-slate-800 rounded flex items-center justify-center text-xs text-slate-600">#{c.number}</div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-white text-sm truncate">{c.name}</div>
                    <div className="text-xs text-slate-500">{GAME_LABELS[c.game]} · {c.set}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-medium text-white">{formatCurrency(c.currentVal)}</div>
                    <div className={`text-xs font-medium ${c.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {c.pnl >= 0 ? '+' : ''}{formatCurrency(c.pnl)}
                    </div>
                  </div>
                  <ArrowUpRight size={14} className="text-slate-600 group-hover:text-slate-400 transition-colors" />
                </div>
              ))}
              {filtered.length === 0 && (
                <div className="text-center text-slate-600 py-8 text-sm">
                  {calcFloor > 0
                    ? `No cards above ${formatCurrency(calcFloor)}. Lower your calculation floor.`
                    : 'Add cards to your inventory to see them here.'}
                </div>
              )}
              {showHistoryNote && filtered.filter((c) => c.hasPeriodData).length === 0 && filtered.length > 0 && (
                <div className="text-center text-slate-600 py-8 text-sm">
                  No price history for this window yet. Hit <span className="text-slate-400">Refresh Prices</span> to start recording history.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* All Cards table */}
        <div className="card-glass overflow-hidden">
          <div className="flex flex-col gap-3 px-5 py-4 border-b border-slate-800">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-white">All Cards</h3>
                {hiddenCount > 0 && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-900/40 text-amber-400 border border-amber-800/40">
                    {hiddenCount} hidden
                  </span>
                )}
                {cardSearch && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-900/40 text-violet-400 border border-violet-800/40">
                    {searched.length} result{searched.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-300 focus:outline-none">
              <optgroup label="P&amp;L $">
                <option value="pnl">Best P&amp;L $</option>
                <option value="pnlAsc">Worst P&amp;L $</option>
              </optgroup>
              <optgroup label="P&amp;L %">
                <option value="pnlPct">Best P&amp;L %</option>
                <option value="pnlPctAsc">Worst P&amp;L %</option>
              </optgroup>
              <optgroup label="Value">
                <option value="value">Highest Value</option>
                <option value="valueAsc">Lowest Value</option>
              </optgroup>
              <optgroup label="Name">
                <option value="name">Name A → Z</option>
                <option value="nameDesc">Name Z → A</option>
              </optgroup>
            </select>
            </div>
            {/* Search box */}
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
              <input
                type="text"
                placeholder="Search by name or set…"
                value={cardSearch}
                onChange={(e) => setCardSearch(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-8 pr-8 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-violet-500 transition-colors"
              />
              {cardSearch && (
                <button onClick={() => setCardSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors">
                  <X size={12} />
                </button>
              )}
            </div>
          </div>

          {showHistoryNote && periodCardCount === 0 && searched.length > 0 && (
            <div className="px-5 py-3 bg-slate-900/60 border-b border-slate-800 text-xs text-slate-500 flex items-center gap-2">
              <span className="text-amber-400">⚠</span>
              No price history yet for the {periodLabel} window — hit <span className="text-slate-300 font-medium">Refresh Prices</span> and check back after {timeFrame === '1d' ? '24 hours' : timeFrame === '7d' ? '7 days' : '30 days'}.
            </div>
          )}
          <div className="hidden md:grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_40px] gap-4 px-5 py-3 border-b border-slate-800 text-xs font-semibold text-slate-500 uppercase tracking-wide">
            <span>Card</span>
            <span>Game</span>
            <span>Cost</span>
            <span>Current</span>
            <span>{periodLabel} P&L</span>
            <span>{periodLabel} %</span>
            <span></span>
          </div>

          {searched.map((card) => (
            <div
              key={card.id}
              onClick={(e) => {
                if (e.ctrlKey || e.metaKey) { openEbaySearch(card); return }
                router.push(`/portfolio/${card.id}`)
              }}
              title="Click to view card · ⌘/Ctrl+Click to search eBay sold listings"
              className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_40px] gap-2 md:gap-4 px-5 py-4 border-b border-slate-800/50 last:border-0 hover:bg-slate-800/20 transition-colors group cursor-pointer"
            >
              <div className="flex items-center gap-3">
                {card.imageUrl
                  ? <img src={card.imageUrl} alt={card.name} className="w-8 h-11 object-contain rounded" />
                  : <div className="w-8 h-11 bg-slate-800 rounded flex items-center justify-center text-xs text-slate-600">{card.number || '?'}</div>
                }
                <div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-semibold text-white text-sm">{card.name}</span>
                    {card.priceLocked && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-700/80 text-slate-400 border border-slate-600/50" title="Manual price — not updated by Refresh Prices">
                        🔒
                      </span>
                    )}
                    {card.group && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-400 border border-violet-500/20">
                        {card.group}
                      </span>
                    )}
                    {card.gradingCompany && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">
                        {card.gradingCompany}{card.grade ? ` ${card.grade}` : ''}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500">{card.set} {card.isFoil && '✨'}</div>
                </div>
              </div>
              <div className="flex items-center">
                <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: GAME_COLORS[card.game] + '22', color: GAME_COLORS[card.game] }}>{GAME_LABELS[card.game]}</span>
              </div>
              <div className="text-sm text-slate-300 flex items-center">{formatCurrency(card.cost)}</div>
              <div className="text-sm text-white font-medium flex items-center">{formatCurrency(card.currentVal)}</div>
              <div className={`text-sm font-medium flex items-center ${
                periodLabel && !card.hasPeriodData
                  ? 'text-slate-600'
                  : card.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'
              }`}>
                {periodLabel && !card.hasPeriodData ? '—' : `${card.pnl >= 0 ? '+' : ''}${formatCurrency(card.pnl)}`}
              </div>
              <div className={`text-sm font-medium flex items-center ${
                periodLabel && !card.hasPeriodData
                  ? 'text-slate-600'
                  : card.pnlPct >= 0 ? 'text-emerald-400' : 'text-red-400'
              }`}>
                {periodLabel && !card.hasPeriodData ? '—' : formatPercent(card.pnlPct)}
              </div>
              <div className="flex items-center justify-end"><ArrowUpRight size={14} className="text-slate-600 group-hover:text-slate-400 transition-colors" /></div>
            </div>
          ))}

          {searched.length === 0 && (
            <div className="text-center text-slate-600 py-16 text-sm">
              {cardSearch
                ? `No cards match "${cardSearch}".`
                : calcFloor > 0
                ? `No cards above ${formatCurrency(calcFloor)}. Lower your calculation floor or turn off the filter.`
                : 'No cards in portfolio. Add cards in the Inventory section.'}
            </div>
          )}
        </div>
      </div>
    </AuthGuard>
  )
}
