'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowLeft, Award, Check, Users } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { BLANK_COVER, CoverSpine, coverArea, spineOf } from '@/components/badges/CoverSpine'
import { pageEdgeCss, PAGE_DEPTH } from '@/lib/pageEdges'
import { coverFont, loadCoverFonts, titleFinish } from '@/lib/coverFonts'
import { badgesInSet, badgeTier, pinSize, bookCollection, HAVEN_COLLECTION, type BadgeDef, type BadgeSet, type CoverStyle } from '@/lib/badges'
import { useBadgeCatalog } from '@/lib/badgeCatalog'
import type { SharedBadges } from '@/lib/firebase/badges'
import { preloadTrimmedArt } from './trimmedArt'
import { preloadPinInspector } from './pinInspectorLoader'
import { BadgeBook } from './BadgeBook'
import { PhoneBook } from './PhoneBook'
import { BadgePin } from './BadgePin'
import { badgeAsset } from '@/lib/badgeAssets'

// The Badges shelf: every Badge Set is its own closed pin book. Click one and it opens: the closed
// book flies from the shelf to the middle of the page, and its cover swings open on the spine while
// the whole book glides right into place — one fluid motion (the open pin book, BadgeBook, sits
// under the cover the whole time). "All pin books" runs it backwards: the cover swings shut over the
// open spread as the book glides back to the middle, then it flies home to its (empty) spot on the
// shelf. Used on the Badges page and a profile's Badges tab.

export const FLY_MS = 560
export const LIFT_MS = 200 // the book rising off its spot before it flies (and setting down when it's back)
export const GROW_MS = 240 // the closed book changing shape in place (shelf book ↔ the open book's cover)
export const TURN_MS = 900
export const REVEAL_MS = 60 // the cover has landed: swap it for the real book (they look identical)
// Shared by the cover swing and the glide, so they move as one.
const EASE = 'cubic-bezier(0.55, 0.05, 0.25, 1)'

// The flying book always keeps the shelf book's own shape while it travels (its real size changes,
// nothing is stretched, so it looks exactly like the shelf's book the whole way); it only changes
// shape in place, in the middle of the page, to become the open book's cover (grow) or back (settle).
// The open book fills the window on desktop, so its cover isn't the shelf book's shape — flying
// with a stretch made the book squash and then snap to the shelf's look as it landed.
// lift: it rises off its spot (a little bigger, its shadow spreading) before it flies
export type Phase = 'measure' | 'fly' | 'lift' | 'flyGo' | 'grow' | 'turn' | 'reveal'
// prep: the open cover is laid over the open book (they look identical) and the shelf is laid out
// unseen, to find the book's spot · shut: the cover swings shut · settle: back to the shelf book's
// shape · home: it flies to its spot
// land: back in its spot, it sets down (the lift undone) before the shelf takes over
export type ClosePhase = 'prep' | 'shut' | 'settle' | 'home' | 'land'
type View =
  | { mode: 'shelf' }
  | { mode: 'opening'; set: BadgeSet; from: DOMRect; to?: DOMRect; phase: Phase }
  | { mode: 'open'; set: BadgeSet }
  | { mode: 'closing'; set: BadgeSet; to: DOMRect; spread: number; spot?: DOMRect; phase: ClosePhase }
  // An upright phone: the book opens full screen, a page at a time (PhoneBook), over the shelf
  | { mode: 'phone'; set: BadgeSet; from: DOMRect | null }

// An upright phone (portrait, narrow): a two-page spread there makes every pin tiny
const PHONE_QUERY = '(max-width: 767px) and (orientation: portrait)'

// The shelf's collection, remembered on this device (a convenience — Haven Badges when unset)
const COLLECTION_KEY = 'tcghaven-badge-collection'
const COMMUNITY_SHELF = 'Community Badges'
type ShelfKind = 'haven' | 'community'
function readCollection(): string {
  try { return localStorage.getItem(COLLECTION_KEY) || HAVEN_COLLECTION } catch { return HAVEN_COLLECTION }
}

// Dev server only: the Dev panel's "Preview badge progress" — every badge as if that % of it were
// collected (so each tier's look can be checked in the books). Stored as the % ('' = off; the old
// "show all as earned" '1' reads as 100).
export const DEV_ALL_BADGES_KEY = 'tcghaven-dev-all-badges'
export const DEV_ALL_BADGES_EVENT = 'tcghaven-dev-all-badges'
export function readDevBadgePct(): number | null {
  try {
    const v = localStorage.getItem(DEV_ALL_BADGES_KEY)
    if (v === '1') return 100
    if (!v || v === '0' || v === 'off') return null
    const n = Number(v)
    return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : null
  } catch { return null }
}
function useDevBadgePct(): number | null {
  const [pct, setPct] = useState<number | null>(null)
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return
    const read = () => setPct(readDevBadgePct())
    read()
    window.addEventListener(DEV_ALL_BADGES_EVENT, read)
    return () => window.removeEventListener(DEV_ALL_BADGES_EVENT, read)
  }, [])
  return pct
}

