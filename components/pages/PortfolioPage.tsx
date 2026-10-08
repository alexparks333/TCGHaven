'use client'

import { useState, useMemo } from 'react'
import { TrendingUp, TrendingDown, ArrowUpRight, Search, X, Clock, AlertTriangle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useStore, portfolioGames } from '@/lib/store'
import type { PriceStatus } from '@/lib/api/priceStatus'
import { SPENDING_CATALOG } from '@/lib/spending/catalog'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { formatCurrency, formatPercent, openEbaySearch, cardIdentityKey } from '@/lib/utils'
import { GAME_COLORS, GAME_LABELS, type Game } from '@/lib/types'
import { PortfolioPieChart } from '@/components/portfolio/PortfolioPieChart'

type SortKey = 'pnl' | 'pnlAsc' | 'pnlPct' | 'pnlPctAsc' | 'value' | 'valueAsc' | 'name' | 'nameDesc'

const TIME_LABELS: Record<string, string> = { 'entry': 'Since Entry', '1d': '24H', '7d': '7D', '30d': '30D', '365d': '1Y' }
const TIME_FRAME_OPTIONS: { value: 'entry' | '1d' | '7d' | '30d' | '365d'; label: string }[] = [
  { value: 'entry', label: 'Since Entry' },
  { value: '1d', label: '24 Hours' },
  { value: '7d', label: '1 Week' },
  { value: '30d', label: '1 Month' },
  { value: '365d', label: '1 Year' },
]

// Which shared-history baseline (store.priceBaselines, from /api/price-history) each window uses.
const BASELINE_KEY = { '1d': 'd1', '7d': 'd7', '30d': 'd30', '365d': 'd365' } as const

