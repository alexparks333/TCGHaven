// The Relief Studio's maths: a HavenRelief kit (the AI's raw results — tools/havenrelief) plus the
// staff member's settings → the pin's height map. Runs in the browser on every slider move, so
// it's plain array work; the Studio runs it at 1024² while you tweak and at the kit's full 2048²
// when it saves. tools/havenrelief/havenrelief.py's compose() is a simpler version of this (for
// the command line's default pin only).

import { ref, uploadBytes, getDownloadURL, type FirebaseStorage } from 'firebase/storage'

export interface ReliefSettings {
  mode: 'smooth' | 'stepped'
  levels: number        // stepped: how many flat, evenly spaced heights (2–8)
  off: number[]         // stepped: levels switched off (0 = lowest) — their pieces join the nearest level still on
  soften: number        // 0–1: how soft every step edge is
  detail: number        // 0–1: how much fine sculpted detail rides on top
  depth: number         // relief height as a fraction of the pin's width (die-struck ≈ 0.02–0.03)
  wall: number          // 0–1: how steep a slope must be to be drawn as plain gold wall
  // Per piece (id → value). pieces: stepped = whole levels up/down, smooth = tenths of the full
  // height. soft: 0–1, how much that piece's edges are smoothed into their surroundings. flat:
  // 0–1, how far the piece is pressed to one even height (its average) — 1 = perfectly flat.
  pieces: Record<string, number>
  soft: Record<string, number>
  flat: Record<string, number>
  flatDefault: number   // 0–1: Flatten for every piece that doesn't set its own
  // The Material tab: each piece's finish (a FINISHES id; unset = Auto) and that finish's settings
  // (piece id → param key → 0–1; unset = the param's default)
  materials: Record<string, number>
  finishOpts: Record<string, Record<string, number>>
  finishOff: number[]               // layers whose finish is hidden (the eye) — left out when saving too
  names: Record<string, string>     // layer names given in the Studio (unset = "Object 12" / "Area 180")
  // The Lenticular finish's picture sets; each Lenticular layer picks one (finishOpts[id].set)
  lenticularSets: LenticularSet[]
}

export interface LenticularSet {
  name: string
  frames: string[]   // Storage URLs, left to right
  useArt: boolean    // the pin art is picture 1, before frames
}
export const LENTICULAR_MAX_SETS = 8
export const LENTICULAR_MAX_PER_SET = 8
export const LENTICULAR_MAX_TOTAL = 16 // every picture shares one texture; 16 fits on phones too

/** Each set's pictures in order: the pin art first (when the set uses it), then its uploads. */
export const lenticularPictures = (s: ReliefSettings, artUrl: string | undefined): string[][] =>
  s.lenticularSets.map((set) => [...(set.useArt && artUrl ? [artUrl] : []), ...set.frames])

