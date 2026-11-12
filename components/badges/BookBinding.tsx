'use client'

// What holds a book's pages together down the middle, as fans see it (the pin book — BadgeBook — and
// the Studio's "Preview as a fan"; the Studio's editing pages leave it out so the pages are easy to
// work on). TCG Haven's books keep their silver rings; a creator picks one of these in Inside look →
// Center rings, each with its own colours and sliders (InsideStyle.binding*), or None.
// Everything is placed in % of the open book, so it scales with it.

import { useId } from 'react'
import type { InsideStyle } from '@/lib/badges'

export interface BindingSlider { key: string; label: string; min: number; max: number; step: number; def: number }
export interface BindingDef {
  id: string
  name: string
  colors: Array<[label: string, def: string]> // up to three: bindingColor, bindingColor2, bindingColor3
  sliders: BindingSlider[]
}
const s = (key: string, label: string, min: number, max: number, step: number, def: number): BindingSlider => ({ key, label, min, max, step, def })

export const BINDINGS: BindingDef[] = [
  { id: 'classic', name: 'Silver rings', colors: [['Metal', '#c9ced3']],
    sliders: [s('count', 'Rings', 2, 10, 1, 6), s('size', 'Ring size', 0.6, 1.8, 0.05, 1), s('plate', 'Plate', 0, 1, 1, 1)] },
  { id: 'drings', name: 'Brass D-rings', colors: [['Brass', '#c9a253'], ['Plate', '#5b4630']],
    sliders: [s('count', 'Rings', 2, 8, 1, 4), s('thick', 'Thickness', 0.5, 2, 0.05, 1), s('size', 'Ring size', 0.6, 1.6, 0.05, 1), s('screws', 'Screws', 0, 1, 1, 1)] },
  { id: 'spiral', name: 'Spiral coil', colors: [['Wire', '#d0d4da']],
    sliders: [s('loops', 'Loops', 10, 50, 1, 26), s('wire', 'Wire', 0.5, 2.2, 0.05, 1), s('tilt', 'Tilt', -30, 30, 1, -12), s('size', 'Coil width', 0.6, 1.6, 0.05, 1)] },
  { id: 'laced', name: 'Leather lacing', colors: [['Lace', '#e3cfa6'], ['Leather', '#5a3a22'], ['Grommets', '#c9a253']],
    sliders: [s('cross', 'Crosses', 3, 18, 1, 9), s('lace', 'Lace', 0.5, 3, 0.05, 1.4), s('width', 'Strip width', 0.6, 1.8, 0.05, 1)] },
  { id: 'chain', name: 'Chain links', colors: [['Metal', '#c9ced3']],
    sliders: [s('links', 'Links', 6, 30, 1, 15), s('thick', 'Thickness', 0.5, 2, 0.05, 1), s('size', 'Link width', 0.6, 1.6, 0.05, 1)] },
  { id: 'ribbon', name: 'Ribbon & clasps', colors: [['Ribbon', '#8a2b2b'], ['Clasps', '#d6b168']],
    sliders: [s('width', 'Ribbon width', 0.4, 2.2, 0.05, 1), s('tail', 'Bookmark tail', 0, 1, 0.05, 0.6), s('clasps', 'Clasps', 0, 6, 1, 3)] },
  { id: 'jewelled', name: 'Jewelled hinge', colors: [['Gold', '#d6b168'], ['Gems', '#4fa3d9']],
    sliders: [s('gems', 'Gems', 2, 9, 1, 5), s('gem', 'Gem size', 0.5, 1.6, 0.05, 1), s('knuckles', 'Hinge knuckles', 0, 1, 1, 1)] },
]

export const bindingOf = (id?: string) => BINDINGS.find((b) => b.id === id)
export function bindingParams(def: BindingDef, st?: InsideStyle): Record<string, number> {
  const saved = st?.bindingParams?.[def.id] ?? {}
  return Object.fromEntries(def.sliders.map((x) => [x.key, Math.min(x.max, Math.max(x.min, saved[x.key] ?? x.def))]))
}
export function bindingColors(def: BindingDef, st?: InsideStyle): string[] {
  const picked = [st?.bindingColor, st?.bindingColor2, st?.bindingColor3]
  return def.colors.map(([, d], i) => picked[i] ?? d)
}

