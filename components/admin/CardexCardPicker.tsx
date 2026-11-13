'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import dynamic from 'next/dynamic'
import { X, Loader2, Search, Eye } from 'lucide-react'
import { cardImage } from '@/lib/cardImage'
import { cn, zoomGlowColor } from '@/lib/utils'
import { GAME_COLORS, GAME_LABELS } from '@/lib/types'
import type { CardSearchResult } from '@/lib/api/search'
import { RARITY_LABELS_BY_GAME } from '@/lib/utils'
import type { BadgeSlot, SlotCard } from '@/lib/badges'
import type { Game } from '@/lib/types'
import { CardZoomOverlay, RARITY_COLORS, type CatalogCard, type ZoomCardData } from '@/components/pages/CardexPage'

// "Pick from the Cardex" in the badge editor: the real Cardex (same sets, groups, rarity filters
// and search), every card in full colour. Click a card to select it, Shift+Click to select
// everything between it and the last one clicked; pick across as many sets as you like. "Add"
// makes one slot per picked card — plus, for each, the other printings of the same card (same set
// and number) whose rarities you tick (e.g. its Signature), which count for that slot too.

const CardexPage = dynamic(() => import('@/components/pages/CardexPage'), { ssr: false })

export interface CatalogRow {
  id: string
  name: string
  number: string
  setName: string
  rarity?: string
  imageUrl?: string
  isHidden?: boolean
}

export const rarityLabel = (game: Game, r?: string) => (r ? RARITY_LABELS_BY_GAME[game]?.[r] ?? r : 'No rarity')
const toSlotCard = (c: { id: string; name: string; setName: string; number: string; imageUrl?: string }): SlotCard =>
  ({ id: c.id, name: c.name, setName: c.setName, number: c.number, imageUrl: c.imageUrl })
// A slot is named after the card (Riftbound names its Signatures "X (Signature)")
const slotLabel = (name: string) => name.replace(/\s*\((Signature|Alt Art|Overnumbered)\)\s*$/i, '').trim()

/** The other printings of a card: same set, same collector number, different card. */
export function siblingsOf(card: { id: string; number?: string }, setCards: CatalogRow[]): CatalogRow[] {
  return setCards.filter((c) => c.number === card.number && c.id !== card.id)
}

const setCache = new Map<string, Promise<CatalogRow[]>>()
export function fetchSetCards(game: Game, setName: string): Promise<CatalogRow[]> {
  const key = `${game}|${setName}`
  if (!setCache.has(key)) {
    setCache.set(key, fetch(`/api/admin/catalog?game=${game}&set=${encodeURIComponent(setName)}`)
      .then((r) => r.json())
      .then((rows: CatalogRow[]) => (Array.isArray(rows) ? rows.filter((c) => !c.isHidden) : []))
      .catch(() => { setCache.delete(key); return [] }))
  }
  return setCache.get(key)!
}

