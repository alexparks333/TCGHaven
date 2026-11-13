// Creator Wall stickers (docs/creators.md "Creator Wall"): a photo turned into a die-cut sticker in the browser —
// cut out from a plain background (or kept along its own see-through edges), or cut to a shape — then given a
// white sticker border. Nothing leaves the device until the finished PNG is uploaded.
//
// "Cut out" is a flood fill from the picture's edges: everything joined to the border that's close to the
// background's colour goes, so it suits a subject on a plain backdrop (product shots, badge art on white);
// a busy photo should use a shape instead.

import { badgeAsset } from './badgeAssets'

export type StickerShape = 'cutout' | 'circle' | 'heart' | 'star' | 'scallop' | 'rounded'
export const STICKER_SHAPES: Array<{ id: StickerShape; name: string }> = [
  { id: 'cutout', name: 'Cut out' }, { id: 'circle', name: 'Circle' }, { id: 'heart', name: 'Heart' },
  { id: 'star', name: 'Star' }, { id: 'scallop', name: 'Seal' }, { id: 'rounded', name: 'Rounded' },
]
const MAX = 720

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => res(img); img.onerror = () => rej(new Error('picture'))
    img.src = src.startsWith('blob:') || src.startsWith('data:') ? src : badgeAsset(src)!
  })
}
const canvas = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c }

/** The finished sticker as a PNG. tolerance: how far from the background colour still counts as background (Cut out). */
export async function makeSticker(src: string, shape: StickerShape, border: 0 | 1 | 2, tolerance = 42): Promise<Blob> {
  const img = await load(src)
  const k = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight))
  const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k)
  let cut: HTMLCanvasElement
  if (shape === 'cutout') {
    cut = canvas(w, h)
    const g = cut.getContext('2d', { willReadFrequently: true })!
    g.drawImage(img, 0, 0, w, h)
    removeBackground(g, w, h, tolerance)
    cut = trim(cut)
  } else {
    const side = Math.min(w, h)
    cut = canvas(side, side)
    const g = cut.getContext('2d')!
    g.save(); shapePath(g, shape, side); g.clip()
    g.drawImage(img, (side - w) / 2, (side - h) / 2, w, h) // centred, filling the shape
    g.restore()
  }
  return toBlob(withBorder(cut, [0, 12, 24][border]))
}

// ── the cut ──────────────────────────────────────────────────────────────────────────────────────────

function removeBackground(g: CanvasRenderingContext2D, w: number, h: number, tol: number) {
  const im = g.getImageData(0, 0, w, h), d = im.data
  const border: number[] = []
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x)
  for (let y = 0; y < h; y++) border.push(y * w, y * w + w - 1)
  // already see-through round the edge (a PNG with its own cut): keep its own outline
  if (border.filter((i) => d[i * 4 + 3] < 200).length > border.length * 0.3) { g.putImageData(im, 0, 0); return }
  // the background: the commonest colour along the border (coarse buckets)
  const counts = new Map<number, { n: number; r: number; g: number; b: number }>()
  for (const i of border) {
    const r = d[i * 4], gg = d[i * 4 + 1], b = d[i * 4 + 2], key = (r >> 4) << 8 | (gg >> 4) << 4 | (b >> 4)
    const c = counts.get(key) ?? { n: 0, r: 0, g: 0, b: 0 }; c.n++; c.r += r; c.g += gg; c.b += b; counts.set(key, c)
  }
  const top = Array.from(counts.values()).sort((a, b) => b.n - a.n)[0]
  const br = top.r / top.n, bg = top.g / top.n, bb = top.b / top.n
  const dist = (i: number) => Math.hypot(d[i * 4] - br, d[i * 4 + 1] - bg, d[i * 4 + 2] - bb)
  // flood from the border through everything close to it
  const gone = new Uint8Array(w * h), stack: number[] = []
  for (const i of border) if (!gone[i] && dist(i) <= tol) { gone[i] = 1; stack.push(i) }
  while (stack.length) {
    const i = stack.pop()!, x = i % w, y = (i - x) / w
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
      if (j >= 0 && !gone[j] && dist(j) <= tol) { gone[j] = 1; stack.push(j) }
    }
  }
  for (let i = 0; i < w * h; i++) {
    if (gone[i]) { d[i * 4 + 3] = 0; continue }
    // soften the edge: a kept pixel beside the cut, still near the background colour, fades a little
    const x = i % w
    if ((x > 0 && gone[i - 1]) || (x < w - 1 && gone[i + 1]) || gone[i - w] || gone[i + w]) {
      d[i * 4 + 3] = Math.round(d[i * 4 + 3] * Math.min(1, Math.max(0.35, (dist(i) - tol) / tol)))
    }
  }
  g.putImageData(im, 0, 0)
}

