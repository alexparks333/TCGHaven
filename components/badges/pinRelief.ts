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
  tier?: 1 | 2 | 3        // which look (setTier); unset = Full
  holeSmooth?: number     // 0–1: how much the art's own holes (its enclosed transparency) are rounded off
  artHoles?: boolean      // cut the art's enclosed transparency out as holes (ReliefSettings.artHoles); unset = no
  metalColor?: string     // the metal of the sides, back and gold walls (hex); unset = the original gold
  metalRough?: number     // its roughness (0–1); unset = as made
  normalStrength?: number // how strongly the normal map tilts the surface (1 = as made, more = deeper detail); unset = 1
  detailSlots?: number[][] // the detail map's slots (lib/reliefStudio.ts detailSlots), when it has one
}

/** The art's own holes are rounded off this much unless the Studio says otherwise (ReliefSettings.holeSmooth) */
export const HOLE_SMOOTH = 0.3

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
  /** Which of the badge's three looks (lib/badges.ts badgeTier): 1 Grayscale — no colour, a little
   *  shine, no finishes; 2 Painted — colour, satin, no finishes; 3 Full — as designed. */
  setTier(tier: 1 | 2 | 3): void
  /** Each pixel's finish, RGBA (R = FINISHES id in lib/reliefStudio.ts, G/B = its settings), size²;
   *  null = all Auto. Holes are cut when the pin is built (cleanRelief's `holes`), not here. */
  setFinish(finish: Uint8Array | null, size: number): void
  /** The details over the finishes: a map like the finish map (R = slot + 16 × coverage, size²) and
   *  each slot's settings (lib/reliefStudio.ts detailSlots); null = none. */
  setDetails(map: Uint8Array | null, size: number, slots: number[][]): void
  /** How strongly the normal map tilts the surface (ReliefLook.normalStrength) — no re-mesh. */
  setNormalStrength(s: number): void
  /** The metal of the sides, back and gold walls (ReliefLook.metalColor / metalRough); no colour = the original gold. */
  setMetal(color?: string, rough?: number): void
}

// Finishes, by id — keep in step with FINISHES in lib/reliefStudio.ts (that's where they're named)
export const FINISH_HOLE = 6

export async function buildRelief(url: string, maxAnisotropy: number, depthUrl?: string, look?: ReliefLook, finishUrl?: string, detailUrl?: string): Promise<Relief> {
  const img = await loadImage(url)
  if (!depthUrl) return guessedRelief(img, maxAnisotropy)
  // A real relief height map (HavenRelief / the Relief Studio) is used exactly as made
  const fineHeight = reliefHeight(await loadImage(depthUrl), img) // HN×HN, with its own alpha
  // The Studio's finish map (R = finish id per pixel), when the badge has one
  const finish = finishUrl ? readFinish(await loadImage(finishUrl), HN) : null
  const holes = finish ? Uint8Array.from({ length: HN * HN }, (_, i) => (finish[i * 4] % 16 === FINISH_HOLE ? 1 : 0)) : null
  const r = cleanRelief(img, maxAnisotropy, fineHeight.a, HN, CLEAN_GRID, holes?.some((v) => v) ? { mask: holes, size: HN } : undefined, look?.holeSmooth, !!look?.artHoles)
  r.setHeight(fineHeight.h, HN, look)
  if (finish) r.setFinish(finish, HN)
  if (detailUrl && look?.detailSlots?.length) r.setDetails(readFinish(await loadImage(detailUrl), HN), HN, look.detailSlots)
  if (look?.lenticular?.some((s) => s.length)) await r.setLenticular(look.lenticular)
  if (look?.metalColor) r.setMetal(look.metalColor, look.metalRough)
  if (look?.tier && look.tier < 3) r.setTier(look.tier)
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
 *  out) goes right through: relief, body and back plate, with the gold skirt lining its edge.
 *  With `artHoles`, transparent areas inside the art (enclosed by the pin, not open to its edge)
 *  are holes too, their edges rounded off by `holeSmooth` (0–1). */
