import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { assemblePin, type PinBackId } from './pinBacks'

// Straight-on pictures of a 3D pin, made in the staff portal's badge editor:
// - the pin book's picture (the badge's `imageUrl`), so the book shows exactly the 3D pin;
// - both sides of a model, to find which one is the front. Meshy mirrors the front onto the back
//   and isn't consistent about which side is the real one (Origins' is −z, Umbreon's +z), so each
//   side is compared with the uploaded art (`guessFront`) and the editor lets staff pick.
// Orthographic so it's flat-on with no perspective, transparent around the pin.

function loadModel(url: string) {
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url).then((g) => g.scene)
}

export async function renderPinFront(modelUrl: string, opts: { back?: PinBackId; frontPositiveZ?: boolean; size?: number } = {}): Promise<Blob> {
  const model = await loadModel(modelUrl)
  return renderFront(assemblePin(model, opts.back, opts.frontPositiveZ), opts.size ?? 1024)
}

/** Both sides of a model as the front: [the −z side, the +z side] (`frontPositiveZ` false / true). */
export async function renderPinSides(modelUrl: string, back?: PinBackId, size = 320): Promise<[Blob, Blob]> {
  const model = await loadModel(modelUrl)
  const a = await renderFront(assemblePin(model, back, false), size)
  const b = await renderFront(assemblePin(model, back, true), size)
  return [a, b]
}

/** Which side matches the art: 0 = the −z side, 1 = the +z side. The wrong side is the art's
 *  mirror image, so it correlates clearly worse. */
export async function guessFront(sides: [Blob, Blob], artUrl: string): Promise<0 | 1> {
  const art = await thumb(artUrl, true)
  const [a, b] = await Promise.all(sides.map((s) => thumb(URL.createObjectURL(s), false)))
  return correlate(art, b) > correlate(art, a) ? 1 : 0
}

// ── Rendering ───────────────────────────────────────────────────────────────────────────────

async function renderFront(pin: THREE.Group, size: number): Promise<Blob> {
  const SS = 2 // render at twice the size and scale down — sharper than antialiasing alone
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
  try {
    renderer.setPixelRatio(1)
    renderer.setSize(size * SS, size * SS, false)
    renderer.setClearColor(0x000000, 0)
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 0.92
    renderer.outputColorSpace = THREE.SRGBColorSpace

    const scene = new THREE.Scene()
    const pmrem = new THREE.PMREMGenerator(renderer)
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04, 0.1, 100, { size: 1024 }).texture
    // Head-on, a metal pin mostly mirrors the studio and reads flat and pale; at book size that
    // turns the detail to mush. So: less studio reflection, and a low raking key from the top left
    // so every ridge of the relief throws a highlight and a shadow (like a product photo).
    scene.environmentIntensity = 0.5
    const key = new THREE.DirectionalLight(0xfff1d6, 2.6)
    key.position.set(-2.2, 2.6, 1.2)
    const fill = new THREE.DirectionalLight(0xdfe8ff, 0.5)
    fill.position.set(2, -1, 2.5)
    scene.add(key, fill, new THREE.AmbientLight(0xffffff, 0.08), pin)

    // Fit the pin's front (x/y) with a hair of margin
    const box = new THREE.Box3().setFromObject(pin)
    const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3())
    const half = Math.max(s.x, s.y) / 2 * 1.02
    const camera = new THREE.OrthographicCamera(c.x - half, c.x + half, c.y + half, c.y - half, 0.01, 20)
    camera.position.set(c.x, c.y, 5)
    renderer.render(scene, camera)

    // Scale down with a touch of extra contrast and colour so it stays legible small
    const out = document.createElement('canvas')
    out.width = out.height = size
    const ctx = out.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    ctx.filter = 'contrast(1.12) saturate(1.12)'
    ctx.drawImage(renderer.domElement, 0, 0, size, size)
    const blob = await new Promise<Blob | null>((res) => out.toBlob(res, 'image/png'))
    pmrem.dispose()
    if (!blob) throw new Error('Couldn’t render the pin')
    return blob
  } finally {
    renderer.dispose()
  }
}

// ── Comparing with the art ──────────────────────────────────────────────────────────────────

const T = 48 // comparison size

// The pin cropped to its own bounds and shrunk to T×T greyscale. Art can be a JPEG on white, so
// near-white counts as background there; a render's background is transparent.
async function thumb(url: string, whiteIsBackground: boolean): Promise<Float32Array> {
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image(); i.crossOrigin = 'anonymous'
    i.onload = () => res(i); i.onerror = () => rej(new Error('Couldn’t load ' + url)); i.src = url
  })
  const W = 256
  const c = document.createElement('canvas'); c.width = c.height = W
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0, W, W)
  const data = ctx.getImageData(0, 0, W, W), d = data.data
  if (whiteIsBackground) {
    // Make a white backdrop transparent so both images have the same (empty) background
    for (let i = 0; i < W * W; i++) if (d[i * 4] > 235 && d[i * 4 + 1] > 235 && d[i * 4 + 2] > 235) d[i * 4 + 3] = 0
    ctx.putImageData(data, 0, 0)
  }
  const fg = (i: number) => d[i * 4 + 3] > 128
  let x0 = W, y0 = W, x1 = 0, y1 = 0
  for (let i = 0; i < W * W; i++) if (fg(i)) { const x = i % W, y = (i / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  const t = document.createElement('canvas'); t.width = t.height = T
  const tctx = t.getContext('2d', { willReadFrequently: true })!
  tctx.drawImage(c, x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0), 0, 0, T, T)
  const p = tctx.getImageData(0, 0, T, T).data
  const g = new Float32Array(T * T)
  for (let i = 0; i < T * T; i++) g[i] = (0.299 * p[i * 4] + 0.587 * p[i * 4 + 1] + 0.114 * p[i * 4 + 2]) * (p[i * 4 + 3] / 255)
  return g
}

function correlate(a: Float32Array, b: Float32Array): number {
  let ma = 0, mb = 0
  for (let i = 0; i < a.length; i++) { ma += a[i]; mb += b[i] }
  ma /= a.length; mb /= b.length
  let num = 0, da = 0, db = 0
  for (let i = 0; i < a.length; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y }
  return num / Math.sqrt(da * db || 1)
}
