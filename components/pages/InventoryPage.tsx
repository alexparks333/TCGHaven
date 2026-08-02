'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { Plus, Search, Trash2, Edit2, AlertTriangle, CalendarDays, X, ChevronDown, DollarSign, Check } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useStore } from '@/lib/store'
import { formatCurrency, openEbaySearch } from '@/lib/utils'
import { CONDITION_LABELS, GAME_COLORS, GAME_LABELS, type Game, type Card, type SoldCard } from '@/lib/types'
import { AddCardDialog } from '@/components/inventory/AddCardDialog'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { useAuth } from '@/components/auth/AuthProvider'
import { removeCard, editCard as editCardInFirestore, saveSoldCard } from '@/lib/firebase/db'
import { cn } from '@/lib/utils'

const GAMES: Game[] = ['pokemon', 'lorcana', 'riftbound']

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function cardDate(card: Card): string {
  return (card.createdAt ?? card.purchaseDate ?? '').slice(0, 10)
}

// Unique identity key — same card from different purchase sessions shares this key
function cardIdentityKey(card: Card): string {
  if (card.apiId) return `${card.game}::${card.apiId}::${card.isFoil ? 'foil' : 'normal'}`
  return `${card.game}::${card.name}::${card.set}::${card.number}::${card.isFoil ? 'foil' : 'normal'}`
}

interface CardGroup {
  key: string
  lots: Card[]         // each Firestore document (separate purchase)
  totalQty: number
  totalPaid: number    // sum of purchasePrice * quantity across all lots
  rep: Card            // representative card (latest lot) for image/name/set display
  currentPrice: number // from any lot that has it
}

