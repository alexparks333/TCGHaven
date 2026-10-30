'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { X, Lock, Check, Move3d } from 'lucide-react'
import { cn } from '@/lib/utils'
import { isMastered, type BadgeDef } from '@/lib/badges'
import { badgeAsset } from '@/lib/badgeAssets'
import { BadgePin, PIN_SILHOUETTE, PIN_STAR, PIN_RIBBON } from './BadgePin'
import { buildRelief, type ReliefLook } from './pinRelief'
import { lenticularPictures, reliefSettings } from '@/lib/reliefStudio'
import { assemblePin, addBackHardware, type PinBackId } from './pinBacks'

// Inspect a Haven Badge in 3D — drag to turn it over, scroll/pinch to zoom, like the pin inspect
// view in Counter-Strike. Opened by clicking a badge in the pin book. Loaded on demand (three.js
// only downloads when this opens).
//
// The pin is a real 3D model: a badge's `model` (.glb/.gltf, e.g. /badges/origins.glb) when it has
// one, otherwise a stand-in built here from the 2D art — a bevelled gold body, an enamel face
// (the art as its texture; rim reads as metal, the middle as glossy enamel), the star and ribbon
// raised in relief, and a back with an engraved back stamp, a post and a clutch.


const TEX_W = 1000
const TEX_H = 1120 // the art's 100 × 112 viewBox