export function cleanRelief(img: HTMLImageElement, maxAnisotropy: number, alpha: Float32Array, size: number, grid: number,
  holes?: { mask: Uint8Array; size: number }, holeSmooth = HOLE_SMOOTH, artHoles = false): LiveRelief {
  const { rgba } = readPixels(img, N)
  const artAlpha = alphaOf(rgba)
  const art = artHoles ? withArtHoles(holes, alpha, size, holeSmooth) : { holes, fill: null, raw: null }
  holes = art.holes
  if (holes) {
    // The face runs on across the holes (they're cut from it per pixel, by holeTexture): solid there
    const k = holes.size / size
    alpha = alpha.map((a, i) => (holes.mask[Math.floor(Math.floor(i / size) * k) * holes.size + Math.floor((i % size) * k)] || art.raw?.[i] ? 1 : a))
  }
  const classes = classify(rgba, artAlpha)
  solidifyGold(classes) // metal only in solid gold areas, never flecks

  // The art at full resolution, in its own colours
  const full = document.createElement('canvas')
  full.width = full.height = 2048
  const fctx = full.getContext('2d')!
  fctx.drawImage(img, 0, 0, 2048, 2048)
  if (!hasTransparency(rgba)) whiteToAlpha(fctx) // a picture on white: cut the background out
  bleedEdgeColour(full)
  if (art.raw) {
    // The art's holes made opaque (in their edge colour): the geometry cuts them along a smooth
    // outline, and the texture's own alpha test chopped that edge pixel by pixel into spikes
    const px = fctx.getImageData(0, 0, 2048, 2048), k = size / 2048
    for (let i = 0; i < 2048 * 2048; i++) if (art.raw[Math.floor(Math.floor(i / 2048) * k) * size + Math.floor((i % 2048) * k)]) px.data[i * 4 + 3] = 255
    fctx.putImageData(px, 0, 0)
  }
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
  // A hole has one wall, standing on its smooth edge (holeLoops) from the face right down to the
  // back plate. Everything else is cut along the same edge per pixel by the hole map: the face (in
  // its shader) and the body and back plate (holeDiscard) — openings triangulated into the body
  // folded over on intricate holes and filled them back in with gold.
  const holeField0 = holes ? holeField(holes.mask, holes.size) : null
  const holeEdges = holeField0 ? holeLoops(holeField0, holes!.size) : []
  const holeTex = holeField0 ? holeTexture(holeField0, holes!.size) : null
  if (holeTex) {
    finishUniforms.holeMap.value = holeTex
    finishUniforms.hasHoles.value = 1
  }
  const solid = group.children.length
  const { front, backZ, gold } = addBodyAndBack(group, outline)
  const bodyParts = group.children.slice(solid) as THREE.Mesh[] // cut by the hole map once the skirt has copied gold

  // The height carried a few pixels into the holes before the hole's top edge samples it: a height
  // map is 0 where the art is transparent, and the edge (on the border) caught that 0 at every
  // other point — a saw-toothed wall
  let band: { size: number; idx: number[]; hole: Uint8Array } | null = null
  function intoHoles(h: Float32Array, hsize: number): Float32Array {
    const hm = holes!
    if (band?.size !== hsize) {
      const k = hm.size / hsize
      let holeAt: Uint8Array = new Uint8Array(hsize * hsize)
      for (let i = 0; i < holeAt.length; i++) holeAt[i] = hm.mask[Math.floor(Math.floor(i / hsize) * k) * hm.size + Math.floor((i % hsize) * k)]
      // a little past the edge too: the height map falls away just inside a cutout's edge, and that
      // drop showed as a fringe of gold wall teeth along it
      holeAt = dilate(holeAt, hsize, Math.max(1, Math.round(3 * hsize / 2048)))
      const hole = (x: number, y: number) => holeAt[y * hsize + x] === 1
      const r = Math.max(3, Math.round(10 * hsize / 2048)), idx: number[] = []
      for (let y = 0; y < hsize; y++) for (let x = 0; x < hsize; x++) {
        if (!hole(x, y)) continue
        near: for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx, ny = y + dy
          if (nx >= 0 && ny >= 0 && nx < hsize && ny < hsize && !hole(nx, ny)) { idx.push(y * hsize + x); break near }
        }
      }
      band = { size: hsize, idx, hole: holeAt }
    }
    const out = h.slice(), known = Uint8Array.from(band.hole, (v) => 1 - v) // solid, or filled already
    for (const i of band.idx) out[i] = 0
    // grown outward from the solid side, a pixel ring per pass
    for (let pass = 0; pass < Math.max(3, Math.round(10 * hsize / 2048)) + 1; pass++) {
      const prev = out.slice(), was = known.slice()
      for (const i of band.idx) {
        if (was[i]) continue
        const x = i % hsize
        let best = 0, n = 0
        for (const q of [x > 0 ? i - 1 : -1, x < hsize - 1 ? i + 1 : -1, i - hsize, i + hsize]) {
          if (q < 0 || q >= h.length || !was[q]) continue
          best += prev[q]; n++
        }
        if (n) { out[i] = best / n; known[i] = 1 }
      }
    }
    return out
  }

  // The relief surface, cut cleanly at the pin's outline: triangles outside it are dropped, rather
  // than sloping down to zero (that slope got stretched edge colour — a ragged silver fringe)
  const face = new THREE.PlaneGeometry(1, 1, grid, grid)
  const pos = face.attributes.position
  const keep: number[] = []
  const idx = face.index!.array
  const inside = (vi: number) => sample(alpha, pos.getX(vi) + 0.5, 0.5 - pos.getY(vi), size) > 0.5
  for (let t = 0; t < idx.length; t += 3) if (inside(idx[t]) && inside(idx[t + 1]) && inside(idx[t + 2])) keep.push(idx[t], idx[t + 1], idx[t + 2])
  face.setIndex(keep)
  // Its bounds are the pin's, not the whole square: the grid's unused corners stay in the geometry,
  // and measured with them every pin framed as the full picture, margin and all (PinInspector's fit)
  const used = Array.from(new Set(keep))
  const faceBounds = () => {
    const b = new THREE.Box3(), v = new THREE.Vector3()
    for (const i of used) b.expandByPoint(v.fromBufferAttribute(pos, i))
    face.boundingBox = b
  }
  faceBounds()
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
  // outline the body is built from, so the skirt is one clean wall meeting the body's bevel — not a
  // staircase. Onto the nearest point along the outline's segments, not its nearest corner: corners
  // can be a few grid cells apart, and a vertex pulled that far sideways made a spike at the edge.
  // (Holes don't cut the face's mesh — see holeWalls below.)
  const segs: number[] = [] // x1, y1, x2, y2, 0
  const addLoop = (pts: THREE.Vector2[]) => {
    for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; segs.push(a.x, a.y, b.x, b.y, 0) }
  }
  addLoop(outline.getPoints())
  const reach = 4 / grid
  const bins = new Map<number, number[]>() // segments by the reach-sized cells they touch
  const binOf = (cx: number, cy: number) => (cx + 4096) * 8192 + (cy + 4096)
  for (let s = 0; s < segs.length; s += 5) {
    const x0 = Math.floor(Math.min(segs[s], segs[s + 2]) / reach), x1 = Math.floor(Math.max(segs[s], segs[s + 2]) / reach)
    const y0 = Math.floor(Math.min(segs[s + 1], segs[s + 3]) / reach), y1 = Math.floor(Math.max(segs[s + 1], segs[s + 3]) / reach)
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
      const k = binOf(cx, cy)
      const list = bins.get(k)
      if (list) list.push(s); else bins.set(k, [s])
    }
  }
  const uv = face.attributes.uv
  const snapped = new Set<number>()
  for (const v of rim) {
    if (v < 0 || snapped.has(v)) continue
    snapped.add(v)
    const x = pos.getX(v), y = pos.getY(v)
    let bd = reach * reach, bx = 0, by = 0, found = false
    const cx = Math.floor(x / reach), cy = Math.floor(y / reach)
    for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
      for (const s of bins.get(binOf(cx + ox, cy + oy)) ?? []) {
        const ax = segs[s], ay = segs[s + 1], dx = segs[s + 2] - ax, dy = segs[s + 3] - ay
        const l2 = dx * dx + dy * dy
        const t = l2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0
        const px = ax + t * dx, py = ay + t * dy, d = (px - x) ** 2 + (py - y) ** 2
        if (d < bd) { bd = d; bx = px; by = py; found = true }
      }
    }
    if (!found) continue
    pos.setXY(v, bx, by)
    uv.setXY(v, bx + 0.5, by + 0.5)
  }
  uv.needsUpdate = true
  const skirtPos = new Float32Array(rim.length * 3)
  rim.forEach((v, i) => {
    const src = v >= 0 ? v : -1 - v
    skirtPos[i * 3] = pos.getX(src); skirtPos[i * 3 + 1] = pos.getY(src)
    skirtPos[i * 3 + 2] = front - 0.004
  })
  const skirt = new THREE.BufferGeometry()
  skirt.setAttribute('position', new THREE.BufferAttribute(skirtPos, 3))
  const skirtMat = gold.clone()
  skirtMat.side = THREE.DoubleSide
  group.add(new THREE.Mesh(skirt, skirtMat))

  // Each hole's wall: a band down its smooth edge, from the face (its top follows the face's
  // height, set in setHeight) through the body to the back plate
  const wallTops: number[] = [] // x, y per loop point, in wall-vertex order (top, bottom pairs)
  const wallIdx: number[] = []
  for (const loop of holeEdges) {
    const first = wallTops.length / 2
    for (let i = 0; i < loop.length; i++) {
      wallTops.push(loop[i].x, loop[i].y)
      const a = (first + i) * 2, b = (first + (i + 1) % loop.length) * 2
      wallIdx.push(a, b, a + 1, b, b + 1, a + 1)
    }
  }
  const wallPos = new Float32Array(wallTops.length * 3)
  for (let p = 0; p < wallTops.length / 2; p++) {
    wallPos.set([wallTops[p * 2], wallTops[p * 2 + 1], front, wallTops[p * 2], wallTops[p * 2 + 1], -BEVEL - 0.0004], p * 6)
  }
  const holeWalls = new THREE.BufferGeometry()
  holeWalls.setAttribute('position', new THREE.BufferAttribute(wallPos, 3))
  holeWalls.setIndex(wallIdx)
  if (wallIdx.length) group.add(new THREE.Mesh(holeWalls, skirtMat))
  if (holeTex) for (const m of bodyParts) for (const mat of ([] as THREE.Material[]).concat(m.material)) holeDiscard(mat, holeTex)
  // The face's height at a point, as its mesh has it (the grid's four corners blended), so a wall's
  // top meets the face exactly — not the height map, which the coarser mesh only approximates
  const faceZ = (x: number, y: number) => {
    const gx = Math.min(grid - 1e-6, Math.max(0, (x + 0.5) * grid)), gy = Math.min(grid - 1e-6, Math.max(0, (0.5 - y) * grid))
    const x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0, row = grid + 1
    const z = (cx: number, cy: number) => pos.getZ(cy * row + cx)
    return (z(x0, y0) * (1 - fx) + z(x0 + 1, y0) * fx) * (1 - fy) + (z(x0, y0 + 1) * (1 - fx) + z(x0 + 1, y0 + 1) * fx) * fy
  }

  function setHeight(h: Float32Array, hsize: number, look?: ReliefLook) {
    const depth = look?.depth ?? RELIEF_DEPTH
    finishUniforms.normalStrength.value = look?.normalStrength ?? 1
    if (holes) h = intoHoles(h, hsize)
    for (let i = 0; i < pos.count; i++) pos.setZ(i, front + 0.0008 + sample(h, pos.getX(i) + 0.5, 0.5 - pos.getY(i), hsize) * depth)
    pos.needsUpdate = true
    face.computeVertexNormals()
    face.computeBoundingSphere()
    faceBounds()
    rim.forEach((v, i) => { if (v >= 0) skirtPos[i * 3 + 2] = pos.getZ(v) })
    skirt.attributes.position.needsUpdate = true
    skirt.computeVertexNormals()
    skirt.computeBoundingSphere()
    if (wallIdx.length) {
      for (let p = 0; p < wallTops.length / 2; p++) wallPos[p * 6 + 2] = faceZ(wallTops[p * 2], wallTops[p * 2 + 1]) + 0.0002
      holeWalls.attributes.position.needsUpdate = true
      holeWalls.computeVertexNormals()
      holeWalls.computeBoundingSphere()
    }
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
  function setDetails(map: Uint8Array | null, msize: number, slots: number[][]) {
    finishUniforms.detailMap.value.dispose()
    if (map && slots.length) {
      const row = msize * 4
      const rows = new Uint8Array(msize * row)
      for (let y = 0; y < msize; y++) rows.set(map.subarray(y * row, (y + 1) * row), (msize - 1 - y) * row) // as setFinish
      const t = new THREE.DataTexture(rows, msize, msize, THREE.RGBAFormat, THREE.UnsignedByteType)
      t.magFilter = t.minFilter = THREE.NearestFilter
      t.needsUpdate = true
      finishUniforms.detailMap.value = t
      slots.slice(0, DETAIL_SLOTS).forEach((s, i) => { finishUniforms.detA.value[i].set(s[0], s[1], s[2], s[3]); finishUniforms.detB.value[i].set(s[4], s[5], s[6], s[7]) })
    } else finishUniforms.detailMap.value = blankFinish()
    finishUniforms.hasDetails.value = map && slots.length ? 1 : 0
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
  // The metal (body, skirt, back) follows the tier too: grey for Grayscale, satin below Full
  const metals: { m: THREE.MeshPhysicalMaterial; color: THREE.Color; roughness: number; clearcoat: number; made: [THREE.Color, number] }[] = []
  group.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshPhysicalMaterial | undefined
    if (m && m !== faceMaterial && 'clearcoat' in m && !metals.some((x) => x.m === m)) metals.push({ m, color: m.color.clone(), roughness: m.roughness, clearcoat: m.clearcoat, made: [m.color.clone(), m.roughness] })
  })
  let tierNow: 1 | 2 | 3 = 3
  // The metal's colour and roughness (the Studio's Global tab): the sides, skirt and hole walls
  // take it as is, the brushed back a touch lighter and rougher (as the gold always was), the
  // relief's gold walls the same colour. No colour = the metal as made.
  function setMetal(color?: string, rough?: number) {
    // the gold as it always was (lib/reliefStudio.ts DEFAULT_METAL) is the metal as made, exactly
    if (color?.toLowerCase() === '#d2a44a' && (rough ?? 0.3) === 0.3) { color = undefined; rough = undefined }
    const c = color ? new THREE.Color(color) : null
    const r = rough ?? 0.3
    for (const e of metals) {
      const back = !!e.m.map
      if (c) { e.color.copy(c); if (back) e.color.offsetHSL(0, 0, 0.03) } else e.color.copy(e.made[0])
      e.roughness = c || rough !== undefined ? Math.min(1, back ? r + 0.12 : r) : e.made[1]
    }
    finishUniforms.wallColor.value.copy(c ?? WALL_GOLD)
    finishUniforms.wallRough.value = c || rough !== undefined ? Math.min(1, r + 0.02) : 0.32
    setTier(tierNow)
  }
  function setTier(tier: 1 | 2 | 3) {
    tierNow = tier
    finishUniforms.tierLook.value = tier
    if (tier < 3 && faceMaterial.transmission > 0) { faceMaterial.transmission = 0; faceMaterial.needsUpdate = true }
    for (const { m, color, roughness, clearcoat } of metals) {
      const l = color.r * 0.299 + color.g * 0.587 + color.b * 0.114
      m.color.copy(tier === 1 ? new THREE.Color(l, l, l) : color)
      // Grayscale is polished silver-grey (a little shine, a light clearcoat); Painted is satin
      m.roughness = tier === 1 ? Math.max(roughness, 0.32) : tier === 2 ? Math.max(roughness, 0.6) : roughness
      m.clearcoat = tier === 1 ? Math.min(clearcoat, 0.4) : tier === 2 ? 0 : clearcoat
    }
  }
  // The textures only the shaders hold (not in any material slot, so disposing the materials
  // missed them — every rebuilt pin left its maps on the GPU until the context ran out): freed by
  // whoever disposes the group (disposeRelief)
  group.userData.disposeTextures = () => {
    for (const u of [finishUniforms.finishMap, finishUniforms.detailMap, finishUniforms.lentAtlas]) if (u.value !== blankFinish()) u.value.dispose()
    holeTex?.dispose()
    overlayTex?.dispose()
  }
  const setNormalStrength = (s: number) => { finishUniforms.normalStrength.value = s }
  return { group, faceMaterial, backZ, outline, setHeight, setHighlight, setOverlay, setFinish, setDetails, setNormalStrength, setMetal, setLenticular, setTier }
}

