'use client'

import { useState, useEffect, useRef } from 'react'
import { X, Search, Loader2, ChevronDown, AlertCircle } from 'lucide-react'
import { useStore } from '@/lib/store'
import { useAuth } from '@/components/auth/AuthProvider'
import { newCardRef, saveCard, editCard as editCardInFirestore } from '@/lib/firebase/db'
import { CONDITION_LABELS, GAME_LABELS, type Game, type Card, type Condition, type Edition, type Finish, type Language } from '@/lib/types'
import {
  EDITION_LABELS, FINISH_LABELS, editionsOf, finishesOf, defaultEdition, defaultFinish, variantPrice,
} from '@/scripts/lib/pokemon-variants.mjs'
import type { CardSearchResult, SetOption } from '@/lib/api/search'
import { cn, localDateString, isFirstCopyOfCard } from '@/lib/utils'
import { useScrollLock } from '@/lib/useScrollLock'
import { cardImage } from '@/lib/cardImage'


const GAMES: Game[] = ['pokemon', 'lorcana', 'riftbound', 'onepiece', 'mtg']
const CONDITIONS = Object.entries(CONDITION_LABELS) as [Condition, string][]

interface Props {
  defaultGame: Game
  editCard?: Card
  // Open on this exact catalog card, already selected (the Cardex's Shift+Click / double-tap).
  // Used as-is if the search route can't find that id.
  prefill?: CardSearchResult
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

// Shorter names for the game tabs, so the row fits without scrolling at today's game count.
const GAME_TAB_LABELS: Partial<Record<Game, string>> = { mtg: 'Magic' }

export function AddCardDialog({ defaultGame, editCard, prefill, onClose, onSaveError }: Props) {
  const { addCard, updateCard, deleteCard, cards: allCards, pushCardUnlock, trackedGames } = useStore()
  const { user } = useAuth()
  useScrollLock()

  const existingGroups = Array.from(new Set(allCards.map((c) => c.group).filter(Boolean) as string[]))

  const [form, setForm] = useState<CardForm>(editCard ? { ...editCard } : emptyForm(prefill?.game ?? defaultGame))
  // Only offer the games this user tracks — a card added to an untracked game would vanish from
  // Inventory the moment it saved. An edited card's own game always stays selectable.
  const gameChoices = GAMES.filter((g) => trackedGames.includes(g) || g === form.game)
  // Catalog market prices for the selected card
  const existingMarket = editCard?.currentPrice ?? 0
  const [marketPrices, setMarketPrices] = useState({ regular: existingMarket, foil: existingMarket })
  // Pokémon: the selected catalog card's price for every printing (edition × finish) — drives the
  // Edition / Finish pickers and the shown market price. null = no per-printing prices (other
  // games, manual entry, a backup-priced card): the classic Foil checkbox applies instead.
  const [variantPrices, setVariantPrices] = useState<Record<string, number> | null>(null)
  const japanese = form.game === 'pokemon' && form.language === 'ja'
  const langParam = japanese ? '&lang=ja' : ''

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
  // Keep the selected game's tab in view when the game row scrolls (e.g. editing a card from a
  // game further along the row).
  const activeGameRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    activeGameRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [form.game])
  const setDropdownRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const cardJustSelectedRef = useRef(false)
  // In edit mode (or opened on a card), suppress the search dropdown until the user actually types
  const searchEnabledRef = useRef(!editCard && !prefill)
  const [prefillLoading, setPrefillLoading] = useState(!!prefill)

