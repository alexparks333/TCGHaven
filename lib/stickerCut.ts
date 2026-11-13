// Creator Wall stickers (docs/creators.md "Creator Wall"): a photo turned into a die-cut sticker in the browser —
// cut out from a plain background (or kept along its own see-through edges), or cut to a shape — then given a
// white sticker border. Nothing leaves the device until the finished PNG is uploaded.
//
// "Cut out" is a flood fill from the picture's edges: everything joined to the border that's close to the
// background's colour goes, so it suits a subject on a plain backdrop (product shots, badge art on white);
// a busy photo should use a shape instead.

import { badgeAsset } from './badgeAssets'

// Every shape is one SVG outline in its own box (w × h) — the same path cuts the photo (canvas Path2D) and draws
// its button in the editor, so what you pick is what you get.
const r2 = (n: number) => Math.round(n * 10) / 10
function polar(n: number, r: (t: number) => number, c = 50) {
  const pts = Array.from({ length: n }, (_, i) => { const t = (i / n) * Math.PI * 2 - Math.PI / 2, k = r(t); return `${r2(c + Math.cos(t) * k)} ${r2(c + Math.sin(t) * k)}` })
  return `M${pts.join('L')}Z`
}
const star = (points: number, inner: number, wobble = 0) =>
  polar(points * 2, (t) => ((Math.round(((t + Math.PI / 2) / (Math.PI * 2)) * points * 2) % 2) ? 50 * inner : 50) * (1 + wobble * Math.sin(t * 7)))
function stamp(w: number, h: number, bite = 4.2) {
  // a postage stamp's perforated edge: little half-circle bites all round
  const side = (x0: number, y0: number, x1: number, y1: number) => {
    const len = Math.hypot(x1 - x0, y1 - y0), n = Math.max(2, Math.round(len / (bite * 2.6))), dx = (x1 - x0) / n, dy = (y1 - y0) / n
    const ux = (x1 - x0) / len, uy = (y1 - y0) / len // along the edge
    let d = ''
    for (let i = 0; i < n; i++) {
      const sx = x0 + dx * (i + 0.5) - ux * bite, sy = y0 + dy * (i + 0.5) - uy * bite
      d += `L${r2(sx)} ${r2(sy)}A${r2(bite)} ${r2(bite)} 0 0 0 ${r2(sx + ux * bite * 2)} ${r2(sy + uy * bite * 2)}`
    }
    return d + `L${x1} ${y1}`
  }
  return `M0 0${side(0, 0, w, 0)}${side(w, 0, w, h)}${side(w, h, 0, h)}${side(0, h, 0, 0)}Z`
}

export type StickerShape = typeof STICKER_SHAPES[number]['id']
export const STICKER_SHAPES = [
  { id: 'cutout', name: 'Cut out', w: 100, h: 100, d: '' },
  { id: 'circle', name: 'Circle', w: 100, h: 100, d: 'M0 50a50 50 0 1 0 100 0a50 50 0 1 0 -100 0Z' },
  { id: 'heart', name: 'Heart', w: 100, h: 100, d: 'M50 94C12 68 -3 38 13 17C27 0 46 5 50 22C54 5 73 0 87 17C103 38 88 68 50 94Z' },
  { id: 'star', name: 'Star', w: 100, h: 100, d: star(5, 0.47) },
  { id: 'scallop', name: 'Seal', w: 100, h: 100, d: polar(180, (t) => 45 + 5 * Math.cos(t * 16)) },
  { id: 'rounded', name: 'Rounded', w: 100, h: 100, d: 'M18 0H82A18 18 0 0 1 100 18V82A18 18 0 0 1 82 100H18A18 18 0 0 1 0 82V18A18 18 0 0 1 18 0Z' },
  { id: 'card', name: 'Trading card', w: 63, h: 88, d: 'M5 0H58A5 5 0 0 1 63 5V83A5 5 0 0 1 58 88H5A5 5 0 0 1 0 83V5A5 5 0 0 1 5 0Z' },
  { id: 'stamp', name: 'Stamp', w: 84, h: 100, d: stamp(84, 100) },
  { id: 'ticket', name: 'Ticket', w: 100, h: 56, d: 'M6 0H94A6 6 0 0 0 100 6V20A8 8 0 0 0 100 36V50A6 6 0 0 0 94 56H6A6 6 0 0 0 0 50V36A8 8 0 0 0 0 20V6A6 6 0 0 0 6 0Z' },
  { id: 'burst', name: 'Burst', w: 100, h: 100, d: star(12, 0.7, 0.06) },
  { id: 'cloud', name: 'Cloud', w: 100, h: 72, d: 'M22 70A20 20 0 0 1 18 31A22 22 0 0 1 52 14A24 24 0 0 1 90 32A19 19 0 0 1 80 70Z' },
  { id: 'speech', name: 'Speech', w: 100, h: 92, d: 'M14 2H86A12 12 0 0 1 98 14V58A12 12 0 0 1 86 70H46L22 90L28 70H14A12 12 0 0 1 2 58V14A12 12 0 0 1 14 2Z' },
  { id: 'bolt', name: 'Bolt', w: 76, h: 100, d: 'M48 0L4 58H34L22 100L74 36H44L58 0Z' },
  { id: 'flower', name: 'Flower', w: 100, h: 100, d: polar(240, (t) => 27 + 23 * Math.pow(Math.abs(Math.cos(t * 3)), 0.55)) },
  { id: 'gem', name: 'Gem', w: 100, h: 90, d: 'M22 2H78L98 30L50 88L2 30Z' },
  { id: 'shield', name: 'Shield', w: 88, h: 100, d: 'M44 1L86 14V44C86 70 68 89 44 99C20 89 2 70 2 44V14Z' },
  { id: 'arch', name: 'Arch', w: 78, h: 100, d: 'M0 100V39A39 39 0 0 1 78 39V100Z' },
  { id: 'hexagon', name: 'Hexagon', w: 100, h: 100, d: polar(6, () => 50) },
  { id: 'splat', name: 'Splat', w: 100, h: 100, d: polar(220, (t) => 37 + 4 * Math.sin(t * 5 + 1) + 3 * Math.sin(t * 9) + 8 * Math.pow(Math.max(0, Math.sin(t * 7 + 0.4)), 14) + 6 * Math.pow(Math.max(0, Math.sin(t * 4 - 0.8)), 18)) },
] as const
export const stickerShapeOf = (id?: string) => STICKER_SHAPES.find((x) => x.id === id) ?? STICKER_SHAPES[0]
const MAX = 720