// Colour maths for metal shading (any colour the creator picks)
function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0').slice(0, 6)
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16) || 0) as [number, number, number]
}
function mix(hex: string, to: string, t: number) {
  const a = rgb(hex), b = rgb(to)
  return '#' + a.map((v, i) => Math.round(v * (1 - t) + b[i] * t).toString(16).padStart(2, '0')).join('')
}
const metal = (c: string, dir = '180deg') =>
  `linear-gradient(${dir}, ${mix(c, '#ffffff', 0.75)} 0%, ${mix(c, '#ffffff', 0.25)} 28%, ${mix(c, '#000000', 0.45)} 55%, ${mix(c, '#ffffff', 0.45)} 78%, ${mix(c, '#000000', 0.25)} 100%)`
const spread = (n: number, a = 10, b = 90) => Array.from({ length: n }, (_, i) => (n === 1 ? (a + b) / 2 : a + ((b - a) * i) / (n - 1)))

/** The book's binding, laid over the open book (the nearest `relative` box = the two pages).
 *  `st` unset or no `binding` = TCG Haven's silver rings, exactly as before; 'none' = just the gutter. */
export function BookBinding({ st }: { st?: InsideStyle }) {
  const uid = 'bind' + useId().replace(/:/g, '')
  const def = bindingOf(st?.binding ?? 'classic')
  const spine = <div className="pinbook-spine absolute inset-y-0 left-1/2 -translate-x-1/2 w-[3%] pointer-events-none" />
  if (st?.binding === 'none' || !def) return spine
  const p = bindingParams(def, st)
  const [c1, c2, c3] = bindingColors(def, st)
  const center = 'absolute left-1/2 -translate-x-1/2 pointer-events-none'
  const atY = (y: number) => ({ top: `${y}%`, transform: 'translate(-50%, -50%)' })

  // TCG Haven's own books (no choice made): the original rings, untouched
  if (!st?.binding) {
    return (
      <>
        {spine}
        <div className={`pinbook-plate ${center} top-[5%] bottom-[5%] w-[2.1%] rounded-[3px]`}>
          {[2.5, 97.5].map((t) => <span key={t} className="pinbook-rivet absolute left-1/2 -translate-x-1/2 -translate-y-1/2 w-[46%] aspect-square rounded-full" style={{ top: `${t}%` }} />)}
        </div>
        {[10, 24, 38, 62, 76, 90].map((top) => (
          <div key={top} className={`pinbook-ring ${center} w-[5.5%] h-[2.6%] rounded-full`} style={{ top: `${top}%` }} />
        ))}
      </>
    )
  }

  switch (def.id) {
    case 'classic': return (
      <>
        {spine}
        {p.plate > 0 && (
          <div className={`${center} top-[5%] bottom-[5%] w-[2.1%] rounded-[3px] z-20`} style={{ background: metal(c1, '90deg'), boxShadow: '0 0 0 1px rgba(0,0,0,0.5), 0 2px 6px rgba(0,0,0,0.6)' }}>
            {[2.5, 97.5].map((t) => <span key={t} className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 w-[46%] aspect-square rounded-full" style={{ top: `${t}%`, background: `radial-gradient(circle at 35% 30%, #fff, ${c1} 60%, ${mix(c1, '#000000', 0.6)})` }} />)}
          </div>
        )}
        {spread(p.count).map((y) => (
          <div key={y} className={`${center} rounded-full z-[21]`} style={{ top: `${y}%`, width: `${5.5 * p.size}%`, height: `${2.6 * p.size}%`, background: metal(c1), boxShadow: '0 2px 3px rgba(0,0,0,0.7), inset 0 0 0 1px rgba(0,0,0,0.25)', transform: 'translate(-50%, -50%)' }} />
        ))}
      </>
    )
    case 'drings': return (
      <>
        {spine}
        <div className={`${center} top-[4%] bottom-[4%] w-[3.2%] rounded-[4px] z-20`} style={{ background: `linear-gradient(90deg, ${mix(c2, '#000000', 0.5)}, ${c2} 30%, ${mix(c2, '#ffffff', 0.15)} 50%, ${c2} 70%, ${mix(c2, '#000000', 0.5)})`, boxShadow: '0 0 0 1px rgba(0,0,0,0.55), 0 3px 8px rgba(0,0,0,0.6)' }} />
        {spread(p.count, 12, 88).map((y) => (
          <div key={y} className={`${center} z-[21]`} style={{ ...atY(y), width: `${6.6 * p.size}%`, aspectRatio: '2' }}>
            <svg viewBox="0 0 100 50" className="w-full h-full overflow-visible drop-shadow-[0_2px_2px_rgba(0,0,0,0.7)]" aria-hidden>
              <defs><linearGradient id={`${uid}d`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={mix(c1, '#ffffff', 0.7)} /><stop offset="0.35" stopColor={c1} /><stop offset="0.6" stopColor={mix(c1, '#000000', 0.45)} /><stop offset="1" stopColor={mix(c1, '#ffffff', 0.3)} />
              </linearGradient></defs>
              <path d="M22 9 H62 A16 16 0 0 1 62 41 H22 Z" fill="none" stroke={`url(#${uid}d)`} strokeWidth={6 * p.thick} strokeLinejoin="round" />
              {p.screws > 0 && [[50, 4], [50, 46]].map(([x, yy]) => (
                <g key={yy}><circle cx={x} cy={yy} r="3.4" fill={mix(c1, '#ffffff', 0.3)} stroke={mix(c1, '#000000', 0.5)} strokeWidth="0.8" /><path d={`M${x - 2.2} ${yy} H${x + 2.2}`} stroke={mix(c1, '#000000', 0.6)} strokeWidth="0.9" /></g>
              ))}
            </svg>
          </div>
        ))}
      </>
    )
    case 'spiral': return (
      <>
        {spine}
        {spread(p.loops, 3, 97).map((y) => (
          <div key={y} className={`${center} z-[21]`} style={{ ...atY(y), width: `${8.5 * p.size}%`, aspectRatio: '100 / 22' }}>
            <svg viewBox="0 0 100 22" className="w-full h-full overflow-visible" aria-hidden>
              {/* the punched holes in the pages, then the coil's back (shadowed) and front (lit) */}
              <circle cx="9" cy="11" r="3.2" fill="#000" opacity="0.65" /><circle cx="91" cy="11" r="3.2" fill="#000" opacity="0.65" />
              <g transform={`rotate(${p.tilt} 50 11)`} fill="none" strokeLinecap="round">
                <path d="M7 11 A43 7 0 0 1 93 11" stroke={mix(c1, '#000000', 0.55)} strokeWidth={3.4 * p.wire} />
                <path d="M7 11 A43 7 0 0 0 93 11" stroke={c1} strokeWidth={3.6 * p.wire} />
                <path d="M14 14 A40 5 0 0 0 86 14" stroke="#fff" strokeOpacity="0.55" strokeWidth={1 * p.wire} />
              </g>
            </svg>
          </div>
        ))}
      </>
    )
    case 'laced': {
      const n = Math.round(p.cross), ys = spread(n + 1, 5, 95)
      return (
        <>
          <div className={`${center} inset-y-[2%] z-20 rounded-[6px]`} style={{ width: `${6 * p.width}%`, background: `linear-gradient(90deg, ${mix(c2, '#000000', 0.55)}, ${c2} 25%, ${mix(c2, '#ffffff', 0.12)} 50%, ${c2} 75%, ${mix(c2, '#000000', 0.55)})`, boxShadow: '0 0 0 1px rgba(0,0,0,0.5), 0 4px 10px rgba(0,0,0,0.55)' }}>
            {/* stitched edges */}
            <div className="absolute inset-y-[1%] left-[6%] right-[6%] border-x border-dashed" style={{ borderColor: mix(c1, '#000000', 0.15) + 'aa' }} />
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full" aria-hidden>
              {Array.from({ length: n }, (_, i) => (
                <g key={i} stroke={c1} strokeWidth={2.2 * p.lace} vectorEffect="non-scaling-stroke" strokeLinecap="round">
                  <path d={`M26 ${ys[i]} L74 ${ys[i + 1]}`} vectorEffect="non-scaling-stroke" stroke={mix(c1, '#000000', 0.35)} />
                  <path d={`M74 ${ys[i]} L26 ${ys[i + 1]}`} vectorEffect="non-scaling-stroke" />
                </g>
              ))}
            </svg>
            {ys.flatMap((y) => [26, 74].map((x) => (
              <span key={`${y}-${x}`} className="absolute w-[22%] aspect-square rounded-full -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${x}%`, top: `${y}%`, background: `radial-gradient(circle, #000 0 32%, ${mix(c3, '#ffffff', 0.4)} 38%, ${c3} 60%, ${mix(c3, '#000000', 0.5)} 100%)` }} />
            )))}
          </div>
        </>
      )
    }
    case 'chain': {
      const n = Math.round(p.links), ys = spread(n, 4, 96), h = (92 / Math.max(1, n - 1)) * 1.6
      return (
        <>
          {spine}
          {ys.map((y, i) => (
            <div key={y} className={`${center} z-[21]`} style={{ ...atY(y), height: `${h}%`, aspectRatio: `${40 * p.size} / 64` }}>
              <svg viewBox={`0 0 ${40 * p.size} 64`} className="w-full h-full overflow-visible drop-shadow-[0_2px_2px_rgba(0,0,0,0.75)]" aria-hidden>
                <defs><linearGradient id={`${uid}c${i % 2}`} x1="0" x2="1">
                  <stop offset="0" stopColor={mix(c1, '#000000', 0.4)} /><stop offset="0.35" stopColor={mix(c1, '#ffffff', 0.6)} /><stop offset="0.7" stopColor={c1} /><stop offset="1" stopColor={mix(c1, '#000000', 0.5)} />
                </linearGradient></defs>
                {i % 2 === 0
                  ? <rect x={6 * p.size} y="5" width={28 * p.size} height="54" rx={14 * p.size} fill="none" stroke={`url(#${uid}c0)`} strokeWidth={6 * p.thick} />
                  : <rect x={20 * p.size - 3.2 * p.thick} y="2" width={6.4 * p.thick} height="60" rx={3.2 * p.thick} fill={`url(#${uid}c1)`} />}
              </svg>
            </div>
          ))}
        </>
      )
    }
    case 'ribbon': {
      const w = 2.4 * p.width
      return (
        <>
          {spine}
          <div className={`${center} top-0 bottom-0 z-20`} style={{ width: `${w}%`, background: `linear-gradient(90deg, ${mix(c1, '#000000', 0.45)}, ${c1} 22%, ${mix(c1, '#ffffff', 0.3)} 45%, ${c1} 65%, ${mix(c1, '#000000', 0.5)})`, boxShadow: '0 0 6px rgba(0,0,0,0.5)' }} />
          {p.tail > 0 && (
            <div className={`${center} z-20`} style={{ top: '99%', width: `${w}%`, height: `${p.tail * 9}%`, background: `linear-gradient(90deg, ${mix(c1, '#000000', 0.45)}, ${c1} 22%, ${mix(c1, '#ffffff', 0.3)} 45%, ${c1} 65%, ${mix(c1, '#000000', 0.5)})`, clipPath: 'polygon(0 0, 100% 0, 100% 100%, 50% 78%, 0 100%)', filter: 'drop-shadow(0 3px 3px rgba(0,0,0,0.5))' }} />
          )}
          {spread(Math.round(p.clasps), 18, 82).map((y) => (
            <div key={y} className={`${center} z-[21]`} style={{ ...atY(y), width: `${Math.max(4.5, w * 1.9)}%`, aspectRatio: '2.4' }}>
              <svg viewBox="0 0 60 25" className="w-full h-full overflow-visible drop-shadow-[0_2px_2px_rgba(0,0,0,0.7)]" aria-hidden>
                <defs><linearGradient id={`${uid}k`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor={mix(c2, '#ffffff', 0.65)} /><stop offset="0.45" stopColor={c2} /><stop offset="1" stopColor={mix(c2, '#000000', 0.45)} />
                </linearGradient></defs>
                <rect x="3" y="5" width="54" height="15" rx="4" fill={`url(#${uid}k)`} stroke={mix(c2, '#000000', 0.5)} strokeWidth="0.8" />
                <rect x="9" y="9" width="42" height="7" rx="2" fill="none" stroke={mix(c2, '#000000', 0.35)} strokeWidth="0.7" />
                <circle cx="30" cy="12.5" r="5" fill={`url(#${uid}k)`} stroke={mix(c2, '#000000', 0.5)} strokeWidth="0.8" />
                <circle cx="28.5" cy="11" r="1.6" fill="#fff" opacity="0.7" />
              </svg>
            </div>
          ))}
        </>
      )
    }
    case 'jewelled': {
      const ys = spread(Math.round(p.gems), 12, 88)
      return (
        <>
          {spine}
          <div className={`${center} top-[3%] bottom-[3%] w-[2.6%] rounded-full z-20`} style={{ background: `repeating-linear-gradient(180deg, transparent 0 6px, rgba(0,0,0,0.12) 6px 7px), ${metal(c1, '90deg')}`, boxShadow: '0 0 0 1px rgba(0,0,0,0.5), 0 3px 8px rgba(0,0,0,0.6)' }} />
          {p.knuckles > 0 && ys.slice(0, -1).map((y, i) => (
            <div key={y} className={`${center} z-20 h-[0.5%] w-[3.2%] rounded-full`} style={{ top: `${(y + ys[i + 1]) / 2}%`, background: mix(c1, '#000000', 0.55), transform: 'translate(-50%, -50%)' }} />
          ))}
          {ys.map((y) => (
            <div key={y} className={`${center} z-[21]`} style={{ ...atY(y), width: `${4.4 * p.gem}%`, aspectRatio: '1' }}>
              <svg viewBox="0 0 40 40" className="w-full h-full overflow-visible drop-shadow-[0_2px_3px_rgba(0,0,0,0.7)]" aria-hidden>
                <defs>
                  <radialGradient id={`${uid}g`} cx="0.35" cy="0.3" r="0.8">
                    <stop offset="0" stopColor={mix(c2, '#ffffff', 0.75)} /><stop offset="0.45" stopColor={c2} /><stop offset="1" stopColor={mix(c2, '#000000', 0.6)} />
                  </radialGradient>
                  <linearGradient id={`${uid}s`} x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stopColor={mix(c1, '#ffffff', 0.6)} /><stop offset="0.5" stopColor={c1} /><stop offset="1" stopColor={mix(c1, '#000000', 0.45)} />
                  </linearGradient>
                </defs>
                {/* the setting: a ring with four prongs */}
                <circle cx="20" cy="20" r="17" fill={`url(#${uid}s)`} />
                {[0, 90, 180, 270].map((a) => <circle key={a} cx="20" cy="4" r="2.6" fill={`url(#${uid}s)`} transform={`rotate(${a + 45} 20 20)`} />)}
                <polygon points="20,6 30,10 34,20 30,30 20,34 10,30 6,20 10,10" fill={`url(#${uid}g)`} stroke={mix(c2, '#000000', 0.5)} strokeWidth="0.6" />
                <polygon points="20,12 26,15 28,20 26,25 20,28 14,25 12,20 14,15" fill="none" stroke="#fff" strokeOpacity="0.35" strokeWidth="0.6" />
                <path d="M20 6 L20 12 M34 20 L28 20 M20 34 L20 28 M6 20 L12 20 M10 10 L14 15 M30 10 L26 15 M30 30 L26 25 M10 30 L14 25" stroke="#fff" strokeOpacity="0.25" strokeWidth="0.5" />
                <circle cx="15" cy="13" r="2" fill="#fff" opacity="0.8" />
              </svg>
            </div>
          ))}
        </>
      )
    }
  }
  return spine
}