export function BadgeLibrary({ ownerName, badges: realBadges, isMe, full = false }: {
  ownerName: string
  badges: SharedBadges | null
  isMe: boolean
  full?: boolean
}) {
  const devPct = useDevBadgePct()
  const { catalog } = useBadgeCatalog()
  const badges = devPct !== null && isMe
    ? {
        earned: Object.fromEntries(catalog.badges.filter(() => devPct >= 100).map((b) => [b.id, realBadges?.earned[b.id] ?? Date.now()])),
        progress: Object.fromEntries(catalog.badges.map((b) => [b.id, [Math.round((devPct / 100) * b.slots.length), b.slots.length] as [number, number]])),
      }
    : realBadges
  const [view, setView] = useState<View>({ mode: 'shelf' })
  // Which collection the shelf shows (remembered on this device; one that no longer exists falls
  // back to Haven Badges)
  // Two shelves: TCG Haven's own books, and every community's book (the communities you've joined)
  const [pickedCollection, setPickedCollection] = useState(readCollection)
  const collection: ShelfKind = pickedCollection === COMMUNITY_SHELF ? 'community' : 'haven'
  const pickCollection = (kind: ShelfKind) => {
    const v = kind === 'community' ? COMMUNITY_SHELF : HAVEN_COLLECTION
    setPickedCollection(v)
    try { localStorage.setItem(COLLECTION_KEY, v) } catch {}
  }
  const shelf = { collection, onCollection: pickCollection, isMe }
  // The shelf fades in when the page first shows it — not when a book is put back on it
  const [shelfIntro, setShelfIntro] = useState(true)
  const closePhone = useCallback(() => { setShelfIntro(false); setView({ mode: 'shelf' }) }, [])
  // The open book's current spread, so the closing cover shows the page you were on
  const spreadRef = useRef(0)
  const onSpread = useCallback((n: number) => { spreadRef.current = n }, [])
  const coverRef = useRef<HTMLDivElement>(null)
  // Every position in the animation is relative to this box (not the window), and the flying book
  // is drawn inside it — so scrolling, before or during the animation, can't pull the flying book
  // and the open book apart.
  const rootRef = useRef<HTMLDivElement>(null)
  const relative = (r: DOMRect) => {
    const o = rootRef.current!.getBoundingClientRect()
    return new DOMRect(r.left - o.left, r.top - o.top, r.width, r.height)
  }

  // A book's spot on the shelf (window coordinates)
  const shelfSpot = (id: string) => rootRef.current?.querySelector(`[data-book="${id}"] [data-cover]`)?.getBoundingClientRect() ?? null
  const phoneSpot = useCallback(() => (view.mode === 'phone' ? shelfSpot(view.set.id) : null), [view])

  function close() {
    if (view.mode !== 'open' || !coverRef.current) return
    setShelfIntro(false)
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setView({ mode: 'shelf' }); return }
    const r = relative(coverRef.current.getBoundingClientRect())
    const to = new DOMRect(r.left + r.width / 2, r.top, r.width / 2, r.height)
    setView({ mode: 'closing', set: view.set, to, spread: spreadRef.current, phase: 'prep' })
  }

  function open(set: BadgeSet, el: HTMLElement) {
    spreadRef.current = 0
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
    if (view.phase === 'fly') raf = requestAnimationFrame(() => requestAnimationFrame(() => setView((v) => (v.mode === 'opening' ? { ...v, phase: 'lift' } : v))))
    if (view.phase === 'lift') t = setTimeout(() => setView((v) => (v.mode === 'opening' ? { ...v, phase: 'flyGo' } : v)), LIFT_MS)
    if (view.phase === 'flyGo') t = setTimeout(() => setView((v) => (v.mode === 'opening' ? { ...v, phase: 'grow' } : v)), FLY_MS + 60)
    if (view.phase === 'grow') t = setTimeout(() => setView((v) => (v.mode === 'opening' ? { ...v, phase: 'turn' } : v)), GROW_MS + 80)
    if (view.phase === 'turn') t = setTimeout(() => setView((v) => (v.mode === 'opening' ? { ...v, phase: 'reveal' } : v)), TURN_MS)
    if (view.phase === 'reveal') t = setTimeout(() => setView((v) => (v.mode === 'opening' ? { mode: 'open', set: v.set } : v)), REVEAL_MS)
    return () => { if (t) clearTimeout(t); cancelAnimationFrame(raf) }
  }, [view])

  // Closing. prep: find the book's spot on the (unseen) shelf, then start on the next frame.
  useLayoutEffect(() => {
    if (view.mode !== 'closing' || view.phase !== 'prep' || view.spot) return
    const spot = shelfSpot(view.set.id)
    if (!spot) { setView({ mode: 'shelf' }); return }
    setView({ ...view, spot: relative(spot) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])
  useEffect(() => {
    if (view.mode !== 'closing' || !view.spot) return
    let t: ReturnType<typeof setTimeout> | undefined
    let raf = 0
    if (view.phase === 'prep') raf = requestAnimationFrame(() => requestAnimationFrame(() => setView((v) => (v.mode === 'closing' ? { ...v, phase: 'shut' } : v))))
    if (view.phase === 'shut') t = setTimeout(() => {
      // The shelf's spot may be above the fold (the open book is tall): bring it into view
      const top = rootRef.current?.getBoundingClientRect().top ?? 0
      if (top < 0) rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setView((v) => (v.mode === 'closing' ? { ...v, phase: 'settle' } : v))
    }, TURN_MS)
    if (view.phase === 'settle') t = setTimeout(() => setView((v) => (v.mode === 'closing' ? { ...v, phase: 'home' } : v)), GROW_MS + 80)
    if (view.phase === 'home') t = setTimeout(() => setView((v) => (v.mode === 'closing' ? { ...v, phase: 'land' } : v)), FLY_MS + 30)
    if (view.phase === 'land') t = setTimeout(() => setView({ mode: 'shelf' }), LIFT_MS + 20)
    return () => { if (t) clearTimeout(t); cancelAnimationFrame(raf) }
  }, [view])

  if (view.mode === 'shelf' || view.mode === 'phone') {
    return (
      <div ref={rootRef} className="relative scroll-mt-4">
        <Shelf {...shelf} badges={badges} full={full} onOpen={open} intro={shelfIntro} away={view.mode === 'phone' ? view.set.id : undefined} />
        {view.mode === 'phone' && (
          <PhoneBook set={view.set} badges={badges} isMe={isMe} from={view.from} getShelfSpot={phoneSpot} onClose={closePhone} />
        )}
      </div>
    )
  }

  const closing = view.mode === 'closing' ? view : null
  const opening = view.mode === 'opening' ? view : null
  const phase = opening?.phase
  // While opening, only the right half of the open book shows (the cover is still over it), then
  // the left half is revealed as the cover lands.
  // The cut is at the book's spine, measured (`to.left`) — not 50% of this box: the box also holds
  // the arrows and the chapter tabs, so its middle isn't the spine (that cut off a strip of the
  // right page until the book had opened).
  const clip = closing ? `inset(-20% -20% -20% ${closing.to.left}px)`
    : !opening ? undefined
    : phase === 'reveal' ? 'inset(-20% -20% -20% 0%)'
    : opening.to ? `inset(-20% -20% -20% ${opening.to.left}px)` : 'inset(-20% -20% -20% 50%)'
  // The book opens in the middle: while closed, everything sits half a page to the left (so the
  // closed book is centred); as the cover swings open it glides right into place at the same pace.
  const shift = opening?.to ? opening.to.width / 2 : 0
  const settled = !opening || phase === 'turn' || phase === 'reveal'

  return (
    <div ref={rootRef} className="relative scroll-mt-4">
      {/* Which book this is (it has no title page — pins start on page one) */}
      <div className={cn('mb-3 flex items-center gap-3 flex-wrap transition-opacity', opening || closing ? 'opacity-0' : 'opacity-100')}>
        <button
          onClick={close}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-700 bg-slate-950/60 text-sm font-semibold text-slate-400 hover:text-ink hover:border-slate-600 transition-colors"
        >
          <ArrowLeft size={15} />All pin books
        </button>
        <BookHeader set={view.set} badges={badges} ownerName={ownerName} isMe={isMe} />
      </div>
      <div
        style={closing ? {
          // closing: the right page stays while the cover swings shut over it and glides back left
          visibility: closing.phase === 'home' || closing.phase === 'land' || closing.phase === 'settle' ? 'hidden' : 'visible',
          clipPath: clip,
          transform: closing.phase === 'prep' ? undefined : `translateX(${-closing.to.width / 2}px)`,
          transition: closing.phase === 'shut' ? `transform ${TURN_MS}ms ${EASE}` : undefined,
        } : {
          visibility: phase === 'measure' || phase === 'fly' || phase === 'lift' || phase === 'flyGo' || phase === 'grow' ? 'hidden' : 'visible',
          clipPath: clip,
          transform: settled ? undefined : `translateX(${-shift}px)`,
          transition: phase === 'turn' ? `transform ${TURN_MS}ms ${EASE}` : undefined,
        }}
      >
        <BadgeBook set={view.set} badges={badges} isMe={isMe} full={full} coverRef={coverRef} onSpreadChange={onSpread} />
      </div>
      {opening?.to && (
        <Flyer
          set={opening.set} badges={badges} isMe={isMe} full={full} spot={opening.from} to={opening.to} spread={0}
          at={phase === 'fly' || phase === 'lift' ? 'shelf' : phase === 'flyGo' ? 'mid' : 'cover'} lifted={phase === 'lift' || phase === 'flyGo'}
          turned={phase === 'turn' || phase === 'reveal'} fade={phase === 'reveal'}
          anim={phase === 'flyGo' ? 'fly' : phase === 'grow' ? 'grow' : phase === 'turn' ? 'turn' : null}
        />
      )}
      {/* Closing: the shelf, laid out unseen (to find the book's spot), shows as the book flies home */}
      {closing && (
        <div
          className="absolute inset-x-0 top-0"
          style={{ visibility: closing.phase === 'home' || closing.phase === 'land' || closing.phase === 'settle' ? 'visible' : 'hidden', opacity: closing.phase === 'home' || closing.phase === 'land' || closing.phase === 'settle' ? 1 : 0, transition: 'opacity 320ms ease' }}
        >
          <Shelf {...shelf} badges={badges} full={full} onOpen={() => {}} intro={false} away={closing.set.id} />
        </div>
      )}
      {closing?.spot && (
        <Flyer
          set={closing.set} badges={badges} isMe={isMe} full={full} spot={closing.spot} to={closing.to} spread={closing.spread}
          at={closing.phase === 'home' || closing.phase === 'land' ? 'shelf' : closing.phase === 'settle' ? 'mid' : 'cover'} lifted={closing.phase === 'settle' || closing.phase === 'home'}
          turned={closing.phase === 'prep'} fade={false}
          anim={closing.phase === 'shut' ? 'turn' : closing.phase === 'settle' ? 'grow' : closing.phase === 'home' ? 'home' : closing.phase === 'land' ? 'land' : null}
        />
      )}
    </div>
  )
}

// The closed book in flight. Three nested layers, one motion each, so they never blend into one
// another: (1) fly — slide + resize from the shelf to the middle of the page; (2) glide — slide right
// into place while it opens, carrying the 3D perspective (viewed from the spine) with it; (3) swing
// — a pure rotateY(0 → −180°) around the spine. Sharing one element made the browser blend the
// fly's resize into the swing whenever their timing overlapped, squashing the cover flat instead
// of turning it.
export function Flyer({ set, badges, isMe, full, spot, to, spread, at, turned, fade, anim, lifted = false, defs }: {
  set: BadgeSet; badges: SharedBadges | null; isMe: boolean; full: boolean
  defs?: BadgeDef[]                // a creator's book: its own badges (not in TCG Haven's catalog)
  lifted?: boolean                 // raised off the page: a touch bigger, its shadow spread under it
  spot: DOMRect                    // the book's spot on the shelf
  to: DOMRect                      // where the cover lies on the open book (its right half)
  spread: number                   // the spread the inside of the cover shows
  at: 'shelf' | 'mid' | 'cover'    // in its shelf spot · mid-page in the shelf book's shape · the open book's cover
  turned: boolean                  // the cover swung open
  fade: boolean                    // the real book has taken over
  anim: 'fly' | 'home' | 'grow' | 'turn' | 'land' | null // which motion is running
}) {
  const shift = to.width / 2
  const left = to.left - shift // centred
  // Where the book is: its shelf spot, mid-page in the shelf book's shape (as tall as the cover, centred
  // on it), or exactly over the open book's cover
  const mh = to.height, mw = to.height * (spot.width / spot.height)
  const rect = at === 'shelf' ? { left: spot.left, top: spot.top, width: spot.width, height: spot.height }
    : at === 'mid' ? { left: left + (to.width - mw) / 2, top: to.top, width: mw, height: mh }
    : { left, top: to.top, width: to.width, height: to.height }
  const move = (ms: number, curve: string) => ['left', 'top', 'width', 'height'].map((k) => `${k} ${ms}ms ${curve}`).join(', ')
  // In flight the across and the up/down motions ease differently, so the book travels on a gentle curve
  const arc = (ms: number, across: string, upDown: string) => [`left ${ms}ms ${across}`, `width ${ms}ms ${across}`, `top ${ms}ms ${upDown}`, `height ${ms}ms ${upDown}`].join(', ')
  const turning = turned
  const swinging = anim === 'turn'
  const hidden: React.CSSProperties = { backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }
  return (
    <div className="absolute inset-0 z-[45] pointer-events-none">
      {/* 1 · fly — the book's real size and place (`rect`) */}
      <div
        className="absolute"
        style={{
          ...rect,
          transition: anim === 'fly' ? arc(FLY_MS, 'cubic-bezier(0.3, 0.75, 0.3, 1)', 'cubic-bezier(0.15, 0.9, 0.3, 1)')
            : anim === 'home' ? arc(FLY_MS, 'cubic-bezier(0.45, 0, 0.25, 1)', 'cubic-bezier(0.62, 0, 0.35, 1)')
            : anim === 'grow' ? move(GROW_MS, 'cubic-bezier(0.3, 0, 0.2, 1)')
            : 'none',
          opacity: fade ? 0 : 1,
        }}
      >
        {/* Its shadow on the page while it's lifted — spreading as it rises, gathering as it sets down */}
        <div aria-hidden className="absolute left-[4%] right-[4%] -bottom-[7%] h-[12%] rounded-[50%] bg-[#1c120a] blur-xl"
          style={{ opacity: lifted && at !== 'cover' ? 0.45 : 0, transform: lifted ? 'scale(1.08)' : 'scale(0.85)', transition: `opacity ${LIFT_MS}ms ease, transform ${LIFT_MS}ms ease` }} />
        {/* 1½ · lift — raised off the page, a touch bigger */}
        <div className="absolute inset-0" style={{ transform: lifted ? 'translateY(-10px) scale(1.045)' : 'none', transition: `transform ${anim === 'grow' ? GROW_MS : LIFT_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)` }}>
        {/* The closed book's thickness and shadow: there while it's shut, gone as it opens */}
        <BookThickness look={set.coverStyle} style={{ opacity: at === 'cover' ? 0 : 1, transition: anim === 'grow' ? `opacity ${GROW_MS}ms ease` : 'none' }} />
        {/* 2 · glide (+ the perspective, looking from the spine) */}
        <div
          className="absolute inset-0"
          style={{
            perspective: `${Math.round(to.width * 5)}px`,
            perspectiveOrigin: '0% 50%',
            transform: turning ? `translateX(${shift}px)` : 'translateX(0px)',
            transition: swinging ? `transform ${TURN_MS}ms ${EASE}` : 'none',
          }}
        >
          {/* 3 · swing */}
          <div
            className="absolute inset-0"
            style={{
              transformStyle: 'preserve-3d',
              transformOrigin: 'left center',
              transform: turning ? 'rotateY(-180deg)' : 'rotateY(0deg)',
              transition: swinging ? `transform ${TURN_MS}ms ${EASE}` : 'none',
            }}
          >
            <div className="absolute inset-0" style={hidden}>
              <BookCover set={set} badges={badges} defs={defs} />
              {/* Light falloff: the front of the cover darkens as it turns away */}
              <div
                className="absolute inset-0 rounded-[14px] bg-black"
                style={{ opacity: turning ? 0.45 : 0, transition: swinging ? `opacity ${TURN_MS * 0.5}ms ease-in` : 'none' }}
              />
            </div>
            {/* Inside of the cover = the book's first page (its left half), so you see the page as the
                cover swings over, and it lands exactly where the real page is. Starts in shadow and
                lightens as it lands. */}
            <div className="absolute inset-0 overflow-hidden" style={{ ...hidden, transform: 'rotateY(180deg)' }}>
              <div className="absolute left-0 top-0" style={{ width: to.width * 2 }}>
                <BadgeBook set={set} badges={badges} isMe={isMe} full={full} coverOnly startSpread={spread} defs={defs} />
              </div>
              <div
                className="absolute inset-0 bg-black"
                style={{ opacity: turning ? 0 : 0.5, transition: swinging ? `opacity ${TURN_MS * 0.5}ms ease-out ${TURN_MS * 0.5}ms` : 'none' }}
              />
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  )
}

// ── The shelf ───────────────────────────────────────────────────────────────────────────────

// `away`: the book that's out (open, or flying) — its spot is left empty until it's put back
// `collection`: which shelf — TCG Haven's own books, or the books of the communities joined (each a collection of
// its own, lib/creatorShelf.ts) — switched with the toggle at the top.
function Shelf({ badges, full, onOpen, intro = true, away, collection, onCollection, isMe }: {
  badges: SharedBadges | null; full: boolean; onOpen: (set: BadgeSet, el: HTMLElement) => void; intro?: boolean; away?: string
  collection: ShelfKind; onCollection: (kind: ShelfKind) => void; isMe: boolean
}) {
  const { catalog } = useBadgeCatalog()
  // Every book's pin art starts loading while the shelf shows, so a book's holes and pins are
  // ready when it opens; pointing at a book moves its art to the front of the line.
  useEffect(() => { preloadTrimmedArt(catalog.badges.map((b) => b.imageUrl)) }, [catalog])
  const preloadSet = (set: BadgeSet) => { preloadTrimmedArt(badgesInSet(catalog, set.id).map((b) => b.imageUrl), true); preloadPinInspector() }
  const isHaven = (set: BadgeSet) => bookCollection(set) === HAVEN_COLLECTION
  const haven = catalog.sets.filter(isHaven), community = catalog.sets.filter((x) => !isHaven(x))
  const books = collection === 'community' ? community : haven
  const cols = useShelfColumns(full)
  // progress over the books on this shelf
  const tally = books.reduce((t, set) => {
    const inSet = badgesInSet(catalog, set.id)
    const got = inSet.filter((b) => badgeTier(b, badges?.progress[b.id]) > 0).length
    return { got: t.got + got, all: t.all + inSet.length, done: t.done + (inSet.length > 0 && got === inSet.length ? 1 : 0) }
  }, { got: 0, all: 0, done: 0 })
  return (
    <div className={cn(intro && 'badge-shelf-in')}>
      {/* The heading: which shelf, how far along — and the toggle between the two */}
      <div className="mb-7 flex flex-wrap items-end gap-x-6 gap-y-4">
        {/* the same room for either title, so switching shelves never moves the toggle */}
        <div className="min-w-0 sm:min-w-[23rem] flex-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#8a6420]">{isMe ? 'Your badge books' : 'Badge books'}</p>
          <h1 className="pinbook-serif text-3xl md:text-[36px] font-bold text-ink leading-[1.05] mt-0.5 sm:whitespace-nowrap">{collection === 'community' ? 'Community Badges' : 'Haven Badges'}</h1>
          <p className="mt-1.5 text-sm text-slate-500">
            {books.length === 0 ? (collection === 'community' ? 'Badges from the communities you join' : 'No books yet')
              : <>{books.length} {books.length === 1 ? 'book' : 'books'}{tally.all > 0 && <> · <b className="text-ink tabular-nums">{tally.got}</b> of {tally.all} pins earned</>}{tally.done > 0 && <> · {tally.done} complete</>}</>}
          </p>
        </div>
        <ShelfToggle value={collection} onChange={onCollection} counts={{ haven: haven.length, community: community.length }} />
      </div>

      {books.length === 0 ? (
        <div className="max-w-md mx-auto my-10 text-center rounded-2xl border border-dashed border-[#c9b48a] bg-[#efe4cc]/60 px-6 py-10">
          <div className="mx-auto mb-4 w-14 h-14 rounded-2xl bg-[#7a5230] text-[#fbf6ea] flex items-center justify-center"><Users size={26} /></div>
          <p className="pinbook-serif text-xl font-bold text-ink">{isMe ? 'No community books yet' : 'No community books'}</p>
          <p className="mt-1.5 text-sm text-slate-500">{isMe ? 'Join a community and its badge book lands here — collect the cards to earn its badges.' : 'They haven’t joined any communities yet.'}</p>
          {isMe && <Link href="/friends#communities" className="btn-primary mt-5 !inline-flex"><Users size={15} />Find communities</Link>}
        </div>
      ) : (
        // A bookcase: each row of books stands on one walnut shelf running the whole width — its top surface (what the
        // books stand on) and its front edge — with the books' names under it
        <div className="flex flex-col gap-10">
          {rowsOf(books, cols).map((row, r) => (
            <div key={r}>
              <div className="grid gap-x-6 sm:gap-x-8 items-end px-3 sm:px-5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
                {row.map((set) => (
                  <div key={set.id} className="relative flex justify-center">
                    {/* where it stands: its shadow pooled on the shelf, darkest right under it */}
                    <span aria-hidden className="absolute z-[1] -bottom-[9px] left-1/2 -translate-x-1/2 w-[96%] max-w-[232px] h-[16px] rounded-[50%] bg-[#1c0f05]/55 blur-[5px] pointer-events-none" />
                    <button
                      data-book={set.id}
                      onClick={(e) => onOpen(set, e.currentTarget.querySelector('[data-cover]') as HTMLElement)}
                      onPointerEnter={() => preloadSet(set)}
                      onPointerDown={() => preloadSet(set)}
                      onFocus={() => preloadSet(set)}
                      style={away === set.id ? { visibility: 'hidden' } : undefined}
                      className="badge-book-tile group relative z-[2] -mb-[11px] w-full max-w-[240px] aspect-[0.71] outline-none"
                      aria-label={`Open the ${set.name} pin book`}
                    >
                      <BookThickness look={set.coverStyle} />
                      <span data-cover className="absolute inset-0"><BookCover set={set} badges={badges} /></span>
                    </button>
                  </div>
                ))}
              </div>
              {/* the shelf: its top (lit, seen from just above) and its front edge, with the shadow under it */}
              <div aria-hidden className="relative">
                {/* the top, seen from just above: narrower at the back, darker where it meets the wall, wood grain along it */}
                <div className="h-[20px] [clip-path:polygon(1.2%_0,98.8%_0,100%_100%,0_100%)]"
                  style={{ background: 'repeating-linear-gradient(90deg, rgba(60,32,12,0.10) 0 2px, transparent 2px 9px, rgba(255,230,190,0.06) 9px 11px, transparent 11px 23px), linear-gradient(180deg, #5c3b20 0%, #8c6038 45%, #b38450 100%)' }} />
                {/* the front edge: a lit lip along its top, the grain running across, darkening underneath */}
                <div className="h-[22px] rounded-b-[4px] shadow-[0_22px_26px_-14px_rgba(30,15,5,0.7),0_4px_6px_-2px_rgba(30,15,5,0.35)]"
                  style={{ background: 'linear-gradient(180deg, rgba(255,226,180,0.55) 0 1px, transparent 1px), repeating-linear-gradient(90deg, rgba(40,20,6,0.16) 0 1px, transparent 1px 7px, rgba(255,220,170,0.07) 7px 9px, transparent 9px 17px), linear-gradient(180deg, #7a5030 0%, #6a4426 55%, #4f3119 100%)' }} />
              </div>
              <div className="mt-3 grid gap-x-6 sm:gap-x-8 px-3 sm:px-5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
                {row.map((set) => {
                  const inSet = badgesInSet(catalog, set.id)
                  const earned = inSet.filter((b) => badgeTier(b, badges?.progress[b.id]) > 0).length
                  return (
                    <div key={set.id} className="mx-auto w-full max-w-[240px] text-center">
                      <div className="text-sm font-bold text-ink truncate">{set.name}</div>
                      {!isHaven(set) && set.subtitle && <div className="text-[11px] text-slate-500 truncate">{set.subtitle.replace(/\s*·\s*Creator Book$/, '')}</div>}
                      <CompletionBar earned={earned} total={inSet.length} />
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Haven Badges | Community Badges — a two-way toggle, the picked side raised in walnut */
function ShelfToggle({ value, onChange, counts }: { value: ShelfKind; onChange: (k: ShelfKind) => void; counts: Record<ShelfKind, number> }) {
  const opts: Array<[ShelfKind, string, React.ReactNode]> = [['haven', 'Haven Badges', <Award key="h" size={15} />], ['community', 'Community Badges', <Users key="c" size={15} />]]
  return (
    <div role="tablist" aria-label="Which pin books" className="relative grid grid-cols-2 p-1 rounded-2xl bg-[#e2d2ad] border border-[#c9b48a] w-full sm:w-auto">
      {/* the walnut slider under the picked side */}
      <span aria-hidden className="absolute top-1 bottom-1 left-1 w-[calc(50%-4px)] rounded-xl bg-[#7a5230] shadow-[0_4px_10px_-4px_rgba(60,35,15,0.6)] transition-transform duration-300 ease-out"
        style={{ transform: value === 'community' ? 'translateX(100%)' : undefined }} />
      {opts.map(([k, label, icon]) => (
        <button key={k} type="button" role="tab" aria-selected={value === k} onClick={() => onChange(k)}
          className={cn('relative z-[1] flex items-center justify-center gap-2 px-3 sm:px-5 py-2.5 text-sm font-bold whitespace-nowrap transition-colors', value === k ? 'text-[#fbf6ea]' : 'text-[#5c4a35] hover:text-ink')}>
          {icon}
          {/* a phone has room for the short name */}
          <span className="sm:hidden">{label.replace(' Badges', '')}</span><span className="hidden sm:inline">{label}</span>
          <span className={cn('min-w-[20px] px-1.5 rounded-full text-[11px] tabular-nums', value === k ? 'bg-white/20' : 'bg-[#7a5230]/[0.12]')}>{counts[k]}</span>
        </button>
      ))}
    </div>
  )
}

function BookHeader({ set, badges, ownerName, isMe }: { set: BadgeSet; badges: SharedBadges | null; ownerName: string; isMe: boolean }) {
  const { catalog } = useBadgeCatalog()
  const inSet = badgesInSet(catalog, set.id)
  const earned = inSet.filter((b) => badgeTier(b, badges?.progress[b.id]) > 0).length
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
function CompletionBar({ earned, total }: { earned: number; total: number }) {
  const pct = total ? Math.round((earned / total) * 100) : 0
  const complete = total > 0 && earned === total
  // A finished book: a parchment ribbon with notched ends, engraved — still, no shine (TCG Haven's flat style)
  if (complete) {
    return (
      <div className="mt-2 flex justify-center">
        <span className="relative inline-flex items-center gap-1 px-[18px] py-[4px] whitespace-nowrap bg-[#efe2c2] text-[#5a3a1c] border-y border-[#b8995f]"
          style={{ clipPath: 'polygon(0 0, 100% 0, calc(100% - 9px) 50%, 100% 100%, 0 100%, 9px 50%)' }}>
          <Check size={13} strokeWidth={3} className="text-[#7a5230]" />
          <span className="pinbook-serif text-[11px] font-bold uppercase tracking-[0.08em]">Book complete</span>
        </span>
      </div>
    )
  }
  // On its way: a flat parchment track filling in walnut, the count beside it
  return (
    <div className="mt-2">
      <div className="h-2 rounded-full bg-[#e6d6b0] border border-[#c9b48a] overflow-hidden">
        <div className="h-full rounded-full bg-[#7a5230] transition-[width] duration-700 ease-out" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] font-semibold text-slate-500">
        <span>{!total ? 'First pins coming soon' : `${earned} / ${total} ${total === 1 ? 'pin' : 'pins'}`}</span>
        {total > 0 && <span className="tabular-nums">{pct}%</span>}
      </div>
    </div>
  )
}

// The closed book's thickness: the page block peeking out below and right of the cover, with the
// shadow it casts. Drawn under the cover on the shelf and under the flying book (opening and closing),
// so the book keeps its whole shape in flight.
export function BookThickness({ style, pageColor, look }: { style?: React.CSSProperties; pageColor?: string; look?: CoverStyle }) {
  // look: a creator's page edges (CoverStyle page* — lib/pageEdges.ts), the block showing past the
  // cover; pageColor alone = plain paper in that colour (older books)
  const edge = pageEdgeCss(look ?? (pageColor ? { pageColor } : undefined))
  const d = Math.max(2, Math.min(14, look?.pageDepth ?? PAGE_DEPTH))
  return (
    <>
      <span className="absolute inset-0 rounded-[14px] bg-[#0f0d0c] shadow-[0_14px_24px_-10px_rgba(40,25,10,0.7)]" style={{ ...style, transform: `translate(${d}px, ${d}px)` }} />
      <span className="absolute inset-0 rounded-[14px] bg-[#221d1a]"
        style={edge ? { ...style, background: edge, transform: `translate(${d / 2}px, ${d / 2}px)` } : { ...style, transform: `translate(${d / 2}px, ${d / 2}px)` }} />
    </>
  )
}

/** A creator's cover (Creator Studio): their picture (a creator cover always has one — until then it's
 *  plain tan), an optional spine down the left that the picture sits beside (CoverSpine), and their
 *  lettering — the title's font, size, colour and height, the line above it and the earned count */
function StyledCover({ set, inSet, earned, emptyLabel }: { set: BadgeSet; inSet: BadgeDef[]; earned: number; emptyLabel: string }) {
  const st = set.coverStyle!
  const font = coverFont(st.font)
  const finish = titleFinish(st.titleFinish)
  useEffect(() => { loadCoverFonts([st.font]) }, [st.font])
  const spine = spineOf(st)
  const area = coverArea(st)
  const inArea = { left: `${area.left}%`, width: `${area.width}%` }
  return (
    <div className="absolute inset-0 overflow-hidden rounded-[10px] shadow-[0_14px_30px_-12px_rgba(0,0,0,0.7)]" style={{ background: BLANK_COVER, containerType: 'inline-size' }}>
      {/* The picture, where the creator placed it in the space beside the spine */}
      <div className="absolute inset-y-0 overflow-hidden" style={inArea}>
        {set.coverImage && (set.coverFit ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={badgeAsset(set.coverImage)} alt="" draggable={false} className="absolute max-w-none select-none"
            style={{ left: `${50 + set.coverFit.x}%`, top: `${50 + set.coverFit.y}%`, width: `${set.coverFit.scale * 100}%`, transform: 'translate(-50%, -50%)' }} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={badgeAsset(set.coverImage)} alt="" draggable={false} className="absolute inset-0 w-full h-full object-cover" />
        ))}
        {/* The hinge's shadow falling on the cover */}
        {spine && <div className="absolute inset-y-0 left-0 w-[7%] bg-gradient-to-r from-black/35 to-transparent pointer-events-none" />}
      </div>
      {spine && <CoverSpine st={st} />}
      {/* The title (and the line above it), where the creator put it */}
      <div className="absolute flex flex-col items-center text-center -translate-y-1/2 pointer-events-none px-[5%]" style={{ ...inArea, top: `${st.titleY ?? 38}%` }}>
        {st.showSubtitle !== false && set.subtitle && (
          <div className="font-black tracking-[0.3em] uppercase" style={{ fontSize: 'clamp(6px,3.4cqw,13px)', color: st.subtitleColor ?? COVER_TEXT_GOLD, textShadow: '0 1px 2px rgba(0,0,0,0.6)' }}>{set.subtitle}</div>
        )}
        <div className={cn('relative mt-[2%] max-w-full', st.titlePlate && 'cover-title-plate px-[6%] py-[2%] rounded-[4px]')}>
          <div className={cn('leading-[1.05] [overflow-wrap:normal] [word-break:keep-all]', font.upper && 'uppercase', font.id === 'haven' && 'tracking-[0.12em]')}
            style={{
              // Wraps only between words; wide all-capitals fonts start a little smaller so names fit
              fontFamily: font.css, fontWeight: font.weight, fontSize: `calc(clamp(13px, ${font.upper ? 9 : 11}cqw, 44px) * ${st.titleSize ?? 1})`,
              ...(finish
                // Metal foil, like TCG Haven's covers: a gradient inside the letters, the shadow as a filter
                ? {
                    backgroundImage: `linear-gradient(180deg, ${finish.gradient})`,
                    WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
                    filter: 'drop-shadow(0 2px 2px rgba(0,0,0,0.95)) drop-shadow(0 0 10px rgba(0,0,0,0.6))',
                  }
                : { color: st.titleColor ?? '#fbe9c4', textShadow: '0 2px 0 rgba(0,0,0,0.45), 0 0 12px rgba(0,0,0,0.35)' }),
            }}>
            {set.name}
          </div>
        </div>
      </div>
      {/* No emblem on creator covers any more (2026-11-12) — old showEmblem / emblemColor are ignored */}
      {st.showCount !== false && (
        <div className="absolute bottom-[8%] flex justify-center" style={inArea}>
          <span className="rounded-full px-2.5 py-0.5 text-[10px] font-bold" style={{ background: 'rgba(0,0,0,0.5)', color: st.countColor ?? COVER_TEXT_GOLD }}>
            {inSet.length ? `${earned} / ${inSet.length} earned` : emptyLabel}
          </span>
        </div>
      )}
    </div>
  )
}

/** A creator cover's text and emblem colour until they pick one — never the cover's stitching colour */
const COVER_TEXT_GOLD = '#e8b35a'

// A Badge Set's closed book: leather cover in the set's colors, stitched spine, strap + snap,
// embossed title and the set's first pin.
export function BookCover({ set, badges, defs, emptyLabel = 'Coming soon' }: { set: BadgeSet; badges: SharedBadges | null; defs?: BadgeDef[]; emptyLabel?: string }) {
  const { catalog } = useBadgeCatalog()
  // A creator book's badges come with it (lib/creatorBooks.ts); TCG Haven's are in the catalog
  const inSet = defs ?? badgesInSet(catalog, set.id)
  const first = inSet[0]
  const earned = inSet.filter((b) => badgeTier(b, badges?.progress[b.id]) > 0).length
  const { from, to, accent } = set.cover
  if (set.coverStyle) return <StyledCover set={set} inSet={inSet} earned={earned} emptyLabel={emptyLabel} />
  if (set.coverImage) {
    return (
      <div className="absolute inset-0 rounded-[10px] overflow-hidden shadow-[0_14px_30px_-12px_rgba(0,0,0,0.7)]" style={set.coverFit ? { background: `linear-gradient(150deg, ${from}, ${to})` } : undefined}>
        {set.coverFit ? (
          // A creator's picture where they placed it (CoverDesigner), over their leather
          // eslint-disable-next-line @next/next/no-img-element
          <img src={badgeAsset(set.coverImage)} alt="" draggable={false} className="absolute max-w-none select-none"
            style={{ left: `${50 + set.coverFit.x}%`, top: `${50 + set.coverFit.y}%`, width: `${set.coverFit.scale * 100}%`, transform: 'translate(-50%, -50%)' }} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={badgeAsset(set.coverImage)} alt="" draggable={false} className="absolute inset-0 w-full h-full object-cover" />
        )}
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
            {inSet.length ? `${earned} / ${inSet.length} earned` : emptyLabel}
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
            <span className="flex items-center justify-center" style={{ width: 70, height: 70 * 1.12 }}><BadgePin art={first.art} imageUrl={first.imageUrl} size={pinSize(first, 70)} ghost={badgeTier(first, badges?.progress[first.id]) === 0} /></span>
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
          {inSet.length ? `${earned} / ${inSet.length} earned` : emptyLabel}
        </div>
      </div>
    </div>
  )
}

/** How many books stand on a shelf at this window width (the same steps as the page's layout) */
function useShelfColumns(full: boolean) {
  const steps = full ? [[1280, 5], [1024, 4], [640, 3]] : [[1024, 4], [640, 3]]
  const pick = () => (typeof window === 'undefined' ? 4 : steps.find(([w]) => window.innerWidth >= w)?.[1] ?? 2)
  const [n, setN] = useState(pick)
  useEffect(() => {
    const on = () => setN(pick())
    on(); window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [full]) // eslint-disable-line react-hooks/exhaustive-deps
  return n
}
const rowsOf = <T,>(list: T[], n: number) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n))
