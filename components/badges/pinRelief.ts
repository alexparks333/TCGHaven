import * as THREE from 'three'
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

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
// With a real relief map: a die-struck pin's depth (~2% of its width). 0.055 stood taller than the
// whole body — side-on, Jinx was a figurine with smeared walls.
const RELIEF_DEPTH = 0.026

export interface Relief {
  group: THREE.Group
  faceMaterial: THREE.MeshPhysicalMaterial
  backZ: number
  outline: THREE.Shape
}

/** How a real relief is struck: its height (fraction of the pin's width) and how steep a slope
 *  must be to be drawn as plain gold wall (0–1). Set per badge in the Relief Studio. */
export interface ReliefLook {
  depth?: number
  wall?: number
  lenticular?: string[][] // the Lenticular finish's picture sets, as URLs the browser may load (via badgeAsset)
}

/** A real relief whose surface can be re-shaped in place — the Relief Studio's live preview. */
export interface LiveRelief extends Relief {
  setHeight(h: Float32Array, size: number, look?: ReliefLook): void
  /** Tints the pixels where mask[i] is set (size²) — the Studio's selected piece; null clears it. */
  setHighlight(mask: Uint8Array | null, size: number): void
  /** Shows a picture on the face in place of the art (the Studio's piece and level views); null = the art. */
  setOverlay(picture: HTMLCanvasElement | null): void
  /** The Lenticular finish's picture sets (each: URLs, left to right), every picture the whole pin
   *  framed like the art. A lenticular pixel's set is in the finish map's blue channel. */
  setLenticular(sets: string[][]): Promise<void>
  /** Each pixel's finish, RGBA (R = FINISHES id in lib/reliefStudio.ts, G/B = its settings), size²;
   *  null = all Auto. Holes are cut when the pin is built (cleanRelief's `holes`), not here. */
  setFinish(finish: Uint8Array | null, size: number): void
}

// Finishes, by id — keep in step with FINISHES in lib/reliefStudio.ts (that's where they're named)
export const FINISH_HOLE = 6

export async function buildRelief(url: string, maxAnisotropy: number, depthUrl?: string, look?: ReliefLook, finishUrl?: string): Promise<Relief> {
  const img = await loadImage(url)
  if (!depthUrl) return guessedRelief(img, maxAnisotropy)
  // A real relief height map (HavenRelief / the Relief Studio) is used exactly as made
  const fineHeight = reliefHeight(await loadImage(depthUrl), img) // HN×HN, with its own alpha
  // The Studio's finish map (R = finish id per pixel), when the badge has one
  const finish = finishUrl ? readFinish(await loadImage(finishUrl), HN) : null
  const holes = finish ? Uint8Array.from({ length: HN * HN }, (_, i) => (finish[i * 4] % 16 === FINISH_HOLE ? 1 : 0)) : null
  const r = cleanRelief(img, maxAnisotropy, fineHeight.a, HN, CLEAN_GRID, holes?.some((v) => v) ? { mask: holes, size: HN } : undefined)
  r.setHeight(fineHeight.h, HN, look)
  if (finish) r.setFinish(finish, HN)
  if (look?.lenticular?.some((s) => s.length)) await r.setLenticular(look.lenticular)
  return r
}

function readFinish(img: HTMLImageElement, size: number): Uint8Array {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingEnabled = false // ids, not colours: never blend two finishes into a third
  ctx.drawImage(img, 0, 0, size, size)
  return new Uint8Array(ctx.getImageData(0, 0, size, size).data.buffer)
}

/** A real relief's pin: body, back, and a relief surface over the art's cutout (`alpha`, size²)
 *  that setHeight() shapes — as often as it likes, e.g. on every slider move. `holes` (1 = cut
 *  out) goes right through: relief, body and back plate, with the gold skirt lining its edge. */