// The finishes a piece can have, by id (the ids are what the finish map's red channel stores —
// never renumber; components/badges/pinRelief.ts's shader reads them). A finish's params (0–1) ride
// in the finish map's green and blue channels, in this order.
// steps: a choice of that many (e.g. 16 seeds) rather than a 0–100% amount; options: a named choice
// (a dropdown), stored as its index
export interface FinishParam { key: string; label: string; def: number; hint?: string; steps?: number; options?: string[] }
export const FOIL_PATTERNS = ['Swirl', 'Perlin', 'Turbulence', 'Cracked Ice', 'Gem Facets', 'Sunburst']
export const FINISHES: { id: number; name: string; hint: string; params: FinishParam[]; soon?: boolean }[] = [
  { id: 0, name: 'Auto', hint: 'Solid gold areas polished metal, the rest enamel — as read from the art', params: [] },
  { id: 1, name: 'Regular', hint: 'Enamel', params: [{ key: 'rough', label: 'Roughness', def: 0.4, hint: 'Glossy ← → satin' }] },
  { id: 2, name: 'Gold', hint: 'Polished metal, tinted by the art', params: [{ key: 'rough', label: 'Roughness', def: 0.25, hint: 'Mirror ← → brushed' }] },
  { id: 3, name: 'Gemstone', hint: 'Coloured glass over the gold — glossy, glowing from within', params: [
    { key: 'glow', label: 'Inner glow', def: 0.4 },
    { key: 'clear', label: 'Transparency', def: 0.6, hint: 'Solid ← → clear glass showing the gold beneath' },
  ] },
  { id: 4, name: 'Holographic', hint: 'Rainbow foil whose bands sweep across as the pin tilts, like a holo sticker', params: [
    { key: 'rough', label: 'Roughness', def: 0.3, hint: 'Smooth, wide bands ← → bands broken up by the sculpted detail' },
    { key: 'strength', label: 'Rainbow', def: 0.6, hint: 'How strongly the rainbow tints the art' },
  ] },
  { id: 5, name: 'Color Fresnel', hint: 'The art as it is straight on; tilt or turn the pin and its colours shift', params: [{ key: 'strength', label: 'Colour shift', def: 0.7, hint: 'How far the colours turn when tilted' }] },
  { id: 6, name: 'Hole', hint: 'Cut right through the pin — relief, body and back', params: [{ key: 'smooth', label: 'Smooth edge', def: 0.4, hint: 'Rounds off the hole’s ragged bits' }] },
  { id: 7, name: 'Lenticular', hint: 'Fades seamlessly through your pictures as the pin turns left and right', params: [
    { key: 'turn', label: 'Turn range', def: 0.5, hint: 'A small turn ← → a big turn to fade through every picture' },
  ] },
  { id: 8, name: 'Pattern Foil', hint: 'Card foil: microscopic ridges that each catch the light as the pin turns', params: [
    { key: 'shine', label: 'Shine', def: 0.6, hint: 'How deep the ridges are — how strongly they catch the light' },
    { key: 'pattern', label: 'Pattern', def: 0, options: FOIL_PATTERNS, hint: 'Which noise steers the ridges' },
    { key: 'noise', label: 'Noise', def: 0.5, hint: 'Straight lines all one way ← → the pattern at full strength' },
    { key: 'seed', label: 'Seed', def: 0, steps: 16, hint: 'A different random layout of the same pattern' },
  ] },
]
export const FINISH_HOLE = 6

export const DEFAULT_RELIEF: ReliefSettings = {
  mode: 'stepped', levels: 4, off: [], soften: 0.06, detail: 0.8, depth: 0.026, wall: 0.35, pieces: {}, soft: {}, flat: {}, flatDefault: 1, materials: {}, finishOpts: {}, finishOff: [], names: {}, lenticularSets: [{ name: 'Set 1', frames: [], useArt: true }],
}

/** Saved settings from an older Studio filled out with today's defaults (one picture list became
 *  "Set 1" when lenticulars got sets). */
export const reliefSettings = (s?: Partial<ReliefSettings> & { lenticularFrames?: string[]; lenticularArt?: boolean }): ReliefSettings => {
  const { lenticularFrames, lenticularArt, ...rest } = s ?? {}
  const out = { ...DEFAULT_RELIEF, ...rest }
  // a relief saved before "Flatten all pieces" existed wasn't flattened — keep it that way
  if (s && rest.flatDefault === undefined) out.flatDefault = 0
  if (!rest.lenticularSets?.length && (lenticularFrames?.length || lenticularArt === false)) {
    out.lenticularSets = [{ name: 'Set 1', frames: lenticularFrames ?? [], useArt: lenticularArt ?? true }]
  }
  return out
}

export interface KitArrays {
  size: number
  alpha: Float32Array   // 0..1 — the pin's cutout
  layers: Float32Array  // 0..1 depth inside the cutout
  detail: Float32Array  // -1..1 fine detail
  pieces: Int32Array    // piece id per pixel, 0 = outside the pin
  pieceCount: number
  objects: number       // ids 1..objects are Segment Anything's objects; the rest are the gaps between them
}

export interface ReliefKit {
  full: KitArrays       // 2048² — what saving bakes from
  preview: KitArrays    // 1024² — what the live preview uses
  art: Blob             // art.webp
  normal: Blob          // normal.png
  files: Record<string, Blob>  // every kit file, for saving the kit with the badge
}

export const KIT_FILES = ['art.webp', 'layers.png', 'detail.png', 'normal.png', 'pieces.png'] as const

