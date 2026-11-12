'use client'

// What holds a book's pages together down the middle (the pin book — BadgeBook — the Studio's pages
// and "Preview as a fan"). TCG Haven's books keep their silver rings (unset `binding`); a creator
// picks one of these in Inside look → Center rings, each with its own colours and sliders
// (InsideStyle.binding*), or None.
//
// Drawn as one SVG measured to the open book in pixels (so rings stay round at any size), with real
// materials: banded chrome shading, a specular bevel lit from the top left, soft shadows cast on the
// pages, punched holes with depth, grained leather, woven silk and faceted gems.

import { useEffect, useId, useRef, useState } from 'react'
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
  { id: 'drings', name: 'Brass D-rings', colors: [['Brass', '#c9a253'], ['Plate', '#6b5434']],
    sliders: [s('count', 'Rings', 2, 8, 1, 4), s('thick', 'Thickness', 0.5, 2, 0.05, 1), s('size', 'Ring size', 0.6, 1.6, 0.05, 1), s('screws', 'Screws', 0, 1, 1, 1)] },
  { id: 'spiral', name: 'Spiral coil', colors: [['Wire', '#c9ced3']],
    sliders: [s('loops', 'Loops', 10, 50, 1, 24), s('wire', 'Wire', 0.5, 2.2, 0.05, 1), s('tilt', 'Tilt', -30, 30, 1, -10), s('size', 'Coil width', 0.6, 1.6, 0.05, 1)] },
  { id: 'laced', name: 'Leather lacing', colors: [['Lace', '#d9bf8f'], ['Leather', '#5a3a22'], ['Grommets', '#c9a253']],
    sliders: [s('cross', 'Crosses', 3, 18, 1, 8), s('lace', 'Lace', 0.5, 3, 0.05, 1.2), s('width', 'Strip width', 0.6, 1.8, 0.05, 1)] },
  { id: 'chain', name: 'Chain links', colors: [['Metal', '#c9ced3']],
    sliders: [s('links', 'Links', 6, 30, 1, 13), s('thick', 'Thickness', 0.5, 2, 0.05, 1), s('size', 'Link width', 0.6, 1.6, 0.05, 1)] },
  { id: 'ribbon', name: 'Ribbon & clasps', colors: [['Ribbon', '#7d2424'], ['Clasps', '#c9a253']],
    sliders: [s('width', 'Ribbon width', 0.4, 2.2, 0.05, 1), s('tail', 'Notched end', 0, 1, 0.05, 0.6), s('clasps', 'Clasps', 0, 6, 1, 3)] },
  { id: 'jewelled', name: 'Jewelled hinge', colors: [['Gold', '#d4ad5c'], ['Gems', '#2f7fc1']],
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

// ── Colour maths (any colour the creator picks gets real shading) ──
function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0').slice(0, 6)
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16) || 0) as [number, number, number]
}
function mix(hex: string, to: string, t: number) {
  const a = rgb(hex), b = rgb(to)
  return '#' + a.map((v, i) => Math.round(v * (1 - t) + b[i] * t).toString(16).padStart(2, '0')).join('')
}
const W_ = '#ffffff', K_ = '#000000'
const spread = (n: number, a: number, b: number) => Array.from({ length: n }, (_, i) => (n === 1 ? (a + b) / 2 : a + ((b - a) * i) / (n - 1)))
const r2 = (v: number) => Math.round(v * 100) / 100

/** Banded chrome, like polished metal reflecting a room: across a bar (`across` = 'x') or a tube lying sideways ('y') */
function Chrome({ id, c, across }: { id: string; c: string; across: 'x' | 'y' }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2={across === 'x' ? 1 : 0} y2={across === 'y' ? 1 : 0}>
      <stop offset="0" stopColor={mix(c, K_, 0.62)} />
      <stop offset="0.14" stopColor={mix(c, K_, 0.12)} />
      <stop offset="0.3" stopColor={mix(c, W_, 0.85)} />
      <stop offset="0.42" stopColor={mix(c, W_, 0.3)} />
      <stop offset="0.66" stopColor={mix(c, K_, 0.38)} />
      <stop offset="0.86" stopColor={mix(c, W_, 0.22)} />
      <stop offset="1" stopColor={mix(c, K_, 0.65)} />
    </linearGradient>
  )
}

