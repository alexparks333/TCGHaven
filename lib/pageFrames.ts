// A creator book's page borders (Creator Studio → Inside look → Border, docs/creators.md). Each
// border is drawn once as a 120 × 120 SVG "nine-slice": its top-left corner (0–40), and one stretch of
// its top edge (x 40–80) that repeats along every side. insideLook() hands it to CSS as
// `border-image` on the page's frame (globals.css `.pinbook-framed .pinbook-frame`), so corners stay
// crisp at any page size and the edges repeat cleanly. The other three sides and corners are the
// same drawing turned round the middle.

import { SUITS } from '@/lib/pagePatterns'

type Line = { o: number; w: number; dash?: string; col?: 'c' | 'd'; op?: number }
export interface FrameDef {
  id: string
  name: string
  group: 'Elegant' | 'Retro' | 'Fun'
  color?: string                 // its own default first colour (else the book's trim)
  two?: [label: string, def: string] // a second colour, if it has one
  lines?: Line[]                 // rules running all the way round, `o` in from the edge
  join?: 'square' | 'round' | 'none'
  corner?: (c: string, d: string) => string // more in the top-left corner (0–40)
  motif?: (c: string, d: string) => string  // more in one stretch of the top edge (x 40–80)
}

const n2 = (v: number) => Math.round(v * 100) / 100
const R = 26 // where round corners turn
const star = (x: number, y: number, r: number) => {
  const pts: string[] = []
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, k = i % 2 ? r * 0.45 : r
    pts.push(`${n2(x + k * Math.cos(a))},${n2(y + k * Math.sin(a))}`)
  }
  return `<polygon points='${pts.join(' ')}' fill='COLOR'/>`
}
const at = (xs: number[], f: (x: number) => string) => xs.map(f).join('')

