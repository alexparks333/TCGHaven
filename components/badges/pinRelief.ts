import * as THREE from 'three'

// Turns a flat piece of pin art (PNG with transparency — or a picture on a plain white
// background) into a 3D enamel pin, with no hand-made model:
//
//   1. Shape   — the art's outline is traced and extruded into a solid metal body with a bevel.
//   2. Relief  — a height map is estimated from the art (gold filigree and figures stand proud, the
//                painted scene sits recessed, fine detail from local contrast) and a dense grid is
//                displaced by it, so the surface really rises and falls.
//   3. Surface — materials are read from the colours: gold → polished metal, saturated specks →
//                gems (glassy, very glossy), pale cyan → glowing (emissive), the rest → glossy enamel.
//   4. Back    — a brushed back plate in the same outline, ready for the post + clutch.
//
// Everything is computed in the browser from the image (a few hundred ms), so any uploaded art
// gets this treatment automatically.

const N = 1024       // analysis resolution for the height/normal/material maps
const S = N / 512    // blur radii below were tuned at 512 — scale them so the look stays the same
// Relief mesh resolution (GRID × GRID quads): fine on computers, lighter on phones so it stays
// smooth to turn.
const COARSE = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
const GRID = COARSE ? 320 : 560
// A real relief (HavenRelief): read at the art's full resolution and meshed about twice as densely,
// so the sculpted detail holds up side-on, not just head-on
const HN = 2048
const CLEAN_GRID = COARSE ? 640 : 1100
const BODY = 0.035   // metal body thickness
const BEVEL = 0.012
const RELIEF = 0.018 // tallest relief above the body — real pins are shallow (≈⅓ of the body)
const RELIEF_DEPTH = 0.055 // with a real relief map: about bas-relief.ai depth (HavenRelief writes its normal map for this height)

export interface Relief {
  group: THREE.Group
  faceMaterial: THREE.MeshPhysicalMaterial
  backZ: number
  outline: THREE.Shape
}