// ── Loading a kit ───────────────────────────────────────────────────────────────────────────

async function pixels(blob: Blob): Promise<{ data: Uint8ClampedArray; size: number }> {
  // No colour management or premultiplying: the kit's PNGs carry numbers, not colours
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
  const c = new OffscreenCanvas(bmp.width, bmp.height)
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bmp, 0, 0)
  return { data: ctx.getImageData(0, 0, bmp.width, bmp.height).data, size: bmp.width }
}

/** A kit from its files (as the HavenRelief server returns them, or re-downloaded from Storage). */
export async function loadKit(files: Record<string, Blob>): Promise<ReliefKit> {
  const [art, layers, detail, pieces] = await Promise.all([files['art.webp'], files['layers.png'], files['detail.png'], files['pieces.png']].map(pixels))
  const size = layers.size, n = size * size
  const full: KitArrays = { size, alpha: new Float32Array(n), layers: new Float32Array(n), detail: new Float32Array(n), pieces: new Int32Array(n), pieceCount: 0, objects: 0 }
  for (let i = 0; i < n; i++) {
    const o = i * 4
    full.alpha[i] = art.data[o + 3] / 255
    full.layers[i] = (layers.data[o] * 256 + layers.data[o + 1]) / 65535   // 16 bits in R (high) + G (low)
    full.detail[i] = ((detail.data[o] * 256 + detail.data[o + 1]) / 65535) * 2 - 1
    const p = full.alpha[i] >= 0.5 ? pieces.data[o] + pieces.data[o + 1] * 256 + pieces.data[o + 2] * 65536 : 0
    full.pieces[i] = p
    if (p > full.pieceCount) full.pieceCount = p
  }
  full.objects = full.pieceCount
  splitGaps(full)
  return { full, preview: half(full), art: files['art.webp'], normal: files['normal.png'], files }
}

// The areas no Segment Anything object covers (often the frame and the backdrop behind it joined
// together) become pieces too, so every part of the pin can be selected, moved or smoothed: split
// into connected areas of one depth band (8 bands), specks folded into a neighbour.
export function splitGaps(k: KitArrays) {
  const { size, pieces, alpha } = k
  const n = size * size
  const d4 = blur(k.layers, size, 4 * (size / 2048))
  const band = new Int8Array(n).fill(-1)
  for (let i = 0; i < n; i++) if (!pieces[i] && alpha[i] >= 0.5) band[i] = Math.min(7, (d4[i] * 8) | 0)
  // connected areas of one band (union-find, 4-connected)
  const parent = new Int32Array(n).fill(-1)
  const find = (i: number) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i] } return i }
  for (let i = 0; i < n; i++) {
    if (band[i] < 0) continue
    parent[i] = i
    const x = i % size
    if (x > 0 && band[i - 1] === band[i]) parent[find(i)] = find(i - 1)
    if (i >= size && band[i - size] === band[i]) parent[find(i)] = find(i - size)
  }
  const area = new Map<number, number>()
  for (let i = 0; i < n; i++) if (band[i] >= 0) { const r = find(i); area.set(r, (area.get(r) ?? 0) + 1) }
  const minArea = n * 0.0002
  const id = new Map<number, number>()
  let next = k.pieceCount
  for (let i = 0; i < n; i++) {
    if (band[i] < 0) continue
    const r = find(i)
    if ((area.get(r) ?? 0) < minArea) continue // a speck: filled from its neighbours below
    if (!id.has(r)) id.set(r, ++next)
    pieces[i] = id.get(r)!
  }
  // specks take a neighbouring piece's id
  for (let pass = 0, left = true; left && pass < 200; pass++) {
    left = false
    for (let i = 0; i < n; i++) {
      if (pieces[i] || alpha[i] < 0.5) continue
      const x = i % size
      const nb = (x > 0 && pieces[i - 1]) || (x < size - 1 && pieces[i + 1]) || (i >= size && pieces[i - size]) || (i < n - size && pieces[i + size])
      if (nb) pieces[i] = nb
      else left = true
    }
  }
  k.pieceCount = next
}

