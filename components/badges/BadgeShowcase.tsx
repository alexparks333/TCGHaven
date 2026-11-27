'use client'

import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { PinInspector } from './pinInspectorLoader'
import { Plus, X, Box, Trash2, Search, Sparkles, Crown } from 'lucide-react'
import { usePremiumAccess } from '@/components/premium/PremiumProvider'
import { cn } from '@/lib/utils'
import { badgeTier, pinSize, type BadgeDef } from '@/lib/badges'
import { useBadgeCatalog } from '@/lib/badgeCatalog'
import type { SharedBadges } from '@/lib/firebase/badges'
import { BadgeSpot, PinholeFilter } from './BadgeBook'
import { BadgePin } from './BadgePin'


// A profile's pin display: a collector's display case — a walnut frame, the pin book's velvet sunk
// into it under a sheet of glass, an engraved brass plaque with the owner's name, each pin in its own
// pool of light. The owner fills its places with the earned pins they want to show off (click an
// empty place and pick a pin; click a pin to swap it, take it off, or see it in 3D); visitors see
// only the chosen pins, centred, and can open them in 3D. Saved as `profiles/{uid}.pinDisplay`.
// Real-object depth on purpose (like the Badges bookshelf); nothing glows or moves.

const MAX_PIN = 140
const COLS = 4 // spots a row: 8 = two rows of 4 (2026-11-27; was 6 in rows of 3)

