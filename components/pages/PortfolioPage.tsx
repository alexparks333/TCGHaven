'use client'

import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { RefreshCw, TrendingUp, TrendingDown, ArrowUpRight, Search, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useStore } from '@/lib/store'
import { useAuth } from '@/components/auth/AuthProvider'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { applyPriceUpdatesBatch } from '@/lib/firebase/db'
import { formatCurrency, formatPercent, openEbaySearch, cardIdentityKey } from '@/lib/utils'
import { GAME_COLORS, GAME_LABELS, type Card, type Game, type PriceHistory } from '@/lib/types'
import { PortfolioPieChart } from '@/components/portfolio/PortfolioPieChart'

type SortKey = 'pnl' | 'pnlAsc' | 'pnlPct' | 'pnlPctAsc' | 'value' | 'valueAsc' | 'name' | 'nameDesc'

const TIME_LABELS: Record<string, string> = { 'entry': 'Since Entry', '1d': '24H', '7d': '7D', '30d': '30D', '365d': '1Y' }
const TIME_DAYS: Record<string, number> = { '1d': 1, '7d': 7, '30d': 30, '365d': 365 }
const TIME_FRAME_OPTIONS: { value: 'entry' | '1d' | '7d' | '30d' | '365d'; label: string }[] = [
  { value: 'entry', label: 'Since Entry' },
  { value: '1d', label: '24 Hours' },
  { value: '7d', label: '1 Week' },
  { value: '30d', label: '1 Month' },
  { value: '365d', label: '1 Year' },
]

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

type TimeFrame = 'entry' | '1d' | '7d' | '30d' | '365d'

/**
 * Pure re-implementation of the enriched → filtered → totals pipeline below, used only to
 * snapshot pnl/pnlPct/value before and after a price refresh (so the delta between the two
 * calls is the "since last refresh" change) without waiting on a React re-render to see the
 * store's post-refresh state.
 */
function computeTotals(
  cardsList: Card[],
  priceHistoryList: PriceHistory[],
  timeFrame: TimeFrame,
  activeGames: Game[],
  hiddenGroups: string[],
  calcFloor: number,
): { value: number; pnl: number; pnlPct: number } {
  const cutoff = timeFrame !== 'entry'
    ? new Date(Date.now() - TIME_DAYS[timeFrame] * 86_400_000)
    : null
  const historyByCard = new Map(priceHistoryList.map((h) => [h.cardId, h]))

  const enriched = cardsList
    .filter((c) => activeGames.includes(c.game) && (!c.group || !hiddenGroups.includes(c.group)))
    .map((c) => {
      const currentPrice = c.currentPrice ?? c.purchasePrice
      const currentVal = currentPrice * c.quantity
      const cost = c.purchasePrice * c.quantity
      let pnl: number
      let periodStartVal: number
      let hasPeriodData: boolean

      if (timeFrame === 'entry') {
        const baseline = c.priceAtEntry ?? c.purchasePrice
        pnl = (currentPrice - baseline) * c.quantity
        periodStartVal = baseline * c.quantity
        hasPeriodData = true
      } else if (cutoff) {
        const history = historyByCard.get(c.id)
        const baseline = history ? priceAtCutoff(history.points, cutoff) : null
        if (baseline !== null) {
          pnl = (currentPrice - baseline) * c.quantity
          periodStartVal = baseline * c.quantity
          hasPeriodData = true
        } else {
          pnl = 0
          periodStartVal = cost
          hasPeriodData = false
        }
      } else {
        pnl = currentVal - cost
        periodStartVal = cost
        hasPeriodData = true
      }

      return { currentPrice, currentVal, pnl, periodStartVal, hasPeriodData }
    })

  const filtered = calcFloor > 0 ? enriched.filter((c) => c.currentPrice >= calcFloor) : enriched
  const value = filtered.reduce((s, c) => s + c.currentVal, 0)

  let pnl: number
  let pnlPct: number
  if (timeFrame !== 'entry') {
    const periodCards = filtered.filter((c) => c.hasPeriodData)
    pnl = periodCards.reduce((s, c) => s + c.pnl, 0)
    const periodBase = periodCards.reduce((s, c) => s + c.periodStartVal, 0)
    pnlPct = periodBase > 0 ? (pnl / periodBase) * 100 : 0
  } else {
    pnl = filtered.reduce((s, c) => s + c.pnl, 0)
    const entryBase = filtered.reduce((s, c) => s + c.periodStartVal, 0)
    pnlPct = entryBase > 0 ? (pnl / entryBase) * 100 : 0
  }

  return { value, pnl, pnlPct }
}