export default function PortfolioPage() {
  const {
    cards, priceBaselines, priceStatus,
    purchases, soldCards, calcFloor, activeGames: filterGames, trackedGames, timeFrame, setTimeFrame,
    hiddenGroups,
  } = useStore()
  // Only games the user tracks (Inventory's game tabs) count toward anything on this page — see
  // portfolioGames() in lib/store.ts.
  const activeGames = useMemo(() => portfolioGames(filterGames, trackedGames), [filterGames, trackedGames])
  const [sort, setSort] = useState<SortKey>('pnl')
  const [cardSearch, setCardSearch] = useState('')
  const [includePacks, setIncludePacks] = useState(false)
  const [includeSold, setIncludeSold] = useState(false)

  // A purchase whose product isn't in SPENDING_CATALOG anymore can't be attributed to a game, so
  // it's kept rather than silently dropped from the cost basis.
  const totalPackSpend = useMemo(() => {
    const gameByProduct = new Map(SPENDING_CATALOG.map((p) => [p.id, p.game]))
    return purchases
      .filter((p) => { const g = gameByProduct.get(p.productId); return !g || activeGames.includes(g) })
      .reduce((s, p) => s + p.pricePaid * p.quantity, 0)
  }, [purchases, activeGames])

  const totalSoldRevenue = useMemo(
    () => soldCards.filter((c) => activeGames.includes(c.game)).reduce((s, c) => s + c.soldPrice, 0),
    [soldCards, activeGames],
  )

  // All cards enriched + sorted (respects activeGames filter)
  const enriched = useMemo(() => {
    const baselineKey = timeFrame !== 'entry' ? BASELINE_KEY[timeFrame] : null

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
        } else if (baselineKey) {
          // The card's shared-history price at the start of the window. No fallback to a later
          // point (that would fake a 0% change): no price that far back → no data for this window.
          const baseline = priceBaselines[c.id]?.[baselineKey] ?? null
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

        return { ...c, currentPrice, currentVal, cost, pnl, pnlPct, hasPeriodData, periodStartVal }
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
  }, [cards, sort, activeGames, timeFrame, priceBaselines, hiddenGroups])

  // Apply calculation floor
  const filtered = useMemo(() => {
    if (!calcFloor) return enriched
    return enriched.filter((c) => (c.currentPrice ?? c.purchasePrice) >= calcFloor)
  }, [enriched, calcFloor])

  const hiddenCount = enriched.length - filtered.length

  // Same card added in separate sessions (different Firestore documents/"lots", e.g. different
  // purchase dates or prices) is combined into one displayed row here — each underlying lot is
  // left untouched, this only affects what's shown. Mirrors InventoryPage's grouping so the two
  // pages agree on what counts as "the same card." Totals above still operate on individual
  // lots, so their numbers are unaffected — grouping only changes row display. Grouped from
  // `filtered` (not the search-filtered list) so Top Performers — which reads this directly,
  // unlike the All Cards table below — isn't affected by whatever the user typed into the All
  // Cards search box.
  const groupedRows = useMemo(() => {
    const groups = new Map<string, typeof filtered>()
    for (const card of filtered) {
      const key = cardIdentityKey(card)
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(card)
    }
    const merged = Array.from(groups.values()).map((lots) => {
      // latest lot (by date added) is the representative for display fields (image, badges, etc.)
      const rep = [...lots].sort((a, b) =>
        (b.createdAt ?? b.purchaseDate ?? '').localeCompare(a.createdAt ?? a.purchaseDate ?? '')
      )[0]
      const quantity = lots.reduce((s, c) => s + c.quantity, 0)
      const cost = lots.reduce((s, c) => s + c.cost, 0)
      const currentVal = lots.reduce((s, c) => s + c.currentVal, 0)
      const pnl = lots.reduce((s, c) => s + c.pnl, 0)
      const periodStartVal = lots.reduce((s, c) => s + c.periodStartVal, 0)
      const hasPeriodData = lots.some((c) => c.hasPeriodData)
      const pnlPct = periodStartVal > 0 ? (pnl / periodStartVal) * 100 : 0
      const currentPrice = quantity > 0 ? currentVal / quantity : rep.currentPrice
      return { ...rep, quantity, cost, currentVal, pnl, pnlPct, hasPeriodData, periodStartVal, currentPrice }
    })
    return merged.sort((a, b) => {
      if (sort === 'pnl')        return b.pnl - a.pnl
      if (sort === 'pnlAsc')     return a.pnl - b.pnl
      if (sort === 'pnlPct')     return b.pnlPct - a.pnlPct
      if (sort === 'pnlPctAsc')  return a.pnlPct - b.pnlPct
      if (sort === 'value')      return b.currentVal - a.currentVal
      if (sort === 'valueAsc')   return a.currentVal - b.currentVal
      if (sort === 'nameDesc')   return b.name.localeCompare(a.name)
      return a.name.localeCompare(b.name)
    })
  }, [filtered, sort])

  const displayRows = useMemo(() => {
    const q = cardSearch.trim().toLowerCase()
    if (!q) return groupedRows
    return groupedRows.filter((c) =>
      c.name.toLowerCase().includes(q) || c.set.toLowerCase().includes(q)
    )
  }, [groupedRows, cardSearch])

  // Totals: for a time period, only count cards that have period data
  const totals = useMemo(() => {
    const value = filtered.reduce((s, c) => s + c.currentVal, 0)
    const cardCost = filtered.reduce((s, c) => s + c.cost, 0)
    const adjustedCost = cardCost + (includePacks ? totalPackSpend : 0) - (includeSold ? totalSoldRevenue : 0)

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
  }, [filtered, includePacks, totalPackSpend, includeSold, totalSoldRevenue, timeFrame])

  // By-game breakdown — respects floor + activeGames but always shows selected games
  const byGame = useMemo(() => {
    return (['pokemon', 'lorcana', 'riftbound', 'onepiece', 'mtg'] as Game[])
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

  const router = useRouter()
  const periodLabel = TIME_LABELS[timeFrame]
  const showHistoryNote = timeFrame !== 'entry'
  const periodCardCount = filtered.filter((c) => c.hasPeriodData).length

  return (
    <AuthGuard>
      <div>

        {/* Header — stacks on phones so the update status doesn't crush the title */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-ink">Portfolio</h1>
            <p className="text-slate-500 text-xs mt-0.5">
              TCGplayer market prices · updated automatically 4× a day
            </p>
          </div>
          <div className="flex items-center gap-2">
            <PriceUpdateStatus status={priceStatus} />
          </div>
        </div>

        {/* Stat tiles */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-8">
          <div
            className="stat-card cursor-pointer hover:ring-1 hover:ring-violet-500/50 transition-all"
            onClick={() => router.push('/portfolio/analytics?metric=value')}
          >
            <span className="text-xs text-slate-500 uppercase tracking-wide font-semibold">Collection Value</span>
            <span className="text-2xl md:text-3xl font-bold text-ink">{formatCurrency(totals.value)}</span>
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
              {timeFrame === 'entry' && (
                <button
                  onClick={(e) => { e.stopPropagation(); setIncludeSold((v) => !v) }}
                  title={includeSold ? 'Click to remove sold proceeds' : 'Click to subtract sold proceeds from cost basis'}
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full border transition-all ${
                    includeSold
                      ? 'bg-emerald-600 border-emerald-500 text-white'
                      : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300 hover:border-slate-600'
                  }`}
                >
                  - sold
                </button>
              )}
            </div>
            <span className="text-xl md:text-2xl font-bold text-ink">{formatCurrency(totals.adjustedCost)}</span>
            {(includePacks && totalPackSpend > 0 || includeSold && totalSoldRevenue > 0) && timeFrame === 'entry' && (
              <span className="text-[11px] text-slate-500 mt-0.5">
                cards {formatCurrency(totals.cardCost)}
                {includePacks && totalPackSpend > 0 && <> · packs {formatCurrency(totalPackSpend)}</>}
                {includeSold && totalSoldRevenue > 0 && <> · sold -{formatCurrency(totalSoldRevenue)}</>}
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
            <span className={`text-xl md:text-2xl font-bold ${totals.pnl >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
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
            <span className={`text-xl md:text-2xl font-bold ${
              showHistoryNote && periodCardCount === 0
                ? 'text-slate-600'
                : totals.pnlPct >= 0 ? 'text-emerald-600' : 'text-red-600'
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
                  <div className="text-xl font-bold text-ink">{formatCurrency(value)}</div>
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

        {/* Time frame — drives Top Performers' per-card P&L below; Collection Value above is
            never affected, since that's just current market value with no time dimension. */}
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <span className="text-xs text-slate-500 uppercase tracking-wide font-semibold mr-1">Time Frame</span>
          {TIME_FRAME_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setTimeFrame(value)}
              className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-all ${
                timeFrame === value
                  ? 'bg-violet-600/20 border-violet-500/40 text-violet-700'
                  : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-600'
              }`}
            >
              {label}
            </button>
          ))}
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
              {showHistoryNote && <span className="ml-2 text-[10px] text-violet-600 font-normal normal-case">{periodLabel} change</span>}
              {calcFloor > 0 && <span className="ml-2 text-[10px] text-slate-600 font-normal normal-case">≥ {formatCurrency(calcFloor)}</span>}
            </h3>
            <div className="flex flex-col gap-3">
              {groupedRows.filter((c) => c.hasPeriodData).slice(0, 5).map((c) => (
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
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-ink text-sm truncate">{c.name}</span>
                      {c.quantity > 1 && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-700/80 text-slate-300 border border-slate-600/50 shrink-0">
                          ×{c.quantity}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 truncate">
                      {GAME_LABELS[c.game]} · {c.set} · {formatCurrency(c.currentPrice)} ea
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-medium text-ink">{formatCurrency(c.currentVal)}</div>
                    <div className={`text-xs font-medium ${c.pnl >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {c.pnl >= 0 ? '+' : ''}{formatCurrency(c.pnl)}
                    </div>
                  </div>
                  <ArrowUpRight size={14} className="text-slate-600 group-hover:text-slate-400 transition-colors" />
                </div>
              ))}
              {groupedRows.length === 0 && (
                <div className="text-center text-slate-600 py-8 text-sm">
                  {calcFloor > 0
                    ? `No cards above ${formatCurrency(calcFloor)}. Lower your calculation floor.`
                    : 'Add cards to your inventory to see them here.'}
                </div>
              )}
              {showHistoryNote && groupedRows.filter((c) => c.hasPeriodData).length === 0 && groupedRows.length > 0 && (
                <div className="text-center text-slate-600 py-8 text-sm">
                  No price history for this window yet — it builds up as prices update automatically each day.
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
                <h3 className="text-sm font-semibold text-ink">All Cards</h3>
                {hiddenCount > 0 && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-200/40 text-amber-600 border border-amber-300/40">
                    {hiddenCount} hidden
                  </span>
                )}
                {cardSearch && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-200/40 text-violet-600 border border-violet-300/40">
                    {displayRows.length} result{displayRows.length !== 1 ? 's' : ''}
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
                className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-8 pr-8 py-1.5 text-xs text-ink placeholder-slate-600 focus:outline-none focus:border-violet-500 transition-colors"
              />
              {cardSearch && (
                <button onClick={() => setCardSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-ink transition-colors">
                  <X size={12} />
                </button>
              )}
            </div>
          </div>

          {showHistoryNote && periodCardCount === 0 && displayRows.length > 0 && (
            <div className="px-5 py-3 bg-slate-900/60 border-b border-slate-800 text-xs text-slate-500 flex items-center gap-2">
              <span className="text-amber-600">⚠</span>
              No price history yet for the {periodLabel} window — prices update automatically, so check back after {timeFrame === '1d' ? '24 hours' : timeFrame === '7d' ? '7 days' : timeFrame === '30d' ? '30 days' : 'a year'}.
            </div>
          )}
          <div className="hidden md:grid grid-cols-[2fr_1fr_1fr_1fr_40px] gap-4 px-5 py-3 border-b border-slate-800 text-xs font-semibold text-slate-500 uppercase tracking-wide">
            <span>Card</span>
            <span>Game</span>
            <span>Cost</span>
            <span>Value · {periodLabel} P&L</span>
            <span></span>
          </div>

          {displayRows.map((card) => (
            <div
              key={card.id}
              onClick={(e) => {
                if (e.ctrlKey || e.metaKey) { openEbaySearch(card); return }
                router.push(`/portfolio/${card.id}`)
              }}
              title="Click to view card · ⌘/Ctrl+Click to search eBay sold listings"
              className="grid grid-cols-[1fr_auto] items-center md:grid-cols-[2fr_1fr_1fr_1fr_40px] gap-3 md:gap-4 px-4 md:px-5 py-3 md:py-4 border-b border-slate-800/50 last:border-0 hover:bg-slate-800/20 transition-colors group cursor-pointer"
            >
              <div className="flex items-center gap-3">
                {/* On phones the ×N badge sits on the thumbnail's corner, so a long name can't push it
                    onto its own line; on the web it stays next to the name. */}
                <div className="relative shrink-0">
                  {card.imageUrl
                    ? <img src={card.imageUrl} alt={card.name} className="w-8 h-11 object-contain rounded" />
                    : <div className="w-8 h-11 bg-slate-800 rounded flex items-center justify-center text-xs text-slate-600">{card.number || '?'}</div>
                  }
                  {card.quantity > 1 && <span className="md:hidden absolute -top-1.5 -right-2 min-w-[18px] text-center text-[9px] font-bold leading-none px-1 py-[3px] rounded-full bg-violet-700 text-white ring-2 ring-slate-900">×{card.quantity}</span>}
                </div>
                <div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-semibold text-ink text-sm">{card.name}</span>
                    {card.quantity > 1 && (
                      <span className="hidden md:inline text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-700/80 text-slate-300 border border-slate-600/50">
                        ×{card.quantity}
                      </span>
                    )}
                    {card.priceLocked && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-700/80 text-slate-400 border border-slate-600/50" title="Manual price — not changed by the automatic price updates">
                        🔒
                      </span>
                    )}
                    {card.group && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-600 border border-violet-500/20">
                        {card.group}
                      </span>
                    )}
                    {card.gradingCompany && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-600 border border-amber-500/30">
                        {card.gradingCompany}{card.grade ? ` ${card.grade}` : ''}
                      </span>
                    )}
                    {card.nexus && (
                      <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-600 border border-blue-500/30">
                        Nexus
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500">
                    {card.set} {card.isFoil && '✨'}
                    {' · '}{formatCurrency(card.currentPrice)} ea
                  </div>
                </div>
              </div>
              <div className="hidden md:flex items-center">
                <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: GAME_COLORS[card.game] + '22', color: GAME_COLORS[card.game] }}>{GAME_LABELS[card.game]}</span>
              </div>
              <div className="hidden md:flex text-sm text-slate-300 items-center">{formatCurrency(card.cost)}</div>
              {/* Value with the $ gained/lost over the selected window underneath — the same price
                  block Inventory uses, on phones and the web alike. On phones the columns either side
                  are hidden, leaving just the card and this. */}
              <div className="text-right md:text-left md:flex md:flex-col md:justify-center">
                <div className="text-sm text-ink font-semibold">{formatCurrency(card.currentVal)}</div>
                <div className={`text-xs font-medium ${
                  periodLabel && !card.hasPeriodData ? 'text-slate-600' : card.pnl >= 0 ? 'text-emerald-600' : 'text-red-600'
                }`}>
                  {periodLabel && !card.hasPeriodData ? '—' : `${card.pnl >= 0 ? '+' : ''}${formatCurrency(card.pnl)}`}
                </div>
              </div>
              <div className="hidden md:flex items-center justify-end"><ArrowUpRight size={14} className="text-slate-600 group-hover:text-slate-400 transition-colors" /></div>
            </div>
          ))}

          {displayRows.length === 0 && (
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

// Replaces the old manual "Refresh Prices" button: everyone's prices come from the same
// scheduled catalog sync (4x a day — see components/PriceAutoUpdater.tsx), so this just says when
// that last happened, and turns into a warning if the latest scheduled update didn't go through
// (failed, or overdue) so a broken sync can't go unnoticed. See lib/api/priceStatus.ts.
function PriceUpdateStatus({ status }: { status: PriceStatus | null }) {
  const when = status?.updatedAt ? formatUpdatedAt(status.updatedAt) : null
  if (status?.failed) {
    return (
      <div
        className="flex items-center gap-1.5 text-[11px] font-semibold text-red-700 bg-red-100/60 border border-red-300 rounded-lg px-2.5 py-1.5"
        title={`Latest scheduled price update didn't go through for: ${status.failedGames.join(', ')}`}
      >
        <AlertTriangle size={13} className="shrink-0" />
        <span>Price update failed{when ? ` — showing prices from ${when}` : ''}</span>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-slate-400 bg-slate-800/60 border border-slate-700/50 rounded-lg px-2.5 py-1.5">
      <Clock size={13} className="shrink-0" />
      <span>{status === null ? 'Checking prices…' : when ? `Prices updated ${when}` : 'Prices not synced yet'}</span>
    </div>
  )
}

function formatUpdatedAt(d: Date): string {
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const today = new Date()
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return `today ${time}`
  if (d.toDateString() === yesterday.toDateString()) return `yesterday ${time}`
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`
}