/** A round wire following a path: dark rim, body, a lit band and a sharp specular line (light from above) */
function Tube({ d, c, w, dim = 0 }: { d: string; c: string; w: number; dim?: number }) {
  const base = dim ? mix(c, K_, dim) : c
  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} stroke={mix(base, K_, 0.68)} strokeWidth={w} />
      <path d={d} stroke={mix(base, K_, 0.22)} strokeWidth={w * 0.74} />
      <path d={d} stroke={base} strokeWidth={w * 0.46} transform={`translate(0 ${r2(-w * 0.1)})`} />
      <path d={d} stroke={mix(base, W_, 0.88)} strokeWidth={w * 0.15} transform={`translate(0 ${r2(-w * 0.2)})`} opacity={dim ? 0.35 : 0.95} />
    </g>
  )
}

function useBox<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [box, setBox] = useState<{ w: number; h: number } | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const fit = () => setBox({ w: el.clientWidth, h: el.clientHeight })
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    fit()
    return () => ro.disconnect()
  }, [])
  return { ref, box }
}

/** The book's binding, laid over the open book (the nearest `relative` box = the two pages).
 *  `st` unset or no `binding` = TCG Haven's silver rings, exactly as before; 'none' = just the gutter. */
export function BookBinding({ st, size }: { st?: InsideStyle; size?: { w: number; h: number } /* a fixed size instead of measuring (renders without a browser) */ }) {
  const def = bindingOf(st?.binding ?? 'classic')
  const spine = <div className="pinbook-spine absolute inset-y-0 left-1/2 -translate-x-1/2 w-[3%] pointer-events-none" />
  if (st?.binding === 'none' || !def) return spine
  // TCG Haven's own books (no choice made): the original rings, untouched
  if (!st?.binding) {
    const center = 'absolute left-1/2 -translate-x-1/2 pointer-events-none'
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
  return <>{spine}<Drawn def={def} st={st} size={size} /></>
}

function Drawn({ def, st, size }: { def: BindingDef; st: InsideStyle; size?: { w: number; h: number } }) {
  const id = 'bd' + useId().replace(/:/g, '')
  const measured = useBox<HTMLDivElement>()
  const ref = measured.ref, box = size ?? measured.box
  const p = bindingParams(def, st)
  const [c1, c2 = c1, c3 = c1] = bindingColors(def, st) // one-colour bindings reuse it for the other parts
  let body: React.ReactNode = null
  if (box && box.w > 0 && box.h > 0) {
    const { w: W, h: H } = box
    const u = Math.min(H, W * 0.75) / 100 // one "unit": 1% of the book's height (kept sane on very wide boxes)
    const cx = W / 2
    const sh = `url(#${id}sh)`, mt = `url(#${id}mt)`
    const art = (() => {
      switch (def.id) {
        case 'classic': {
          const L = 6.6 * u * p.size, t = 1.8 * u * p.size, pw = 2.4 * u
          return (
            <>
              {p.plate > 0 && (
                <g filter={mt}>
                  <rect x={cx - pw / 2} y={H * 0.05} width={pw} height={H * 0.9} rx={pw * 0.3} fill={`url(#${id}cx)`} />
                  {[H * 0.07, H * 0.93].map((y) => <circle key={y} cx={cx} cy={y} r={pw * 0.32} fill={`url(#${id}rv)`} />)}
                </g>
              )}
              {spread(p.count, H * 0.1, H * 0.9).map((y) => (
                <g key={y}>
                  {/* the holes in the pages the ring goes through */}
                  {[-1, 1].map((k) => <ellipse key={k} cx={cx + k * (L / 2 - t * 0.25)} cy={y} rx={t * 0.5} ry={t * 0.68} fill="#070504" opacity="0.85" />)}
                  <g filter={mt}>
                    <rect x={cx - L / 2 + t * 0.15} y={y - t / 2} width={L - t * 0.3} height={t} rx={t / 2} fill={`url(#${id}cy)`} />
                  </g>
                  {/* the ring curving down into the holes */}
                  <rect x={cx - L / 2 + t * 0.15} y={y - t / 2} width={L - t * 0.3} height={t} rx={t / 2} fill={`url(#${id}end)`} />
                </g>
              ))}
            </>
          )
        }
        case 'drings': {
          const pw = 4.4 * u, r = 2.3 * u * p.size, tw = 1.05 * u * p.thick
          return (
            <>
              <g filter={mt}>
                <rect x={cx - pw / 2} y={H * 0.035} width={pw} height={H * 0.93} rx={u * 0.9} fill={`url(#${id}px)`} />
                <rect x={cx - pw / 2} y={H * 0.035} width={pw} height={H * 0.93} rx={u * 0.9} fill={`url(#${id}brush)`} opacity="0.5" />
              </g>
              {spread(p.count, H * 0.12, H * 0.88).map((y) => {
                const x0 = cx - 3.2 * u * p.size, x1 = cx + 1.4 * u * p.size
                return (
                  <g key={y}>
                    {p.screws > 0 && [-1, 1].map((k) => (
                      <g key={k} filter={mt}>
                        <circle cx={cx} cy={y + k * (r + 1.5 * u)} r={u * 0.75} fill={`url(#${id}rv2)`} />
                        <path d={`M${cx - u * 0.5} ${y + k * (r + 1.5 * u)} h${u}`} stroke={mix(c1, K_, 0.7)} strokeWidth={u * 0.18} transform={`rotate(${k * 35} ${cx} ${y + k * (r + 1.5 * u)})`} />
                      </g>
                    ))}
                    <g filter={sh}><Tube d={`M${x0} ${y - r} H${x1} A${r} ${r} 0 0 1 ${x1} ${y + r} H${x0} Z`} c={c1} w={tw} /></g>
                    {/* the clamp holding it to the plate */}
                    <g filter={mt}><rect x={cx - pw * 0.42} y={y - r - tw * 0.9} width={pw * 0.84} height={tw * 1.8} rx={tw * 0.4} fill={`url(#${id}cy2)`} /></g>
                  </g>
                )
              })}
            </>
          )
        }
        case 'spiral': {
          const rx = 3.7 * u * p.size, ry = 1.05 * u * p.size, tw = 0.62 * u * p.wire
          return spread(p.loops, H * 0.03, H * 0.97).map((y) => (
            <g key={y}>
              {/* punched holes, with a lit lower lip */}
              {[-1, 1].map((k) => (
                <g key={k}>
                  <rect x={cx + k * rx * 0.86 - u * 0.5} y={y - u * 0.62} width={u} height={u * 1.24} rx={u * 0.42} fill="#060403" />
                  <path d={`M${cx + k * rx * 0.86 - u * 0.36} ${y + u * 0.62} h${u * 0.72}`} stroke="#fff" strokeOpacity="0.12" strokeWidth={u * 0.12} />
                </g>
              ))}
              <g transform={`rotate(${p.tilt} ${cx} ${y})`}>
                {/* the back of the loop, behind the pages */}
                <Tube d={`M${cx - rx} ${y} A${rx} ${ry} 0 0 1 ${cx + rx} ${y}`} c={c1} w={tw * 0.8} dim={0.55} />
                <g filter={sh}><Tube d={`M${cx - rx} ${y} A${rx} ${ry} 0 0 0 ${cx + rx} ${y}`} c={c1} w={tw} /></g>
              </g>
            </g>
          ))
        }
        case 'laced': {
          const sw = 6.4 * u * p.width, n = Math.round(p.cross), ys = spread(n + 1, H * 0.05, H * 0.95)
          const gx = [cx - sw * 0.27, cx + sw * 0.27], lw = 0.7 * u * p.lace
          return (
            <>
              <g filter={`url(#${id}lea)`}>
                <rect x={cx - sw / 2} y={H * 0.02} width={sw} height={H * 0.96} rx={u} fill={c2} />
              </g>
              {/* saddle stitching down both edges */}
              {[-1, 1].map((k) => (
                <g key={k}>
                  <path d={`M${cx + k * (sw / 2 - u * 0.75)} ${H * 0.03} V${H * 0.97}`} stroke="#000" strokeOpacity="0.45" strokeWidth={u * 0.28} strokeDasharray={`${u * 0.9} ${u * 0.55}`} transform={`translate(${u * 0.08} ${u * 0.1})`} />
                  <path d={`M${cx + k * (sw / 2 - u * 0.75)} ${H * 0.03} V${H * 0.97}`} stroke={mix(c1, W_, 0.1)} strokeWidth={u * 0.24} strokeDasharray={`${u * 0.9} ${u * 0.55}`} />
                </g>
              ))}
              {/* grommets */}
              {ys.flatMap((y) => gx.map((x) => (
                <g key={`${x}-${y}`}>
                  <g filter={mt}><circle cx={x} cy={y} r={u * 0.95} fill={`url(#${id}gm)`} /></g>
                  <circle cx={x} cy={y} r={u * 0.46} fill="#0a0705" />
                </g>
              )))}
              {/* the laces: the under-pass first, then the over-pass */}
              <g filter={sh}>
                {Array.from({ length: n }, (_, i) => <Tube key={'u' + i} d={`M${gx[1]} ${ys[i]} L${gx[0]} ${ys[i + 1]}`} c={c1} w={lw} dim={0.25} />)}
                {Array.from({ length: n }, (_, i) => <Tube key={'o' + i} d={`M${gx[0]} ${ys[i]} L${gx[1]} ${ys[i + 1]}`} c={c1} w={lw} />)}
              </g>
            </>
          )
        }
        case 'chain': {
          const n = Math.round(p.links), ys = spread(n, H * 0.04, H * 0.96), step = (H * 0.92) / Math.max(1, n - 1)
          const len = step * 1.62, lw = 2.5 * u * p.size, tw = 0.7 * u * p.thick
          return (
            <g filter={sh}>
              {/* side-on links behind, face-on links in front */}
              {ys.map((y, i) => i % 2 === 1 && (
                <g key={y} filter={mt}><rect x={cx - tw * 0.65} y={y - len / 2} width={tw * 1.3} height={len} rx={tw * 0.65} fill={`url(#${id}cx)`} /></g>
              ))}
              {ys.map((y, i) => i % 2 === 0 && (
                <Tube key={y} c={c1} w={tw} d={`M${cx - lw / 2 + lw / 2} ${y - len / 2} a${lw / 2} ${lw / 2} 0 0 1 ${lw / 2} ${lw / 2} V${y + len / 2 - lw / 2} a${lw / 2} ${lw / 2} 0 0 1 ${-lw} 0 V${y - len / 2 + lw / 2} a${lw / 2} ${lw / 2} 0 0 1 ${lw / 2} ${-lw / 2} Z`} />
              ))}
            </g>
          )
        }
        case 'ribbon': {
          const rw = 2.8 * u * p.width, notch = p.tail * 5 * u
          return (
            <>
              <g filter={sh}>
                <path d={`M${cx - rw / 2} 0 H${cx + rw / 2} V${H} L${cx} ${H - notch} L${cx - rw / 2} ${H} Z`} fill={`url(#${id}silk)`} />
                <path d={`M${cx - rw / 2} 0 H${cx + rw / 2} V${H} L${cx} ${H - notch} L${cx - rw / 2} ${H} Z`} fill={`url(#${id}weave)`} />
              </g>
              {spread(Math.round(p.clasps), H * 0.18, H * 0.82).map((y) => {
                const cw = Math.max(5.5 * u, rw * 2.2), chh = 2.3 * u
                return (
                  <g key={y} filter={mt}>
                    <rect x={cx - cw / 2} y={y - chh / 2} width={cw} height={chh} rx={u * 0.5} fill={`url(#${id}cy2)`} />
                    <rect x={cx - cw / 2 + u * 0.55} y={y - chh / 2 + u * 0.5} width={cw - u * 1.1} height={chh - u} rx={u * 0.25} fill="none" stroke={mix(c2, K_, 0.55)} strokeWidth={u * 0.12} />
                    {[-1, 1].map((k) => <circle key={k} cx={cx + k * (cw / 2 - u * 0.75)} cy={y} r={u * 0.28} fill={mix(c2, K_, 0.4)} />)}
                    <circle cx={cx} cy={y} r={u * 1.15} fill={`url(#${id}rv2)`} />
                  </g>
                )
              })}
            </>
          )
        }
        case 'jewelled': {
          const ys = spread(Math.round(p.gems), H * 0.12, H * 0.88), bw = 3 * u, g = p.gem
          const cuts = p.knuckles > 0 ? [H * 0.03, ...ys.slice(0, -1).map((y, i) => (y + ys[i + 1]) / 2), H * 0.97] : [H * 0.03, H * 0.97]
          return (
            <>
              <g filter={mt}>
                {cuts.slice(0, -1).map((y0, i) => {
                  const y1 = cuts[i + 1], gap = p.knuckles > 0 ? u * 0.35 : 0
                  return <rect key={y0} x={cx - bw / 2} y={y0 + (i ? gap : 0)} width={bw} height={y1 - y0 - (i ? gap : 0) - (i < cuts.length - 2 ? gap : 0)} rx={bw / 2} fill={`url(#${id}cx)`} />
                })}
              </g>
              {ys.map((y) => {
                const R = 2.3 * u * g, gr = 1.7 * u * g
                const oct = Array.from({ length: 8 }, (_, k) => [cx + gr * Math.cos((k * Math.PI) / 4 + Math.PI / 8), y + gr * Math.sin((k * Math.PI) / 4 + Math.PI / 8)])
                const tab = oct.map(([x, yy]) => [cx + (x - cx) * 0.5, y + (yy - y) * 0.5])
                return (
                  <g key={y}>
                    <g filter={mt}>
                      <circle cx={cx} cy={y} r={R} fill={`url(#${id}cx)`} />
                      {[45, 135, 225, 315].map((a) => <circle key={a} cx={cx + R * 0.86 * Math.cos((a * Math.PI) / 180)} cy={y + R * 0.86 * Math.sin((a * Math.PI) / 180)} r={u * 0.5 * g} fill={`url(#${id}rv)`} />)}
                    </g>
                    {/* a brilliant cut: eight crown facets catching the light differently, the table, glints */}
                    {oct.map(([x, yy], k) => {
                      const [x2, y2] = oct[(k + 1) % 8], [tx, ty] = tab[k], [tx2, ty2] = tab[(k + 1) % 8]
                      const lit = Math.cos(((k + 0.5) * Math.PI) / 4 + Math.PI / 8 + Math.PI * 0.75)
                      return <polygon key={k} points={`${r2(x)},${r2(yy)} ${r2(x2)},${r2(y2)} ${r2(tx2)},${r2(ty2)} ${r2(tx)},${r2(ty)}`} fill={lit > 0 ? mix(c2, W_, lit * 0.55) : mix(c2, K_, -lit * 0.55)} />
                    })}
                    <polygon points={tab.map(([x, yy]) => `${r2(x)},${r2(yy)}`).join(' ')} fill={`url(#${id}gem)`} />
                    <polygon points={oct.map(([x, yy]) => `${r2(x)},${r2(yy)}`).join(' ')} fill="none" stroke={mix(c2, K_, 0.6)} strokeWidth={u * 0.08} />
                    <path d={`M${cx - gr * 0.35} ${y - gr * 0.55} l${u * 0.3 * g} ${u * 0.3 * g} M${cx - gr * 0.35 + u * 0.3 * g} ${y - gr * 0.55} l${-u * 0.3 * g} ${u * 0.3 * g}`} stroke="#fff" strokeWidth={u * 0.12} opacity="0.9" />
                    <circle cx={cx - gr * 0.3} cy={y - gr * 0.4} r={u * 0.22 * g} fill="#fff" opacity="0.9" />
                  </g>
                )
              })}
            </>
          )
        }
      }
      return null
    })()
    body = (
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 overflow-visible" aria-hidden>
        <defs>
          {/* a soft shadow cast on the page */}
          <filter id={`${id}sh`} x="-50%" y="-50%" width="200%" height="200%" colorInterpolationFilters="sRGB">
            <feGaussianBlur in="SourceAlpha" stdDeviation={u * 0.55} />
            <feOffset dx={u * 0.3} dy={u * 0.55} result="o" />
            <feFlood floodColor="#000" floodOpacity="0.6" />
            <feComposite in2="o" operator="in" result="shadow" />
            <feMerge><feMergeNode in="shadow" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          {/* metal: a bevel lit from the top left (specular), plus the cast shadow */}
          <filter id={`${id}mt`} x="-50%" y="-50%" width="200%" height="200%" colorInterpolationFilters="sRGB">
            <feGaussianBlur in="SourceAlpha" stdDeviation={Math.max(0.6, u * 0.22)} result="b" />
            <feSpecularLighting in="b" surfaceScale={Math.max(2, u * 0.7)} specularConstant="0.85" specularExponent="24" lightingColor="#fff" result="spec">
              <feDistantLight azimuth="225" elevation="40" />
            </feSpecularLighting>
            <feComposite in="spec" in2="SourceAlpha" operator="in" result="specIn" />
            <feComposite in="SourceGraphic" in2="specIn" operator="arithmetic" k1="0" k2="1" k3="0.7" k4="0" result="lit" />
            <feGaussianBlur in="SourceAlpha" stdDeviation={u * 0.5} />
            <feOffset dx={u * 0.3} dy={u * 0.55} result="o" />
            <feFlood floodColor="#000" floodOpacity="0.6" />
            <feComposite in2="o" operator="in" result="shadow" />
            <feMerge><feMergeNode in="shadow" /><feMergeNode in="lit" /></feMerge>
          </filter>
          {/* leather: grain, a softly raised edge and the shadow */}
          <filter id={`${id}lea`} x="-50%" y="-10%" width="200%" height="120%" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" seed="4" result="n" />
            <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.55 0" result="grain" />
            <feComposite in="grain" in2="SourceAlpha" operator="in" result="grainIn" />
            <feMerge result="tex"><feMergeNode in="SourceGraphic" /><feMergeNode in="grainIn" /></feMerge>
            <feGaussianBlur in="SourceAlpha" stdDeviation={u * 0.5} result="b" />
            <feSpecularLighting in="b" surfaceScale={u * 0.5} specularConstant="0.35" specularExponent="12" lightingColor="#fff" result="spec">
              <feDistantLight azimuth="225" elevation="45" />
            </feSpecularLighting>
            <feComposite in="spec" in2="SourceAlpha" operator="in" result="specIn" />
            <feComposite in="tex" in2="specIn" operator="arithmetic" k1="0" k2="1" k3="0.6" k4="0" result="lit" />
            <feGaussianBlur in="SourceAlpha" stdDeviation={u * 0.7} />
            <feOffset dx={u * 0.3} dy={u * 0.6} result="o" />
            <feFlood floodColor="#000" floodOpacity="0.6" />
            <feComposite in2="o" operator="in" result="shadow" />
            <feMerge><feMergeNode in="shadow" /><feMergeNode in="lit" /></feMerge>
          </filter>
          <Chrome id={`${id}cx`} c={c1} across="x" />
          <Chrome id={`${id}cy`} c={c1} across="y" />
          <Chrome id={`${id}cy2`} c={def.id === 'drings' ? c1 : c2} across="y" />
          <Chrome id={`${id}px`} c={c2} across="x" />
          <linearGradient id={`${id}end`} x1="0" x2="1">
            <stop offset="0" stopColor="#000" stopOpacity="0.75" /><stop offset="0.16" stopColor="#000" stopOpacity="0" />
            <stop offset="0.84" stopColor="#000" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity="0.75" />
          </linearGradient>
          <radialGradient id={`${id}rv`} cx="0.35" cy="0.3" r="0.75">
            <stop offset="0" stopColor={mix(c1, W_, 0.9)} /><stop offset="0.5" stopColor={c1} /><stop offset="1" stopColor={mix(c1, K_, 0.6)} />
          </radialGradient>
          <radialGradient id={`${id}rv2`} cx="0.35" cy="0.3" r="0.75">
            <stop offset="0" stopColor={mix(def.id === 'ribbon' ? c2 : c1, W_, 0.85)} /><stop offset="0.5" stopColor={def.id === 'ribbon' ? c2 : c1} /><stop offset="1" stopColor={mix(def.id === 'ribbon' ? c2 : c1, K_, 0.6)} />
          </radialGradient>
          <radialGradient id={`${id}gm`} cx="0.4" cy="0.35" r="0.7">
            <stop offset="0.4" stopColor={mix(c3 ?? c1, W_, 0.7)} /><stop offset="0.7" stopColor={c3 ?? c1} /><stop offset="1" stopColor={mix(c3 ?? c1, K_, 0.55)} />
          </radialGradient>
          <radialGradient id={`${id}gem`} cx="0.35" cy="0.3" r="0.8">
            <stop offset="0" stopColor={mix(c2 ?? c1, W_, 0.7)} /><stop offset="0.5" stopColor={c2 ?? c1} /><stop offset="1" stopColor={mix(c2 ?? c1, K_, 0.5)} />
          </radialGradient>
          {/* silk: a sheen across, darker at the folded edges */}
          <linearGradient id={`${id}silk`} x1="0" x2="1">
            <stop offset="0" stopColor={mix(c1, K_, 0.6)} /><stop offset="0.12" stopColor={mix(c1, K_, 0.15)} />
            <stop offset="0.34" stopColor={mix(c1, W_, 0.35)} /><stop offset="0.5" stopColor={c1} />
            <stop offset="0.72" stopColor={mix(c1, W_, 0.15)} /><stop offset="0.9" stopColor={mix(c1, K_, 0.25)} /><stop offset="1" stopColor={mix(c1, K_, 0.6)} />
          </linearGradient>
          <pattern id={`${id}weave`} width={Math.max(2, u * 0.35)} height={Math.max(2, u * 0.35)} patternUnits="userSpaceOnUse">
            <rect width={Math.max(1, u * 0.12)} height={Math.max(2, u * 0.35)} fill="#fff" opacity="0.07" />
            <rect width={Math.max(2, u * 0.35)} height={Math.max(0.6, u * 0.06)} fill="#000" opacity="0.12" />
          </pattern>
          <pattern id={`${id}brush`} width="4" height={Math.max(1.5, u * 0.18)} patternUnits="userSpaceOnUse">
            <rect width="4" height={Math.max(0.5, u * 0.06)} fill="#fff" opacity="0.18" />
          </pattern>
        </defs>
        {art}
      </svg>
    )
  }
  return <div ref={ref} className="absolute inset-0 pointer-events-none z-20">{body}</div>
}