export default function PinInspector({ def, earnedAt, progress, onClose, mystery = false }: {
  def: BadgeDef
  earnedAt?: number
  progress?: [number, number]
  onClose: () => void
  /** Not earned yet: the pin is shown as a pitch-black mystery shape — you can turn it over and
   *  see its silhouette against the light, but none of its design */
  mystery?: boolean
}) {
  const mountRef = useRef<HTMLDivElement>(null)
  const artRef = useRef<HTMLDivElement>(null)
  const api = useRef<StageApi | null>(null)
  const [loading, setLoading] = useState(true)
  // 0–1 while the pin is fetched and built; the pin stays hidden until it's completely ready, so
  // it never flashes up half-built
  const [prog, setProg] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    // Escape closes just this viewer — caught first (capture) and stopped, so a dialog underneath
    // (e.g. the staff portal's badge editor) doesn't close too.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey, true); document.body.style.overflow = prev }
  }, [onClose])

  // Build the 3D stage once the (hidden) 2D art has rendered — its SVG becomes the face texture.
  useEffect(() => {
    const mount = mountRef.current
    const svg = artRef.current?.querySelector('svg')
    if (!mount || !svg) return
    let disposed = false
    let stage: StageApi | null = null
    svgToCanvas(svg).then((faceCanvas) => {
      if (disposed) return
      stage = createStage(mount, faceCanvas)
      api.current = stage
      const done = async () => {
        if (disposed || !stage) return
        if (mystery) stage.blackout()
        setProg(0.97)
        await stage.warm() // compile shaders + draw a frame while still hidden
        if (disposed) return
        setProg(1)
        setLoading(false)
      }
      if (def.model) {
        // The real pin: download (most of the bar), then assemble it with its back
        stage.loadModel(badgeAsset(def.model)!, def.pinBack, def.modelFrontPositiveZ, (f) => { if (!disposed) setProg(0.05 + f * 0.8) })
          .then(done)
          .catch((e) => { setError(`Couldn't load the 3D pin: ${e.message}`); setLoading(false) })
      } else if (def.imageUrl) {
        // No model: a relief built from the uploaded art
        setProg(0.3)
        stage.useRelief(badgeAsset(def.imageUrl)!, badgeAsset(def.depthMapUrl), { ...def.relief, lenticular: def.relief ? lenticularPictures(reliefSettings(def.relief), def.imageUrl).map((set) => set.map((u) => badgeAsset(u)!)) : undefined }, badgeAsset(def.finishMapUrl))
          .then(() => (def.normalMapUrl ? stage?.setNormalMap(badgeAsset(def.normalMapUrl)!) : undefined))
          .then(done)
          .catch((e) => { setError(`Couldn't build the pin from the art: ${e.message}`); setLoading(false) })
      } else {
        done()
      }
    }).catch((e) => { setError(String(e)); setLoading(false) })
    return () => { disposed = true; stage?.dispose(); api.current = null }
  }, [def.model, def.imageUrl, def.normalMapUrl, def.depthMapUrl, def.relief, def.finishMapUrl, def.pinBack, def.modelFrontPositiveZ, mystery])

  const [have, total] = progress ?? [0, def.slots.length]
  const mastered = isMastered(def, progress, !!earnedAt)

  return createPortal(
    // The blur lives on this outermost layer: an ancestor that fades in (opacity) cuts a child's
    // backdrop-filter off from the page, so a blur on an inner layer would show the page sharp.
    <div className="fixed inset-0 z-[90] flex flex-col pin-inspector-in backdrop-blur-xl" role="dialog" aria-label={`${def.name} — 3D view`}>
      {/* The page behind, frosted: blurred and dimmed (darker toward the edges) so the pin and the
          cream text stay readable over the light parchment */}
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(ellipse at center, rgba(28,20,12,0.42) 0%, rgba(18,13,8,0.72) 75%)' }}
        onClick={onClose}
      />

      {/* Hidden 2D art → the stand-in's face texture */}
      <div ref={artRef} className="absolute -left-[9999px] top-0" aria-hidden><BadgePin art={def.art} size={100} /></div>

      <button onClick={onClose} aria-label="Close" className="absolute top-4 right-4 z-10 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center">
        <X size={20} />
      </button>

      {/* The pin */}
      <div
        ref={mountRef}
        className={cn('relative flex-1 min-h-0 cursor-grab active:cursor-grabbing [&>canvas]:transition-opacity [&>canvas]:duration-500', loading ? '[&>canvas]:opacity-0' : '[&>canvas]:opacity-100')}
      >
        {loading && !error && <PolishingBar value={prog} />}
      </div>

      {/* Name + status */}
      <div className="relative pointer-events-none pb-[calc(env(safe-area-inset-bottom)+20px)] px-5 text-center">
        <div className="inline-flex items-center gap-1.5 text-[11px] text-white/45 mb-2"><Move3d size={13} />Drag to turn it over · scroll to zoom</div>
        <div className="text-2xl font-black text-[#fbe9c4] tracking-tight">{def.name}</div>
        <div className={cn('mt-1 inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider', earnedAt ? 'text-emerald-400' : 'text-white/50')}>
          {earnedAt
            ? <><Check size={13} />Earned {new Date(earnedAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</>
            : <><Lock size={13} />Not earned yet · {have} / {total} {def.slotNoun}</>}
        </div>
        {mastered && <div className="mt-1 text-xs font-bold uppercase tracking-wider text-amber-300">✦ Mastered</div>}
        {!!earnedAt && def.growing && !mastered && (
          <div className="mt-1 text-xs font-semibold text-white/55">{have} / {def.slots.length} {def.slotNoun} · {Math.max(0, def.slots.length - have)} more to master it</div>
        )}
        <p className="mt-2 text-sm text-white/60 max-w-md mx-auto">{def.description}</p>
        {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
      </div>

    </div>,
    document.body,
  )
}

// Shown in place of the pin until it's fully built
function PolishingBar({ value }: { value: number }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      <div className="w-56 text-center">
        <div className="text-sm font-semibold text-[#fbe9c4]/85 mb-2.5 tracking-wide">Polishing badge…</div>
        <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full rounded-full transition-[width] duration-300 ease-out"
            style={{ width: `${Math.round(Math.max(0.04, value) * 100)}%`, background: 'linear-gradient(90deg, #a87a2c, #f3d48a, #c9973f)' }}
          />
        </div>
        <div className="text-[11px] text-white/40 mt-1.5 tabular-nums">{Math.round(value * 100)}%</div>
      </div>
    </div>
  )
}

// ── The three.js stage ──────────────────────────────────────────────────────────────────────

interface StageApi {
  loadModel: (url: string, back?: PinBackId, frontPositiveZ?: boolean, onProgress?: (fraction: number) => void) => Promise<void>
  warm: () => Promise<void>
  blackout: () => void
  useRelief: (url: string, depthUrl?: string, look?: ReliefLook, finishUrl?: string) => Promise<void>
  setFaceImage: (url: string) => Promise<void>
  setNormalMap: (url: string) => Promise<void>
  reset: () => void
  dispose: () => void
}

// The studio's reflections, sharp enough that polished gold doesn't mirror its pixels as little
// staircase blocks (three.js's default 256 did); phones get a lighter one
const ENV_SIZE = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches ? 512 : 1024

function createStage(mount: HTMLDivElement, faceCanvas: HTMLCanvasElement): StageApi {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(mount.clientWidth, mount.clientHeight)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 0.85
  renderer.outputColorSpace = THREE.SRGBColorSpace
  mount.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  const pmrem = new THREE.PMREMGenerator(renderer)
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04, 0.1, 100, { size: ENV_SIZE }).texture
  scene.environment = envTex
  // Dramatic, not flat: only a little all-round studio reflection (a lot of it lights the front
  // evenly and reads overexposed); the shape comes from a strong low key light instead
  scene.environmentIntensity = 0.32

  const camera = new THREE.PerspectiveCamera(30, mount.clientWidth / mount.clientHeight, 0.05, 50)
  camera.position.set(0, 0, 3.1) // refined by fit() once the pin is in

  // Key: warm, strong, raking in from the upper left so every ridge gets a hot edge and every
  // recess a shadow. Rim: cool, from behind, outlines the edge as it turns. A faint fill keeps
  // the shadow side from going black.
  const key = new THREE.DirectionalLight(0xffe9c4, 3.2)
  key.position.set(-2.6, 3, 1.6)
  const rim = new THREE.DirectionalLight(0xa9c4ff, 1.6)
  rim.position.set(2.5, 1.2, -2.5)
  const fill = new THREE.DirectionalLight(0xc9d6ff, 0.35)
  fill.position.set(2.5, -1.5, 2)
  // The back faces away from the key; with so little studio reflection its brushed metal would
  // go black, so a softer warm light comes from behind too
  const backKey = new THREE.DirectionalLight(0xffe2b0, 1.8)
  backKey.position.set(-2, 2.5, -2.5)
  scene.add(key, rim, fill, backKey, new THREE.AmbientLight(0xffffff, 0.05))

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.enablePan = false
  controls.minDistance = 1.3
  controls.maxDistance = 6
  controls.autoRotate = true
  controls.autoRotateSpeed = 1.6
  controls.addEventListener('start', () => { controls.autoRotate = false })

  const holder = new THREE.Group()
  scene.add(holder)
  let standIn = buildStandIn(faceCanvas)
  holder.add(standIn.group)
  let current: THREE.Object3D = standIn.group
  let reliefMat: THREE.MeshPhysicalMaterial | null = null

  // Frame the pin so it fills most of the view (FILL of the shorter side) on any screen, keeping
  // whatever angle it's being viewed from; zoom limits follow
  const FILL = 0.84
  const fit = () => {
    const size = new THREE.Box3().setFromObject(current).getSize(new THREE.Vector3())
    const extent = Math.max(size.x, size.y, 0.01)
    const view = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.min(1, camera.aspect)
    const d = extent / (FILL * view)
    camera.position.setLength(d)
    controls.minDistance = d * 0.45
    controls.maxDistance = d * 2.2
    controls.update()
  }
  const resize = () => {
    const w = mount.clientWidth, h = mount.clientHeight
    renderer.setSize(w, h)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    fit()
  }
  const ro = new ResizeObserver(resize)
  ro.observe(mount)

  let raf = 0
  const tick = () => {
    controls.update()
    renderer.render(scene, camera)
    raf = requestAnimationFrame(tick)
  }
  tick()

  const texLoader = new THREE.TextureLoader()
  texLoader.setCrossOrigin('anonymous')
  const loadTex = (url: string) => texLoader.loadAsync(url)

  function show(obj: THREE.Object3D) {
    holder.remove(current)
    if (current !== standIn.group) disposeObject(current)
    holder.add(obj)
    current = obj
    fit()
  }

  return {
    async loadModel(url, back, frontPositiveZ, onProgress) {
      // Pins are shipped meshopt-compressed (gltf-transform optimize --compress meshopt)
      const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url, (e) => {
        // Size unknown (e.g. an older cached copy without it): ease toward full by bytes received
        onProgress?.(e.lengthComputable && e.total ? e.loaded / e.total : 1 - Math.exp(-e.loaded / 8e6))
      })
      onProgress?.(1)
      await new Promise((r) => setTimeout(r, 0)) // let the bar paint before the heavy assembly
      // Front half of the model + a standard Haven pin back (pinBacks.ts)
      show(assemblePin(gltf.scene, back, frontPositiveZ))
    },
    async setFaceImage(url) {
      const tex = await loadTex(url)
      tex.colorSpace = THREE.SRGBColorSpace
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy()
      standIn.setFace(tex)
      show(standIn.group)
    },
    // The mystery look: every surface pitch black and unlit — a pure silhouette you can turn over
    // (its outline changes as it rotates) but with no design, colour, shading or glow to read
    blackout() {
      const ink = new THREE.MeshBasicMaterial({ color: 0x000000 })
      current.traverse((o) => {
        const m = o as THREE.Mesh
        if (!m.isMesh) return
        const old = Array.isArray(m.material) ? m.material : [m.material]
        old.forEach((x) => x.dispose())
        m.material = ink
      })
    },
    async warm() {
      renderer.compile(scene, camera)
      renderer.render(scene, camera)
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    },
    async useRelief(url, depthUrl, look, finishUrl) {
      const r = await buildRelief(url, renderer.capabilities.getMaxAnisotropy(), depthUrl, look, finishUrl)
      addBackHardware(r.group, r.backZ)
      reliefMat = r.faceMaterial
      show(r.group)
    },
    async setNormalMap(url) {
      const tex = await loadTex(url)
      if (reliefMat && current !== standIn.group) {
        // HavenRelief's normals are object space (x right, y up, z out of the pin): they replace
        // the displaced mesh's normals rather than tilting them a second time
        reliefMat.normalMap = tex
        reliefMat.normalMapType = THREE.ObjectSpaceNormalMap
        reliefMat.needsUpdate = true
        return
      }
      standIn.setNormal(tex)
      show(standIn.group)
    },
    reset() {
      disposeObject(standIn.group)
      standIn = buildStandIn(faceCanvas)
      holder.remove(current)
      holder.add(standIn.group)
      current = standIn.group
      controls.reset()
      controls.autoRotate = true
    },
    dispose() {
      cancelAnimationFrame(raf)
      ro.disconnect()
      controls.dispose()
      disposeObject(holder)
      envTex.dispose()
      pmrem.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}

// ── The stand-in pin ────────────────────────────────────────────────────────────────────────

// An SVG path (in the art's 100 × 112 units) → a three.js shape centred on the origin, 1 unit = 100.
function pathShape(d: string, scale = 1): THREE.Shape[] {
  const data = new SVGLoader().parse(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 112"><path d="${d}"/></svg>`)
  return data.paths.flatMap((p) => SVGLoader.createShapes(p)).map((shape) => {
    const pts = shape.getPoints(32).map((v) => new THREE.Vector2(((v.x - 50) * scale) / 100, ((56 - v.y) * scale) / 100))
    return new THREE.Shape(pts)
  })
}

// Map a flat geometry's xy (pin units) onto the art texture.
function artUVs(geo: THREE.BufferGeometry) {
  const pos = geo.attributes.position, uv = geo.attributes.uv
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) + 0.5, (pos.getY(i) + 0.56) / 1.12)
  uv.needsUpdate = true
}