// The art's own holes (transparent areas the pin encloses: everything transparent that a flood
// from the border can't reach), from the cutout at full size (`alpha`, an²) — rounded off by
// `smooth` (a blurred mask cut at half, as the Studio's Hole finish does: the raw pixel edge traced
// as a ragged, stair-stepped wall) — merged into `holes` at the larger of the two sizes. `fill`
// (an²): transparent pixels the smoothing gave back to the face; `raw` (an²): the art's holes as they
// are. Unchanged/null without holes.
function withArtHoles(holes: { mask: Uint8Array; size: number } | undefined, alpha: Float32Array, an: number, smooth: number): { holes?: { mask: Uint8Array; size: number }; fill: Uint8Array | null; raw: Uint8Array | null } {
  const n = an * an
  const open = new Uint8Array(n) // transparent and reachable from the border
  const stack: number[] = []
  for (let i = 0; i < an; i++) for (const q of [i, n - an + i, i * an, i * an + an - 1]) if (alpha[q] <= 0.5 && !open[q]) { open[q] = 1; stack.push(q) }
  while (stack.length) {
    const q = stack.pop()!
    const x = q % an
    for (const r of [x > 0 ? q - 1 : -1, x < an - 1 ? q + 1 : -1, q >= an ? q - an : -1, q < n - an ? q + an : -1]) {
      if (r >= 0 && alpha[r] <= 0.5 && !open[r]) { open[r] = 1; stack.push(r) }
    }
  }
  let any = false
  const raw = new Float32Array(n)
  for (let i = 0; i < n; i++) if (alpha[i] <= 0.5 && !open[i]) { raw[i] = 1; any = true }
  if (!any) return { holes, fill: null, raw: null }
  const soft = blur(raw, Math.max(1, smooth * 24 * an / 2048), an)
  const size = Math.max(an, holes?.size ?? 0)
  const mask = new Uint8Array(size * size)
  const ka = an / size, kh = holes ? holes.size / size : 0
  for (let i = 0; i < mask.length; i++) {
    const y = Math.floor(i / size), x = i % size
    mask[i] = (soft[Math.floor(y * ka) * an + Math.floor(x * ka)] >= 0.5 ? 1 : 0) || (holes ? holes.mask[Math.floor(y * kh) * holes.size + Math.floor(x * kh)] : 0)
  }
  const fill = Uint8Array.from(raw, (v, i) => (v && soft[i] < 0.5 ? 1 : 0))
  return { holes: { mask, size }, fill, raw: Uint8Array.from(raw) }
}