export function cleanRelief(img: HTMLImageElement, maxAnisotropy: number, alpha: Float32Array, size: number, grid: number,
  holes?: { mask: Uint8Array; size: number }): LiveRelief {
  if (holes) {
    const k = holes.size / size
    alpha = alpha.map((a, i) => (holes.mask[Math.floor(Math.floor(i / size) * k) * holes.size + Math.floor((i % size) * k)] ? 0 : a))
  }
  const { rgba } = readPixels(img, N)
  const artAlpha = alphaOf(rgba)
  const classes = classify(rgba, artAlpha)
  solidifyGold(classes) // metal only in solid gold areas, never flecks

  // The art at full resolution, in its own colours
  const full = document.createElement('canvas')
  full.width = full.height = 2048
  const fctx = full.getContext('2d')!
  fctx.drawImage(img, 0, 0, 2048, 2048)
  if (!hasTransparency(rgba)) whiteToAlpha(fctx) // a picture on white: cut the background out
  bleedEdgeColour(full)
  const colorTex = new THREE.CanvasTexture(full)
  colorTex.colorSpace = THREE.SRGBColorSpace
  colorTex.anisotropy = maxAnisotropy
  const glow = emissiveMap(classes, rgba)
  const glowBase = glow.getContext('2d')!.getImageData(0, 0, N, N)
  const emissiveTex = toTexture(glow)
  emissiveTex.colorSpace = THREE.SRGBColorSpace

  // No normal map of our own: the mesh's normals until the HavenRelief normal map is swapped in
  // (the viewer's normalMapUrl, the Studio's kit), as an object-space map that REPLACES the mesh's
  // normals (a tangent-space map of the same relief on the displaced mesh counted every slope
  // twice: pillowy, liquid-looking).
  const faceMaterial = new THREE.MeshPhysicalMaterial({
    map: colorTex,
    alphaTest: 0.5,
    roughnessMap: toTexture(ormMap(classes, rgba, true)), metalnessMap: null, roughness: 1, metalness: 1,
    emissiveMap: emissiveTex, emissive: new THREE.Color(0xffffff), emissiveIntensity: 0.5,
    side: THREE.FrontSide,
  })
  faceMaterial.metalnessMap = faceMaterial.roughnessMap
  const finishUniforms = installWallShader(faceMaterial)

  const group = new THREE.Group()
  const outline = traceOutline(artAlpha)
  // A hole has one wall: the relief's cut edge, snapped onto the hole's outline (holeEdges) and
  // carried right down to the back plate. The body's own opening is cut a little wider, so it sits
  // hidden behind that wall — traced separately, the two never quite lined up and the relief's
  // short edge hung in the hole as loose gold strips.
  const holeEdges = holes ? holePaths(holes.mask, holes.size, 0) : []
  if (holes) outline.holes.push(...holePaths(holes.mask, holes.size, Math.max(1, Math.round(2 * holes.size / 1024))))
  const { front, backZ, gold } = addBodyAndBack(group, outline)

  // The relief surface, cut cleanly at the pin's outline: triangles outside it are dropped, rather
  // than sloping down to zero (that slope got stretched edge colour — a ragged silver fringe)
  const face = new THREE.PlaneGeometry(1, 1, grid, grid)
  const pos = face.attributes.position
  const keep: number[] = []
  const idx = face.index!.array
  const inside = (vi: number) => sample(alpha, pos.getX(vi) + 0.5, 0.5 - pos.getY(vi), size) > 0.5
  for (let t = 0; t < idx.length; t += 3) if (inside(idx[t]) && inside(idx[t + 1]) && inside(idx[t + 2])) keep.push(idx[t], idx[t + 1], idx[t + 2])
  face.setIndex(keep)
  const wallAttr = new THREE.BufferAttribute(new Float32Array(pos.count), 1)
  face.setAttribute('wall', wallAttr)
  group.add(new THREE.Mesh(face, faceMaterial))

  // A gold skirt from the relief's cut edge down into the body: without it the edge floats above
  // the body's top wherever the relief there is raised, and you see straight through the gap
  const edgeUse = new Map<number, number>()
  const edgeKey = (a: number, b: number) => (a < b ? a * pos.count + b : b * pos.count + a)
  for (let t = 0; t < keep.length; t += 3) for (let e = 0; e < 3; e++) {
    const k = edgeKey(keep[t + e], keep[t + ((e + 1) % 3)])
    edgeUse.set(k, (edgeUse.get(k) ?? 0) + 1)
  }
  const rim: number[] = [] // face vertex per skirt vertex (top ones), -1 = bottom
  for (let t = 0; t < keep.length; t += 3) for (let e = 0; e < 3; e++) {
    const a = keep[t + e], b = keep[t + ((e + 1) % 3)]
    if (edgeUse.get(edgeKey(a, b)) === 1) rim.push(a, b, -1 - b, a, -1 - b, -1 - a)
  }
  // The cut edge follows the mesh grid in little steps; pull every edge vertex onto the smooth
  // outline the body is built from (its outer edge and any holes' openings), so the skirt is one
  // clean wall meeting the body's bevel — not a staircase
  const contour: number[] = [] // x, y, 1 if it's a hole's edge
  for (const v of outline.getPoints()) contour.push(v.x, v.y, 0)
  for (const c of holeEdges) for (const v of c.getPoints()) contour.push(v.x, v.y, 1)
  const uv = face.attributes.uv
  const onHole = new Set<number>()
  const snapped = new Set<number>()
  const reach = 4 / grid
  for (const v of rim) {
    if (v < 0 || snapped.has(v)) continue
    snapped.add(v)
    const x = pos.getX(v), y = pos.getY(v)
    let best = -1, bd = reach * reach
    for (let i = 0; i < contour.length; i += 3) {
      const dx = contour[i] - x, dy = contour[i + 1] - y, d = dx * dx + dy * dy
      if (d < bd) { bd = d; best = i }
    }
    if (best < 0) continue
    pos.setXY(v, contour[best], contour[best + 1])
    uv.setXY(v, contour[best] + 0.5, contour[best + 1] + 0.5)
    if (contour[best + 2]) onHole.add(v)
  }
  uv.needsUpdate = true
  const skirtPos = new Float32Array(rim.length * 3)
  rim.forEach((v, i) => {
    const src = v >= 0 ? v : -1 - v
    skirtPos[i * 3] = pos.getX(src); skirtPos[i * 3 + 1] = pos.getY(src)
    skirtPos[i * 3 + 2] = onHole.has(src) ? -BEVEL - 0.0004 : front - 0.004
  })
  const skirt = new THREE.BufferGeometry()
  skirt.setAttribute('position', new THREE.BufferAttribute(skirtPos, 3))
  const skirtMat = gold.clone()
  skirtMat.side = THREE.DoubleSide
  group.add(new THREE.Mesh(skirt, skirtMat))

  function setHeight(h: Float32Array, hsize: number, look?: ReliefLook) {
    const depth = look?.depth ?? RELIEF_DEPTH
    for (let i = 0; i < pos.count; i++) pos.setZ(i, front + 0.0008 + sample(h, pos.getX(i) + 0.5, 0.5 - pos.getY(i), hsize) * depth)
    pos.needsUpdate = true
    face.computeVertexNormals()
    face.computeBoundingSphere()
    rim.forEach((v, i) => { if (v >= 0) skirtPos[i * 3 + 2] = pos.getZ(v) })
    skirt.attributes.position.needsUpdate = true
    skirt.computeVertexNormals()
    skirt.computeBoundingSphere()
    setWalls(face, wallAttr, look?.wall ?? 0.35)
  }
  function setHighlight(mask: Uint8Array | null, msize: number) {
    const img = new ImageData(new Uint8ClampedArray(glowBase.data), N, N)
    if (mask) {
      const k = msize / N
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        if (!mask[Math.floor(y * k) * msize + Math.floor(x * k)]) continue
        const o = (y * N + x) * 4
        img.data[o] = Math.max(img.data[o], 40); img.data[o + 1] = Math.max(img.data[o + 1], 150); img.data[o + 2] = Math.max(img.data[o + 2], 210)
      }
    }
    glow.getContext('2d')!.putImageData(img, 0, 0)
    emissiveTex.needsUpdate = true
  }
  let overlayTex: THREE.CanvasTexture | null = null
  function setOverlay(picture: HTMLCanvasElement | null) {
    overlayTex?.dispose()
    overlayTex = picture ? new THREE.CanvasTexture(picture) : null
    if (overlayTex) overlayTex.colorSpace = THREE.SRGBColorSpace
    faceMaterial.map = overlayTex ?? colorTex
    faceMaterial.needsUpdate = true
  }
  function setFinish(finish: Uint8Array | null, fsize: number) {
    finishUniforms.finishMap.value.dispose()
    if (finish) {
      // rows flipped by hand to match the art's texture (row 0 = the top of the art); a data
      // texture's flipY isn't reliable across browsers
      const row = fsize * 4
      const rows = new Uint8Array(fsize * row)
      for (let y = 0; y < fsize; y++) rows.set(finish.subarray(y * row, (y + 1) * row), (fsize - 1 - y) * row)
      const t = new THREE.DataTexture(rows, fsize, fsize, THREE.RGBAFormat, THREE.UnsignedByteType)
      t.magFilter = t.minFilter = THREE.NearestFilter
      t.needsUpdate = true
      finishUniforms.finishMap.value = t
    } else finishUniforms.finishMap.value = blankFinish()
    finishUniforms.hasFinish.value = finish ? 1 : 0
    let clearGem = false
    if (finish) for (let i = 0; i < finish.length; i += 4) if (finish[i] % 16 === 3 && finish[i + 2] > 0) { clearGem = true; break }
    if ((faceMaterial.transmission > 0) !== clearGem) {
      faceMaterial.transmission = clearGem ? 1 : 0
      faceMaterial.thickness = 0.03
      faceMaterial.ior = 1.55
      faceMaterial.needsUpdate = true
    }
  }
  async function setLenticular(sets: string[][]) {
    finishUniforms.lentAtlas.value.dispose()
    // every set's pictures in one texture; each set remembered as (first picture, how many)
    const urls: string[] = []
    finishUniforms.lentSets.value.forEach((v, i) => {
      const set = (sets[i] ?? []).slice(0, Math.max(0, 16 - urls.length))
      v.set(urls.length, set.length)
      urls.push(...set)
    })
    if (!urls.length) { finishUniforms.lentAtlas.value = blankFinish(); finishUniforms.lentGrid.value.set(1, 1, 0); return }
    const frames = await Promise.all(urls.map(loadImage))
    // all the pictures in one texture, a grid of 1024² cells; each fitted into its cell the way the
    // art was fitted onto its square (centred, keeping its shape)
    const F = 1024, cols = Math.ceil(Math.sqrt(frames.length)), rows = Math.ceil(frames.length / cols)
    const atlas = document.createElement('canvas')
    atlas.width = cols * F; atlas.height = rows * F
    const ctx = atlas.getContext('2d')!
    frames.forEach((im, i) => {
      const k = Math.min(F / im.naturalWidth, F / im.naturalHeight), w = im.naturalWidth * k, h = im.naturalHeight * k
      ctx.drawImage(im, (i % cols) * F + (F - w) / 2, Math.floor(i / cols) * F + (F - h) / 2, w, h)
    })
    const t = new THREE.CanvasTexture(atlas)
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = maxAnisotropy
    finishUniforms.lentAtlas.value = t
    finishUniforms.lentGrid.value.set(cols, rows, frames.length)
  }
  return { group, faceMaterial, backZ, outline, setHeight, setHighlight, setOverlay, setFinish, setLenticular }
}