function half(k: KitArrays): KitArrays {
  const s = k.size >> 1, n = s * s
  const out: KitArrays = { size: s, alpha: new Float32Array(n), layers: new Float32Array(n), detail: new Float32Array(n), pieces: new Int32Array(n), pieceCount: k.pieceCount, objects: k.objects }
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const a = 2 * y * k.size + 2 * x, b = a + k.size, i = y * s + x
    out.alpha[i] = (k.alpha[a] + k.alpha[a + 1] + k.alpha[b] + k.alpha[b + 1]) / 4
    out.layers[i] = (k.layers[a] + k.layers[a + 1] + k.layers[b] + k.layers[b + 1]) / 4
    out.detail[i] = (k.detail[a] + k.detail[a + 1] + k.detail[b] + k.detail[b + 1]) / 4
    out.pieces[i] = out.alpha[i] >= 0.5 ? (k.pieces[a] || k.pieces[a + 1] || k.pieces[b] || k.pieces[b + 1]) : 0
  }
  return out
}

// Kits already opened this session (by their art.webp URL), so the Studio opens instantly
const kitCache = new Map<string, Promise<ReliefKit>>()

/** A saved kit (file name → URL); `fetchUrl` maps a Storage URL to one the browser may read. */
export function openKit(urls: Record<string, string>, fetchUrl: (u: string) => string): Promise<ReliefKit> {
  const key = urls['art.webp']
  let hit = kitCache.get(key)
  if (!hit) {
    hit = Promise.all(KIT_FILES.map(async (name) => {
      if (!urls[name]) throw new Error(`the saved kit is missing ${name}`)
      const r = await fetch(fetchUrl(urls[name]))
      if (!r.ok) throw new Error(`couldn't download ${name}`)
      return [name, await r.blob()] as const
    })).then((pairs) => loadKit(Object.fromEntries(pairs)))
    hit.catch(() => kitCache.delete(key))
    kitCache.set(key, hit)
  }
  return hit
}

/** Uploads a kit's files to Storage under badges/{badgeId}/kit-{time}/; returns name → URL. */
export async function saveKit(storage: FirebaseStorage, badgeId: string, kit: ReliefKit): Promise<Record<string, string>> {
  const stamp = Date.now()
  const urls = await Promise.all(KIT_FILES.map(async (name) => {
    const r = ref(storage, `badges/${badgeId}/kit-${stamp}/${name}`)
    await uploadBytes(r, kit.files[name], { contentType: kit.files[name].type || 'image/png' })
    return getDownloadURL(r)
  }))
  const out = Object.fromEntries(KIT_FILES.map((name, i) => [name, urls[i]]))
  kitCache.set(out['art.webp'], Promise.resolve(kit))
  return out
}

// ── Settings → height ───────────────────────────────────────────────────────────────────────

export interface Composed {
  h: Float32Array          // the pin's height, 0..1 (0 outside the cutout)
  level: Int32Array        // stepped: each piece's final level (0 = lowest), -1 for none
  levelCount: number       // stepped: how many levels are on
  live: number[]           // stepped: the original levels still on, lowest first (final level i = live[i])
  rank: Int32Array         // stepped: each piece's level before any are switched off or moved
  natural: Int32Array      // stepped: each piece's level among the levels still on, before it's moved
  rankArea: Float64Array   // stepped: how much of the pin each original level covers (0..1)
}

