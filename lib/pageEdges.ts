// A creator book's page edges — the block of pages showing at the side of the closed book (Creator
// Studio → Cover → Page edges, docs/creators.md). A style (plain paper, gilded leaf, sprayed
// speckles, marbled, a painted fade, chapter bands), its colours (any) and its sliders, plus how
// deep the block shows and how strongly the page lines read. Drawn by BadgeLibrary's BookThickness.

import type { CoverStyle } from '@/lib/badges'

export interface EdgeSlider { key: string; label: string; min: number; max: number; step: number; def: number }
export interface PageEdgeDef { id: string; name: string; colors: Array<[label: string, def: string]>; sliders: EdgeSlider[] }
const s = (key: string, label: string, min: number, max: number, step: number, def: number): EdgeSlider => ({ key, label, min, max, step, def })

export const PAGE_EDGES: PageEdgeDef[] = [
  { id: 'paper', name: 'Paper', colors: [['Paper', '#efe2c4']], sliders: [s('age', 'Age', 0, 1, 0.05, 0.25)] },
  { id: 'gilded', name: 'Gilded', colors: [['Leaf', '#d6b168']], sliders: [s('sheen', 'Shine', 0, 1, 0.05, 0.75), s('wear', 'Wear', 0, 1, 0.05, 0.2)] },
  { id: 'sprayed', name: 'Sprayed', colors: [['Paper', '#efe2c4'], ['Speckles', '#7a2b2b']], sliders: [s('amount', 'Speckles', 0.1, 1, 0.05, 0.6), s('size', 'Speck size', 0.5, 3, 0.1, 1.2)] },
  { id: 'marbled', name: 'Marbled', colors: [['Base', '#2c4a7a'], ['Veins', '#efe2c4']], sliders: [s('scale', 'Swirl size', 0.2, 2, 0.05, 0.8), s('contrast', 'Veins', 0.2, 1, 0.05, 0.7)] },
  { id: 'ombre', name: 'Painted fade', colors: [['From', '#f5a3c7'], ['To', '#8fb2ff']], sliders: [s('angle', 'Direction', 0, 180, 1, 90), s('soft', 'Blend', 0.1, 1, 0.05, 1)] },
  { id: 'bands', name: 'Chapter bands', colors: [['Colour one', '#efe2c4'], ['Colour two', '#a8452a']], sliders: [s('band', 'Band size', 3, 40, 1, 12), s('ratio', 'Second colour', 0.1, 0.9, 0.05, 0.3)] },
]

export const pageEdgeOf = (id?: string) => PAGE_EDGES.find((e) => e.id === id)
export function edgeParams(def: PageEdgeDef, st?: CoverStyle): Record<string, number> {
  const saved = st?.pageParams?.[def.id] ?? {}
  return Object.fromEntries(def.sliders.map((x) => [x.key, Math.min(x.max, Math.max(x.min, saved[x.key] ?? x.def))]))
}
export const PAGE_DEPTH = 5 // px the block shows past the cover, unless changed

const svgUrl = (svg: string) => `url("data:image/svg+xml,${encodeURIComponent(svg).replace(/'/g, '%27')}")`
const hex = (c: string) => {
  const h = c.replace('#', ''), f = h.length === 3 ? h.split('').map((x) => x + x).join('') : h.padEnd(6, '0')
  return [0, 2, 4].map((i) => (parseInt(f.slice(i, i + 2), 16) || 0) / 255)
}

/** The page block's background (CSS), or null for the classic dark edge. `only`: a style to show instead */
export function pageEdgeCss(st?: CoverStyle, only?: string): string | null {
  // Before page-edge styles there was only a colour (CoverStyle.pageColor) — that's plain paper
  const def = pageEdgeOf(only ?? st?.pageStyle ?? (st?.pageColor ? 'paper' : undefined))
  if (!def) return null
  const p = edgeParams(def, st)
  const c1 = st?.pageColor ?? def.colors[0][1], c2 = st?.pageColor2 ?? def.colors[1]?.[1] ?? c1
  const lines = Math.max(0, Math.min(1, st?.pageLines ?? 0.5))
  // the edges of the sheets: fine lines, darker where pages bunch
  const sheets = `repeating-linear-gradient(0deg, rgba(0,0,0,${(0.28 * lines).toFixed(3)}) 0 1px, rgba(255,255,255,${(0.08 * lines).toFixed(3)}) 1px 2px, transparent 2px 3px)`
  switch (def.id) {
    case 'paper':
      return `${sheets}, linear-gradient(135deg, transparent 40%, rgba(120,80,20,${(0.35 * p.age).toFixed(3)})), ${c1}`
    case 'gilded':
      return `${sheets}, ${svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.7' numOctaves='2'/><feColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ${(0.9 * p.wear).toFixed(2)} 0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`)}, linear-gradient(160deg, color-mix(in srgb, ${c1} 60%, black) 0%, color-mix(in srgb, ${c1} ${Math.round(100 - 75 * p.sheen)}%, white) 30%, ${c1} 48%, color-mix(in srgb, ${c1} 70%, black) 66%, color-mix(in srgb, ${c1} ${Math.round(100 - 55 * p.sheen)}%, white) 84%, color-mix(in srgb, ${c1} 65%, black) 100%)`
    case 'sprayed': {
      const z = p.size, a = p.amount
      const dot = (x: number, y: number, r: number, w: number, h: number) => `radial-gradient(circle at ${x}% ${y}%, ${c2} 0 ${r}px, transparent ${r + 0.6}px) 0 0 / ${w}px ${h}px`
      return `${sheets}, ${dot(20, 30, 0.6 * z, Math.round(9 / a), Math.round(7 / a))}, ${dot(70, 60, 0.9 * z, Math.round(13 / a), Math.round(11 / a))}, ${dot(40, 80, 0.5 * z, Math.round(7 / a), Math.round(17 / a))}, ${dot(85, 15, 1.1 * z, Math.round(19 / a), Math.round(23 / a))}, ${c1}`
    }
    case 'marbled': {
      const [r, g, b] = hex(c2)
      const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='m'><feTurbulence type='turbulence' baseFrequency='${(0.02 / p.scale).toFixed(4)} ${(0.05 / p.scale).toFixed(4)}' numOctaves='3' seed='7'/><feColorMatrix values='0 0 0 0 ${r.toFixed(3)} 0 0 0 0 ${g.toFixed(3)} 0 0 0 0 ${b.toFixed(3)} ${(-5 * p.contrast).toFixed(2)} 0 0 0 ${(1.1 * p.contrast).toFixed(2)}'/></filter><rect width='100%' height='100%' filter='url(#m)'/></svg>`
      return `${sheets}, ${svgUrl(svg)}, ${c1}`
    }
    case 'ombre':
      return `${sheets}, linear-gradient(${p.angle}deg, ${c1} ${Math.round((1 - p.soft) * 45)}%, ${c2} ${Math.round(100 - (1 - p.soft) * 45)}%)`
    case 'bands': {
      const b = p.band, k = Math.round(b * p.ratio)
      return `${sheets}, repeating-linear-gradient(0deg, ${c2} 0 ${k}px, ${c1} ${k}px ${b}px)`
    }
  }
  return null
}
