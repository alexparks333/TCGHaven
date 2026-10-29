'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Lock, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { badgesInSet, chaptersOf, isMastered, type BadgeDef, type BadgeSet } from '@/lib/badges'
import type { SharedBadges } from '@/lib/firebase/badges'
import dynamic from 'next/dynamic'
import { useBadgeCatalog } from '@/lib/badgeCatalog'
import { badgeAsset } from '@/lib/badgeAssets'
import { BadgePin, PIN_SILHOUETTE, PIN_VIEWBOX } from './BadgePin'

// The 3D inspect view — three.js only loads when a pin is opened.
const PinInspector = dynamic(() => import('./PinInspector'), { ssr: false })

// The Haven Badges pin book (a profile's Badges tab) — modelled on the binders Disney pin traders
// use: black felt pages full of pin holes, silver rings down the spine, page edges stacked on
// both sides and a strap. The arrows turn the page like a real book (a 3D page turn). Every badge
// has its own spot; one that isn't earned yet is a hole in the felt in the pin's shape — hover
// (or tap) it to see the pin, its name, how to earn it and the progress so far.

const PER_PAGE = 6 // 2 × 3
const MIN_PAGES = 4 // always at least two spreads, so the book turns

export type Page = { kind: 'badges'; title: string; badges: BadgeDef[]; chapter: number } | { kind: 'blank' }

// Pins start on the very first page (no title page). The book is in chapters (BadgeSet.chapters, in
// order): each chapter starts on a fresh page titled with its name and takes as many pages as its
// badges need (six a page), so adding a badge to a chapter only ever pushes the chapters after it
// along — nothing is reordered. A chapter with no badges yet still gets its (empty) titled page.
export function buildPages(badges: BadgeDef[], chapters: string[]): { pages: Page[]; starts: number[] } {
  const pages: Page[] = []
  const starts: number[] = []
  chapters.forEach((title, chapter) => {
    starts.push(pages.length)
    const list = badges.filter((b) => b.page === title)
    if (!list.length) pages.push({ kind: 'badges', title, badges: [], chapter })
    for (let i = 0; i < list.length; i += PER_PAGE) pages.push({ kind: 'badges', title, badges: list.slice(i, i + PER_PAGE), chapter })
  })
  while (pages.length < MIN_PAGES || pages.length % 2) pages.push({ kind: 'blank' })
  return { pages, starts }
}

const TURN_MS = 750

