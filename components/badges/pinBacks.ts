import * as THREE from 'three'
import { traceOutline, brushedBack, backPlateGeometry } from './pinRelief'

// Pin backs — every Haven pin gets one of a few standard backs, whatever made its front.
//
// A pin model from an image-to-3D tool (Meshy) has a made-up back: it mirrors the front. So
// `assemblePin()` keeps only the front half — the model is cut through its middle and everything
// behind the cut is flattened onto it — then covers that with a brushed-gold back plate cut to the
// pin's own silhouette (with the TCG HAVEN back stamp) and the chosen hardware. The pin comes out
// the same size and orientation as the relief/stand-in pins: x/y fit in a unit square, front +z.

import type { PinBackId } from '@/lib/badges'
export type { PinBackId } from '@/lib/badges'

const MASK = 512 // silhouette resolution for the back plate
const BODY_DEPTH = 0.07 // metal behind the front (the pin is ~1 wide), about as thick as the front's relief

// Which side is the real front varies per Meshy model (the other side is its mirror image):
// `frontPositiveZ` says so — chosen in the badge editor's "Front of the pin". Unset = the −z side.
// `reliefDepth`: squash the front into a bas-relief at most this tall (the pin is 1 wide) — for
// models where Meshy sculpted a figure fully in the round (e.g. a character "climbing out" of the
// coin). Shallow detail keeps nearly its full depth; tall parts are compressed smoothly toward
// the limit (h → D·tanh(h/D)), like a sculptor making a coin from a 3D model. Unset = as modelled.
export function assemblePin(root: THREE.Object3D, back: PinBackId = 'classic', frontPositiveZ = false, reliefDepth?: number): THREE.Group {
  root.updateMatrixWorld(true)
  const meshes: THREE.Mesh[] = []
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh) })
  // Plain float copies in world space, turned to face +z (shipped models are quantized, which
  // can't be edited freely). Done with raw array loops: three's per-vertex accessors took ~5s on
  // a 1.2M-triangle Meshy model.
  const turn = new THREE.Matrix4().makeRotationY(frontPositiveZ ? 0 : Math.PI)
  const parts = meshes.map((m) => new THREE.Mesh(bakeGeometry(m.geometry, turn.clone().multiply(m.matrixWorld)), m.material))

  // Fit: centred, x/y into a unit square
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  for (const p of parts) {
    const a = p.geometry.attributes.position.array as Float32Array
    for (let i = 0; i < a.length; i += 3) for (let k = 0; k < 3; k++) { const v = a[i + k]; if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v }
  }
  const s = 1 / Math.max(hi[0] - lo[0], hi[1] - lo[1], 1e-6)
  const cx = (lo[0] + hi[0]) / 2, cy = (lo[1] + hi[1]) / 2, cz = (lo[2] + hi[2]) / 2
  for (const p of parts) {
    const a = p.geometry.attributes.position.array as Float32Array
    for (let i = 0; i < a.length; i += 3) { a[i] = (a[i] - cx) * s; a[i + 1] = (a[i + 1] - cy) * s; a[i + 2] = (a[i + 2] - cz) * s }
  }

  // Keep the front half. The mirrored back half's triangles (behind the middle, facing back) are
  // removed — squashing them flat put them in the same plane as the front's recessed parts, and
  // the two flickered through each other. Whatever's left behind the middle (the rim's side wall,
  // a recess dipping past it) is pulled up to the cut. Then trace the silhouette.
  const cutZ = 0
  const mask = new Float32Array(MASK * MASK)
  for (const p of parts) {
    dropBackHalf(p.geometry, cutZ)
    const a = p.geometry.attributes.position.array as Float32Array
    for (let i = 0; i < a.length; i += 3) {
      if (a[i + 2] < cutZ) a[i + 2] = cutZ
      const col = Math.floor((a[i] + 0.5) * MASK), row = Math.floor((0.5 - a[i + 1]) * MASK)
      if (col >= 0 && row >= 0 && col < MASK && row < MASK) mask[row * MASK + col] = 1
    }
    if (reliefDepth) compressRelief(p.geometry, cutZ, reliefDepth)
    p.geometry.computeBoundingSphere()
  }
  const outline = traceOutline(solidify(mask), MASK)

  const group = new THREE.Group()
  for (const p of parts) group.add(p)
  // A solid gold body behind the front, cut to the pin's outline — real pins are a thick slab of
  // metal, not a skin (the bevel is inset so the body never peeks out past the front's edge)
  const BEVEL = 0.008
  const bodyGeo = new THREE.ExtrudeGeometry(outline, {
    depth: BODY_DEPTH - 2 * BEVEL, bevelEnabled: true, bevelThickness: BEVEL, bevelSize: BEVEL, bevelOffset: -BEVEL, bevelSegments: 4,
  })
  const gold = new THREE.MeshPhysicalMaterial({ color: 0xd2a44a, metalness: 1, roughness: 0.26, clearcoat: 0.2 })
  const body = new THREE.Mesh(bodyGeo, gold)
  // A hair behind the flattened front so the two never share a plane (they'd flicker through)
  const GAP = 0.002
  body.position.z = cutZ - GAP - BODY_DEPTH + BEVEL
  group.add(body)
  // The back stamp on its own plate, inset by the bevel so it sits on the body's flat back face
  const backZ = cutZ - GAP - BODY_DEPTH
  const plate = new THREE.Mesh(backPlateGeometry(outline), new THREE.MeshPhysicalMaterial({ map: brushedBack(), metalness: 1, roughness: 0.42, color: 0xd9b25e }))
  plate.scale.setScalar(1 - 2.2 * BEVEL)
  plate.position.z = backZ - 0.0005
  group.add(plate)
  addBackHardware(group, backZ, back)
  return group
}