// A hole mask's openings as paths (each enclosed area large enough to matter), grown by `grow` px.
// Lightly smoothed only — the mask is already smoothed (finishMap), and heavy smoothing pulled the
// outline inside the real hole.
function holePaths(mask: Uint8Array, size: number, grow: number): THREE.Path[] {
  if (grow > 0) mask = dilate(mask, size, grow)
  const n = size * size
  const lab = new Int32Array(n)
  const paths: THREE.Path[] = []
  let next = 0
  for (let i = 0; i < n; i++) {
    if (!mask[i] || lab[i]) continue
    const pix: number[] = []
    const stack = [i]
    lab[i] = ++next
    while (stack.length) {
      const q = stack.pop()!
      pix.push(q)
      const x = q % size
      for (const r of [x > 0 ? q - 1 : -1, x < size - 1 ? q + 1 : -1, q >= size ? q - size : -1, q < n - size ? q + size : -1]) {
        if (r >= 0 && mask[r] && !lab[r]) { lab[r] = next; stack.push(r) }
      }
    }
    if (pix.length < n * 0.0005) continue
    const solo = new Float32Array(n)
    for (const q of pix) solo[q] = 1
    paths.push(new THREE.Path(traceOutline(solo, size, 2).getPoints()))
  }
  return paths
}