export default function InventoryPage() {
  const { cards, deleteCard, addSoldCard, activeGame, setActiveGame, updateCardPrice } = useStore()
  const { user, dataLoading } = useAuth()
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [dateFilter, setDateFilter] = useState<string>('')
  const [sellCard, setSellCard] = useState<Card | null>(null)
  const [salePrice, setSalePrice] = useState('')
  const [saleDate, setSaleDate] = useState(todayISO)
  const [sellError, setSellError] = useState<string | null>(null)
  const [isSelling, setIsSelling] = useState(false)
  const [soldCelebration, setSoldCelebration] = useState<string | null>(null)
  const celebTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [holdProgress, setHoldProgress] = useState(0)
  const holdRafRef = useRef<number | null>(null)
  const holdStartRef = useRef<number | null>(null)
  const holdFiredRef = useRef(false)

  // Background: fill in missing market prices for cards that don't have one yet.
  // Runs once per visit, after the Firestore load finishes — running earlier
  // would see an empty store and never retry.
  const backfillRan = useRef(false)
  useEffect(() => {
    if (!user || dataLoading || backfillRan.current) return
    const uid = user.uid
    const unpriced = cards.filter((c) => !((c.currentPrice ?? 0) > 0) && c.name && !c.priceLocked)
    if (!unpriced.length) return
    backfillRan.current = true
    let cancelled = false
    const now = new Date().toISOString()
    async function backfill(card: Card) {
      if (cancelled) return
      try {
        const res = await fetch(`/api/cards/search?game=${card.game}&q=${encodeURIComponent(card.name)}`)
        if (!res.ok) return
        const results = await res.json()
        const match =
          results.find((r: { id: string }) => r.id === card.apiId) ??
          results.find((r: { number: string; set: string }) => r.number === card.number && r.set === card.setCode) ??
          results.find((r: { name: string }) => r.name === card.name)
        if (!match) return
        const price = card.isFoil && match.marketPriceFoil > 0 ? match.marketPriceFoil : match.marketPrice
        if (price > 0 && !cancelled) {
          updateCardPrice(card.id, price)
          editCardInFirestore(uid, card.id, { currentPrice: price, priceUpdatedAt: now }).catch(() => {})
        }
      } catch { /* ignore individual failures */ }
    }
    Promise.all(unpriced.map(backfill))
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, dataLoading, cards])
  const [editCard, setEditCard] = useState<Card | null>(null)
  const [expandedKey, setExpandedKey] = useState<string | null>(null)

  function openSell(card: Card) {
    setSellCard(card)
    setSalePrice(card.currentPrice ? String(card.currentPrice) : String(card.purchasePrice || ''))
    setSaleDate(todayISO())
    setHoldProgress(0)
    setSellError(null)
    setIsSelling(false)
  }

  function startHold() {
    if (!sellCard || !(parseFloat(salePrice) > 0)) return
    holdStartRef.current = Date.now()
    holdFiredRef.current = false
    function tick() {
      if (!holdStartRef.current) return
      const elapsed = Date.now() - holdStartRef.current
      const progress = Math.min((elapsed / 1000) * 100, 100)
      setHoldProgress(progress)
      if (progress >= 100 && !holdFiredRef.current) {
        holdFiredRef.current = true
        handleSold()
      } else if (progress < 100) {
        holdRafRef.current = requestAnimationFrame(tick)
      }
    }
    holdRafRef.current = requestAnimationFrame(tick)
  }

  function cancelHold() {
    if (holdRafRef.current) cancelAnimationFrame(holdRafRef.current)
    holdStartRef.current = null
    holdRafRef.current = null
    if (!holdFiredRef.current) setHoldProgress(0)
  }

  async function handleSold() {
    if (!user || !sellCard) return
    setIsSelling(true)
    setSellError(null)
    const soldAt = new Date().toISOString()
    const soldCard: SoldCard = {
      ...sellCard,
      soldDate: saleDate,
      soldPrice: parseFloat(salePrice) || 0,
      soldAt,
    }
    const { id: cardId, ...soldCardData } = soldCard

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), 10000)
    )

    try {
      await Promise.race([saveSoldCard(user.uid, cardId, soldCardData), timeout])
      await Promise.race([removeCard(user.uid, cardId), timeout])
      // Both writes confirmed — now update local state
      addSoldCard(soldCard)
      deleteCard(cardId)
      setSellCard(null)
      setHoldProgress(0)
      // Celebration overlay
      if (celebTimerRef.current) clearTimeout(celebTimerRef.current)
      setSoldCelebration(soldCard.name)
      celebTimerRef.current = setTimeout(() => setSoldCelebration(null), 1300)
    } catch (err) {
      console.error('Sale failed:', err)
      const code = (err as { code?: string })?.code
      const isTimeout = (err as Error)?.message === 'timeout'
      const msg = isTimeout
        ? 'Sale timed out — Firestore is not responding. Your card is still in inventory. Check your connection or Firebase quota.'
        : code === 'resource-exhausted'
        ? 'Sale failed: daily Firestore quota exceeded. Try again tomorrow or upgrade your Firebase plan.'
        : code === 'permission-denied'
        ? 'Sale failed: Firestore rules need to allow the soldCards collection. Update your Firebase security rules.'
        : `Sale failed: ${code ?? 'unknown error'}. Your card is still in inventory.`
      setSellError(msg)
      setHoldProgress(0)
      holdFiredRef.current = false
    } finally {
      setIsSelling(false)
    }
  }

  // Cards visible in the table: game tab + search + date filter
  const filtered = useMemo(
    () =>
      cards
        .filter(
          (c) =>
            c.game === activeGame &&
            (search === '' ||
              c.name.toLowerCase().includes(search.toLowerCase()) ||
              c.set.toLowerCase().includes(search.toLowerCase())) &&
            (dateFilter === '' || cardDate(c) === dateFilter)
        )
        .sort((a, b) => (b.createdAt ?? b.purchaseDate ?? '').localeCompare(a.createdAt ?? a.purchaseDate ?? '')),
    [cards, activeGame, search, dateFilter]
  )

  // When no date filter: group duplicate cards into a single row.
  // When date filter active: show individual lots so the session view is accurate.
  const grouped = useMemo<CardGroup[] | null>(() => {
    if (dateFilter) return null  // individual-lot view when filtering by date
    const map = new Map<string, Card[]>()
    for (const card of filtered) {
      const key = cardIdentityKey(card)
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(card)
    }
    return Array.from(map.entries()).map(([key, lots]) => {
      // sort lots newest-first so rep is the latest purchase
      const sorted = [...lots].sort((a, b) => cardDate(b).localeCompare(cardDate(a)))
      const totalQty = lots.reduce((s, c) => s + c.quantity, 0)
      const totalPaid = lots.reduce((s, c) => s + c.purchasePrice * c.quantity, 0)
      const priced = lots.find((c) => (c.currentPrice ?? 0) > 0)
      return {
        key,
        lots: sorted,
        totalQty,
        totalPaid,
        rep: sorted[0],
        currentPrice: priced?.currentPrice ?? 0,
      }
    })
  }, [filtered, dateFilter])

  // Session summary: ALL games on the selected date
  const sessionCards = useMemo(
    () => (dateFilter ? cards.filter((c) => cardDate(c) === dateFilter) : []),
    [cards, dateFilter]
  )

  const session = useMemo(() => {
    if (!sessionCards.length) return null
    const paid = sessionCards.reduce((s, c) => s + c.purchasePrice * c.quantity, 0)
    const market = sessionCards.reduce(
      (s, c) => s + ((c.currentPrice ?? 0) > 0 ? c.currentPrice! * c.quantity : 0),
      0
    )
    const byGame = GAMES.map((game) => {
      const gc = sessionCards.filter((c) => c.game === game)
      return {
        game,
        count: gc.reduce((s, c) => s + c.quantity, 0),
        market: gc.reduce((s, c) => s + ((c.currentPrice ?? 0) > 0 ? c.currentPrice! * c.quantity : 0), 0),
      }
    }).filter((g) => g.count > 0)
    return { count: sessionCards.reduce((s, c) => s + c.quantity, 0), paid, market, byGame }
  }, [sessionCards])

  const { totalPaid, totalMarket, displayCount } = useMemo(() => ({
    totalPaid: filtered.reduce((s, c) => s + c.purchasePrice * c.quantity, 0),
    totalMarket: filtered.reduce((s, c) => s + ((c.currentPrice ?? 0) > 0 ? c.currentPrice! * c.quantity : 0), 0),
    displayCount: grouped
      ? grouped.reduce((s, g) => s + g.totalQty, 0)
      : filtered.reduce((s, c) => s + c.quantity, 0),
  }), [filtered, grouped])

  const gameCounts = useMemo(() => {
    const counts = { pokemon: 0, lorcana: 0, riftbound: 0 } as Record<Game, number>
    for (const c of cards) counts[c.game] = (counts[c.game] || 0) + 1
    return counts
  }, [cards])

  async function handleDelete(card: Card) {
    if (!user) return
    deleteCard(card.id)
    await removeCard(user.uid, card.id)
  }

  return (
    <AuthGuard>
      <div className="pb-20 md:pb-0">
        {saveError && (
          <div className="mb-4 flex items-center gap-3 bg-red-950/50 border border-red-800 rounded-xl px-4 py-3 text-sm text-red-300">
            <AlertTriangle size={16} className="text-red-400 flex-shrink-0" />
            <span>{saveError}</span>
            <button onClick={() => setSaveError(null)} className="ml-auto text-red-500 hover:text-red-300">✕</button>
          </div>
        )}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Inventory</h1>
            <p className="text-slate-400 text-sm mt-0.5">
              {displayCount} cards · paid {formatCurrency(totalPaid)}
              {totalMarket > 0 && <> · market {formatCurrency(totalMarket)}</>}
            </p>
          </div>
          <button onClick={() => setShowAdd(true)} className="btn-primary">
            <Plus size={16} />
            Add Card
          </button>
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

        {/* Search + Date filter */}
        <div className="flex gap-2 mb-4">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="Search cards or sets…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-slate-600"
            />
          </div>
          <div className="relative flex items-center">
            <CalendarDays size={14} className="absolute left-3 text-slate-500 pointer-events-none z-10" />
            <input
              type="date"
              value={dateFilter}
              max={todayISO()}
              onChange={(e) => setDateFilter(e.target.value)}
              className="bg-slate-900 border border-slate-800 rounded-xl pl-9 py-2.5 text-sm text-white focus:outline-none focus:border-slate-600 w-[170px] cursor-pointer [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:opacity-50 [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:hover:opacity-100"
              style={dateFilter ? { paddingRight: '1.5rem' } : { paddingRight: '0.5rem' }}
            />
            {dateFilter && (
              <button
                onClick={() => setDateFilter('')}
                className="absolute right-2 text-slate-500 hover:text-white z-10"
              >
                <X size={13} />
              </button>
            )}
          </div>
        </div>

        {/* Session summary — shown when a date is selected */}
        {session && (
          <div className="mb-6 rounded-2xl border border-violet-800/40 bg-violet-950/30 px-5 py-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold uppercase tracking-wide text-violet-400">
                Session · {dateFilter}
              </span>
              <span className="text-xs text-slate-500">{session.count} cards logged</span>
            </div>
            <div className="grid grid-cols-3 gap-4 mb-3">
              <div>
                <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-0.5">Market Value</div>
                <div className="text-xl font-bold text-white">{formatCurrency(session.market)}</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-0.5">Paid</div>
                <div className="text-xl font-bold text-white">{formatCurrency(session.paid)}</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-0.5">Gain / Loss</div>
                <div className={`text-xl font-bold ${session.market - session.paid >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {session.market - session.paid >= 0 ? '+' : ''}{formatCurrency(session.market - session.paid)}
                </div>
              </div>
            </div>
            {session.byGame.length > 0 && (
              <div className="flex gap-3 flex-wrap">
                {session.byGame.map(({ game, count, market }) => (
                  <div
                    key={game}
                    className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full"
                    style={{ backgroundColor: GAME_COLORS[game] + '18', color: GAME_COLORS[game] }}
                  >
                    <span className="font-bold">{GAME_LABELS[game]}</span>
                    <span className="opacity-70">·</span>
                    <span>{count} cards</span>
                    {market > 0 && <><span className="opacity-70">·</span><span>{formatCurrency(market)}</span></>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Cards Table */}
        {filtered.length === 0 ? (
          <div className="card-glass flex flex-col items-center justify-center py-20 text-center">
            <div className="text-4xl mb-3">🃏</div>
            <div className="text-slate-400 font-medium">No cards yet</div>
            <div className="text-slate-600 text-sm mt-1">
              {search ? 'No results for your search.' : `Add your first ${GAME_LABELS[activeGame]} card to get started.`}
            </div>
            {!search && (
              <button onClick={() => setShowAdd(true)} className="btn-primary mt-4">
                <Plus size={14} /> Add Card
              </button>
            )}
          </div>
        ) : grouped ? (
          /* ── Grouped view (no date filter) ── */
          <div className="card-glass">
            <div className="hidden md:grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_80px] gap-4 px-5 py-3 border-b border-slate-800 text-xs font-semibold text-slate-500 uppercase tracking-wide">
              <span>Card</span><span>Set</span><span>Condition</span><span>Qty</span><span>Total Paid</span><span>Market</span><span></span>
            </div>

            {grouped.map((group) => {
              const { key, lots, totalQty, totalPaid: gPaid, rep, currentPrice } = group
              const hasMarket = currentPrice > 0
              const marketTotal = hasMarket ? currentPrice * totalQty : null
              const pnl = hasMarket ? marketTotal! - gPaid : null
              const isExpanded = expandedKey === key
              const multiLot = lots.length > 1

              return (
                <div key={key} className="border-b border-slate-800/50 last:border-0">
                  {/* Main row */}
                  <div
                    className="relative grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_80px] gap-2 md:gap-4 px-5 py-4 hover:bg-slate-800/20 transition-colors cursor-pointer"
                    onClick={(e) => {
                      if (e.ctrlKey || e.metaKey) { openEbaySearch(rep); return }
                      router.push(`/portfolio/${lots[0].id}`)
                    }}
                    title="Click to view card detail · ⌘/Ctrl+Click to search eBay"
                  >
                    <div className="flex items-center gap-3">
                      {rep.imageUrl ? (
                        <img src={rep.imageUrl} alt={rep.name} className="w-10 h-14 object-contain rounded-md" />
                      ) : (
                        <div className="w-10 h-14 rounded-md bg-slate-800 flex items-center justify-center text-xs text-slate-600">#{rep.number}</div>
                      )}
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-white text-sm">{rep.name}</span>
                          {rep.priceLocked && <span title="Manual price — locked" className="text-[11px]">🔒</span>}
                        </div>
                        <div className="text-xs text-slate-500">#{rep.number} {rep.isFoil && '✨ Foil'}</div>
                        {rep.group && <div className="text-[10px] text-violet-400/70 mt-0.5">{rep.group}</div>}
                      </div>
                    </div>
                    <div className="text-sm text-slate-300 flex items-center">{rep.set}</div>
                    <div className="text-sm text-slate-300 flex items-center">
                      {multiLot ? <span className="text-slate-500 text-xs">varies</span> : CONDITION_LABELS[rep.condition]}
                    </div>
                    <div className="text-sm font-semibold text-white flex items-center">×{totalQty}</div>
                    <div className="text-sm text-slate-300 flex items-center">{formatCurrency(gPaid)}</div>
                    <div className="flex flex-col justify-center">
                      {marketTotal !== null ? (
                        <>
                          <span className="text-sm text-white font-medium">{formatCurrency(marketTotal)}</span>
                          {pnl !== null && (
                            <span className={`text-xs ${pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                              {pnl >= 0 ? '+' : ''}{formatCurrency(pnl)}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-sm text-slate-600">—</span>
                      )}
                    </div>
                    {/* Pull-out sell tab — single-lot only (multi-lot sells per expanded row) */}
                    {!multiLot && (
                      <button
                        onClick={(e) => { e.stopPropagation(); openSell(lots[0]) }}
                        title="Sell"
                        className="absolute top-1/2 -translate-y-1/2 -right-6 w-6 h-10 rounded-r-xl bg-emerald-800 hover:bg-emerald-500 flex items-center justify-center text-emerald-400 hover:text-white shadow-lg transition-all z-10 opacity-10 hover:opacity-100"
                      >
                        <DollarSign size={13} strokeWidth={2.5} />
                      </button>
                    )}
                    <div className="flex items-center gap-2 justify-end" onClick={(e) => e.stopPropagation()}>
                      {!multiLot && (
                        <button
                          onClick={() => setEditCard(lots[0])}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-slate-700 transition-colors"
                        >
                          <Edit2 size={14} />
                        </button>
                      )}
                      {multiLot && (
                        <button
                          onClick={() => setExpandedKey(isExpanded ? null : key)}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-slate-700 transition-colors"
                        >
                          <ChevronDown size={14} className={cn('transition-transform', isExpanded && 'rotate-180')} />
                        </button>
                      )}
                      {!multiLot && (
                        <button
                          onClick={() => handleDelete(lots[0])}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-950/30 transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Expanded lots */}
                  {isExpanded && multiLot && (
                    <div className="bg-slate-900/50 border-t border-slate-800/50 px-5 pb-2">
                      {lots.map((lot, i) => (
                        <div
                          key={lot.id}
                          onClick={(e) => {
                            if ((e.target as HTMLElement).closest('button')) return
                            if (e.ctrlKey || e.metaKey) { openEbaySearch(lot); return }
                            router.push(`/portfolio/${lot.id}`)
                          }}
                          className="relative flex items-center gap-4 py-2.5 border-b border-slate-800/40 last:border-0 hover:bg-slate-800/20 cursor-pointer rounded transition-colors"
                        >
                          <div className="w-1 h-1 rounded-full bg-slate-700 ml-2 flex-shrink-0" />
                          <div className="flex-1 text-xs text-slate-400 flex flex-wrap items-center gap-3">
                            <span className="text-slate-200 font-medium">
                              Lot {i + 1}
                            </span>
                            <span className="text-slate-500">·</span>
                            <span>
                              <span className="text-slate-500">Date</span>{' '}
                              <span className="text-slate-300">{lot.purchaseDate || cardDate(lot) || '—'}</span>
                            </span>
                            <span className="text-slate-500">·</span>
                            <span>
                              <span className="text-slate-500">Qty</span>{' '}
                              <span className="text-slate-300">×{lot.quantity}</span>
                            </span>
                            <span className="text-slate-500">·</span>
                            <span>
                              <span className="text-slate-500">Paid</span>{' '}
                              <span className="text-slate-300">{formatCurrency(lot.purchasePrice)}/ea</span>
                            </span>
                            <span className="text-slate-500">·</span>
                            <span className="text-slate-400">{CONDITION_LABELS[lot.condition]}</span>
                          </div>
                          {/* Pull-out sell tab */}
                          <button
                            onClick={(e) => { e.stopPropagation(); openSell(lot) }}
                            title="Sell"
                            className="absolute top-1/2 -translate-y-1/2 -right-6 w-6 h-8 rounded-r-xl bg-emerald-800 hover:bg-emerald-500 flex items-center justify-center text-emerald-400 hover:text-white shadow-lg transition-all z-10 opacity-10 hover:opacity-100"
                          >
                            <DollarSign size={12} strokeWidth={2.5} />
                          </button>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <button
                              onClick={() => setEditCard(lot)}
                              className="p-1.5 rounded-lg text-slate-600 hover:text-white hover:bg-slate-700 transition-colors"
                            >
                              <Edit2 size={13} />
                            </button>
                            <button
                              onClick={() => handleDelete(lot)}
                              className="p-1.5 rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-950/30 transition-colors"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          /* ── Individual-lot view (date filter active) ── */
          <div className="card-glass">
            <div className="hidden md:grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_80px] gap-4 px-5 py-3 border-b border-slate-800 text-xs font-semibold text-slate-500 uppercase tracking-wide">
              <span>Card</span><span>Set</span><span>Condition</span><span>Qty</span><span>Paid</span><span>Market</span><span></span>
            </div>

            {filtered.map((card) => {
              const hasMarket = (card.currentPrice ?? 0) > 0
              const marketTotal = hasMarket ? card.currentPrice! * card.quantity : null
              const pnl = hasMarket ? marketTotal! - card.purchasePrice * card.quantity : null
              return (
                <div
                  key={card.id}
                  onClick={(e) => {
                    if (e.ctrlKey || e.metaKey) { openEbaySearch(card); return }
                    router.push(`/portfolio/${card.id}`)
                  }}
                  title="Click to view card detail · ⌘/Ctrl+Click to search eBay sold listings"
                  className="relative grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_80px] gap-2 md:gap-4 px-5 py-4 border-b border-slate-800/50 last:border-0 hover:bg-slate-800/20 transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    {card.imageUrl ? (
                      <img src={card.imageUrl} alt={card.name} className="w-10 h-14 object-contain rounded-md" />
                    ) : (
                      <div className="w-10 h-14 rounded-md bg-slate-800 flex items-center justify-center text-xs text-slate-600">#{card.number}</div>
                    )}
                    <div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-semibold text-white text-sm">{card.name}</span>
                        {card.priceLocked && <span title="Manual price — locked" className="text-[11px]">🔒</span>}
                        {card.gradingCompany && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">
                            {card.gradingCompany}{card.grade ? ` ${card.grade}` : ''}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500">#{card.number} {card.isFoil && '✨ Foil'}</div>
                      {card.group && <div className="text-[10px] text-violet-400/70 mt-0.5">{card.group}</div>}
                    </div>
                  </div>
                  <div className="text-sm text-slate-300 flex items-center">{card.set}</div>
                  <div className="text-sm text-slate-300 flex items-center">{CONDITION_LABELS[card.condition]}</div>
                  <div className="text-sm text-slate-300 flex items-center">×{card.quantity}</div>
                  <div className="text-sm text-slate-300 flex items-center">{formatCurrency(card.purchasePrice)}</div>
                  <div className="flex flex-col justify-center">
                    {marketTotal !== null ? (
                      <>
                        <span className="text-sm text-white font-medium">{formatCurrency(marketTotal)}</span>
                        {pnl !== null && (
                          <span className={`text-xs ${pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {pnl >= 0 ? '+' : ''}{formatCurrency(pnl)}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-sm text-slate-600">—</span>
                    )}
                  </div>
                  {/* Pull-out sell tab */}
                  <button
                    onClick={(e) => { e.stopPropagation(); openSell(card) }}
                    title="Sell"
                    className="absolute top-1/2 -translate-y-1/2 -right-6 w-6 h-10 rounded-r-xl bg-emerald-800 hover:bg-emerald-500 flex items-center justify-center text-emerald-400 hover:text-white shadow-lg transition-all z-10 opacity-10 hover:opacity-100"
                  >
                    <DollarSign size={13} strokeWidth={2.5} />
                  </button>
                  <div className="flex items-center gap-2 justify-end" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => setEditCard(card)} className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-slate-700 transition-colors">
                      <Edit2 size={14} />
                    </button>
                    <button onClick={() => handleDelete(card)} className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-950/30 transition-colors">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {(showAdd || editCard) && (
          <AddCardDialog
            defaultGame={activeGame}
            editCard={editCard ?? undefined}
            onClose={() => { setShowAdd(false); setEditCard(null) }}
            onSaveError={(msg) => setSaveError(msg)}
          />
        )}

        {/* ── Sell Card Modal ── */}
        {sellCard && (() => {
          const paid = sellCard.purchasePrice
          const market = sellCard.currentPrice ?? 0
          const salePriceNum = parseFloat(salePrice) || 0
          const pnl = salePriceNum > 0 ? salePriceNum - paid : null
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setSellCard(null)} />
              <div className="relative w-full max-w-sm card-glass rounded-2xl p-6 shadow-2xl">

                {/* Header */}
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                      <DollarSign size={14} className="text-emerald-400" />
                    </div>
                    <h2 className="text-lg font-bold text-white">Sell Card</h2>
                  </div>
                  <button onClick={() => setSellCard(null)} className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-slate-700 transition-colors">
                    <X size={18} />
                  </button>
                </div>

                {/* Card preview */}
                <div className="flex items-center gap-3 mb-5 p-3 bg-slate-800/60 rounded-xl border border-slate-700/40">
                  {sellCard.imageUrl ? (
                    <img src={sellCard.imageUrl} alt={sellCard.name} className="w-12 h-[67px] object-contain rounded-lg flex-shrink-0" />
                  ) : (
                    <div className="w-12 h-[67px] bg-slate-700 rounded-lg flex items-center justify-center text-xs text-slate-500 flex-shrink-0">#{sellCard.number}</div>
                  )}
                  <div className="min-w-0">
                    <div className="font-semibold text-white text-sm truncate">{sellCard.name}</div>
                    <div className="text-xs text-slate-400 mt-0.5">{sellCard.set} · #{sellCard.number}</div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {sellCard.isFoil ? '✨ Foil · ' : ''}{CONDITION_LABELS[sellCard.condition]}
                      {sellCard.gradingCompany && ` · ${sellCard.gradingCompany}${sellCard.grade ? ` ${sellCard.grade}` : ''}`}
                    </div>
                  </div>
                </div>

                {/* Paid / Market value */}
                <div className="grid grid-cols-2 gap-2 mb-4">
                  <div className="bg-slate-800/40 rounded-xl p-3 border border-slate-700/30">
                    <div className="text-slate-500 text-[10px] uppercase tracking-wide mb-1">You Paid</div>
                    <div className="text-white font-semibold text-sm">{formatCurrency(paid)}</div>
                  </div>
                  <div className="bg-slate-800/40 rounded-xl p-3 border border-slate-700/30">
                    <div className="text-slate-500 text-[10px] uppercase tracking-wide mb-1">Market Value</div>
                    <div className="text-white font-semibold text-sm">{market > 0 ? formatCurrency(market) : '—'}</div>
                  </div>
                </div>

                {/* Sale Price */}
                <div className="mb-3">
                  <label className="field-label">Sale Price ($)</label>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={salePrice}
                    onChange={(e) => setSalePrice(e.target.value)}
                    className="input-field"
                    placeholder="0.00"
                    autoFocus
                  />
                  {pnl !== null && (
                    <div className={`mt-1.5 text-xs font-medium ${pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {pnl >= 0 ? '+' : ''}{formatCurrency(pnl)} P&L
                    </div>
                  )}
                </div>

                {/* Date Sold */}
                <div className="mb-5">
                  <label className="field-label">Date Sold</label>
                  <input
                    type="date"
                    value={saleDate}
                    onChange={(e) => setSaleDate(e.target.value)}
                    className="input-field cursor-pointer [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:opacity-50"
                  />
                </div>

                {/* Error */}
                {sellError && (
                  <div className="mb-4 flex items-start gap-2 bg-red-950/50 border border-red-800 rounded-xl px-3 py-2.5 text-xs text-red-300">
                    <AlertTriangle size={13} className="text-red-400 flex-shrink-0 mt-0.5" />
                    <span>{sellError}</span>
                  </div>
                )}

                {/* Buttons */}
                <div className="flex gap-3">
                  <button
                    onClick={() => { setSellCard(null); setHoldProgress(0); holdFiredRef.current = false }}
                    className="btn-secondary flex-1 justify-center"
                  >
                    Cancel
                  </button>
                  <button
                    onMouseDown={startHold}
                    onMouseUp={cancelHold}
                    onMouseLeave={cancelHold}
                    onTouchStart={startHold}
                    onTouchEnd={cancelHold}
                    disabled={!(parseFloat(salePrice) > 0) || isSelling}
                    className="relative flex-1 py-2.5 px-4 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-xl flex items-center justify-center gap-2 text-sm overflow-hidden select-none cursor-pointer"
                  >
                    <div
                      className="absolute inset-y-0 left-0 bg-emerald-400/30 pointer-events-none"
                      style={{ width: `${holdProgress}%`, transition: holdProgress === 0 ? 'none' : undefined }}
                    />
                    <DollarSign size={14} className="relative z-10" />
                    <span className="relative z-10">{isSelling ? 'SAVING…' : 'HOLD TO SELL'}</span>
                  </button>
                </div>

              </div>
            </div>
          )
        })()}
        {/* SOLD celebration overlay */}
        {soldCelebration && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center pointer-events-none sold-overlay-fade">
            <div className="flex flex-col items-center gap-5">
              <div className="sold-icon relative">
                {/* glow ring */}
                <div className="absolute inset-0 rounded-full bg-emerald-400/30 scale-125 blur-xl" />
                <div className="relative w-28 h-28 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-2xl shadow-emerald-500/60">
                  <Check size={56} className="text-white" strokeWidth={3} />
                </div>
              </div>
              <div className="sold-text flex flex-col items-center gap-1">
                <span className="text-5xl font-black text-white tracking-widest drop-shadow-lg">SOLD!</span>
                <span className="text-slate-300 text-sm font-medium max-w-[220px] text-center truncate">{soldCelebration}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </AuthGuard>
  )
}