// One Badge Set's book. `full`: the Badges page, where on desktop the book stretches to fill the
// window; otherwise (a profile's Badges tab) it keeps a book's proportions at full width.
export function BadgeBook({ set, badges, isMe, full = false, coverRef, coverOnly = false }: {
  set: BadgeSet
  coverOnly?: boolean
  badges: SharedBadges | null
  isMe: boolean
  full?: boolean
  coverRef?: React.Ref<HTMLDivElement>
}) {
  const { catalog } = useBadgeCatalog()
  const setBadges = useMemo(() => badgesInSet(catalog, set.id), [catalog, set.id])
  const chapters = useMemo(() => chaptersOf(catalog, set.id), [catalog, set.id])
  const { pages: PAGES, starts } = useMemo(() => buildPages(setBadges, chapters), [setBadges, chapters])
  const SPREADS = PAGES.length / 2
  const [spread, setSpread] = useState(0)
  // A turn goes to any spread (`to`): the arrows go one either way, a chapter tab jumps straight there
  const [turn, setTurn] = useState<{ dir: 1 | -1; to: number; go: boolean } | null>(null)
  const bookRef = useRef<HTMLDivElement>(null)
  const [pageSize, setPageSize] = useState({ w: 300, h: 420 })

  // Pins scale with the page.
  useLayoutEffect(() => {
    const el = bookRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setPageSize({ w: el.clientWidth / 2, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const goTo = useCallback((target: number) => {
    if (turn || target === spread || target < 0 || target >= SPREADS) return
    setTurn({ dir: target > spread ? 1 : -1, to: target, go: false })
  }, [turn, spread, SPREADS])
  const flip = useCallback((dir: 1 | -1) => { setFocus(null); goTo(spread + dir) }, [goTo, spread])
  // A chapter picked from the tabs: it stays the highlighted one while it's on the open spread
  // (two chapters can share a spread). Picking one that's already open flashes its page title.
  const [focus, setFocus] = useState<number | null>(null)
  const [flash, setFlash] = useState<{ chapter: number; n: number } | null>(null)
  const flashAfterTurn = useRef<number | null>(null)
  const pickChapter = (i: number) => {
    const target = Math.floor(starts[i] / 2)
    setFocus(i)
    if (turn) return
    if (target === spread) setFlash((f) => ({ chapter: i, n: (f?.n ?? 0) + 1 }))
    else { flashAfterTurn.current = i; goTo(target) }
  }

  // Start the turn on the next frame (so the page is laid flat first), then land on the new spread.
  useEffect(() => {
    if (!turn) return
    if (!turn.go) {
      const r = requestAnimationFrame(() => requestAnimationFrame(() => setTurn((t) => (t ? { ...t, go: true } : t))))
      return () => cancelAnimationFrame(r)
    }
    const t = setTimeout(() => {
      setSpread(turn.to); setTurn(null)
      // Arrived at a chapter picked from the tabs: its title glints once the page has landed
      const c = flashAfterTurn.current
      flashAfterTurn.current = null
      if (c !== null) setFlash((f) => ({ chapter: c, n: (f?.n ?? 0) + 1 }))
    }, TURN_MS)
    return () => clearTimeout(t)
  }, [turn])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = bookRef.current
      if (!el || !el.matches(':hover, :focus-within')) return
      if (e.key === 'ArrowRight') flip(1)
      if (e.key === 'ArrowLeft') flip(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [flip])

  const page = (n: number) => PAGES[n]
  // What lies flat under the turning page (see the comment on `leaf` below).
  let left = page(spread * 2)
  let right = page(spread * 2 + 1)
  let leaf: { front: Page; back: Page; side: 'right' | 'left' } | null = null
  if (turn?.dir === 1) {
    right = page(turn.to * 2 + 1)
    leaf = { front: page(spread * 2 + 1), back: page(turn.to * 2), side: 'right' }
  } else if (turn?.dir === -1) {
    left = page(turn.to * 2)
    leaf = { front: page(spread * 2), back: page(turn.to * 2 + 1), side: 'left' }
  }
  // The chapter open now (the left page's, or the right's when the left belongs to none)
  const shown = turn?.go ? turn.to : spread
  const pageChapter = (p: Page | undefined) => (p && p.kind === 'badges' ? p.chapter : -1)
  const onSpread = [pageChapter(PAGES[shown * 2]), pageChapter(PAGES[shown * 2 + 1])]
  const openChapter = focus !== null && onSpread.includes(focus) ? focus : onSpread[0] >= 0 ? onSpread[0] : onSpread[1]

  // A page holds 2 × 3 pins: size them by whichever of its width or height is tighter.
  // Each page is a 2 × 3 grid: a pin (≈1.12× as tall as wide) fills most of its cell.
  const pin = Math.max(44, Math.min(200, pageSize.w * 0.33, pageSize.h * 0.215)) // leaves room for each spot's nameplate
  const [inspect, setInspect] = useState<BadgeDef | null>(null)
  const props = { badges, isMe, pin, onInspect: setInspect, flash }
  // Page edges peeking out on each side: more on whichever side has more pages left. They move to
  // the new counts during a turn (fading in step with the page), not with a cut afterwards.
  const edgeSpread = turn?.go ? turn.to : spread
  const leftEdges = Math.min(3, edgeSpread)
  const rightEdges = Math.min(3, SPREADS - 1 - edgeSpread)
  const edgeFade = `opacity ${TURN_MS}ms ease-in-out`
  // Lighting during a turn, so the page reads as a page turning: it darkens as it rises toward
  // upright, brightens as it lays down on the other side, and the page it uncovers starts in its
  // shadow. Everything ends exactly as the flat pages look — no change when the turn finishes.
  const go = !!turn?.go
  const half = TURN_MS / 2
  const away = leaf?.side === 'right' ? 'left' : 'right' // direction from the spine outward on the leaf's side

  const cover = (
    // A thin cover rim — the felt pages fill almost the whole book
    <div
      ref={coverRef}
      className="pinbook-cover relative rounded-[16px]"
      style={{
        padding: 'clamp(10px, 1.4%, 20px)', ['--leather-from' as string]: set.cover.from, ['--leather-to' as string]: set.cover.to, ['--accent' as string]: set.cover.accent,
        // A cover picture is the open book's cover too: it shows round the pages as the rim
        ...(set.coverImage && { backgroundImage: `url("${badgeAsset(set.coverImage)}")`, backgroundSize: '100% 100%' }),
      }}
    >
      <PinholeFilter />
      {/* Saddle stitching around the cover, and gold corner protectors */}
      {/* (a cover picture brings its own frame) */}
      {!set.coverImage && <div className="pinbook-stitch absolute inset-[5px] rounded-[12px] pointer-events-none" />}
      {!set.coverImage && (['tl', 'tr', 'bl', 'br'] as const).map((c) => <CoverCorner key={c} at={c} />)}
      {/* Chapter tabs down the right edge (they replace the strap — the book's open) */}
      {chapters.length > 0 && (
        <ChapterTabs chapters={chapters} open={openChapter} onPick={pickChapter} />
      )}
      {/* Strap + snap on the right edge */}
      {chapters.length === 0 && <div className="pinbook-strap absolute -right-[2.2%] top-[34%] h-[26%] w-[4.5%] rounded-r-md" />}
      <div className="pinbook-snap absolute -left-[0.7%] top-1/2 -translate-y-1/2 w-[1.6%] aspect-square rounded-full z-30" />

      {/* Full page: on desktop the book stretches to fill the window (below the page title);
          on phones, and inside a profile, it keeps a book's proportions. */}
      <div ref={bookRef} tabIndex={-1} className={cn('pinbook relative w-full outline-none aspect-[1.42]', full && 'md:aspect-auto md:h-[calc(100dvh-148px)] md:min-h-[420px]')}>
        {/* Stacked page edges */}
        {[0, 1, 2].map((i) => (
          <div key={`l${i}`} className="pinbook-edge pinbook-edge-left absolute top-[1%] bottom-[1%] rounded-l-xl" style={{ left: `${-(i + 1) * 1.1}%`, width: '50%', zIndex: -1 - i, opacity: i < leftEdges ? 1 : 0, transition: edgeFade }} />
        ))}
        {[0, 1, 2].map((i) => (
          <div key={`r${i}`} className="pinbook-edge pinbook-edge-right absolute top-[1%] bottom-[1%] rounded-r-xl" style={{ right: `${-(i + 1) * 1.1}%`, width: '50%', zIndex: -1 - i, opacity: i < rightEdges ? 1 : 0, transition: edgeFade }} />
        ))}

        {/* The two flat pages */}
        <div className="absolute inset-y-0 left-0 w-1/2">
          <PinPage page={left} side="left" {...props} />
          {turn?.dir === -1 && <TurnShadow from="right" on={!go} ms={TURN_MS} />}
        </div>
        <div className="absolute inset-y-0 right-0 w-1/2">
          <PinPage page={right} side="right" {...props} />
          {turn?.dir === 1 && <TurnShadow from="left" on={!go} ms={TURN_MS} />}
        </div>

        {/* The turning page: pinned at the spine, it swings across — its front is the page
            being turned, its back is the page that lands on the other side. */}
        {leaf && (
          <div
            className={cn('pinbook-leaf absolute inset-y-0 w-1/2', leaf.side === 'right' ? 'left-1/2 origin-left' : 'left-0 origin-right')}
            style={{
              transform: turn?.go ? `rotateY(${leaf.side === 'right' ? -180 : 180}deg)` : 'rotateY(0deg)',
              transition: turn?.go ? `transform ${TURN_MS}ms cubic-bezier(0.45, 0.05, 0.25, 1)` : 'none',
            }}
          >
            <div className="pinbook-face absolute inset-0">
              <PinPage page={leaf.front} side={leaf.side} {...props} turning />
              {/* darkens as it rises toward upright */}
              <div
                className="absolute inset-0 pointer-events-none"
                style={{ background: `linear-gradient(to ${away}, rgba(0,0,0,0.25), rgba(0,0,0,0.7))`, opacity: go ? 1 : 0, transition: `opacity ${half}ms ease-in` }}
              />
            </div>
            <div className="pinbook-face pinbook-face-back absolute inset-0">
              <PinPage page={leaf.back} side={leaf.side === 'right' ? 'left' : 'right'} {...props} turning />
              {/* starts dark past upright, brightens as it lays down */}
              <div
                className="absolute inset-0 pointer-events-none"
                style={{ background: `linear-gradient(to ${leaf.side}, rgba(0,0,0,0.25), rgba(0,0,0,0.7))`, opacity: go ? 0 : 1, transition: `opacity ${half}ms ease-out ${half}ms` }}
              />
            </div>
          </div>
        )}

        {/* Spine + binder rings */}
        <div className="pinbook-spine absolute inset-y-0 left-1/2 -translate-x-1/2 w-[3%]" />
        {/* Brushed-metal ring mechanism, riveted, with polished rings */}
        <div className="pinbook-plate absolute left-1/2 -translate-x-1/2 top-[5%] bottom-[5%] w-[2.1%] rounded-[3px]">
          {[2.5, 97.5].map((t) => <span key={t} className="pinbook-rivet absolute left-1/2 -translate-x-1/2 -translate-y-1/2 w-[46%] aspect-square rounded-full" style={{ top: `${t}%` }} />)}
        </div>
        {[10, 24, 38, 62, 76, 90].map((top) => (
          <div key={top} className="pinbook-ring absolute left-1/2 -translate-x-1/2 w-[5.5%] h-[2.6%] rounded-full" style={{ top: `${top}%` }} />
        ))}
      </div>
    </div>
  )
  // Just the book itself — the opening animation draws its first page on the inside of the cover.
  if (coverOnly) return cover

  const inspector = inspect && (
    <PinInspector
      def={inspect}
      earnedAt={badges?.earned[inspect.id]}
      progress={badges?.progress[inspect.id]}
      mystery={!badges?.earned[inspect.id]}
      onClose={() => setInspect(null)}
    />
  )

  return (
    <div className="flex flex-col items-center">
      {/* In a profile the book keeps a book's proportions, so it's capped by the window's height
          (the whole book always fits on screen); on the Badges page it fills the page instead. */}
      <div
        className={cn('relative w-full mx-auto', chapters.length ? 'pl-7 pr-12 sm:pl-12 sm:pr-44' : 'px-7 sm:px-12')}
        style={full ? undefined : { maxWidth: 'max(360px, calc((100dvh - 190px) * 1.42 + 96px))' }}
      >

        <ArrowButton side="left" disabled={spread === 0 || !!turn} onClick={() => flip(-1)} />
        <ArrowButton side="right" disabled={spread === SPREADS - 1 || !!turn} onClick={() => flip(1)} />

        {cover}
      </div>

      <div className="mt-3 flex items-center gap-1.5">
        {Array.from({ length: SPREADS }, (_, i) => (
          <span key={i} className={cn('h-1.5 rounded-full transition-all', i === spread ? 'w-5 bg-violet-600' : 'w-1.5 bg-slate-700')} />
        ))}
      </div>
      {inspector}
    </div>
  )
}

// Turn-the-page arrows either side of the book: frosted smoky-grey discs, quiet until hovered
function ArrowButton({ side, disabled, onClick }: { side: 'left' | 'right'; disabled: boolean; onClick: () => void }) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={side === 'left' ? 'Previous page' : 'Next page'}
      className={cn(
        'pinbook-arrow absolute top-1/2 -translate-y-1/2 z-20 w-9 h-9 sm:w-11 sm:h-11 rounded-full flex items-center justify-center disabled:opacity-0 disabled:pointer-events-none',
        side === 'left' ? 'left-0' : 'right-0',
      )}
    >
      <Icon size={22} strokeWidth={2.25} className={side === 'left' ? '-ml-0.5' : 'ml-0.5'} />
    </button>
  )
}

// Index tabs on the book's right edge, one per chapter, like a binder's dividers. The open
// chapter's tab is gilded and stands out further; click one to turn straight to that chapter.
function ChapterTabs({ chapters, open, onPick }: { chapters: string[]; open: number; onPick: (i: number) => void }) {
  return (
    <div className="absolute top-[5%] bottom-[5%] left-full z-10 flex flex-col gap-[0.8%] pointer-events-none" aria-label="Chapters">
      {chapters.map((name, i) => (
        <button
          key={name + i}
          type="button"
          onClick={() => onPick(i)}
          title={name}
          aria-current={i === open ? 'true' : undefined}
          className={cn('pinbook-tab pinbook-serif pointer-events-auto relative flex items-center gap-2 rounded-r-xl text-left font-bold transition-all duration-200',
            i === open ? 'pinbook-tab-open' : 'pinbook-tab-shut')}
        >
          <span className="pinbook-tab-num">{ROMAN[i] ?? i + 1}</span>
          <span className="pinbook-tab-label hidden sm:block">{name}</span>
        </button>
      ))}
    </div>
  )
}

export const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV']

// ── A page ──────────────────────────────────────────────────────────────────────────────────

export interface PageProps {
  page: Page
  side: 'left' | 'right'
  badges: SharedBadges | null
  isMe: boolean
  pin: number
  onInspect: (def: BadgeDef) => void
  turning?: boolean
  flash?: { chapter: number; n: number } | null
}

export function PinPage({ page, side, badges, isMe, pin, onInspect, turning, flash }: PageProps) {
  return (
    <div className={cn('pinbook-page absolute inset-0 overflow-visible', side === 'left' ? 'rounded-l-xl pinbook-page-left' : 'rounded-r-xl pinbook-page-right')}>
      {/* Gold-foil double frame with engraved corner ornaments */}
      <div className={cn('pinbook-frame absolute top-[2.5%] bottom-[2.5%] pointer-events-none', side === 'left' ? 'left-[4%] right-[6%]' : 'left-[6%] right-[4%]')}>
        {(['tl', 'tr', 'bl', 'br'] as const).map((c) => <FrameOrnament key={c} at={c} />)}
      </div>
      {page.kind === 'badges' && <PageTitle key={flash?.chapter === page.chapter ? `f${flash.n}` : 't'} title={page.title} flash={flash?.chapter === page.chapter} />}
      {page.kind === 'badges' && (
        <div className="absolute inset-x-[7%] top-[13%] bottom-[5%] grid grid-cols-2 grid-rows-3 place-items-center">
          {Array.from({ length: PER_PAGE }, (_, i) => {
            const def = page.badges[i]
            return def
              ? <BadgeSpot key={def.id} def={def} badges={badges} pin={pin} isMe={isMe} interactive={!turning} below={i < 2} onInspect={onInspect} />
              : <EmptySpot key={i} size={pin} />
          })}
        </div>
      )}
      {page.kind === 'blank' && (
        <div className="absolute inset-x-[7%] top-[13%] bottom-[5%] grid grid-cols-2 grid-rows-3 place-items-center">
          {Array.from({ length: PER_PAGE }, (_, i) => <EmptySpot key={i} size={pin} />)}
        </div>
      )}
    </div>
  )
}

// One badge's spot on the page: the pin if it's earned, otherwise a pin-shaped hole.
// `below`: top-row spots open their preview downward so it isn't cut off above the book.
// Hover: a quick preview. Click (tap on phones): the 3D inspect view. An earned pin tilts toward
// the pointer and a glint of light moves across it, like a real enamel pin catching the light.
function BadgeSpot({ def, badges, pin, isMe, interactive, below, onInspect }: { def: BadgeDef; badges: SharedBadges | null; pin: number; isMe: boolean; interactive: boolean; below: boolean; onInspect: (def: BadgeDef) => void }) {
  const [open, setOpen] = useState(false)
  const [tilt, setTilt] = useState<{ x: number; y: number } | null>(null)
  const earnedAt = badges?.earned[def.id]
  const [have, total] = badges?.progress[def.id] ?? [0, def.slots.length]
  const mastered = isMastered(def, badges?.progress[def.id], !!earnedAt)
  // An earned growing badge that has new cards since: how many to master it again
  const toMaster = def.growing && earnedAt && !mastered ? Math.max(0, def.slots.length - have) : 0

  return (
    <button
      type="button"
      onClick={() => interactive && onInspect(def)}
      onPointerEnter={(e) => { if (interactive && e.pointerType === 'mouse') setOpen(true) }}
      onPointerLeave={() => { setOpen(false); setTilt(null) }}
      onPointerMove={(e) => {
        if (!earnedAt || e.pointerType !== 'mouse') return
        const r = e.currentTarget.getBoundingClientRect()
        setTilt({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height })
      }}
      aria-label={`${def.name}${mastered ? ' — mastered' : earnedAt ? ' — earned' : ' — not earned yet'} — view in 3D`}
      className="relative flex flex-col items-center justify-center outline-none cursor-pointer"
      style={{ width: pin * 1.25, height: pin * 1.16 + pin * 0.2 }}
    >
      {earnedAt ? (
        <span
          className={cn('pinbook-pin block relative', mastered && 'pinbook-mastered')}
          style={{
            transform: tilt
              ? `perspective(600px) rotateY(${(tilt.x - 0.5) * 22}deg) rotateX(${(0.5 - tilt.y) * 22}deg) translateY(-3px) scale(1.06)`
              : undefined,
          }}
        >
          {/* Mastered: a polished platinum rim around the pin's own silhouette, with a highlight
              slowly travelling around it (the silhouette drawn a little larger behind the pin) */}
          {mastered && (
            <>
              <span className="pinbook-platinum absolute inset-[-3.6%] pointer-events-none" aria-hidden style={{ WebkitMask: pinMask(def.imageUrl), mask: pinMask(def.imageUrl) }} />
              <span className="pinbook-platinum-gap absolute inset-[-0.8%] pointer-events-none" aria-hidden style={{ WebkitMask: pinMask(def.imageUrl), mask: pinMask(def.imageUrl) }} />
            </>
          )}
          <BadgePin art={def.art} imageUrl={def.imageUrl} size={pin} />
          {tilt && (
            <span
              className="pinbook-glint absolute inset-0"
              style={{
                background: `radial-gradient(circle at ${tilt.x * 100}% ${tilt.y * 100}%, rgba(255,255,255,0.55), rgba(255,255,255,0.08) 35%, transparent 60%)`,
                ...(def.imageUrl && { WebkitMask: `url("${badgeAsset(def.imageUrl)}") center / contain no-repeat`, mask: `url("${badgeAsset(def.imageUrl)}") center / contain no-repeat` }),
              }}
            />
          )}
        </span>
      ) : (
        <PinHole size={pin} hovered={open} imageUrl={def.imageUrl} art={def.art} progress={total ? have / total : 0} />
      )}
      {/* Tucked up under the pin: its box is taller than round art, which left a gap */}
      <Nameplate size={pin} text={earnedAt ? def.name : '? ? ?'} lit={!!earnedAt} mastered={mastered} gap={-pin * 0.02} />

      {open && interactive && (
        <span className={cn('pinbook-tip absolute left-1/2 -translate-x-1/2 z-40 w-[220px] text-left rounded-xl border border-slate-700 bg-slate-950 shadow-2xl p-3 pointer-events-none', below ? 'top-[calc(100%+6px)]' : 'bottom-[calc(100%+6px)]')}>
          <span className="block text-sm font-bold text-ink leading-tight">{def.name}</span>
          <span className={cn('mt-0.5 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider', earnedAt ? 'text-emerald-700' : 'text-slate-500')}>
            {earnedAt ? <><Check size={10} />Earned {new Date(earnedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</> : <><Lock size={10} />Not earned yet</>}
          </span>
          {mastered && <span className="block mt-1 text-[10px] font-bold uppercase tracking-wider text-amber-700">✦ Mastered — every {def.slotNoun.replace(/s$/, '')} so far</span>}
          {toMaster > 0 && <span className="block mt-1 text-[10px] font-semibold text-slate-500">{toMaster} more {def.slotNoun} to master it{have > 0 ? ' again' : ''}</span>}
          <span className="block text-[11px] text-slate-400 mt-2 leading-snug">{def.description}</span>
          {(!earnedAt || toMaster > 0) && (
            <span className="block mt-2">
              <span className="flex justify-between text-[10px] font-semibold text-slate-500 mb-1">
                <span>{isMe ? 'Your progress' : 'Progress'}</span>
                <span>{have} / {total} {def.slotNoun}</span>
              </span>
              <span className="block h-1.5 rounded-full bg-slate-800 overflow-hidden">
                <span className="block h-full rounded-full bg-violet-600" style={{ width: `${(have / Math.max(1, total)) * 100}%` }} />
              </span>
            </span>
          )}
        </span>
      )}
    </button>
  )
}

function PinHole({ size, hovered, imageUrl, art, progress }: { size: number; hovered: boolean; imageUrl?: string; art: string; progress: number }) {
  // The pin's own shape pressed into the velvet: the
  // SVG filter #pinhole-inset (PinholeFilter) turns the art's outline into a tinted floor with an
  // inner shadow all round its edge (heavier at the top) and a faint lit lower edge.
  const src = imageUrl
    ? `url("${badgeAsset(imageUrl)}")`
    : `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='${PIN_VIEWBOX}'><path d='${PIN_SILHOUETTE}'/></svg>`)}")`
  // Progress: the pin fills in from the bottom as a ghost (half opacity) — 2 of 12 cards shows its
  // bottom sixth. The fill is measured over the art itself: uploaded art is square, centred in the
  // 100 × 112 box; the built-in pins fill the box.
  const p = Math.max(0, Math.min(1, progress))
  const artTop = imageUrl ? (1.12 - 1) / 2 / 1.12 : 0 // fraction of the box above/below the art
  const fill = p > 0 ? (artTop + p * (1 - 2 * artTop)) * 100 : 0
  return (
    <span className="relative block transition-transform duration-200" style={{ width: size, height: size * 1.12, transform: hovered ? 'scale(1.03)' : undefined }}>
      <span
        className="absolute inset-0"
        style={{ backgroundImage: src, backgroundSize: 'contain', backgroundPosition: 'center', backgroundRepeat: 'no-repeat', filter: 'url(#pinhole-inset)' }}
      />
      {p > 0 && (
        <span
          className="pinhole-fill absolute inset-x-0 bottom-0 overflow-hidden pointer-events-none"
          style={{ height: `${fill}%`, opacity: hovered ? 0.62 : 0.5 }}
        >
          {/* the pin, anchored to the bottom so it doesn't move as the fill rises */}
          <span className="absolute inset-x-0 bottom-0 flex justify-center" style={{ height: size * 1.12 }}>
            <BadgePin art={art} imageUrl={imageUrl} size={size} />
          </span>
        </span>
      )}
    </span>
  )
}

// The filter behind PinHole — an inset shadow cut to any shape (its alpha), like a pin pressed into velvet
// (a translucent dark floor; a soft inner shadow, offset down; a faint warm highlight inside the
// bottom edge). Rendered once per book.
export function PinholeFilter() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden focusable="false">
      <filter id="pinhole-inset" x="-5%" y="-5%" width="110%" height="110%" colorInterpolationFilters="sRGB">
        {/* floor: a dark translucent tint in the shape */}
        <feFlood floodColor="#000" floodOpacity="0.26" result="tint" />
        <feComposite in="tint" in2="SourceAlpha" operator="in" result="floor" />
        {/* inner shadow: blur what's outside the shape, push it down, keep the part inside */}
        <feFlood floodColor="#000" result="black" />
        <feComposite in="black" in2="SourceAlpha" operator="out" result="outside" />
        <feGaussianBlur in="outside" stdDeviation="3.5" />
        <feOffset dy="3" result="shadowOff" />
        <feComposite in="shadowOff" in2="SourceAlpha" operator="in" result="shadowIn" />
        <feComponentTransfer in="shadowIn" result="shadow"><feFuncA type="linear" slope="0.8" /></feComponentTransfer>
        {/* lit lower edge */}
        <feGaussianBlur in="outside" stdDeviation="0.8" />
        <feOffset dy="-1.2" result="hiOff" />
        <feComposite in="hiOff" in2="SourceAlpha" operator="in" result="hiIn" />
        <feFlood floodColor="#ffebc8" floodOpacity="0.07" />
        <feComposite in2="hiIn" operator="in" result="highlight" />
        <feMerge>
          <feMergeNode in="floor" />
          <feMergeNode in="shadow" />
          <feMergeNode in="highlight" />
        </feMerge>
      </filter>
    </svg>
  )
}

