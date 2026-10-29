'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import dynamic from 'next/dynamic'
import { ChevronLeft, ChevronRight, ChevronDown, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { badgesInSet, chaptersOf, type BadgeDef, type BadgeSet } from '@/lib/badges'
import type { SharedBadges } from '@/lib/firebase/badges'
import { useBadgeCatalog } from '@/lib/badgeCatalog'
import { badgeAsset } from '@/lib/badgeAssets'
import { buildPages, PinPage, PinholeFilter, ROMAN, type Page } from './BadgeBook'
import { BookCover } from './BadgeLibrary'

const PinInspector = dynamic(() => import('./PinInspector'), { ssr: false })

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
// The flight keeps the book's own shape: it flies (a pure, even scale) between the shelf and the
// middle of the screen, and only there grows to fill the screen (or settles back from it).
//
// Everything is drawn on one "scene": the open spread, two screen-wide pages either side of the
// spine, with the camera (a translateX) choosing which half is on screen. The state after every
// motion is laid out exactly as the motion ends, so nothing ever jumps when it finishes.

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
  const earned = setBadges.filter((b) => badges?.earned[b.id]).length

  // -1 = the closed cover (before it opens); otherwise the page on screen
  const [p, setP] = useState(from ? -1 : 0)
  const [anim, setAnim] = useState<Anim | null>(from ? { kind: 'fly', go: false } : null)
  const [flash, setFlash] = useState<{ chapter: number; n: number } | null>(null)
  const [menu, setMenu] = useState(false)
  const [inspect, setInspect] = useState<BadgeDef | null>(null)

  // The page area: everything under the top bar
  const areaRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<DOMRect | null>(null)
  useLayoutEffect(() => {
    const measure = () => { if (areaRef.current) setBox(areaRef.current.getBoundingClientRect()) }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  // The page behind stays put while the book is open
  useEffect(() => {
    const html = document.documentElement
    const prev = html.style.overflow
    html.style.overflow = 'hidden'
    return () => { html.style.overflow = prev }
  }, [])

  // Each motion: lay out its start, start it on the next frame, then settle into its end state.
  useEffect(() => {
    if (!anim || !box) return
    if (!anim.go) {
      const r = requestAnimationFrame(() => requestAnimationFrame(() => setAnim((a) => (a ? { ...a, go: true } : a))))
      return () => cancelAnimationFrame(r)
    }
    const ms = {
      fly: FLY_MS + 20, grow: GROW_MS + 20, shrink: GROW_MS + 20, flyBack: FLY_MS + 40,
      pan: PAN_MS, turn: p === -1 ? OPEN_MS : TURN_MS, shut: SHUT_MS, jump: JUMP_MS, close: CLOSE_MS,
    }[anim.kind]
    const t = setTimeout(() => {
      if (anim.kind === 'fly') setAnim({ kind: 'grow', go: false })
      else if (anim.kind === 'grow') setAnim({ kind: 'turn', dir: 1, to: 0, go: false }) // now the cover opens
      else if (anim.kind === 'close' || anim.kind === 'flyBack') onClose()
      else if (anim.kind === 'shut') {
        // Shut: the closed cover fills the screen — settle it into its own shape, then fly it home
        setP(-1)
        const spot = getShelfSpot()
        setAnim(spot ? { kind: 'shrink', to: spot, go: false } : { kind: 'close', go: false })
      }
      else if (anim.kind === 'shrink') setAnim({ kind: 'flyBack', to: anim.to, go: false })
      else {
        setP(anim.to)
        setAnim(null)
        if (anim.kind === 'jump') {
          const page = PAGES[anim.to]
          if (page?.kind === 'badges') setFlash((f) => ({ chapter: page.chapter, n: (f?.n ?? 0) + 1 }))
        }
      }
    }, ms)
    return () => clearTimeout(t)
  }, [anim, box, onClose, PAGES, p, getShelfSpot])

  const busy = !!anim
  const next = useCallback(() => {
    if (busy || p < 0 || p >= N - 1) return
    setMenu(false)
    setAnim(p % 2 === 0 ? { kind: 'pan', to: p + 1, go: false } : { kind: 'turn', dir: 1, to: p + 1, go: false })
  }, [busy, p, N])
  const prev = useCallback(() => {
    if (busy || p <= 0) return
    setMenu(false)
    setAnim(p % 2 === 1 ? { kind: 'pan', to: p - 1, go: false } : { kind: 'turn', dir: -1, to: p - 1, go: false })
  }, [busy, p])
  const close = useCallback(() => {
    if (busy || p < 0) return
    setMenu(false)
    setAnim(window.matchMedia('(prefers-reduced-motion: reduce)').matches ? { kind: 'close', go: false } : { kind: 'shut', go: false })
  }, [busy, p])
  const pickChapter = (i: number) => {
    setMenu(false)
    const t = starts[i]
    if (busy || t === undefined) return
    if (t === p) setFlash((f) => ({ chapter: i, n: (f?.n ?? 0) + 1 }))
    else if (t === p + 1) next()
    else if (t === p - 1) prev()
    else setAnim({ kind: 'jump', to: t, go: false })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (inspect) return
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

  const W = box?.width ?? 0
  const H = box?.height ?? 0
  const pin = Math.max(44, Math.min(200, (W - RIM) * 0.33, (H - RIM * 2) * 0.215))
  const pageProps = { badges, isMe, pin, onInspect: setInspect, flash }
  const page = (i: number): Content => (i === -1 ? 'cover' : PAGES[i] ?? { kind: 'blank' })
  const go = !!anim?.go

  // Every page in play and its role (see the top of the file). First role given to a page wins.
  type Role = 'flat' | 'under' | 'front' | 'back' | 'ready' | 'hidden'
  const roles = new Map<number, Role>()
  const give = (i: number, r: Role) => { if (i >= -1 && i < N && !roles.has(i)) roles.set(i, r) }
  let camFrom: number, camTo: number
  if (anim?.kind === 'turn' && anim.dir === 1) {
    // Turning the right-hand page (or the cover) over to the left: under it, the next spread's
    // right page; the camera glides left to follow the page's back as it lands.
    give(p, 'front'); give(anim.to, 'back'); give(p - 1, 'flat'); give(anim.to + 1, 'under')
    camFrom = -W; camTo = 0
  } else if (anim?.kind === 'turn') {
    give(p, 'front'); give(anim.to, 'back'); give(p + 1, 'flat'); give(anim.to - 1, 'under')
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
    camFrom = p % 2 === 1 ? -W : 0
    camTo = anim?.kind === 'pan' ? (anim.to % 2 === 1 ? -W : 0) : camFrom
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
  const shownPage = anim && (anim.kind === 'pan' || anim.kind === 'turn' || anim.kind === 'jump') && go ? anim.to : Math.max(0, p)
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
  const pageStyle = (i: number, role: Role): React.CSSProperties => {
    const area: Side = i === -1 || i % 2 === 1 ? 'right' : 'left'
    const lift = area === 'right' ? -90 : 90 // edge-on, its outer edge lifted toward you
    const base: React.CSSProperties = {
      left: area === 'left' ? 0 : W, width: W, height: H,
      transformOrigin: area === 'right' ? 'left center' : 'right center',
    }
    switch (role) {
      case 'flat': return { ...base, zIndex: 3, transform: 'rotateY(0deg)', opacity: 1 }
      case 'under': return { ...base, zIndex: 2, transform: 'rotateY(0deg)', opacity: 1 }
      case 'hidden': return { ...base, zIndex: 0, transform: 'rotateY(0deg)', opacity: 0 }
      case 'ready': return { ...base, zIndex: 1, transform: `rotateY(${lift}deg)`, opacity: 0 }
      case 'front': return {
        ...base, zIndex: 15,
        transform: go ? `rotateY(${lift}deg)` : 'rotateY(0deg)',
        opacity: go ? 0 : 1,
        transition: go ? `transform ${half}ms cubic-bezier(0.5, 0, 0.9, 0.55), opacity 0s linear ${half}ms` : 'none',
      }
      case 'back': return {
        ...base, zIndex: 15,
        transform: go ? 'rotateY(0deg)' : `rotateY(${lift}deg)`,
        opacity: go ? 1 : 0,
        transition: go ? `transform ${half}ms cubic-bezier(0.1, 0.45, 0.5, 1) ${half}ms, opacity 0s linear ${half}ms` : 'none',
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

  const coverVars = {
    ['--leather-from' as string]: set.cover.from,
    ['--leather-to' as string]: set.cover.to,
    ['--accent' as string]: set.cover.accent,
    ...(set.coverImage && { backgroundImage: `url("${badgeAsset(set.coverImage)}")`, backgroundSize: '200% 100%' }),
  } as React.CSSProperties

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex flex-col bg-[#0b0908]"
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
          <div className="pinbook-serif text-[15px] font-bold uppercase tracking-[0.12em] text-[#f1d58f] truncate">{set.name}</div>
          <div className="text-[11px] font-semibold text-white/45">{setBadges.length ? `${earned} / ${setBadges.length} earned` : 'Coming soon'}</div>
        </div>
        {chapters.length > 0 && (
          <div className="relative shrink-0">
            <button
              onClick={() => setMenu((m) => !m)}
              className="pinbook-serif h-9 pl-3 pr-2 rounded-full flex items-center gap-1.5 text-[13px] font-bold text-[#f1d58f] bg-white/[0.07] active:bg-white/15"
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
        style={{ marginBottom: 'env(safe-area-inset-bottom, 0px)' }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClick={() => menu && setMenu(false)}
      >
        {box && (
          // A slight camera pull-back while the page moves — it dips away a touch and settles back.
          // Kept (invisible) during the flights too, so the first pages are drawn before the cover opens.
          <div
            style={flying ? { opacity: 0, pointerEvents: 'none' } : undefined}
            className={cn('absolute inset-0 will-change-transform', go && anim?.kind === 'pan' && 'phonebook-pull-pan', go && anim?.kind === 'turn' && p >= 0 && 'phonebook-pull-turn', go && anim?.kind === 'shut' && 'phonebook-pull-shut')}
          >
          <div
            className="absolute top-0 left-0 will-change-transform"
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
            {Array.from(roles.entries()).map(([i, role]) => (
              <div key={`page${i}`} className="absolute top-0" style={pageStyle(i, role)}>
                {i === -1 ? <BookCover set={set} badges={badges} /> : (
                  <Half content={page(i)} side={i % 2 === 1 ? 'right' : 'left'} W={W} H={H} coverVars={coverVars} set={set} badges={badges} pageProps={pageProps} />
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
            {/* Under the turning page: the page it uncovers starts in its shadow */}
            {anim?.kind === 'turn' && (
              <div
                className="absolute top-0 pointer-events-none z-[5]"
                style={{
                  left: anim.dir === 1 ? W : 0, width: W, height: H,
                  background: `linear-gradient(to ${anim.dir === 1 ? 'right' : 'left'}, rgba(0,0,0,0.75), rgba(0,0,0,0.25))`,
                  opacity: go ? 0 : 1,
                  transition: `opacity ${ms}ms ease-out`,
                }}
              />
            )}

            {/* Spine + rings: fade in as the cover opens, out as it shuts (a shut book shows none) */}
            {(p >= 0 || anim?.kind === 'turn' || anim?.kind === 'shut') && (
              <div
                style={
                  p === -1 ? { opacity: go ? 1 : 0, transition: `opacity ${ms}ms ease` }
                  : anim?.kind === 'shut' ? { opacity: go ? 0 : 1, transition: `opacity ${ms}ms ease` }
                  : undefined
                }
              >
                <Spine x={W} H={H} />
              </div>
            )}
          </div>
          </div>
        )}

        {/* A chapter jump: the new page slides in over the old */}
        {box && anim?.kind === 'jump' && (
          <div
            className="absolute top-0 left-0 z-20"
            style={{
              width: W, height: H,
              opacity: go ? 1 : 0,
              transform: `translateX(${go ? 0 : jumpDir * W * 0.22}px)`,
              transition: `transform ${JUMP_MS}ms ${EASE_PAN}, opacity ${JUMP_MS}ms ease`,
            }}
          >
            <div className="absolute top-0" style={{ left: anim.to % 2 === 1 ? -W : 0, width: W * 2, height: H }}>
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
          <button onClick={prev} disabled={busy || p <= 0} aria-label="Previous page" className="phonebook-arrow pointer-events-auto disabled:opacity-0">
            <ChevronLeft size={24} strokeWidth={2.25} className="-ml-0.5" />
          </button>
          <span className="phonebook-count pinbook-serif">{Math.max(1, shownPage + 1)} / {N}</span>
          <button onClick={next} disabled={busy || p < 0 || p >= N - 1} aria-label="Next page" className="phonebook-arrow pointer-events-auto disabled:opacity-0">
            <ChevronRight size={24} strokeWidth={2.25} className="ml-0.5" />
          </button>
        </div>
      </div>

      {/* The closed book between its shelf spot and the page area. It flies in its own shape (a pure,
          even scale — nothing re-lays out, so it can't squish), and only in the middle of the screen
          grows to fill it (opening) or settles back from it (closing). */}
      {flying && box && spot && mid && (() => {
        const toShelf = `translate(${spot.left - mid.left}px, ${spot.top - mid.top}px) scale(${spot.width / mid.width})`
        const k = anim?.kind
        const r = (k === 'grow' && go) || (k === 'shrink' && !go) ? box : mid
        return (
          <div
            className="fixed z-40 pointer-events-none"
            style={{
              left: r.left, top: r.top, width: r.width, height: r.height,
              transformOrigin: '0 0',
              transform: atShelf ? toShelf : 'none',
              transition: !go ? 'none'
                : k === 'fly' ? `transform ${FLY_MS}ms cubic-bezier(0.22, 0.8, 0.25, 1)`
                : k === 'flyBack' ? `transform ${FLY_MS}ms cubic-bezier(0.5, 0, 0.3, 1)`
                : ['left', 'top', 'width', 'height'].map((x) => `${x} ${GROW_MS}ms cubic-bezier(0.3, 0, 0.2, 1)`).join(', '),
            }}
          >
            <BookCover set={set} badges={badges} />
          </div>
        )
      })()}

      {inspect && (
        <PinInspector
          def={inspect}
          earnedAt={badges?.earned[inspect.id]}
          progress={badges?.progress[inspect.id]}
          mystery={!badges?.earned[inspect.id]}
          onClose={() => setInspect(null)}
        />
      )}
    </div>,
    document.body,
  )
}

type PageBits = Omit<React.ComponentProps<typeof PinPage>, 'page' | 'side'>

// One half of the open spread: the cover showing round the page (its rim), and the page on it.
function Half({ content, side, W, H, coverVars, set, badges, pageProps }: {
  content: Content; side: Side; W: number; H: number; coverVars: React.CSSProperties
  set: BadgeSet; badges: SharedBadges | null; pageProps: PageBits
}) {
  if (content === null) return null
  return (
    <div className="absolute top-0" style={{ left: side === 'left' ? 0 : W, width: W, height: H }}>
      {content !== 'cover' && (
        <div
          className={cn('pinbook-cover absolute inset-0', side === 'left' ? 'rounded-l-[14px]' : 'rounded-r-[14px]')}
          style={{ ...coverVars, ...(coverVars.backgroundImage ? { backgroundPosition: side === 'left' ? '0 0' : '100% 0' } : {}) }}
        />
      )}
      <Face content={content} side={side} W={W} H={H} set={set} badges={badges} pageProps={pageProps} />
    </div>
  )
}

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
    <div className="absolute top-0 z-20 pointer-events-none" style={{ left: x - 9, width: 18, height: H }}>
      <div className="pinbook-spine absolute inset-0" />
      <div className="pinbook-plate absolute left-1/2 -translate-x-1/2 top-[5%] bottom-[5%] w-[12px] rounded-[3px]" />
      {[10, 24, 38, 62, 76, 90].map((top) => (
        <div key={top} className="pinbook-ring absolute left-1/2 -translate-x-1/2 w-[30px] h-[11px] rounded-full" style={{ top: `${top}%` }} />
      ))}
    </div>
  )
}