export const PAGE_FRAMES: FrameDef[] = [
  // ── Elegant ──
  { id: 'double', name: 'Double rule', group: 'Elegant', lines: [{ o: 7, w: 2 }, { o: 12, w: 0.8 }], join: 'square',
    corner: (c) => `<rect x='14' y='14' width='4' height='4' fill='${c}' transform='rotate(45 16 16)'/>` },
  { id: 'filigree', name: 'Filigree', group: 'Elegant', lines: [{ o: 5, w: 1.4 }], join: 'square',
    corner: (c) => `<path d='M9 9 C20 9 22 13 22 19 C22 24 18 25 15.5 22.5 C13 20 15.5 16 18.5 17.5 M9 9 C9 20 13 22 19 22' fill='none' stroke='${c}' stroke-width='1'/><circle cx='9' cy='9' r='1.8' fill='${c}'/>`,
    motif: (c) => `<path d='M60 6 L63 10 L60 14 L57 10 Z' fill='${c}'/>` },
  { id: 'nouveau', name: 'Art Nouveau', group: 'Elegant', lines: [{ o: 9, w: 1 }], join: 'none',
    corner: (c) => `<path d='M9 40 C9 24 14 13 28 9 L40 9 M4 36 C6 18 15 7 34 4' fill='none' stroke='${c}' stroke-width='1'/><circle cx='16' cy='16' r='2.4' fill='none' stroke='${c}' stroke-width='0.9'/><circle cx='16' cy='16' r='0.9' fill='${c}'/>` },
  { id: 'baroque', name: 'Baroque beads', group: 'Elegant', lines: [{ o: 4, w: 1 }, { o: 18, w: 1 }], join: 'square',
    corner: (c) => `<circle cx='11' cy='11' r='3.6' fill='${c}'/><circle cx='11' cy='11' r='6.4' fill='none' stroke='${c}' stroke-width='0.8'/>`,
    motif: (c) => at([45, 55, 65, 75], (x) => `<circle cx='${x}' cy='11' r='2.2' fill='${c}'/>`) },
  { id: 'pearls', name: 'Pearls', group: 'Elegant', color: '#efe6d6',
    corner: (c) => at([10, 22, 34], (x) => `<circle cx='${x}' cy='10' r='3.6' fill='${c}'/><circle cx='${x - 1.1}' cy='8.9' r='1.1' fill='#fff' opacity='0.75'/>`)
      + at([22, 34], (y) => `<circle cx='10' cy='${y}' r='3.6' fill='${c}'/><circle cx='8.9' cy='${y - 1.1}' r='1.1' fill='#fff' opacity='0.75'/>`),
    motif: (c) => at([45, 55, 65, 75], (x) => `<circle cx='${x}' cy='10' r='3.6' fill='${c}'/><circle cx='${x - 1.1}' cy='8.9' r='1.1' fill='#fff' opacity='0.75'/>`) },
  { id: 'greekkey', name: 'Greek key', group: 'Elegant',
    corner: (c) => `<path d='M22 40 V22 H40' fill='none' stroke='${c}' stroke-width='1.6'/><rect x='5' y='5' width='13' height='13' fill='none' stroke='${c}' stroke-width='1.6'/><rect x='9.5' y='9.5' width='4' height='4' fill='${c}'/>`,
    motif: (c) => at([40, 60], (x) => `<path d='M${x} 22 H${x + 20} M${x + 2} 22 V4 H${x + 18} V16 H${x + 8} V10 H${x + 13}' fill='none' stroke='${c}' stroke-width='1.6' stroke-linecap='square'/>`) },
  { id: 'laurel', name: 'Laurel', group: 'Elegant', two: ['Berries', '#c0392b'], lines: [{ o: 14, w: 0.9 }], join: 'round',
    corner: (_c, d) => `<circle cx='19' cy='19' r='2.2' fill='${d}'/><circle cx='23.5' cy='16' r='1.5' fill='${d}'/>`,
    motif: (c) => at([44, 52, 60, 68, 76], (x) => `<ellipse cx='${x}' cy='10.5' rx='3.6' ry='1.4' fill='${c}' transform='rotate(-30 ${x} 10.5)'/><ellipse cx='${x + 4}' cy='17.5' rx='3.6' ry='1.4' fill='${c}' transform='rotate(30 ${x + 4} 17.5)'/>`) },
  { id: 'rope', name: 'Twisted rope', group: 'Elegant', lines: [{ o: 5, w: 0.8 }, { o: 15, w: 0.8 }], join: 'square',
    corner: (c) => `<circle cx='10' cy='10' r='4.2' fill='${c}'/>`,
    motif: (c) => at([40, 45, 50, 55, 60, 65, 70, 75], (x) => `<path d='M${x} 15 L${x + 5} 5' stroke='${c}' stroke-width='1.6' stroke-linecap='round'/>`) },
  // ── Retro ──
  { id: 'deco', name: 'Art Deco', group: 'Retro', lines: [{ o: 3, w: 1.6 }, { o: 8, w: 0.8 }, { o: 12, w: 0.8 }], join: 'square',
    corner: (c) => `<path d='M3 12 A9 9 0 0 0 12 3 L3 3 Z' fill='${c}'/>` + at([16, 22, 28], (r) => `<path d='M${3 + r} 3 A${r} ${r} 0 0 1 3 ${3 + r}' fill='none' stroke='${c}' stroke-width='0.8'/>`),
    motif: (c) => `<path d='M52 12 L60 20 L68 12' fill='none' stroke='${c}' stroke-width='1'/><path d='M56 12 L60 16 L64 12' fill='none' stroke='${c}' stroke-width='0.8'/>` },
  { id: 'seventies', name: '70s bands', group: 'Retro', color: '#e8a13c', two: ['Middle band', '#a8452a'], lines: [{ o: 5, w: 3.4 }, { o: 10, w: 3.4, col: 'd' }, { o: 15, w: 3.4 }], join: 'round' },
  { id: 'scallop', name: 'Scallops', group: 'Retro', lines: [{ o: 4, w: 1 }], join: 'square',
    corner: (c) => `<path d='M4 4 V22 A18 18 0 0 0 22 4 Z' fill='${c}' fill-opacity='0.3' stroke='${c}' stroke-width='1.1'/>`,
    motif: (c) => `<path d='M40 4 A5 6 0 0 0 50 4 A5 6 0 0 0 60 4 A5 6 0 0 0 70 4 A5 6 0 0 0 80 4' fill='${c}' fill-opacity='0.3' stroke='${c}' stroke-width='1.1'/>` + at([45, 55, 65, 75], (x) => `<circle cx='${x}' cy='14' r='1' fill='${c}'/>`) },
  { id: 'rickrack', name: 'Rickrack', group: 'Retro',
    corner: (c) => `<path d='M10 4 L16 10 L10 16 L4 10 Z' fill='${c}'/>`,
    motif: (c) => `<polyline points='40,6 45,14 50,6 55,14 60,6 65,14 70,6 75,14 80,6' fill='none' stroke='${c}' stroke-width='1.8' stroke-linejoin='round'/>` },
  { id: 'film', name: 'Film strip', group: 'Retro', color: '#efe6d6', two: ['Film', '#1b1714'],
    corner: (c, d) => `<path d='M2 2 H40 V22 H22 V40 H2 Z' fill='${d}'/><rect x='8' y='8' width='7' height='7' rx='1' fill='${c}'/>`,
    motif: (c, d) => `<rect x='40' y='2' width='40' height='20' fill='${d}'/>` + at([43, 53, 63, 73], (x) => `<rect x='${x}' y='8.5' width='5' height='7' rx='1' fill='${c}'/>`) },
  { id: 'pixel', name: '8-bit', group: 'Retro', lines: [{ o: 13, w: 2 }], join: 'square',
    corner: (c) => [[4, 4], [8, 4], [4, 8], [12, 8], [8, 12], [16, 4], [4, 16]].map(([x, y]) => `<rect x='${x}' y='${y}' width='4' height='4' fill='${c}'/>`).join(''),
    motif: (c) => at([40, 48, 56, 64, 72], (x) => `<rect x='${x}' y='4' width='4' height='4' fill='${c}'/>`) + at([44, 52, 60, 68, 76], (x) => `<rect x='${x}' y='8' width='4' height='4' fill='${c}'/>`) },
  { id: 'neon', name: 'Neon tube', group: 'Retro', color: '#ff6fd8', lines: [{ o: 10, w: 8, op: 0.12 }, { o: 10, w: 4, op: 0.3 }, { o: 10, w: 1.4 }], join: 'round' },
  // ── Fun ──
  { id: 'stitches', name: 'Stitches', group: 'Fun', lines: [{ o: 8, w: 1.5, dash: '5 3' }], join: 'square' },
  { id: 'stars', name: 'Stars', group: 'Fun', lines: [{ o: 3, w: 0.8 }], join: 'square',
    corner: (c) => star(14, 14, 7).replace('COLOR', c),
    motif: (c) => (star(50, 13, 4.5) + star(70, 13, 4.5)).replace(/COLOR/g, c) },
  { id: 'hearts', name: 'Hearts', group: 'Fun', color: '#f5a3c7', lines: [{ o: 3, w: 1, dash: '1 3' }], join: 'square',
    corner: (c) => `<path d='${SUITS.heart(14, 14, 7)}' fill='${c}'/>`,
    motif: (c) => `<path d='${SUITS.heart(50, 12, 4.5)}${SUITS.heart(70, 12, 4.5)}' fill='${c}'/>` },
  { id: 'suits', name: 'Card suits', group: 'Fun', two: ['Red suits', '#e05252'], lines: [{ o: 3, w: 0.8 }], join: 'square',
    corner: (c, d) => `<path d='${SUITS.club(12, 12, 5)}' fill='${c}'/><path d='${SUITS.diamond(24, 24, 4)}' fill='${d}'/>`,
    motif: (c, d) => `<path d='${SUITS.spade(50, 12, 4.5)}' fill='${c}'/><path d='${SUITS.heart(70, 12, 4.5)}' fill='${d}'/>` },
  { id: 'bulbs', name: 'Marquee lights', group: 'Fun', two: ['Bulbs', '#ffe08a'], lines: [{ o: 4, w: 0.8 }, { o: 16, w: 0.8 }], join: 'square',
    corner: (_c, d) => `<circle cx='10' cy='10' r='4.6' fill='${d}' opacity='0.3'/><circle cx='10' cy='10' r='2.4' fill='${d}'/>`,
    motif: (_c, d) => at([45, 55, 65, 75], (x) => `<circle cx='${x}' cy='10' r='4.6' fill='${d}' opacity='0.3'/><circle cx='${x}' cy='10' r='2.4' fill='${d}'/>`) },
]

