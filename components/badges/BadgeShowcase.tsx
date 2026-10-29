'use client'

import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import dynamic from 'next/dynamic'
import { Plus, X, Box, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { BadgeDef } from '@/lib/badges'
import { useBadgeCatalog } from '@/lib/badgeCatalog'
import type { SharedBadges } from '@/lib/firebase/badges'
import { BadgeSpot, FrameOrnament, PinholeFilter } from './BadgeBook'
import { BadgePin } from './BadgePin'

const PinInspector = dynamic(() => import('./PinInspector'), { ssr: false })

// A profile's pin display: a velvet pad (the pin book's own velvet, gold-foil frame and brass
// nameplates, in a leather border) with a few spots the owner fills with the earned pins they want
// to show off — click an empty spot and pick a pin; click a pin to swap it, take it off, or see it
// in 3D. Visitors see the chosen pins (and can open them in 3D). Saved as `profiles/{uid}.pinDisplay`.

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
  const earned = useMemo(() => catalog.badges.filter((d) => badges.earned[d.id]), [catalog.badges, badges])
  // Only pins actually earned are shown, whatever is stored
  const shown = ids.map((id) => (id && badges.earned[id] ? byId.get(id) ?? null : null))
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
  const pin = Math.max(56, Math.min(MAX_PIN, Math.max(0, width - 48) / COLS / 1.3))

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

  return (
    <div>
      <PinholeFilter />
      {/* The display pad: leather border, velvet, gold-foil frame */}
      <div className="pinbook-cover rounded-[18px] p-[9px]" style={{ ['--leather-from' as string]: '#5a4632', ['--leather-to' as string]: '#2a1f16', ['--accent' as string]: '#d9b25e' }}>
        <div ref={padRef} className="pinbook-page relative rounded-[12px]" style={{ boxShadow: 'inset 0 0 40px rgba(0,0,0,0.75), inset 0 0 0 1px rgba(255,255,255,0.04)' }}>
          <div className="pinbook-frame absolute inset-[12px] pointer-events-none">
            {(['tl', 'tr', 'bl', 'br'] as const).map((c) => <FrameOrnament key={c} at={c} />)}
          </div>
          <div className="relative flex items-center justify-center gap-3 pt-7 pb-1 px-8 pointer-events-none">
            <span className="pinbook-rule flex-1 max-w-[120px]" />
            <span className="pinbook-title pinbook-serif text-[clamp(12px,1.6vw,18px)] font-bold uppercase tracking-[0.32em] whitespace-nowrap">Pin Display</span>
            <span className="pinbook-rule pinbook-rule-r flex-1 max-w-[120px]" />
          </div>
          {nothing && !isMe && (
            <div className="relative text-center pinbook-serif text-[11px] font-bold uppercase tracking-[0.18em] text-[#d9b25e]/60">
              {first} hasn’t put any pins on display yet
            </div>
          )}

          <div className="relative grid justify-items-center gap-y-2 px-6 pt-3 pb-9" style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }}>
            {width > 0 && shown.map((def, i) => def ? (
              <BadgeSpot
                key={`${i}-${def.id}`}
                def={def} badges={badges} pin={pin} isMe={isMe} interactive below={i < COLS}
                onInspect={isMe ? () => setPicking(i) : setInspect}
              />
            ) : (
              <EmptyDisplaySpot key={`${i}-empty`} size={pin} canAdd={isMe} onClick={() => setPicking(i)} />
            ))}
          </div>
        </div>
      </div>

      {picking !== null && (
        <PinPicker
          current={shown[picking]}
          earned={earned}
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

// A spot with no pin: a round hole pressed into the velvet — the same inset shading as the book's
// pinholes (#pinhole-inset, PinholeFilter). The owner's have a faint + to fill them.
const CIRCLE = `url("data:image/svg+xml,${encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='49'/></svg>")}")`

function EmptyDisplaySpot({ size, canAdd, onClick }: { size: number; canAdd: boolean; onClick: () => void }) {
  const d = size * 0.9
  const hole = (
    <span className="relative flex items-center justify-center transition-transform duration-200 group-hover:scale-[1.03]" style={{ width: d, height: d }}>
      <span
        className="absolute inset-0"
        style={{ backgroundImage: CIRCLE, backgroundSize: 'contain', backgroundRepeat: 'no-repeat', filter: 'url(#pinhole-inset)' }}
      />
      {canAdd && <Plus size={Math.max(18, size * 0.18)} strokeWidth={1.5} className="relative text-[#d9b25e]/35 transition-colors group-hover:text-[#f1d58f]/80" />}
    </span>
  )
  const box = { width: size * 1.25, height: size * 1.16 + size * 0.2 }
  if (!canAdd) return <div className="flex items-center justify-center" style={box} aria-hidden>{hole}</div>
  return (
    <button type="button" onClick={onClick} aria-label="Put a pin here" className="group flex flex-col items-center justify-center gap-2 outline-none" style={box}>
      {hole}
      <span className="pinbook-serif text-[10px] font-bold uppercase tracking-[0.18em] text-[#d9b25e]/45 transition-colors group-hover:text-[#f1d58f]">Add a pin</span>
    </button>
  )
}

// Choose which earned pin goes in a spot (a pin already on display moves here)
function PinPicker({ current, earned, displayed, onPick, onRemove, onView, onClose }: {
  current: BadgeDef | null
  earned: BadgeDef[]
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
                <BadgePin art={d.art} imageUrl={d.imageUrl} size={64} />
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
