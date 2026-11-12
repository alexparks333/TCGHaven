// The open book's outer edge — the rim round the pages (Creator Studio → Inside look → Book edge,
// docs/creators.md): a colour, a texture, how strong the texture is, how wide the rim is and its
// stitching. insideLook() turns it into CSS variables; globals.css `.pinbook-edged` paints the rim
// (BadgeBook's .pinbook-cover, BookPlanner's rim) with them.

export const EDGE_TEXTURES = [
  { id: 'leather', name: 'Leather' },
  { id: 'suede', name: 'Suede' },
  { id: 'linen', name: 'Linen' },
  { id: 'wood', name: 'Wood' },
  { id: 'velvet', name: 'Velvet' },
  { id: 'metal', name: 'Brushed metal' },
  { id: 'carbon', name: 'Carbon fibre' },
  { id: 'marble', name: 'Marble' },
  { id: 'smooth', name: 'Smooth' },
  { id: 'picture', name: 'Cover picture' },
] as const

export const EDGE_COLORS = [
  { name: 'Walnut', color: '#5a3a22' }, { name: 'Oxblood', color: '#5c1a17' }, { name: 'Navy', color: '#1c2a44' },
  { name: 'Forest', color: '#1f3a2a' }, { name: 'Ink', color: '#1b1714' }, { name: 'Saddle', color: '#8a6038' },
  { name: 'Plum', color: '#47203f' }, { name: 'Teal', color: '#1d4a4f' }, { name: 'Ivory', color: '#e8dcc0' }, { name: 'Steel', color: '#7d848c' },
]

export interface EdgeLook {
  edgeTexture?: string  // EDGE_TEXTURES id; unset = the book's usual rim
  edgeColor?: string
  edgeGrain?: number    // texture strength 0–1 (default 0.6)
  edgeWidth?: number    // × the usual rim (0.5–2.5, default 1)
  edgeStitch?: boolean  // default on
  edgeStitchColor?: string
}

const noise = (freq: string, octaves: number, light: boolean, alpha: number) => {
  const v = light ? 1 : 0
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='${freq}' numOctaves='${octaves}' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 ${v} 0 0 0 0 ${v} 0 0 0 0 ${v} 0 0 0 ${alpha.toFixed(3)} 0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg).replace(/'/g, '%27')}")`
}
const marble = (alpha: number) => {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400'><filter id='m'><feTurbulence type='turbulence' baseFrequency='0.006 0.014' numOctaves='4' seed='3'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 ${(-7 * alpha).toFixed(2)} 0 0 0 ${(0.85 * alpha).toFixed(2)}'/></filter><rect width='100%' height='100%' filter='url(#m)'/></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg).replace(/'/g, '%27')}")`
}

/** The rim's background (CSS background-image layers) and the size for each layer */
export function edgeBackground(e: EdgeLook, coverImage?: string): { image: string; size: string } | null {
  if (!e.edgeTexture) return null
  const C = e.edgeColor ?? EDGE_COLORS[0].color
  const g = Math.max(0, Math.min(1, e.edgeGrain ?? 0.6))
  const light = `color-mix(in srgb, ${C} 82%, white)`, dark = `color-mix(in srgb, ${C} 62%, black)`
  const shade = `linear-gradient(150deg, ${light}, ${C} 45%, ${dark})`
  switch (e.edgeTexture) {
    case 'leather': return { image: `${noise('0.55', 3, false, 0.55 * g)}, radial-gradient(130% 90% at 25% 10%, rgba(255,255,255,${0.18 * g}), transparent 55%), ${shade}`, size: 'auto, auto, auto' }
    case 'suede': return { image: `${noise('1.6', 2, true, 0.22 * g)}, ${noise('0.9', 2, false, 0.3 * g)}, ${shade}`, size: 'auto, auto, auto' }
    case 'linen': return { image: `repeating-linear-gradient(0deg, rgba(255,255,255,${0.12 * g}) 0 1px, transparent 1px 3px), repeating-linear-gradient(90deg, rgba(0,0,0,${0.2 * g}) 0 1px, transparent 1px 3px), ${noise('0.8', 2, false, 0.2 * g)}, ${shade}`, size: 'auto, auto, auto, auto' }
    case 'wood': return { image: `${noise('0.012 0.32', 3, false, 0.7 * g)}, ${noise('0.02 0.9', 2, true, 0.12 * g)}, ${shade}`, size: 'auto, auto, auto' }
    case 'velvet': return { image: `radial-gradient(90% 70% at 30% 20%, rgba(255,255,255,${0.28 * g}), transparent 60%), ${noise('1.3', 2, true, 0.1 * g)}, linear-gradient(150deg, ${C}, ${dark})`, size: 'auto, auto, auto' }
    case 'metal': return { image: `repeating-linear-gradient(90deg, rgba(255,255,255,${0.1 * g}) 0 1px, rgba(0,0,0,${0.1 * g}) 1px 2px, transparent 2px 4px), linear-gradient(165deg, ${light}, ${C} 30%, ${dark} 55%, ${light} 80%, ${C})`, size: 'auto, auto' }
    case 'carbon': return { image: `repeating-linear-gradient(45deg, rgba(255,255,255,${0.09 * g}) 0 2px, transparent 2px 6px), repeating-linear-gradient(-45deg, rgba(0,0,0,${0.45 * g}) 0 2px, transparent 2px 6px), linear-gradient(150deg, ${C}, ${dark})`, size: 'auto, auto, auto' }
    case 'marble': return { image: `${marble(g)}, ${noise('0.9', 2, false, 0.12 * g)}, ${shade}`, size: 'cover, auto, auto' }
    case 'picture': return coverImage ? { image: `url("${coverImage}")`, size: '100% 100%' } : { image: shade, size: 'auto' }
    default: return { image: shade, size: 'auto' }
  }
}