export const pageFrameOf = (id?: string) => PAGE_FRAMES.find((f) => f.id === id)

/** The border as one nine-slice SVG */
export function frameSvg(def: FrameDef, c: string, d: string): string {
  let top = '', corner = ''
  for (const l of def.lines ?? []) {
    const stroke = `fill='none' stroke='${l.col === 'd' ? d : c}' stroke-width='${l.w}'${l.dash ? ` stroke-dasharray='${l.dash}'` : ''}${l.op ? ` stroke-opacity='${l.op}'` : ''}`
    top += `<path d='M40 ${l.o} H80' ${stroke}/>`
    if (def.join === 'round') corner += `<path d='M${l.o} 40 V${R} A${R - l.o} ${R - l.o} 0 0 1 ${R} ${l.o} H40' ${stroke}/>`
    else if (def.join === 'square') corner += `<path d='M${l.o} 40 V${l.o} H40' ${stroke}/>`
  }
  top += def.motif?.(c, d) ?? ''
  corner += def.corner?.(c, d) ?? ''
  const side = (a: number) => `<g transform='rotate(${a} 60 60)'>${top}${corner}</g>`
  return `<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120' viewBox='0 0 120 120'>${side(0)}${side(90)}${side(180)}${side(270)}</svg>`
}

export interface FrameLook { frameStyle?: string; frameColor?: string; frameColor2?: string; frameWidth?: number }
export const FRAME_W = 18 // px, unless changed

/** The border as CSS (url(...) for border-image), or null for the classic frame */
export function frameCss(look: FrameLook, trim: string, only?: string): string | null {
  const def = pageFrameOf(only ?? look.frameStyle)
  if (!def) return null
  const svg = frameSvg(def, look.frameColor ?? def.color ?? trim, look.frameColor2 ?? def.two?.[1] ?? trim)
  return `url("data:image/svg+xml,${encodeURIComponent(svg).replace(/'/g, '%27')}")`
}