export async function buildRelief(url: string, maxAnisotropy: number, depthUrl?: string): Promise<Relief> {
  const img = await loadImage(url)
  const depthImg = depthUrl ? await loadImage(depthUrl) : null
  const { rgba } = readPixels(img, N)
  const alpha = alphaOf(rgba)
  const classes = classify(rgba, alpha)
  if (depthUrl) solidifyGold(classes) // a real relief: metal only in solid gold areas, never flecks
  // The mesh only carries the broad shape (raised gold, recessed scene); the fine detail — filigree,
  // fur, lettering — lives in the normal map at the art's full resolution. Putting fine detail in
  // the mesh made it spiky (a grid can't hold detail finer than its own spacing).
  const { macro: guessed, fine } = heightMap(rgba, alpha, classes)
  // A real depth map (made from the art by a depth model, uploaded in the staff portal) gives the
  // true sculpted shape — rounded faces and bodies instead of flat plateaus per colour.
  // A real relief height map (HavenRelief) is used exactly as made — every effect below that
  // guesses shape or detail from the art is skipped for it (they made it look muddy).
  const clean = !!depthImg
  const fineHeight = depthImg ? reliefHeight(depthImg, img) : null // HN×HN, with its own alpha
  const macro = fineHeight ? downsample(fineHeight.h, HN, N) : guessed
  const relief = depthImg ? RELIEF_DEPTH : RELIEF

  // Textures
  const full = document.createElement('canvas')
  const TEX = clean ? 2048 : 1024 // a real relief gets the art at full resolution
  full.width = full.height = TEX
  const fctx = full.getContext('2d')!
  fctx.drawImage(img, 0, 0, TEX, TEX)
  if (!hasTransparency(rgba)) whiteToAlpha(fctx) // a picture on white: cut the background out
  bleedEdgeColour(full)
  if (!clean) delightGold(full, classes) // a real relief keeps the art's own colours
  const colorTex = new THREE.CanvasTexture(full)
  colorTex.colorSpace = THREE.SRGBColorSpace
  colorTex.anisotropy = maxAnisotropy

  // Clean: per-pixel lighting from the relief itself (sharper than the mesh grid can hold), at the
  // strength that matches the mesh's own slopes. Otherwise: invented detail from the art.
  // (A HavenRelief badge also ships its own 2048px normal map, made from the full-precision height,
  // which the viewer swaps in right after — normalMapUrl.)
  const normalTex = toTexture(clean ? normalMap(macro, (relief * N) / 8) : normalMap(fine, 4 * S))
  const ormTex = toTexture(ormMap(classes, rgba, clean))
  const emissiveTex = toTexture(emissiveMap(classes, rgba))
  emissiveTex.colorSpace = THREE.SRGBColorSpace

  const faceMaterial = new THREE.MeshPhysicalMaterial({
    map: colorTex,
    alphaTest: 0.5,
    normalMap: normalTex,
    normalScale: clean ? new THREE.Vector2(1, 1) : new THREE.Vector2(0.8, 0.8),
    roughnessMap: ormTex, metalnessMap: ormTex, roughness: 1, metalness: 1,
    emissiveMap: emissiveTex, emissive: new THREE.Color(0xffffff), emissiveIntensity: clean ? 0.5 : 0.9,
    // A light clear coat only — a heavy one lays untinted glare over the gold and washes it out
    clearcoat: clean ? 0 : 0.18, clearcoatRoughness: 0.2,
    side: THREE.FrontSide,
  })

  const group = new THREE.Group()
  const outline = traceOutline(alpha)
  const gold = new THREE.MeshPhysicalMaterial({ color: 0xd2a44a, metalness: 1, roughness: 0.3, clearcoat: 0.25 })

  // 1. Body
  const bodyGeo = new THREE.ExtrudeGeometry(outline, { depth: BODY, bevelEnabled: true, bevelThickness: BEVEL, bevelSize: 0.006, bevelSegments: 5, curveSegments: 8 })
  group.add(new THREE.Mesh(bodyGeo, gold))
  const front = BODY + BEVEL

  // 2. Relief surface, displaced by the height map
  const grid = fineHeight ? CLEAN_GRID : GRID
  const face = new THREE.PlaneGeometry(1, 1, grid, grid)
  const pos = face.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) + 0.5, v = 0.5 - pos.getY(i)
    const hgt = fineHeight ? sample(fineHeight.h, u, v, HN) : sample(macro, u, v)
    pos.setZ(i, front + 0.0008 + hgt * relief)
  }
  // A real relief is cut cleanly at the pin's outline: triangles outside it are dropped, rather
  // than sloping down to zero (that slope got stretched edge colour — a ragged silver fringe)
  if (fineHeight) {
    const keep: number[] = []
    const idx = face.index!.array
    const inside = (vi: number) => sample(fineHeight.a, pos.getX(vi) + 0.5, 0.5 - pos.getY(vi), HN) > 0.5
    for (let t = 0; t < idx.length; t += 3) if (inside(idx[t]) && inside(idx[t + 1]) && inside(idx[t + 2])) keep.push(idx[t], idx[t + 1], idx[t + 2])
    face.setIndex(keep)
  }
  face.computeVertexNormals()
  const reliefMesh = new THREE.Mesh(face, faceMaterial)
  group.add(reliefMesh)

  // 4. Back plate
  const back = new THREE.Mesh(backPlateGeometry(outline), new THREE.MeshPhysicalMaterial({ map: brushedBack(), metalness: 1, roughness: 0.42, color: 0xd9b25e }))
  back.position.z = -BEVEL - 0.0004
  group.add(back)

  return { group, faceMaterial, backZ: -BEVEL, outline }
}

// ── Reading the art ─────────────────────────────────────────────────────────────────────────

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not load the art'))
    img.src = url
  })
}