function dilate(mask: Uint8Array, size: number, r: number): Uint8Array {
  const out = new Uint8Array(mask.length)
  const tmp = new Uint8Array(mask.length)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let on = 0
    for (let d = -r; d <= r && !on; d++) { const xx = x + d; if (xx >= 0 && xx < size) on = mask[y * size + xx] }
    tmp[y * size + x] = on
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let on = 0
    for (let d = -r; d <= r && !on; d++) { const yy = y + d; if (yy >= 0 && yy < size) on = tmp[yy * size + x] }
    out[y * size + x] = on
  }
  return out
}

let blank: THREE.DataTexture | null = null
function blankFinish() {
  if (!blank) { blank = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType); blank.needsUpdate = true }
  return blank
}

// No real relief: the old stand-in, with shape and detail guessed from the art's colours.
function guessedRelief(img: HTMLImageElement, maxAnisotropy: number): Relief {
  const { rgba } = readPixels(img, N)
  const alpha = alphaOf(rgba)
  const classes = classify(rgba, alpha)
  // The mesh only carries the broad shape (raised gold, recessed scene); the fine detail — filigree,
  // fur, lettering — lives in the normal map. Putting fine detail in the mesh made it spiky (a grid
  // can't hold detail finer than its own spacing).
  const { macro, fine } = heightMap(rgba, alpha, classes)

  const full = document.createElement('canvas')
  full.width = full.height = 1024
  const fctx = full.getContext('2d')!
  fctx.drawImage(img, 0, 0, 1024, 1024)
  if (!hasTransparency(rgba)) whiteToAlpha(fctx)
  bleedEdgeColour(full)
  delightGold(full, classes)
  const colorTex = new THREE.CanvasTexture(full)
  colorTex.colorSpace = THREE.SRGBColorSpace
  colorTex.anisotropy = maxAnisotropy
  const ormTex = toTexture(ormMap(classes, rgba))
  const emissiveTex = toTexture(emissiveMap(classes, rgba))
  emissiveTex.colorSpace = THREE.SRGBColorSpace

  const faceMaterial = new THREE.MeshPhysicalMaterial({
    map: colorTex,
    alphaTest: 0.5,
    normalMap: toTexture(normalMap(fine, 4 * S)),
    normalScale: new THREE.Vector2(0.8, 0.8),
    roughnessMap: ormTex, metalnessMap: ormTex, roughness: 1, metalness: 1,
    emissiveMap: emissiveTex, emissive: new THREE.Color(0xffffff), emissiveIntensity: 0.9,
    // A light clear coat only — a heavy one lays untinted glare over the gold and washes it out
    clearcoat: 0.18, clearcoatRoughness: 0.2,
    side: THREE.FrontSide,
  })

  const group = new THREE.Group()
  const outline = traceOutline(alpha)
  const { front, backZ } = addBodyAndBack(group, outline)
  const face = new THREE.PlaneGeometry(1, 1, GRID, GRID)
  const pos = face.attributes.position
  for (let i = 0; i < pos.count; i++) pos.setZ(i, front + 0.0008 + sample(macro, pos.getX(i) + 0.5, 0.5 - pos.getY(i)) * RELIEF)
  face.computeVertexNormals()
  group.add(new THREE.Mesh(face, faceMaterial))
  return { group, faceMaterial, backZ, outline }
}