function buildStandIn(faceCanvas: HTMLCanvasElement) {
  const group = new THREE.Group()
  const gold = new THREE.MeshPhysicalMaterial({ color: 0xd6a646, metalness: 1, roughness: 0.26, clearcoat: 0.3 })

  // Body: the silhouette extruded with a rounded bevel. Front face sits at z = 0.07.
  const DEPTH = 0.05, BEVEL = 0.02
  const bodyGeo = new THREE.ExtrudeGeometry(pathShape(PIN_SILHOUETTE), { depth: DEPTH, bevelEnabled: true, bevelThickness: BEVEL, bevelSize: 0.014, bevelSegments: 6, curveSegments: 24 })
  group.add(new THREE.Mesh(bodyGeo, gold))
  const FRONT = DEPTH + BEVEL

  // Enamel face: the art as colour; the outer band is metal, the middle glossy enamel.
  const faceTex = new THREE.CanvasTexture(faceCanvas)
  faceTex.colorSpace = THREE.SRGBColorSpace
  const orm = materialMaps()
  const faceMat = new THREE.MeshPhysicalMaterial({
    map: faceTex, roughnessMap: orm, metalnessMap: orm, roughness: 1, metalness: 1,
    bumpMap: heightMap(), bumpScale: 3,
    clearcoat: 0.8, clearcoatRoughness: 0.08,
  })
  const faceGeo = new THREE.ShapeGeometry(pathShape(PIN_SILHOUETTE), 24)
  artUVs(faceGeo)
  const face = new THREE.Mesh(faceGeo, faceMat)
  face.position.z = FRONT + 0.0004
  group.add(face)

  // Raised relief: star + ribbon, their tops printed with the same art (so the ribbon keeps its text).
  const reliefMat = new THREE.MeshPhysicalMaterial({ map: faceTex, metalness: 1, roughness: 0.22, clearcoat: 0.5 })
  for (const d of [PIN_STAR, PIN_RIBBON]) {
    const geo = new THREE.ExtrudeGeometry(pathShape(d), { depth: 0.012, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.004, bevelSegments: 3 })
    artUVs(geo)
    const m = new THREE.Mesh(geo, [reliefMat, gold])
    m.position.z = FRONT
    group.add(m)
  }

  // Back: brushed plate with an engraved back stamp, a post and a butterfly clutch.
  const backGeo = new THREE.ShapeGeometry(pathShape(PIN_SILHOUETTE, 0.94), 24)
  artUVs(backGeo)
  const back = new THREE.Mesh(backGeo, new THREE.MeshPhysicalMaterial({ map: backStamp(), metalness: 1, roughness: 0.42, color: 0xd9b25e }))
  back.rotation.y = Math.PI
  back.position.z = -BEVEL - 0.0004
  group.add(back)

  addBackHardware(group, -BEVEL)

  return {
    group,
    setFace(tex: THREE.Texture) { faceMat.map = tex; reliefMat.map = tex; faceMat.needsUpdate = true; reliefMat.needsUpdate = true },
    setNormal(tex: THREE.Texture) { faceMat.normalMap = tex; faceMat.bumpMap = null; faceMat.needsUpdate = true },
  }
}