function readPixels(img: HTMLImageElement, size: number) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0, size, size)
  const data = ctx.getImageData(0, 0, size, size).data
  if (!hasTransparency(data)) {
    whiteToAlpha(ctx)
    return { rgba: ctx.getImageData(0, 0, size, size).data }
  }
  return { rgba: data }
}

function hasTransparency(rgba: Uint8ClampedArray): boolean {
  for (let i = 3; i < rgba.length; i += 4 * 97) if (rgba[i] < 250) return true
  return false
}

// Background removal for art on white: flood-fill near-white from the borders to transparent.
function whiteToAlpha(ctx: CanvasRenderingContext2D) {
  const { width: w, height: h } = ctx.canvas
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  const isBg = (i: number) => {
    const r = d[i], g = d[i + 1], b = d[i + 2]
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
    return mn > 225 && mx - mn < 22
  }
  const seen = new Uint8Array(w * h)
  const stack: number[] = []
  for (let x = 0; x < w; x++) { stack.push(x, (h - 1) * w + x) }
  for (let y = 0; y < h; y++) { stack.push(y * w, y * w + w - 1) }
  while (stack.length) {
    const p = stack.pop()!
    if (seen[p] || !isBg(p * 4)) continue
    seen[p] = 1
    d[p * 4 + 3] = 0
    const x = p % w, y = (p / w) | 0
    if (x > 0) stack.push(p - 1)
    if (x < w - 1) stack.push(p + 1)
    if (y > 0) stack.push(p - w)
    if (y < h - 1) stack.push(p + w)
  }
  ctx.putImageData(img, 0, 0)
}

// Transparent pixels in a PNG still carry a colour (often the white the art was cut from). Texture
// filtering blends neighbouring pixels, so at the outline that hidden white leaks in as a pale band.
// Fill the transparent area with the edge's own colours (a heavy blur of the art, composited
// underneath) while keeping the alpha exactly as it was.
function bleedEdgeColour(c: HTMLCanvasElement) {
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  const original = ctx.getImageData(0, 0, c.width, c.height)
  const tmp = document.createElement('canvas')
  tmp.width = c.width; tmp.height = c.height
  const t = tmp.getContext('2d')!
  for (const r of [24, 12, 6, 3]) { t.filter = `blur(${r}px)`; t.drawImage(c, 0, 0) }
  t.filter = 'none'
  t.drawImage(c, 0, 0)
  const bled = t.getImageData(0, 0, c.width, c.height)
  for (let i = 3; i < bled.data.length; i += 4) {
    const a = original.data[i]
    if (a > 250) { bled.data[i - 3] = original.data[i - 3]; bled.data[i - 2] = original.data[i - 2]; bled.data[i - 1] = original.data[i - 1] }
    bled.data[i] = a
  }
  ctx.putImageData(bled, 0, 0)
}

// Art like this has its lighting painted in — bright highlights, dark shadows on the metal. Under
// real lights those double up (a polished rim that's painted near-white reflects as white). Pull the
// gold toward a true gold tone, keeping a little of the painted shading for depth; the relief and
// the scene's lights then supply the real shine.
function delightGold(c: HTMLCanvasElement, k: Uint8Array) {
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  const img = ctx.getImageData(0, 0, c.width, c.height)
  const d = img.data, s = c.width / N
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    const ki = k[Math.min(N - 1, (y / s) | 0) * N + Math.min(N - 1, (x / s) | 0)]
    if (ki !== Kind.Gold) continue
    const o = (y * c.width + x) * 4
    const lum = (0.2126 * d[o] + 0.7152 * d[o + 1] + 0.0722 * d[o + 2]) / 255
    const shade = 0.62 + 0.45 * (lum - 0.5)
    const target = [216 * shade, 163 * shade, 66 * shade]
    const mix = 0.6
    d[o] = d[o] * (1 - mix) + target[0] * mix
    d[o + 1] = d[o + 1] * (1 - mix) + target[1] * mix
    d[o + 2] = d[o + 2] * (1 - mix) + target[2] * mix
  }
  ctx.putImageData(img, 0, 0)
}