  // Auto-focus the search input when the dialog opens — not when it opens on a card already
  // picked (on a phone that would just throw the keyboard up over it)
  useEffect(() => {
    if (prefill) return
    const t = setTimeout(() => searchInputRef.current?.focus(), 50)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Opened on a card: fetch it as a search row (same name/variant/price handling as picking it
  // from the dropdown), preferring its regular print; the caller's copy if the lookup fails.
  useEffect(() => {
    if (!prefill) return
    let stale = false
    fetch(`/api/cards/search?game=${prefill.game}&id=${encodeURIComponent(prefill.id)}&q=${encodeURIComponent(prefill.name)}${prefill.language === 'ja' ? '&lang=ja' : ''}`)
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => [])
      .then((rows: CardSearchResult[]) => {
        if (stale) return
        selectCard(rows.find((r) => !r.isFoil) ?? rows[0] ?? prefill)
        setPrefillLoading(false)
      })
    return () => { stale = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Editing a Pokémon card picked from the catalog: load its printing prices so the Edition /
  // Finish pickers work (the form itself keeps the card's saved values).
  useEffect(() => {
    if (!editCard || editCard.game !== 'pokemon' || !editCard.apiId) return
    let stale = false
    fetch(`/api/cards/search?game=pokemon&id=${encodeURIComponent(editCard.apiId)}&q=${encodeURIComponent(editCard.name)}${editCard.language === 'ja' ? '&lang=ja' : ''}`)
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => [])
      .then((rows: CardSearchResult[]) => {
        const vp = rows[0]?.variantPrices
        if (stale || !vp || !Object.keys(vp).length) return
        setVariantPrices(vp)
        // A card saved before editions existed: show the printing it's actually priced as.
        setForm((f) => {
          const edition = (f.edition ?? defaultEdition(vp)) as Edition
          return { ...f, edition, finish: (f.finish ?? defaultFinish(vp, edition, f.isFoil)) as Finish }
        })
      })
    return () => { stale = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setField = (key: keyof CardForm, value: unknown) =>
    setForm((f) => ({ ...f, [key]: value }))

  // Load sets when game changes — via server route (Pokemon set list is
  // CORS-blocked in the browser and the catalog files live server-side)
  useEffect(() => {
    let stale = false
    setSetsLoading(true)
    setAllSets([])
    fetch(`/api/sets?game=${form.game}${langParam}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((sets: SetOption[]) => { if (!stale) setAllSets(sets) })
      .catch(() => {})
      .finally(() => { if (!stale) setSetsLoading(false) })
    return () => { stale = true }
  }, [form.game, langParam])

  // Warm the server's catalog + search index for this game/language as soon as the dialog opens
  // (or the game/language changes) — on a cold server instance that's the slow part of the first
  // search, and this way it happens while the user is still typing.
  useEffect(() => {
    fetch(`/api/cards/search?game=${form.game}&warm=1${langParam}`).catch(() => {})
  }, [form.game, langParam])

  // Live card search — goes through Next.js API route so external fetches are server-side
  useEffect(() => {
    if (!searchEnabledRef.current || !debouncedCardQuery || debouncedCardQuery.length < 2) {
      setCardResults([])
      return
    }
    let stale = false // ignore out-of-order responses from older queries
    setCardSearching(true)
    fetch(`/api/cards/search?game=${form.game}&q=${encodeURIComponent(debouncedCardQuery)}${langParam}`)
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
  }, [debouncedCardQuery, form.game, langParam])

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
    const rawRegular = result.marketPrice
    const rawFoil = result.marketPriceFoil
    const regular = rawRegular > 0 ? rawRegular : 0
    const foil = rawFoil > 0 ? rawFoil : regular
    setMarketPrices({ regular, foil })
    const vp = result.variantPrices && Object.keys(result.variantPrices).length ? result.variantPrices : null
    setVariantPrices(vp)
    // Start on the printing most copies are (Unlimited; Normal unless the card only comes foil).
    const edition = vp ? (defaultEdition(vp) as Edition) : undefined
    const finish = vp && edition ? (defaultFinish(vp, edition, result.isFoil) as Finish) : undefined
    setForm((f) => ({
      ...f,
      name: result.name,
      set: result.setName,
      setCode: result.set,
      number: result.number,
      imageUrl: result.imageUrl,
      apiId: result.id,
      isFoil: finish ? finish !== 'normal' : result.isFoil,
      rarity: result.rarity,
      edition,
      finish,
    }))
    setCardQuery(result.name)
    setSetQuery(result.setName)
    setShowCardResults(false)
  }

  // The catalog's price for what's selected: the exact printing when per-printing prices exist,
  // else the classic regular / foil pair. Same rule as lib/pricing.ts.
  function catalogMarketPrice(): number {
    if (variantPrices) return variantPrice(variantPrices, { edition: form.edition, finish: form.finish, isFoil: form.isFoil })
    return form.isFoil ? (marketPrices.foil > 0 ? marketPrices.foil : marketPrices.regular) : marketPrices.regular
  }

  function pickEdition(edition: Edition) {
    if (!variantPrices) return
    setForm((f) => {
      const finish = (f.finish && finishesOf(variantPrices, edition).includes(f.finish) ? f.finish : defaultFinish(variantPrices, edition, f.isFoil)) as Finish
      return { ...f, edition, finish, isFoil: finish !== 'normal' }
    })
  }

  function pickFinish(finish: Finish) {
    setForm((f) => ({ ...f, finish, isFoil: finish !== 'normal' }))
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

    // Prices come from the shared catalog only. A card with no catalog price (a custom card, or one
    // TCGplayer doesn't price) keeps the price it already had.
    const catalogPrice = catalogMarketPrice()
    const resolvedMarketPrice = catalogPrice > 0 ? catalogPrice : (editCard?.currentPrice ?? 0)

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
      // Pokémon printing — only when it was picked from catalog prices (lib/pricing.ts)
      ...(form.game === 'pokemon' && variantPrices && form.edition && { edition: form.edition }),
      ...(form.game === 'pokemon' && variantPrices && form.finish && { finish: form.finish }),
      ...(japanese && { language: 'ja' as Language }),
      // Editing a card from before the manual-price lock was retired clears it.
      ...(editCard?.priceLocked && { priceLocked: false }),
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
      const newCard: Card = { ...cardData, id: ref.id }
      addCard(newCard)
      // Fire the "Card Unlocked" celebration only for a genuinely new slot — checked against
      // `allCards` as it was before this add (addCard's own state update hasn't applied yet).
      if (isFirstCopyOfCard(newCard, allCards)) pushCardUnlock(newCard)
      // No per-card price history to start anymore — history is shared at the catalog level
      // (scripts/lib/price-history.mjs) and priceAtEntry above is this card's Since-Entry baseline.
      onClose()
    } catch (err) {
      console.error('Firestore save failed:', err)
      setDialogError(firestoreError(err))
    } finally {
      setIsSaving(false)
    }
  }

  // When game tab changes, reset form but keep condition/date/quantity
  function changeGame(game: Game, language?: Language) {
    setForm((f) => ({ ...emptyForm(game), condition: f.condition, quantity: f.quantity, purchaseDate: f.purchaseDate, group: f.group, ...(language === 'ja' && { language }) }))
    setVariantPrices(null)
    setMarketPrices({ regular: 0, foil: 0 })
    setCardQuery('')
    setSetQuery('')
    setCardResults([])
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="add-card-backdrop absolute inset-0 bg-black/60 backdrop-blur-sm touch-none" onClick={onClose} />
      <div className="add-card-panel relative w-full max-w-[592px] card-glass rounded-2xl p-5 md:p-6 max-h-[92dvh] overflow-y-auto overflow-x-hidden overscroll-contain">

        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-ink">{editCard ? 'Edit Card' : 'Add Card'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:text-ink hover:bg-slate-700">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">

          {/* Game tabs — hidden when there's only one game to pick from. One row that scrolls
              sideways once there are more games than fit, rather than wrapping or squeezing. */}
          {gameChoices.length > 1 && <div>
            <label className="field-label">Game</label>
            <div className="flex gap-2 overflow-x-auto overscroll-x-contain pb-1">
              {gameChoices.map((g) => (
                <button
                  key={g}
                  ref={form.game === g ? activeGameRef : undefined}
                  type="button"
                  onClick={() => changeGame(g)}
                  className={cn(
                    'flex-auto shrink-0 px-3 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all border',
                    form.game === g
                      ? 'bg-violet-600 border-violet-500 text-white'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-ink hover:border-slate-700'
                  )}
                >
                  {GAME_TAB_LABELS[g] ?? GAME_LABELS[g]}
                </button>
              ))}
            </div>
          </div>}

          {/* Card search */}
          <div ref={cardResultsRef} className="relative">
            <div className="flex items-end justify-between gap-2">
              <label className="field-label">
                Search {japanese ? 'Japanese ' : ''}{GAME_LABELS[form.game]} Cards
                {form.game === 'riftbound' && (
                  <span className="text-slate-600 font-normal normal-case ml-1">(loads on first search)</span>
                )}
              </label>
              {/* English and Japanese Pokémon are separate catalogs — different sets, numbers and
                  prices — so the search targets one at a time. */}
              {form.game === 'pokemon' && !editCard && (
                <div className="flex mb-1.5 rounded-lg border border-slate-800 overflow-hidden text-[11px] font-medium flex-shrink-0">
                  {([['en', 'English'], ['ja', 'Japanese']] as const).map(([lang, label]) => (
                    <button
                      key={lang}
                      type="button"
                      onClick={() => { if ((lang === 'ja') !== japanese) changeGame('pokemon', lang) }}
                      className={cn(
                        'px-2.5 py-1 transition-colors',
                        (lang === 'ja') === japanese ? 'bg-violet-600 text-white' : 'bg-slate-900 text-slate-400 hover:text-ink',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
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
                placeholder={japanese ? 'Name, set or number — e.g. Umbreon ex 217' : 'Name, set or number — e.g. Charizard 4'}
                className="input-field pl-9 pr-9"
              />
              {(cardSearching || prefillLoading) && (
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
                          src={cardImage(result.imageUrl, 'thumb')}
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
                      <div className="text-sm text-ink font-medium truncate">{result.name}</div>
                      <div className="text-xs text-slate-500 truncate">{result.setName} · #{result.number}</div>
                    </div>
                    {(() => {
                      const displayPrice = result.marketPrice
                      return displayPrice > 0 ? (
                        <div className="text-xs text-emerald-600 font-medium flex-shrink-0 text-right">
                          <div>${displayPrice.toFixed(2)}</div>
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
            <label className="field-label">Card Name <span className="text-red-600">*</span></label>
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
                        <div className="text-sm text-ink">{set.name}</div>
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

          {/* Market price — always the shared catalog's (TCGplayer market), never chosen per user */}
          <div>
            <label className="field-label">Market Price</label>
            <div className="px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm">
              {(() => {
                const mp = catalogMarketPrice()
                return mp > 0
                  ? <span className="text-emerald-600 font-medium">${mp.toFixed(2)}</span>
                  : <span className="text-slate-500">No market price yet</span>
              })()}
            </div>
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

          {/* Foil toggle — not shown for One Piece: a "Parallel" print is its own catalog entry
              (selected from the search dropdown, e.g. "Shanks (Parallel)"), not a foil toggle of
              the same card the way Pokemon holo/Lorcana foil/Riftbound foil are. */}
          {/* Pokémon cards picked from the catalog choose an exact printing instead: Edition (only
              for cards TCGplayer prices in more than one — WotC-era sets, early Japanese sets) and
              Finish (Normal / Holo / Reverse Holo — only the ones that card actually comes in). */}
          {form.game === 'pokemon' && variantPrices && (() => {
            const vp = variantPrices
            const edition = (form.edition ?? defaultEdition(vp)) as Edition
            const editions = editionsOf(vp) as Edition[]
            const finishes = finishesOf(vp, edition) as Finish[]
            const priceTag = (p: number) => p > 0 ? <span className="block text-[10px] opacity-80">${p.toFixed(2)}</span> : <span className="block text-[10px] opacity-60">no price</span>
            const chip = (active: boolean) => cn(
              'flex-1 py-1.5 px-2 rounded-lg text-xs font-medium transition-all border leading-tight',
              active ? 'bg-violet-600 border-violet-500 text-white' : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-ink hover:border-slate-700',
            )
            return (
              <div className="space-y-3">
                {editions.length > 1 && (
                  <div>
                    <label className="field-label">Edition</label>
                    <div className="flex gap-1.5">
                      {editions.map((e) => {
                        const f = form.finish && finishesOf(vp, e).includes(form.finish) ? form.finish : undefined
                        return (
                          <button key={e} type="button" onClick={() => pickEdition(e)} className={chip(e === edition)}>
                            {EDITION_LABELS[e]}
                            {priceTag(variantPrice(vp, { edition: e, finish: f }))}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
                {finishes.length > 1 && (
                  <div>
                    <label className="field-label">Finish</label>
                    <div className="flex gap-1.5">
                      {finishes.map((f) => (
                        <button key={f} type="button" onClick={() => pickFinish(f)} className={chip(f === form.finish)}>
                          {FINISH_LABELS[f]}
                          {priceTag(variantPrice(vp, { edition, finish: f }))}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })()}

          {form.game !== 'onepiece' && !(form.game === 'pokemon' && variantPrices) && (
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
          )}

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
              <img src={cardImage(form.imageUrl, 'thumb')} alt={form.name} className="w-12 h-16 object-contain rounded" />
              <div>
                <div className="text-sm font-medium text-ink">{form.name}</div>
                <div className="text-xs text-slate-500">{form.set}{form.number ? ` · #${form.number}` : ''}</div>
                {form.game === 'riftbound' && form.nexus && (
                  <span className="mt-1 inline-block text-[10px] font-bold uppercase text-blue-600 border border-blue-300 rounded px-1 py-0.5">Nexus</span>
                )}
                {form.game === 'pokemon' && (japanese || (variantPrices && (form.edition !== 'unlimited' || form.finish === 'reverse'))) && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {variantPrices && form.edition && form.edition !== 'unlimited' && (
                      <span className="text-[10px] font-bold uppercase text-amber-700 border border-amber-400 rounded px-1 py-0.5">{EDITION_LABELS[form.edition]}</span>
                    )}
                    {variantPrices && form.finish === 'reverse' && (
                      <span className="text-[10px] font-bold uppercase text-violet-600 border border-violet-300 rounded px-1 py-0.5">Reverse Holo</span>
                    )}
                    {japanese && (
                      <span className="text-[10px] font-bold uppercase text-red-600 border border-red-300 rounded px-1 py-0.5">Japanese</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Save error */}
          {dialogError && (
            <div className="flex items-start gap-2 bg-red-100/50 border border-red-300 rounded-xl px-3 py-2.5 text-xs text-red-700 mt-2">
              <AlertCircle size={13} className="text-red-600 flex-shrink-0 mt-0.5" />
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
