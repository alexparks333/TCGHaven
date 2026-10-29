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
//
// Everything is drawn on one "scene": the open spread, two screen-wide pages either side of the
// spine, with the camera (a translateX) choosing which half is on screen. The state after every
// motion is laid out exactly as the motion ends, so nothing ever jumps when it finishes.

const FLY_MS = 560
const TURN_MS = 900
const PAN_MS = 560
const JUMP_MS = 420
const CLOSE_MS = 260
const EASE_TURN = 'cubic-bezier(0.55, 0.05, 0.25, 1)'
const EASE_PAN = 'cubic-bezier(0.65, 0, 0.3, 1)'
const RIM = 7 // the cover showing round the page (top, bottom and the outer edge)

type Anim =
  | { kind: 'fly'; go: boolean }
  | { kind: 'pan'; to: number; go: boolean }
  | { kind: 'turn'; dir: 1 | -1; to: number; go: boolean }
  | { kind: 'jump'; to: number; go: boolean }
  | { kind: 'close'; go: boolean }

type Content = Page | 'cover' | null
type Side = 'left' | 'right'

export function PhoneBook({ set, badges, isMe, from, onClose }: {
  set: BadgeSet
  badges: SharedBadges | null
  isMe: boolean
  /** Where the closed book was on the shelf (window coordinates); null = open without the flight */
  from: DOMRect | null
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
    const ms = { fly: FLY_MS + 40, pan: PAN_MS, turn: TURN_MS, jump: JUMP_MS, close: CLOSE_MS }[anim.kind]
    const t = setTimeout(() => {
      if (anim.kind === 'fly') setAnim({ kind: 'turn', dir: 1, to: 0, go: false }) // now the cover opens
      else if (anim.kind === 'close') onClose()
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
  }, [anim, box, onClose, PAGES])

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
  const close = useCallback(() => { if (anim?.kind !== 'close') setAnim({ kind: 'close', go: false }) }, [anim])
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

  // Swipe to turn
  const touch = useRef<{ x: number; y: number } | null>(null)
  const onTouchStart = (e: React.TouchEvent) => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY } }
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = touch.current
    touch.current = null
    if (!s) return
    const dx = e.changedTouches[0].clientX - s.x, dy = e.changedTouches[0].clientY - s.y
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.4) (dx < 0 ? next : prev)()
  }

  const W = box?.width ?? 0
  const H = box?.height ?? 0
  const pin = Math.max(44, Math.min(200, (W - RIM) * 0.33, (H - RIM * 2) * 0.215))
  const pageProps = { badges, isMe, pin, onInspect: setInspect, flash }
  const page = (i: number): Content => (i === -1 ? 'cover' : PAGES[i] ?? { kind: 'blank' })
  const go = !!anim?.go

  // What's on the spread, and where the camera is (0 = the left page on screen, −W = the right)
  let L: Content, R: Content
  let leaf: { front: Content; back: Content; side: Side } | null = null
  let camFrom: number, camTo: number
  if (anim?.kind === 'turn' && anim.dir === 1) {
    // Turning the right-hand page (or the cover) over to the left: under it, the next spread's
    // right page; the camera glides left to follow the page's back as it lands.
    L = p === -1 ? null : page(p - 1)
    R = page(anim.to + 1)
    leaf = { front: page(p), back: page(anim.to), side: 'right' }
    camFrom = -W; camTo = 0
  } else if (anim?.kind === 'turn') {
    L = page(anim.to - 1)
    R = page(p + 1)
    leaf = { front: page(p), back: page(anim.to), side: 'left' }
    camFrom = 0; camTo = -W
  } else {
    if (p === -1) { L = null; R = 'cover' } else if (p % 2 === 0) { L = page(p); R = page(p + 1) } else { L = page(p - 1); R = page(p) }
    camFrom = p === -1 || p % 2 === 1 ? -W : 0
    camTo = anim?.kind === 'pan' ? (anim.to % 2 === 1 ? -W : 0) : camFrom
  }
  const cam = go ? camTo : camFrom
  const moving = go && (anim?.kind === 'turn' || anim?.kind === 'pan')
  const ease = anim?.kind === 'pan' ? EASE_PAN : EASE_TURN
  const ms = anim?.kind === 'pan' ? PAN_MS : TURN_MS
  const flying = anim?.kind === 'fly'
  const opened = p >= 0 || (anim?.kind === 'turn' && go)
  const closing = anim?.kind === 'close'
  const jumpDir = anim?.kind === 'jump' ? (anim.to > p ? 1 : -1) : 1
  const shownPage = anim && anim.kind !== 'fly' && anim.kind !== 'close' && go ? anim.to : p
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
      {/* Backdrop for the flight: fades in while the book flies up */}
      {flying && <div className="absolute inset-0 bg-[#0b0908]" style={{ opacity: go ? 1 : 0, transition: `opacity ${FLY_MS}ms ease` }} />}
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
        onTouchEnd={onTouchEnd}
        onClick={() => menu && setMenu(false)}
      >
        {box && !flying && (
          // A slight camera pull-back while the page moves — it dips away a touch and settles back
          <div
            className={cn('absolute inset-0 will-change-transform', go && anim?.kind === 'pan' && 'phonebook-pull-pan', go && anim?.kind === 'turn' && p >= 0 && 'phonebook-pull-turn')}
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
            <Half content={L} side="left" W={W} H={H} coverVars={coverVars} set={set} badges={badges} pageProps={pageProps} />
            <Half content={R} side="right" W={W} H={H} coverVars={coverVars} set={set} badges={badges} pageProps={pageProps} />

            {/* Under the turning page: the page it uncovers starts in its shadow */}
            {anim?.kind === 'turn' && (
              <div
                className="absolute top-0 pointer-events-none z-[5]"
                style={{
                  left: anim.dir === 1 ? W : 0, width: W, height: H,
                  background: `linear-gradient(to ${anim.dir === 1 ? 'right' : 'left'}, rgba(0,0,0,0.75), rgba(0,0,0,0.25))`,
                  opacity: go ? 0 : 1,
                  transition: `opacity ${TURN_MS}ms ease-out`,
                }}
              />
            )}

            {/* The turning page (or the cover), pinned at the spine */}
            {leaf && (
              <div
                className="absolute top-0 z-[15]"
                style={{
                  left: leaf.side === 'right' ? W : 0, width: W, height: H,
                  transformStyle: 'preserve-3d',
                  transformOrigin: leaf.side === 'right' ? 'left center' : 'right center',
                  transform: go ? `rotateY(${leaf.side === 'right' ? -180 : 180}deg)` : 'rotateY(0deg)',
                  transition: go ? `transform ${TURN_MS}ms ${EASE_TURN}` : 'none',
                }}
              >
                <div className="absolute inset-0" style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}>
                  <Face content={leaf.front} side={leaf.side} W={W} H={H} set={set} badges={badges} pageProps={pageProps} />
                  {/* darkens as it rises toward upright */}
                  <div
                    className="absolute inset-0 pointer-events-none"
                    style={{ background: `linear-gradient(to ${leaf.side}, rgba(0,0,0,0.2), rgba(0,0,0,0.7))`, opacity: go ? 1 : 0, transition: `opacity ${TURN_MS / 2}ms ease-in` }}
                  />
                </div>
                <div className="absolute inset-0" style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
                  <Face content={leaf.back} side={leaf.side === 'right' ? 'left' : 'right'} W={W} H={H} set={set} badges={badges} pageProps={pageProps} />
                  {/* starts dark past upright, brightens as it lays down */}
                  <div
                    className="absolute inset-0 pointer-events-none"
                    style={{ background: `linear-gradient(to ${leaf.side === 'right' ? 'left' : 'right'}, rgba(0,0,0,0.2), rgba(0,0,0,0.7))`, opacity: go ? 0 : 1, transition: `opacity ${TURN_MS / 2}ms ease-out ${TURN_MS / 2}ms` }}
                  />
                </div>
              </div>
            )}

            {/* Spine + rings: fade in as the cover opens (there's no spine to see on a shut book) */}
            {(L !== null || anim?.kind === 'turn') && (
              <div style={p === -1 ? { opacity: go ? 1 : 0, transition: `opacity ${TURN_MS}ms ease` } : undefined}>
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
          style={{ opacity: opened && !closing ? 1 : 0 }}
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

      {/* The closed book flying up from the shelf to fill the page area */}
      {flying && box && from && (
        <div
          className="absolute z-40 pointer-events-none"
          style={{
            left: box.left, top: box.top, width: W, height: H,
            transformOrigin: '0 0',
            transform: go ? 'none' : `translate(${from.left - box.left}px, ${from.top - box.top}px) scale(${from.width / W}, ${from.height / H})`,
            transition: go ? `transform ${FLY_MS}ms cubic-bezier(0.22, 0.8, 0.25, 1)` : 'none',
          }}
        >
          <BookCover set={set} badges={badges} />
        </div>
      )}

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