function alphaOf(rgba: Uint8ClampedArray): Float32Array {
  const a = new Float32Array(N * N)
  for (let i = 0; i < a.length; i++) a[i] = rgba[i * 4 + 3] / 255
  return a
}

const enum Kind { None, Gold, Gem, Glow, Scene, Paint }

function hsv(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn
  let h = 0
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6
    else if (mx === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return [h, mx ? d / mx : 0, mx / 255]
}

// What each pixel is made of, from its colour. Gems are small, strongly saturated specks that
// aren't gold; glow is pale, bright cyan/blue (lightning, magic); scene is the greens of a painted
// background; everything else is painted enamel.
// Gold decided by neighbourhood, not per pixel: fur, skin and wood often share gold's hue, and the
// scattered pixels that passed the colour test became mirror-polished flecks (dark specks on
// Teemo's face). Smoothing the gold mask keeps the solid gold frame and drops the flecks.
function solidifyGold(k: Uint8Array) {
  const g = blur(Float32Array.from(k, (c) => (c === Kind.Gold ? 1 : 0)), 2.5 * S)
  for (let i = 0; i < k.length; i++) {
    if (k[i] === Kind.Gold && g[i] < 0.6) k[i] = Kind.Paint
    else if (k[i] === Kind.Paint && g[i] > 0.85) k[i] = Kind.Gold // fill pinholes in the gold
  }
}

function classify(rgba: Uint8ClampedArray, alpha: Float32Array): Uint8Array {
  const k = new Uint8Array(N * N)
  const sat = new Uint8Array(N * N)
  const nearEdge = blur(alpha, 14 * S)
  for (let i = 0; i < N * N; i++) {
    if (alpha[i] < 0.5) { k[i] = Kind.None; continue }
    const [h, s, v] = hsv(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2])
    if (h >= 28 && h <= 58 && s > 0.32 && v > 0.3) k[i] = Kind.Gold
    // Pale bands along the outline: painted-in highlights on the metal rim, or the coin's side
    // drawn in perspective (AI art often does this) — they're gold, not white paint
    else if (s < 0.38 && v > 0.55 && nearEdge[i] < 0.985) k[i] = Kind.Gold
    else if (h >= 175 && h <= 225 && s > 0.15 && s < 0.85 && v > 0.72) k[i] = Kind.Glow
    else if (h > 70 && h < 165 && s > 0.3) k[i] = Kind.Scene
    else k[i] = Kind.Paint
    if (s > 0.55 && v > 0.25 && k[i] !== Kind.Gold) sat[i] = 1
  }
  // Gems: small connected blobs of strong saturation, set into gold.
  const seen = new Uint8Array(N * N)
  const maxArea = N * N * 0.0012
  for (let i = 0; i < N * N; i++) {
    if (!sat[i] || seen[i]) continue
    const blob: number[] = []
    const stack = [i]
    seen[i] = 1
    let touchesGold = false
    while (stack.length && blob.length <= maxArea) {
      const p = stack.pop()!
      blob.push(p)
      const x = p % N, y = (p / N) | 0
      for (const q of [x > 0 ? p - 1 : -1, x < N - 1 ? p + 1 : -1, y > 0 ? p - N : -1, y < N - 1 ? p + N : -1]) {
        if (q < 0) continue
        if (k[q] === Kind.Gold) touchesGold = true
        if (sat[q] && !seen[q]) { seen[q] = 1; stack.push(q) }
      }
    }
    if (blob.length <= maxArea && blob.length > 4 && touchesGold) for (const p of blob) k[p] = Kind.Gem
  }
  return k
}

// ── Height, normals, materials ──────────────────────────────────────────────────────────────