// A spot on the page no badge uses yet: left blank (just holds its place in the 2 × 3 grid).
function EmptySpot({ size }: { size: number }) {
  return <div style={{ width: size * 1.25, height: size * 1.16 + size * 0.2 }} aria-hidden />
}

// A small engraved brass plate under each spot: the badge's name once earned
// A CSS mask in the pin's shape: its uploaded art, or the built-in pins' silhouette
function pinMask(imageUrl?: string) {
  const src = imageUrl
    ? `url("${badgeAsset(imageUrl)}")`
    : `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='${PIN_VIEWBOX}'><path d='${PIN_SILHOUETTE}'/></svg>`)}")`
  return `${src} center / contain no-repeat`
}

function Nameplate({ size, text, lit, gap, mastered }: { size: number; text: string; lit: boolean; gap: number; mastered?: boolean }) {
  return (
    <span
      className={cn('pinbook-plate-name pinbook-serif relative block max-w-full truncate rounded-[2px] text-center font-bold uppercase', lit ? 'pinbook-plate-lit' : 'pinbook-plate-dim', mastered && 'pinbook-plate-mastered')}
      style={{ marginTop: gap, fontSize: Math.max(7, size * 0.068), padding: `${size * 0.018}px ${size * 0.07}px`, letterSpacing: '0.14em' }}
    >
      {mastered && '✦ '}{text}
    </span>
  )
}