// The pin post and butterfly clutch on the back, below `backZ`.

// Draw a path (art units) onto a canvas the size of the art texture.
function drawPath(ctx: CanvasRenderingContext2D, d: string, fill: string, scale = 1) {
  ctx.save()
  ctx.scale(TEX_W / 100, TEX_H / 112)
  ctx.translate(50, 56)
  ctx.scale(scale, scale)
  ctx.translate(-50, -56)
  ctx.fillStyle = fill
  ctx.fill(new Path2D(d))
  ctx.restore()
}

function canvas() {
  const c = document.createElement('canvas')
  c.width = TEX_W
  c.height = TEX_H
  return c
}

// Roughness (green) + metalness (blue): the outer band and the inner ring are polished metal, the
// enamel is glossy and non-metallic.
function materialMaps() {
  const c = canvas()
  const ctx = c.getContext('2d')!
  ctx.fillStyle = 'rgb(0,70,255)'
  ctx.fillRect(0, 0, TEX_W, TEX_H)
  drawPath(ctx, PIN_SILHOUETTE, 'rgb(0,30,0)', 0.86)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.NoColorSpace
  return t
}

// Height for the bump map: the rim stands proud of the recessed enamel.
function heightMap() {
  const c = canvas()
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, TEX_W, TEX_H)
  drawPath(ctx, PIN_SILHOUETTE, '#9a9a9a', 0.86)
  ctx.filter = 'blur(3px)'
  ctx.drawImage(c, 0, 0)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.NoColorSpace
  return t
}

