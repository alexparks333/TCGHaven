'use client'

// The creator's book opening from the community page (docs/creators.md): the showcase book lifts off its
// spot, flies to the middle of the screen on a gentle curve, takes the open book's shape and its cover
// swings open onto the real book; closing runs it all backwards and sets it down in its spot. The same
// flying book as the Badges shelf (BadgeLibrary's Flyer and timings), here over a dimmed page. An upright
// phone opens it a page at a time (PhoneBook), which flies from the spot on its own.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BookOpen, X } from 'lucide-react'
import { Flyer, FLY_MS, GROW_MS, LIFT_MS, REVEAL_MS, TURN_MS, type ClosePhase, type Phase } from '@/components/badges/BadgeLibrary'
import { BadgeBook } from '@/components/badges/BadgeBook'
import { PhoneBook } from '@/components/badges/PhoneBook'
import { ExtraBooksProvider } from '@/lib/badgeCatalog'
import { useScrollLock } from '@/lib/useScrollLock'
import type { SharedBadges } from '@/lib/firebase/badges'
import type { CreatorBook } from '@/lib/creatorBooks'

const EASE = 'cubic-bezier(0.55, 0.05, 0.25, 1)'
const PHONE_QUERY = '(max-width: 767px) and (orientation: portrait)'

type State =
  | { mode: 'opening'; phase: Phase; to?: DOMRect; edge?: number }
  | { mode: 'open' }
  | { mode: 'closing'; phase: ClosePhase; to: DOMRect; spot: DOMRect; spread: number; edge: number }
// edge: where the spine is, from the book's own left side (the page is revealed right of it)