// A page's name in engraved gold lettering, between two fine gold rules with diamond ends.
function PageTitle({ title, flash }: { title: string; flash?: boolean }) {
  return (
    <div className={cn('absolute inset-x-[10%] top-[4.2%] flex items-center justify-center gap-[3%] pointer-events-none', flash && 'pinbook-title-flash')}>
      <span className="pinbook-rule flex-1 max-w-[22%]" />
      <span className="pinbook-title pinbook-serif text-[clamp(12px,1.55vw,22px)] font-bold uppercase tracking-[0.32em] whitespace-nowrap">{title}</span>
      <span className="pinbook-rule pinbook-rule-r flex-1 max-w-[22%]" />
    </div>
  )
}

// Engraved flourish in a page frame's corner
function FrameOrnament({ at }: { at: 'tl' | 'tr' | 'bl' | 'br' }) {
  const flip = { tl: '', tr: 'scale(-1,1)', bl: 'scale(1,-1)', br: 'scale(-1,-1)' }[at]
  return (
    <svg viewBox="0 0 40 40" className={cn('pinbook-ornament absolute w-[11%] max-w-[54px] aspect-square', at[0] === 't' ? '-top-[2px]' : '-bottom-[2px]', at[1] === 'l' ? '-left-[2px]' : '-right-[2px]')} aria-hidden>
      <g transform={flip} style={{ transformOrigin: '20px 20px' }} fill="none" stroke="currentColor" strokeLinecap="round">
        <path d="M2 2 L16 2 M2 2 L2 16" strokeWidth="1.6" />
        <path d="M6 6 C14 6 16 9 16 14 C16 18 13 19 11 17 C9 15 11 12 13.5 13" strokeWidth="1" />
        <path d="M6 6 C6 14 9 16 14 16" strokeWidth="1" />
        <path d="M22 2 L25 2 M2 22 L2 25" strokeWidth="1.2" />
        <circle cx="6" cy="6" r="1.4" fill="currentColor" stroke="none" />
      </g>
    </svg>
  )
}

