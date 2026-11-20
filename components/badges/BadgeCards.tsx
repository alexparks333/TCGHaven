'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import dynamic from 'next/dynamic'
import { Check, X } from 'lucide-react'
import { cn, zoomGlowColor, openEbaySearch, RARITY_LABELS_BY_GAME } from '@/lib/utils'
import { GAME_COLORS, type Game } from '@/lib/types'
import { useStore } from '@/lib/store'
import { cardImage, NO_CARD_IMAGE } from '@/lib/cardImage'
import { useScrollLock } from '@/lib/useScrollLock'
import { ownedCatalogIds, type BadgeDef, type SlotCard } from '@/lib/badges'
import { CardName } from '@/components/CardName'

// A badge's cards: every card it asks for, Cardex-style — in colour if you own it, greyed out if
// not. Opened from the card-and-i button on a badge (BadgeBook.tsx BadgeSpot), anywhere a badge
// is drawn: the pin books (upright and sideways) and a profile's showcase.
//
// Each slot is filled by owning ANY of its cards (lib/badges.ts BadgeSlot), so a slot shows one
// card: the one you own if you own a version, else its first. Card details come from the slot
// (saved when staff picked the cards); a slot without them is looked up in the catalog
// (/api/cardex?ids=). Someone else's badge shows what it needs, not what they own — only their
// counts are shared (lib/firebase/badges.ts SharedBadges).

type Filter = 'all' | 'missing' | 'have'

// A card as the catalog has it (all of a badge's cards are looked up: the zoom view wants rarity and
// price, which aren't saved with the slots)
interface CatalogRow extends SlotCard { rarity?: string; marketPrice?: number; marketPriceFoil?: number; setCode?: string; cardType?: string }

// Add Card (Shift+click a card, as in the Cardex) — loaded only when used
const AddCardDialog = dynamic(() => import('@/components/inventory/AddCardDialog').then((m) => m.AddCardDialog), { ssr: false })

// The Cardex's own zoom view — fly out, flip, drag to turn — for a tapped card. Loaded only when a
// card is tapped (it lives in the Cardex page's code, too big to load with every badge).
// versions: the slot's cards, first added first — more than one and the zoom view gets a bubble per
// version (the Cardex's version bubbles), swapping the card shown; ownedQty: how many of each you have
// wide: a landscape card (a Riftbound Battlefield) — the zoom view draws it sideways, as the Cardex does
type ZoomProps = { versions: CatalogRow[]; ownedQty: Record<string, number>; game: Game; from: DOMRect; wide: boolean; onClose: () => void }
const CardZoom = dynamic<ZoomProps>(() => import('@/components/pages/CardexPage').then((m) => {
  function BadgeCardZoom({ versions, ownedQty, game, from, wide, onClose }: ZoomProps) {
    const data = useMemo(() => {
      const look = (c: CatalogRow) => {
        const rarity = c.rarity ?? ''
        return {
          rarity,
          rarityLabel: (rarity ? RARITY_LABELS_BY_GAME[game]?.[rarity] ?? rarity : '').replace('_', ' '),
          rarityColor: m.RARITY_COLORS[rarity] ?? '#7a6a55',
        }
      }
      const front = versions[0]
      const fl = look(front)
      // A bubble per version, named by its rarity ("Overnumbered", "Signature") — or its number when
      // two share a rarity
      const labels = versions.map((c) => look(c).rarityLabel || `#${c.number ?? ''}`)
      const clash = new Set(labels).size < labels.length
      const zoomVersions = versions.length > 1 ? versions.map((c, i) => {
        const l = look(c)
        return {
          label: clash ? `#${c.number ?? ''}` : labels[i],
          quantity: ownedQty[c.id] ?? 0,
          marketPrice: c.marketPrice ?? 0,
          card: { imageUrl: c.imageUrl ?? '', name: c.name, number: c.number ?? '', setName: c.setName, rarityLabel: l.rarityLabel, rarityColor: l.rarityColor, owned: (ownedQty[c.id] ?? 0) > 0 },
        }
      }) : undefined
      return {
        imageUrl: front.imageUrl ?? '', name: front.name, number: front.number ?? '', setName: front.setName,
        rarityLabel: fl.rarityLabel, rarityColor: fl.rarityColor,
        marketPrice: front.marketPrice ?? 0, owned: (ownedQty[front.id] ?? 0) > 0, quantity: ownedQty[front.id] ?? 0,
        glowColor: zoomGlowColor(game, fl.rarity, GAME_COLORS[game]),
        originRect: from,
        landscape: wide,
        versions: zoomVersions,
        // for its "Search Recently Sold Listings" link (lib/utils.ts ebaySearchUrl)
        ebayCard: { name: front.name, number: front.number ?? '', set: front.setName ?? '', game },
      } as import('@/components/pages/CardexPage').ZoomCardData
    }, [versions, ownedQty, game, from, wide])
    return <m.CardZoomOverlay data={data} onClose={onClose} viewOnly soldLink />
  }
  return BadgeCardZoom
}), { ssr: false })

