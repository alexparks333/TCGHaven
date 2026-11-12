'use client'

// A creator book's spine (Creator Studio cover designer, docs/creators.md): a band down the cover's
// left edge. It eats into the cover, not past it — the book stays the same size and the cover
// picture fills what's left beside it (coverArea()). 14 looks, each with its own colour parts and
// its own sliders (SpineDef), all stored on CoverStyle: spine, spineColor / spineAccent /
// spineDetail, spineWidth, spineRound and spineParams[look][slider].

import { useId, type ReactNode } from 'react'
import type { CoverStyle } from '@/lib/badges'

/** A creator cover with no picture yet: plain tan book board (the old leather colours aren't used) */
export const BLANK_COVER = '#cdb68c'

/** A spine's width when it hasn't been changed, in % of the cover's width */
export const SPINE_W = 13
export const SPINE_W_RANGE = [8, 24] as const
const H = 108 // the spine is drawn 108 units tall; its width in units follows its real shape

export const SPINE_COLORS = [
  { name: 'Walnut', color: '#4a2c17' }, { name: 'Oxblood', color: '#5c1a17' }, { name: 'Navy', color: '#1c2a44' },
  { name: 'Forest', color: '#1f3a2a' }, { name: 'Ink', color: '#1b1714' }, { name: 'Saddle', color: '#8a6038' },
  { name: 'Plum', color: '#47203f' }, { name: 'Teal', color: '#1d4a4f' }, { name: 'Cream', color: '#e8dcc0' },
]
export const ACCENT_COLORS = [
  { name: 'Gold', color: '#d6b168' }, { name: 'Pale gold', color: '#f2d38a' }, { name: 'Silver', color: '#c9ccd1' },
  { name: 'Copper', color: '#b87333' }, { name: 'Linen', color: '#ead9b4' }, { name: 'White', color: '#ffffff' },
  { name: 'Black', color: '#1b1714' }, { name: 'Red', color: '#c0392b' }, { name: 'Sky', color: '#8fb6ff' },
  { name: 'Mint', color: '#6fd3a2' }, { name: 'Lilac', color: '#c79bff' }, { name: 'Pink', color: '#f5a3c7' },
]

export interface SpineSlider { key: string; label: string; min: number; max: number; step: number; def: number }
interface Ctx { W: number; p: Record<string, number>; base: string; accent: string; detail: string; id: string }
export interface SpineDef {
  id: string
  name: string
  base: string                       // what the main colour is called ("Leather", "Cloth"…)
  accent?: [label: string, def: string]
  detail?: [label: string, def: string]
  sliders: SpineSlider[]
  draw: (c: Ctx) => ReactNode
}