/** The hardware on a pin's back, at `backZ` (the back's surface), sticking out toward −z. */
export function addBackHardware(group: THREE.Group, backZ: number, back: PinBackId = 'classic') {
  const silver = new THREE.MeshPhysicalMaterial({ color: 0xc9ccd1, metalness: 1, roughness: 0.32 })
  if (back === 'magnet') {
    const dark = new THREE.MeshPhysicalMaterial({ color: 0x55585e, metalness: 1, roughness: 0.5 })
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.02, 48), dark)
    disc.rotation.x = Math.PI / 2
    disc.position.z = backZ - 0.01
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.006, 8, 48), silver)
    rim.position.z = backZ - 0.02
    group.add(disc, rim)
    return
  }
  const xs = back === 'double' ? [-0.2, 0.2] : [0]
  for (const x of xs) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.15, 20), silver)
    post.rotation.x = Math.PI / 2
    post.position.set(x, 0, backZ - 0.075)
    const clutch = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.075, 0.022, 40), silver)
    clutch.rotation.x = Math.PI / 2
    clutch.position.set(x, 0, backZ - 0.1)
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.03, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), silver)
    cap.rotation.x = -Math.PI / 2
    cap.position.set(x, 0, backZ - 0.111)
    group.add(post, clutch, cap)
  }
}

// Bas-relief: height h above the cut → D·tanh(h/D). Normals follow the same mapping exactly
// (inverse-transpose of its Jacobian: n → (nx·f′, ny·f′, nz) with f′ = sech²(h/D)), so lighting
// and the normal map stay right without recomputing normals across UV seams.
function compressRelief(g: THREE.BufferGeometry, cutZ: number, D: number) {
  const p = g.attributes.position.array as Float32Array
  const n = g.attributes.normal?.array as Float32Array | undefined
  for (let i = 0; i < p.length; i += 3) {
    const h = p[i + 2] - cutZ
    const t = Math.tanh(h / D)
    p[i + 2] = cutZ + D * t
    if (n) {
      const f = 1 - t * t // sech²
      const nx = n[i] * f, ny = n[i + 1] * f, nz = n[i + 2]
      const l = Math.hypot(nx, ny, nz) || 1
      n[i] = nx / l; n[i + 1] = ny / l; n[i + 2] = nz / l
    }
  }
}

// Remove triangles that sit behind the cut and face backward (the made-up back of the model)
function dropBackHalf(g: THREE.BufferGeometry, cutZ: number) {
  const p = g.attributes.position.array as Float32Array
  const src = g.index!.array as Uint32Array
  const keep = new Uint32Array(src.length)
  let n = 0
  for (let t = 0; t < src.length; t += 3) {
    const a = src[t] * 3, b = src[t + 1] * 3, c = src[t + 2] * 3
    const behind = p[a + 2] + p[b + 2] + p[c + 2] < 3 * cutZ
    // z of the face normal: (b − a) × (c − a)
    const nz = (p[b] - p[a]) * (p[c + 1] - p[a + 1]) - (p[b + 1] - p[a + 1]) * (p[c] - p[a])
    if (behind && nz < 0) continue
    keep[n++] = src[t]; keep[n++] = src[t + 1]; keep[n++] = src[t + 2]
  }
  g.setIndex(new THREE.BufferAttribute(keep.slice(0, n), 1))
}

type AnyAttr = THREE.BufferAttribute | THREE.InterleavedBufferAttribute

