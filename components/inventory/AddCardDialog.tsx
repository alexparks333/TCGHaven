'use client'

import { useState, useEffect, useRef } from 'react'
import { X, Search, Loader2, ChevronDown, AlertCircle, Plus, Check, Award, ExternalLink } from 'lucide-react'
import { useStore } from '@/lib/store'
import { useAuth } from '@/components/auth/AuthProvider'
import { newCardRef, saveCard, editCard as editCardInFirestore } from '@/lib/firebase/db'
import { CONDITION_LABELS, GAME_LABELS, GAME_COLORS, hasPrintings, type Game, type Card, type Condition, type Edition, type Finish, type Language } from '@/lib/types'
import {
  EDITION_LABELS, FINISH_LABELS, editionsOf, finishesOf, defaultEdition, defaultFinish, variantPrice,
} from '@/scripts/lib/pokemon-variants.mjs'
import type { CardSearchResult, SetOption } from '@/lib/api/search'
import { cn, localDateString, isFirstCopyOfCard, printingText, nameWithPrinting } from '@/lib/utils'
import { useScrollLock } from '@/lib/useScrollLock'
import { cardImage } from '@/lib/cardImage'
import { FullSlab } from '@/components/SlabCase'
import { GRADER_CHOICES, graderOf, gradeWord, isValidGrade, SUBGRADE_KEYS, type GradeTier, type Subgrades } from '@/lib/grading'
import { CardName } from '@/components/CardName'


const GAMES: Game[] = ['pokemon', 'lorcana', 'riftbound', 'onepiece', 'mtg', 'yugioh', 'swu', 'gundam', 'fab', 'digimon', 'palworld', 'cyberpunk']
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
// Shorter names where the full one crowds a game chip
const GAME_TAB_LABELS: Partial<Record<Game, string>> = { mtg: 'Magic' }
// Quick grades for a grader lib/grading.ts doesn't describe (HGA, CSG, Other)
const QUICK_GRADES = ['10', '9.5', '9', '8.5', '8', '7']
const quickGradesFor = (company: string) => graderOf(company)?.quick ?? QUICK_GRADES

/** A row that scrolls sideways with no scrollbar: its edges fade out on the side(s) with more to
 *  see, and a mouse wheel scrolls it sideways (no trackpad needed). */