// the photo, loaded once per session (re-cutting while the owner drags it inside the shape must be quick)
const loaded = new Map<string, Promise<HTMLImageElement>>()
function load(src: string): Promise<HTMLImageElement> {
  if (!loaded.has(src)) loaded.set(src, loadImage(src).catch((e) => { loaded.delete(src); throw e }))
  return loaded.get(src)!
}
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => res(img); img.onerror = () => rej(new Error('picture'))
    img.src = src.startsWith('blob:') || src.startsWith('data:') ? src : badgeAsset(src)!
  })
}
const canvas = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c }

/** The finished sticker as a PNG. tolerance: how far from the background colour still counts as background (Cut out). */
/** Where the photo sits inside a shape: x / y from -1 to 1 across as far as it can move each way, z its zoom (1 = just fills) */
export interface StickerPan { x: number; y: number; z: number }
const offset = (pan: StickerPan | undefined, over: number, axis: 'x' | 'y') => Math.max(-1, Math.min(1, pan?.[axis] ?? 0)) * Math.max(0, over) / 2

export async function makeSticker(src: string, shape: StickerShape | string, border: 0 | 1 | 2, tolerance = 42, pan?: StickerPan): Promise<Blob> {
  const zoom = Math.max(1, Math.min(4, pan?.z ?? 1))
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
  } else if (shape === 'stamp') {
    // a postage stamp: the photo on a white paper whose edge is perforated all round (the perforations are the
    // paper's own edge, so it skips the smoothed sticker border)
    const f = Math.min(w / 84, h / 100), pw = 84 * f, ph = 100 * f, pad = Math.round(Math.max(pw, ph) * 0.09)
    const out = canvas(pw + pad * 2, ph + pad * 2), g = out.getContext('2d')!
    g.fillStyle = '#fbfaf5'; g.fill(new Path2D(stamp(out.width, out.height, Math.max(out.width, out.height) * 0.024)))
    g.save(); g.beginPath(); g.rect(pad, pad, pw, ph); g.clip()
    const zw = w * zoom, zh = h * zoom
    g.drawImage(img, pad + (pw - zw) / 2 + offset(pan, zw - pw, 'x'), pad + (ph - zh) / 2 + offset(pan, zh - ph, 'y'), zw, zh)
    g.restore()
    return toBlob(out)
  } else {
    // the shape at its own proportions, as big as the photo allows; the photo fills it, centred
    const def = stickerShapeOf(shape)
    const f = Math.min(w / def.w, h / def.h), cw = def.w * f, ch = def.h * f
    cut = canvas(cw, ch)
    const g = cut.getContext('2d')!
    g.save(); g.scale(cw / def.w, ch / def.h); g.clip(new Path2D(def.d)); g.setTransform(1, 0, 0, 1, 0, 0)
    const zw = w * zoom, zh = h * zoom // the owner's zoom, then their move (kept so the photo always fills the shape)
    g.drawImage(img, (cw - zw) / 2 + offset(pan, zw - cw, 'x'), (ch - zh) / 2 + offset(pan, zh - ch, 'y'), zw, zh)
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

const toBlob = (c: HTMLCanvasElement) => new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('png'))), 'image/png'))