function blur(src: Float32Array, radius: number): Float32Array {
  // Separable box blur, applied twice (≈ gaussian)
  const r = Math.max(1, Math.round(radius))
  let a = src, b = new Float32Array(N * N)
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < N; y++) {
      let acc = 0
      for (let x = -r; x <= r; x++) acc += a[y * N + Math.min(N - 1, Math.max(0, x))]
      for (let x = 0; x < N; x++) {
        b[y * N + x] = acc / (2 * r + 1)
        acc += a[y * N + Math.min(N - 1, x + r + 1)] - a[y * N + Math.max(0, x - r)]
      }
    }
    const c = new Float32Array(N * N)
    for (let x = 0; x < N; x++) {
      let acc = 0
      for (let y = -r; y <= r; y++) acc += b[Math.min(N - 1, Math.max(0, y)) * N + x]
      for (let y = 0; y < N; y++) {
        c[y * N + x] = acc / (2 * r + 1)
        acc += b[Math.min(N - 1, y + r + 1) * N + x] - b[Math.max(0, y - r) * N + x]
      }
    }
    a = c
    b = new Float32Array(N * N)
  }
  return a
}

function heightMap(rgba: Uint8ClampedArray, alpha: Float32Array, k: Uint8Array): { macro: Float32Array; fine: Float32Array } {
  const lum = new Float32Array(N * N)
  for (let i = 0; i < N * N; i++) lum[i] = (0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2]) / 255
  const lumSoft = blur(lum, 6 * S)
  const base = new Float32Array(N * N)
  for (let i = 0; i < N * N; i++) {
    base[i] = k[i] === Kind.Gold ? 0.62 : k[i] === Kind.Gem ? 0.7 : k[i] === Kind.Scene ? 0.18 : k[i] === Kind.Glow ? 0.55 : k[i] === Kind.Paint ? 0.48 : 0
  }
  // Wide enough that a speckle of mis-classified pixels can't poke a spike out of the surface
  const baseSoft = blur(base, 4 * S)
  // Rounded edge: the relief eases down to the body over a wide band at the outline, so there's
  // no steep wall there (a steep wall stretches the rim's pale highlight into a white band)
  const edge = blur(alpha, 12 * S)
  const toneRaw = new Float32Array(N * N)
  for (let i = 0; i < N * N; i++) toneRaw[i] = k[i] === Kind.Gold ? (lum[i] - 0.5) * 0.3 : 0 // bright gold sits higher
  const tone = blur(toneRaw, 3 * S)
  const macro = new Float32Array(N * N)
  const fine = new Float32Array(N * N)
  for (let i = 0; i < N * N; i++) {
    if (alpha[i] < 0.02) continue
    const t = Math.min(1, Math.max(0, (edge[i] - 0.5) * 2))
    const e = t * t * (3 - 2 * t) // smoothstep
    macro[i] = Math.max(0, Math.min(1, baseSoft[i] + tone[i])) * e
    // Fine detail only (the mesh already has the broad slopes): filigree, fur, folds, plus the
    // crisp class edges the mesh's softened version doesn't have
    fine[i] = ((lum[i] - lumSoft[i]) * 0.5 + (base[i] - baseSoft[i]) * 0.35) * e
  }
  return { macro: blur(macro, 2 * S), fine: blur(fine, 0.6) }
}

// A HavenRelief height map (white = high), used as made: only a 1px blur to hide 8-bit steps,
// and zero outside the art's cutout.
function reliefHeight(img: HTMLImageElement, art: HTMLImageElement): { h: Float32Array; a: Float32Array } {
  const read = (im: HTMLImageElement) => {
    const c = document.createElement('canvas')
    c.width = c.height = HN
    const ctx = c.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(im, 0, 0, HN, HN)
    return ctx.getImageData(0, 0, HN, HN).data
  }
  const d = read(img), ad = read(art)
  const h = new Float32Array(HN * HN), a = new Float32Array(HN * HN)
  for (let i = 0; i < HN * HN; i++) { a[i] = ad[i * 4 + 3] / 255; h[i] = a[i] < 0.02 ? 0 : d[i * 4] / 255 }
  // a 1px box blur hides the 8-bit steps without softening the detail
  const out = new Float32Array(HN * HN)
  for (let y = 0; y < HN; y++) for (let x = 0; x < HN; x++) {
    let acc = 0, n = 0
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy
      if (xx < 0 || yy < 0 || xx >= HN || yy >= HN) continue
      acc += h[yy * HN + xx]; n++
    }
    out[y * HN + x] = acc / n
  }
  return { h: out, a }
}

