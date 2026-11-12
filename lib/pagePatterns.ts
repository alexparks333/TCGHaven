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

// Card-suit shapes (centre x, y; size s)
const heart = (x: number, y: number, s: number) => `M${n2(x)} ${n2(y + s * 0.9)} C${n2(x - s * 1.2)} ${n2(y + s * 0.1)} ${n2(x - s * 0.9)} ${n2(y - s * 0.9)} ${n2(x)} ${n2(y - s * 0.3)} C${n2(x + s * 0.9)} ${n2(y - s * 0.9)} ${n2(x + s * 1.2)} ${n2(y + s * 0.1)} ${n2(x)} ${n2(y + s * 0.9)} Z`
const spade = (x: number, y: number, s: number) => `M${n2(x)} ${n2(y - s * 0.9)} C${n2(x - s * 1.2)} ${n2(y - s * 0.1)} ${n2(x - s * 0.9)} ${n2(y + s * 0.8)} ${n2(x)} ${n2(y + s * 0.25)} C${n2(x + s * 0.9)} ${n2(y + s * 0.8)} ${n2(x + s * 1.2)} ${n2(y - s * 0.1)} ${n2(x)} ${n2(y - s * 0.9)} Z M${n2(x)} ${n2(y + s * 0.1)} L${n2(x - s * 0.35)} ${n2(y + s)} L${n2(x + s * 0.35)} ${n2(y + s)} Z`
const diamond = (x: number, y: number, s: number) => `M${n2(x)} ${n2(y - s)} L${n2(x + s * 0.7)} ${n2(y)} L${n2(x)} ${n2(y + s)} L${n2(x - s * 0.7)} ${n2(y)} Z`
const circ = (x: number, y: number, r: number) => `M${n2(x - r)} ${n2(y)} a${n2(r)} ${n2(r)} 0 1 0 ${n2(r * 2)} 0 a${n2(r)} ${n2(r)} 0 1 0 ${n2(-r * 2)} 0 Z`
const club = (x: number, y: number, s: number) => circ(x, y - s * 0.45, s * 0.42) + circ(x - s * 0.48, y + s * 0.12, s * 0.42) + circ(x + s * 0.48, y + s * 0.12, s * 0.42)
  + `M${n2(x)} ${n2(y)} L${n2(x - s * 0.35)} ${n2(y + s)} L${n2(x + s * 0.35)} ${n2(y + s)} Z`