// A hole mask as a smooth field (the mask lightly blurred) — its 0.5 line is the hole's edge, both
// for the face (holeTexture: cut per screen pixel) and the wall (holeLoops: traced between pixels),
// so the two always meet. Pixel-traced outlines and a face cut by whole mesh triangles never quite
// lined up: saw teeth and spikes all along the edge.
function holeField(mask: Uint8Array, size: number, grow = 0): Float32Array {
  if (grow > 0) mask = dilate(mask, size, grow)
  return blur(Float32Array.from(mask), Math.max(1, 1.5 * size / 2048), size)
}

// The body and back plate cut along the hole map (holeTexture) per pixel, as the face is: their
// x, y is the face's, so the map's coordinate is the position + 0.5
function holeDiscard(mat: THREE.Material, map: THREE.Texture) {
  mat.onBeforeCompile = (s) => {
    s.uniforms.holeMap = { value: map }
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vHoleUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHoleUv = position.xy + 0.5;')
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D holeMap;\nvarying vec2 vHoleUv;')
      .replace('void main() {', 'void main() {\nif (texture2D(holeMap, vHoleUv).r > 0.5) discard;')
  }
  mat.customProgramCacheKey = () => 'hole-discard'
  mat.needsUpdate = true
}

function holeTexture(field: Float32Array, size: number): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(size, size)
  for (let i = 0; i < field.length; i++) { const v = Math.round(field[i] * 255); img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255 }
  ctx.putImageData(img, 0, 0)
  const t = new THREE.CanvasTexture(c)
  t.minFilter = THREE.LinearFilter // no mipmaps: a far-off pin's holes mustn't swell or close
  t.generateMipmaps = false
  return t
}