export function BadgeShowcase({ badges, isMe, ownerName, ids, onChange, allowed = 8 }: {
  badges: SharedBadges
  isMe: boolean
  ownerName: string
  ids: string[]                       // one per spot, '' = empty
  onChange?: (ids: string[]) => void  // the owner rearranged it
  /** Spots this profile shows (2026-11-27: 4 free, 8 with Haven Premium — ProfilePage). Pins placed past it
   *  are kept, just not shown; on your own profile those spots show a crown that opens the Premium sheet. */
  allowed?: number
}) {
  const { openPremium } = usePremiumAccess()
  const { catalog } = useBadgeCatalog()
  const byId = useMemo(() => new Map(catalog.badges.map((b) => [b.id, b])), [catalog.badges])
  const tierOf = (d: BadgeDef) => badgeTier(d, badges.progress[d.id])
  const earned = useMemo(() => catalog.badges.filter((d) => badgeTier(d, badges.progress[d.id]) > 0), [catalog.badges, badges])
  // Only pins actually unlocked (any tier) are shown, whatever is stored — in their tier's look
  const shown = ids.map((id, i) => { const d = id && i < allowed ? byId.get(id) : undefined; return d && tierOf(d) > 0 ? d : null })
  const [picking, setPicking] = useState<number | null>(null)
  const [inspect, setInspect] = useState<BadgeDef | null>(null)

  const padRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = padRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // COLS tiles a row: each tile is pin × 1.25 + 24 wide, with up to 16px between them
  const pin = Math.max(56, Math.min(MAX_PIN, Math.max(0, width - (COLS - 1) * 16 - COLS * 24 - 4) / COLS / 1.25))

  function place(spot: number, id: string) {
    const next = ids.map((x) => (x === id ? '' : x)) // a pin can only be in one spot: moving it
    next[spot] = id
    onChange?.(next)
    setPicking(null)
  }
  function remove(spot: number) {
    const next = [...ids]
    next[spot] = ''
    onChange?.(next)
    setPicking(null)
  }

  const first = ownerName.split(' ')[0]
  const nothing = shown.every((d) => !d)

  // Visitors see the pins only, centred — never the empty places
  const places = shown.map((def, i) => ({ def, i })).filter((p) => isMe || p.def)
  const owner = first ? `${first}’s Pin Collection` : 'Pin Collection'

  const filled = shown.filter(Boolean).length
  // A tile for every spot — the pin centred on soft parchment, its nameplate below
  const tile = { width: pin * 1.25 + 24, height: pin * 1.16 + pin * 0.2 + 28 }

  return (
    <div>
      <PinholeFilter />
      {/* The Pin Display (2026-11-27 redesign): a flat parchment board in the app's own style — a header,
          then one tile per spot. Was a walnut-and-brass case under glass (fake 3D, out of place). */}
      <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-[clamp(14px,2.4vw,24px)]">
        <div className="flex items-end justify-between gap-3 flex-wrap mb-[clamp(14px,2vw,20px)]">
          <div className="min-w-0">
            <h3 className="pinbook-serif text-[clamp(1.05rem,1.8vw,1.35rem)] font-bold text-ink truncate">{owner}</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {earned.length} {earned.length === 1 ? 'pin' : 'pins'} earned
              {isMe && <> · {filled} of {allowed} {allowed === 1 ? 'spot' : 'spots'} filled</>}
            </p>
          </div>
        </div>

        <div ref={padRef} className="relative [container-type:inline-size]">
          {nothing && !isMe && (
            <div className="rounded-xl border border-dashed border-slate-700 text-center text-sm text-slate-500 py-12">
              {first} hasn’t put any pins on display yet
            </div>
          )}
          {places.length > 0 && (
            <div className="flex flex-wrap justify-center gap-[clamp(8px,1.6vw,16px)]">
              {width > 0 && places.map(({ def, i }) => (
                <div key={`${i}-${def?.id ?? 'empty'}`} className="relative" style={tile}>
                  {def ? (
                    <div className="h-full w-full rounded-2xl border border-slate-800 bg-[#f6eedb] flex items-center justify-center">
                      <BadgeSpot
                        def={def} badges={badges} pin={pin} isMe={isMe} interactive below={i < COLS}
                        progressRise={false} // what's unlocked, not progress toward the next look
                        onInspect={isMe ? () => setPicking(i) : setInspect}
                      />
                    </div>
                  ) : i >= allowed ? (
                    <EmptyDisplaySpot size={pin} canAdd={isMe} premium onClick={() => openPremium('pin-display')} />
                  ) : (
                    <EmptyDisplaySpot size={pin} canAdd={isMe} onClick={() => setPicking(i)} />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {picking !== null && (
        <PinPicker
          current={shown[picking]}
          earned={earned}
          tierOf={tierOf}
          displayed={new Set(ids.filter(Boolean))}
          onPick={(id) => place(picking, id)}
          onRemove={() => remove(picking)}
          onView={(d) => { setPicking(null); setInspect(d) }}
          onClose={() => setPicking(null)}
        />
      )}
      {inspect && (
        <PinInspector
          def={inspect}
          earnedAt={badges.earned[inspect.id]}
          progress={badges.progress[inspect.id]}
          onClose={() => setInspect(null)}
          cardsFor={{ isMe }}
        />
      )}
    </div>
  )
}

// An empty place (the owner's view only): a fine engraved ring in the velvet with a faint + to fill it

function EmptyDisplaySpot({ size, canAdd, onClick, premium }: { size: number; canAdd: boolean; onClick: () => void; premium?: boolean }) {
  // An empty spot: a dashed parchment tile. On a free display the Premium spots carry a gold crown —
  // tapping one opens the Premium sheet. Visitors never see empty spots (BadgeShowcase leaves them out).
  const Icon = premium ? Crown : Plus
  const body = (
    <>
      <span className={cn('flex items-center justify-center rounded-full border border-dashed transition-colors',
        premium ? 'border-[#b8862b]/50 text-[#b8862b] group-hover:border-[#b8862b]' : 'border-slate-700 text-slate-500 group-hover:border-slate-500 group-hover:text-ink')}
        style={{ width: size * 0.62, height: size * 0.62 }}>
        <Icon size={Math.max(16, size * 0.16)} strokeWidth={1.6} />
      </span>
      <span className={cn('text-[0.6875rem] font-semibold uppercase tracking-[0.14em]', premium ? 'text-[#b8862b]' : 'text-slate-500 group-hover:text-ink')}>
        {premium ? 'Premium spot' : 'Add a pin'}
      </span>
    </>
  )
  const cls = cn('h-full w-full rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-2.5 transition-colors',
    premium ? 'border-[#b8862b]/30 bg-[rgba(184,134,43,0.05)] hover:border-[#b8862b]/60' : 'border-slate-800 hover:border-slate-700 hover:bg-slate-900/40')
  if (!canAdd) return <div className={cls} aria-hidden>{body}</div>
  return (
    <button type="button" onClick={onClick} aria-label={premium ? 'More display spots with Haven Premium' : 'Put a pin here'} className={cn('group outline-none', cls)}>
      {body}
    </button>
  )
}

/** How big each earned pin shows in the picker (px) — doubled from 68 on 2026-11-16 so the art reads */
const PICKER_PIN = 136

// Choose which earned pin goes in a spot (a pin already on display moves here). Also used by the
// profile banner's pins (BannerPins.tsx).
export function PinPicker({ current, earned, tierOf, displayed, onPick, onRemove, onView, onClose }: {
  current: BadgeDef | null
  earned: BadgeDef[]
  tierOf: (d: BadgeDef) => number
  displayed: Set<string>
  onPick: (id: string) => void
  onRemove: () => void
  onView: (d: BadgeDef) => void
  onClose: () => void
}) {
  // Type to narrow the list by pin name (ignores case and accents)
  const [query, setQuery] = useState('')
  const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const words = fold(query).split(/\s+/).filter(Boolean)
  const matches = words.length ? earned.filter((d) => { const n = fold(d.name); return words.every((w) => n.includes(w)) }) : earned
  // The picker wears the profile header's look: the aged Haven parchment banner on top (title,
  // the pin in this spot, search) with the gilt rule and diamond along its foot, and the earned
  // pins laid on lighter parchment below, each casting its own silhouette shadow.
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/55 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Choose a pin"
        className="picker-sheet picker-in relative w-full max-w-2xl max-h-[86vh] flex flex-col rounded-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="haven-banner relative shrink-0 px-5 pt-4 pb-7">
          <span aria-hidden className="haven-banner-flourish absolute inset-0 pointer-events-none" />
          <Sparkles aria-hidden size={110} strokeWidth={1.25} className="absolute -right-4 -top-8 text-[#4a321f]/[0.08] rotate-12" />
          <div className="relative flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-lg font-bold text-ink leading-tight">{current ? 'Change this pin' : 'Choose a pin'}</div>
              <div className="text-xs font-semibold text-[#4a321f]/70 mt-0.5">Any pin you’ve earned · {earned.length} {earned.length === 1 ? 'pin' : 'pins'}</div>
            </div>
            <button onClick={onClose} aria-label="Close" className="picker-close shrink-0 w-8 h-8 flex items-center justify-center rounded-xl"><X size={16} /></button>
          </div>

          {/* The pin it's replacing: see it in 3D or take it off */}
          {current && (
            <div className="relative flex items-center gap-3 mt-3">
              <span className={cn('banner-pin relative shrink-0 flex items-center justify-center', tierOf(current) === 1 && 'grayscale')} style={{ width: 44, height: 48 }}>
                <BadgePin art={current.art} imageUrl={current.imageUrl} size={Math.min(44, pinSize(current, 44))} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[0.625rem] font-bold uppercase tracking-[0.16em] text-[#4a321f]/60">In this spot now</span>
                <span className="block text-sm font-bold text-ink truncate">{current.name}</span>
              </span>
              <button onClick={() => onView(current)} className="picker-chip"><Box size={13} />3D</button>
              <button onClick={onRemove} className="picker-chip"><Trash2 size={13} />Take off</button>
            </div>
          )}

          {earned.length > 0 && (
            <div className="relative mt-3">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4a321f]/50 pointer-events-none" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { if (query) { e.stopPropagation(); setQuery('') } else onClose() }
                  // Enter picks the only match
                  if (e.key === 'Enter' && matches.length === 1) {
                    const d = matches[0]
                    if (current?.id === d.id) onClose(); else onPick(d.id)
                  }
                }}
                placeholder="Search your pins by name…"
                aria-label="Search your pins by name"
                autoFocus={typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches}
                className="picker-search w-full rounded-xl pl-9 pr-3 py-2.5 text-sm outline-none"
              />
            </div>
          )}
        </div>

        {/* The pins, on lighter parchment — scrolls when there are many */}
        <div className="picker-paper relative overflow-y-auto min-h-0">
          {earned.length === 0 && (
            <div className="text-center text-sm text-slate-500 py-14 px-6">Earn your first pin and it can go on display here.</div>
          )}
          {earned.length > 0 && matches.length === 0 && (
            <div className="text-center text-sm text-slate-500 py-14 px-6">No pins you’ve earned match “{query.trim()}”.</div>
          )}
          {matches.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-4 p-5">
              {matches.map((d) => {
                const here = current?.id === d.id
                const elsewhere = !here && displayed.has(d.id)
                return (
                  <button
                    key={d.id}
                    onClick={() => (here ? onClose() : onPick(d.id))}
                    title={here ? 'Already in this spot' : elsewhere ? `${d.name} — move it here` : d.name}
                    className={cn('picker-pin group relative flex flex-col items-center gap-2 rounded-xl pt-3 pb-2 px-1 text-center outline-none', here && 'picker-pin-here')}
                  >
                    <span className="picker-pin-art relative flex items-center justify-center" style={{ width: PICKER_PIN, height: PICKER_PIN * 1.12 }}>
                      {/* the same silhouette shadow the banner pins cast */}
                      <span aria-hidden className="banner-pin-backing absolute inset-0 flex items-center justify-center pointer-events-none">
                        <BadgePin art={d.art} imageUrl={d.imageUrl} size={Math.min(PICKER_PIN, pinSize(d, PICKER_PIN))} />
                      </span>
                      <span className={cn('relative flex items-center justify-center', tierOf(d) === 1 && 'grayscale')}>
                        <BadgePin art={d.art} imageUrl={d.imageUrl} size={Math.min(PICKER_PIN, pinSize(d, PICKER_PIN))} />
                      </span>
                    </span>
                    <span className="text-[0.8125rem] font-semibold text-ink leading-tight line-clamp-2">{d.name}</span>
                    {(here || elsewhere) && (
                      <span className="absolute top-1 right-1 text-[0.5625rem] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-[#8a5d36] text-[#f6ead0]">
                        {here ? 'Here' : 'Shown'}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