/** Cropped to what's left (plus a hair) */
function trim(c: HTMLCanvasElement) {
  const g = c.getContext('2d', { willReadFrequently: true })!, { width: w, height: h } = c
  const d = g.getImageData(0, 0, w, h).data
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 16) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  if (x1 < 0) return c // nothing left — keep it whole rather than an empty sticker
  const out = canvas(x1 - x0 + 1, y1 - y0 + 1)
  out.getContext('2d')!.drawImage(c, -x0, -y0)
  return out
}

/** The sticker's white border: the shape grown outward by `px` (stamped round a circle), the picture on top */
function withBorder(c: HTMLCanvasElement, px: number) {
  const out = canvas(c.width + px * 2 + 4, c.height + px * 2 + 4), g = out.getContext('2d')!
  if (px > 0) {
    // the border follows the solid part only — faint wisps at the edge would leave white flecks
    const m = canvas(c.width, c.height), mg = m.getContext('2d', { willReadFrequently: true })!
    mg.drawImage(c, 0, 0)
    const im = mg.getImageData(0, 0, m.width, m.height), d = im.data
    for (let i = 3; i < d.length; i += 4) d[i] = d[i] >= 90 ? 255 : 0
    mg.putImageData(im, 0, 0)
    const sil = canvas(out.width, out.height), s = sil.getContext('2d')!
    for (let a = 0; a < 32; a++) { const t = (a / 32) * Math.PI * 2; s.drawImage(m, px + 2 + Math.cos(t) * px, px + 2 + Math.sin(t) * px) }
    s.drawImage(m, px + 2, px + 2)
    // smooth it like a die-cut sticker's outline: soften, then cut back to a clean edge (thin stems and leaf tips
    // round off instead of leaving spikes)
    const sm = canvas(out.width, out.height), sg = sm.getContext('2d', { willReadFrequently: true })!
    sg.filter = `blur(${Math.max(2, px * 0.45)}px)`; sg.drawImage(sil, 0, 0); sg.filter = 'none'
    const sd = sg.getImageData(0, 0, sm.width, sm.height), e = sd.data
    for (let i = 0; i < e.length; i += 4) { const a = e[i + 3]; e[i] = e[i + 1] = e[i + 2] = 255; e[i + 3] = a >= 138 ? 255 : a >= 118 ? (a - 118) * 12 : 0 }
    sg.putImageData(sd, 0, 0)
    g.drawImage(sm, 0, 0)
  }
  g.drawImage(c, px + 2, px + 2)
  return out
}

function shapePath(g: CanvasRenderingContext2D, shape: StickerShape, s: number) {
  const c = s / 2
  g.beginPath()
  if (shape === 'circle') g.arc(c, c, c, 0, Math.PI * 2)
  if (shape === 'rounded') g.roundRect(0, 0, s, s, s * 0.18)
  if (shape === 'star') {
    for (let i = 0; i < 10; i++) { const r = i % 2 ? c * 0.48 : c, t = -Math.PI / 2 + (i * Math.PI) / 5; g.lineTo(c + Math.cos(t) * r, c + Math.sin(t) * r * 1.02 + s * 0.04) }
    g.closePath()
  }
  if (shape === 'scallop') {
    const n = 16
    for (let i = 0; i <= 360; i++) { const t = (i / 360) * Math.PI * 2, r = c * (0.9 + 0.1 * Math.cos(t * n)); g.lineTo(c + Math.cos(t) * r, c + Math.sin(t) * r) }
    g.closePath()
  }
  if (shape === 'heart') {
    g.moveTo(c, s * 0.92)
    g.bezierCurveTo(s * 0.12, s * 0.58, -s * 0.02, s * 0.3, s * 0.2, s * 0.13)
    g.bezierCurveTo(s * 0.36, 0, c, s * 0.06, c, s * 0.24)
    g.bezierCurveTo(c, s * 0.06, s * 0.64, 0, s * 0.8, s * 0.13)
    g.bezierCurveTo(s * 1.02, s * 0.3, s * 0.88, s * 0.58, c, s * 0.92)
    g.closePath()
  }
}

const toBlob = (c: HTMLCanvasElement) => new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('png'))), 'image/png'))