// The bevelled metal body and the brushed back plate, in the pin's outline
function addBodyAndBack(group: THREE.Group, outline: THREE.Shape) {
  const gold = new THREE.MeshPhysicalMaterial({ color: 0xd2a44a, metalness: 1, roughness: 0.3, clearcoat: 0.25 })
  // Smooth normals round the sides and bevel (crisp only at real corners, like the star points):
  // the extrusion's own normals are one per outline segment, so the polished side showed every
  // segment as a facet
  const bodyGeo = toCreasedNormals(new THREE.ExtrudeGeometry(outline, { depth: BODY, bevelEnabled: true, bevelThickness: BEVEL, bevelSize: 0.006, bevelSegments: 5, curveSegments: 8 }), THREE.MathUtils.degToRad(40))
  group.add(new THREE.Mesh(bodyGeo, gold))
  const back = new THREE.Mesh(backPlateGeometry(outline), new THREE.MeshPhysicalMaterial({ map: brushedBack(), metalness: 1, roughness: 0.42, color: 0xd9b25e }))
  back.position.z = -BEVEL - 0.0004
  group.add(back)
  return { front: BODY + BEVEL, backZ: -BEVEL, gold }
}

// The art is projected straight on, so a steep wall of the relief has no colour of its own (one
// row of pixels smeared down it) and the normal map, made head-on, says it faces forward. Walls
// are struck metal instead: plain gold, lit by the mesh's real (sideways) normal. `wall` (0–1) is
// where that starts: the |normal.z| below which a slope begins turning to gold.
function setWalls(face: THREE.BufferGeometry, attr: THREE.BufferAttribute, wall: number) {
  const n = face.attributes.normal
  const a = attr.array as Float32Array
  for (let i = 0; i < n.count; i++) {
    const t = Math.min(1, Math.max(0, (Math.abs(n.getZ(i)) - wall) / 0.4))
    a[i] = 1 - t * t * (3 - 2 * t) // 1 where the surface is steep, 0 where it faces forward
  }
  attr.needsUpdate = true
}