// Per-game batch price endpoints. All go through Next.js API routes:
// the Pokemon TCG API blocks browser CORS and its key is server-only.
const PRICE_ROUTES: Record<Game, { url: string; payload: (c: Card) => object }> = {
  pokemon:   { url: '/api/prices/pokemon',   payload: (c) => ({ id: c.id, apiId: c.apiId, isFoil: c.isFoil }) },
  lorcana:   { url: '/api/prices/lorcana',   payload: (c) => ({ id: c.id, apiId: c.apiId, isFoil: c.isFoil }) },
  riftbound: { url: '/api/prices/riftbound', payload: (c) => ({ id: c.id, apiId: c.apiId, isFoil: c.isFoil }) },
  // No isFoil — a One Piece "Parallel" print is its own catalog id, not a foil toggle of the
  // base card (see app/api/prices/onepiece/route.ts).
  onepiece:  { url: '/api/prices/onepiece',  payload: (c) => ({ id: c.id, apiId: c.apiId }) },
  mtg:       { url: '/api/prices/mtg',       payload: (c) => ({ id: c.id, apiId: c.apiId, isFoil: c.isFoil }) },
}

export default function PortfolioPage() {
  const {
    cards, priceHistory, applyPriceUpdates,
    setLastPriceRefresh, lastPriceRefresh,
    purchases, soldCards, calcFloor, activeGames, timeFrame, setTimeFrame,
    priceMode, setPriceMode,
    hiddenGroups,
  } = useStore()
  const { user, dataLoading } = useAuth()
  const [sort, setSort] = useState<SortKey>('pnl')
  const [cardSearch, setCardSearch] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [includePacks, setIncludePacks] = useState(false)
  const [includeSold, setIncludeSold] = useState(false)
  const [barWidth, setBarWidth] = useState(0)   // 0–100, drives progress bar
  // Change in pnl/pnlPct caused specifically by the most recent Refresh Prices click, tagged
  // with the timeFrame it was computed under so switching timeframes hides a now-mismatched delta.
  const [refreshDelta, setRefreshDelta] = useState<{ pnl: number; pnlPct: number; timeFrame: string } | null>(null)

  const totalPackSpend = useMemo(
    () => purchases.reduce((s, p) => s + p.pricePaid * p.quantity, 0),
    [purchases],
  )

  const totalSoldRevenue = useMemo(
    () => soldCards.reduce((s, c) => s + c.soldPrice, 0),
    [soldCards],
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
  }, [cards, sort, activeGames, timeFrame, priceHistory, hiddenGroups])

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

  // Prices now come from the catalog (kept fresh by a 6-hourly server-side cron —
  // app/api/cron/sync-prices/route.ts — not a live external fetch on every call), so this only
  // ever runs on an explicit "Refresh Prices" click or a price-mode toggle, never automatically
  // on page load. It only ever touches price-related fields (currentPrice, priceHistory) for
  // cards already in this user's own inventory — never card data, never other users' cards.
  const refreshPrices = useCallback(async () => {
    if (!user) return
    const uid = user.uid
    setRefreshing(true)
    setRefreshError(null)
    const now = new Date().toISOString()
    const failed: string[] = []

    // Snapshot before any prices change, then track the same shape locally as updates land
    // (rather than waiting on a React re-render of the store) so we can diff before vs. after.
    const before = computeTotals(cards, priceHistory, timeFrame, activeGames, hiddenGroups, calcFloor)
    const localCards = cards.map((c) => ({ ...c }))
    const localCardsById = new Map(localCards.map((c) => [c.id, c]))
    const localHistory = priceHistory.map((h) => ({ ...h, points: [...h.points] }))
    const localHistoryByCard = new Map(localHistory.map((h) => [h.cardId, h]))

    const eligibleByGame: Record<Game, Card[]> = {
      pokemon: cards.filter((c) => c.game === 'pokemon' && c.apiId && !c.priceLocked),
      lorcana: cards.filter((c) => c.game === 'lorcana' && c.apiId && !c.priceLocked),
      riftbound: cards.filter((c) => c.game === 'riftbound' && c.apiId && !c.priceLocked),
      onepiece: cards.filter((c) => c.game === 'onepiece' && c.apiId && !c.priceLocked),
      mtg: cards.filter((c) => c.game === 'mtg' && c.apiId && !c.priceLocked),
    }

    // Firestore writes for the whole refresh are collected here and committed in a handful of
    // batches after every game finishes (see applyPriceUpdatesBatch below) instead of firing an
    // editCard + addPricePoint call per card — for a collection in the thousands, that was up to
    // several thousand concurrent Firestore SDK writes, which was blocking the tab's main thread
    // for tens of seconds (independent of, and on top of, the Zustand batching fixed above).
    const firestoreUpdates: { cardId: string; price: number; date: string }[] = []

    // Records a single card's price into the local before/after snapshot used for the
    // refresh-delta banner — the store itself is updated once per network response by
    // `fetchPrices`, not per card, see the comment there.
    function savePriceUpdate(cardId: string, price: number) {
      firestoreUpdates.push({ cardId, price, date: now })

      const localCard = localCardsById.get(cardId)
      if (localCard) localCard.currentPrice = price
      let hist = localHistoryByCard.get(cardId)
      if (!hist) {
        hist = { cardId, points: [] }
        localHistoryByCard.set(cardId, hist)
        localHistory.push(hist)
      }
      hist.points.push({ date: now, price })
    }

    async function fetchPrices(game: Game, chunk: Card[]) {
      const { url, payload } = PRICE_ROUTES[game]
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cards: chunk.map(payload), priceMode }),
        })
        if (!res.ok) {
          failed.push(`${game}: price API returned ${res.status}`)
          return
        }
        const prices: Record<string, number> = await res.json()
        const entries = Object.entries(prices)
        entries.forEach(([cardId, price]) => savePriceUpdate(cardId, price))
        // One batched Zustand update per response instead of one per card — updateCardPrice/
        // addPriceHistoryPoint each map over the full cards/priceHistory arrays, so calling
        // them per card here (up to thousands for Riftbound) is O(n²) and was blocking the main
        // thread long enough to stall pending route navigation until the refresh finished.
        if (entries.length > 0) {
          applyPriceUpdates(entries.map(([cardId, price]) => ({ cardId, price, date: now })))
        }
      } catch {
        failed.push(`${game}: network error fetching prices`)
      }
    }

    // All five price routes are cheap in-memory catalog lookups (no live external fetch — see
    // app/api/prices/{pokemon,lorcana,riftbound,onepiece,mtg}/route.ts), so every game can go in
    // one request each; no need to chunk any of them.
    await Promise.all(
      (['pokemon', 'lorcana', 'riftbound', 'onepiece', 'mtg'] as Game[])
        .filter((game) => eligibleByGame[game].length > 0)
        .map((game) => fetchPrices(game, eligibleByGame[game])),
    )
    if (firestoreUpdates.length > 0) {
      try {
        await applyPriceUpdatesBatch(uid, firestoreUpdates)
      } catch (err) {
        const code = (err as { code?: string })?.code
        failed.push(code === 'resource-exhausted' ? 'Firestore quota exceeded — prices shown but not saved' : 'Failed to save refreshed prices')
      }
    }
    setLastPriceRefresh(now)
    setRefreshing(false)
    if (failed.length > 0) setRefreshError(failed.join(' · '))

    const after = computeTotals(localCards, localHistory, timeFrame, activeGames, hiddenGroups, calcFloor)
    setRefreshDelta({ pnl: after.pnl - before.pnl, pnlPct: after.pnlPct - before.pnlPct, timeFrame })
  }, [user, cards, priceHistory, applyPriceUpdates, setLastPriceRefresh, priceMode, timeFrame, activeGames, hiddenGroups, calcFloor])

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

  // No auto-refresh on page load anymore — prices only change on an explicit "Refresh Prices"
  // click (or a price-mode toggle below). The catalog itself stays fresh via a 6-hourly
  // server-side cron (app/api/cron/sync-prices/route.ts) instead of a per-visit live fetch.

  // Re-fetch when price mode changes
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
            <button onClick={() => refreshPrices()} disabled={refreshing} className="btn-secondary">
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
            <span className="text-2xl font-bold text-white">{formatCurrency(totals.adjustedCost)}</span>
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
            <span className={`text-2xl font-bold ${totals.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {formatCurrency(totals.pnl)}
            </span>
            {showHistoryNote
              ? <span className="text-[10px] text-slate-500">{periodCardCount} card{periodCardCount !== 1 ? 's' : ''} w/ history</span>
              : (totals.pnl >= 0 ? <TrendingUp size={14} className="text-emerald-500" /> : <TrendingDown size={14} className="text-red-500" />)
            }
            {refreshDelta && refreshDelta.timeFrame === timeFrame && (
              <span className={`text-[10px] font-semibold ${refreshDelta.pnl >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                {refreshDelta.pnl >= 0 ? '+' : ''}{formatCurrency(refreshDelta.pnl)} since last refresh
              </span>
            )}
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
            {refreshDelta && refreshDelta.timeFrame === timeFrame && (
              <span className={`text-[10px] font-semibold ${refreshDelta.pnlPct >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                {formatPercent(refreshDelta.pnlPct)} since last refresh
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
                  ? 'bg-violet-600/20 border-violet-500/40 text-violet-300'
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
              {showHistoryNote && <span className="ml-2 text-[10px] text-violet-400 font-normal normal-case">{periodLabel} change</span>}
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
                      <span className="font-medium text-white text-sm truncate">{c.name}</span>
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
                    <div className="text-sm font-medium text-white">{formatCurrency(c.currentVal)}</div>
                    <div className={`text-xs font-medium ${c.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
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
                className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-8 pr-8 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-violet-500 transition-colors"
              />
              {cardSearch && (
                <button onClick={() => setCardSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors">
                  <X size={12} />
                </button>
              )}
            </div>
          </div>

          {showHistoryNote && periodCardCount === 0 && displayRows.length > 0 && (
            <div className="px-5 py-3 bg-slate-900/60 border-b border-slate-800 text-xs text-slate-500 flex items-center gap-2">
              <span className="text-amber-400">⚠</span>
              No price history yet for the {periodLabel} window — hit <span className="text-slate-300 font-medium">Refresh Prices</span> and check back after {timeFrame === '1d' ? '24 hours' : timeFrame === '7d' ? '7 days' : timeFrame === '30d' ? '30 days' : 'a year'}.
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

          {displayRows.map((card) => (
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
                    {card.quantity > 1 && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-700/80 text-slate-300 border border-slate-600/50">
                        ×{card.quantity}
                      </span>
                    )}
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
                    {card.nexus && (
                      <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30">
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