// A gold corner protector on the cover
function CoverCorner({ at }: { at: 'tl' | 'tr' | 'bl' | 'br' }) {
  const rot = { tl: 0, tr: 90, br: 180, bl: 270 }[at]
  return (
    <svg viewBox="0 0 40 40" className={cn('pinbook-corner absolute w-[3.2%] min-w-[18px] max-w-[46px] aspect-square z-30 pointer-events-none', at[0] === 't' ? '-top-[3px]' : '-bottom-[3px]', at[1] === 'l' ? '-left-[3px]' : '-right-[3px]')} aria-hidden>
      <defs>
        <linearGradient id={`pc-${at}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fbe7a6" /><stop offset="0.45" stopColor="#c9963c" /><stop offset="1" stopColor="#7a5418" />
        </linearGradient>
      </defs>
      <g transform={`rotate(${rot} 20 20)`}>
        <path d="M0 14 Q0 0 14 0 L40 0 L40 7 L15 7 Q7 7 7 15 L7 40 L0 40 Z" fill={`url(#pc-${at})`} />
        <circle cx="11" cy="11" r="2.2" fill="#fff3c9" opacity="0.85" />
      </g>
    </svg>
  )
}

// The shadow the turning page casts on the page it uncovers: strongest at the spine, fading out
// as the page swings away.
function TurnShadow({ from, on, ms }: { from: 'left' | 'right'; on: boolean; ms: number }) {
  return (
    <div
      className="absolute inset-0 pointer-events-none z-[5]"
      style={{
        background: `linear-gradient(to ${from === 'left' ? 'right' : 'left'}, rgba(0,0,0,0.75), rgba(0,0,0,0.25) 60%, rgba(0,0,0,0.1))`,
        opacity: on ? 1 : 0,
        transition: `opacity ${ms}ms ease-out`,
      }}
    />
  )
}

