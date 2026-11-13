'use client'

// The Creator Wall's board (docs/creators.md "Creator Wall"): notes hang wherever the owner pinned them — moved,
// turned and sized by hand, overlapping like a real corkboard — not in rows. The board is BOARD_W units wide and
// drawn scaled to fit the page, so it looks the same on any computer. A note the owner hasn't placed yet is hung
// on its own (a loose, tilted column layout below the placed ones). On a narrow screen the notes stack instead.
//
// Arranging (the owner, on their own page): drag a note to move it, the round handle above it to turn it, its
// corner to make it bigger or smaller. Each change is saved when you let go (post.place: NotePlace).

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { RotateCw, MoveDiagonal2 } from 'lucide-react'
import type { NotePlace, WallPost } from '@/lib/communityBlocks'
import { hash } from '@/components/community/WallNote'
import { cn } from '@/lib/utils'

export const BOARD_W = 900
export const NOTE_W = 270
const NARROW = 560 // below this width (px) the notes stack
type Item = WallPost & { live?: boolean }
type Drag = { id: string; kind: 'move' | 'turn' | 'size'; px: number; py: number; start: NotePlace; cx: number; cy: number; a0: number; d0: number }

export function WallBoard({ posts, arranging, selected, onSelect, tiltK, columns, renderNote, onOpen, onPlace, minHeight = 420 }: {
  posts: Item[]
  arranging: boolean
  selected: string | null
  onSelect: (id: string | null) => void
  tiltK: number                       // the board's tilt setting (0 = straight) for notes hung on their own
  columns: number
  renderNote: (p: Item) => React.ReactNode
  onOpen: (p: Item) => void
  onPlace: (id: string, place: NotePlace) => void
  minHeight?: number
}) {
  const box = useRef<HTMLDivElement>(null)
  const [cw, setCw] = useState(0)
  const [heights, setHeights] = useState<Record<string, number>>({})
  const [drafts, setDrafts] = useState<Record<string, NotePlace>>({})
  const drag = useRef<Drag | null>(null)
  const moved = useRef(false)

  // the board's width on the page → its scale
  useLayoutEffect(() => {
    const el = box.current; if (!el) return
    const ro = new ResizeObserver(() => setCw(el.clientWidth)); ro.observe(el); setCw(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  const k = cw / BOARD_W
  const narrow = cw > 0 && cw < NARROW

  // each note's height (unscaled), so the board is tall enough and loose notes don't land on each other
  const ro = useRef<ResizeObserver | null>(null)
  if (typeof window !== 'undefined' && !ro.current) {
    ro.current = new ResizeObserver((es) => setHeights((h) => {
      let n: Record<string, number> | null = null
      for (const e of es) { const id = (e.target as HTMLElement).dataset.note!, v = (e.target as HTMLElement).offsetHeight; if (h[id] !== v) (n ??= { ...h })[id] = v }
      return n ?? h
    }))
  }
  useEffect(() => () => ro.current?.disconnect(), [])
  const measure = (el: HTMLDivElement | null) => { if (el) ro.current?.observe(el) }

  // where every note is: its own place (or the one being dragged), else hung on its own
  const places = useMemo(() => {
    const out: Record<string, NotePlace> = {}
    for (const p of posts) {
      const pl = drafts[p.id] ?? p.place
      if (pl) out[p.id] = pl
    }
    // notes not placed yet hang in loose, tilted columns from the top — never moved by where others are placed
    // (they sit under the placed ones until the owner puts them somewhere)
    const n = Math.max(1, Math.min(4, columns === 1 ? 3 : columns + 1)), colW = BOARD_W / n
    const tops = Array(n).fill(46)
    let lz = 0
    // oldest first, so a new note doesn't shuffle the others
    for (const p of [...posts].reverse()) {
      if (out[p.id]) continue
      const h = heights[p.id] ?? 300, j = hash(p.id), c = tops.indexOf(Math.min(...tops))
      out[p.id] = { x: Math.round(colW * (c + 0.5) + ((j % 41) - 20)), y: Math.round(tops[c] + h / 2), r: [-5, -3, -1.5, 1.5, 3, 4.5][j % 6] * tiltK, s: 1, z: lz-- }
      tops[c] += h + 46
    }
    return out
  }, [posts, drafts, heights, columns, tiltK])
  const topZ = Math.max(0, ...Object.values(places).map((p) => p.z))
  const height = Math.max(minHeight, ...posts.map((p) => { const pl = places[p.id]; return pl.y + ((heights[p.id] ?? 300) * pl.s) / 2 + 40 })) + (arranging ? 220 : 0)

  // dragging: move, turn or size — saved on letting go. A note may hang off the board's edges (over its frame,
  // its title, past its sides) — on purpose, it's a creative board; only kept from vanishing entirely
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current; if (!d) return
      moved.current = true
      let next = d.start
      if (d.kind === 'move') next = { ...d.start, x: clamp(d.start.x + (e.clientX - d.px) / k, -NOTE_W * 0.4, BOARD_W + NOTE_W * 0.4), y: Math.max(-120, d.start.y + (e.clientY - d.py) / k) }
      if (d.kind === 'turn') {
        let r = d.start.r + angle(d.cx, d.cy, e.clientX, e.clientY) - d.a0
        r = ((r + 540) % 360) - 180
        if (Math.abs(r) < 2.5) r = 0 // snaps straight
        next = { ...d.start, r }
      }
      if (d.kind === 'size') next = { ...d.start, s: clamp(d.start.s * Math.hypot(e.clientX - d.cx, e.clientY - d.cy) / d.d0, 0.55, 1.9) }
      setDrafts((x) => ({ ...x, [d.id]: next }))
    }
    const up = () => {
      const d = drag.current; if (!d) return
      drag.current = null
      setDrafts((x) => {
        const p = x[d.id]
        if (p && moved.current) onPlace(d.id, { x: Math.round(p.x), y: Math.round(p.y), r: Math.round(p.r * 10) / 10, s: Math.round(p.s * 100) / 100, z: p.z })
        return x
      })
    }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
  }, [k, onPlace])

  function start(e: React.PointerEvent, p: Item, kind: Drag['kind']) {
    if (!arranging || !p.live) return
    e.preventDefault(); e.stopPropagation()
    onSelect(p.id)
    const el = (e.currentTarget as HTMLElement).closest('[data-wrap]') as HTMLElement
    const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2
    const pl = places[p.id], lifted = { ...pl, z: pl.z === topZ ? pl.z : topZ + 1 } // brought to the front
    moved.current = lifted.z !== pl.z
    if (moved.current) setDrafts((x) => ({ ...x, [p.id]: lifted }))
    drag.current = { id: p.id, kind, px: e.clientX, py: e.clientY, start: lifted, cx, cy, a0: angle(cx, cy, e.clientX, e.clientY), d0: Math.max(20, Math.hypot(e.clientX - cx, e.clientY - cy)) }
  }

  if (narrow) {
    // a phone: the notes one under another, still a little turned
    return (
      <div ref={box} className="flex flex-col gap-8 pt-3">
        {posts.map((p) => (
          <div key={p.id} className="mx-auto w-full max-w-[340px]" style={{ rotate: `${clamp(places[p.id]?.r ?? 0, -4, 4)}deg` }} onClick={() => onOpen(p)}>{renderNote(p)}</div>
        ))}
      </div>
    )
  }

  return (
    <div ref={box} className={cn('relative w-full', arranging && 'select-none')} style={{ height: cw ? height * k : minHeight }} onPointerDown={() => arranging && onSelect(null)}>
      {cw > 0 && (
        <div className="absolute left-0 top-0 origin-top-left" style={{ width: BOARD_W, height, transform: `scale(${k})` }}>
          {posts.map((p) => {
            const pl = places[p.id], sel = arranging && selected === p.id, can = arranging && !!p.live
            return (
              <div key={p.id} data-wrap className={cn('absolute', can && 'cursor-grab active:cursor-grabbing touch-none', arranging && '[&_.cork-note]:!rotate-0 [&_.cork-note]:!translate-y-0')}
                style={{ left: pl.x, top: pl.y, width: NOTE_W, zIndex: pl.z, transform: `translate(-50%, -50%) rotate(${pl.r}deg) scale(${pl.s})`, transition: drag.current?.id === p.id ? 'none' : 'transform 0.2s ease' }}
                onPointerDown={(e) => start(e, p, 'move')}
                onClick={(e) => { e.stopPropagation(); if (!arranging) onOpen(p) }}>
                <div data-note={p.id} ref={measure} className={cn(sel && 'outline outline-2 outline-offset-4 outline-[#f6ead0] shadow-[0_0_0_6px_rgba(43,32,20,0.35)]')}>
                  {renderNote(p)}
                </div>
                {sel && (<>
                  {/* turn: the round handle above; size: the corner */}
                  <span className="absolute left-1/2 -top-[68px] -translate-x-1/2 flex flex-col items-center" style={{ transform: `translateX(-50%) scale(${1 / pl.s})`, transformOrigin: 'bottom center' }}>
                    <button type="button" aria-label="Turn this note" onPointerDown={(e) => start(e, p, 'turn')}
                      className="w-8 h-8 rounded-full bg-[#2b2014] text-[#fbf6ea] flex items-center justify-center cursor-alias touch-none"><RotateCw size={15} /></button>
                    <span className="w-px h-8 bg-[#2b2014]" />
                  </span>
                  <button type="button" aria-label="Resize this note" onPointerDown={(e) => start(e, p, 'size')}
                    className="absolute -right-4 -bottom-4 w-8 h-8 rounded-full bg-[#2b2014] text-[#fbf6ea] flex items-center justify-center cursor-nwse-resize touch-none"
                    style={{ transform: `scale(${1 / pl.s})` }}><MoveDiagonal2 size={15} /></button>
                </>)}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const angle = (cx: number, cy: number, x: number, y: number) => (Math.atan2(y - cy, x - cx) * 180) / Math.PI
