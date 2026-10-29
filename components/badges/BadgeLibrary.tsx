'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowLeft, BookOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import { badgesInSet, type BadgeSet } from '@/lib/badges'
import { useBadgeCatalog } from '@/lib/badgeCatalog'
import type { SharedBadges } from '@/lib/firebase/badges'
import { BadgeBook } from './BadgeBook'
import { PhoneBook } from './PhoneBook'
import { BadgePin } from './BadgePin'
import { badgeAsset } from '@/lib/badgeAssets'

// The Badges shelf: every Badge Set is its own closed pin book. Click one and it opens: the closed
// book flies from the shelf to the middle of the page, and its cover swings open on the spine while
// the whole book glides right into place — one fluid motion (the open pin book, BadgeBook, sits
// under the cover the whole time). Used on the Badges page and a profile's Badges tab.

const FLY_MS = 560
const TURN_MS = 900
const REVEAL_MS = 60 // the cover has landed: swap it for the real book (they look identical)
// Shared by the cover swing and the glide, so they move as one.
const EASE = 'cubic-bezier(0.55, 0.05, 0.25, 1)'

type Phase = 'measure' | 'fly' | 'flyGo' | 'turn' | 'reveal'
type View =
  | { mode: 'shelf' }
  | { mode: 'opening'; set: BadgeSet; from: DOMRect; to?: DOMRect; phase: Phase }
  | { mode: 'open'; set: BadgeSet }
  // An upright phone: the book opens full screen, a page at a time (PhoneBook), over the shelf
  | { mode: 'phone'; set: BadgeSet; from: DOMRect | null }

// An upright phone (portrait, narrow): a two-page spread there makes every pin tiny
const PHONE_QUERY = '(max-width: 767px) and (orientation: portrait)'

// Dev server only: the Dev panel's "Show all badges as earned" — to see earned pins in the books.
export const DEV_ALL_BADGES_KEY = 'tcghaven-dev-all-badges'
export const DEV_ALL_BADGES_EVENT = 'tcghaven-dev-all-badges'
function useDevAllBadges(): boolean {
  const [on, setOn] = useState(false)
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return
    const read = () => { try { setOn(localStorage.getItem(DEV_ALL_BADGES_KEY) === '1') } catch { setOn(false) } }
    read()
    window.addEventListener(DEV_ALL_BADGES_EVENT, read)
    return () => window.removeEventListener(DEV_ALL_BADGES_EVENT, read)
  }, [])
  return on
}