const s = (key: string, label: string, min: number, max: number, step: number, def: number): SpineSlider => ({ key, label, min, max, step, def })
const range = (n: number) => Array.from({ length: Math.max(0, Math.round(n)) }, (_, i) => i)
// The same "random" stars every time for one seed
function seeded(seed: number) {
  let a = Math.round(seed * 9973) >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

export const SPINES: SpineDef[] = [
  {
    id: 'bands', name: 'Raised bands', base: 'Leather', accent: ['Gilt lines', '#d6b168'],
    sliders: [s('count', 'Bands', 1, 9, 1, 5), s('thick', 'Thickness', 1, 6, 0.1, 2.6), s('gilt', 'Gilt lines', 0, 1, 0.05, 0)],
    draw: ({ W, p, base, accent, id }) => range(p.count).map((i) => {
      const y = (H * (i + 1)) / (p.count + 1), t = p.thick
      return (
        <g key={i}>
          <rect y={y - t / 2} width={W} height={t} fill={base} />
          <rect y={y - t / 2} width={W} height={t} fill={`url(#${id}b)`} />
          <rect y={y + t / 2} width={W} height="0.5" fill="#000" opacity="0.35" />
          {p.gilt > 0 && <path d={`M0 ${y - t / 2 + 0.35} H${W} M0 ${y + t / 2 - 0.35} H${W}`} stroke={accent} strokeWidth="0.25" opacity={p.gilt} />}
        </g>
      )
    }),
  },
  {
    id: 'stitched', name: 'Stitched', base: 'Leather', accent: ['Thread', '#ead9b4'],
    sliders: [s('rows', 'Rows', 1, 3, 1, 1), s('stitch', 'Stitch length', 0.5, 3, 0.1, 1.4), s('inset', 'Inset', 0.6, 3, 0.1, 1.6), s('thread', 'Thread', 0.15, 0.7, 0.05, 0.32)],
    draw: ({ W, p, accent }) => range(p.rows).map((k) => {
      const i = p.inset + k * 1.1
      if (W - i <= i + 0.5) return null
      return <path key={k} d={`M${i} 3 V${H - 3} M${W - i} 3 V${H - 3} M${i} 3 H${W - i} M${i} ${H - 3} H${W - i}`}
        fill="none" stroke={accent} strokeWidth={p.thread} strokeDasharray={`${p.stitch} ${p.stitch * 0.7}`} opacity="0.85" />
    }),
  },
  {
    id: 'gilded', name: 'Gilded', base: 'Leather', accent: ['Gold', '#d6b168'],
    sliders: [s('orn', 'Ornaments', 0, 6, 1, 3), s('size', 'Ornament size', 1.5, 6, 0.1, 3.2), s('rules', 'Rules', 0, 3, 1, 1), s('border', 'Border', 0, 1, 0.05, 0.7)],
    draw: ({ W, p, accent }) => {
      const half = Math.min(p.size * 0.7, W / 2 - 0.8), cx = W / 2
      return (
        <g fill="none" stroke={accent} strokeWidth="0.3">
          {p.border > 0 && <path d={`M1.2 2 V${H - 2} M${W - 1.2} 2 V${H - 2}`} opacity={p.border} />}
          {range(p.rules).flatMap((r) => [8 + r * 3.2, H - 8 - r * 3.2]).map((y, k) => <path key={k} d={`M1.2 ${y - 0.7} H${W - 1.2} M1.2 ${y + 0.7} H${W - 1.2}`} />)}
          {range(p.orn).map((i) => {
            const y = 22 + ((H - 44) * (i + 0.5)) / Math.max(1, p.orn)
            return (
              <g key={i}>
                <path d={`M${cx} ${y - p.size} L${cx + half} ${y} L${cx} ${y + p.size} L${cx - half} ${y} Z`} />
                <path d={`M${cx} ${y - p.size * 0.45} L${cx + half * 0.45} ${y} L${cx} ${y + p.size * 0.45} L${cx - half * 0.45} ${y} Z`} fill={accent} stroke="none" />
              </g>
            )
          })}
        </g>
      )
    },
  },
  {
    id: 'cloth', name: 'Bookcloth', base: 'Cloth', accent: ['Labels', '#d6b168'],
    sliders: [s('weave', 'Weave size', 0.4, 2, 0.05, 0.8), s('texture', 'Texture', 0, 0.45, 0.01, 0.14), s('label', 'Label size', 0, 16, 0.5, 9)],
    draw: ({ W, p, accent, id }) => (
      <>
        <defs>
          <pattern id={`${id}w`} width={p.weave} height={p.weave} patternUnits="userSpaceOnUse">
            <path d={`M0 0 H${p.weave} M0 0 V${p.weave}`} stroke="#fff" strokeOpacity={p.texture} strokeWidth={p.weave * 0.22} />
          </pattern>
        </defs>
        <rect width={W} height={H} fill={`url(#${id}w)`} />
        {p.label > 0.5 && (
          <g fill="none" stroke={accent} strokeWidth="0.35">
            <rect x={W * 0.24} y="6" width={W * 0.52} height={p.label} />
            <rect x={W * 0.24} y={H - 6 - p.label} width={W * 0.52} height={p.label} />
          </g>
        )}
      </>
    ),
  },
  {
    id: 'stripes', name: 'Racing stripes', base: 'Leather', accent: ['Stripes', '#ead9b4'], detail: ['Pinlines', '#d6b168'],
    sliders: [s('count', 'Stripes', 1, 4, 1, 2), s('wide', 'Stripe width', 0.3, 3.5, 0.05, 1.2), s('gap', 'Gap', 0.2, 3, 0.05, 0.8), s('pin', 'Pinlines', 0, 1, 0.05, 0)],
    draw: ({ W, p, accent, detail }) => {
      const n = Math.round(p.count), total = n * p.wide + (n - 1) * p.gap, x0 = (W - total) / 2
      return range(n).map((i) => {
        const x = x0 + i * (p.wide + p.gap)
        return (
          <g key={i}>
            <rect x={x} width={p.wide} height={H} fill={accent} />
            {p.pin > 0 && <path d={`M${x - 0.25} 0 V${H} M${x + p.wide + 0.25} 0 V${H}`} stroke={detail} strokeWidth="0.18" opacity={p.pin} />}
          </g>
        )
      })
    },
  },
  {
    id: 'chevron', name: 'Chevrons', base: 'Leather', accent: ['Chevrons', '#d6b168'],
    sliders: [s('gap', 'Spacing', 1.5, 12, 0.1, 4.5), s('depth', 'Point', -6, 6, 0.1, 2.5), s('weight', 'Line weight', 0.2, 2.5, 0.05, 0.7)],
    draw: ({ W, p, accent }) => (
      <g fill="none" stroke={accent} strokeWidth={p.weight} strokeLinejoin="round">
        {range((H + 16) / p.gap).map((i) => {
          const y = -8 + i * p.gap
          return <path key={i} d={`M-1 ${y} L${W / 2} ${y + p.depth} L${W + 1} ${y}`} />
        })}
      </g>
    ),
  },
  {
    id: 'dots', name: 'Polka dots', base: 'Leather', accent: ['Dots', '#ead9b4'],
    sliders: [s('size', 'Dot size', 0.2, 2.2, 0.05, 0.7), s('space', 'Spacing', 1.2, 7, 0.1, 2.8), s('stagger', 'Stagger', 0, 1, 1, 1)],
    draw: ({ W, p, accent, id }) => {
      const sp = p.space, off = p.stagger ? sp / 2 : 0
      return (
        <>
          <defs>
            <pattern id={`${id}d`} width={sp} height={sp * 2} patternUnits="userSpaceOnUse" x={(W % sp) / 2}>
              <circle cx={sp / 2} cy={sp / 2} r={p.size} fill={accent} />
              <circle cx={sp / 2 + off} cy={sp * 1.5} r={p.size} fill={accent} />
              {off > 0 && <circle cx={sp / 2 + off - sp} cy={sp * 1.5} r={p.size} fill={accent} />}
            </pattern>
          </defs>
          <rect width={W} height={H} fill={`url(#${id}d)`} />
        </>
      )
    },
  },
  {
    id: 'harlequin', name: 'Harlequin', base: 'First colour', accent: ['Second colour', '#a8452a'], detail: ['Outline', '#d6b168'],
    sliders: [s('tall', 'Diamond height', 3, 24, 0.5, 9), s('cols', 'Across', 1, 3, 1, 1), s('line', 'Outline', 0, 0.7, 0.05, 0.25)],
    draw: ({ W, p, accent, detail, id }) => {
      const w = W / Math.round(p.cols), h = p.tall
      return (
        <>
          <defs>
            <pattern id={`${id}h`} width={w} height={h} patternUnits="userSpaceOnUse">
              <path d={`M${w / 2} 0 L${w} ${h / 2} L${w / 2} ${h} L0 ${h / 2} Z`} fill={accent} stroke={detail} strokeWidth={p.line} strokeOpacity={p.line > 0 ? 1 : 0} />
            </pattern>
          </defs>
          <rect width={W} height={H} fill={`url(#${id}h)`} />
        </>
      )
    },
  },
  {
    id: 'scales', name: 'Dragon scales', base: 'Hide', accent: ['Scale edges', '#d6b168'],
    sliders: [s('size', 'Scale size', 1.2, 6, 0.1, 2.8), s('depth', 'Depth', 0, 1, 0.05, 0.5), s('edge', 'Edge', 0, 0.6, 0.02, 0.22)],
    draw: ({ W, p, accent, id }) => {
      const z = p.size, r = z / 2
      const scale = (x: number, y: number, k: number) => (
        <path key={k} d={`M${x} ${y} A${r} ${r} 0 0 0 ${x + z} ${y} Z`} fill="#000" fillOpacity={p.depth * 0.3} stroke={accent} strokeWidth={p.edge} strokeOpacity={p.edge > 0 ? 1 : 0} />
      )
      return (
        <>
          <defs>
            <pattern id={`${id}t`} width={z} height={z} patternUnits="userSpaceOnUse" x={(W % z) / 2}>
              {scale(0, 0, 0)}{scale(-r, r, 1)}{scale(r, r, 2)}
            </pattern>
          </defs>
          <rect width={W} height={H} fill={`url(#${id}t)`} />
        </>
      )
    },
  },
  {
    id: 'stars', name: 'Starry night', base: 'Sky', accent: ['Stars', '#f2d38a'], detail: ['Moon', '#f3e9d3'],
    sliders: [s('count', 'Stars', 4, 70, 1, 24), s('size', 'Star size', 0.3, 1.8, 0.05, 0.7), s('seed', 'Shuffle', 1, 60, 1, 7), s('moon', 'Moon height', 0, 100, 1, 18)],
    draw: ({ W, p, base, accent, detail }) => {
      const rnd = seeded(p.seed)
      const mr = W * 0.26, my = 6 + ((H - 12) * p.moon) / 100
      return (
        <>
          {range(p.count).map((i) => {
            const x = 0.8 + rnd() * (W - 2.2), y = 2 + rnd() * (H - 4), k = p.size * (0.5 + rnd() * 0.8), q = k * 0.28
            return <path key={i} d={`M${x} ${y - k} L${x + q} ${y - q} L${x + k} ${y} L${x + q} ${y + q} L${x} ${y + k} L${x - q} ${y + q} L${x - k} ${y} L${x - q} ${y - q} Z`} fill={accent} opacity={0.55 + rnd() * 0.45} />
          })}
          {p.moon > 0 && (
            <>
              <circle cx={W / 2} cy={my} r={mr} fill={detail} />
              <circle cx={W / 2 + mr * 0.45} cy={my - mr * 0.25} r={mr * 0.85} fill={base} />
            </>
          )}
        </>
      )
    },
  },
  {
    id: 'waves', name: 'Waves', base: 'Leather', accent: ['Waves', '#8fb6ff'],
    sliders: [s('count', 'Lines', 1, 10, 1, 4), s('amp', 'Wave height', 0, 3, 0.05, 0.9), s('length', 'Wave length', 2, 24, 0.5, 8), s('twist', 'Twist', 0, 3.14, 0.05, 1), s('weight', 'Line weight', 0.15, 1.5, 0.05, 0.45)],
    draw: ({ W, p, accent }) => (
      <g fill="none" stroke={accent} strokeWidth={p.weight} strokeLinecap="round">
        {range(p.count).map((i) => {
          const cx = (W * (i + 0.5)) / Math.round(p.count)
          const pts: string[] = []
          for (let y = 0; y <= H; y += 0.6) pts.push(`${(cx + p.amp * Math.sin((2 * Math.PI * y) / p.length + i * p.twist)).toFixed(2)},${y.toFixed(1)}`)
          return <polyline key={i} points={pts.join(' ')} />
        })}
      </g>
    ),
  },
  {
    id: 'riveted', name: 'Riveted metal', base: 'Leather', accent: ['Metal', '#b08d57'], detail: ['Rivets', '#f2d38a'],
    sliders: [s('edge', 'Strip width', 0, 3, 0.05, 1.3), s('rivets', 'Rivets', 2, 20, 1, 8), s('rsize', 'Rivet size', 0.2, 1.2, 0.02, 0.65), s('plates', 'Plates', 0, 4, 1, 2)],
    draw: ({ W, p, accent, detail, id }) => {
      const e = p.edge, n = Math.round(p.rivets)
      const xs = e > 0.3 ? [e / 2, W - 0.7 - e / 2] : [W / 2]
      return (
        <>
          {e > 0 && [0, W - 0.7 - e].map((x) => (
            <g key={x}><rect x={x} width={e} height={H} fill={accent} /><rect x={x} width={e} height={H} fill={`url(#${id}m)`} /></g>
          ))}
          {range(p.plates).map((i) => {
            const y = (H * (i + 1)) / (p.plates + 1)
            return <g key={i}><rect y={y - 2} width={W} height="4" fill={accent} /><rect y={y - 2} width={W} height="4" fill={`url(#${id}b)`} /></g>
          })}
          {xs.flatMap((x) => range(n).map((i) => {
            const y = 3 + ((H - 6) * i) / Math.max(1, n - 1)
            return (
              <g key={`${x}-${i}`}>
                <circle cx={x} cy={y} r={p.rsize} fill={detail} stroke="#000" strokeOpacity="0.45" strokeWidth="0.12" />
                <circle cx={x - p.rsize * 0.3} cy={y - p.rsize * 0.3} r={p.rsize * 0.35} fill="#fff" opacity="0.55" />
              </g>
            )
          }))}
        </>
      )
    },
  },
  {
    id: 'laced', name: 'Laced up', base: 'Leather', accent: ['Laces', '#ead9b4'], detail: ['Eyelets', '#c9ccd1'],
    sliders: [s('cross', 'Crosses', 2, 16, 1, 7), s('spread', 'Spread', 0.3, 0.9, 0.01, 0.55), s('lace', 'Lace weight', 0.15, 1, 0.05, 0.4), s('eye', 'Eyelet size', 0.2, 1.2, 0.02, 0.6)],
    draw: ({ W, p, accent, detail }) => {
      const n = Math.round(p.cross), xl = W * (0.5 - p.spread / 2), xr = W * (0.5 + p.spread / 2)
      const ys = range(n + 1).map((i) => 5 + ((H - 10) * i) / n)
      return (
        <>
          <g stroke={accent} strokeWidth={p.lace} strokeLinecap="round">
            {range(n).map((i) => <path key={i} d={`M${xl} ${ys[i]} L${xr} ${ys[i + 1]} M${xr} ${ys[i]} L${xl} ${ys[i + 1]}`} />)}
          </g>
          {ys.flatMap((y, i) => [xl, xr].map((x) => <circle key={`${i}-${x}`} cx={x} cy={y} r={p.eye} fill="none" stroke={detail} strokeWidth={p.eye * 0.45} />))}
        </>
      )
    },
  },
  {
    id: 'checker', name: 'Checkerboard', base: 'First colour', accent: ['Second colour', '#e8dcc0'],
    sliders: [s('size', 'Square size', 0.8, 6, 0.1, 2.4), s('tilt', 'Tilt', 0, 45, 1, 0)],
    draw: ({ W, p, accent, id }) => {
      const z = p.size
      return (
        <>
          <defs>
            <pattern id={`${id}k`} width={z * 2} height={z * 2} patternUnits="userSpaceOnUse" patternTransform={`rotate(${p.tilt} ${W / 2} ${H / 2})`}>
              <rect width={z} height={z} fill={accent} /><rect x={z} y={z} width={z} height={z} fill={accent} />
            </pattern>
          </defs>
          <rect width={W} height={H} fill={`url(#${id}k)`} />
        </>
      )
    },
  },
]

/** The cover's spine look, if it has one (an unknown id = none) */
export const spineOf = (st?: CoverStyle) => SPINES.find((x) => x.id === st?.spine)
export const spineWidth = (st?: CoverStyle) => Math.min(SPINE_W_RANGE[1], Math.max(SPINE_W_RANGE[0], st?.spineWidth ?? SPINE_W))
/** One spine's slider values: what the creator set, else the look's defaults (kept in range) */
export function spineParams(def: SpineDef, st?: CoverStyle): Record<string, number> {
  const saved = st?.spineParams?.[def.id] ?? {}
  return Object.fromEntries(def.sliders.map((x) => [x.key, Math.min(x.max, Math.max(x.min, saved[x.key] ?? x.def))]))
}

/** Where the cover picture goes: the whole cover, or what's beside the spine (left, width in %) */
export function coverArea(st?: CoverStyle) {
  const w = spineOf(st) ? spineWidth(st) : 0
  return { left: w, width: 100 - w }
}

/** The spine itself. On a cover: down the left edge of the nearest `relative` box. As a swatch
 *  (`swatch` = the box's width ÷ height): filling its box. `look` overrides the cover's own. */
export function CoverSpine({ st, look, swatch }: { st?: CoverStyle; look?: string; swatch?: number }) {
  const id = 'spine' + useId().replace(/:/g, '')
  const def = SPINES.find((x) => x.id === (look ?? st?.spine))
  if (!def) return null
  const width = spineWidth(st)
  // Its width in units, from its real shape (the cover is 0.71 wide : 1 tall), so dots stay round
  const W = swatch ? H * swatch : (H * 0.71 * width) / 100
  const base = st?.spineColor ?? SPINE_COLORS[0].color
  const ctx: Ctx = { W, p: spineParams(def, st), base, accent: st?.spineAccent ?? def.accent?.[1] ?? '#d6b168', detail: st?.spineDetail ?? def.detail?.[1] ?? '#d6b168', id }
  const round = st?.spineRound ?? 0.8
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden
      className={swatch ? 'absolute inset-0 w-full h-full pointer-events-none' : 'absolute inset-y-0 left-0 h-full pointer-events-none'}
      style={swatch ? undefined : { width: `${width}%` }}>
      <defs>
        {/* Rounded like a real spine: dark at both edges, a soft light down the middle */}
        <linearGradient id={`${id}r`} x1="0" x2="1">
          <stop offset="0" stopColor="#000" stopOpacity="0.55" />
          <stop offset="0.35" stopColor="#fff" stopOpacity="0.16" />
          <stop offset="0.7" stopColor="#000" stopOpacity="0.05" />
          <stop offset="1" stopColor="#000" stopOpacity="0.5" />
        </linearGradient>
        {/* A raised band: lit on top, shadowed below */}
        <linearGradient id={`${id}b`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="0.5" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.55" />
        </linearGradient>
        {/* Brushed metal */}
        <linearGradient id={`${id}m`} x1="0" x2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="0.5" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.4" />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill={base} />
      {def.draw(ctx)}
      <rect width={W} height={H} fill={`url(#${id}r)`} opacity={round} />
      {/* The hinge: a groove where the spine meets the cover */}
      {!swatch && (
        <>
          <rect x={W - 0.7} width="0.35" height={H} fill="#000" opacity="0.55" />
          <rect x={W - 0.35} width="0.35" height={H} fill="#fff" opacity="0.12" />
        </>
      )}
    </svg>
  )
}