function downsample(src: Float32Array, from: number, to: number): Float32Array {
  const out = new Float32Array(to * to), k = from / to
  for (let y = 0; y < to; y++) for (let x = 0; x < to; x++) out[y * to + x] = src[Math.floor(y * k) * from + Math.floor(x * k)]
  return out
}

function normalMap(h: Float32Array, strength: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = N
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(N, N)
  const at = (x: number, y: number) => h[Math.min(N - 1, Math.max(0, y)) * N + Math.min(N - 1, Math.max(0, x))]
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1))
    const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1))
    let nx = -dx * strength, ny = dy * strength, nz = 1
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l
    const o = (y * N + x) * 4
    img.data[o] = (nx * 0.5 + 0.5) * 255
    img.data[o + 1] = (ny * 0.5 + 0.5) * 255
    img.data[o + 2] = (nz * 0.5 + 0.5) * 255
    img.data[o + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  return c
}

// Roughness in green, metalness in blue (three.js convention).
function ormMap(k: Uint8Array, rgba: Uint8ClampedArray, clean = false): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = N
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(N, N)
  for (let i = 0; i < N * N; i++) {
    const lum = (rgba[i * 4] + rgba[i * 4 + 1] + rgba[i * 4 + 2]) / 765
    let rough = 0.4, metal = 0
    if (k[i] === Kind.Gold) { metal = 1; rough = clean ? 0.3 : 0.38 - lum * 0.22 }  // brighter gold = more polished (clean: even polish, no mottling)
    else if (k[i] === Kind.Gem) { rough = 0.04 }
    else if (k[i] === Kind.Glow) { rough = 0.18 }
    else if (k[i] === Kind.Scene) { rough = 0.5 }
    else if (k[i] === Kind.Paint) { rough = 0.45 }
    img.data[i * 4] = 0
    img.data[i * 4 + 1] = Math.round(Math.max(0.03, rough) * 255)
    img.data[i * 4 + 2] = Math.round(metal * 255)
    img.data[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  return c
}

// Glow: lightning/magic keep their own colour as light; gems get a faint inner fire.
function emissiveMap(k: Uint8Array, rgba: Uint8ClampedArray): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = N
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(N, N)
  for (let i = 0; i < N * N; i++) {
    const f = k[i] === Kind.Glow ? 0.55 : k[i] === Kind.Gem ? 0.25 : 0
    img.data[i * 4] = rgba[i * 4] * f
    img.data[i * 4 + 1] = rgba[i * 4 + 1] * f
    img.data[i * 4 + 2] = rgba[i * 4 + 2] * f
    img.data[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  // soften into a bloom-ish halo
  ctx.filter = `blur(${1.5 * S}px)`
  ctx.drawImage(c, 0, 0)
  return c
}

function toTexture(c: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.NoColorSpace
  return t
}

function sample(h: Float32Array, u: number, v: number, size = N): number {
  const x = Math.min(size - 1, Math.max(0, u * (size - 1))), y = Math.min(size - 1, Math.max(0, v * (size - 1)))
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(size - 1, x0 + 1), y1 = Math.min(size - 1, y0 + 1)
  const fx = x - x0, fy = y - y0
  const a = h[y0 * size + x0] * (1 - fx) + h[y0 * size + x1] * fx
  const b = h[y1 * size + x0] * (1 - fx) + h[y1 * size + x1] * fx
  return a * (1 - fy) + b * fy
}

// ── Outline → shape ─────────────────────────────────────────────────────────────────────────

// Trace the outer edge of the opaque area (Moore-neighbour tracing on a coarser grid), simplify it,
// and return it as a shape in the art's unit square (x right, y up, centred).
export function traceOutline(alpha: Float32Array, size = N): THREE.Shape {
  const M = Math.min(512, size), step = size / M
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < M && y < M && alpha[Math.floor(y * step) * size + Math.floor(x * step)] > 0.5
  // Start: first solid pixel scanning from the top-left
  let sx = -1, sy = -1
  outer: for (let y = 0; y < M; y++) for (let x = 0; x < M; x++) if (solid(x, y)) { sx = x; sy = y; break outer }
  if (sx < 0) return circleShape()
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]]
  const pts: [number, number][] = [[sx, sy]]
  let cx = sx, cy = sy, dir = 7
  for (let guard = 0; guard < M * M; guard++) {
    let found = false
    for (let k = 0; k < 8; k++) {
      const d = (dir + 6 + k) % 8 // start searching from the left of the incoming direction
      const nx = cx + dirs[d][0], ny = cy + dirs[d][1]
      if (solid(nx, ny)) { cx = nx; cy = ny; dir = d; found = true; break }
    }
    if (!found) break
    if (cx === sx && cy === sy) break
    pts.push([cx, cy])
  }
  // Simplify: keep a point every ~2 grid units, then smooth lightly
  const simple: [number, number][] = []
  for (let i = 0; i < pts.length; i += 2) simple.push(pts[i])
  // Several smoothing passes: pixel stair-steps left in the outline catch the light as stripes
  // down the polished side wall
  let smooth = simple
  for (let pass = 0; pass < 6; pass++) {
    const prev = smooth
    smooth = prev.map((p, i) => {
      const a = prev[(i - 1 + prev.length) % prev.length], b = prev[(i + 1) % prev.length]
      return [(a[0] + 2 * p[0] + b[0]) / 4, (a[1] + 2 * p[1] + b[1]) / 4] as [number, number]
    })
  }
  const shape = new THREE.Shape(smooth.map(([x, y]) => new THREE.Vector2((x + 0.5) / M - 0.5, 0.5 - (y + 0.5) / M)))
  return shape
}