// Finishes (the Relief Studio's Material tab), read per pixel from finishMap — R = which + 16 ×
// coverage (0–15, under 15 on feathered edges: every effect blends in by it), G/B = its settings (0–1) — always on top of the art's own colours: 1 regular enamel (G roughness),
// 2 gold (G roughness), 3 gemstone (G inner glow, B transparency: real light transmission — coloured
// glass over the gold body beneath, like translucent enamel), 4 holo (G
// roughness, B rainbow: holographic foil — smooth rainbow bands that sweep as the pin tilts), 5 color fresnel (G strength: the art as it is straight on; tilted, its colours turn round the wheel),
// 6 hole (cut out; also cut from the geometry), 7 lenticular (G turn range, B picture set: that
// set's pictures, in lentAtlas, fading seamlessly one into the next as it turns), 8 pattern foil (G shine + seed, B noise + pattern:
// microscopic ridges tilting the surface, their direction swirling with noise). 0 = Auto.
const FINISH_GLSL = {
  head: `
uniform sampler2D finishMap;
uniform float hasFinish;
uniform sampler2D lentAtlas;
uniform vec3 lentGrid; // the lenticular pictures' grid: columns, rows, how many
uniform vec2 lentSets[8]; // each lenticular set: its first picture in the grid, how many
varying float vWall;
varying vec3 vFoilT;
varying vec3 vFoilB;
varying vec3 vPinN; // the whole pin's facing (not the sculpted surface's) — tilt effects change as one
float foilHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// gradient (Perlin) noise, about −0.7..0.7
vec2 foilGrad(vec2 i) { float a = foilHash(i) * 6.2832; return vec2(cos(a), sin(a)); }
float foilPerlin(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(dot(foilGrad(i), f), dot(foilGrad(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), u.x),
             mix(dot(foilGrad(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)), dot(foilGrad(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)), u.x), u.y);
}
// Worley: the nearest of one random point per cell
vec2 foilCell(vec2 p) {
  vec2 i = floor(p), best = vec2(0.0);
  float bd = 9.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 c = i + vec2(float(x), float(y));
    vec2 pt = c + vec2(foilHash(c), foilHash(c + 7.13));
    float d = dot(pt - p, pt - p);
    if (d < bd) { bd = d; best = pt; }
  }
  return best;
}
float foilNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(foilHash(i), foilHash(i + vec2(1.0, 0.0)), f.x), mix(foilHash(i + vec2(0.0, 1.0)), foilHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// colours turned round the colour wheel (a rotation about the grey axis)
vec3 hueRotate(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}`,
  read: `
vec4 finTex = hasFinish > 0.5 ? texture2D(finishMap, vMapUv) : vec4(0.0);
float finV = floor(finTex.r * 255.0 + 0.5);
float fin = mod(finV, 16.0);             // which finish
float finCov = floor(finV / 16.0) / 15.0; // how much of it shows (feathered edges fade it out)
float finA = finTex.g, finB = finTex.b;
// (no discard for holes: the geometry cuts them along a smooth outline; discarding by this pixel
// map as well punched a stair-step of see-through pixels along the hole's edge)
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.40, 0.12), vWall);`,
  surface: `
if (fin > 0.5) {
  float m0 = metalnessFactor, r0 = roughnessFactor;
  if (fin < 1.5) { metalnessFactor = 0.0; roughnessFactor = mix(0.08, 0.85, finA); }
  else if (fin < 2.5) { metalnessFactor = 1.0; roughnessFactor = mix(0.04, 0.6, finA); }
  else if (fin < 3.5) { metalnessFactor = 0.0; roughnessFactor = 0.03; }
  else if (fin < 4.5) { metalnessFactor = 0.85; roughnessFactor = mix(0.04, 0.55, finA); }
  else if (fin > 7.5) { metalnessFactor = 0.6; roughnessFactor = 0.1; }
  else { metalnessFactor = 0.25; roughnessFactor = 0.12; }
  metalnessFactor = mix(m0, metalnessFactor, finCov);
  roughnessFactor = mix(r0, roughnessFactor, finCov);
}
metalnessFactor = mix(metalnessFactor, 1.0, vWall);
roughnessFactor = mix(roughnessFactor, 0.32, vWall);`,
  look: `
if (fin > 2.5 && vWall < 0.99) {
  vec3 dBase = diffuseColor.rgb, eBase = totalEmissiveRadiance;
  float face = 1.0 - vWall;
  float ndv = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
  if (fin < 3.5) {
    float fres = pow(1.0 - ndv, 3.0);
    totalEmissiveRadiance += diffuseColor.rgb * (0.1 + finA * 0.5 + finA * 1.2 * fres) * face;
    diffuseColor.rgb *= mix(1.0, 0.55, face);
  } else if (fin < 4.5) {
    // holographic foil, like a holo sticker: smooth rainbow bands that sweep across as the pin
    // tilts (their phase follows the reflected view, plus a gentle diagonal across the pin),
    // tinting the art — most where it's light, as foil shows through pale ink. Rough foil follows
    // the sculpted detail (bands break up over hair and folds); smooth foil only the broad shape.
    vec3 nH = normalize(mix(nonPerturbedNormal, normal, finA));
    vec3 rv = reflect(-normalize(vViewPosition), nH);
    float t = rv.x * 0.9 + rv.y * 0.6 + (vMapUv.x - vMapUv.y) * 0.8;
    vec3 rb = 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67)));
    float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
    float amt = finB * face * (0.35 + 0.65 * smoothstep(0.15, 0.8, lum));
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * rb * 1.7, amt);
    totalEmissiveRadiance += rb * 0.08 * amt;
  } else if (fin < 5.5) {
    // color fresnel: straight on, the art exactly as it is; tilted, its colours turn round the
    // colour wheel — further the more it's tilted, and which way it's tilted picks the direction.
    // From the whole pin's tilt (not its sculpted surface), so the piece changes colour as one.
    vec3 nG = normalize(vPinN);
    float tilt = 1.0 - clamp(dot(nG, normalize(vViewPosition)), 0.0, 1.0);
    float amt = smoothstep(0.02, 0.4, tilt) * finA * face;
    float side = atan(nG.y, nG.x);
    diffuseColor.rgb = hueRotate(diffuseColor.rgb, amt * 3.14159 * (1.0 + 0.6 * sin(side)));
  } else if (fin > 6.5 && fin < 7.5 && lentGrid.z > 0.5) {
    // lenticular: turning the pin left/right fades through the pictures — fully turned one way =
    // the first, the other way = the last (A: how far a turn that is). Seamless and gradual: each
    // neighbouring pair blends evenly across its whole share of the turn, eased at the ends, with
    // no lens lines (any ridge pattern showed as lines, and a hold-then-switch felt like a snap),
    // driven by the whole pin's tilt — the sculpted surface's own tilt varies pixel to pixel, and
    // mid-fade that showed as a pattern.
    // B: which picture set this layer uses
    vec2 lset = lentSets[int(clamp(floor(finB * 255.0 + 0.5), 0.0, 7.0))];
    float n = max(lset.y, 1.0);
    vec3 nG = normalize(vPinN);
    float pos = clamp(nG.x / mix(0.25, 1.0, finA) * 0.5 + 0.5, 0.0, 1.0) * (n - 1.0);
    float l0 = min(floor(pos), n - 1.0);
    float t = smoothstep(0.0, 1.0, pos - l0);
    float i0 = lset.x + l0, i1 = lset.x + min(l0 + 1.0, n - 1.0);
    vec2 cell0 = vec2(mod(i0, lentGrid.x), floor(i0 / lentGrid.x)), cell1 = vec2(mod(i1, lentGrid.x), floor(i1 / lentGrid.x));
    vec3 pic0 = texture2D(lentAtlas, vec2((cell0.x + vMapUv.x) / lentGrid.x, (lentGrid.y - 1.0 - cell0.y + vMapUv.y) / lentGrid.y)).rgb;
    vec3 pic1 = texture2D(lentAtlas, vec2((cell1.x + vMapUv.x) / lentGrid.x, (lentGrid.y - 1.0 - cell1.y + vMapUv.y) / lentGrid.y)).rgb;
    if (lset.y > 0.5) diffuseColor.rgb = mix(diffuseColor.rgb, mix(pic0, pic1, t), face);
  }
  else if (fin > 7.5 && fin < 8.5) {
    // pattern foil: microscopic parallel ridges whose slopes tilt the surface back and forth, so
    // thin lines of light run across it as it turns. Noise (B) swirls their direction across the
    // piece (0 = all one way, like brushed metal). Ridges far finer than a screen pixel would only
    // shimmer, so they fade with distance (fwidth) and sharpen up close.
    // G: shine (low 4 bits) + seed (high 4); B: noise (low 4) + pattern (high 4) — the noise that
    // steers the ridges: 0 swirl (value noise), 1 perlin, 2 turbulence (folded perlin: creases),
    // 3 cracked ice (Worley cells, straight ridges per shard), 4 gem facets (rings round each
    // Worley cell's centre), 5 sunburst (radiating from the pin's middle). Noise 0 = straight lines.
    float fg = floor(finA * 255.0 + 0.5), fb = floor(finB * 255.0 + 0.5);
    float fShine = mod(fg, 16.0) / 15.0, fNoise = mod(fb, 16.0) / 15.0, fType = floor(fb / 16.0);
    vec2 seed = floor(fg / 16.0) * vec2(17.31, 9.73);
    vec2 q = vMapUv * 5.0 + seed;
    vec2 straight = vec2(cos(0.6), sin(0.6));
    float ph;
    vec2 dir;
    if (fType < 3.5) {
      float ang;
      if (fType < 0.5) ang = 6.2832 * foilNoise(q) + 2.5 * foilNoise(q * 3.8);
      else if (fType < 1.5) ang = 6.2832 * (foilPerlin(q) + 0.5 * foilPerlin(q * 2.1));
      else if (fType < 2.5) ang = 6.2832 * (abs(foilPerlin(q)) + 0.5 * abs(foilPerlin(q * 2.1)) + 0.25 * abs(foilPerlin(q * 4.3)));
      else ang = 6.2832 * foilHash(foilCell(q * 2.0));
      ang = mix(0.6, ang, fNoise);
      dir = vec2(cos(ang), sin(ang));
      ph = dot(vMapUv * 900.0, dir);
    } else {
      vec2 d;
      if (fType < 4.5) { vec2 p8 = vMapUv * 8.0 + seed; d = p8 - foilCell(p8); ph = length(d) * 112.0; }
      else { d = vMapUv - 0.5; ph = atan(d.y, d.x) * 320.0; d = vec2(-d.y, d.x); }
      dir = normalize(d + 1e-5);
      ph = mix(dot(vMapUv * 900.0, straight), ph, fNoise);
      dir = normalize(mix(straight, dir, fNoise) + 1e-5);
    }
    float aa = clamp(2.2 - fwidth(ph) * 0.5, 0.0, 1.0);
    vec2 g = dir * cos(ph) * mix(0.1, 0.55, fShine) * aa * face;
    vec3 nFoil = normalize(normal + vFoilT * g.x + vFoilB * g.y);
    normal = normalize(mix(normal, nFoil, finCov));
    // part-metal so the art's colours stay bright, plus thin glints along the ridge crests that
    // run across the foil as the ridges' tilt toward the viewer changes
    float glint = pow(clamp(dot(nFoil, normalize(vec3(-0.35, 0.45, 0.82))), 0.0, 1.0), 22.0) * mix(0.35, 1.4, fShine) * aa;
    totalEmissiveRadiance += (dBase * 0.18 + mix(dBase, vec3(1.0, 0.95, 0.85), 0.6) * glint) * face;
  }
  diffuseColor.rgb = mix(dBase, diffuseColor.rgb, finCov);
  totalEmissiveRadiance = mix(eBase, totalEmissiveRadiance, finCov);
}`,
}

