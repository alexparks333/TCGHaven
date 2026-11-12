// A creator book's page patterns (Creator Studio → Pages & badges → Inside look, docs/creators.md).
// Each pattern draws one picture the size of a page (780 × 1000, an SVG), laid over the felt as a
// CSS background layer (insideLook() → `--pattern`, globals.css `.pinbook-styled .pinbook-page`), so
// the felt's colour, grain and the page's gutter shadow all still show. Every pattern has its own
// sliders and up to two colours; all of them have Strength and Fade edges.

export interface PatternSlider { key: string; label: string; min: number; max: number; step: number; def: number }
interface Ctx { p: Record<string, number>; c: string; d: string }
export interface PagePatternDef {
  id: string
  name: string
  color: [label: string, def: string]
  detail?: [label: string, def: string]
  sliders: PatternSlider[]
  draw: (x: Ctx) => string // SVG markup in a 780 × 1000 page
}

const W = 780, H = 1000
const s = (key: string, label: string, min: number, max: number, step: number, def: number): PatternSlider => ({ key, label, min, max, step, def })
const n2 = (v: number) => Math.round(v * 100) / 100
// The same "random" layout every time for one seed
function seeded(seed: number) {
  let a = Math.round(seed * 7919) >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
const fill = (id: string) => `<rect width='${W}' height='${H}' fill='url(#${id})'/>`

export const PAGE_PATTERNS: PagePatternDef[] = [
  {
    id: 'damask', name: 'Damask', color: ['Pattern', '#d6b168'],
    sliders: [s('size', 'Size', 60, 260, 2, 130), s('petal', 'Petals', 0.3, 1, 0.02, 0.7), s('ring', 'Ring', 0, 1, 0.05, 0.6)],
    draw: ({ p, c }) => {
      const z = p.size, r = z * 0.22 * p.petal
      const motif = (x: number, y: number) =>
        [0, 45, 90, 135].map((a) => `<ellipse cx='${x}' cy='${y}' rx='${n2(r * 0.42)}' ry='${n2(r)}' transform='rotate(${a} ${x} ${y})' fill='none' stroke='${c}' stroke-width='${n2(z * 0.012)}'/>`).join('')
        + `<circle cx='${x}' cy='${y}' r='${n2(r * 0.22)}' fill='${c}'/>`
        + (p.ring > 0 ? `<circle cx='${x}' cy='${y}' r='${n2(r * 1.35)}' fill='none' stroke='${c}' stroke-width='${n2(z * 0.008)}' stroke-dasharray='${n2(z * 0.02)} ${n2(z * 0.03)}' opacity='${p.ring}'/>` : '')
      const dia = (x: number, y: number) => `<path d='M${x} ${n2(y - z * 0.06)} L${n2(x + z * 0.04)} ${y} L${x} ${n2(y + z * 0.06)} L${n2(x - z * 0.04)} ${y} Z' fill='${c}'/>`
      return `<defs><pattern id='q' width='${z}' height='${z}' patternUnits='userSpaceOnUse' x='${n2((W % z) / 2)}'>`
        + motif(z / 2, z / 2) + [[0, 0], [z, 0], [0, z], [z, z]].map(([x, y]) => motif(x, y)).join('')
        + dia(z / 2, 0) + dia(0, z / 2) + dia(z, z / 2) + dia(z / 2, z)
        + `</pattern></defs>${fill('q')}`
    },
  },
  {
    id: 'dots', name: 'Polka dots', color: ['Dots', '#d6b168'],
    sliders: [s('size', 'Dot size', 2, 30, 0.5, 7), s('space', 'Spacing', 16, 120, 1, 44), s('stagger', 'Stagger', 0, 1, 1, 1)],
    draw: ({ p, c }) => {
      const sp = p.space, off = p.stagger ? sp / 2 : 0
      return `<defs><pattern id='q' width='${sp}' height='${sp * 2}' patternUnits='userSpaceOnUse'>`
        + `<circle cx='${sp / 2}' cy='${sp / 2}' r='${p.size}' fill='${c}'/><circle cx='${sp / 2 + off}' cy='${sp * 1.5}' r='${p.size}' fill='${c}'/>`
        + (off ? `<circle cx='${sp / 2 + off - sp}' cy='${sp * 1.5}' r='${p.size}' fill='${c}'/>` : '')
        + `</pattern></defs>${fill('q')}`
    },
  },
  {
    id: 'stripes', name: 'Stripes', color: ['Stripes', '#d6b168'],
    sliders: [s('wide', 'Stripe width', 1, 80, 0.5, 8), s('gap', 'Gap', 4, 160, 1, 34), s('angle', 'Angle', 0, 180, 1, 45)],
    draw: ({ p, c }) => `<defs><pattern id='q' width='${p.wide + p.gap}' height='10' patternUnits='userSpaceOnUse' patternTransform='rotate(${p.angle} ${W / 2} ${H / 2})'>`
      + `<rect width='${p.wide}' height='10' fill='${c}'/></pattern></defs>${fill('q')}`,
  },
  {
    id: 'checker', name: 'Checkerboard', color: ['Squares', '#d6b168'],
    sliders: [s('size', 'Square size', 10, 150, 1, 46), s('angle', 'Tilt', 0, 45, 1, 0)],
    draw: ({ p, c }) => `<defs><pattern id='q' width='${p.size * 2}' height='${p.size * 2}' patternUnits='userSpaceOnUse' patternTransform='rotate(${p.angle} ${W / 2} ${H / 2})'>`
      + `<rect width='${p.size}' height='${p.size}' fill='${c}'/><rect x='${p.size}' y='${p.size}' width='${p.size}' height='${p.size}' fill='${c}'/></pattern></defs>${fill('q')}`,
  },
  {
    id: 'lattice', name: 'Trellis', color: ['Lines', '#d6b168'],
    sliders: [s('cell', 'Cell size', 30, 200, 1, 78), s('weight', 'Line weight', 0.5, 8, 0.1, 1.6), s('knot', 'Knots', 0, 12, 0.5, 4)],
    draw: ({ p, c }) => `<defs><pattern id='q' width='${p.cell}' height='${p.cell}' patternUnits='userSpaceOnUse' patternTransform='rotate(45 ${W / 2} ${H / 2})'>`
      + `<path d='M0 0 H${p.cell} M0 0 V${p.cell}' stroke='${c}' stroke-width='${p.weight}' fill='none'/>`
      + (p.knot > 0 ? [[0, 0], [p.cell, 0], [0, p.cell], [p.cell, p.cell]].map(([x, y]) => `<circle cx='${x}' cy='${y}' r='${p.knot}' fill='${c}'/>`).join('') : '')
      + `</pattern></defs>${fill('q')}`,
  },
  {
    id: 'harlequin', name: 'Harlequin', color: ['Diamonds', '#d6b168'], detail: ['Outline', '#d6b168'],
    sliders: [s('tall', 'Height', 30, 260, 2, 110), s('wide', 'Width', 0.3, 1.5, 0.02, 0.62), s('line', 'Outline', 0, 4, 0.1, 0)],
    draw: ({ p, c, d }) => {
      const h = p.tall, w = h * p.wide
      return `<defs><pattern id='q' width='${n2(w)}' height='${h}' patternUnits='userSpaceOnUse' x='${n2((W % w) / 2)}'>`
        + `<path d='M${n2(w / 2)} 0 L${n2(w)} ${h / 2} L${n2(w / 2)} ${h} L0 ${h / 2} Z' fill='${c}'${p.line > 0 ? ` stroke='${d}' stroke-width='${p.line}'` : ''}/></pattern></defs>${fill('q')}`
    },
  },
  {
    id: 'stars', name: 'Starry sky', color: ['Stars', '#f2d38a'],
    sliders: [s('count', 'Stars', 10, 400, 1, 110), s('size', 'Star size', 2, 24, 0.5, 9), s('glow', 'Glow', 0, 1, 0.05, 0.5), s('seed', 'Shuffle', 1, 99, 1, 7)],
    draw: ({ p, c }) => {
      const rnd = seeded(p.seed)
      let out = ''
      for (let i = 0; i < p.count; i++) {
        const x = n2(rnd() * W), y = n2(rnd() * H), k = p.size * (0.35 + rnd() * 0.9), q = n2(k * 0.26), o = n2(0.45 + rnd() * 0.55)
        if (p.glow > 0) out += `<circle cx='${x}' cy='${y}' r='${n2(k * 1.3)}' fill='${c}' opacity='${n2(o * p.glow * 0.18)}'/>`
        out += `<path d='M${x} ${n2(y - k)} L${n2(x + q)} ${n2(y - q)} L${n2(x + k)} ${y} L${n2(x + q)} ${n2(y + q)} L${x} ${n2(y + k)} L${n2(x - q)} ${n2(y + q)} L${n2(x - k)} ${y} L${n2(x - q)} ${n2(y - q)} Z' fill='${c}' opacity='${o}'/>`
      }
      return out
    },
  },
  {
    id: 'confetti', name: 'Confetti', color: ['Colour one', '#f2d38a'], detail: ['Colour two', '#e07a8a'],
    sliders: [s('count', 'Pieces', 20, 400, 1, 140), s('size', 'Size', 3, 34, 0.5, 14), s('round', 'Roundness', 0, 1, 0.05, 0.4), s('seed', 'Shuffle', 1, 99, 1, 3)],
    draw: ({ p, c, d }) => {
      const rnd = seeded(p.seed)
      let out = ''
      for (let i = 0; i < p.count; i++) {
        const x = n2(rnd() * W), y = n2(rnd() * H), k = n2(p.size * (0.5 + rnd() * 0.8)), a = Math.round(rnd() * 180), col = rnd() < 0.5 ? c : d
        out += rnd() < p.round
          ? `<circle cx='${x}' cy='${y}' r='${n2(k * 0.45)}' fill='${col}'/>`
          : `<rect x='${n2(x - k / 2)}' y='${n2(y - k / 5)}' width='${k}' height='${n2(k * 0.4)}' rx='${n2(k * 0.08)}' fill='${col}' transform='rotate(${a} ${x} ${y})'/>`
      }
      return out
    },
  },
  {
    id: 'waves', name: 'Waves', color: ['Waves', '#8fb2ff'],
    sliders: [s('lines', 'Lines', 3, 50, 1, 16), s('amp', 'Wave height', 0, 50, 0.5, 14), s('length', 'Wave length', 40, 500, 2, 170), s('shift', 'Ripple', 0, 3.14, 0.05, 0.6), s('weight', 'Line weight', 0.5, 8, 0.1, 1.6)],
    draw: ({ p, c }) => {
      let out = ''
      for (let i = 0; i < p.lines; i++) {
        const y0 = (H * (i + 0.5)) / p.lines, pts: string[] = []
        for (let x = 0; x <= W; x += 6) pts.push(`${x},${n2(y0 + p.amp * Math.sin((2 * Math.PI * x) / p.length + i * p.shift))}`)
        out += `<polyline points='${pts.join(' ')}' fill='none' stroke='${c}' stroke-width='${p.weight}' stroke-linecap='round'/>`
      }
      return out
    },
  },
  {
    id: 'sunburst', name: 'Sunburst', color: ['Rays', '#d6b168'],
    sliders: [s('rays', 'Rays', 6, 72, 1, 28), s('wide', 'Ray width', 0.1, 0.9, 0.02, 0.45), s('cy', 'Centre height', 0, 100, 1, 42), s('core', 'Centre gap', 0, 300, 2, 40)],
    draw: ({ p, c }) => {
      const cx = W / 2, cy = (H * p.cy) / 100, R = 1500, step = (2 * Math.PI) / p.rays, half = (step * p.wide) / 2
      let out = ''
      for (let i = 0; i < p.rays; i++) {
        const a = i * step
        const pt = (ang: number, r: number) => `${n2(cx + r * Math.cos(ang))} ${n2(cy + r * Math.sin(ang))}`
        out += `<path d='M${pt(a - half * 0.15, p.core)} L${pt(a - half, R)} L${pt(a + half, R)} L${pt(a + half * 0.15, p.core)} Z' fill='${c}'/>`
      }
      return out
    },
  },
  {
    id: 'grid', name: 'Graph paper', color: ['Lines', '#c7ccd3'],
    sliders: [s('cell', 'Square size', 8, 80, 1, 22), s('weight', 'Line weight', 0.3, 4, 0.1, 0.7), s('major', 'Bold every', 0, 10, 1, 5)],
    draw: ({ p, c }) => {
      const z = p.cell
      let out = `<defs><pattern id='q' width='${z}' height='${z}' patternUnits='userSpaceOnUse'><path d='M${z} 0 V${z} M0 ${z} H${z}' stroke='${c}' stroke-width='${p.weight}' fill='none'/></pattern>`
      if (p.major > 1) out += `<pattern id='m' width='${z * p.major}' height='${z * p.major}' patternUnits='userSpaceOnUse'><path d='M${z * p.major} 0 V${z * p.major} M0 ${z * p.major} H${z * p.major}' stroke='${c}' stroke-width='${n2(p.weight * 2.4)}' fill='none'/></pattern>`
      return out + `</defs>${fill('q')}${p.major > 1 ? fill('m') : ''}`
    },
  },
  {
    id: 'honeycomb', name: 'Honeycomb', color: ['Lines', '#d6b168'],
    sliders: [s('size', 'Cell size', 10, 90, 1, 34), s('weight', 'Line weight', 0.5, 6, 0.1, 1.4), s('fill', 'Filled cells', 0, 1, 0.05, 0)],
    draw: ({ p, c }) => {
      const r = p.size, w = n2(Math.sqrt(3) * r), h = r * 3
      const hex = (x: number, y: number) => {
        const pts = [0, 60, 120, 180, 240, 300].map((a) => `${n2(x + r * Math.sin((a * Math.PI) / 180))},${n2(y - r * Math.cos((a * Math.PI) / 180))}`).join(' ')
        return `<polygon points='${pts}' fill='${p.fill > 0 ? c : 'none'}' fill-opacity='${n2(p.fill * 0.5)}' stroke='${c}' stroke-width='${p.weight}'/>`
      }
      return `<defs><pattern id='q' width='${w}' height='${h}' patternUnits='userSpaceOnUse'>`
        + hex(w / 2, r) + hex(0, r * 2.5) + hex(w, r * 2.5) + hex(w / 2, r * 4) + hex(0, -r * 0.5) + hex(w, -r * 0.5)
        + `</pattern></defs>${fill('q')}`
    },
  },
  {
    id: 'scales', name: 'Dragon scales', color: ['Edges', '#d6b168'],
    sliders: [s('size', 'Scale size', 16, 140, 1, 52), s('edge', 'Edge', 0.3, 6, 0.1, 1.6), s('depth', 'Depth', 0, 1, 0.05, 0.4)],
    draw: ({ p, c }) => {
      const z = p.size, r = z / 2
      const sc = (x: number, y: number) => `<path d='M${n2(x)} ${n2(y)} A${r} ${r} 0 0 0 ${n2(x + z)} ${n2(y)} Z' fill='#000' fill-opacity='${n2(p.depth * 0.35)}' stroke='${c}' stroke-width='${p.edge}'/>`
      return `<defs><pattern id='q' width='${z}' height='${z}' patternUnits='userSpaceOnUse'>${sc(0, 0)}${sc(-r, r)}${sc(r, r)}${sc(0, z)}</pattern></defs>${fill('q')}`
    },
  },
  {
    id: 'topo', name: 'Contour map', color: ['Lines', '#6fd3a2'],
    sliders: [s('rings', 'Rings', 4, 60, 1, 24), s('cx', 'Peak across', 0, 100, 1, 32), s('cy', 'Peak down', 0, 100, 1, 36), s('wobble', 'Wobble', 0, 1, 0.02, 0.35), s('weight', 'Line weight', 0.5, 6, 0.1, 1.3)],
    draw: ({ p, c }) => {
      const cx = (W * p.cx) / 100, cy = (H * p.cy) / 100, gap = 1300 / p.rings
      let out = ''
      for (let i = 1; i <= p.rings; i++) {
        const r0 = i * gap, pts: string[] = []
        for (let a = 0; a < 360; a += 4) {
          const t = (a * Math.PI) / 180
          const r = r0 * (1 + p.wobble * 0.18 * (Math.sin(3 * t + i * 0.7) + 0.6 * Math.sin(5 * t - i * 0.4)))
          pts.push(`${n2(cx + r * Math.cos(t))},${n2(cy + r * Math.sin(t))}`)
        }
        out += `<polygon points='${pts.join(' ')}' fill='none' stroke='${c}' stroke-width='${p.weight}'/>`
      }
      return out
    },
  },
]

export const pagePatternOf = (id?: string) => PAGE_PATTERNS.find((x) => x.id === id)

/** One pattern's slider values: what the creator set, else its defaults (kept in range) */
export function patternParams(def: PagePatternDef, saved?: Record<string, Record<string, number>>): Record<string, number> {
  const mine = saved?.[def.id] ?? {}
  return Object.fromEntries(def.sliders.map((x) => [x.key, Math.min(x.max, Math.max(x.min, mine[x.key] ?? x.def))]))
}

export interface PatternLook {
  pattern?: string
  patternColor?: string
  patternDetail?: string
  patternOpacity?: number // Strength, 0.05–1 (default 0.3)
  patternFade?: number    // Fade edges, 0–1 (default 0.35)
  patternParams?: Record<string, Record<string, number>>
}

/** The page's pattern as an SVG (null = no pattern) */
export function patternSvg(look: PatternLook, only?: string): string | null {
  const def = pagePatternOf(only ?? look.pattern)
  if (!def) return null
  const body = def.draw({ p: patternParams(def, look.patternParams), c: look.patternColor ?? def.color[1], d: look.patternDetail ?? def.detail?.[1] ?? def.color[1] })
  const op = n2(Math.min(1, Math.max(0.05, look.patternOpacity ?? 0.3)))
  const fade = Math.min(1, Math.max(0, look.patternFade ?? 0.35))
  // Fade edges: the pattern dims toward the page's edges, like light falling in the middle
  const mask = fade > 0
    ? `<radialGradient id='fg' cx='50%' cy='45%' r='75%'><stop offset='${n2(0.85 - fade * 0.75)}' stop-color='#fff'/><stop offset='1' stop-color='#fff' stop-opacity='${n2(1 - fade)}'/></radialGradient><mask id='fm'><rect width='${W}' height='${H}' fill='url(#fg)'/></mask>`
    : ''
  return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${W} ${H}' preserveAspectRatio='xMidYMid slice'><defs>${mask}</defs><g opacity='${op}'${fade > 0 ? ` mask='url(#fm)'` : ''}>${body}</g></svg>`
}

/** The pattern as a CSS background image (null = no pattern) */
export function patternCss(look: PatternLook, only?: string): string | null {
  const svg = patternSvg(look, only)
  return svg ? `url("data:image/svg+xml,${encodeURIComponent(svg).replace(/'/g, '%27')}")` : null
}