function circleShape() {
  const s = new THREE.Shape()
  s.absarc(0, 0, 0.48, 0, Math.PI * 2, false)
  return s
}

/** A flat back plate in the pin's outline, facing −z. Not made by turning a front-facing shape
 *  around — that mirrors it left-to-right, so it wouldn't line up with an asymmetric pin. The UVs
 *  are mirrored instead, so the back stamp reads correctly from behind. */
export function backPlateGeometry(outline: THREE.Shape): THREE.BufferGeometry {
  const geo = new THREE.ShapeGeometry(outline, 12)
  const idx = geo.index!
  for (let i = 0; i < idx.count; i += 3) { const b = idx.getX(i + 1); idx.setX(i + 1, idx.getX(i + 2)); idx.setX(i + 2, b) }
  const pos = geo.attributes.position, nrm = geo.attributes.normal, uv = geo.attributes.uv
  for (let i = 0; i < pos.count; i++) { nrm.setXYZ(i, 0, 0, -1); uv.setXY(i, 0.5 - pos.getX(i), pos.getY(i) + 0.5) }
  return geo
}

export function brushedBack() {
  const c = document.createElement('canvas')
  c.width = c.height = 1024
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#b8b8b8'
  ctx.fillRect(0, 0, 1024, 1024)
  for (let y = 0; y < 1024; y += 3) {
    ctx.fillStyle = `rgba(255,255,255,${0.04 + Math.random() * 0.08})`
    ctx.fillRect(0, y, 1024, 1)
  }
  ctx.fillStyle = 'rgba(40,30,15,0.55)'
  ctx.textAlign = 'center'
  ctx.font = '900 70px Inter, system-ui, sans-serif'
  ctx.fillText('TCG HAVEN', 512, 470)
  ctx.font = '700 36px Inter, system-ui, sans-serif'
  ctx.fillText('HAVEN BADGES · OFFICIAL PIN', 512, 530)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}