// The field's 0.5 line as closed loops in the pin's coordinates (marching squares, interpolated
// between pixels, one point per `step` px, then `smooth` passes of neighbour averaging), loops
// smaller than `minArea` px² left out. Pixel p sits at the face's texture coordinate (p + 0.5) / size,
// as the art's pixels do.
function holeLoops(field: Float32Array, size: number, minArea = 12, step = 1.5, smooth = 0): THREE.Vector2[][] {
  const iso = 0.5
  const at = (x: number, y: number) => field[y * size + x]
  // edge ids: horizontal (x,y)–(x+1,y) = 2·i, vertical (x,y)–(x,y+1) = 2·i + 1
  const H = (x: number, y: number) => (y * size + x) * 2, V = (x: number, y: number) => (y * size + x) * 2 + 1
  const point = (e: number): [number, number] => {
    const i = e >> 1, x = i % size, y = (i - x) / size
    const a = at(x, y), b = e & 1 ? at(x, y + 1) : at(x + 1, y)
    const t = Math.min(1, Math.max(0, (iso - a) / (b - a || 1e-6)))
    return e & 1 ? [x, y + t] : [x + t, y]
  }
  const link = new Map<number, number[]>()
  const join = (a: number, b: number) => {
    const la = link.get(a); if (la) la.push(b); else link.set(a, [b])
    const lb = link.get(b); if (lb) lb.push(a); else link.set(b, [a])
  }
  for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
    const tl = at(x, y) > iso, tr = at(x + 1, y) > iso, br = at(x + 1, y + 1) > iso, bl = at(x, y + 1) > iso
    const c = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0)
    if (c === 0 || c === 15) continue
    const T = H(x, y), R = V(x + 1, y), B = H(x, y + 1), L = V(x, y)
    switch (c) {
      case 1: case 14: join(L, B); break
      case 2: case 13: join(B, R); break
      case 3: case 12: join(L, R); break
      case 4: case 11: join(T, R); break
      case 6: case 9: join(T, B); break
      case 7: case 8: join(L, T); break
      case 5: case 10: { // a saddle: settled by the cell's middle
        const mid = (at(x, y) + at(x + 1, y) + at(x + 1, y + 1) + at(x, y + 1)) / 4 > iso
        if ((c === 5) === mid) { join(L, T); join(B, R) } else { join(L, B); join(T, R) }
      }
    }
  }
  const loops: THREE.Vector2[][] = []
  const used = new Set<number>()
  for (const start of Array.from(link.keys())) {
    if (used.has(start)) continue
    const pts: [number, number][] = []
    let prev = -1, cur = start
    while (cur !== undefined && !used.has(cur)) {
      used.add(cur)
      pts.push(point(cur))
      const next = link.get(cur)!.find((e) => e !== prev && !used.has(e))
      prev = cur
      cur = next!
    }
    if (pts.length < 3) continue
    let area = 0
    for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; area += a[0] * b[1] - b[0] * a[1] }
    if (Math.abs(area) / 2 < minArea) continue
    let kept: [number, number][] = []
    let lx = Infinity, ly = Infinity
    for (const [px, py] of pts) {
      if ((px - lx) ** 2 + (py - ly) ** 2 < step * step) continue
      lx = px; ly = py
      kept.push([px, py])
    }
    for (let pass = 0; pass < smooth; pass++) {
      kept = kept.map((p, i) => {
        const a = kept[(i + kept.length - 1) % kept.length], b = kept[(i + 1) % kept.length]
        return [(a[0] + 2 * p[0] + b[0]) / 4, (a[1] + 2 * p[1] + b[1]) / 4]
      })
    }
    if (kept.length >= 3) loops.push(kept.map(([px, py]) => new THREE.Vector2((px + 0.5) / size - 0.5, 0.5 - (py + 0.5) / size)))
  }
  return loops
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