export function BadgeLibrary({ ownerName, badges: realBadges, isMe, full = false }: {
  ownerName: string
  badges: SharedBadges | null
  isMe: boolean
  full?: boolean
}) {
  const devAll = useDevAllBadges()
  const { catalog } = useBadgeCatalog()
  const badges = devAll && isMe
    ? { earned: Object.fromEntries(catalog.badges.map((b) => [b.id, realBadges?.earned[b.id] ?? Date.now()])), progress: Object.fromEntries(catalog.badges.map((b) => [b.id, [b.slots.length, b.slots.length] as [number, number]])) } // (all complete, so growing ones show Mastered too)
    : realBadges
  const [view, setView] = useState<View>({ mode: 'shelf' })
  const closePhone = useCallback(() => setView({ mode: 'shelf' }), [])
  const coverRef = useRef<HTMLDivElement>(null)
  // Every position in the animation is relative to this box (not the window), and the flying book
  // is drawn inside it — so scrolling, before or during the animation, can't pull the flying book
  // and the open book apart.
  const rootRef = useRef<HTMLDivElement>(null)
  const relative = (r: DOMRect) => {
    const o = rootRef.current!.getBoundingClientRect()
    return new DOMRect(r.left - o.left, r.top - o.top, r.width, r.height)
  }

  function open(set: BadgeSet, el: HTMLElement) {
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (window.matchMedia(PHONE_QUERY).matches) { setView({ mode: 'phone', set, from: still ? null : el.getBoundingClientRect() }); return }
    if (still) { setView({ mode: 'open', set }); return }
    setView({ mode: 'opening', set, from: relative(el.getBoundingClientRect()), phase: 'measure' })
  }

  // measure → fly: the open book is laid out (invisibly) so we know where its cover lands.
  useLayoutEffect(() => {
    if (view.mode !== 'opening' || view.phase !== 'measure' || !coverRef.current) return
    const r = relative(coverRef.current.getBoundingClientRect())
    const to = new DOMRect(r.left + r.width / 2, r.top, r.width / 2, r.height)
    setView({ ...view, to, phase: 'fly' })
    // Bring the open book fully on screen (only scrolls if it isn't already). Safe mid-animation:
    // every position above is relative to this box, so the flying book scrolls along with it.
    const box = coverRef.current.getBoundingClientRect()
    if (box.top < 0 || box.bottom > window.innerHeight) coverRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])

  // fly → flyGo (next frame, so the transition runs) → turn → reveal → open
  useEffect(() => {
    if (view.mode !== 'opening') return
    let t: ReturnType<typeof setTimeout> | undefined
    let raf = 0
    if (view.phase === 'fly') raf = requestAnimationFrame(() => requestAnimationFrame(() => setView((v) => (v.mode === 'opening' ? { ...v, phase: 'flyGo' } : v))))
    if (view.phase === 'flyGo') t = setTimeout(() => setView((v) => (v.mode === 'opening' ? { ...v, phase: 'turn' } : v)), FLY_MS + 40)
    if (view.phase === 'turn') t = setTimeout(() => setView((v) => (v.mode === 'opening' ? { ...v, phase: 'reveal' } : v)), TURN_MS)
    if (view.phase === 'reveal') t = setTimeout(() => setView((v) => (v.mode === 'opening' ? { mode: 'open', set: v.set } : v)), REVEAL_MS)
    return () => { if (t) clearTimeout(t); cancelAnimationFrame(raf) }
  }, [view])

  if (view.mode === 'shelf' || view.mode === 'phone') {
    return (
      <div ref={rootRef} className="relative scroll-mt-4">
        <Shelf badges={badges} full={full} onOpen={open} />
        {view.mode === 'phone' && (
          <PhoneBook set={view.set} badges={badges} isMe={isMe} from={view.from} onClose={closePhone} />
        )}
      </div>
    )
  }

  const opening = view.mode === 'opening' ? view : null
  const phase = opening?.phase
  // While opening, only the right half of the open book shows (the cover is still over it), then
  // the left half is revealed as the cover lands.
  // The cut is at the book's spine, measured (`to.left`) — not 50% of this box: the box also holds
  // the arrows and the chapter tabs, so its middle isn't the spine (that cut off a strip of the
  // right page until the book had opened).
  const clip = !opening ? undefined
    : phase === 'reveal' ? 'inset(-20% -20% -20% 0%)'
    : opening.to ? `inset(-20% -20% -20% ${opening.to.left}px)` : 'inset(-20% -20% -20% 50%)'
  // The book opens in the middle: while closed, everything sits half a page to the left (so the
  // closed book is centred); as the cover swings open it glides right into place at the same pace.
  const shift = opening?.to ? opening.to.width / 2 : 0
  const settled = !opening || phase === 'turn' || phase === 'reveal'

  return (
    <div ref={rootRef} className="relative scroll-mt-4">
      {/* Which book this is (it has no title page — pins start on page one) */}
      <div className={cn('mb-3 flex items-center gap-3 flex-wrap transition-opacity', opening ? 'opacity-0' : 'opacity-100')}>
        <button
          onClick={() => setView({ mode: 'shelf' })}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-700 bg-slate-950/60 text-sm font-semibold text-slate-400 hover:text-ink hover:border-slate-600 transition-colors"
        >
          <ArrowLeft size={15} />All pin books
        </button>
        <BookHeader set={view.set} badges={badges} ownerName={ownerName} isMe={isMe} />
      </div>
      <div
        style={{
          visibility: phase === 'measure' || phase === 'fly' || phase === 'flyGo' ? 'hidden' : 'visible',
          clipPath: clip,
          transform: settled ? undefined : `translateX(${-shift}px)`,
          transition: phase === 'turn' ? `transform ${TURN_MS}ms ${EASE}` : undefined,
        }}
      >
        <BadgeBook set={view.set} badges={badges} isMe={isMe} full={full} coverRef={coverRef} />
      </div>
      {opening?.to && <Flyer opening={opening} badges={badges} isMe={isMe} full={full} />}
    </div>
  )
}