/** The pin for these settings. */
export function compose(k: KitArrays, s: ReliefSettings): Composed {
  const { size, alpha, layers, detail, pieces } = k
  const n = size * size, sc = size / 2048
  const P = k.pieceCount + 1
  const level = new Int32Array(P).fill(-1), rank = new Int32Array(P).fill(-1), natural = new Int32Array(P).fill(-1)
  let rankArea = new Float64Array(0), levelCount = 0, liveLevels: number[] = []
  let h: Float32Array = new Float32Array(n)
  if (s.mode === 'stepped' && s.levels >= 2) {
    const L = Math.round(s.levels)
    const { med, area } = pieceStats(k)
    // levels: area-weighted 1-D k-means over the pieces' medians
    const ids = Array.from({ length: P }, (_, p) => p).filter((p) => p > 0 && area[p] > 0)
    const sorted = ids.map((p) => med[p]).sort((a, b) => a - b)
    let c = Array.from({ length: L }, (_, j) => sorted[Math.min(sorted.length - 1, Math.floor(((j + 0.5) / L) * sorted.length))] ?? j / (L - 1))
    const nearest = (v: number) => { let best = 0; for (let j = 1; j < L; j++) if (Math.abs(v - c[j]) < Math.abs(v - c[best])) best = j; return best }
    for (let it = 0; it < 50; it++) {
      const sum = new Float64Array(L), w = new Float64Array(L)
      for (const p of ids) { const j = nearest(med[p]); sum[j] += med[p] * area[p]; w[j] += area[p] }
      c = c.map((v, j) => (w[j] ? sum[j] / w[j] : v))
    }
    const order = new Int32Array(L)
    c.map((v, j) => [v, j] as const).sort((a, b) => a[0] - b[0]).forEach(([, j], r) => { order[j] = r })
    // levels switched off fold into the nearest level still on (the lower one on a tie); the ones
    // left are re-spaced evenly
    const on = Array.from({ length: L }, (_, r) => r).filter((r) => !s.off.includes(r))
    const live = on.length ? on : [0]
    const toLive = (r: number) => live.reduce((best, e, i) => (Math.abs(e - r) < Math.abs(live[best] - r) ? i : best), 0)
    levelCount = live.length
    liveLevels = live
    rankArea = new Float64Array(L)
    let total = 0
    for (const p of ids) {
      rank[p] = order[nearest(med[p])]
      natural[p] = toLive(rank[p])
      level[p] = clamp(natural[p] + Math.round(s.pieces[p] ?? 0), 0, levelCount - 1)
      rankArea[rank[p]] += area[p]
      total += area[p]
    }
    for (let r = 0; r < L; r++) rankArea[r] /= total || 1
    const span = Math.max(1, levelCount - 1)
    for (let i = 0; i < n; i++) if (pieces[i] && level[pieces[i]] >= 0) h[i] = level[pieces[i]] / span
    const sd = s.detail * 0.3
    for (let i = 0; i < n; i++) h[i] = (1 - sd) * h[i] + sd * detail[i]
  } else {
    for (let i = 0; i < n; i++) h[i] = 0.62 * layers[i] + (s.pieces[pieces[i]] ?? 0) * 0.1 + s.detail * 0.6 * detail[i]
  }
  // Flatten first, then smooth the steps between pieces: smoothing before flattening let a flat
  // piece wipe its own smoothed edge out (and with every piece flat, every edge). The steps are
  // each piece's average height (a piecewise-flat field); only that is softened (Soften steps,
  // then each piece's Smooth edges) — the detail within pieces rides on top untouched.
  h = flattenPieces(h, k, s)
  const P1 = k.pieceCount + 1
  const sum = new Float64Array(P1), cnt = new Float64Array(P1)
  for (let i = 0; i < n; i++) { sum[pieces[i]] += h[i]; cnt[pieces[i]]++ }
  let steps: Float32Array = new Float32Array(n)
  for (let i = 0; i < n; i++) steps[i] = cnt[pieces[i]] ? sum[pieces[i]] / cnt[pieces[i]] : 0
  const within = new Float32Array(n)
  for (let i = 0; i < n; i++) within[i] = h[i] - steps[i]
  steps = blur(steps, size, Math.max(0.5, s.soften * 16 * sc))
  steps = softenPieces(steps, k, s)
  for (let i = 0; i < n; i++) h[i] = steps[i] + within[i]
  // 0..1 over the pin
  let lo = Infinity, hi = -Infinity
  for (let i = 0; i < n; i++) if (alpha[i] >= 0.5) { if (h[i] < lo) lo = h[i]; if (h[i] > hi) hi = h[i] }
  const span = Math.max(hi - lo, 1e-6)
  for (let i = 0; i < n; i++) h[i] = alpha[i] >= 0.5 ? clamp((h[i] - lo) / span, 0, 1) : 0
  return { h, level, levelCount, live: liveLevels, rank, natural, rankArea }
}

