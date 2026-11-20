'use client'

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { PinInspector } from './pinInspectorLoader'
import { ChevronLeft, ChevronRight, ChevronDown, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { badgesInSet, badgeTier, chaptersOf, type BadgeDef, type BadgeSet } from '@/lib/badges'
import type { SharedBadges } from '@/lib/firebase/badges'
import { useBadgeCatalog } from '@/lib/badgeCatalog'
import { badgeAsset } from '@/lib/badgeAssets'
import { buildPages, PinPage, PinholeFilter, ROMAN, type Page } from './BadgeBook'
import { badgeCardsOpen } from './BadgeCards'
import { BookCover, BookThickness } from './BadgeLibrary'
import { haptic } from '@/lib/nativeApp'


// The pin book on a phone held upright. A whole two-page spread on a narrow screen made every pin
// tiny, so here the book fills the screen and you look at ONE page at a time:
//
//   open   — the closed book flies up from the shelf to fill the screen, then its cover swings open
//            on the spine while the camera glides with it, landing on the first (left) page.
//   next   — on a left page: the camera pans across the spread to the right page.
//            on a right page: the page turns over in 3D (pinned at the spine) while the camera
//            glides with it, landing on the next left page — the same motion as opening the cover.
//   back   — the reverse of each.
//   jump   — a chapter picked from the menu: the new page slides in over the old one.
//   close  — the reverse of opening: the cover swings shut over the page you're on, then the closed
//            book flies back into its (empty) spot on the shelf.
//
// No page is ever drawn twice. Every page is one element, keyed by its page number, that keeps its
// place (even pages on the left, odd on the right) and only changes its role — flat on the spread,
// underneath it, the front of a turning page, the back of one landing, or "ready" (out of sight,
// already drawn) for the next turn either way. Redrawing a page as a new element made its pin
// pictures and pinhole masks load again mid-motion: pins blinking in and out.
//
// The flight keeps the shelf book's own shape: it flies between the shelf and the middle of the
// screen changing only its real size (no stretch or scale, so it always looks like the shelf's book),
// and only there grows to fill the screen (or settles back from it).
//
// Everything is drawn on one "scene": the open spread, two screen-wide pages either side of the
// spine, with the camera (a translateX) choosing which half is on screen. The state after every
// motion is laid out exactly as the motion ends, so nothing ever jumps when it finishes.

// Two-page mode: a page's width as a share of its height (the spread is two of these)
const DUO_PAGE_ASPECT = 0.72
// The turn arrows (globals.css .phonebook-arrow is 48px round) and their gap from the book's edge
const ARROW_PX = 48
const ARROW_GAP = 10
const FLY_MS = 560
const GROW_MS = 240 // the closed book filling the screen (or settling back) in place
const OPEN_MS = 820 // the cover swinging open — a little grander than a page
const TURN_MS = 640
const PAN_MS = 420
const SHUT_MS = 700
const JUMP_MS = 420
const CLOSE_MS = 260
const EASE_TURN = 'cubic-bezier(0.55, 0.05, 0.25, 1)'
const EASE_PAN = 'cubic-bezier(0.65, 0, 0.3, 1)'
const RIM = 7 // the cover showing round the page (top, bottom and the outer edge)

type Anim =
  | { kind: 'fly'; go: boolean }            // shelf → the middle, in the book's own shape
  | { kind: 'grow'; go: boolean }           // the middle → filling the page area
  | { kind: 'shrink'; to: DOMRect; go: boolean } // filling the page area → the middle
  | { kind: 'pan'; to: number; go: boolean }
  | { kind: 'turn'; dir: 1 | -1; to: number; go: boolean }
  | { kind: 'jump'; to: number; go: boolean }
  | { kind: 'close'; go: boolean }          // a plain fade (reduced motion, or the shelf spot is gone)
  | { kind: 'shut'; go: boolean }           // the cover swinging shut
  | { kind: 'flyBack'; to: DOMRect; go: boolean }

// The motions inside the open book (vs the flights between it and the shelf)
const IN_BOOK = new Set<Anim['kind']>(['pan', 'turn', 'shut', 'jump'])
const BLANK: Page = { kind: 'blank' } // one object, so a blank page isn't redrawn every frame

type Content = Page | 'cover' | null
type Side = 'left' | 'right'

export function PhoneBook({ set, badges, isMe, from, getShelfSpot, onClose }: {
  set: BadgeSet
  badges: SharedBadges | null
  isMe: boolean
  /** Where the closed book was on the shelf (window coordinates); null = open without the flight */
  from: DOMRect | null
  /** Where the book's spot on the shelf is now (window coordinates), to fly back to */
  getShelfSpot: () => DOMRect | null
  onClose: () => void
}) {
  const { catalog } = useBadgeCatalog()
  const setBadges = useMemo(() => badgesInSet(catalog, set.id), [catalog, set.id])
  const chapters = useMemo(() => chaptersOf(catalog, set.id), [catalog, set.id])
  const { pages: PAGES, starts } = useMemo(() => buildPages(setBadges, chapters), [setBadges, chapters])
  const N = PAGES.length
  const earned = setBadges.filter((b) => badgeTier(b, badges?.progress[b.id]) > 0).length

  // -1 = the closed cover (before it opens); otherwise the page on screen
  const [p, setP] = useState(from ? -1 : 0)
  const [anim, setAnim] = useState<Anim | null>(from ? { kind: 'fly', go: false } : null)
  const [flash, setFlash] = useState<{ chapter: number; n: number } | null>(null)
  const [menu, setMenu] = useState(false)
  const [inspect, setInspect] = useState<BadgeDef | null>(null)
  // A turn or pan is past its middle (the turning page edge-on): only then do the page count and the
  // chapter in the top bar change — changing them on the tap read as the pins changing before the page moved
  const [halfway, setHalfway] = useState(false)

  // The page area: everything under the top bar
  const areaRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<DOMRect | null>(null)
  // Two-page mode (a phone turned sideways — the space wider than tall): the page area is the whole
  // spread, both pages side by side at full height and centred, and every turn turns a page (no pan
  // between halves). Upright it's a page at a time, as always. Turning the phone just re-measures.
  // (The computer's book, used sideways before, blinked its pins on every turn — 2026-11-20.)
  const [duoWidth, setDuoWidth] = useState<number | null>(null)
  useLayoutEffect(() => {
    const measure = () => {
      const el = areaRef.current
      if (!el?.parentElement) return
      const h = el.getBoundingClientRect().height, pw = el.parentElement.clientWidth
      const duo = pw > h * 1.1
      // room either side for the turn arrows, off the book's edges
      setDuoWidth(duo ? Math.round(2 * Math.min(pw / 2 - (ARROW_PX + ARROW_GAP + 12), h * DUO_PAGE_ASPECT)) : null)
      setBox(el.getBoundingClientRect())
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])
  // The area's box once its two-page width is applied (or taken off)
  useLayoutEffect(() => { if (areaRef.current) setBox(areaRef.current.getBoundingClientRect()) }, [duoWidth])
  const duo = duoWidth != null

  // The page behind stays put while the book is open (and its endless shines pause — globals.css)
  useEffect(() => {
    const html = document.documentElement
    const prev = html.style.overflow
    html.style.overflow = 'hidden'
    html.classList.add('phonebook-open')
    return () => { html.style.overflow = prev; html.classList.remove('phonebook-open') }
  }, [])

  // Each motion: lay out its start, start it, then settle into its end state.
  // A motion inside the book starts at once, in the same frame as its start layout (the styles are
  // flushed first so it still transitions): waiting two frames made a swipe feel late. The flights
  // keep the two frames — the shelf book's spot has to be on screen first.
  useLayoutEffect(() => {
    if (!anim || !box || anim.go) return
    if (IN_BOOK.has(anim.kind)) {
      void areaRef.current?.offsetWidth
      setAnim((a) => (a ? { ...a, go: true } : a))
      return
    }
    const r = requestAnimationFrame(() => requestAnimationFrame(() => setAnim((a) => (a ? { ...a, go: true } : a))))
    return () => cancelAnimationFrame(r)
  }, [anim, box])

  // Settle when the motion has really finished: the element marked data-end (the one whose
  // transition ends last) says so. A timer alone fired before the end whenever the phone was slow
  // to start the motion — the page snapped the rest of the way. The timer stays as the fallback.
  useEffect(() => {
    if (!anim?.go || !box) return
    const ms = {
      fly: FLY_MS + 60, grow: GROW_MS + 80, shrink: GROW_MS + 80, flyBack: FLY_MS + 40,
      pan: PAN_MS, turn: p === -1 ? OPEN_MS : TURN_MS, shut: SHUT_MS, jump: JUMP_MS, close: CLOSE_MS,
    }[anim.kind] + (IN_BOOK.has(anim.kind) ? 250 : 0)
    const a = anim
    let done = false
    const settle = () => {
      if (done) return
      done = true
      if (a.kind === 'fly') setAnim({ kind: 'grow', go: false })
      else if (a.kind === 'grow') setAnim({ kind: 'turn', dir: 1, to: 0, go: false }) // now the cover opens
      else if (a.kind === 'close' || a.kind === 'flyBack') onClose()
      else if (a.kind === 'shut') {
        // Shut: the closed cover fills the screen — settle it into its own shape, then fly it home
        setP(-1)
        const spot = getShelfSpot()
        setAnim(spot ? { kind: 'shrink', to: spot, go: false } : { kind: 'close', go: false })
      }
      else if (a.kind === 'shrink') setAnim({ kind: 'flyBack', to: a.to, go: false })
      else {
        setP(a.to)
        setAnim(null)
        if (a.kind === 'jump') {
          const page = PAGES[a.to]
          if (page?.kind === 'badges') setFlash((f) => ({ chapter: page.chapter, n: (f?.n ?? 0) + 1 }))
        }
      }
    }
    const onEnd = (e: TransitionEvent) => {
      if (e.propertyName === 'transform' && (e.target as HTMLElement).dataset?.end !== undefined) settle()
    }
    const root = areaRef.current
    root?.addEventListener('transitionend', onEnd)
    const t = setTimeout(settle, ms)
    const h = IN_BOOK.has(a.kind) ? setTimeout(() => setHalfway(true), a.kind === 'jump' ? 0 : (ms - 250) / 2) : undefined
    return () => { clearTimeout(t); clearTimeout(h); setHalfway(false); root?.removeEventListener('transitionend', onEnd) }
  }, [anim, box, onClose, PAGES, p, getShelfSpot])

  const busy = !!anim
  // Two-page mode: the spread's right page turns forward, its left page back (so a turn is from them)
  const rightPage = p % 2 === 0 ? p + 1 : p, leftPage = p % 2 === 1 ? p - 1 : p
  const canNext = p >= 0 && (duo ? rightPage < N - 1 : p < N - 1)
  const canPrev = duo ? leftPage > 0 : p > 0
  const next = useCallback(() => {
    if (busy || !canNext) return
    setMenu(false)
    haptic('selection') // a light tick per page in the iPhone app
    if (duo) { setAnim({ kind: 'turn', dir: 1, to: rightPage + 1, go: false }); return }
    setAnim(p % 2 === 0 ? { kind: 'pan', to: p + 1, go: false } : { kind: 'turn', dir: 1, to: p + 1, go: false })
  }, [busy, canNext, duo, rightPage, p])
  const prev = useCallback(() => {
    if (busy || !canPrev) return
    setMenu(false)
    haptic('selection')
    if (duo) { setAnim({ kind: 'turn', dir: -1, to: leftPage - 1, go: false }); return }
    setAnim(p % 2 === 1 ? { kind: 'pan', to: p - 1, go: false } : { kind: 'turn', dir: -1, to: p - 1, go: false })
  }, [busy, canPrev, duo, leftPage, p])
  const close = useCallback(() => {
    if (busy || p < 0) return
    setMenu(false)
    setAnim(window.matchMedia('(prefers-reduced-motion: reduce)').matches ? { kind: 'close', go: false } : { kind: 'shut', go: false })
  }, [busy, p])
  const pickChapter = (i: number) => {
    setMenu(false)
    const t = starts[i]
    if (busy || t === undefined) return
    if (duo) {
      // Two pages on screen: a chapter already showing just flashes; the next or previous spread is
      // a turn; anything further, a jump
      const spreadOf = (i: number) => Math.floor(i / 2)
      if (spreadOf(t) === spreadOf(p)) setFlash((f) => ({ chapter: i, n: (f?.n ?? 0) + 1 }))
      else if (spreadOf(t) === spreadOf(p) + 1) next()
      else if (spreadOf(t) === spreadOf(p) - 1) prev()
      else { haptic('selection'); setAnim({ kind: 'jump', to: t, go: false }) }
      return
    }
    if (t === p) setFlash((f) => ({ chapter: i, n: (f?.n ?? 0) + 1 }))
    else if (t === p + 1) next()
    else if (t === p - 1) prev()
    else { haptic('selection'); setAnim({ kind: 'jump', to: t, go: false }) }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (inspect || badgeCardsOpen()) return // a badge's 3D view or card list has the keys
      if (e.key === 'ArrowRight') next()
      if (e.key === 'ArrowLeft') prev()
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [next, prev, close, inspect])

  // Swipe to turn — the page goes as soon as the swipe is clear, without waiting for the finger
  // to lift
  const touch = useRef<{ x: number; y: number; done: boolean } | null>(null)
  const onTouchStart = (e: React.TouchEvent) => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, done: false } }
  const onTouchMove = (e: React.TouchEvent) => {
    const s = touch.current
    if (!s || s.done) return
    const dx = e.touches[0].clientX - s.x, dy = e.touches[0].clientY - s.y
    if (Math.abs(dx) > 28 && Math.abs(dx) > Math.abs(dy) * 1.3) { s.done = true; (dx < 0 ? next : prev)() }
  }
  const onTouchEnd = () => { touch.current = null }

  const W = (box?.width ?? 0) / (duo ? 2 : 1) // one page's width (two-page mode: the area holds both)
  const H = box?.height ?? 0
  const pin = Math.max(44, Math.min(200, (W - RIM) * 0.33, (H - RIM * 2) * 0.215))
  // Kept the same between renders, so starting a motion redraws no pins (Half is memoized)
  const pageProps = useMemo(() => ({ badges, isMe, pin, onInspect: setInspect, flash }), [badges, isMe, pin, flash])
  const page = (i: number): Content => (i === -1 ? 'cover' : PAGES[i] ?? BLANK)
  const go = !!anim?.go

  // Every page in play and its role (see the top of the file). First role given to a page wins.
  type Role = 'flat' | 'under' | 'front' | 'back' | 'ready' | 'hidden' | 'parked'
  const roles = new Map<number, Role>()
  const give = (i: number, r: Role) => { if (i >= -1 && i < N && !roles.has(i)) roles.set(i, r) }
  let camFrom: number, camTo: number
  if (anim?.kind === 'turn' && anim.dir === 1) {
    // Turning the right-hand page (or the cover) over to the left: under it, the next spread's
    // right page; the camera glides left to follow the page's back as it lands.
    // (two-page mode: the turning page is the spread's right page, wherever p stood)
    const f = duo && p >= 0 ? rightPage : p
    give(f, 'front'); give(anim.to, 'back'); give(f - 1, 'flat'); give(anim.to + 1, 'under')
    // the pages that were ready the other way stay as they were (a layer dropped and rebuilt
    // mid-turn costs a frame), and the next spread stays drawn
    give(f - 2, 'ready'); give(f - 3, 'under')
    for (const i of [f + 3, f + 4]) give(i, 'parked')
    camFrom = -W; camTo = 0
  } else if (anim?.kind === 'turn') {
    const f = duo ? leftPage : p // two-page mode: the spread's left page turns back
    give(f, 'front'); give(anim.to, 'back'); give(f + 1, 'flat'); give(anim.to - 1, 'under')
    give(f + 2, 'ready'); give(f + 3, 'under')
    for (const i of [f - 3, f - 4]) give(i, 'parked')
    camFrom = 0; camTo = -W
  } else if (anim?.kind === 'shut') {
    // Closing: the left page (the inside of the cover) swings over onto the right page, landing as
    // the front of the cover; the camera ends on the right half, where the closed book now is.
    const left = p % 2 === 0 ? p : p - 1
    give(left, 'front'); give(-1, 'back'); give(left + 1, 'under')
    camFrom = p % 2 === 0 ? 0 : -W; camTo = -W
  } else if (p === -1) {
    // The shut book — its first two pages already drawn, out of sight, for the cover to open onto
    give(-1, 'flat'); give(0, 'ready'); give(1, 'under')
    camFrom = camTo = -W
  } else {
    const left = p % 2 === 0 ? p : p - 1
    give(left, 'flat'); give(left + 1, 'flat')
    if (anim?.kind === 'jump') { give(anim.to, 'hidden'); give(anim.to % 2 === 0 ? anim.to + 1 : anim.to - 1, 'hidden') }
    // ready for the next turn either way
    if (left + 2 < N) { give(left + 2, 'ready'); give(left + 3, 'under') }
    if (left - 1 >= 0) { give(left - 1, 'ready'); give(left - 2, 'under') }
    // and one spread further, already drawn but not yet layers ('parked'), so when a turn settles no
    // page is drawn for the first time (that was the blink at the end of a turn)
    for (const i of [left + 4, left + 5, left - 3, left - 4]) give(i, 'parked')
    camFrom = p % 2 === 1 ? -W : 0
    camTo = anim?.kind === 'pan' ? (anim.to % 2 === 1 ? -W : 0) : camFrom
  }
  // The cover, in every state of the open book (never unmounted and redrawn): drawn under everything,
  // so closing the book doesn't draw it mid-swing. give() keeps a role it already has.
  if (p >= 0) give(-1, 'hidden')
  // Two-page mode: the whole spread is on screen, so the camera stays put — except around the cover,
  // which opens like the computer's book: the closed book sits centred (the scene half a page to the
  // left, the cover being the right half), and as the cover swings open the book glides into place at
  // the same pace, the open spread ending centred; closing is the reverse (2026-11-20 — it went to
  // the right half first, then opened)
  if (duo) {
    const centred = -W / 2
    if (anim?.kind === 'shut') { camFrom = 0; camTo = centred }
    else if (p === -1) { camFrom = centred; camTo = anim?.kind === 'turn' ? 0 : centred }
    else camFrom = camTo = 0
  }
  const cam = go ? camTo : camFrom
  const moving = go && (anim?.kind === 'turn' || anim?.kind === 'pan' || anim?.kind === 'shut')
  const ease = anim?.kind === 'pan' ? EASE_PAN : EASE_TURN
  const ms = anim?.kind === 'pan' ? PAN_MS : anim?.kind === 'shut' ? SHUT_MS : p === -1 ? OPEN_MS : TURN_MS
  const flying = anim?.kind === 'fly' || anim?.kind === 'grow' || anim?.kind === 'shrink' || anim?.kind === 'flyBack'
  const leaving = anim?.kind === 'shut' || anim?.kind === 'shrink' || anim?.kind === 'flyBack' || anim?.kind === 'close'
  const opened = !leaving && (p >= 0 || (anim?.kind === 'turn' && go))
  const closing = anim?.kind === 'close'
  const jumpDir = anim?.kind === 'jump' ? (anim.to > p ? 1 : -1) : 1
  const shownPage = anim && (anim.kind === 'pan' || anim.kind === 'turn' || anim.kind === 'jump') && go && halfway ? anim.to : Math.max(0, p)
  // The flight: the shelf spot, and the book at its own shape in the middle of the page area
  const spot = anim?.kind === 'fly' || anim?.kind === 'grow' ? from : anim?.kind === 'shrink' || anim?.kind === 'flyBack' ? anim.to : null
  const mid = (() => {
    if (!box || !spot) return null
    const aspect = spot.width / spot.height
    const w = Math.min(W * 0.84, H * 0.84 * aspect), h = w / aspect
    return new DOMRect(box.left + (W - w) / 2, box.top + (H - h) / 2, w, h)
  })()
  const atShelf = (anim?.kind === 'fly' && !go) || (anim?.kind === 'flyBack' && go)
  // How a page looks in its role; `go` = the motion is running
  const half = ms / 2
  // Every page is its own layer at all times (will-change), drawn once while the book is still and
  // then only moved. iPhone Safari draws only what can be seen right now: a page waiting see-through
  // OR edge-on (a line at the spine) was never drawn ahead, so the landing page — pins, pinhole
  // filters and all — was drawn mid-turn: black for most of the turn, then popping in nearly flat
  // (seen in a screen recording, 2026-11-14). So a page out of sight waits flat, under the pages on
  // its side (they're opaque), fully drawn — and only jumps edge-on as its turn starts.
  const pageStyle = (i: number, role: Role): React.CSSProperties => {
    const area: Side = i === -1 || i % 2 === 1 ? 'right' : 'left'
    const lift = area === 'right' ? -90 : 90 // edge-on, its outer edge lifted toward you
    const base: React.CSSProperties = {
      left: area === 'left' ? 0 : W, width: W, height: H,
      transformOrigin: area === 'right' ? 'left center' : 'right center',
      willChange: 'transform',
    }
    switch (role) {
      case 'flat': return { ...base, zIndex: 3, transform: 'rotateY(0deg)' }
      case 'under': return { ...base, zIndex: 2, transform: 'rotateY(0deg)' }
      case 'hidden': return { ...base, zIndex: 0, transform: 'rotateY(0deg)' } // under everything, drawn
      // In the page and drawn (pictures loaded), but not a layer yet and never seen
      case 'parked': return { ...base, zIndex: 0, transform: 'rotateY(0deg)', visibility: 'hidden', willChange: 'auto' }
      case 'ready': return { ...base, zIndex: 1, transform: 'rotateY(0deg)' } // flat under its side's pages, drawn
      case 'front': return {
        ...base, zIndex: 15,
        transform: go ? `rotateY(${lift}deg)` : 'rotateY(0deg)',
        transition: go ? `transform ${half}ms cubic-bezier(0.5, 0, 0.9, 0.55)` : 'none',
      }
      case 'back': return {
        ...base, zIndex: 15,
        transform: go ? 'rotateY(0deg)' : `rotateY(${lift}deg)`,
        transition: go ? `transform ${half}ms cubic-bezier(0.1, 0.45, 0.5, 1) ${half}ms` : 'none',
      }
    }
  }
  const shadeStyle = (i: number, role: Role): React.CSSProperties => {
    const area: Side = i === -1 || i % 2 === 1 ? 'right' : 'left'
    const bg = `linear-gradient(to ${area}, rgba(0,0,0,0.15), rgba(0,0,0,0.6))`
    if (role === 'front') return { background: bg, opacity: go ? 1 : 0, transition: `opacity ${half}ms ease-in` } // darkens rising
    if (role === 'back' || role === 'ready') return { background: bg, opacity: go && role === 'back' ? 0 : 1, transition: go ? `opacity ${half}ms ease-out ${half}ms` : 'none' } // brightens landing
    return { background: bg, opacity: 0 }
  }
  const shownChapter = (() => { const pg = PAGES[Math.max(0, shownPage)]; return pg?.kind === 'badges' ? pg.chapter : -1 })()

  const coverVars = useMemo(() => ({
    ['--leather-from' as string]: set.cover.from,
    ['--leather-to' as string]: set.cover.to,
    ['--accent' as string]: set.cover.accent,
    ...(set.coverImage && { backgroundImage: `url("${badgeAsset(set.coverImage)}")`, backgroundSize: '200% 100%' }),
  } as React.CSSProperties), [set])

  return createPortal(
    <div
      // Sideways (two pages), the page behind shows blurred either side of the book: transparent here,
      // the blur on its own layer behind everything below — never on this box, or iPhone draws the
      // whole book as one flattened group and its pins blink
      className="fixed inset-0 z-[70] flex flex-col bg-[#0b0908] phoneland:bg-transparent"
      style={{
        opacity: closing && go ? 0 : 1,
        transform: closing && go ? 'scale(0.97)' : undefined,
        transition: closing ? `opacity ${CLOSE_MS}ms ease, transform ${CLOSE_MS}ms ease` : undefined,
        // while the book flies up, the backdrop fades in under it (the book itself never fades)
        background: flying ? 'transparent' : undefined,
      }}
      role="dialog"
      aria-label={`${set.name} pin book`}
    >
      {/* Backdrop for the flights: fades in as the book flies up, out as it flies home */}
      {flying && <div className="absolute inset-0 bg-[#0b0908]" style={{ opacity: atShelf || (anim?.kind === 'fly' && !go) ? 0 : 1, transition: `opacity ${FLY_MS}ms ease` }} />}
      <div aria-hidden className="hidden phoneland:block absolute inset-0 -z-10 bg-[#0b0908]/80 backdrop-blur-md" />
      <PinholeFilter />

      {/* Top bar */}
      <div
        className="relative z-30 flex items-center gap-2 px-3 pb-2 transition-opacity duration-300"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 10px)', opacity: opened ? 1 : 0 }}
      >
        <button onClick={close} aria-label="Close the book" className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-white/80 bg-white/[0.07] active:bg-white/15">
          <X size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="pinbook-serif text-[0.9375rem] font-bold uppercase tracking-[0.12em] text-[#f1d58f] truncate">{set.name}</div>
          <div className="text-[0.6875rem] font-semibold text-white/45">{setBadges.length ? `${earned} / ${setBadges.length} earned` : 'Coming soon'}</div>
        </div>
        {chapters.length > 0 && (
          <div className="relative shrink-0">
            <button
              onClick={() => setMenu((m) => !m)}
              className="pinbook-serif h-9 pl-3 pr-2 rounded-full flex items-center gap-1.5 text-[0.8125rem] font-bold text-[#f1d58f] bg-white/[0.07] active:bg-white/15"
              aria-expanded={menu}
            >
              <span>{ROMAN[shownChapter] ?? ''}</span>
              <span className="max-w-[96px] truncate text-white/75">{chapters[shownChapter] ?? 'Chapters'}</span>
              <ChevronDown size={15} className={cn('transition-transform', menu && 'rotate-180')} />
            </button>
            {menu && (
              <div className="phonebook-menu absolute right-0 top-[calc(100%+6px)] w-56 rounded-xl border border-white/10 bg-[#171310]/95 backdrop-blur-md shadow-2xl p-1.5">
                {chapters.map((name, i) => (
                  <button
                    key={name + i}
                    onClick={() => pickChapter(i)}
                    className={cn('pinbook-serif w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm font-bold', i === shownChapter ? 'bg-[#f1d58f]/15 text-[#f6dc98]' : 'text-white/75 active:bg-white/10')}
                  >
                    <span className="w-7 text-[#d9b25e]">{ROMAN[i] ?? i + 1}</span>
                    <span className="truncate">{name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* The page area */}
      <div
        ref={areaRef}
        className="relative flex-1 overflow-hidden"
        // The swipes are ours: without this iPhone could take one as a scroll or a back gesture
        style={{ marginBottom: 'env(safe-area-inset-bottom, 0px)', touchAction: 'none', overscrollBehavior: 'contain', ...(duo && { width: duoWidth, alignSelf: 'center', flex: '1 1 auto' }) }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClick={() => menu && setMenu(false)}
      >
        {box && (
          // A slight camera pull-back while the page moves — it dips away a touch and settles back.
          // Kept (invisible) during the flights too, so the first pages are drawn before the cover opens.
          <div
            // 0.01, not 0: iPhone doesn't draw a fully see-through layer, so the cover and first pages
            // were drawn only as the cover started to open (the page under it black, the rings late)
            style={flying ? { opacity: 0.01, pointerEvents: 'none' } : undefined}
            className={cn('absolute inset-0 will-change-transform', go && anim?.kind === 'pan' && 'phonebook-pull-pan', go && anim?.kind === 'turn' && p >= 0 && 'phonebook-pull-turn', go && anim?.kind === 'shut' && 'phonebook-pull-shut')}
          >
          <div
            className="absolute top-0 left-0 will-change-transform"
            data-end={anim?.kind === 'pan' ? '' : undefined}
            style={{
              width: W * 2, height: H,
              transform: `translateX(${cam}px)`,
              transition: moving ? `transform ${ms}ms ${ease}` : 'none',
              // The 3D view of a turning page, looking from the spine
              perspective: `${Math.round(W * 3.2)}px`,
              perspectiveOrigin: `${W}px 50%`,
              ...(anim?.kind === 'jump' && { opacity: go ? 0 : 1, transform: `translateX(${cam - (go ? jumpDir * W * 0.18 : 0)}px)`, transition: `transform ${JUMP_MS}ms ${EASE_PAN}, opacity ${JUMP_MS}ms ease` }),
            }}
          >
            {/* Every page in play, one element each (keyed by page number) — see the top of the file */}
            {/* In page order, always: a page's element never moves in the page when roles change (moving
                it made iPhone rebuild its layer — pages and rings blinking as a turn ended) */}
            {Array.from(roles.entries()).sort((a, b) => a[0] - b[0]).map(([i, role]) => (
              <div key={`page${i}`} className="phonebook-page absolute top-0" style={pageStyle(i, role)} data-end={role === 'back' ? '' : undefined}>
                {i === -1 ? <BookCover set={set} badges={badges} /> : (
                  <Half content={page(i)} side={i % 2 === 1 ? 'right' : 'left'} placed W={W} H={H} coverVars={coverVars} set={set} badges={badges} pageProps={pageProps} />
                )}
                <div className="absolute inset-0 pointer-events-none" style={shadeStyle(i, role)} />
              </div>
            ))}

            {/* Closing: the right page darkens as the cover comes down over it */}
            {anim?.kind === 'shut' && (
              <div
                className="absolute top-0 pointer-events-none z-[5]"
                style={{ left: W, width: W, height: H, background: 'linear-gradient(to right, rgba(0,0,0,0.75), rgba(0,0,0,0.3))', opacity: go ? 1 : 0, transition: `opacity ${SHUT_MS}ms ease-in` }}
              />
            )}
            {/* A turn shows one page at a time on a phone, so the eye should stay on the turning page.
                The page it uncovers stays in its shadow (it's never the page you land on — it leaves
                the screen as the camera follows), and the page it lands on darkens as it comes down
                over it. Both lit, a different set of pins showed up before the new page arrived. */}
            {anim?.kind === 'turn' && (
              <>
                <div
                  className="absolute top-0 pointer-events-none z-[5]"
                  style={{
                    left: anim.dir === 1 ? W : 0, width: W, height: H,
                    background: `linear-gradient(to ${anim.dir === 1 ? 'right' : 'left'}, rgba(0,0,0,0.72), rgba(0,0,0,0.38))`,
                  }}
                />
                <div
                  className="absolute top-0 pointer-events-none z-[5]"
                  style={{
                    left: anim.dir === 1 ? 0 : W, width: W, height: H,
                    background: `linear-gradient(to ${anim.dir === 1 ? 'left' : 'right'}, rgba(0,0,0,0.7), rgba(0,0,0,0.4))`,
                    opacity: go ? 1 : 0,
                    transition: `opacity ${half}ms ease-out`,
                  }}
                />
              </>
            )}

            {/* Spine + rings: fade in as the cover opens, out as it shuts (a shut book shows none).
                The wrapper is always there and always over the pages (z-20 of its own): while it
                faded, its opacity made it a layer of its own at the pages' level, so the rings went
                UNDER the pages for the whole opening and jumped on top as it ended. Never fully
                see-through either (0.01), so iPhone has them drawn before the cover opens. */}
            <div
              className="absolute top-0 left-0 z-20 pointer-events-none"
              style={{
                width: W * 2, height: H,
                opacity: p === -1 ? (anim?.kind === 'turn' && go ? 1 : 0.01) : anim?.kind === 'shut' && go ? 0.01 : 1,
                transition: (p === -1 && anim?.kind === 'turn') || anim?.kind === 'shut' ? `opacity ${ms}ms ease` : 'none',
              }}
            >
              <Spine x={W} H={H} />
            </div>
          </div>
          </div>
        )}

        {/* A chapter jump: the new page slides in over the old */}
        {box && anim?.kind === 'jump' && (
          <div
            className="absolute top-0 left-0 z-20"
            data-end=""
            style={{
              width: W, height: H,
              opacity: go ? 1 : 0,
              transform: `translateX(${go ? 0 : jumpDir * W * 0.22}px)`,
              transition: `transform ${JUMP_MS}ms ${EASE_PAN}, opacity ${JUMP_MS}ms ease`,
            }}
          >
            <div className="phonebook-page absolute top-0" style={{ left: anim.to % 2 === 1 ? -W : 0, width: W * 2, height: H }}>
              <Half content={page(anim.to)} side={anim.to % 2 === 1 ? 'right' : 'left'} W={W} H={H} coverVars={coverVars} set={set} badges={badges} pageProps={pageProps} />
              <Spine x={W} H={H} />
            </div>
          </div>
        )}

        {/* Turn arrows + where you are, over the bottom of the page */}
        <div
          className="absolute inset-x-0 bottom-0 z-30 flex items-center justify-between px-4 pb-4 pointer-events-none transition-opacity duration-300"
          style={{ opacity: opened ? 1 : 0 }}
        >
          {/* two-page mode: the arrows sit either side of the book instead (below) */}
          <button onClick={prev} disabled={busy || !canPrev} aria-label="Previous page" className={cn('phonebook-arrow pointer-events-auto disabled:opacity-0', duo && 'invisible')}>
            <ChevronLeft size={24} strokeWidth={2.25} className="-ml-0.5" />
          </button>
          <span className="phonebook-count pinbook-serif">{Math.max(1, shownPage + 1)} / {N}</span>
          <button onClick={next} disabled={busy || !canNext} aria-label="Next page" className={cn('phonebook-arrow pointer-events-auto disabled:opacity-0', duo && 'invisible')}>
            <ChevronRight size={24} strokeWidth={2.25} className="ml-0.5" />
          </button>
        </div>
      </div>

      {/* Two-page mode: the turn arrows just off the book's left and right edges, halfway up (this
          box is the whole screen, so the page area's own position places them) */}
      {duo && box && (
        <>
          <button
            onClick={prev} disabled={busy || !canPrev} aria-label="Previous page"
            className="phonebook-arrow absolute z-30 disabled:opacity-0"
            // centred by position, not a transform (its pressed look is a transform: it would jump)
            style={{ left: box.left - ARROW_PX - ARROW_GAP, top: box.top + box.height / 2 - ARROW_PX / 2, ...(!opened && { opacity: 0 }) }}
          >
            <ChevronLeft size={24} strokeWidth={2.25} className="-ml-0.5" />
          </button>
          <button
            onClick={next} disabled={busy || !canNext} aria-label="Next page"
            className="phonebook-arrow absolute z-30 disabled:opacity-0"
            style={{ left: box.right + ARROW_GAP, top: box.top + box.height / 2 - ARROW_PX / 2, ...(!opened && { opacity: 0 }) }}
          >
            <ChevronRight size={24} strokeWidth={2.25} className="ml-0.5" />
          </button>
        </>
      )}

      {/* The closed book between its shelf spot and the page area. It flies in the shelf book's own
          shape — its real size changes, nothing is stretched or scaled, so it looks exactly like the
          shelf's book the whole way and lands without a change — and only in the middle of the
          screen grows to fill it (opening) or settles back from it (closing). */}
      {flying && box && spot && mid && (() => {
        const k = anim?.kind
        // the open-ready cover: the page area — in two-page mode one page, centred (where the closed
        // book sits before it opens, and ends up as it shuts)
        const full = duo ? new DOMRect(box.left + W / 2, box.top, W, H) : box
        const r = atShelf ? spot : (k === 'grow' && go) || (k === 'shrink' && !go) ? full : mid
        const curve = k === 'fly' ? 'cubic-bezier(0.22, 0.8, 0.25, 1)' : k === 'flyBack' ? 'cubic-bezier(0.5, 0, 0.3, 1)' : 'cubic-bezier(0.3, 0, 0.2, 1)'
        const dur = k === 'fly' || k === 'flyBack' ? FLY_MS : GROW_MS
        return (
          <div
            className="fixed z-40 pointer-events-none"
            style={{
              left: r.left, top: r.top, width: r.width, height: r.height,
              transition: go ? ['left', 'top', 'width', 'height'].map((x) => `${x} ${dur}ms ${curve}`).join(', ') : 'none',
            }}
          >
            {/* The closed book's thickness and shadow: there while it flies, gone as it fills the screen */}
            <BookThickness style={{ opacity: r === full ? 0 : 1, transition: k === 'grow' || k === 'shrink' ? `opacity ${GROW_MS}ms ease` : 'none' }} />
            <BookCover set={set} badges={badges} />
          </div>
        )
      })()}

      {inspect && (
        <PinInspector
          def={inspect}
          earnedAt={badges?.earned[inspect.id]}
          progress={badges?.progress[inspect.id]}
          mystery={badgeTier(inspect, badges?.progress[inspect.id]) === 0}
          onClose={() => setInspect(null)}
          cardsFor={{ isMe }}
        />
      )}
    </div>,
    document.body,
  )
}

type PageBits = Omit<React.ComponentProps<typeof PinPage>, 'page' | 'side'>

// One half of the open spread: the cover showing round the page (its rim), and the page on it.
// Placed on its side of a spread-wide box; `placed`: inside a page box that's already on its side
// (pageStyle) — offsetting again put every right-hand page off the spread, leaving it black.
const Half = memo(function Half({ content, side, placed, W, H, coverVars, set, badges, pageProps }: {
  content: Content; side: Side; placed?: boolean; W: number; H: number; coverVars: React.CSSProperties
  set: BadgeSet; badges: SharedBadges | null; pageProps: PageBits
}) {
  if (content === null) return null
  return (
    <div className="absolute top-0" style={{ left: side === 'left' || placed ? 0 : W, width: W, height: H }}>
      {content !== 'cover' && (
        <div
          className={cn('pinbook-cover absolute inset-0', side === 'left' ? 'rounded-l-[14px]' : 'rounded-r-[14px]')}
          style={{ ...coverVars, ...(coverVars.backgroundImage ? { backgroundPosition: side === 'left' ? '0 0' : '100% 0' } : {}) }}
        />
      )}
      <Face content={content} side={side} W={W} H={H} set={set} badges={badges} pageProps={pageProps} />
    </div>
  )
})

// What's printed on one side of a sheet: a page of pins (inset from the cover's rim), or the cover
function Face({ content, side, set, badges, pageProps }: {
  content: Content; side: Side; W: number; H: number
  set: BadgeSet; badges: SharedBadges | null; pageProps: PageBits
}) {
  if (content === null) return null
  if (content === 'cover') return <BookCover set={set} badges={badges} />
  return (
    <div className="absolute" style={{ top: RIM, bottom: RIM, left: side === 'left' ? RIM : 0, right: side === 'right' ? RIM : 0 }}>
      <PinPage page={content} side={side} {...pageProps} />
    </div>
  )
}

// The spine and the binder rings, half on each page
function Spine({ x, H }: { x: number; H: number }) {
  return (
    // Its own layer for good (translateZ): on iPhone, a plain element over the moving pages was moved
    // in and out of a layer as each motion started and ended — the rings snapped
    <div className="absolute top-0 z-20 pointer-events-none" style={{ left: x - 9, width: 18, height: H, transform: 'translateZ(0)', willChange: 'transform' }}>
      <div className="pinbook-spine absolute inset-0" />
      <div className="pinbook-plate absolute left-1/2 -translate-x-1/2 top-[5%] bottom-[5%] w-[12px] rounded-[3px]" />
      {[10, 24, 38, 62, 76, 90].map((top) => (
        <div key={top} className="pinbook-ring absolute left-1/2 -translate-x-1/2 w-[30px] h-[11px] rounded-full" style={{ top: `${top}%` }} />
      ))}
    </div>
  )
}