// The back of the pin: brushed metal with "TCG HAVEN" stamped in.
function backStamp() {
  const c = canvas()
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#b8b8b8'
  ctx.fillRect(0, 0, TEX_W, TEX_H)
  for (let y = 0; y < TEX_H; y += 3) {
    ctx.fillStyle = `rgba(255,255,255,${0.04 + Math.random() * 0.08})`
    ctx.fillRect(0, y, TEX_W, 1)
  }
  ctx.fillStyle = 'rgba(40,30,15,0.55)'
  ctx.textAlign = 'center'
  ctx.font = '900 64px Inter, system-ui, sans-serif'
  ctx.fillText('TCG HAVEN', TEX_W / 2, TEX_H * 0.36)
  ctx.font = '700 34px Inter, system-ui, sans-serif'
  ctx.fillText('HAVEN BADGES · OFFICIAL PIN', TEX_W / 2, TEX_H * 0.36 + 56)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

// Render the badge's 2D SVG art into a canvas (the stand-in's face texture).
async function svgToCanvas(svg: SVGSVGElement): Promise<HTMLCanvasElement> {
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('width', String(TEX_W))
  clone.setAttribute('height', String(TEX_H))
  clone.removeAttribute('style')
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const c = canvas()
    c.getContext('2d')!.drawImage(img, 0, 0, TEX_W, TEX_H)
    return c
  } finally {
    URL.revokeObjectURL(url)
  }
}

function disposeObject(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.geometry.dispose()
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const m of mats) {
      for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose()
      m.dispose()
    }
  })
}