// A piece's "Smooth edges": its edges eased into whatever is around them — the height blurred
// (wider for more smoothing) and blended in over the piece and a band around it
function softenPieces(h: Float32Array, k: KitArrays, s: ReliefSettings): Float32Array {
  const { size, pieces } = k
  const n = size * size, sc = size / 2048
  for (const [id, amt] of Object.entries(s.soft)) {
    if (!(amt > 0)) continue
    const p = Number(id)
    const r = Math.max(1, amt * 80 * sc)
    const ind = new Float32Array(n)
    for (let i = 0; i < n; i++) if (pieces[i] === p) ind[i] = 1
    const w = blur(ind, size, r)
    const hb = blur(h, size, r)
    // full strength all along the piece's edge (a thin part's blurred mask is weak — smoothing only
    // half-applied there), fading out well outside it
    for (let i = 0; i < n; i++) if (w[i] > 0) { const t = Math.min(1, w[i] * 8); h[i] = h[i] * (1 - t) + hb[i] * t }
  }
  return h
}

// A piece's "Flatten": pressed toward one even height — the average of its own pixels
function flattenPieces(h: Float32Array, k: KitArrays, s: ReliefSettings): Float32Array {
  const flat = new Float32Array(k.pieceCount + 1)
  let any = false
  for (let p = 1; p <= k.pieceCount; p++) {
    const amt = Math.min(1, s.flat[p] ?? s.flatDefault)
    if (amt > 0) { flat[p] = amt; any = true }
  }
  if (!any) return h
  const sum = new Float64Array(k.pieceCount + 1), cnt = new Float64Array(k.pieceCount + 1)
  for (let i = 0; i < h.length; i++) { const p = k.pieces[i]; if (flat[p]) { sum[p] += h[i]; cnt[p]++ } }
  for (let i = 0; i < h.length; i++) {
    const p = k.pieces[i], f = flat[p]
    if (f && cnt[p]) h[i] = h[i] * (1 - f) + (sum[p] / cnt[p]) * f
  }
  return h
}