export const SUITS = { heart, spade, diamond, club }

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
  {
    id: 'deco', name: 'Art Deco fans', color: ['Fans', '#d6b168'],
    sliders: [s('size', 'Fan size', 40, 220, 2, 96), s('rings', 'Rings', 1, 8, 1, 4), s('rays', 'Rays', 0, 14, 1, 6), s('weight', 'Line weight', 0.5, 5, 0.1, 1.4)],
    draw: ({ p, c }) => {
      const z = p.size, R = z / 2
      const fan = (x: number, y: number) => {
        let o = ''
        for (let k = 1; k <= p.rings; k++) { const r = n2((R * k) / p.rings); o += `<path d='M${n2(x - r)} ${y} A${r} ${r} 0 0 1 ${n2(x + r)} ${y}' fill='none' stroke='${c}' stroke-width='${p.weight}'/>` }
        for (let k = 1; k < p.rays + 1; k++) { const a = Math.PI + (Math.PI * k) / (p.rays + 1); o += `<path d='M${x} ${y} L${n2(x + R * Math.cos(a))} ${n2(y + R * Math.sin(a))}' stroke='${c}' stroke-width='${n2(p.weight * 0.7)}'/>` }
        return o
      }
      return `<defs><pattern id='q' width='${z}' height='${R}' patternUnits='userSpaceOnUse'>${fan(R, R)}${fan(0, R * 2)}${fan(z, R * 2)}${fan(0, 0)}${fan(z, 0)}</pattern></defs>${fill('q')}`
    },
  },
  {
    id: 'moroccan', name: 'Moroccan tiles', color: ['Lines', '#d6b168'], detail: ['Centres', '#6fd3a2'],
    sliders: [s('size', 'Tile size', 40, 240, 2, 104), s('weight', 'Line weight', 0.5, 6, 0.1, 1.6), s('dot', 'Centres', 0, 1, 0.05, 0.5), s('angle', 'Tilt', 0, 45, 1, 0)],
    draw: ({ p, c, d }) => {
      const z = p.size, r = z / 4
      const foil = (cx: number, cy: number) => `<path d='M${n2(cx + r)} ${n2(cy - r)} A${r} ${r} 0 0 1 ${n2(cx + r)} ${n2(cy + r)} A${r} ${r} 0 0 1 ${n2(cx - r)} ${n2(cy + r)} A${r} ${r} 0 0 1 ${n2(cx - r)} ${n2(cy - r)} A${r} ${r} 0 0 1 ${n2(cx + r)} ${n2(cy - r)} Z' fill='none' stroke='${c}' stroke-width='${p.weight}'/>`
        + (p.dot > 0 ? `<path d='M${cx} ${n2(cy - r * 0.6 * p.dot)} L${n2(cx + r * 0.6 * p.dot)} ${cy} L${cx} ${n2(cy + r * 0.6 * p.dot)} L${n2(cx - r * 0.6 * p.dot)} ${cy} Z' fill='${d}'/>` : '')
      return `<defs><pattern id='q' width='${z}' height='${z}' patternUnits='userSpaceOnUse' patternTransform='rotate(${p.angle} ${W / 2} ${H / 2})'>${foil(z / 2, z / 2)}${foil(0, 0)}${foil(z, 0)}${foil(0, z)}${foil(z, z)}</pattern></defs>${fill('q')}`
    },
  },
  {
    id: 'mandala', name: 'Mandala', color: ['Colour one', '#d6b168'], detail: ['Colour two', '#c79bff'],
    sliders: [s('size', 'Size', 120, 700, 5, 380), s('rings', 'Rings', 2, 10, 1, 6), s('petals', 'Petals', 6, 36, 1, 16), s('cy', 'Height', 10, 90, 1, 46), s('weight', 'Line weight', 0.5, 4, 0.1, 1.2)],
    draw: ({ p, c, d }) => {
      const cx = W / 2, cy = (H * p.cy) / 100
      let out = ''
      for (let i = 1; i <= p.rings; i++) {
        const r = (p.size * i) / p.rings, col = i % 2 ? c : d, pr = (p.size / p.rings) * 0.48, n = Math.round(p.petals * (i % 2 ? 1 : 1.5))
        out += `<circle cx='${cx}' cy='${n2(cy)}' r='${n2(r)}' fill='none' stroke='${col}' stroke-width='${n2(p.weight * 0.6)}'/>`
        for (let k = 0; k < n; k++) {
          const a = n2((360 * k) / n + (i % 2 ? 0 : 180 / n))
          out += i % 3 === 0
            ? `<circle cx='${cx}' cy='${n2(cy - r + pr * 0.5)}' r='${n2(pr * 0.22)}' fill='${col}' transform='rotate(${a} ${cx} ${n2(cy)})'/>`
            : `<path d='M${cx} ${n2(cy - r + pr)} Q${n2(cx + pr * 0.45)} ${n2(cy - r + pr * 0.4)} ${cx} ${n2(cy - r - pr * 0.05)} Q${n2(cx - pr * 0.45)} ${n2(cy - r + pr * 0.4)} ${cx} ${n2(cy - r + pr)} Z' fill='none' stroke='${col}' stroke-width='${p.weight}' transform='rotate(${a} ${cx} ${n2(cy)})'/>`
        }
      }
      return out + `<circle cx='${cx}' cy='${n2(cy)}' r='${n2(p.size / p.rings / 3)}' fill='${c}'/>`
    },
  },
  {
    id: 'constellations', name: 'Constellations', color: ['Stars & lines', '#f2d38a'],
    sliders: [s('groups', 'Constellations', 2, 20, 1, 8), s('stars', 'Stars each', 3, 9, 1, 5), s('dust', 'Faint stars', 0, 300, 5, 90), s('weight', 'Line weight', 0.3, 3, 0.1, 0.9), s('seed', 'Shuffle', 1, 99, 1, 11)],
    draw: ({ p, c }) => {
      const rnd = seeded(p.seed)
      let out = ''
      for (let i = 0; i < p.dust; i++) out += `<circle cx='${n2(rnd() * W)}' cy='${n2(rnd() * H)}' r='${n2(0.6 + rnd() * 1.2)}' fill='${c}' opacity='${n2(0.25 + rnd() * 0.4)}'/>`
      for (let g = 0; g < p.groups; g++) {
        let x = 60 + rnd() * (W - 120), y = 60 + rnd() * (H - 120)
        const pts: Array<[number, number]> = [[x, y]]
        for (let k = 1; k < p.stars; k++) { x = Math.min(W - 20, Math.max(20, x + (rnd() - 0.5) * 140)); y = Math.min(H - 20, Math.max(20, y + (rnd() - 0.5) * 140)); pts.push([x, y]) }
        out += `<polyline points='${pts.map(([a, b]) => `${n2(a)},${n2(b)}`).join(' ')}' fill='none' stroke='${c}' stroke-width='${p.weight}' opacity='0.6'/>`
        for (const [a, b] of pts) { const r = 2.2 + rnd() * 2.8; out += `<circle cx='${n2(a)}' cy='${n2(b)}' r='${n2(r * 2.2)}' fill='${c}' opacity='0.15'/><circle cx='${n2(a)}' cy='${n2(b)}' r='${n2(r)}' fill='${c}'/>` }
      }
      return out
    },
  },
  {
    id: 'circuit', name: 'Circuit board', color: ['Traces', '#6fd3a2'],
    sliders: [s('traces', 'Traces', 10, 160, 1, 60), s('grid', 'Grid size', 12, 60, 1, 26), s('weight', 'Line weight', 0.5, 5, 0.1, 1.6), s('pad', 'Pad size', 1, 10, 0.5, 4), s('seed', 'Shuffle', 1, 99, 1, 5)],
    draw: ({ p, c }) => {
      const rnd = seeded(p.seed), g = p.grid
      const dirs: Array<[number, number]> = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]
      let out = ''
      for (let t = 0; t < p.traces; t++) {
        let x = Math.round((rnd() * W) / g) * g, y = Math.round((rnd() * H) / g) * g
        let [dx, dy] = dirs[Math.floor(rnd() * 4)]
        const pts = [`${x},${y}`]
        const legs = 2 + Math.floor(rnd() * 4)
        for (let l = 0; l < legs; l++) {
          const len = (1 + Math.floor(rnd() * 5)) * g
          x += dx * len; y += dy * len; pts.push(`${x},${y}`)
          const turn = dirs[Math.floor(rnd() * 8)]
          if (turn[0] !== -dx || turn[1] !== -dy) [dx, dy] = turn
        }
        const [ex, ey] = pts[pts.length - 1].split(',')
        const [sx, sy] = pts[0].split(',')
        out += `<polyline points='${pts.join(' ')}' fill='none' stroke='${c}' stroke-width='${p.weight}' stroke-linejoin='round'/>`
          + `<circle cx='${ex}' cy='${ey}' r='${p.pad}' fill='none' stroke='${c}' stroke-width='${p.weight}'/><circle cx='${sx}' cy='${sy}' r='${n2(p.pad * 0.6)}' fill='${c}'/>`
      }
      return out
    },
  },
  {
    id: 'suits', name: 'Card suits', color: ['Black suits', '#d6b168'], detail: ['Red suits', '#e05252'],
    sliders: [s('size', 'Size', 6, 40, 0.5, 14), s('space', 'Spacing', 30, 160, 1, 64), s('tilt', 'Tilt', 0, 45, 1, 0)],
    draw: ({ p, c, d }) => {
      const z = p.size, sp = p.space, h = sp / 2
      return `<defs><pattern id='q' width='${sp}' height='${sp}' patternUnits='userSpaceOnUse' patternTransform='rotate(${p.tilt} ${W / 2} ${H / 2})'>`
        + `<path d='${spade(h / 2, h / 2, z)}' fill='${c}'/><path d='${heart(h * 1.5, h / 2, z)}' fill='${d}'/>`
        + `<path d='${diamond(h / 2, h * 1.5, z)}' fill='${d}'/><path d='${club(h * 1.5, h * 1.5, z)}' fill='${c}'/>`
        + `</pattern></defs>${fill('q')}`
    },
  },
  {
    id: 'crystals', name: 'Crystals', color: ['Edges', '#c7ccd3'], detail: ['Facets', '#8fb2ff'],
    sliders: [s('count', 'Crystals', 4, 120, 1, 34), s('size', 'Size', 8, 80, 1, 30), s('facets', 'Facets', 0, 1, 0.05, 0.6), s('seed', 'Shuffle', 1, 99, 1, 9)],
    draw: ({ p, c, d }) => {
      const rnd = seeded(p.seed)
      let out = ''
      for (let i = 0; i < p.count; i++) {
        const x = rnd() * W, y = rnd() * H, k = p.size * (0.5 + rnd() * 0.8), a = Math.round(rnd() * 60 - 30)
        const top = [x, y - k], l = [x - k * 0.55, y - k * 0.25], r = [x + k * 0.55, y - k * 0.25], bl = [x - k * 0.4, y + k * 0.5], br = [x + k * 0.4, y + k * 0.5], bot = [x, y + k * 0.95]
        const P = (q: number[]) => `${n2(q[0])},${n2(q[1])}`
        out += `<g transform='rotate(${a} ${n2(x)} ${n2(y)})'>`
          + `<polygon points='${[top, r, br, bot, bl, l].map(P).join(' ')}' fill='${d}' fill-opacity='${n2(p.facets * 0.25)}' stroke='${c}' stroke-width='1.2'/>`
          + (p.facets > 0 ? `<path d='M${P(l)} L${P([x, y])} L${P(r)} M${P(top)} L${P([x, y])} L${P(bot)} M${P(bl)} L${P([x, y])} L${P(br)}' stroke='${c}' stroke-width='0.7' opacity='${p.facets}' fill='none'/>` : '')
          + `</g>`
      }
      return out
    },
  },
  {
    id: 'vines', name: 'Climbing vines', color: ['Vines', '#6fd3a2'], detail: ['Flowers', '#f5a3c7'],
    sliders: [s('cols', 'Vines', 1, 8, 1, 4), s('wave', 'Sway', 5, 80, 1, 34), s('leaf', 'Leaf size', 4, 30, 0.5, 13), s('bloom', 'Flowers', 0, 1, 0.05, 0.5), s('weight', 'Stem weight', 0.5, 4, 0.1, 1.6)],
    draw: ({ p, c, d }) => {
      let out = ''
      for (let v = 0; v < p.cols; v++) {
        const cx = (W * (v + 0.5)) / p.cols, ph = v * 1.7, xAt = (y: number) => cx + p.wave * Math.sin(y / 70 + ph)
        const pts: string[] = []
        for (let y = -10; y <= H + 10; y += 8) pts.push(`${n2(xAt(y))},${y}`)
        out += `<polyline points='${pts.join(' ')}' fill='none' stroke='${c}' stroke-width='${p.weight}'/>`
        for (let y = 20, k = 0; y < H; y += 46, k++) {
          const x = xAt(y), side = k % 2 ? 1 : -1, L = p.leaf
          out += `<path d='M${n2(x)} ${y} q${n2(side * L * 0.9)} ${n2(-L * 0.9)} ${n2(side * L * 1.6)} ${n2(-L * 0.3)} q${n2(-side * L * 0.6)} ${n2(L * 0.9)} ${n2(-side * L * 1.6)} ${n2(L * 0.3)} Z' fill='${c}' opacity='0.85'/>`
          if (k % 3 === 1) out += `<path d='M${n2(x)} ${y} q${n2(-side * L)} ${n2(L * 0.2)} ${n2(-side * L * 1.1)} ${n2(L * 1.1)} q0 ${n2(L * 0.5)} ${n2(side * L * 0.45)} ${n2(L * 0.45)}' fill='none' stroke='${c}' stroke-width='${n2(p.weight * 0.6)}'/>`
          if (p.bloom > 0 && k % 4 === 2) {
            const fx = x - side * L * 1.2, fy = y + L * 0.4, pr = L * 0.42 * (0.6 + p.bloom * 0.6)
            for (let a = 0; a < 5; a++) out += `<circle cx='${n2(fx + pr * Math.cos((a * 2 * Math.PI) / 5))}' cy='${n2(fy + pr * Math.sin((a * 2 * Math.PI) / 5))}' r='${n2(pr * 0.75)}' fill='${d}' opacity='${n2(0.5 + p.bloom * 0.5)}'/>`
            out += `<circle cx='${n2(fx)}' cy='${n2(fy)}' r='${n2(pr * 0.5)}' fill='${c}'/>`
          }
        }
      }
      return out
    },
  },
  {
    id: 'sakura', name: 'Cherry blossoms', color: ['Petals', '#f5a3c7'], detail: ['Centres', '#f2d38a'],
    sliders: [s('count', 'Blossoms', 5, 120, 1, 30), s('size', 'Size', 6, 40, 0.5, 16), s('petals', 'Falling petals', 0, 200, 5, 50), s('seed', 'Shuffle', 1, 99, 1, 4)],
    draw: ({ p, c, d }) => {
      const rnd = seeded(p.seed)
      let out = ''
      for (let i = 0; i < p.petals; i++) {
        const x = rnd() * W, y = rnd() * H, k = p.size * (0.25 + rnd() * 0.2)
        out += `<ellipse cx='${n2(x)}' cy='${n2(y)}' rx='${n2(k)}' ry='${n2(k * 0.55)}' fill='${c}' opacity='0.7' transform='rotate(${Math.round(rnd() * 180)} ${n2(x)} ${n2(y)})'/>`
      }
      for (let i = 0; i < p.count; i++) {
        const x = rnd() * W, y = rnd() * H, k = p.size * (0.7 + rnd() * 0.6), rot = rnd() * 72
        out += `<g transform='rotate(${n2(rot)} ${n2(x)} ${n2(y)})'>`
        for (let a = 0; a < 5; a++) {
          const t = (a * 72 * Math.PI) / 180, px = x + k * 0.55 * Math.cos(t), py = y + k * 0.55 * Math.sin(t)
          out += `<ellipse cx='${n2(px)}' cy='${n2(py)}' rx='${n2(k * 0.5)}' ry='${n2(k * 0.36)}' fill='${c}' transform='rotate(${a * 72} ${n2(px)} ${n2(py)})'/>`
        }
        out += `<circle cx='${n2(x)}' cy='${n2(y)}' r='${n2(k * 0.2)}' fill='${d}'/></g>`
      }
      return out
    },
  },
  {
    id: 'tartan', name: 'Tartan', color: ['Bands', '#a8452a'], detail: ['Pinlines', '#f2d38a'],
    sliders: [s('band', 'Band width', 10, 120, 1, 46), s('space', 'Spacing', 60, 300, 2, 150), s('pin', 'Pinline', 0, 6, 0.2, 2), s('cross', 'Cross bands', 0, 1, 0.05, 0.6)],
    draw: ({ p, c, d }) => {
      const sp = p.space, b = p.band, o = n2(0.35 + p.cross * 0.4)
      return `<defs><pattern id='q' width='${sp}' height='${sp}' patternUnits='userSpaceOnUse'>`
        + `<rect x='${n2((sp - b) / 2)}' width='${b}' height='${sp}' fill='${c}' opacity='${o}'/><rect y='${n2((sp - b) / 2)}' height='${b}' width='${sp}' fill='${c}' opacity='${o}'/>`
        + `<rect x='${n2(sp / 2 - b / 6)}' width='${n2(b / 3)}' height='${sp}' fill='${c}' opacity='${n2(o * 0.8)}'/><rect y='${n2(sp / 2 - b / 6)}' height='${n2(b / 3)}' width='${sp}' fill='${c}' opacity='${n2(o * 0.8)}'/>`
        + (p.pin > 0 ? `<rect x='${n2(sp * 0.08)}' width='${p.pin}' height='${sp}' fill='${d}'/><rect y='${n2(sp * 0.08)}' height='${p.pin}' width='${sp}' fill='${d}'/>` : '')
        + `</pattern></defs>${fill('q')}`
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