/** Frees what a relief pin's shaders hold beyond its materials (call before disposing its meshes). */
export function disposeRelief(group: THREE.Object3D) {
  group.traverse((o) => { (o.userData.disposeTextures as (() => void) | undefined)?.() })
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
uniform float tierLook;   // 1 Grayscale, 2 Painted, 3 Full (the badge's tier)
uniform float normalStrength; // the normal map's tilt, scaled (1 = as made)
uniform vec3 wallColor;       // the metal of the relief's steep walls (the pin's metal)
uniform float wallRough;
uniform sampler2D detailMap; // details over the finishes: R = slot + 16 × coverage
uniform float hasDetails;
uniform vec4 detA[15];    // per slot: lenticular turn (−1 off), its picture set, colour shift (−1 off), foil shine (−1 off)
uniform vec4 detB[15];    // per slot: foil noise, pattern, seed
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
float fin = tierLook < 2.5 ? 0.0 : mod(finV, 16.0); // which finish (none below the Full tier)
float finCov = floor(finV / 16.0) / 15.0; // how much of it shows (feathered edges fade it out)
float finA = finTex.g, finB = finTex.b;
// The details on this pixel. An old finish map's Color Fresnel / Lenticular / Pattern Foil (5, 7,
// 8: finishes before details existed) is read as Auto with that detail — the same look.
float dLent = -1.0, dSet = 0.0, dFres = -1.0, dShine = -1.0, dNoise = 0.0, dPat = 0.0, dSeed = 0.0, dCov = 0.0;
if (fin > 4.5 && fin < 5.5) { dFres = finA; dCov = finCov; fin = 0.0; }
else if (fin > 6.5 && fin < 7.5) { dLent = finA; dSet = floor(finB * 255.0 + 0.5); dCov = finCov; fin = 0.0; }
else if (fin > 7.5 && fin < 8.5) {
  float fg = floor(finA * 255.0 + 0.5), fb = floor(finB * 255.0 + 0.5);
  dShine = mod(fg, 16.0) / 15.0; dSeed = floor(fg / 16.0); dNoise = mod(fb, 16.0) / 15.0; dPat = floor(fb / 16.0);
  dCov = finCov; fin = 0.0;
}
if (hasDetails > 0.5 && tierLook > 2.5) {
  float dv = floor(texture2D(detailMap, vMapUv).r * 255.0 + 0.5);
  int slot = int(mod(dv, 16.0)) - 1;
  if (slot >= 0) {
    vec4 a = detA[slot], b = detB[slot];
    dLent = a.x; dSet = a.y; dFres = a.z; dShine = a.w; dNoise = b.x; dPat = b.y; dSeed = b.z;
    dCov = floor(dv / 16.0) / 15.0;
  }
}
// (holes aren't cut by this map: its nearest-pixel ids would cut a stair-step — the smooth
// holeMap does it, before this)
diffuseColor.rgb = mix(diffuseColor.rgb, wallColor, vWall);
if (tierLook < 1.5) diffuseColor.rgb = vec3(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)));`,
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
if (fin < 0.5 && dCov > 0.0) {
  // details over Auto: the surface the old finishes had — part-metal and glossy (foil more metal,
  // so the art's colours stay bright under its glints)
  metalnessFactor = mix(metalnessFactor, dShine >= 0.0 ? 0.6 : 0.25, dCov);
  roughnessFactor = mix(roughnessFactor, dShine >= 0.0 ? 0.1 : 0.12, dCov);
}
metalnessFactor = mix(metalnessFactor, 1.0, vWall);
roughnessFactor = mix(roughnessFactor, wallRough, vWall);
if (tierLook < 1.5) { roughnessFactor = max(roughnessFactor, 0.32); metalnessFactor *= 0.85; }
else if (tierLook < 2.5) { roughnessFactor = max(roughnessFactor, 0.6); metalnessFactor *= 0.6; }`,
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
  }
  diffuseColor.rgb = mix(dBase, diffuseColor.rgb, finCov);
  totalEmissiveRadiance = mix(eBase, totalEmissiveRadiance, finCov);
}
// Details over whatever finish is below (any mix at once): the lenticular pictures, then their
// colours shifted, then the foil's ridges over everything — each blended by its own coverage
if (dCov > 0.0 && vWall < 0.99) {
  vec3 dBase = diffuseColor.rgb, eBase = totalEmissiveRadiance;
  float face = 1.0 - vWall;
  if (dLent >= 0.0 && lentGrid.z > 0.5) {
    // lenticular: turning the pin left/right fades through the pictures — fully turned one way =
    // the first, the other way = the last (dLent: how far a turn that is). Seamless and gradual: each
    // neighbouring pair blends evenly across its whole share of the turn, eased at the ends, with
    // no lens lines (any ridge pattern showed as lines, and a hold-then-switch felt like a snap),
    // driven by the whole pin's tilt — the sculpted surface's own tilt varies pixel to pixel, and
    // mid-fade that showed as a pattern. dSet: which picture set this layer uses.
    vec2 lset = lentSets[int(clamp(dSet, 0.0, 7.0))];
    float n = max(lset.y, 1.0);
    vec3 nG = normalize(vPinN);
    float pos = clamp(nG.x / mix(0.25, 1.0, dLent) * 0.5 + 0.5, 0.0, 1.0) * (n - 1.0);
    float l0 = min(floor(pos), n - 1.0);
    float t = smoothstep(0.0, 1.0, pos - l0);
    float i0 = lset.x + l0, i1 = lset.x + min(l0 + 1.0, n - 1.0);
    vec2 cell0 = vec2(mod(i0, lentGrid.x), floor(i0 / lentGrid.x)), cell1 = vec2(mod(i1, lentGrid.x), floor(i1 / lentGrid.x));
    vec3 pic0 = texture2D(lentAtlas, vec2((cell0.x + vMapUv.x) / lentGrid.x, (lentGrid.y - 1.0 - cell0.y + vMapUv.y) / lentGrid.y)).rgb;
    vec3 pic1 = texture2D(lentAtlas, vec2((cell1.x + vMapUv.x) / lentGrid.x, (lentGrid.y - 1.0 - cell1.y + vMapUv.y) / lentGrid.y)).rgb;
    if (lset.y > 0.5) diffuseColor.rgb = mix(diffuseColor.rgb, mix(pic0, pic1, t), face);
  }
  if (dFres >= 0.0) {
    // color fresnel: straight on, the art exactly as it is; tilted, its colours turn round the
    // colour wheel — further the more it's tilted, and which way it's tilted picks the direction.
    // From the whole pin's tilt (not its sculpted surface), so the piece changes colour as one.
    vec3 nG = normalize(vPinN);
    float tilt = 1.0 - clamp(dot(nG, normalize(vViewPosition)), 0.0, 1.0);
    float amt = smoothstep(0.02, 0.4, tilt) * dFres * face;
    float side = atan(nG.y, nG.x);
    diffuseColor.rgb = hueRotate(diffuseColor.rgb, amt * 3.14159 * (1.0 + 0.6 * sin(side)));
  }
  if (dShine >= 0.0) {
    // pattern foil: microscopic parallel ridges whose slopes tilt the surface back and forth, so
    // thin lines of light run across it as it turns. Noise swirls their direction across the
    // piece (0 = all one way, like brushed metal). Ridges far finer than a screen pixel would only
    // shimmer, so they fade with distance (fwidth) and sharpen up close.
    // dShine, dSeed (0–15), dNoise and dPat — the pattern that steers the ridges: 0 swirl (value noise), 1 perlin, 2 turbulence (folded perlin: creases),
    // 3 cracked ice (Worley cells, straight ridges per shard), 4 gem facets (rings round each
    // Worley cell's centre), 5 sunburst (radiating from the pin's middle). Noise 0 = straight lines.
    float fShine = dShine, fNoise = dNoise, fType = dPat;
    vec2 seed = dSeed * vec2(17.31, 9.73);
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
    normal = normalize(mix(normal, nFoil, dCov));
    // part-metal so the art's colours stay bright, plus thin glints along the ridge crests that
    // run across the foil as the ridges' tilt toward the viewer changes
    float glint = pow(clamp(dot(nFoil, normalize(vec3(-0.35, 0.45, 0.82))), 0.0, 1.0), 22.0) * mix(0.35, 1.4, fShine) * aa;
    vec3 fBase = diffuseColor.rgb;
    totalEmissiveRadiance += (fBase * 0.18 + mix(fBase, vec3(1.0, 0.95, 0.85), 0.6) * glint) * face;
  }
  diffuseColor.rgb = mix(dBase, diffuseColor.rgb, dCov);
  totalEmissiveRadiance = mix(eBase, totalEmissiveRadiance, dCov);
}`,
}

const DETAIL_SLOTS = 15 // = DETAIL_MAX_SLOTS in lib/reliefStudio.ts
const WALL_GOLD = new THREE.Color(0.62, 0.40, 0.12) // the relief's steep walls, as struck gold (linear)

function installWallShader(mat: THREE.MeshPhysicalMaterial) {
  const uniforms = {
    finishMap: { value: blankFinish() as THREE.Texture }, hasFinish: { value: 0 },
    lentAtlas: { value: blankFinish() as THREE.Texture }, lentGrid: { value: new THREE.Vector3(1, 1, 0) },
    lentSets: { value: Array.from({ length: 8 }, () => new THREE.Vector2(0, 0)) },
    tierLook: { value: 3 },
    holeMap: { value: blankFinish() as THREE.Texture }, hasHoles: { value: 0 },
    normalStrength: { value: 1 },
    wallColor: { value: WALL_GOLD.clone() }, wallRough: { value: 0.32 },
    detailMap: { value: blankFinish() as THREE.Texture }, hasDetails: { value: 0 },
    detA: { value: Array.from({ length: DETAIL_SLOTS }, () => new THREE.Vector4(-1, 0, -1, -1)) },
    detB: { value: Array.from({ length: DETAIL_SLOTS }, () => new THREE.Vector4()) },
  }
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, uniforms)
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float wall;\nvarying float vWall;\nvarying vec3 vFoilT;\nvarying vec3 vFoilB;\nvarying vec3 vPinN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWall = wall;\nvFoilT = normalize(normalMatrix * vec3(1.0, 0.0, 0.0));\nvFoilB = normalize(normalMatrix * vec3(0.0, 1.0, 0.0));\nvPinN = normalize(normalMatrix * vec3(0.0, 0.0, 1.0));')
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>' + FINISH_GLSL.head + '\nuniform sampler2D holeMap;\nuniform float hasHoles;')
      // holes: cut along the hole field's smooth 0.5 line (holeField), per pixel
      .replace('#include <map_fragment>', '#include <map_fragment>\nif (hasHoles > 0.5 && texture2D(holeMap, vMapUv).r > 0.5) discard;' + FINISH_GLSL.read)
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>' + FINISH_GLSL.surface)
      // the normal map's strength: up to 1, blended in over the mesh's own normals (0 = the mesh
      // alone); past 1, the map's own tilt (away from the pin's facing) is exaggerated — not its
      // difference from the mesh, which amplified the mesh's detail backwards
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalStrength <= 1.0 ? normalize(mix(nonPerturbedNormal, normal, normalStrength)) : normalize(normalize(vPinN) + (normal - normalize(vPinN)) * normalStrength);\nnormal = normalize(mix(normal, nonPerturbedNormal, vWall));')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>' + FINISH_GLSL.look)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\nif (tierLook < 1.5) totalEmissiveRadiance = vec3(dot(totalEmissiveRadiance, vec3(0.299, 0.587, 0.114)));')
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

function blur(src: Float32Array, radius: number, size = N): Float32Array {
  // Separable box blur, applied twice (≈ gaussian)
  const r = Math.max(1, Math.round(radius))
  let a = src, b = new Float32Array(size * size)
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < size; y++) {
      let acc = 0
      for (let x = -r; x <= r; x++) acc += a[y * size + Math.min(size - 1, Math.max(0, x))]
      for (let x = 0; x < size; x++) {
        b[y * size + x] = acc / (2 * r + 1)
        acc += a[y * size + Math.min(size - 1, x + r + 1)] - a[y * size + Math.max(0, x - r)]
      }
    }
    const c = new Float32Array(size * size)
    for (let x = 0; x < size; x++) {
      let acc = 0
      for (let y = -r; y <= r; y++) acc += b[Math.min(size - 1, Math.max(0, y)) * size + x]
      for (let y = 0; y < size; y++) {
        c[y * size + x] = acc / (2 * r + 1)
        acc += b[Math.min(size - 1, y + r + 1) * size + x] - b[Math.max(0, y - r) * size + x]
      }
    }
    a = c
    b = new Float32Array(size * size)
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
    // clean (a real relief, Auto finish): one shiny painted surface — no guessed metal (detected
    // gold came out patchy, dark gold art turning murky olive as metal)
    if (clean) rough = 0.22
    else if (k[i] === Kind.Gold) { metal = 1; rough = clean ? 0.3 : 0.38 - lum * 0.22 }  // brighter gold = more polished (clean: even polish, no mottling)
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