// What depends only on the kit, worked out once per kit: each piece's median depth (from a 256-bin
// histogram) and area
const statsCache = new WeakMap<KitArrays, { med: Float64Array; area: Float64Array }>()
function pieceStats(k: KitArrays) {
  const hit = statsCache.get(k)
  if (hit) return hit
  const { size, layers, pieces } = k
  const n = size * size
  const d = blur(layers, size, 2 * (size / 2048))
  const P = k.pieceCount + 1
  const hist = new Uint32Array(P * 256), area = new Float64Array(P)
  for (let i = 0; i < n; i++) {
    const p = pieces[i]
    if (!p) continue
    hist[p * 256 + Math.min(255, (d[i] * 256) | 0)]++
    area[p]++
  }
  const med = new Float64Array(P)
  for (let p = 1; p < P; p++) {
    if (!area[p]) continue
    let acc = 0, b = 0
    for (; b < 256; b++) { acc += hist[p * 256 + b]; if (acc >= area[p] / 2) break }
    med[p] = (b + 0.5) / 256
  }
  const stats = { med, area }
  statsCache.set(k, stats)
  return stats
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

/** Separable box blur applied twice (≈ gaussian), any radius ≥ 0.5 px. */
function blur(src: Float32Array, size: number, radius: number): Float32Array {
  const r = Math.max(1, Math.round(radius))
  let a = src
  for (let pass = 0; pass < 2; pass++) {
    const b = new Float32Array(size * size)
    for (let y = 0; y < size; y++) {
      const row = y * size
      let acc = 0
      for (let x = -r; x <= r; x++) acc += a[row + clamp(x, 0, size - 1)]
      for (let x = 0; x < size; x++) {
        b[row + x] = acc / (2 * r + 1)
        acc += a[row + Math.min(size - 1, x + r + 1)] - a[row + Math.max(0, x - r)]
      }
    }
    const c = new Float32Array(size * size)
    for (let x = 0; x < size; x++) {
      let acc = 0
      for (let y = -r; y <= r; y++) acc += b[clamp(y, 0, size - 1) * size + x]
      for (let y = 0; y < size; y++) {
        c[y * size + x] = acc / (2 * r + 1)
        acc += b[Math.min(size - 1, y + r + 1) * size + x] - b[Math.max(0, y - r) * size + x]
      }
    }
    a = c
  }
  return a
}

// ── Finishes ────────────────────────────────────────────────────────────────────────────────

export interface Finishes {
  // RGBA per pixel: R = finish id (0–15) + 16 × coverage (0–15: how much of the finish shows —
  // under 15 where a layer's edge is feathered), G/B = its first/second param (0–255). Coverage rides in R
  // rather than alpha because a PNG's alpha gets premultiplied, which would scramble the ids.
  map: Uint8Array
  holes: Uint8Array | null  // 1 = cut out (holes already smoothed), or null for none
}

/** Each pixel's finish and settings from the pieces' materials, or null when every piece is Auto.
 *  Holes are smoothed here (each by its own "Smooth edge"), so the cut, the body's opening and the
 *  saved map all follow the same rounded shape rather than the piece's ragged edge. */
export function finishMap(k: KitArrays, materials: Record<string, number>, opts: Record<string, Record<string, number>> = {}): Finishes | null {
  const P = k.pieceCount + 1
  const fin = new Uint8Array(P), g = new Uint8Array(P), b = new Uint8Array(P)
  const feather = new Float32Array(P)
  const holeIds: number[] = []
  for (const [id, f] of Object.entries(materials)) {
    const p = Number(id)
    if (!(f > 0) || p > k.pieceCount) continue
    const def = FINISHES.find((x) => x.id === f)
    if (!def || def.soon) continue
    fin[p] = f
    const v = (i: number) => (def.params[i] ? Math.round(255 * (opts[id]?.[def.params[i].key] ?? def.params[i].def)) : 0)
    g[p] = v(0)
    b[p] = f === 7 ? Math.min(LENTICULAR_MAX_SETS - 1, Math.max(0, Math.round(opts[id]?.set ?? 0)))
      : f === 8 ? Math.round(15 * (opts[id]?.noise ?? 0.5)) + 16 * Math.min(15, Math.round(opts[id]?.pattern ?? 0)) // low 4 bits noise, high 4 pattern
      : v(1)
    // the foil's shine (16 steps) and seed (16) share the green channel
    if (f === 8) g[p] = Math.round(15 * (opts[id]?.shine ?? 0.6)) + 16 * Math.round(15 * (opts[id]?.seed ?? 0))
    feather[p] = opts[id]?.feather ?? 0
    if (f === FINISH_HOLE) holeIds.push(p)
  }
  if (!fin.some((f) => f)) return null
  const n = k.size * k.size, sc = k.size / 2048
  let holes: Uint8Array | null = null
  if (holeIds.length) {
    holes = new Uint8Array(n)
    for (const p of holeIds) {
      const ind = new Float32Array(n)
      for (let i = 0; i < n; i++) if (k.pieces[i] === p) ind[i] = 1
      const soft = blur(ind, k.size, Math.max(1, (g[p] / 255) * 40 * sc))
      for (let i = 0; i < n; i++) if (soft[i] >= 0.5 && k.alpha[i] >= 0.5) holes[i] = 1
    }
  }
  // Each pixel takes the finish of the layer that covers it most: a layer's own pixels fully,
  // unless its edges are feathered — then it fades from full inside to nothing outside across its
  // edge (a blurred mask, like feathering a selection), spilling a little onto unfinished neighbours
  const map = new Uint8Array(n * 4)
  const cover = new Float32Array(n)
  const put = (i: number, p: number, c: number) => {
    if (c <= cover[i]) return
    const o = i * 4
    cover[i] = c
    map[o] = fin[p] + 16 * Math.round(c * 15); map[o + 1] = g[p]; map[o + 2] = b[p]
  }
  for (let i = 0; i < n; i++) {
    const p = k.pieces[i]
    if (holes?.[i]) { map[i * 4] = FINISH_HOLE + 16 * 15; cover[i] = 2; continue }
    if (fin[p] && fin[p] !== FINISH_HOLE && !(feather[p] > 0)) put(i, p, 1)
  }
  for (let p = 1; p < P; p++) {
    if (!fin[p] || fin[p] === FINISH_HOLE || !(feather[p] > 0)) continue
    const ind = new Float32Array(n)
    for (let i = 0; i < n; i++) if (k.pieces[i] === p) ind[i] = 1
    const w = blur(ind, k.size, Math.max(1, feather[p] * 28 * sc))
    for (let i = 0; i < n; i++) if (w[i] > 0.02 && k.alpha[i] >= 0.5) put(i, p, Math.min(1, w[i]))
  }
  closeSlivers(k, map, cover)
  return { map, holes }
}

// Where two Segment Anything objects meet there's often a strip a pixel or two wide that belongs
// to a third object underneath (the frame, the figure) — left unfinished, it drew the original art
// as a thin line along the seams. Each finish (same finish and settings) has its narrow gaps closed
// (dilate then erode, ~2px): enclosed slivers take that finish, outer edges don't move.
function closeSlivers(k: KitArrays, map: Uint8Array, cover: Float32Array) {
  const n = k.size * k.size, r = Math.max(1, Math.round(2 * k.size / 2048))
  const keys = new Set<number>()
  for (let i = 0; i < n; i++) if (cover[i] === 1 && map[i * 4] % 16) keys.add(map[i * 4] * 65536 + map[i * 4 + 1] * 256 + map[i * 4 + 2])
  for (const key of Array.from(keys)) {
    const m = new Float32Array(n)
    for (let i = 0; i < n; i++) if (cover[i] === 1 && map[i * 4] * 65536 + map[i * 4 + 1] * 256 + map[i * 4 + 2] === key) m[i] = 1
    const grown = blur(m, k.size, r)
    for (let i = 0; i < n; i++) grown[i] = grown[i] > 0.001 ? 1 : 0
    const closed = blur(grown, k.size, r)
    for (let i = 0; i < n; i++) {
      if (closed[i] < 0.999 || m[i] || cover[i] >= 1 || k.alpha[i] < 0.5) continue
      map[i * 4] = key >> 16; map[i * 4 + 1] = (key >> 8) & 255; map[i * 4 + 2] = key & 255
      cover[i] = 1
    }
  }
}

/** A finish map as the PNG the badge's finishMapUrl holds (R = finish id, G/B = its settings). */
export async function finishPng(f: Uint8Array, size: number): Promise<Blob> {
  const c = new OffscreenCanvas(size, size)
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(size, size)
  for (let i = 0; i < size * size; i++) {
    img.data[i * 4] = f[i * 4]; img.data[i * 4 + 1] = f[i * 4 + 1]; img.data[i * 4 + 2] = f[i * 4 + 2]; img.data[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  return c.convertToBlob({ type: 'image/png' })
}

// ── Saving ──────────────────────────────────────────────────────────────────────────────────

/** A height map as the 8-bit grey PNG the badge's "Depth map" holds (white = high). */
export async function heightPng(h: Float32Array, size: number): Promise<Blob> {
  const c = new OffscreenCanvas(size, size)
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(size, size)
  for (let i = 0; i < size * size; i++) {
    const v = Math.round(h[i] * 255)
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v
    img.data[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  return c.convertToBlob({ type: 'image/png' })
}

// ── The analysis server (tools/havenrelief/server.py — this PC now, a cloud GPU later) ──────

export const RELIEF_SERVER = process.env.NEXT_PUBLIC_HAVENRELIEF_URL || 'http://127.0.0.1:7861'

export async function reliefServerUp(): Promise<boolean> {
  try {
    const r = await fetch(`${RELIEF_SERVER}/health`, { signal: AbortSignal.timeout(2500) })
    return r.ok
  } catch { return false }
}

/** Sends the art to the analysis server; resolves to the kit's files. */
export async function analyzeArt(art: Blob, quality: 'fast' | 'normal' | 'high' = 'high'): Promise<Record<string, Blob>> {
  const r = await fetch(`${RELIEF_SERVER}/analyze?quality=${quality}`, { method: 'POST', body: art })
  const body = await r.json().catch(() => ({ error: `server replied ${r.status}` }))
  if (!r.ok) throw new Error(body.error || `server replied ${r.status}`)
  const files: Record<string, Blob> = {}
  for (const [name, b64] of Object.entries(body.files as Record<string, string>)) {
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    files[name] = new Blob([bytes], { type: name.endsWith('.webp') ? 'image/webp' : 'image/png' })
  }
  return files
}
