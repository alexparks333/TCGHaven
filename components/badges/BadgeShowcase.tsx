'use client'

import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { PinInspector } from './pinInspectorLoader'
import { Plus, X, Box, Trash2 } from 'lucide-react'
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
const COLS = 3

export function BadgeShowcase({ badges, isMe, ownerName, ids, onChange }: {
  badges: SharedBadges
  isMe: boolean
  ownerName: string
  ids: string[]                       // one per spot, '' = empty
  onChange?: (ids: string[]) => void  // the owner rearranged it
}) {
  const { catalog } = useBadgeCatalog()
  const byId = useMemo(() => new Map(catalog.badges.map((b) => [b.id, b])), [catalog.badges])
  const tierOf = (d: BadgeDef) => badgeTier(d, badges.progress[d.id])
  const earned = useMemo(() => catalog.badges.filter((d) => badgeTier(d, badges.progress[d.id]) > 0), [catalog.badges, badges])
  // Only pins actually unlocked (any tier) are shown, whatever is stored — in their tier's look
  const shown = ids.map((id) => { const d = id ? byId.get(id) : undefined; return d && tierOf(d) > 0 ? d : null })
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
  const pin = Math.max(56, Math.min(MAX_PIN, Math.max(0, width - 64) / COLS / 1.38))

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

  return (
    <div>
      <PinholeFilter />
      {/* The case: walnut frame → the velvet well under glass */}
      <div className="case-wood relative rounded-[16px] px-[clamp(12px,2.2vw,22px)] pt-[clamp(26px,3.6vw,38px)] pb-[clamp(22px,3vw,32px)]">
        {/* brass corner caps */}
        {(['top-[6px] left-[6px]', 'top-[6px] right-[6px] rotate-90', 'bottom-[6px] right-[6px] rotate-180', 'bottom-[6px] left-[6px] -rotate-90'] as const).map((at) => (
          <span key={at} aria-hidden className={cn('case-brass case-corner pointer-events-none', at)} />
        ))}
        {/* Brass plaque on the top rail */}
        <div className="absolute left-1/2 -translate-x-1/2 top-[clamp(5px,0.9vw,9px)] z-10 max-w-[80%]">
          <div className="case-brass relative flex items-center gap-3 rounded-[3px] pl-6 pr-6 py-[5px]">
            <span className="case-screw absolute left-[7px] top-1/2 -translate-y-1/2 w-[7px] h-[7px] rounded-full" />
            <span className="pinbook-serif truncate text-[clamp(10px,1.3vw,14px)] font-bold uppercase tracking-[0.22em]">{owner}</span>
            <span className="case-screw absolute right-[7px] top-1/2 -translate-y-1/2 w-[7px] h-[7px] rounded-full" />
          </div>
        </div>

        <div className="case-bead rounded-[10px] p-[2px]">
        <div ref={padRef} className="pinbook-page case-well relative rounded-[8px] overflow-hidden">
          <div className="case-light absolute inset-0 pointer-events-none" />
          {nothing && !isMe && (
            <div className="relative text-center pinbook-serif text-[11px] font-bold uppercase tracking-[0.18em] text-[#d9b25e]/60 pt-12 pb-12">
              {first} hasn’t put any pins on display yet
            </div>
          )}
          {places.length > 0 && (
            <div className="relative flex flex-wrap justify-center gap-x-[clamp(4px,3vw,40px)] gap-y-3 px-4 pt-[clamp(22px,3.4vw,40px)] pb-[clamp(20px,3vw,36px)]">
              {width > 0 && places.map(({ def, i }) => (
                <div key={`${i}-${def?.id ?? 'empty'}`} className="relative flex justify-center" style={{ width: pin * 1.25 }}>
                  {def ? (
                    <>
                      {/* its pool of light, and its shadow pressed into the velvet */}
                      <span aria-hidden className="case-spot absolute pointer-events-none" style={{ width: pin * 1.9, height: pin * 1.9, left: '50%', top: pin * 0.56, transform: 'translate(-50%, -50%)' }} />
                      <span aria-hidden className="case-contact absolute pointer-events-none" style={{ width: pin * 0.9, height: pin * 0.22, left: '50%', top: pin * 1.06, transform: 'translate(-50%, -50%)' }} />
                      <BadgeSpot
                        def={def} badges={badges} pin={pin} isMe={isMe} interactive below={i < COLS}
                        onInspect={isMe ? () => setPicking(i) : setInspect}
                      />
                    </>
                  ) : (
                    <EmptyDisplaySpot size={pin} canAdd={isMe} onClick={() => setPicking(i)} />
                  )}
                </div>
              ))}
            </div>
          )}
          {/* The glass over it all */}
          <div className="case-glass absolute inset-0 pointer-events-none rounded-[8px]" />
        </div>
        </div>

        {/* A small brass tag on the bottom rail: how many pins earned */}
        {earned.length > 0 && (
          <div className="absolute right-[clamp(40px,5vw,56px)] bottom-[clamp(4px,0.7vw,7px)] case-brass rounded-[2px] px-2 py-[2px] pinbook-serif text-[9px] font-bold uppercase tracking-[0.18em]">
            {earned.length} {earned.length === 1 ? 'pin' : 'pins'} earned
          </div>
        )}
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
        />
      )}
    </div>
  )
}