// The closed book in flight. Three nested layers, one motion each, so they never blend into one
// another: (1) fly — slide + resize from the shelf to the middle of the page; (2) glide — slide right
// into place while it opens, carrying the 3D perspective (viewed from the spine) with it; (3) swing
// — a pure rotateY(0 → −180°) around the spine. Sharing one element made the browser blend the
// fly's resize into the swing whenever their timing overlapped, squashing the cover flat instead
// of turning it.
function Flyer({ opening, badges, isMe, full }: { opening: Extract<View, { mode: 'opening' }>; badges: SharedBadges | null; isMe: boolean; full: boolean }) {
  const { from, to, phase, set } = opening
  if (!to) return null
  const shift = to.width / 2
  const left = to.left - shift // centred
  const start = `translate(${from.left - left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`
  const turning = phase === 'turn' || phase === 'reveal'
  const fade = phase === 'reveal'
  const hidden: React.CSSProperties = { backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }
  return (
    <div className="absolute inset-0 z-[45] pointer-events-none">
      {/* 1 · fly */}
      <div
        className="absolute"
        style={{
          left, top: to.top, width: to.width, height: to.height,
          transformOrigin: '0 0',
          transform: phase === 'fly' ? start : 'none',
          transition: phase === 'flyGo' ? `transform ${FLY_MS}ms cubic-bezier(0.22, 0.8, 0.25, 1)` : 'none',
          opacity: fade ? 0 : 1,
        }}
      >
        {/* 2 · glide (+ the perspective, looking from the spine) */}
        <div
          className="absolute inset-0"
          style={{
            perspective: `${Math.round(to.width * 5)}px`,
            perspectiveOrigin: '0% 50%',
            transform: turning ? `translateX(${shift}px)` : 'translateX(0px)',
            transition: phase === 'turn' ? `transform ${TURN_MS}ms ${EASE}` : 'none',
          }}
        >
          {/* 3 · swing */}
          <div
            className="absolute inset-0"
            style={{
              transformStyle: 'preserve-3d',
              transformOrigin: 'left center',
              transform: turning ? 'rotateY(-180deg)' : 'rotateY(0deg)',
              transition: phase === 'turn' ? `transform ${TURN_MS}ms ${EASE}` : 'none',
            }}
          >
            <div className="absolute inset-0" style={hidden}>
              <BookCover set={set} badges={badges} />
              {/* Light falloff: the front of the cover darkens as it turns away */}
              <div
                className="absolute inset-0 rounded-[14px] bg-black"
                style={{ opacity: turning ? 0.45 : 0, transition: phase === 'turn' ? `opacity ${TURN_MS * 0.5}ms ease-in` : 'none' }}
              />
            </div>
            {/* Inside of the cover = the book's first page (its left half), so you see the page as the
                cover swings over, and it lands exactly where the real page is. Starts in shadow and
                lightens as it lands. */}
            <div className="absolute inset-0 overflow-hidden" style={{ ...hidden, transform: 'rotateY(180deg)' }}>
              <div className="absolute left-0 top-0" style={{ width: to.width * 2 }}>
                <BadgeBook set={set} badges={badges} isMe={isMe} full={full} coverOnly />
              </div>
              <div
                className="absolute inset-0 bg-black"
                style={{ opacity: turning ? 0 : 0.5, transition: phase === 'turn' ? `opacity ${TURN_MS * 0.5}ms ease-out ${TURN_MS * 0.5}ms` : 'none' }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── The shelf ───────────────────────────────────────────────────────────────────────────────

function Shelf({ badges, full, onOpen }: { badges: SharedBadges | null; full: boolean; onOpen: (set: BadgeSet, el: HTMLElement) => void }) {
  const { catalog } = useBadgeCatalog()
  return (
    <div className="badge-shelf-in">
      <div className="text-sm text-slate-500 mb-4 flex items-center gap-1.5"><BookOpen size={15} />Pick a pin book to open it.</div>
      <div className={cn('grid gap-6 sm:gap-8', full ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4')}>
        {catalog.sets.map((set) => {
          const inSet = badgesInSet(catalog, set.id)
          const earned = inSet.filter((b) => badges?.earned[b.id]).length
          return (
            <div key={set.id} className="flex flex-col items-center">
              <button
                onClick={(e) => onOpen(set, e.currentTarget.querySelector('[data-cover]') as HTMLElement)}
                className="badge-book-tile group relative w-full max-w-[240px] aspect-[0.71] outline-none"
                aria-label={`Open the ${set.name} pin book`}
              >
                {/* Page block (the book's thickness) */}
                <span className="absolute inset-0 translate-x-[5px] translate-y-[5px] rounded-[14px] bg-[#0f0d0c] shadow-[0_14px_24px_-10px_rgba(40,25,10,0.7)]" />
                <span className="absolute inset-0 translate-x-[2.5px] translate-y-[2.5px] rounded-[14px] bg-[#221d1a]" />
                <span data-cover className="absolute inset-0"><BookCover set={set} badges={badges} /></span>
              </button>
              <div className="mt-3 w-full max-w-[240px] text-center">
                <div className="text-sm font-bold text-ink">{set.name}</div>
                <CompletionBar set={set} earned={earned} total={inSet.length} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function BookHeader({ set, badges, ownerName, isMe }: { set: BadgeSet; badges: SharedBadges | null; ownerName: string; isMe: boolean }) {
  const { catalog } = useBadgeCatalog()
  const inSet = badgesInSet(catalog, set.id)
  const earned = inSet.filter((b) => badges?.earned[b.id]).length
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="w-3 h-3 rounded-full shrink-0" style={{ background: `linear-gradient(135deg, ${set.cover.from}, ${set.cover.accent})` }} />
      <span className="text-base font-bold text-ink truncate">{set.name}</span>
      {!isMe && <span className="text-sm text-slate-500 truncate">· {ownerName.split(' ')[0]}&rsquo;s pin book</span>}
      <span className="text-xs font-bold text-slate-500 bg-slate-800/80 px-2 py-0.5 rounded-full shrink-0">
        {inSet.length ? `${earned} / ${inSet.length} earned` : 'Coming soon'}
      </span>
    </div>
  )
}

// How full a book is: fills in the book's own colours as pins are earned (animates in), and turns
// gold with a shine once every pin in it is earned.
function CompletionBar({ set, earned, total }: { set: BadgeSet; earned: number; total: number }) {
  const [shown, setShown] = useState(0)
  const pct = total ? Math.round((earned / total) * 100) : 0
  useEffect(() => {
    const r = requestAnimationFrame(() => setShown(pct))
    return () => cancelAnimationFrame(r)
  }, [pct])
  const complete = total > 0 && earned === total
  return (
    <div className="mt-2">
      <div className="relative h-2.5 rounded-full bg-slate-700/60 border border-slate-600/50 overflow-hidden shadow-[inset_0_1px_2px_rgba(60,35,15,0.35)]">
        <div
          className={cn('absolute inset-y-0 left-0 rounded-full transition-[width] duration-1000 ease-out', complete && 'badge-bar-complete')}
          style={{
            width: `${shown}%`,
            background: complete
              ? 'linear-gradient(90deg, #b8862b, #fbe7a1, #d4a640)'
              : `linear-gradient(90deg, ${set.cover.from}, ${set.cover.accent})`,
          }}
        />
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] font-semibold">
        <span className={complete ? 'text-amber-600' : 'text-slate-500'}>
          {!total ? 'First pins coming soon' : complete ? 'Book complete!' : `${earned} / ${total} ${total === 1 ? 'pin' : 'pins'}`}
        </span>
        {total > 0 && <span className="text-slate-500">{pct}%</span>}
      </div>
    </div>
  )
}

// A Badge Set's closed book: leather cover in the set's colors, stitched spine, strap + snap,
// embossed title and the set's first pin.
export function BookCover({ set, badges }: { set: BadgeSet; badges: SharedBadges | null }) {
  const { catalog } = useBadgeCatalog()
  const inSet = badgesInSet(catalog, set.id)
  const first = inSet[0]
  const earned = inSet.filter((b) => badges?.earned[b.id]).length
  const { from, to, accent } = set.cover
  if (set.coverImage) {
    return (
      <div className="absolute inset-0 rounded-[10px] overflow-hidden shadow-[0_14px_30px_-12px_rgba(0,0,0,0.7)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={badgeAsset(set.coverImage)} alt="" draggable={false} className="absolute inset-0 w-full h-full object-cover" />
        {/* A soft shadow fading down from the top, so the name reads over any artwork */}
        <div className="absolute inset-x-0 top-0 h-[34%] pointer-events-none" style={{ background: 'linear-gradient(to bottom, rgba(6,4,12,0.82), rgba(6,4,12,0.55) 45%, transparent)' }} />
        {/* The book's name, engraved in gold across the top of the cover */}
        <div className="absolute inset-x-[8%] top-[6.5%] flex flex-col items-center text-center pointer-events-none" style={{ containerType: 'inline-size' }}>
          <span className="cover-title-plate pinbook-serif px-[7%] py-[2.5%] rounded-[4px]">
            <span className="cover-subtitle block text-[clamp(6px,4.2cqw,11px)] font-bold uppercase tracking-[0.32em]" style={{ color: accent }}>{set.subtitle}</span>
            <span className="cover-title block mt-[2%] text-[clamp(13px,11cqw,34px)] font-bold uppercase tracking-[0.12em] leading-none whitespace-nowrap">{set.name}</span>
          </span>
        </div>
        <div className="absolute inset-x-0 bottom-[5%] flex justify-center">
          <span className="rounded-full px-2.5 py-0.5 text-[10px] font-bold backdrop-blur-sm" style={{ background: 'rgba(0,0,0,0.55)', color: accent }}>
            {inSet.length ? `${earned} / ${inSet.length} earned` : 'Coming soon'}
          </span>
        </div>
      </div>
    )
  }
  return (
    <div className="badge-cover absolute inset-0 rounded-[14px] overflow-hidden" style={{ background: `linear-gradient(150deg, ${from}, ${to})` }}>
      {/* Spine */}
      <div className="absolute inset-y-0 left-0 w-[11%] bg-black/35 border-r border-black/40">
        <div className="absolute inset-y-[6%] right-[22%] border-r border-dashed" style={{ borderColor: accent + '66' }} />
      </div>
      {/* Stitched border — the cover's face; the title block is centred inside it */}
      <div className="absolute top-[5%] bottom-[5%] left-[15%] right-[5%] rounded-[10px] border-[1.5px] border-dashed" style={{ borderColor: accent + '80' }} />
      {/* Strap + snap */}
      <div className="absolute right-0 top-[40%] h-[20%] w-[13%] rounded-l-md bg-black/45 border-y border-l border-black/50 flex items-center justify-center">
        <span className="w-[42%] aspect-square rounded-full" style={{ background: `radial-gradient(circle at 35% 35%, #fff6dc, ${accent} 55%, #6b4a17)` }} />
      </div>
      {/* Title + pin */}
      <div className="absolute top-[5%] bottom-[5%] left-[15%] right-[5%] flex flex-col items-center justify-center text-center px-[9%]">
        <div className="text-[clamp(8px,2.4cqw,12px)] font-black tracking-[0.3em] uppercase" style={{ color: accent }}>{set.subtitle}</div>
        <div className="mt-1 font-black leading-none text-[clamp(18px,9cqw,40px)]" style={{ color: '#fbe9c4', textShadow: '0 2px 0 rgba(0,0,0,0.45)' }}>{set.name}</div>
        <div className="mt-[10%] drop-shadow-[0_6px_6px_rgba(0,0,0,0.5)]">
          {first ? (
            <BadgePin art={first.art} imageUrl={first.imageUrl} size={70} ghost={!badges?.earned[first.id]} />
          ) : (
            // No pins in this book yet: an embossed medallion with the game's monogram
            <span
              className="flex items-center justify-center shrink-0 rounded-full font-black text-2xl"
              style={{ width: 70, height: 70, minWidth: 70, border: `2px solid ${accent}99`, color: accent, background: 'rgba(0,0,0,0.25)', boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.5)' }}
            >
              {set.monogram}
            </span>
          )}
        </div>
        <div className="mt-[10%] rounded-full px-2.5 py-0.5 text-[10px] font-bold" style={{ background: 'rgba(0,0,0,0.4)', color: accent }}>
          {inSet.length ? `${earned} / ${inSet.length} earned` : 'Coming soon'}
        </div>
      </div>
    </div>
  )
}