export default function CardexCardPicker({ game, games, onAdd, onClose, title, addLabel, layer = 80 }: {
  game: Game
  games?: Game[]                        // switchable games (the Creator Studio: all of them); slots then carry `game`
  onAdd: (slots: BadgeSlot[]) => void
  onClose: () => void
  title?: string                        // e.g. adding to one slot: 'Add cards to "Lee Sin"'
  addLabel?: (n: number) => string
  layer?: number                        // its z-index — raised when it opens over another popup (the Creator Wall's note editor)
}) {
  const [picked, setPicked] = useState<Map<string, CatalogCard>>(new Map())
  const gameOf = useRef(new Map<string, Game>()) // each picked card's game (the picker can switch games)
  // The search at the top: the whole game that's showing, every set (the Cardex's own search box
  // only searches the set on screen)
  const [shown, setShown] = useState<Game>(game)
  const onGame = useCallback((g: Game) => setShown(g), [])
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<CatalogCard[]>([])
  const [searching, setSearching] = useState(false)
  const [zoom, setZoom] = useState<ZoomCardData | null>(null)
  useEffect(() => {
    const query = q.trim()
    if (query.length < 2) { setHits([]); return }
    const t = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`/api/cards/search?${new URLSearchParams({ game: shown, q: query })}`)
        const rows = res.ok ? ((await res.json()) as CardSearchResult[]) : []
        const seen = new Set<string>()
        setHits(rows.filter((r) => !seen.has(r.id) && seen.add(r.id)).slice(0, 60).map((r) => ({
          id: r.id, name: r.name, number: r.number, setCode: r.set, setName: r.setName, rarity: r.rarity ?? '',
          imageUrl: r.imageUrl, marketPrice: r.marketPrice, marketPriceFoil: r.marketPriceFoil,
        }) as CatalogCard))
      } finally { setSearching(false) }
    }, 300)
    return () => clearTimeout(t)
  }, [q, shown])
  const look = (el: HTMLElement, c: CatalogCard) => setZoom({
    imageUrl: c.imageUrl, name: c.name, number: c.number, setName: c.setName,
    rarityLabel: (c.rarity ? rarityLabel(shown, c.rarity) : '').replace('_', ' '), rarityColor: RARITY_COLORS[c.rarity] ?? '#7a6a55',
    marketPrice: c.marketPrice, owned: false, quantity: 0, glowColor: zoomGlowColor(shown, c.rarity, GAME_COLORS[shown]),
    originRect: el.getBoundingClientRect(),
  } as ZoomCardData)
  const [setRows, setSetRows] = useState<Record<string, CatalogRow[]>>({})
  const [alsoCount, setAlsoCount] = useState<Set<string>>(new Set(['Star']))
  const selected = useMemo(() => new Set(picked.keys()), [picked])

  // Escape closes just the picker
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  // Load the sets the picked cards come from, to know their other printings
  const setKey = (c: CatalogCard) => `${gameOf.current.get(c.id) ?? game}|${c.setName}`
  const pickedSets = useMemo(() => Array.from(new Set(Array.from(picked.values()).map(setKey))), [picked]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    for (const key of pickedSets) {
      if (setRows[key]) continue
      const [g, s] = key.split('|') as [Game, string]
      fetchSetCards(g, s).then((rows) => setSetRows((r) => ({ ...r, [key]: rows })))
    }
  }, [pickedSets, setRows])

  const siblingRarities = useMemo(() => {
    const out = new Set<string>()
    picked.forEach((c) => { for (const s of siblingsOf(c, setRows[setKey(c)] ?? [])) if (!picked.has(s.id)) out.add(s.rarity ?? '') })
    return Array.from(out)
  }, [picked, setRows]) // eslint-disable-line react-hooks/exhaustive-deps

  function select(cards: CatalogCard[], on: boolean, from: Game) {
    for (const c of cards) gameOf.current.set(c.id, from)
    setPicked((m) => {
      const next = new Map(m)
      for (const c of cards) { if (on) next.set(c.id, c); else next.delete(c.id) }
      return next
    })
  }

  function add() {
    const slots: BadgeSlot[] = Array.from(picked.values()).map((c) => {
      const extra = siblingsOf(c, setRows[setKey(c)] ?? []).filter((s) => !picked.has(s.id) && alsoCount.has(s.rarity ?? ''))
      const all = [toSlotCard(c), ...extra.map(toSlotCard)]
      const slot = { label: slotLabel(c.name), cardIds: all.map((x) => x.id), cards: all }
      return games ? ({ ...slot, game: gameOf.current.get(c.id) ?? game } as BadgeSlot) : slot
    })
    onAdd(slots)
    onClose()
  }

  const loadingSiblings = pickedSets.some((s) => !setRows[s])
  const toggle = (r: string) => setAlsoCount((s) => { const n = new Set(s); if (n.has(r)) n.delete(r); else n.add(r); return n })

  return createPortal(
    <div className="fixed inset-0 flex flex-col bg-slate-950" style={{ zIndex: layer }} role="dialog" aria-label="Pick cards from the Cardex">
      <div className="flex flex-wrap sm:flex-nowrap items-center gap-3 px-5 py-3 border-b border-slate-800">
        <div>
          <div className="text-base font-bold text-ink">{title ?? 'Pick cards from the Cardex'}</div>
          <div className="text-xs text-slate-500">Click to select · Shift+Click to select a range · pick from as many sets as you like</div>
        </div>
        {/* Search the whole game, every set */}
        <div className="relative ml-auto w-full max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          <input className="input-field !pl-9 !pr-9 text-sm" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={`Search all of ${GAME_LABELS[shown] ?? 'this game'} — every set`} />
          {searching
            ? <Loader2 size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 animate-spin" />
            : q && <button onClick={() => setQ('')} aria-label="Clear the search" className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full text-slate-500 hover:text-ink"><X size={14} /></button>}
        </div>
        <button onClick={onClose} aria-label="Close" className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg text-slate-500 hover:text-ink hover:bg-slate-800"><X size={18} /></button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
        {/* While searching: the whole game's matches (the Cardex stays underneath, as it was) */}
        {q.trim().length >= 2 && (
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <p className="text-sm font-bold text-ink">{searching ? 'Searching…' : `${hits.length}${hits.length === 60 ? '+' : ''} ${GAME_LABELS[shown] ?? ''} cards match “${q.trim()}”`}</p>
              <button onClick={() => setQ('')} className="ml-auto text-xs font-semibold text-slate-500 hover:text-ink">Back to the sets</button>
            </div>
            {!searching && hits.length === 0 && <p className="text-sm text-slate-500 py-6 text-center">No cards match — try fewer words, or a name and number</p>}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-3">
              {hits.map((c) => {
                const on = picked.has(c.id)
                return (
                  <button key={c.id} type="button" onClick={() => select([c], !on, shown)} className="group relative text-left">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={cardImage(c.imageUrl, 'grid') ?? c.imageUrl} alt={c.name} loading="lazy"
                      className={cn('w-full aspect-[5/7] object-cover rounded-lg transition-shadow', on ? 'outline outline-[3px] outline-violet-600' : 'opacity-90 hover:opacity-100')} />
                    {on && <span className="absolute top-1 right-1 w-5 h-5 rounded-full bg-violet-600 text-white flex items-center justify-center text-[10px] font-black shadow">✓</span>}
                    <span role="button" tabIndex={0} aria-label={`Look at ${c.name}`} title="Look at the card"
                      onClick={(e) => { e.stopPropagation(); look(e.currentTarget.parentElement!, c) }}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); look(e.currentTarget.parentElement!, c) } }}
                      className="absolute top-1 left-1 w-6 h-6 rounded-full bg-black/55 text-white flex items-center justify-center shadow hover:bg-black/80"><Eye size={13} /></span>
                    <p className="text-[11px] font-semibold text-ink truncate mt-1">{c.name}</p>
                    <p className="text-[10px] text-slate-500 truncate">{c.setName}{c.number ? ` · #${c.number}` : ''}</p>
                  </button>
                )
              })}
            </div>
          </div>
        )}
        <div className={cn(q.trim().length >= 2 && 'hidden')}>
          <CardexPage picker={{ game, games, selected, onSelect: select, onGame }} />
        </div>
      </div>

      <div className="border-t border-slate-800 bg-slate-950 px-5 py-3 flex flex-wrap items-center gap-3">
        <span className="text-sm font-bold text-ink">{picked.size} picked</span>
        {picked.size > 0 && <button className="text-xs font-semibold text-slate-500 hover:text-ink" onClick={() => setPicked(new Map())}>Clear</button>}
        {(siblingRarities.length > 0 || loadingSiblings) && picked.size > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
            <span>Also counts:</span>
            {loadingSiblings && <Loader2 size={12} className="animate-spin" />}
            {siblingRarities.map((r) => (
              <label key={r} className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-slate-700 text-ink cursor-pointer">
                <input type="checkbox" checked={alsoCount.has(r)} onChange={() => toggle(r)} />
                {rarityLabel(game, r)}
              </label>
            ))}
          </div>
        )}
        <div className="ml-auto flex gap-2">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={add} disabled={!picked.size} className="btn-primary disabled:opacity-50">
            {addLabel ? addLabel(picked.size) : `Add ${picked.size || ''} slot${picked.size === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
      <CardZoomOverlay data={zoom} onClose={() => setZoom(null)} viewOnly />
    </div>,
    document.body,
  )
}