// An empty place (the owner's view only): a fine engraved ring in the velvet with a faint + to fill it

function EmptyDisplaySpot({ size, canAdd, onClick }: { size: number; canAdd: boolean; onClick: () => void }) {
  const d = size * 0.86
  const ring = (
    <span className="case-empty relative flex items-center justify-center rounded-full transition-colors duration-200 group-hover:border-[rgba(241,213,143,0.6)]" style={{ width: d, height: d }}>
      {canAdd && <Plus size={Math.max(18, size * 0.18)} strokeWidth={1.5} className="relative text-[#d9b25e]/40 transition-colors group-hover:text-[#f1d58f]/85" />}
    </span>
  )
  const box = { width: size * 1.25, height: size * 1.16 + size * 0.2 }
  if (!canAdd) return <div className="flex items-center justify-center" style={box} aria-hidden>{ring}</div>
  return (
    <button type="button" onClick={onClick} aria-label="Put a pin here" className="group flex flex-col items-center justify-center gap-2 outline-none" style={box}>
      {ring}
      <span className="pinbook-serif text-[10px] font-bold uppercase tracking-[0.18em] text-[#d9b25e]/45 transition-colors group-hover:text-[#f1d58f]">Add a pin</span>
    </button>
  )
}

// Choose which earned pin goes in a spot (a pin already on display moves here)
function PinPicker({ current, earned, tierOf, displayed, onPick, onRemove, onView, onClose }: {
  current: BadgeDef | null
  earned: BadgeDef[]
  tierOf: (d: BadgeDef) => number
  displayed: Set<string>
  onPick: (id: string) => void
  onRemove: () => void
  onView: (d: BadgeDef) => void
  onClose: () => void
}) {
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Choose a pin"
        className="w-full max-w-lg max-h-[85vh] flex flex-col rounded-2xl border border-slate-700 bg-slate-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 pt-4 pb-3 border-b border-slate-800">
          <div className="flex-1">
            <div className="text-base font-bold text-ink">{current ? 'Change this pin' : 'Choose a pin to display'}</div>
            <div className="text-xs text-slate-500">Any pin you’ve earned</div>
          </div>
          <button onClick={onClose} aria-label="Close" className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:text-ink hover:bg-slate-800"><X size={17} /></button>
        </div>

        {current && (
          <div className="flex gap-2 px-5 pt-3">
            <button onClick={() => onView(current)} className="btn-secondary flex items-center gap-1.5 text-xs"><Box size={14} />View in 3D</button>
            <button onClick={onRemove} className="btn-secondary flex items-center gap-1.5 text-xs"><Trash2 size={14} />Take it off</button>
          </div>
        )}

        <div className="overflow-y-auto p-5 grid grid-cols-3 sm:grid-cols-4 gap-3">
          {earned.length === 0 && (
            <div className="col-span-full text-center text-sm text-slate-500 py-8">Earn your first pin and it can go on display here.</div>
          )}
          {earned.map((d) => {
            const here = current?.id === d.id
            const elsewhere = !here && displayed.has(d.id)
            return (
              <button
                key={d.id}
                onClick={() => (here ? onClose() : onPick(d.id))}
                className={cn('relative flex flex-col items-center gap-1.5 rounded-xl p-2 border transition-colors text-center', here ? 'border-violet-600 bg-violet-600/10' : 'border-slate-800 hover:border-slate-600 hover:bg-slate-900')}
              >
                <span className={cn('flex items-center justify-center', tierOf(d) === 1 && 'grayscale')} style={{ width: 64, height: 64 * 1.12 }}><BadgePin art={d.art} imageUrl={d.imageUrl} size={pinSize(d, 64)} /></span>
                <span className="text-[11px] font-semibold text-ink leading-tight line-clamp-2">{d.name}</span>
                {(here || elsewhere) && (
                  <span className="absolute top-1 right-1 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-400">
                    {here ? 'Here' : 'Shown'}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>,
    document.body,
  )
}