// An attribute's values as plain floats (de-interleaved, de-quantized)
function readFloats(attr: AnyAttr): Float32Array {
  const n = attr.itemSize, count = attr.count, out = new Float32Array(count * n)
  const inter = (attr as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute
  const arr = (inter ? (attr as THREE.InterleavedBufferAttribute).data.array : attr.array) as ArrayLike<number>
  const stride = inter ? (attr as THREE.InterleavedBufferAttribute).data.stride : n
  const off = inter ? (attr as THREE.InterleavedBufferAttribute).offset : 0
  const k = !attr.normalized ? 1
    : arr instanceof Int8Array ? 1 / 127 : arr instanceof Uint8Array ? 1 / 255
    : arr instanceof Int16Array ? 1 / 32767 : arr instanceof Uint16Array ? 1 / 65535 : 1
  const signed = attr.normalized && (arr instanceof Int8Array || arr instanceof Int16Array)
  for (let i = 0, j = off; i < count; i++, j += stride) {
    for (let c = 0; c < n; c++) {
      const v = arr[j + c] * k
      out[i * n + c] = signed && v < -1 ? -1 : v
    }
  }
  return out
}

// A float copy of a geometry with `m` baked in (positions moved, normals turned), always indexed
function bakeGeometry(src: THREE.BufferGeometry, m: THREE.Matrix4): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  const e = m.elements
  const pos = readFloats(src.getAttribute('position'))
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2]
    pos[i] = e[0] * x + e[4] * y + e[8] * z + e[12]
    pos[i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]
    pos[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14]
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const srcNormal = src.getAttribute('normal')
  if (srcNormal) {
    const nrm = readFloats(srcNormal)
    const q = new THREE.Matrix3().getNormalMatrix(m).elements
    for (let i = 0; i < nrm.length; i += 3) {
      const x = nrm[i], y = nrm[i + 1], z = nrm[i + 2]
      const nx = q[0] * x + q[3] * y + q[6] * z, ny = q[1] * x + q[4] * y + q[7] * z, nz = q[2] * x + q[5] * y + q[8] * z
      const l = Math.hypot(nx, ny, nz) || 1
      nrm[i] = nx / l; nrm[i + 1] = ny / l; nrm[i + 2] = nz / l
    }
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3))
  }
  const srcUv = src.getAttribute('uv')
  if (srcUv) g.setAttribute('uv', new THREE.BufferAttribute(readFloats(srcUv), 2))
  const count = pos.length / 3
  const index = src.index ? new Uint32Array(src.index.array as ArrayLike<number>) : Uint32Array.from({ length: count }, (_, i) => i)
  g.setIndex(new THREE.BufferAttribute(index, 1))
  return g
}

// Vertex splats → a solid silhouette: close small gaps between vertices, then fill every hole
// (openings in filigree get a back too, like a real pin).
function solidify(mask: Float32Array): Float32Array {
  // Square max (dilate) / min (erode) filter, separable; outside the grid counts as empty
  const grow = (m: Float32Array, r: number, dilate: boolean) => {
    const pass = (src: Float32Array, horizontal: boolean) => {
      const out = new Float32Array(src.length)
      for (let a = 0; a < MASK; a++) for (let b = 0; b < MASK; b++) {
        let v = dilate ? 0 : 1
        for (let d = -r; d <= r; d++) {
          const bb = b + d
          const x = horizontal ? bb : a, y = horizontal ? a : bb
          const sv = bb >= 0 && bb < MASK ? src[y * MASK + x] : 0
          v = dilate ? Math.max(v, sv) : Math.min(v, sv)
        }
        out[horizontal ? a * MASK + b : b * MASK + a] = v
      }
      return out
    }
    return pass(pass(m, true), false)
  }
  const closed = grow(grow(mask, 3, true), 3, false)
  // Fill holes: anything not reachable from the border is inside
  const outside = new Uint8Array(MASK * MASK)
  const stack: number[] = []
  for (let i = 0; i < MASK; i++) stack.push(i, (MASK - 1) * MASK + i, i * MASK, i * MASK + MASK - 1)
  while (stack.length) {
    const p = stack.pop()!
    if (outside[p] || closed[p] > 0) continue
    outside[p] = 1
    const x = p % MASK, y = (p / MASK) | 0
    if (x > 0) stack.push(p - 1)
    if (x < MASK - 1) stack.push(p + 1)
    if (y > 0) stack.push(p - MASK)
    if (y < MASK - 1) stack.push(p + MASK)
  }
  const solid = new Float32Array(MASK * MASK)
  for (let i = 0; i < solid.length; i++) solid[i] = outside[i] ? 0 : 1
  return solid
}