function installWallShader(mat: THREE.MeshPhysicalMaterial) {
  const uniforms = {
    finishMap: { value: blankFinish() as THREE.Texture }, hasFinish: { value: 0 },
    lentAtlas: { value: blankFinish() as THREE.Texture }, lentGrid: { value: new THREE.Vector3(1, 1, 0) },
    lentSets: { value: Array.from({ length: 8 }, () => new THREE.Vector2(0, 0)) },
  }
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, uniforms)
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float wall;\nvarying float vWall;\nvarying vec3 vFoilT;\nvarying vec3 vFoilB;\nvarying vec3 vPinN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWall = wall;\nvFoilT = normalize(normalMatrix * vec3(1.0, 0.0, 0.0));\nvFoilB = normalize(normalMatrix * vec3(0.0, 1.0, 0.0));\nvPinN = normalize(normalMatrix * vec3(0.0, 0.0, 1.0));')
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>' + FINISH_GLSL.head)
      .replace('#include <map_fragment>', '#include <map_fragment>' + FINISH_GLSL.read)
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>' + FINISH_GLSL.surface)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize(mix(normal, nonPerturbedNormal, vWall));')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>' + FINISH_GLSL.look)
      .replace('#include <transmission_fragment>', THREE.ShaderChunk.transmission_fragment.replace(
        'material.transmission = transmission;',
        'material.transmission = transmission * ((fin > 2.5 && fin < 3.5) ? finB * finCov * (1.0 - vWall) : 0.0);'))
  }
  mat.customProgramCacheKey = () => 'relief-walls-finish'
  return uniforms
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

// A HavenRelief height map (white = high), used exactly as made: zero outside the art's cutout.
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
  return { h, a }
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
export function traceOutline(alpha: Float32Array, size = N, smoothPasses?: number): THREE.Shape {
  // Traced at up to 1024 (512 left stair-steps that caught the light down the polished side)
  const M = Math.min(1024, size), step = size / M
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
  for (let pass = 0; pass < (smoothPasses ?? 6 * (M / 512)); pass++) {
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