export function OpeningBook({ book, badges, isMe, from, getSpot, onClosed }: {
  book: CreatorBook
  badges: SharedBadges | null   // the viewer's progress (a member's), or null
  isMe: boolean
  from: DOMRect                 // the showcase book's spot when it was clicked (window coordinates)
  getSpot: () => DOMRect | null // where to set it down when it closes
  onClosed: () => void
}) {
  useScrollLock(true)
  const set = book.book, defs = book.badges
  const [phone] = useState(() => window.matchMedia(PHONE_QUERY).matches)
  const [still] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [s, setS] = useState<State>(still ? { mode: 'open' } : { mode: 'opening', phase: 'measure' })
  const coverRef = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLDivElement>(null) // the open book's column (the spine's place is measured from its left)
  const edgeOf = (spineX: number) => spineX - (boxRef.current?.getBoundingClientRect().left ?? 0)
  const spread = useRef(0)

  // measure: the open book is laid out unseen, so we know where its cover lands
  useLayoutEffect(() => {
    if (s.mode !== 'opening' || s.phase !== 'measure' || !coverRef.current) return
    const r = coverRef.current.getBoundingClientRect()
    setS({ mode: 'opening', phase: 'fly', to: new DOMRect(r.left + r.width / 2, r.top, r.width / 2, r.height), edge: edgeOf(r.left + r.width / 2) })
  }, [s])

  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined, raf = 0
    const next = (ms: number, n: State) => { t = setTimeout(() => setS(n), ms) }
    if (s.mode === 'opening' && s.to) {
      if (s.phase === 'fly') raf = requestAnimationFrame(() => requestAnimationFrame(() => setS({ ...s, phase: 'lift' })))
      if (s.phase === 'lift') next(LIFT_MS, { ...s, phase: 'flyGo' })
      if (s.phase === 'flyGo') next(FLY_MS + 60, { ...s, phase: 'grow' })
      if (s.phase === 'grow') next(GROW_MS + 80, { ...s, phase: 'turn' })
      if (s.phase === 'turn') next(TURN_MS, { ...s, phase: 'reveal' })
      if (s.phase === 'reveal') next(REVEAL_MS, { mode: 'open' })
    }
    if (s.mode === 'closing') {
      if (s.phase === 'prep') raf = requestAnimationFrame(() => requestAnimationFrame(() => setS({ ...s, phase: 'shut' })))
      if (s.phase === 'shut') next(TURN_MS, { ...s, phase: 'settle' })
      if (s.phase === 'settle') next(GROW_MS + 80, { ...s, phase: 'home' })
      if (s.phase === 'home') next(FLY_MS + 30, { ...s, phase: 'land' })
      if (s.phase === 'land') t = setTimeout(onClosed, LIFT_MS + 20)
    }
    return () => { if (t) clearTimeout(t); cancelAnimationFrame(raf) }
  }, [s, onClosed])

  function close() {
    if (s.mode !== 'open') return
    const spot = getSpot()
    if (still || !spot || !coverRef.current) { onClosed(); return }
    const r = coverRef.current.getBoundingClientRect()
    setS({ mode: 'closing', phase: 'prep', to: new DOMRect(r.left + r.width / 2, r.top, r.width / 2, r.height), spot, spread: spread.current, edge: edgeOf(r.left + r.width / 2) })
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  if (phone) {
    return (
      <ExtraBooksProvider books={{ sets: [set], badges: defs }}>
        <PhoneBook set={set} badges={badges} isMe={isMe} from={still ? null : from} getShelfSpot={getSpot} onClose={onClosed} />
      </ExtraBooksProvider>
    )
  }

  const opening = s.mode === 'opening' ? s : null, closing = s.mode === 'closing' ? s : null
  const phase = opening?.phase
  // the page behind dims as the book lifts, and comes back as it's set down
  const dim = opening ? phase !== 'measure' && phase !== 'fly' : closing ? closing.phase !== 'home' && closing.phase !== 'land' : true
  const clip = closing ? `inset(-20% -20% -20% ${closing.edge}px)`
    : !opening ? undefined
    : phase === 'reveal' ? 'inset(-20% -20% -20% 0%)'
    : opening.edge !== undefined ? `inset(-20% -20% -20% ${opening.edge}px)` : 'inset(-20% -20% -20% 50%)'
  const shift = opening?.to ? opening.to.width / 2 : 0
  const settled = !opening || phase === 'turn' || phase === 'reveal'
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={set.name}>
      <div className="absolute inset-0 bg-[#140d07]/80 backdrop-blur-[2px]" style={{ opacity: dim ? 1 : 0, transition: `opacity ${FLY_MS}ms ease` }}
        onClick={close} />
      <div className="absolute inset-x-0 top-0 z-[2] flex items-center gap-3 px-5 py-3 text-[#f3e7cf]"
        style={{ opacity: s.mode === 'open' ? 1 : 0, transition: 'opacity 250ms ease', pointerEvents: s.mode === 'open' ? 'auto' : 'none' }}>
        <BookOpen size={18} />
        <p className="font-bold truncate">{set.name}</p>
        <button type="button" onClick={close} className="ml-auto p-2 rounded-full bg-white/10 hover:bg-white/20" aria-label="Close the book"><X size={18} /></button>
      </div>
      <div className="absolute inset-0 pt-14 px-2 pb-3 flex justify-center" style={{ overflowY: s.mode === 'open' ? 'auto' : 'hidden' }}
        onClick={(e) => { if (e.target === e.currentTarget) close() }}>
        <div ref={boxRef} className="w-full my-auto"
          style={closing ? {
            visibility: closing.phase === 'home' || closing.phase === 'land' || closing.phase === 'settle' ? 'hidden' : 'visible',
            clipPath: clip,
            transform: closing.phase === 'prep' ? undefined : `translateX(${-closing.to.width / 2}px)`,
            transition: closing.phase === 'shut' ? `transform ${TURN_MS}ms ${EASE}` : undefined,
          } : {
            visibility: phase === 'measure' || phase === 'fly' || phase === 'lift' || phase === 'flyGo' || phase === 'grow' ? 'hidden' : 'visible',
            clipPath: clip,
            transform: settled ? undefined : `translateX(${-shift}px)`,
            transition: phase === 'turn' ? `transform ${TURN_MS}ms ${EASE}` : undefined,
          }}>
          <BadgeBook set={set} defs={defs} badges={badges} isMe={isMe} coverRef={coverRef} room={92} onSpreadChange={(n) => { spread.current = n }} />
        </div>
      </div>
      {opening?.to && (
        <Flyer set={set} defs={defs} badges={badges} isMe={isMe} full={false} spot={from} to={opening.to} spread={0}
          at={phase === 'fly' || phase === 'lift' ? 'shelf' : phase === 'flyGo' ? 'mid' : 'cover'} lifted={phase === 'lift' || phase === 'flyGo'}
          turned={phase === 'turn' || phase === 'reveal'} fade={phase === 'reveal'}
          anim={phase === 'flyGo' ? 'fly' : phase === 'grow' ? 'grow' : phase === 'turn' ? 'turn' : null} />
      )}
      {closing && (
        <Flyer set={set} defs={defs} badges={badges} isMe={isMe} full={false} spot={closing.spot} to={closing.to} spread={closing.spread}
          at={closing.phase === 'home' || closing.phase === 'land' ? 'shelf' : closing.phase === 'settle' ? 'mid' : 'cover'} lifted={closing.phase === 'settle' || closing.phase === 'home'}
          turned={closing.phase === 'prep'} fade={false}
          anim={closing.phase === 'shut' ? 'turn' : closing.phase === 'settle' ? 'grow' : closing.phase === 'home' ? 'home' : closing.phase === 'land' ? 'land' : null} />
      )}
    </div>
  )
}