function FadeScrollRow({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ left: false, right: false })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setEdges({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    for (const c of Array.from(el.children)) ro.observe(c)
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
      const atEnd = (e.deltaY > 0 && el.scrollLeft + el.clientWidth >= el.scrollWidth - 1) || (e.deltaY < 0 && el.scrollLeft <= 0)
      if (atEnd) return   // at an end, let the dialog scroll as usual
      e.preventDefault()
      el.scrollLeft += e.deltaY
    }
    el.addEventListener('scroll', update, { passive: true })
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => { ro.disconnect(); el.removeEventListener('scroll', update); el.removeEventListener('wheel', onWheel) }
  }, [])
  const fade = 36
  const mask = `linear-gradient(to right, ${edges.left ? 'transparent' : '#000'} 0, #000 ${edges.left ? fade : 0}px, #000 calc(100% - ${edges.right ? fade : 0}px), ${edges.right ? 'transparent' : '#000'} 100%)`
  return (
    <div ref={ref} className={cn('no-scrollbar overflow-x-auto overscroll-x-contain', className)} style={{ maskImage: mask, WebkitMaskImage: mask }}>
      {children}
    </div>
  )
}


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
  // games, manual entry, a backup-priced card): the classic regular / foil pair applies instead.
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
  // Group: typing a new one (the "+ New group" chip, or a saved group that isn't in the list)
  const [newGroupOpen, setNewGroupOpen] = useState(false)
  // The "Other" grade box keeps exactly what's typed ("9" then "9.2"), even when it matches a chip
  const [gradeText, setGradeText] = useState(() => (quickGradesFor(editCard?.gradingCompany ?? '').includes(editCard?.grade ?? '') ? '' : editCard?.grade ?? ''))
  // The card preview: is the chosen card's art landscape (Star Wars leaders and bases, Riftbound
  // battlefields)? A slab holds those turned on their side.
  const [artLandscape, setArtLandscape] = useState(false)
  useEffect(() => { setArtLandscape(false) }, [form.imageUrl])
  const noteArt = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget
    setArtLandscape(img.naturalWidth > img.naturalHeight * 1.05)
  }
  // Keep the selected game in view in the sideways-scrolling game row (e.g. editing a card from a
  // game further along it, or picking one at the row's edge)
  const activeGameRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    // Centred in the row — clear of the faded edges (scrolls only the row, never the page)
    const chip = activeGameRef.current, row = chip?.parentElement
    if (chip && row) row.scrollTo({ left: chip.offsetLeft - (row.clientWidth - chip.offsetWidth) / 2, behavior: 'smooth' })
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
      ...(form.gradingCompany && form.grade && { grade: form.grade }),
      ...(form.gradingCompany && form.certNumber && { certNumber: form.certNumber }),
      ...(form.gradingCompany && form.gradeTier && parseFloat(form.grade ?? '') >= 10 && { gradeTier: form.gradeTier }),
      ...(form.gradingCompany && graderOf(form.gradingCompany)?.subgrades && form.subgrades && Object.values(form.subgrades).some(Boolean) && { subgrades: form.subgrades }),
      ...(form.group && { group: form.group }),
      // An edit merges into the saved card, so a grade or group taken off has to be sent as cleared
      ...(editCard && {
        ...(!form.gradingCompany && { gradingCompany: '', grade: '', certNumber: '', gradeTier: null as never, subgrades: null as never }),
        ...(form.gradingCompany && !(form.gradeTier && parseFloat(form.grade ?? '') >= 10) && { gradeTier: null as never }),
        ...(form.gradingCompany && !(graderOf(form.gradingCompany)?.subgrades && form.subgrades && Object.values(form.subgrades).some(Boolean)) && { subgrades: null as never }),
        ...(form.gradingCompany && !form.grade && { grade: '' }),
        ...(form.gradingCompany && !form.certNumber && { certNumber: '' }),
        ...(!form.group && { group: '' }),
      }),
      ...(form.rarity && { rarity: form.rarity }),
      ...(form.game === 'riftbound' && { nexus: !!form.nexus }),
      // Pokémon printing — only when it was picked from catalog prices (lib/pricing.ts)
      // A printing picked from catalog prices (Pokémon, Yu-Gi-Oh! — lib/pricing.ts)
      ...(hasPrintings(form.game) && variantPrices && form.edition && { edition: form.edition }),
      ...(hasPrintings(form.game) && variantPrices && form.finish && { finish: form.finish }),
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
      {/* The dialog stays centred; the chosen card's view slides out to its right (xl screens —
          the room beside a centred dialog) */}
      <div className="relative w-full max-w-[592px]">
      <div className="add-card-panel scroll-themed relative w-full max-w-[592px] min-w-0 card-glass rounded-2xl p-5 md:p-6 max-h-[92dvh] overflow-y-auto overflow-x-hidden overscroll-contain">

        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-ink">{editCard ? 'Edit Card' : 'Add Card'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:text-ink hover:bg-slate-700">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">

          {/* Game tabs — hidden when there's only one game to pick from. One row that scrolls
              sideways (no scrollbar; the edges fade where there's more), rather than wrapping. */}
          {gameChoices.length > 1 && <div>
            <label className="field-label">Game</label>
            <FadeScrollRow className="flex gap-2 pb-0.5">
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
            </FadeScrollRow>
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
                      <div className="text-sm text-ink font-medium truncate"><CardName name={result.name} /></div>
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
              {/* The browser's own arrow hidden, the same chevron as the Set picker beside it */}
              <div className="relative">
                <select
                  value={form.condition}
                  onChange={(e) => setField('condition', e.target.value as Condition)}
                  className="input-field appearance-none pr-8 cursor-pointer"
                >
                  {CONDITIONS.map(([val, label]) => (
                    <option key={val} value={val}>{label}</option>
                  ))}
                </select>
                <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
              </div>
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

          {/* How Much Paid + Date — one per row on phones, where a date field runs out of room beside another */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
              the same card the way Lorcana foil/Riftbound foil are. */}
          {/* Pokémon cards picked from the catalog choose an exact printing instead: Edition (only
              for cards TCGplayer prices in more than one — WotC-era sets, early Japanese sets) and
              Finish (Normal / Holo / Reverse Holo — only the ones that card actually comes in). */}
          {hasPrintings(form.game) && variantPrices && (() => {
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

          {/* No Foil checkbox for any game (owner, 2026-11-10): a foil copy is picked from the search —
              its own "✦ Foil" / "✦ Holo" row, or the version's own card (Hyperspace Foil, a parallel) —
              and printing games use the pickers above. A saved card's isFoil is kept as is. */}

          {/* No Nexus Night toggle either: Nexus Night promos are their own catalog cards. A saved
              card's nexus flag is kept as is. */}

          {/* Group — optional; a grouped card can be hidden from Portfolio */}
          {(() => {
            const custom = !!form.group && !existingGroups.includes(form.group)
            const typing = newGroupOpen || custom
            const chip = (active: boolean) => cn(
              'inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border transition-all',
              active
                ? 'bg-violet-600 border-violet-500 text-white'
                : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-ink hover:border-slate-700',
            )
            return (
              <div>
                <label className="field-label">
                  Group <span className="text-slate-500 font-normal normal-case tracking-normal">· optional, can be hidden from Portfolio</span>
                </label>
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" onClick={() => { setField('group', ''); setNewGroupOpen(false) }} className={chip(!form.group && !typing)}>
                    None
                  </button>
                  {existingGroups.map((g) => (
                    <button key={g} type="button" onClick={() => { setField('group', g); setNewGroupOpen(false) }} className={chip(form.group === g)}>
                      {form.group === g && <Check size={12} />}{g}
                    </button>
                  ))}
                  <button type="button" onClick={() => { setNewGroupOpen(true); if (!custom) setField('group', '') }} className={chip(typing)}>
                    <Plus size={12} />New group
                  </button>
                </div>
                {typing && (
                  <input
                    type="text"
                    autoFocus={newGroupOpen}
                    value={form.group ?? ''}
                    onChange={(e) => setField('group', e.target.value)}
                    placeholder="Name the group — e.g. Alex & Brother's Cards"
                    className="input-field mt-2"
                  />
                )}
              </div>
            )
          })()}

          {/* Graded — in the dialog's own parchment and walnut: a switch; on, the company and the
              grade as chips, and the slab label it will carry */}
          <div className={cn('haven-panel', form.gradingCompany && 'haven-panel-on')}>
            <button
              type="button"
              role="switch"
              aria-checked={!!form.gradingCompany}
              onClick={() => { setGradeText(''); setForm((f) => (f.gradingCompany ? { ...f, gradingCompany: '', grade: '', certNumber: '', gradeTier: undefined, subgrades: undefined } : { ...f, gradingCompany: 'PSA', grade: '' })) }}
              className="w-full flex items-center gap-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 rounded-lg"
            >
              <span className="haven-medallion w-8 h-8 shrink-0"><Award size={15} /></span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold text-ink">Graded card</span>
                <span className="block text-xs text-slate-500">Slabbed by PSA, CGC, BGS and others</span>
              </span>
              <span className={cn('haven-switch', form.gradingCompany && 'haven-switch-on')}><span /></span>
            </button>

            {!!form.gradingCompany && (
              <div className="mt-3.5 space-y-3.5">
                <div className="haven-rule" />
                <div>
                  <label className="field-label">Grading Company</label>
                  <div className="grid grid-cols-4 gap-1.5">
                    {GRADER_CHOICES.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => {
                          // A grade, a 10's label or subgrades the new grader doesn't give are dropped
                          setForm((f) => {
                            const g = graderOf(c)
                            const keepGrade = !f.grade || isValidGrade(c, f.grade)
                            const tierOk = !!f.gradeTier && !!g?.tens.some((t) => t.tier === f.gradeTier)
                            return { ...f, gradingCompany: c, grade: keepGrade ? f.grade : '', gradeTier: tierOk ? f.gradeTier : undefined, subgrades: g?.subgrades ? f.subgrades : undefined }
                          })
                          if (gradeText && !isValidGrade(c, gradeText)) setGradeText('')
                        }}
                        className={cn('haven-chip h-9 text-xs font-semibold tracking-wide', form.gradingCompany === c && 'haven-chip-on')}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </div>
                {(() => {
                  const grader = graderOf(form.gradingCompany)
                  const quick = quickGradesFor(form.gradingCompany)
                  const invalid = !!form.grade && !isValidGrade(form.gradingCompany, form.grade)
                  const isTen = parseFloat(form.grade ?? '') >= 10
                  const pickTier = (tier: GradeTier | null) => setForm((f) => ({
                    ...f,
                    gradeTier: tier ?? undefined,
                    // A Black Label is all four subgrades at 10
                    ...(tier === 'black' && { subgrades: { centering: '10', corners: '10', edges: '10', surface: '10' } }),
                  }))
                  const setGrade = (g: string) => setForm((f) => ({
                    ...f, grade: g,
                    // a 10's label only applies to a 10; BGS 10 is Pristine unless it's a Black Label
                    gradeTier: parseFloat(g) >= 10 ? (f.gradeTier ?? ((f.gradingCompany ?? '').toUpperCase() === 'BGS' ? 'pristine' : undefined)) : undefined,
                  }))
                  return (
                    <>
                      <div>
                        <label className="field-label">Grade</label>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {quick.map((g) => (
                            <button key={g} type="button" onClick={() => { setGrade(g); setGradeText('') }} className={cn('haven-chip haven-grade', form.grade === g && !gradeText && 'haven-chip-on')}>
                              {g}
                            </button>
                          ))}
                          <input
                            type="text"
                            inputMode="decimal"
                            value={gradeText}
                            onChange={(e) => { setGradeText(e.target.value); setGrade(e.target.value.trim()) }}
                            placeholder="Other"
                            aria-label="Another grade"
                            className={cn('input-field !w-20 !py-1.5 text-center text-xs font-semibold', invalid && '!border-red-400')}
                          />
                        </div>
                        {invalid && grader && (
                          <p className="text-[11px] text-red-600 mt-1.5">
                            {grader.name} doesn&apos;t give a {form.grade}
                            {form.gradingCompany.toUpperCase() === 'PSA' || form.gradingCompany.toUpperCase() === 'TAG' ? ' — half grades only go up to 8.5, never 9.5' : ''}.
                          </p>
                        )}
                        {form.grade && !invalid && (
                          <p className="text-[11px] text-slate-500 mt-1.5 uppercase tracking-wide font-semibold">{gradeWord(form.gradingCompany, form.grade, form.gradeTier)}</p>
                        )}
                      </div>
                      {/* A 10's label: Beckett Pristine (gold) or Black Label; CGC / SGC / TAG Gem Mint or Pristine */}
                      {isTen && grader && grader.tens.length > 0 && (
                        <div>
                          <label className="field-label">Label</label>
                          <div className="flex gap-1.5">
                            {grader.tens.map((t) => {
                              const on = (form.gradeTier ?? null) === t.tier
                              return (
                                <button key={t.label} type="button" onClick={() => pickTier(t.tier)} className={cn('haven-chip h-9 px-4 text-xs font-semibold flex items-center gap-2', on && 'haven-chip-on')}>
                                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: t.tier === 'black' ? '#111' : t.tier === 'pristine' ? 'linear-gradient(135deg, #f0d993, #b8923e)' : '#d8dbe0', boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.25)' }} />
                                  {t.label}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )}
                      {/* Beckett prints four subgrades on its label */}
                      {grader?.subgrades && (
                        <div>
                          <label className="field-label">Subgrades <span className="text-slate-500 font-normal normal-case tracking-normal">· optional, as printed on the label</span></label>
                          <div className="grid grid-cols-4 gap-1.5">
                            {SUBGRADE_KEYS.map((k) => (
                              <label key={k} className="block">
                                <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1 text-center">{k}</span>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={form.subgrades?.[k] ?? ''}
                                  onChange={(e) => setForm((f) => {
                                    const subgrades: Subgrades = { ...(f.subgrades ?? {}), [k]: e.target.value.trim() }
                                    const allTens = SUBGRADE_KEYS.every((x) => subgrades[x] === '10')
                                    // Four 10s on a 10 is a Black Label; a Black Label with a lower subgrade isn't one
                                    const gradeTier = parseFloat(f.grade ?? '') >= 10 ? (allTens ? 'black' : f.gradeTier === 'black' ? 'pristine' : f.gradeTier) : f.gradeTier
                                    return { ...f, subgrades, gradeTier }
                                  })}
                                  placeholder="–"
                                  className="input-field !py-1.5 text-center text-sm font-semibold"
                                />
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                      <div>
                        <label className="field-label">
                          Slab ID <span className="text-slate-500 font-normal normal-case tracking-normal">· the cert number on the label{grader ? ` (${grader.cert.hint})` : ''}</span>
                        </label>
                        <div className="flex gap-1.5">
                          <input
                            type="text"
                            inputMode={grader && !grader.cert.numeric ? 'text' : 'numeric'}
                            value={form.certNumber ?? ''}
                            onChange={(e) => setField('certNumber', e.target.value.replace(/\s+/g, '').toUpperCase())}
                            placeholder={form.gradingCompany.toUpperCase() === 'TAG' ? 'e.g. A1234567' : 'e.g. 81234567'}
                            className="input-field font-mono tracking-wider"
                          />
                          {grader && (grader.cert.lookup || grader.cert.lookupPage) && (
                            <a
                              href={form.certNumber && grader.cert.lookup ? grader.cert.lookup(form.certNumber) : grader.cert.lookupPage ?? (grader.cert.lookup ? grader.cert.lookup('') : '#')}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={cn('haven-chip shrink-0 px-3 flex items-center gap-1.5 text-xs font-semibold', !form.certNumber && 'opacity-60')}
                              title={`Look this slab up on ${grader.name}'s site`}
                            >
                              Verify <ExternalLink size={12} />
                            </a>
                          )}
                        </div>
                      </div>
                    </>
                  )
                })()}
                {/* The label it will carry, in the app's own colours */}
                {(() => {
                  const word = form.grade ? gradeWord(form.gradingCompany, form.grade, form.gradeTier) : ''
                  return (
                    <div className="haven-label">
                      <div className="flex-1 min-w-0">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 truncate">{form.set || 'Set'}</div>
                        <div className="text-[13px] font-bold uppercase tracking-wide text-ink leading-tight truncate">{form.name || 'Card name'}</div>
                        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 mt-0.5 truncate">{form.gradingCompany}{form.gradeTier === 'black' ? ' · Black Label' : ''}{form.number ? ` · #${form.number}` : ''}{form.certNumber ? ` · ${form.certNumber}` : ''}</div>
                      </div>
                      <div className="text-right shrink-0 pl-3 border-l border-slate-700/60">
                        {word && <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 leading-none">{word}</div>}
                        <div className="text-[26px] font-bold text-ink leading-none mt-1 tabular-nums">{form.grade || '—'}</div>
                      </div>
                    </div>
                  )
                })()}
              </div>
            )}
          </div>

          {/* Card preview */}
          {form.imageUrl && (
            <div className="xl:hidden flex items-center gap-3 p-3 bg-slate-900 rounded-xl border border-slate-800">
              <img src={cardImage(form.imageUrl, 'thumb')} alt={form.name} className="w-12 h-16 object-contain rounded" />
              <div>
                <div className="text-sm font-medium text-ink"><CardName name={form.name} /></div>
                <div className="text-xs text-slate-500">{form.set}{form.number ? ` · #${form.number}` : ''}</div>
                {form.game === 'riftbound' && form.nexus && (
                  <span className="mt-1 inline-block text-[10px] font-bold uppercase text-blue-600 border border-blue-300 rounded px-1 py-0.5">Nexus</span>
                )}
                {hasPrintings(form.game) && (japanese || (variantPrices && (form.edition !== 'unlimited' || form.finish === 'reverse'))) && (
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

      {/* Wide screens: the chosen card on display beside the form — a framed stand with the card
          (in its slab when it's graded) and a brass nameplate */}
      {form.imageUrl && (
      <aside key={form.imageUrl} className="card-stage-wrap hidden xl:block absolute left-full top-1/2 ml-7 w-[290px]">
        <div className="showcase-frame">
          <div className="showcase-inner px-5 pt-4 pb-5 flex flex-col items-center gap-4">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: GAME_COLORS[form.game] }} />
              {GAME_LABELS[form.game]}{japanese ? ' · Japanese' : ''}
            </div>
            <div className="w-full flex justify-center" style={{ perspective: '900px' }}>
              {form.imageUrl && form.gradingCompany ? (
                <div className="w-full" style={{ aspectRatio: '0.66' }}>
                  <FullSlab slab={{ company: form.gradingCompany, grade: form.grade ?? '', cert: form.certNumber, tier: form.gradeTier ?? null, subgrades: form.subgrades, printing: printingText(form) || undefined }} name={form.name} number={form.number} setName={form.set} variety={form.rarity}>
                    {artLandscape ? (
                      // Turned on its side to fill the portrait window, like a real slab holds it
                      <img src={cardImage(form.imageUrl, 'grid')} alt={form.name} onLoad={noteArt}
                        className="absolute top-1/2 left-1/2 max-w-none object-cover rotate-90"
                        style={{ width: '140%', height: '71.43%', translate: '-50% -50%' }} />
                    ) : (
                      <img src={cardImage(form.imageUrl, 'grid')} alt={form.name} onLoad={noteArt} className="w-full h-full object-cover" />
                    )}
                  </FullSlab>
                </div>
              ) : (
                <div className="card-stage-card w-[88%]">
                  <img src={cardImage(form.imageUrl, 'grid')} alt={form.name} onLoad={noteArt} className="w-full rounded-[4.5%] block" />
                  <span className="card-stage-sheen" />
                </div>
              )}
            </div>
            <div className="haven-plate w-full text-center">
              {/* The name with its printing (Charizard - Reverse Holo) and that printing's price */}
              <div className="text-[13px] font-semibold text-ink leading-snug line-clamp-2"><CardName name={nameWithPrinting(form.name, form)} /></div>
              <div className="text-[11px] text-slate-500 mt-0.5 truncate">{[form.set, form.number && `#${form.number}`].filter(Boolean).join(' · ')}</div>
              {catalogMarketPrice() > 0 && (
                <div className="mt-1 text-sm font-semibold text-emerald-600">${catalogMarketPrice().toFixed(2)}</div>
              )}
            </div>
          </div>
        </div>
      </aside>
      )}
      </div>
    </div>
  )
}
