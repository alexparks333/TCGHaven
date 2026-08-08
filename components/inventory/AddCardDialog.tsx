'use client'

import { useState, useEffect, useRef } from 'react'
import { X, Search, Loader2, ChevronDown, AlertCircle, TrendingUp } from 'lucide-react'
import { useStore } from '@/lib/store'
import { useAuth } from '@/components/auth/AuthProvider'
import { newCardRef, saveCard, editCard as editCardInFirestore, addPricePoint } from '@/lib/firebase/db'
import { CONDITION_LABELS, GAME_LABELS, type Game, type Card, type Condition } from '@/lib/types'
import type { CardSearchResult, SetOption } from '@/lib/api/search'
import { cn, localDateString } from '@/lib/utils'

type MarketSource = 'catalog' | 'ebay' | 'manual'

const GAMES: Game[] = ['pokemon', 'lorcana', 'riftbound']
const CONDITIONS = Object.entries(CONDITION_LABELS) as [Condition, string][]

interface Props {
  defaultGame: Game
  editCard?: Card
  onClose: () => void
  onSaveError?: (msg: string) => void
}

type CardForm = Omit<Card, 'id'>

function emptyForm(game: Game): CardForm {
  return {
    game,
    name: '',
    set: '',
    setCode: '',
    number: '',
    condition: 'near_mint',
    quantity: 1,
    purchasePrice: 0,
    purchaseDate: localDateString(),
    isFoil: false,
    imageUrl: '',
    apiId: '',
    gradingCompany: '',
    grade: '',
    group: '',
    nexus: false,
  }
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

export function AddCardDialog({ defaultGame, editCard, onClose, onSaveError }: Props) {
  const { addCard, updateCard, deleteCard, addPriceHistoryPoint, priceMode, cards: allCards } = useStore()
  const { user } = useAuth()

  const existingGroups = Array.from(new Set(allCards.map((c) => c.group).filter(Boolean) as string[]))

  const [form, setForm] = useState<CardForm>(editCard ? { ...editCard } : emptyForm(defaultGame))
  // Catalog market prices for the selected card
  const existingMarket = editCard?.currentPrice ?? 0
  const [marketPrices, setMarketPrices] = useState({ regular: existingMarket, foil: existingMarket })

  // Market price source — default to Manual (pre-filled) when editing a locked card
  const [marketSource, setMarketSource] = useState<MarketSource>(editCard?.priceLocked ? 'manual' : 'catalog')
  const [manualMarketPrice, setManualMarketPrice] = useState(
    editCard?.priceLocked && existingMarket > 0 ? String(existingMarket) : ''
  )
  const [ebayData, setEbayData] = useState<{
    avgPrice: number | null
    count: number
    source: 'sold_5_days' | 'active_listings'
    error?: string
  } | null>(null)
  const [ebayLoading, setEbayLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)

  // Card search
  const [cardQuery, setCardQuery] = useState(editCard?.name ?? '')
  const [cardResults, setCardResults] = useState<CardSearchResult[]>([])
  const [cardSearching, setCardSearching] = useState(false)
  const [showCardResults, setShowCardResults] = useState(false)
  const debouncedCardQuery = useDebounce(cardQuery, 350)

  // Set autocomplete
  const [setQuery, setSetQuery] = useState(editCard?.set ?? '')
  const [allSets, setAllSets] = useState<SetOption[]>([])
  const [showSetDropdown, setShowSetDropdown] = useState(false)
  const [setsLoading, setSetsLoading] = useState(false)

  const cardResultsRef = useRef<HTMLDivElement>(null)
  const setDropdownRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const cardJustSelectedRef = useRef(false)
  // In edit mode, suppress the search dropdown until the user actually types
  const searchEnabledRef = useRef(!editCard)

  // Auto-focus the search input when the dialog opens
  useEffect(() => {
    const t = setTimeout(() => searchInputRef.current?.focus(), 50)
    return () => clearTimeout(t)
  }, [])

  const setField = (key: keyof CardForm, value: unknown) =>
    setForm((f) => ({ ...f, [key]: value }))

  // Load sets when game changes — via server route (Pokemon set list is
  // CORS-blocked in the browser and the catalog files live server-side)
  useEffect(() => {
    let stale = false
    setSetsLoading(true)
    setAllSets([])
    fetch(`/api/sets?game=${form.game}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((sets: SetOption[]) => { if (!stale) setAllSets(sets) })
      .catch(() => {})
      .finally(() => { if (!stale) setSetsLoading(false) })
    return () => { stale = true }
  }, [form.game])

  // Live card search — goes through Next.js API route so external fetches are server-side
  useEffect(() => {
    if (!searchEnabledRef.current || !debouncedCardQuery || debouncedCardQuery.length < 2) {
      setCardResults([])
      return
    }
    let stale = false // ignore out-of-order responses from older queries
    setCardSearching(true)
    fetch(`/api/cards/search?game=${form.game}&q=${encodeURIComponent(debouncedCardQuery)}`)
      .then((r) => r.json())
      .then((results: CardSearchResult[]) => {
        if (stale) return
        setCardResults(results)
        if (cardJustSelectedRef.current) {
          cardJustSelectedRef.current = false
        } else {
          setShowCardResults(results.length > 0)
        }
      })
      .catch(() => {})
      .finally(() => { if (!stale) setCardSearching(false) })
    return () => { stale = true }
  }, [debouncedCardQuery, form.game])

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (cardResultsRef.current && !cardResultsRef.current.contains(e.target as Node)) {
        setShowCardResults(false)
      }
      if (setDropdownRef.current && !setDropdownRef.current.contains(e.target as Node)) {
        setShowSetDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function selectCard(result: CardSearchResult) {
    cardJustSelectedRef.current = true
    const useLowestNM = priceMode === 'lowestNM'
    const rawRegular = useLowestNM
      ? (result.lowPriceNM ?? result.marketPrice)
      : result.marketPrice
    const rawFoil = useLowestNM
      ? (result.lowPriceNMFoil ?? result.marketPriceFoil)
      : result.marketPriceFoil
    const regular = rawRegular > 0 ? rawRegular : 0
    const foil = rawFoil > 0 ? rawFoil : regular
    setMarketPrices({ regular, foil })
    setMarketSource('catalog')
    setEbayData(null)
    setForm((f) => ({
      ...f,
      name: result.name,
      set: result.setName,
      setCode: result.set,
      number: result.number,
      imageUrl: result.imageUrl,
      apiId: result.id,
      isFoil: result.isFoil,
      rarity: result.rarity,
    }))
    setCardQuery(result.name)
    setSetQuery(result.setName)
    setShowCardResults(false)
  }

  async function switchMarketSource(source: MarketSource) {
    setMarketSource(source)
    if (source === 'ebay' && form.name && !ebayData) {
      setEbayLoading(true)
      try {
        const res = await fetch(`/api/prices/ebay?q=${encodeURIComponent(form.name)}&game=${form.game}`)
        const data = await res.json()
        setEbayData(res.ok ? data : { avgPrice: null, count: 0, source: 'sold_5_days', error: data.error })
      } catch {
        setEbayData({ avgPrice: null, count: 0, source: 'sold_5_days', error: 'Network error' })
      } finally {
        setEbayLoading(false)
      }
    }
  }

  function selectSet(set: SetOption) {
    setForm((f) => ({ ...f, set: set.name, setCode: set.code }))
    setSetQuery(set.name)
    setShowSetDropdown(false)
  }

  const filteredSets = allSets.filter((s) =>
    s.name.toLowerCase().includes(setQuery.toLowerCase())
  ).slice(0, 8)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!user || isSaving) return
    setDialogError(null)
    setIsSaving(true)

    // Resolve the market price from whichever source is active
    const catalogPrice = form.isFoil
      ? (marketPrices.foil > 0 ? marketPrices.foil : marketPrices.regular)
      : marketPrices.regular
    const resolvedMarketPrice =
      marketSource === 'manual' ? (parseFloat(manualMarketPrice) || 0) :
      marketSource === 'ebay' ? (ebayData?.avgPrice ?? catalogPrice) :
      catalogPrice > 0 ? catalogPrice : (editCard?.currentPrice ?? 0)

    const now = new Date().toISOString()
    const cardData: Omit<Card, 'id'> = {
      game: form.game,
      name: form.name,
      set: form.set || 'N/A',
      setCode: form.setCode || 'N/A',
      number: form.number || 'N/A',
      condition: form.condition,
      quantity: form.quantity,
      purchasePrice: form.purchasePrice,
      purchaseDate: form.purchaseDate,
      isFoil: form.isFoil,
      createdAt: editCard?.createdAt ?? now,
      imageUrl: form.imageUrl || '',
      apiId: form.apiId || '',
      ...(form.gradingCompany && { gradingCompany: form.gradingCompany }),
      ...(form.grade && { grade: form.grade }),
      ...(form.group && { group: form.group }),
      ...(form.rarity && { rarity: form.rarity }),
      ...(form.game === 'riftbound' && { nexus: !!form.nexus }),
      priceLocked: marketSource === 'manual' && resolvedMarketPrice > 0,
      ...(resolvedMarketPrice > 0 && {
        currentPrice: resolvedMarketPrice,
        priceUpdatedAt: editCard?.priceUpdatedAt ?? now,
        ...(!editCard && { priceAtEntry: resolvedMarketPrice }),
      }),
    }

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), 10000)
    )

    function firestoreError(err: unknown): string {
      const code = (err as { code?: string })?.code
      const isTimeout = (err as Error)?.message === 'timeout'
      if (isTimeout) return 'Timed out — Firestore not responding. Check your connection or Firebase quota.'
      if (code === 'resource-exhausted') return 'Save failed: daily Firestore quota exceeded. Try again tomorrow.'
      if (code === 'permission-denied') return 'Save failed: Firestore rules are blocking writes.'
      return `Save failed: ${code ?? 'unknown error'}.`
    }

    if (editCard) {
      try {
        await Promise.race([editCardInFirestore(user.uid, editCard.id, cardData), timeout])
        updateCard(editCard.id, cardData)
        onClose()
      } catch (err) {
        console.error('Firestore edit failed:', err)
        setDialogError(firestoreError(err))
      } finally {
        setIsSaving(false)
      }
      return
    }

    // New card
    const ref = newCardRef(user.uid)
    try {
      await Promise.race([saveCard(user.uid, ref.id, cardData), timeout])
      // Confirmed — now add to UI
      addCard({ ...cardData, id: ref.id })
      if (resolvedMarketPrice > 0) {
        addPriceHistoryPoint(ref.id, resolvedMarketPrice, now)
        addPricePoint(user.uid, ref.id, resolvedMarketPrice, now).catch(() => {})
      }
      onClose()
    } catch (err) {
      console.error('Firestore save failed:', err)
      setDialogError(firestoreError(err))
    } finally {
      setIsSaving(false)
    }
  }

  // When game tab changes, reset form but keep condition/date/quantity
  function changeGame(game: Game) {
    setForm((f) => ({ ...emptyForm(game), condition: f.condition, quantity: f.quantity, purchaseDate: f.purchaseDate, group: f.group }))
    setMarketPrices({ regular: 0, foil: 0 })
    setMarketSource('catalog')
    setEbayData(null)
    setManualMarketPrice('')
    setCardQuery('')
    setSetQuery('')
    setCardResults([])
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg card-glass rounded-2xl p-6 max-h-[92vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-white">{editCard ? 'Edit Card' : 'Add Card'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-slate-700">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">

          {/* Game tabs */}
          <div>
            <label className="field-label">Game</label>
            <div className="flex gap-2">
              {GAMES.map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => changeGame(g)}
                  className={cn(
                    'flex-1 py-2 rounded-xl text-sm font-medium transition-all border',
                    form.game === g
                      ? 'bg-violet-600 border-violet-500 text-white'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                  )}
                >
                  {GAME_LABELS[g]}
                </button>
              ))}
            </div>
          </div>

          {/* Card search */}
          <div ref={cardResultsRef} className="relative">
            <label className="field-label">
              Search {GAME_LABELS[form.game]} Cards
              {form.game === 'riftbound' && (
                <span className="text-slate-600 font-normal normal-case ml-1">(loads on first search)</span>
              )}
            </label>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={cardQuery}
                onChange={(e) => { searchEnabledRef.current = true; setCardQuery(e.target.value); setShowCardResults(true) }}
                onFocus={() => cardResults.length > 0 && setShowCardResults(true)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && showCardResults && cardResults.length > 0) {
                    e.preventDefault()
                    selectCard(cardResults[0])
                  }
                }}
                placeholder={`Type a card name…`}
                className="input-field pl-9 pr-9"
              />
              {cardSearching && (
                <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 animate-spin" />
              )}
            </div>

            {showCardResults && cardResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-slate-900 border border-slate-700 rounded-xl overflow-hidden shadow-2xl z-50 max-h-80 overflow-y-auto">
                {cardResults.map((result) => (
                  <button
                    key={`${result.id}-${result.isFoil ? 'foil' : 'normal'}`}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => selectCard(result)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-800 transition-colors text-left border-b border-slate-800 last:border-0"
                  >
                    {result.imageUrl ? (
                      <div className="w-16 h-[88px] rounded-lg bg-white flex-shrink-0 flex items-center justify-center shadow-md overflow-hidden">
                        <img
                          src={result.imageUrl}
                          alt={result.name}
                          className="w-full h-full object-contain"
                        />
                      </div>
                    ) : (
                      <div className="w-16 h-[88px] bg-slate-800 rounded-lg flex-shrink-0 flex items-center justify-center text-slate-600 text-xs">
                        ?
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-white font-medium truncate">{result.name}</div>
                      <div className="text-xs text-slate-500 truncate">{result.setName} · #{result.number}</div>
                    </div>
                    {(() => {
                      const useLowest = priceMode === 'lowestNM'
                      const displayPrice = useLowest
                        ? ((result.lowPriceNM ?? 0) > 0 ? result.lowPriceNM! : result.marketPrice)
                        : result.marketPrice
                      return displayPrice > 0 ? (
                        <div className="text-xs text-emerald-400 font-medium flex-shrink-0 text-right">
                          <div>${displayPrice.toFixed(2)}</div>
                          {useLowest && <div className="text-[9px] text-slate-500">low NM</div>}
                        </div>
                      ) : null
                    })()}
                  </button>
                ))}
              </div>
            )}

            {showCardResults && cardResults.length === 0 && cardQuery.length >= 2 && !cardSearching && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-3 text-xs text-slate-500 z-50">
                No results for &quot;{cardQuery}&quot;. Fill in manually below.
              </div>
            )}
          </div>

          {/* Card name (auto-filled or manual) */}
          <div>
            <label className="field-label">Card Name <span className="text-red-400">*</span></label>
            <input
              type="text"
              required
              value={form.name}
              onChange={(e) => setField('name', e.target.value)}
              placeholder="e.g. Charizard ex"
              className="input-field"
            />
          </div>

          {/* Set (with autocomplete) + Number */}
          <div className="grid grid-cols-2 gap-3">
            <div ref={setDropdownRef} className="relative">
              <label className="field-label">Set</label>
              <div className="relative">
                <input
                  type="text"
                  value={setQuery}
                  onChange={(e) => { setSetQuery(e.target.value); setField('set', e.target.value); setShowSetDropdown(true) }}
                  onFocus={() => setShowSetDropdown(true)}
                  placeholder={setsLoading ? 'Loading sets…' : 'Search sets…'}
                  className="input-field pr-8"
                />
                <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none" />
              </div>

              {showSetDropdown && filteredSets.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-slate-900 border border-slate-700 rounded-xl overflow-hidden shadow-2xl z-50 max-h-48 overflow-y-auto">
                  {filteredSets.map((set) => (
                    <button
                      key={set.code}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => selectSet(set)}
                      className="w-full flex items-center justify-between px-3 py-2 hover:bg-slate-800 transition-colors text-left border-b border-slate-800 last:border-0"
                    >
                      <div>
                        <div className="text-sm text-white">{set.name}</div>
                        <div className="text-xs text-slate-500">
                          {set.code}
                          {set.cardCount ? ` · ${set.cardCount} cards` : ''}
                        </div>
                      </div>
                      {set.releaseDate && (
                        <span className="text-xs text-slate-600 ml-2 flex-shrink-0">
                          {new Date(set.releaseDate).getFullYear()}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="field-label">Card #</label>
              <input
                type="text"
                value={form.number}
                onChange={(e) => setField('number', e.target.value)}
                placeholder="e.g. 006/193"
                className="input-field"
              />
            </div>
          </div>

          {/* Condition + Qty */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label">Condition</label>
              <select
                value={form.condition}
                onChange={(e) => setField('condition', e.target.value as Condition)}
                className="input-field"
              >
                {CONDITIONS.map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">Quantity</label>
              <input
                type="number"
                min={1}
                value={form.quantity}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10)
                  setField('quantity', isNaN(n) ? 1 : Math.max(1, n))
                }}
                className="input-field"
              />
            </div>
          </div>

          {/* Market Price source */}
          <div>
            <label className="field-label">Market Price</label>
            <div className="flex gap-1.5 mb-2">
              {([
                ['catalog', priceMode === 'lowestNM' ? 'Lowest NM' : 'TCG Market Price'],
                ['ebay', 'eBay'],
                ['manual', 'Manual 🔒'],
              ] as [MarketSource, string][]).map(([src, label]) => (
                <button
                  key={src}
                  type="button"
                  onClick={() => switchMarketSource(src)}
                  className={cn(
                    'flex-1 py-1.5 px-2 rounded-lg text-xs font-medium transition-all border',
                    marketSource === src
                      ? 'bg-violet-600 border-violet-500 text-white'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                  )}
                >
                  {src === 'ebay' && ebayLoading ? (
                    <span className="flex items-center justify-center gap-1">
                      <Loader2 size={11} className="animate-spin" /> Loading…
                    </span>
                  ) : label}
                </button>
              ))}
            </div>

            {/* Source-specific display */}
            {marketSource === 'catalog' && (
              <div className="px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm">
                {(() => {
                  const mp = form.isFoil && marketPrices.foil > 0 ? marketPrices.foil : marketPrices.regular
                  return mp > 0
                    ? <span className="text-emerald-400 font-medium">${mp.toFixed(2)}</span>
                    : <span className="text-slate-500">No catalog price available</span>
                })()}
              </div>
            )}

            {marketSource === 'ebay' && !ebayLoading && ebayData && (
              <div className={cn(
                'px-3 py-2 rounded-lg flex items-start gap-2 text-xs border',
                ebayData.error
                  ? 'bg-red-950/50 text-red-400 border-red-900'
                  : 'bg-emerald-950/50 text-emerald-400 border-emerald-900'
              )}>
                {ebayData.error
                  ? <><AlertCircle size={13} className="mt-0.5 flex-shrink-0" /><span>{ebayData.error}</span></>
                  : <><TrendingUp size={13} className="mt-0.5 flex-shrink-0" /><span>
                      {ebayData.avgPrice !== null
                        ? `$${ebayData.avgPrice.toFixed(2)} avg · ${ebayData.count} ${ebayData.source === 'sold_5_days' ? 'sold in last 5 days' : 'active listings'}`
                        : 'No recent eBay data found'}
                    </span></>
                }
              </div>
            )}

            {marketSource === 'ebay' && !ebayLoading && !ebayData && (
              <div className="px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-500">
                Click eBay above to fetch recent sold prices
              </div>
            )}

            {marketSource === 'manual' && (
              <input
                type="text"
                inputMode="decimal"
                value={manualMarketPrice}
                onChange={(e) => {
                  const v = e.target.value
                  if (v === '' || /^\d*\.?\d*$/.test(v)) setManualMarketPrice(v)
                }}
                placeholder="e.g. 6.87"
                className="input-field"
              />
            )}
          </div>

          {/* How Much Paid + Date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label">How Much Paid ($)</label>
              <input
                type="number"
                min={0}
                step={0.01}
                value={form.purchasePrice}
                onChange={(e) => setField('purchasePrice', parseFloat(e.target.value) || 0)}
                className="input-field"
              />
            </div>
            <div>
              <label className="field-label">Purchase Date</label>
              <input
                type="date"
                value={form.purchaseDate}
                onChange={(e) => setField('purchaseDate', e.target.value)}
                className="input-field"
              />
            </div>
          </div>

          {/* Foil toggle */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={form.isFoil}
              onChange={(e) => setField('isFoil', e.target.checked)}
              className="w-4 h-4 rounded accent-violet-500"
            />
            <span className="text-sm text-slate-300">
              Foil / Holo variant
              {marketPrices.foil > 0 && marketPrices.foil !== marketPrices.regular && (
                <span className="ml-1.5 text-slate-500">(foil: ${marketPrices.foil.toFixed(2)})</span>
              )}
            </span>
          </label>

          {/* Nexus Night promo variant (Riftbound only) */}
          {form.game === 'riftbound' && (
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={!!form.nexus}
                onChange={(e) => setField('nexus', e.target.checked)}
                className="w-4 h-4 rounded accent-blue-500"
              />
              <span className="text-sm text-slate-300">Nexus Night promo variant</span>
            </label>
          )}

          {/* Group */}
          <div>
            <label className="field-label">
              Group <span className="text-slate-600 font-normal normal-case">(optional — hide from Portfolio)</span>
            </label>
            <input
              list="card-groups-datalist"
              type="text"
              value={form.group ?? ''}
              onChange={(e) => setField('group', e.target.value)}
              placeholder="e.g. Alex & Brother's Cards"
              className="input-field"
            />
            {existingGroups.length > 0 && (
              <datalist id="card-groups-datalist">
                {existingGroups.map((g) => <option key={g} value={g} />)}
              </datalist>
            )}
            {existingGroups.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {existingGroups.map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setField('group', form.group === g ? '' : g)}
                    className={cn(
                      'text-[11px] px-2 py-0.5 rounded-full border transition-all',
                      form.group === g
                        ? 'bg-violet-600 border-violet-500 text-white'
                        : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-600'
                    )}
                  >
                    {g}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Graded card toggle + fields */}
          <div className="space-y-3">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={!!form.gradingCompany}
                onChange={(e) => {
                  if (e.target.checked) setForm((f) => ({ ...f, gradingCompany: 'PSA', grade: '' }))
                  else setForm((f) => ({ ...f, gradingCompany: '', grade: '' }))
                }}
                className="w-4 h-4 rounded accent-violet-500"
              />
              <span className="text-sm text-slate-300">Professionally graded (PSA, CGC, etc.)</span>
            </label>

            {!!form.gradingCompany && (
              <div className="grid grid-cols-2 gap-3 pl-6">
                <div>
                  <label className="field-label">Grading Company</label>
                  <select
                    value={form.gradingCompany}
                    onChange={(e) => setField('gradingCompany', e.target.value)}
                    className="input-field"
                  >
                    {['PSA', 'CGC', 'BGS', 'SGC', 'HGA', 'CSG', 'Other'].map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="field-label">Grade</label>
                  <input
                    type="text"
                    value={form.grade ?? ''}
                    onChange={(e) => setField('grade', e.target.value)}
                    placeholder="e.g. 10, 9.5"
                    className="input-field"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Card preview */}
          {form.imageUrl && (
            <div className="flex items-center gap-3 p-3 bg-slate-900 rounded-xl border border-slate-800">
              <img src={form.imageUrl} alt={form.name} className="w-12 h-16 object-contain rounded" />
              <div>
                <div className="text-sm font-medium text-white">{form.name}</div>
                <div className="text-xs text-slate-500">{form.set}{form.number ? ` · #${form.number}` : ''}</div>
                {form.game === 'riftbound' && form.nexus && (
                  <span className="mt-1 inline-block text-[10px] font-bold uppercase text-blue-400 border border-blue-800 rounded px-1 py-0.5">Nexus</span>
                )}
              </div>
            </div>
          )}

          {/* Save error */}
          {dialogError && (
            <div className="flex items-start gap-2 bg-red-950/50 border border-red-800 rounded-xl px-3 py-2.5 text-xs text-red-300 mt-2">
              <AlertCircle size={13} className="text-red-400 flex-shrink-0 mt-0.5" />
              <span>{dialogError}</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 mt-1">
            <button type="button" onClick={onClose} className="btn-secondary flex-1 justify-center">
              Cancel
            </button>
            <button type="submit" disabled={!form.name || isSaving} className="btn-primary flex-1 justify-center disabled:opacity-50 gap-2">
              {isSaving && <Loader2 size={14} className="animate-spin" />}
              {isSaving ? 'Saving…' : editCard ? 'Save Changes' : 'Add Card'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