// A landscape card: a Battlefield, or (as the Cardex checks) a picture wider than tall — the tile's
// showing picture, measured
function isWide(tile: HTMLElement, card?: CatalogRow): boolean {
  if (!card) return false
  if (card.cardType === 'Battlefield') return true
  const img = tile.querySelector<HTMLImageElement>(`img[data-card="${CSS.escape(card.id)}"]`)
  return !!img && img.naturalWidth > img.naturalHeight
}

// Auto-flip: a slot with several versions crossfades from one to the next every few seconds, first
// added first — only among the ones you own, if you own any (one owned: it stays on it) (a still picture of one version — sometimes the Signature — read as "you need that
// one"; a fanned stack didn't land — 2026-11-20)
const FLIP_MS = 2800
// Card ids per lookup (/api/cardex?ids= takes up to 400; 150 keeps even Magic's long ids well
// within a URL's length)
const IDS_PER_REQUEST = 150

// Open lists, counted: the books' own keys (arrows turn pages, Escape shuts the book) listen on the
// window, where this list's React-level stops can't reach — they check this instead and leave the
// keys to the list while one is open (2026-11-20: Escape closed the list AND the book behind it)
let openLists = 0
export const badgeCardsOpen = () => openLists > 0

// nameHidden: the badge isn't unlocked yet (no Grayscale or Full look) — its name stays "? ? ?", as
// on its nameplate in the book; what it asks for (the description, the cards) still shows
export function BadgeCards({ def, isMe, nameHidden = false, onClose }: { def: BadgeDef; isMe: boolean; nameHidden?: boolean; onClose: () => void }) {
  useScrollLock(true)
  useEffect(() => { openLists++; return () => { openLists-- } }, [])
  // Esc: a card open in the zoom view closes first (it listens for Esc itself), then the list
  const zoomOpen = useRef(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !zoomOpen.current) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const cards = useStore((s) => s.cards)
  const owned = useMemo(() => (isMe ? ownedCatalogIds(cards) : new Set<string>()), [isMe, cards])

  // What's known about each card: saved with the slots, plus any looked up
  const saved = useMemo(() => {
    const m = new Map<string, SlotCard>()
    for (const s of def.slots) for (const c of s.cards ?? []) if (c.imageUrl) m.set(c.id, c)
    return m
  }, [def])
  const [looked, setLooked] = useState<Map<string, CatalogRow>>(new Map())
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    const ids = Array.from(new Set(def.slots.flatMap((s) => s.cardIds)))
    if (!ids.length) return
    let live = true
    setLoading(true)
    // In batches: a big badge's ids in one address (Magic's are 36 characters each) ran past what a
    // URL may hold, and the route takes at most 400 at a time
    const batches: string[][] = []
    for (let i = 0; i < ids.length; i += IDS_PER_REQUEST) batches.push(ids.slice(i, i + IDS_PER_REQUEST))
    Promise.all(batches.map((batch) =>
      fetch(`/api/cardex?game=${encodeURIComponent(def.game)}&ids=${encodeURIComponent(batch.join(','))}`)
        .then((r) => (r.ok ? r.json() as Promise<CatalogRow[]> : []))
        .catch(() => [] as CatalogRow[])))
      .then((parts) => parts.flat())
      .then((rows: CatalogRow[]) => {
        if (!live) return
        setLooked(new Map(rows.map((c) => [c.id, { id: c.id, name: c.name, setName: c.setName, number: c.number, imageUrl: c.imageUrl, rarity: c.rarity, marketPrice: c.marketPrice, marketPriceFoil: c.marketPriceFoil, setCode: c.setCode, cardType: c.cardType }])))
      })
      .catch(() => {})
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [def])

  // How many of each card you have (for the zoom view's "owned")
  const ownedQty = useMemo(() => {
    const q: Record<string, number> = {}
    if (isMe) for (const c of cards) if (c.apiId) q[c.apiId] = (q[c.apiId] ?? 0) + (c.quantity ?? 1)
    return q
  }, [isMe, cards])
  // A slot's versions, in the order they were added (any one fills it) — first added shows first
  const slots = useMemo(() => def.slots.map((slot, i) => {
    const have = slot.cardIds.some((id) => owned.has(id))
    // the catalog's copy first (it has rarity and price), what the slot saved if the catalog lacks it
    const of = (id: string): CatalogRow | undefined => looked.get(id) ?? saved.get(id)
    const versions = slot.cardIds.map(of).filter((c): c is CatalogRow => !!c)
    // What the tile flips through: the versions you own if any (one owned = it stays on that one —
    // a Signature you don't have flashing up read as yours, 2026-11-20), else every version
    const mine = versions.filter((c) => owned.has(c.id))
    const cycle = mine.length ? mine : versions
    return { key: `${i}`, label: slot.label, versions, cycle, have }
  }), [def, owned, saved, looked])

  // The flip clock — only while some slot has versions to flip through, and paused while the zoom
  // view or Add Card covers the list (off for reduced motion: each slot shows its first version)
  const [tick, setTick] = useState(0)
  const anyFlips = slots.some((s) => s.cycle.length > 1)
  const [covered, setCovered] = useState(false)
  useEffect(() => {
    if (!anyFlips || covered || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const t = setInterval(() => setTick((n) => n + 1), FLIP_MS)
    return () => clearInterval(t)
  }, [anyFlips, covered])

  const haveCount = slots.filter((s) => s.have).length
  const [filter, setFilter] = useState<Filter>('all')
  const shown = slots.filter((s) => filter === 'all' || (filter === 'have' ? s.have : !s.have))
  // The tapped card, in the Cardex's zoom view (over this list)
  const [zoom, setZoom] = useState<{ versions: CatalogRow[]; from: DOMRect; wide: boolean } | null>(null)
  // Shift+click (your own badges): Add Card, on the version the tile is showing — as in the Cardex
  const [adding, setAdding] = useState<CatalogRow | null>(null)
  zoomOpen.current = zoom !== null || adding !== null
  useEffect(() => { setCovered(zoom !== null || adding !== null) }, [zoom, adding])

  // Drawn over the page (a portal), but in React it still sits inside the badge — its clicks, drags
  // and swipes would reach the badge (opening the 3D view) and the phone book (turning the page as
  // you scroll the list). They stop here.
  const stop = (e: React.SyntheticEvent) => e.stopPropagation()
  return createPortal(
    <div
      className="fixed inset-0 z-[95] flex items-end sm:items-center justify-center sm:p-6"
      role="dialog"
      aria-label={`${nameHidden ? 'A locked badge' : def.name} — its cards`}
      onClick={stop} onPointerDown={stop} onPointerMove={stop} onPointerEnter={stop} onPointerLeave={stop}
      onTouchStart={stop} onTouchMove={stop} onTouchEnd={stop} onKeyDown={stop} onWheel={stop}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative w-full sm:max-w-3xl max-h-[88dvh] sm:max-h-[85dvh] flex flex-col bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden">
        {/* Header: the badge, your count, the filter */}
        <div className="shrink-0 px-5 pt-4 pb-3 border-b border-slate-800">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className={cn('text-lg font-bold leading-tight truncate', nameHidden ? 'text-slate-500 tracking-[0.2em]' : 'text-ink')}>{nameHidden ? '? ? ?' : def.name}</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {isMe ? <><span className="font-semibold text-ink tabular-nums">{haveCount} / {slots.length}</span> {def.slotNoun} collected</> : <>{slots.length} {def.slotNoun} to collect</>}
              </p>
            </div>
            <button onClick={onClose} aria-label="Close" className="shrink-0 -mr-1.5 w-9 h-9 flex items-center justify-center rounded-lg text-slate-500 hover:text-ink hover:bg-slate-800 transition-colors">
              <X size={18} />
            </button>
          </div>
          {def.description && <p className="text-xs text-slate-400 mt-2 leading-snug">{def.description}</p>}
          {isMe && (
            <div className="mt-3 flex items-center gap-3">
              <div className="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                <div className="h-full rounded-full bg-emerald-600 transition-all" style={{ width: `${slots.length ? (haveCount / slots.length) * 100 : 0}%` }} />
              </div>
              <div role="radiogroup" aria-label="Show" className="shrink-0 flex items-center rounded-full border border-slate-700 bg-slate-950/40 p-0.5">
                {([['all', 'All'], ['missing', 'Missing'], ['have', 'Have']] as const).map(([v, label]) => (
                  <button
                    key={v}
                    role="radio"
                    aria-checked={filter === v}
                    onClick={() => setFilter(v)}
                    className={cn('text-xs font-medium px-2.5 py-1 rounded-full transition-colors', filter === v ? 'bg-slate-800 text-ink' : 'text-slate-500 hover:text-ink')}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {!isMe && <p className="text-[0.6875rem] text-slate-500 mt-2">Which ones they have isn&rsquo;t shared — just how many.</p>}
        </div>

        {/* The cards */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 py-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          {slots.length === 0 ? (
            <p className="text-center text-sm text-slate-500 py-10">This badge has no cards yet.</p>
          ) : shown.length === 0 ? (
            <p className="text-center text-sm text-slate-500 py-10">{filter === 'have' ? 'None collected yet.' : 'You have every card — nothing missing.'}</p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 phoneland:grid-cols-6 gap-3">
              {shown.map((s) => {
                const lit = !isMe || s.have
                const current = s.cycle.length ? s.cycle[s.cycle.length > 1 ? tick % s.cycle.length : 0] : undefined
                const shownAt = current ? s.versions.indexOf(current) : 0
                const shown = s.versions[shownAt]
                // the zoom view opens on a version you own (yours first), the rest after in their order
                const forZoom = s.cycle.length && s.cycle !== s.versions ? [...s.cycle, ...s.versions.filter((v) => !s.cycle.includes(v))] : s.versions
                return (
                  <div key={s.key} className="min-w-0">
                    {/* The tile: each version's picture stacked, the one showing faded in (auto-flip) */}
                    <div
                      role={s.versions.length ? 'button' : undefined}
                      tabIndex={s.versions.length ? 0 : undefined}
                      aria-label={s.versions.length ? `Look at ${s.versions[0].name}` : undefined}
                      onClick={(e) => {
                        if (!shown) return
                        // the Cardex's tile shortcuts (CLAUDE.md quirk 26): ⌘/Ctrl = eBay sold listings, Shift = add it
                        if (e.metaKey || e.ctrlKey) { openEbaySearch({ name: shown.name, number: shown.number ?? '', set: shown.setName ?? '', game: def.game }); return }
                        if (e.shiftKey && isMe) { setAdding(shown); return }
                        setZoom({ versions: forZoom, from: e.currentTarget.getBoundingClientRect(), wide: isWide(e.currentTarget, shown) })
                      }}
                      title={isMe ? 'Click to view — Shift+Click to add to inventory — ⌘/Ctrl+Click to search eBay sold listings' : 'Click to view — ⌘/Ctrl+Click to search eBay sold listings'}
                      onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && s.versions.length) { e.preventDefault(); setZoom({ versions: forZoom, from: e.currentTarget.getBoundingClientRect(), wide: isWide(e.currentTarget, shown) }) } }}
                      className={cn('relative w-full rounded-lg overflow-hidden', s.versions.length > 0 && 'cursor-pointer transition-transform hover:scale-[1.03]')}
                      style={{
                        aspectRatio: '5 / 7',
                        // Cardex look: yours in colour, the rest greyed and faded
                        filter: lit ? 'none' : 'grayscale(1)',
                        opacity: lit ? 1 : 0.35,
                        outline: isMe && s.have ? '2px solid #4f7a2a80' : '1px solid #d6c49f',
                      }}
                    >
                      {s.versions.length === 0 ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={NO_CARD_IMAGE} alt={s.label} className="w-full h-full object-cover" />
                      ) : s.versions.map((v, vi) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={v.id}
                          data-card={v.id}
                          src={cardImage(v.imageUrl, 'grid') ?? NO_CARD_IMAGE}
                          alt={vi === shownAt ? v.name : ''}
                          aria-hidden={vi !== shownAt}
                          loading="lazy"
                          className="absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ease-in-out"
                          style={{ opacity: vi === shownAt ? 1 : 0 }}
                        />
                      ))}
                      {s.versions.length === 0 && loading && <div className="absolute inset-0 animate-pulse bg-slate-800/60" />}
                      {s.versions.length > 1 && (
                        <span
                          title="Owning any one of its versions counts"
                          className="absolute top-1 left-1 rounded-full bg-black/65 text-white text-[0.5625rem] font-bold px-1.5 py-0.5 leading-none shadow"
                        >
                          {s.versions.length} versions
                        </span>
                      )}
                    </div>
                    {/* which version is showing — only while it's flipping */}
                    {s.cycle.length > 1 && (
                      <div className="flex justify-center gap-1 mt-1.5" aria-hidden>
                        {s.cycle.map((v) => (
                          <span key={v.id} className={cn('h-1.5 rounded-full transition-all duration-500', v === current ? 'w-3.5 bg-slate-500' : 'w-1.5 bg-slate-700')} />
                        ))}
                      </div>
                    )}
                    {isMe && s.have && (
                      <div className="-mt-3 ml-auto mr-1 relative w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center shadow ring-2 ring-slate-900" aria-label="You have it">
                        <Check size={12} strokeWidth={3} />
                      </div>
                    )}
                    <div className={cn('text-[0.6875rem] font-semibold leading-tight truncate', isMe && s.have ? 'text-ink mt-0.5' : 'text-slate-400 mt-1.5')} title={shown?.name ?? s.label}>
                      <CardName name={s.label || shown?.name || ''} />
                    </div>
                    <div className="text-[0.625rem] text-slate-500 truncate">
                      {shown?.setName ?? ''}{shown?.number ? ` · #${shown.number}` : ''}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
      {/* The tapped card, flying out of its spot (Cardex style), over the list */}
      {zoom && (
        <div className="relative z-[96]">
          <CardZoom versions={zoom.versions} ownedQty={ownedQty} game={def.game} from={zoom.from} wide={zoom.wide} onClose={() => setZoom(null)} />
        </div>
      )}
      {/* Add Card on a Shift+clicked card (over this list) */}
      {adding && (
        <div className="relative z-[97]">
          <AddCardDialog
            key={adding.id}
            defaultGame={def.game}
            prefill={{
              id: adding.id, name: adding.name, set: adding.setCode ?? '', setName: adding.setName ?? '', number: adding.number ?? '',
              imageUrl: adding.imageUrl ?? '', marketPrice: adding.marketPrice ?? 0, marketPriceFoil: adding.marketPriceFoil ?? 0,
              isFoil: false, game: def.game, rarity: adding.rarity || undefined,
            }}
            onClose={() => setAdding(null)}
          />
        </div>
      )}
    </div>,
    document.body,
  )
}

/** The button on a badge that opens its cards: a small card with an "i" on it */
export function BadgeCardsIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="5" y="2.5" width="14" height="19" rx="2.5" fill="#f3e9d3" stroke="#5c4630" strokeWidth="1.6" />
      <circle cx="12" cy="8" r="1.25" fill="#5c4630" />
      <path d="M12 11v6" stroke="#5c4630" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}
