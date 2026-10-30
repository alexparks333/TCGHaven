'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { Check, ChevronLeft, ChevronRight, Eye, EyeOff, Loader2, Plus, RotateCcw, Sparkles, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { badgeAsset } from '@/lib/badgeAssets'
import { staffStorage } from '@/lib/firebase/staff'
import type { BadgeDef } from '@/lib/badges'
import {
  FINISHES, FINISH_HOLE, LENTICULAR_MAX_PER_SET, LENTICULAR_MAX_SETS, LENTICULAR_MAX_TOTAL, RELIEF_SERVER, lenticularPictures,
  type LenticularSet, analyzeArt, compose, finishMap, finishPng, heightPng, loadKit, openKit, reliefServerUp, reliefSettings, saveKit,
  type Composed, type ReliefKit, type ReliefSettings,
} from '@/lib/reliefStudio'
import { cleanRelief, type LiveRelief } from '@/components/badges/pinRelief'

// Staff portal → Badges → edit badge → Relief Studio. Uploading pin art in the editor already sent
// it to the HavenRelief analysis server (tools/havenrelief/server.py — the GPU PC for now, a cloud
// GPU later) and saved the kit of raw AI results with the badge, so this opens straight onto the
// controls; everything here is live in the browser: smooth or stepped, levels (each can be
// switched off), softness, depth, detail, gold walls, and per piece (click one on the pin) raise /
// lower / flatten / smooth edges; and on the Material tab, each piece's finish (gold, gemstone,
// holo, lenticular… or a hole right through the pin). "Use this relief" bakes the height and finish
// maps and hands the badge editor its new imageUrl / depthMapUrl / normalMapUrl / finishMapUrl /
// reliefKit / relief — saved with the badge.

const PREVIEW_GRID = 512
type View = 'art' | 'pieces' | 'levels'
// Level colours, lowest → highest (the Levels view and the levels list)
const LEVEL_COLORS = ['#3b4cc0', '#2f8fd8', '#25b8a6', '#7cc54a', '#e3c735', '#f08a2c', '#e0453a', '#c2307f']

export default function ReliefStudio({ badge, onApply, onClose }: {
  badge: BadgeDef
  onApply: (patch: Partial<BadgeDef>) => void | Promise<void>
  onClose: () => void
}) {
  const mountRef = useRef<HTMLDivElement>(null)
  const stage = useRef<Stage | null>(null)
  // Unsaved work from an earlier visit (this computer) wins over what the badge has saved
  const [draft] = useState(() => readDraft(badge.id))
  const restored = !!draft && (draft.kit['art.webp'] !== badge.reliefKit?.['art.webp'] || JSON.stringify(draft.settings) !== JSON.stringify(reliefSettings(badge.relief)))
  const [kitUrls, setKitUrls] = useState<Record<string, string> | null>(restored ? draft!.kit : badge.reliefKit ?? null)
  const [kit, setKit] = useState<ReliefKit | null>(null)
  const [settings, setSettings] = useState<ReliefSettings>(reliefSettings(restored ? draft!.settings : badge.relief))
  const [showRestored, setShowRestored] = useState(restored)
  const [composed, setComposed] = useState<Composed | null>(null)
  const [selected, setSelected] = useState(0) // the layer last clicked — the one the panels show
  const [others, setOthers] = useState<number[]>([]) // more layers picked with Ctrl/Cmd or Shift
  const selection = selected ? [selected, ...others.filter((x) => x !== selected)] : []
  const anchor = useRef(0) // where a Shift-click range starts
  /** A click on a layer (row or pin): plain = just it; Ctrl/Cmd = add/remove it; Shift = the range
   *  of rows from the last click to it (`order` = the rows as shown). */
  function pick(id: number, e?: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }, order?: number[]) {
    if (!id) { setSelected(0); setOthers([]); return }
    if (e?.shiftKey && order && anchor.current && order.includes(anchor.current) && order.includes(id)) {
      const a = order.indexOf(anchor.current), b = order.indexOf(id)
      const range = order.slice(Math.min(a, b), Math.max(a, b) + 1)
      setOthers(Array.from(new Set([...selection, ...range])).filter((x) => x !== id))
      setSelected(id)
      return
    }
    if (e?.ctrlKey || e?.metaKey || e?.shiftKey) {
      if (selection.includes(id)) {
        const rest = selection.filter((x) => x !== id)
        setSelected(rest[0] ?? 0); setOthers(rest.slice(1))
      } else { setOthers(selection); setSelected(id) }
      anchor.current = id
      return
    }
    setSelected(id); setOthers([]); anchor.current = id
  }
  const [tab, setTab] = useState<'relief' | 'material'>('relief')
  const [view, setView] = useState<View>('art')
  const [showSelection, setShowSelection] = useState(true) // the selected piece's tint (H)
  const [hovered, setHovered] = useState(0) // a layer row under the mouse — lit up on the pin
  const [layers, setLayers] = useState<Layer[]>([])
  const [layerFilter, setLayerFilter] = useState<'all' | 'finished'>('all')
  const [original, setOriginal] = useState(false) // Material properties' Finished / Original: the selected layer without its finish
  const layerRows = useRef<Record<number, HTMLDivElement | null>>({})
  const [status, setStatus] = useState<string | null>(null) // what it's busy doing
  const [error, setError] = useState('')
  const [server, setServer] = useState<boolean | null>(null)
  const [quality, setQuality] = useState<'fast' | 'normal' | 'high'>('high')
  const fileInput = useRef<HTMLInputElement>(null)
  const set = (p: Partial<ReliefSettings>) => setSettings((s) => ({ ...s, ...p }))

  // Undo / redo (Ctrl/⌘+Z; Ctrl+X, Ctrl+Y or Ctrl+Shift+Z): the settings as they were, one step per
  // change — a slider drag settles into a single step after a short pause
  const history = useRef<{ past: ReliefSettings[]; future: ReliefSettings[]; committed: ReliefSettings | null; timer: number; restoring: boolean }>(
    { past: [], future: [], committed: null, timer: 0, restoring: false })
  useEffect(() => {
    const h = history.current
    if (!h.committed) { h.committed = settings; return }
    if (h.restoring) { h.restoring = false; h.committed = settings; return }
    window.clearTimeout(h.timer)
    h.timer = window.setTimeout(() => {
      if (h.committed === settings) return
      h.past.push(h.committed!)
      if (h.past.length > 100) h.past.shift()
      h.future = []
      h.committed = settings
    }, 350)
  }, [settings])
  const undoRedo = useRef((redo: boolean) => {})
  undoRedo.current = (redo: boolean) => {
    const h = history.current
    // a change still settling counts as a step of its own first
    if (h.timer && h.committed !== settings) { window.clearTimeout(h.timer); h.past.push(h.committed!); h.future = []; h.committed = settings }
    const from = redo ? h.future : h.past, to = redo ? h.past : h.future
    const next = from.pop()
    if (!next) return
    to.push(settings)
    h.restoring = true
    setSettings(next)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      const typing = e.target instanceof HTMLInputElement && e.target.type !== 'range' && e.target.type !== 'checkbox'
      if ((e.ctrlKey || e.metaKey) && !typing) {
        const k = e.key.toLowerCase()
        if (k === 'z' && !e.shiftKey) { e.preventDefault(); undoRedo.current(false) }
        else if (k === 'y' || k === 'x' || (k === 'z' && e.shiftKey)) { e.preventDefault(); undoRedo.current(true) }
      }
      if ((e.key === 'h' || e.key === 'H') && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement)) setShowSelection((v) => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Open the badge's kit (usually instant — kits are cached); a badge without one is analyzed now
  useEffect(() => {
    let gone = false
    reliefServerUp().then((up) => {
      if (gone) return
      setServer(up)
      if (!kitUrls && up && badge.imageUrl) analyze()
    })
    if (kitUrls) {
      setStatus('Opening the relief kit…')
      openKit(kitUrls, (u) => badgeAsset(u)!)
        .then((k) => { if (!gone) setKit(k) })
        .catch((e) => { if (!gone) setError(String(e.message ?? e)) })
        .finally(() => { if (!gone) setStatus(null) })
    }
    return () => { gone = true }
    // once, when the Studio opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Every change is kept on this computer until it's saved with the badge — closing the Studio or
  // a page reload never loses a relief
  useEffect(() => { if (kitUrls) writeDraft(badge.id, { kit: kitUrls, settings }) }, [badge.id, kitUrls, settings])
  function discardDraft() {
    clearDraft(badge.id)
    setShowRestored(false)
    setSettings(reliefSettings(badge.relief))
    if (badge.reliefKit && badge.reliefKit['art.webp'] !== kitUrls?.['art.webp']) {
      setKitUrls(badge.reliefKit)
      openKit(badge.reliefKit, (u) => badgeAsset(u)!).then(setKit).catch((e) => setError(String(e.message ?? e)))
    }
  }

  const pickRef = useRef(pick)
  pickRef.current = pick

  // The selection brush: hold Tab over the pin and the cursor becomes a circle — every piece it
  // passes over joins the selection (with Alt held: leaves it). Scroll or [ ] while holding Tab
  // resizes it. Turning the pin pauses while Tab is down so the mouse is free to paint.
  const [brush, setBrush] = useState<{ on: boolean; x: number; y: number; r: number; inside: boolean }>({ on: false, x: 0, y: 0, r: 28, inside: false })
  const brushRef = useRef(brush)
  brushRef.current = brush
  const selectionRef = useRef<number[]>([])
  selectionRef.current = selection
  const selectedRef = useRef(0)
  selectedRef.current = selected
  function brushPaint(x: number, y: number, erase: boolean) {
    if (!kit || !stage.current) return
    const hit = stage.current.brushPick(kit, x, y, brushRef.current.r)
    if (!hit.length) return
    const sel = new Set(selectionRef.current)
    const before = sel.size
    let changed = false
    for (const id of hit) {
      if (erase ? sel.delete(id) : !sel.has(id) && (sel.add(id), true)) changed = true
    }
    if (!changed && sel.size === before) return
    const all = Array.from(sel)
    if (!all.length) { setSelected(0); setOthers([]); return }
    const primary = sel.has(selectedRef.current) ? selectedRef.current : all[0]
    setSelected(primary)
    setOthers(all.filter((x) => x !== primary))
    selectionRef.current = [primary, ...all.filter((x) => x !== primary)]
    selectedRef.current = primary
  }
  useEffect(() => {
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLInputElement && !['range', 'checkbox'].includes(e.target.type) || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Tab' && !typing(e)) {
        e.preventDefault() // not focus-hopping while it's the brush key
        if (!brushRef.current.on) { setBrush((b) => ({ ...b, on: true })); stage.current?.setTurning(false) }
      }
      if (brushRef.current.on && (e.key === '[' || e.key === ']')) setBrush((b) => ({ ...b, r: Math.min(160, Math.max(6, b.r * (e.key === ']' ? 1.2 : 1 / 1.2))) }))
    }
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Tab') { setBrush((b) => ({ ...b, on: false })); stage.current?.setTurning(true) }
    }
    const blur = () => { setBrush((b) => ({ ...b, on: false })); stage.current?.setTurning(true) }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur) }
  }, [])

  // The 3D stage lives as long as the Studio
  useEffect(() => {
    const s = createStage(mountRef.current!, (id, e) => pickRef.current(id, e))
    stage.current = s
    return () => { s.dispose(); stage.current = null }
  }, [])

  // A new kit: a new pin on the stage
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (!kit || !stage.current) return
    let gone = false
    setReady(false)
    const url = URL.createObjectURL(kit.art)
    stage.current.load(kit, url).then(() => { if (!gone) setReady(true) })
    return () => { gone = true; URL.revokeObjectURL(url) }
  }, [kit])

  // Shape settings re-run compose; depth/wall only re-mesh
  const shapeKey = JSON.stringify([settings.mode, settings.levels, settings.off, settings.soften, settings.detail, settings.pieces, settings.soft, settings.flat])
  useEffect(() => {
    if (!kit || !ready) return
    const t = setTimeout(() => setComposed(stage.current?.update(kit, settings) ?? null), 30)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kit, ready, shapeKey])
  useEffect(() => {
    if (kit && ready) stage.current?.relook(settings)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kit, ready, settings.depth, settings.wall])
  useEffect(() => {
    if (kit && ready) stage.current?.highlight(kit, hovered ? [hovered] : showSelection ? selection : [])
    // selection is derived from selected + others
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kit, ready, selected, others, showSelection, hovered])
  useEffect(() => {
    if (!kit) return
    let gone = false
    buildLayers(kit).then((l) => { if (!gone) setLayers(l) })
    return () => { gone = true }
  }, [kit])
  useEffect(() => { layerRows.current[selected]?.scrollIntoView({ block: 'nearest' }) }, [selected, tab])
  useEffect(() => { setOriginal(false) }, [selected, others])
  const artUrl = kitUrls?.['art.webp']
  useEffect(() => {
    if (kit && ready) stage.current?.lenticular(lenticularPictures(settings, artUrl).map((set) => set.map((u) => badgeAsset(u)!)))
    // only the pictures matter here, not the rest of the settings
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kit, ready, settings.lenticularSets, artUrl])

  // The Lenticular finish's picture sets (each layer picks one); pictures upload straight away
  const frameInput = useRef<HTMLInputElement>(null)
  const [uploadingFrames, setUploadingFrames] = useState(false)
  const lentSetIndex = Math.min(settings.lenticularSets.length - 1, Math.max(0, settings.finishOpts[selected]?.set ?? 0))
  const lentSet = settings.lenticularSets[lentSetIndex]
  const lentTotal = lenticularPictures(settings, artUrl).reduce((n, s) => n + s.length, 0)
  const setLentSet = (i: number, patch: Partial<LenticularSet>) =>
    setSettings((s) => ({ ...s, lenticularSets: s.lenticularSets.map((x, j) => (j === i ? { ...x, ...patch } : x)) }))
  const chooseLentSet = (i: number) => setOpt('set', i)
  function newLentSet() {
    const i = settings.lenticularSets.length
    setSettings((s) => ({
      ...s,
      lenticularSets: [...s.lenticularSets, { name: `Set ${i + 1}`, frames: [], useArt: false }],
      finishOpts: Object.fromEntries([...Object.entries(s.finishOpts), ...selection.map((id) => [String(id), { ...s.finishOpts[id], set: i }])]),
    }))
  }
  function deleteLentSet(i: number) {
    // layers on it fall back to the first set; layers on later sets keep theirs (renumbered)
    setSettings((s) => {
      const finishOpts: ReliefSettings['finishOpts'] = {}
      for (const [id, o] of Object.entries(s.finishOpts)) {
        const v = o.set ?? 0
        finishOpts[id] = { ...o, set: v === i ? 0 : v > i ? v - 1 : v }
      }
      return { ...s, lenticularSets: s.lenticularSets.filter((_, j) => j !== i), finishOpts }
    })
  }
  async function addFrames(files: FileList | null) {
    if (!files?.length) return
    const room = Math.min(LENTICULAR_MAX_PER_SET - (lentSet.frames.length + (lentSet.useArt && artUrl ? 1 : 0)), LENTICULAR_MAX_TOTAL - lentTotal)
    if (room <= 0) return
    const target = lentSetIndex
    setUploadingFrames(true); setError('')
    try {
      const stamp = Date.now()
      const urls = await Promise.all(Array.from(files).slice(0, room).map(async (f, i) => {
        const r = ref(staffStorage, `badges/${badge.id || 'new'}/lenticular-${stamp}-${i}.${(f.name.split('.').pop() || 'png').toLowerCase()}`)
        await uploadBytes(r, f, { contentType: f.type || 'image/png' })
        return getDownloadURL(r)
      }))
      setSettings((s) => ({ ...s, lenticularSets: s.lenticularSets.map((x, j) => (j === target ? { ...x, frames: [...x.frames, ...urls] } : x)) }))
    } catch (e) {
      setError('Couldn’t upload the pictures — ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setUploadingFrames(false)
      if (frameInput.current) frameInput.current.value = ''
    }
  }
  const moveFrame = (i: number, d: number) => {
    const f = [...lentSet.frames]
    ;[f[i], f[i + d]] = [f[i + d], f[i]]
    setLentSet(lentSetIndex, { frames: f })
  }
  const materialsKey = JSON.stringify([settings.materials, settings.finishOpts, settings.finishOff, original && selection])
  useEffect(() => {
    if (!kit || !ready) return
    // a short pause: changing a hole rebuilds the pin, so a dragged slider rebuilds once, not per tick
    const shown = activeMaterials(settings)
    if (original) for (const id of selection) delete shown[id]
    const t = setTimeout(() => stage.current?.finishes(kit, shown, settings.finishOpts), original ? 0 : 150)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kit, ready, materialsKey])
  useEffect(() => {
    if (kit && ready && composed) stage.current?.paint(kit, view, composed, settings.mode === 'stepped')
  }, [kit, ready, view, composed, settings.mode])

  async function artBlob(): Promise<Blob> {
    const picked = fileInput.current?.files?.[0]
    if (picked) return picked
    if (!badge.imageUrl) throw new Error('Choose the pin art first.')
    const r = await fetch(badgeAsset(badge.imageUrl)!)
    if (!r.ok) throw new Error('Couldn’t download the pin art.')
    return r.blob()
  }

  async function analyze() {
    setError('')
    try {
      const art = await artBlob()
      setStatus(`Analyzing on ${new URL(RELIEF_SERVER).host}… (about a minute on the GPU)`)
      const k = await loadKit(await analyzeArt(art, quality))
      setKit(k); setSelected(0); setOthers([])
      setSettings((s) => ({ ...s, pieces: {}, soft: {}, flat: {}, materials: {}, finishOpts: {}, finishOff: [], names: {}, off: [] })) // piece ids belong to one analysis
      // saved straight away, so the analysis survives whatever happens next
      setStatus('Saving the kit…')
      setKitUrls(await saveKit(staffStorage, badge.id || 'new', k))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setStatus(null) }
  }

  async function apply() {
    if (!kit) return
    setError('')
    try {
      setStatus('Baking the full-size relief…')
      await new Promise((r) => setTimeout(r, 30)) // let the status paint before the heavy work
      const height = await heightPng(compose(kit.full, settings).h, kit.full.size)
      setStatus('Uploading…')
      const id = badge.id || 'new'
      const reliefKit = kitUrls ?? await saveKit(staffStorage, id, kit)
      const stamp = Date.now()
      const put = async (name: string, blob: Blob) => {
        const r = ref(staffStorage, `badges/${id}/${name}-${stamp}.png`)
        await uploadBytes(r, blob, { contentType: 'image/png' })
        return getDownloadURL(r)
      }
      const finish = finishMap(kit.full, activeMaterials(settings), settings.finishOpts)
      setStatus('Saving the badge…')
      await onApply({
        imageUrl: reliefKit['art.webp'], normalMapUrl: reliefKit['normal.png'], depthMapUrl: await put('depth', height),
        finishMapUrl: finish ? await put('finish', await finishPng(finish.map, kit.full.size)) : undefined,
        reliefKit, relief: settings,
      })
      onClose()
    } catch (e) {
      console.error(e)
      setError('Couldn’t save the relief — ' + (e instanceof Error ? e.message : String(e)))
    } finally { setStatus(null) }
  }

  const stepped = settings.mode === 'stepped'
  const offset = settings.pieces[selected] ?? 0
  const soft = settings.soft[selected] ?? 0
  const flat = settings.flat[selected] ?? settings.flatDefault
  const finish = settings.materials[selected] ?? 0
  const finishDef = FINISHES.find((f) => f.id === finish)
  const defaultName = (id: number) => (kit && id > kit.preview.objects ? `Area ${id}` : `Object ${id}`)
  const rename = (id: number, name: string) => {
    const names: Record<string, string> = { ...settings.names, [id]: name }
    if (!name) delete names[id]
    set({ names })
  }
  const toggleFinishOff = (id: number) => set({ finishOff: settings.finishOff.includes(id) ? settings.finishOff.filter((x) => x !== id) : [...settings.finishOff, id] })
  // Layers: ones with a finish first, then the rest biggest first
  const shownLayers = [...layers]
    .filter((l) => layerFilter === 'all' || (settings.materials[l.id] ?? 0) > 0)
    .sort((a, b) => Number((settings.materials[b.id] ?? 0) > 0) - Number((settings.materials[a.id] ?? 0) > 0) || b.area - a.area)
  const usedFinishes = Object.entries(settings.materials).filter(([, f]) => f > 0).sort((x, y) => Number(x[0]) - Number(y[0]))
  const setPiece = (key: 'pieces' | 'soft' | 'flat' | 'materials', value: number) => {
    const next: Record<string, number> = { ...settings[key] }
    // Flatten's "nothing set" means the all-pieces default, so a piece keeps an explicit 0 when that
    // default isn't 0; everything else's "nothing set" is 0
    const unset = key === 'flat' ? settings.flatDefault : 0
    for (const id of selection) { next[id] = value; if (value === unset) delete next[id] }
    set({ [key]: next })
  }
  /** One finish setting (a param, feather, the lenticular set) on every selected layer. */
  const setOpt = (key: string, value: number) => setSettings((s) => {
    const finishOpts = { ...s.finishOpts }
    for (const id of selection) finishOpts[id] = { ...finishOpts[id], [key]: value }
    return { ...s, finishOpts }
  })
  const mixedFinish = selection.some((id) => (settings.materials[id] ?? 0) !== (settings.materials[selected] ?? 0))
  const moved = Object.keys(settings.pieces).length + Object.keys(settings.soft).length + Object.keys(settings.flat).length
  const toggleLevel = (r: number) => set({ off: settings.off.includes(r) ? settings.off.filter((x) => x !== r) : [...settings.off, r] })
  const pieceLevel = composed && selected ? composed.level[selected] : -1
  // The raise/lower range is exactly what this piece can reach: stepped, from the lowest level on
  // to the highest (the old buttons kept counting past the top and bottom with nothing changing)
  const natural = composed && selected && composed.natural[selected] >= 0 ? composed.natural[selected] : 0
  const range = stepped
    ? { min: -natural, max: Math.max(0, (composed?.levelCount ?? settings.levels) - 1 - natural) }
    : { min: -10, max: 10 }
  const clampOffset = (v: number) => Math.min(range.max, Math.max(range.min, stepped ? Math.round(v) : Math.round(v * 10) / 10))

  return createPortal(
    <div className="fixed inset-0 z-[100] flex bg-[#0f0d0b] text-slate-200" role="dialog" aria-label="Relief Studio">
      <div className="relative flex-1 min-w-0">
        <div ref={mountRef} className={cn('absolute inset-0', brush.on && brush.inside && 'cursor-none')}
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            setBrush((b) => ({ ...b, x: e.clientX - r.left, y: e.clientY - r.top, inside: true }))
            if (brushRef.current.on) brushPaint(e.clientX, e.clientY, e.altKey)
          }}
          onMouseLeave={() => setBrush((b) => ({ ...b, inside: false }))}
          onWheel={(e) => { if (brushRef.current.on) setBrush((b) => ({ ...b, r: Math.min(160, Math.max(6, b.r * (e.deltaY < 0 ? 1.12 : 1 / 1.12))) })) }} />
        {brush.on && brush.inside && (
          <div className="absolute pointer-events-none rounded-full border-2 border-amber-400 bg-amber-400/10 shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
            style={{ left: brush.x - brush.r, top: brush.y - brush.r, width: brush.r * 2, height: brush.r * 2 }} />
        )}
        {kit && brush.on && <p className="absolute top-14 left-0 right-0 text-center text-[11px] text-amber-300 pointer-events-none">Painting the selection · hold Alt to erase · scroll or [ ] to resize</p>}
        {kit && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 flex gap-1 p-1 rounded-xl bg-black/50 backdrop-blur">
            {(['art', 'pieces', 'levels'] as const).map((v) => (
              <button key={v} onClick={() => setView(v)} disabled={v === 'levels' && !stepped}
                className={cn('px-3 py-1 rounded-lg text-xs font-semibold capitalize disabled:opacity-30', view === v ? 'bg-white/15 text-white' : 'text-slate-400 hover:text-white')}>{v}</button>
            ))}
            <span className="w-px my-1 bg-white/15" />
            <button onClick={() => setShowSelection((v) => !v)} title="Show the selected piece's highlight (H)"
              className={cn('px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5', showSelection ? 'text-white' : 'text-slate-500 hover:text-white')}>
              {showSelection ? <Eye size={13} /> : <EyeOff size={13} />}Highlight
            </button>
          </div>
        )}
        {!kit && !status && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-sm text-slate-500 max-w-xs text-center">{server === false ? 'The analysis server isn’t running — start it to analyze this art.' : 'Waiting for the pin art’s analysis…'}</p>
          </div>
        )}
        {kit && <p className="absolute bottom-3 left-0 right-0 text-center text-[11px] text-slate-500 pointer-events-none">Drag to turn · scroll to zoom · click a piece to select it · hold Tab to paint a selection</p>}
        {status && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <div className="flex items-center gap-2 text-sm"><Loader2 size={16} className="animate-spin" />{status}</div>
          </div>
        )}
      </div>

      <aside className="w-[340px] shrink-0 border-l border-slate-800 bg-slate-900 flex flex-col">
        <div className="flex items-center px-4 py-3 border-b border-slate-800">
          <h2 className="font-bold text-ink">Relief Studio</h2>
          <span className="ml-2 text-xs text-slate-500 truncate">{badge.name}</span>
          <button onClick={onClose} aria-label="Close" className="ml-auto w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-ink hover:bg-slate-800"><X size={18} /></button>
        </div>
        <div className="grid grid-cols-2 gap-1 m-3 mb-0 p-1 rounded-xl bg-slate-800">
          {(['relief', 'material'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={cn('py-1.5 rounded-lg text-xs font-semibold capitalize', tab === t ? 'bg-slate-600 text-ink' : 'text-slate-400')}>{t}</button>
          ))}
        </div>

        <div className={cn('flex-1 p-4 flex flex-col gap-5', tab === 'material' ? 'min-h-0' : 'overflow-y-auto')}>
          {showRestored && (
            <div className="rounded-xl border border-amber-700/50 bg-amber-900/20 p-3 text-xs text-amber-200 flex items-center gap-2">
              Restored your unsaved changes.
              <button onClick={discardDraft} className="ml-auto underline">Discard</button>
            </div>
          )}
          {tab === 'relief' && (
            <fieldset disabled={!kit} className={cn('flex flex-col gap-4', !kit && 'opacity-40')}>
              <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-800">
                {(['stepped', 'smooth'] as const).map((m) => (
                  <button key={m} onClick={() => set({ mode: m })} className={cn('py-1.5 rounded-lg text-xs font-semibold capitalize', settings.mode === m ? 'bg-slate-600 text-ink' : 'text-slate-400')}>{m}</button>
                ))}
              </div>
              {stepped && (
                <>
                  <Slider label="Levels" value={settings.levels} min={2} max={8} step={1} fmt={(v) => String(v)} onChange={(levels) => set({ levels, off: settings.off.filter((r) => r < levels) })}
                    hint="Flat, evenly spaced heights — like a die-struck pin" />
                  {composed && composed.rankArea.length > 0 && (
                    <div className="flex flex-col gap-1">
                      {Array.from(composed.rankArea, (_, r) => r).reverse().map((r) => {
                        const off = settings.off.includes(r)
                        return (
                          <button key={r} onClick={() => toggleLevel(r)} className={cn('flex items-center gap-2 px-2 py-1 rounded-lg text-xs hover:bg-slate-800', off && 'opacity-45')}>
                            <span className="w-3 h-3 rounded-sm" style={{ background: LEVEL_COLORS[r % LEVEL_COLORS.length] }} />
                            <span className={cn(off && 'line-through')}>Level {r + 1}{r === 0 ? ' · lowest' : r === composed.rankArea.length - 1 ? ' · highest' : ''}</span>
                            <span className="ml-auto tabular-nums text-slate-500">{Math.round(composed.rankArea[r] * 100)}%</span>
                            {off ? <EyeOff size={13} /> : <Eye size={13} className="text-slate-400" />}
                          </button>
                        )
                      })}
                      <span className="text-[11px] text-slate-500">Switch a level off and its pieces join the nearest level still on. The Levels view shows which is which.</span>
                    </div>
                  )}
                </>
              )}
              <Slider label="Flatten all pieces" value={settings.flatDefault} min={0} max={1} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(flatDefault) => set({ flatDefault })}
                hint="100% = every piece one even height (its average). A piece's own Flatten overrides this." />
              <Slider label="Soften steps" value={settings.soften} min={0} max={1} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(soften) => set({ soften })}
                hint="Rounds every step edge — less contour-map, more cast" />
              <Slider label="Depth" value={settings.depth} min={0.008} max={0.06} step={0.001} fmt={(v) => `${(v * 100).toFixed(1)}%`} onChange={(depth) => set({ depth })}
                hint="Of the pin's width. Real pins: about 2–3%" />
              <Slider label="Detail" value={settings.detail} min={0} max={1} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(detail) => set({ detail })}
                hint={stepped ? 'Sculpted detail on top of the flat levels' : 'Sculpted detail on top of the depth'} />
              <Slider label="Gold walls" value={settings.wall} min={0.1} max={0.7} step={0.01} fmt={(v) => `${Math.round(v * 100)}`} onChange={(wall) => set({ wall })}
                hint="Higher = more of each slope drawn as plain struck gold" />

              <div className="flex flex-col gap-2 rounded-xl border border-slate-800 p-3">
                <span className="text-xs font-semibold text-slate-300">
                  {selection.length > 1 ? `${selection.length} pieces — changes apply to all` : selected ? `Piece #${selected}` : 'No piece selected'}
                  {selected > 0 && kit && <span className="font-normal text-slate-500"> · {selected <= kit.preview.objects ? 'object' : 'area between objects'}{stepped && pieceLevel >= 0 ? ` · level ${pieceLevel + 1}` : ''}</span>}
                </span>
                {selected ? (
                  <>
                    <div>
                      <span className="flex items-center text-xs font-semibold text-slate-300">
                        Raise / lower
                        <input type="number" value={offset} step={stepped ? 1 : 0.1} min={range.min} max={range.max}
                          onChange={(e) => setPiece('pieces', clampOffset(Number(e.target.value) || 0))}
                          className="ml-auto w-16 rounded-md bg-slate-800 px-2 py-0.5 text-right tabular-nums text-slate-200" aria-label="Raise or lower, 0 = as analyzed" />
                      </span>
                      <input type="range" min={range.min} max={range.max} step={stepped ? 1 : 0.1} value={offset}
                        onChange={(e) => setPiece('pieces', Number(e.target.value))} className="w-full accent-amber-500" />
                      <span className="block text-[11px] text-slate-500">
                        {stepped ? `Level ${pieceLevel + 1} of ${composed?.levelCount ?? settings.levels}` : 'In tenths of the full height'} · type 0 for as analyzed
                      </span>
                    </div>
                    <Slider label="Flatten" value={flat} min={0} max={1} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setPiece('flat', v)}
                      hint="100% = one even height across the whole piece (its average)" />
                    <Slider label="Smooth edges" value={soft} min={0} max={1} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setPiece('soft', v)}
                      hint="Eases this piece's edges into what's around it" />
                  </>
                ) : (
                  <span className="text-[11px] text-slate-500">Click part of the pin — a face, a gem, the frame — to raise, lower or smooth just that piece. The Pieces view shows them all.</span>
                )}
                {moved > 0 && <button onClick={() => set({ pieces: {}, soft: {}, flat: {} })} className="text-[11px] text-slate-400 underline self-start"><RotateCcw size={11} className="inline mr-1" />Reset every piece</button>}
              </div>

              <details className="rounded-xl border border-slate-800 p-3 text-xs">
                <summary className="cursor-pointer font-semibold text-slate-300">Re-analyze the art</summary>
                <div className="flex flex-col gap-2 mt-2">
                  <div className="flex items-center gap-2">
                    <span className={cn('w-2 h-2 rounded-full', server === null ? 'bg-slate-600' : server ? 'bg-emerald-500' : 'bg-red-500')} />
                    {server === null ? 'Checking the analysis server…' : server ? `Server ready (${new URL(RELIEF_SERVER).host})` : 'Analysis server not running'}
                    {server === false && <button onClick={() => reliefServerUp().then(setServer)} className="ml-auto underline text-slate-400">Retry</button>}
                  </div>
                  {server === false && <p className="text-[11px] leading-snug text-slate-500">On the GPU PC: <code className="text-slate-300">cd tools\havenrelief</code> then <code className="text-slate-300">.venv\Scripts\python server.py</code></p>}
                  <input ref={fileInput} type="file" accept="image/png,image/webp,image/jpeg" className="file:mr-2 file:rounded-lg file:border-0 file:bg-slate-800 file:px-2 file:py-1 file:text-slate-300" />
                  <div className="flex gap-2">
                    <select value={quality} onChange={(e) => setQuality(e.target.value as typeof quality)} className="input-field !py-1.5 text-xs flex-1">
                      <option value="fast">Fast (draft)</option>
                      <option value="normal">Normal</option>
                      <option value="high">High (best detail)</option>
                    </select>
                    <button onClick={analyze} disabled={!server || !!status} className="btn-secondary !py-1.5 text-xs disabled:opacity-50"><Sparkles size={14} />Analyze</button>
                  </div>
                  <span className="text-[11px] text-slate-500">Starts over: piece edits belong to one analysis.</span>
                </div>
              </details>
            </fieldset>
          )}

          {tab === 'material' && (
            <fieldset disabled={!kit} className={cn('flex-1 min-h-0 flex flex-col gap-4', !kit && 'opacity-40')}>
              <section className="shrink-0 flex flex-col gap-2">
                <span className="field-label">Material properties</span>
                {selected ? (
                  <div className="flex flex-col gap-2 rounded-xl border border-slate-800 p-3">
                    {selection.length > 1 ? (
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-ink">{selection.length} layers</span>
                        <span className="text-[11px] text-slate-500">changes apply to all of them</span>
                        <button onClick={() => pick(selected)} className="ml-auto text-[11px] text-slate-400 underline">Just this one</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        {/* eslint-disable-next-line @next/next/no-img-element -- a tiny in-memory render */}
                        {layers.find((l) => l.id === selected)?.thumb && <img src={layers.find((l) => l.id === selected)!.thumb} alt="" className="w-9 h-9 rounded-md bg-black/40 object-contain" />}
                        <input value={settings.names[selected] ?? ''} placeholder={defaultName(selected)} onChange={(e) => rename(selected, e.target.value)}
                          className="flex-1 min-w-0 bg-transparent text-sm font-semibold text-ink placeholder:text-slate-300 outline-none border-b border-transparent focus:border-slate-600" aria-label="Layer name" />
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-1 p-0.5 rounded-lg bg-slate-800 text-xs" role="group" aria-label="Compare">
                      {([false, true] as const).map((o) => (
                        <button key={String(o)} onClick={() => setOriginal(o)} disabled={!finish}
                          className={cn('py-1 rounded-md font-semibold disabled:opacity-40', original === o ? 'bg-slate-600 text-ink' : 'text-slate-400')}>{o ? 'Original' : 'Finished'}</button>
                      ))}
                    </div>
                    <select value={mixedFinish ? 'mixed' : finish} onChange={(e) => { if (e.target.value === 'mixed') return; setOriginal(false); setPiece('materials', Number(e.target.value)) }} className="input-field !py-1.5 text-sm" aria-label="Finish">
                      {mixedFinish && <option value="mixed" disabled>Mixed</option>}
                      {FINISHES.map((f) => <option key={f.id} value={f.id} disabled={f.soon}>{f.name}{f.soon ? ' (coming soon)' : ''}</option>)}
                    </select>
                    <span className="text-[11px] text-slate-500 -mt-1">{finishDef?.hint}</span>
                    {finishDef?.params.map((prm) => prm.options ? (
                      <label key={prm.key} className="block">
                        <span className="text-xs font-semibold text-slate-300">{prm.label}</span>
                        <select value={Math.round(settings.finishOpts[selected]?.[prm.key] ?? prm.def)} onChange={(e) => setOpt(prm.key, Number(e.target.value))}
                          className="input-field !py-1.5 text-sm mt-1">
                          {prm.options.map((o, i) => <option key={o} value={i}>{o}</option>)}
                        </select>
                        {prm.hint && <span className="block text-[11px] text-slate-500 mt-0.5">{prm.hint}</span>}
                      </label>
                    ) : (
                      <Slider key={prm.key} label={prm.label} value={settings.finishOpts[selected]?.[prm.key] ?? prm.def} min={0} max={1}
                        step={prm.steps ? 1 / (prm.steps - 1) : 0.01} hint={prm.hint}
                        fmt={(v) => (prm.steps ? `${Math.round(v * (prm.steps - 1)) + 1} of ${prm.steps}` : `${Math.round(v * 100)}%`)}
                        onChange={(v) => setOpt(prm.key, v)} />
                    ))}
                    {finish > 0 && finish !== FINISH_HOLE && (
                      <Slider label="Feather edges" value={settings.finishOpts[selected]?.feather ?? 0} min={0} max={1} step={0.01}
                        fmt={(v) => `${Math.round(v * 100)}%`} hint="Fades the finish out across the layer's edge instead of stopping sharp"
                        onChange={(v) => setOpt('feather', v)} />
                    )}
                    {finish === 7 && lentSet && (
                      <div className="flex flex-col gap-1.5">
                        <span className="text-xs font-semibold text-slate-300">Picture set</span>
                        <select value={lentSetIndex} aria-label="Picture set" className="input-field !py-1.5 text-sm"
                          onChange={(e) => (e.target.value === 'new' ? newLentSet() : chooseLentSet(Number(e.target.value)))}>
                          {settings.lenticularSets.map((s, i) => <option key={i} value={i}>{s.name || `Set ${i + 1}`}</option>)}
                          {settings.lenticularSets.length < LENTICULAR_MAX_SETS && <option value="new">＋ New set</option>}
                        </select>
                        <div className="flex items-center gap-2">
                          <input value={lentSet.name} onChange={(e) => setLentSet(lentSetIndex, { name: e.target.value })} placeholder={`Set ${lentSetIndex + 1}`}
                            className="flex-1 min-w-0 bg-transparent text-xs text-ink outline-none border-b border-slate-700 focus:border-slate-500" aria-label="Set name" />
                          {settings.lenticularSets.length > 1 && (
                            <button onClick={() => deleteLentSet(lentSetIndex)} className="text-[11px] text-slate-400 hover:text-red-500 underline">Delete set</button>
                          )}
                        </div>
                        <span className="text-[11px] text-slate-500">{lenticularPictures(settings, artUrl)[lentSetIndex].length} of {LENTICULAR_MAX_PER_SET} pictures, left to right · {lentTotal} of {LENTICULAR_MAX_TOTAL} across all sets</span>
                        <label className="flex items-center gap-2 text-xs text-slate-300">
                          <input type="checkbox" checked={lentSet.useArt} onChange={(e) => setLentSet(lentSetIndex, { useArt: e.target.checked })} className="accent-amber-500" />
                          Use pin art as picture 1
                        </label>
                        <div className="grid grid-cols-4 gap-1.5">
                          {lentSet.useArt && artUrl && (
                            <div className="relative">
                              {/* eslint-disable-next-line @next/next/no-img-element -- a small preview */}
                              <img src={badgeAsset(artUrl)} alt="Picture 1: the pin art" className="w-full aspect-square rounded bg-black/40 object-contain ring-1 ring-amber-500/60" />
                              <span className="absolute top-0.5 left-1 text-[10px] font-bold text-white drop-shadow">1</span>
                              <span className="absolute inset-x-0 bottom-0 text-center text-[9px] font-semibold text-white bg-black/50 rounded-b">Pin art</span>
                            </div>
                          )}
                          {lentSet.frames.map((u, i) => (
                            <div key={u} className="relative group">
                              {/* eslint-disable-next-line @next/next/no-img-element -- a small preview */}
                              <img src={badgeAsset(u)} alt={`Picture ${i + 1}`} className="w-full aspect-square rounded bg-black/40 object-contain" />
                              <span className="absolute top-0.5 left-1 text-[10px] font-bold text-white drop-shadow">{i + 1 + (lentSet.useArt && artUrl ? 1 : 0)}</span>
                              <div className="absolute inset-x-0 bottom-0 hidden group-hover:flex justify-between p-0.5 bg-black/50 rounded-b text-white">
                                <button onClick={() => moveFrame(i, -1)} disabled={i === 0} aria-label="Move left" className="disabled:opacity-30"><ChevronLeft size={12} /></button>
                                <button onClick={() => setLentSet(lentSetIndex, { frames: lentSet.frames.filter((_, j) => j !== i) })} aria-label="Remove"><X size={12} /></button>
                                <button onClick={() => moveFrame(i, 1)} disabled={i === lentSet.frames.length - 1} aria-label="Move right" className="disabled:opacity-30"><ChevronRight size={12} /></button>
                              </div>
                            </div>
                          ))}
                          {lenticularPictures(settings, artUrl)[lentSetIndex].length < LENTICULAR_MAX_PER_SET && lentTotal < LENTICULAR_MAX_TOTAL && (
                            <button onClick={() => frameInput.current?.click()} disabled={uploadingFrames} aria-label="Add pictures"
                              className="aspect-square rounded border border-dashed border-slate-600 flex items-center justify-center text-slate-400 hover:text-ink">
                              {uploadingFrames ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                            </button>
                          )}
                        </div>
                        <input ref={frameInput} type="file" accept="image/png,image/webp,image/jpeg" multiple hidden onChange={(e) => addFrames(e.target.files)} />
                        <span className="text-[11px] text-slate-500">Each picture is the whole pin, framed exactly like the pin art — this layer shows its own area of each. Any number of layers can use the same set.</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-500 rounded-xl border border-slate-800 p-3">Pick a layer below, or click part of the pin, to give it a finish — Ctrl/⌘-click or Shift-click to pick several and change them together. The art’s colours always stay — a finish changes how it catches the light.</p>
                )}
              </section>

              <section className="flex-1 min-h-0 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="field-label !mb-0">Layers</span>
                  <span className="text-[11px] text-slate-500">{layers.length}</span>
                  <div className="ml-auto flex gap-0.5 p-0.5 rounded-lg bg-slate-800 text-[11px]">
                    {(['all', 'finished'] as const).map((f) => (
                      <button key={f} onClick={() => setLayerFilter(f)} className={cn('px-2 py-0.5 rounded-md', layerFilter === f ? 'bg-slate-600 text-ink' : 'text-slate-400')}>{f === 'all' ? 'All' : 'With a finish'}</button>
                    ))}
                  </div>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-slate-800 divide-y divide-slate-800" onMouseLeave={() => setHovered(0)}>
                  {shownLayers.map((l) => {
                    const f = settings.materials[l.id] ?? 0
                    const hidden = settings.finishOff.includes(l.id)
                    return (
                      <div key={l.id} ref={(el) => { layerRows.current[l.id] = el }} onClick={(e) => pick(l.id, e, shownLayers.map((x) => x.id))} onMouseEnter={() => setHovered(l.id)}
                        className={cn('flex items-center gap-2 px-2 py-1.5 cursor-pointer select-none', l.id === selected ? 'bg-amber-500/25' : selection.includes(l.id) ? 'bg-amber-500/12' : 'hover:bg-slate-800')}>
                        <button onClick={(e) => { e.stopPropagation(); toggleFinishOff(l.id) }} disabled={!f} aria-label={hidden ? 'Show finish' : 'Hide finish'}
                          className={cn('w-5 shrink-0 flex justify-center', f ? 'text-slate-300 hover:text-ink' : 'text-slate-700')}>
                          {hidden ? <EyeOff size={13} /> : <Eye size={13} />}
                        </button>
                        {/* eslint-disable-next-line @next/next/no-img-element -- a tiny in-memory render */}
                        <img src={l.thumb} alt="" className="w-8 h-8 shrink-0 rounded bg-black/40 object-contain" />
                        <span className={cn('flex-1 min-w-0 truncate text-xs', hidden && 'opacity-50')}>{settings.names[l.id] || defaultName(l.id)}</span>
                        <span className={cn('text-[11px] shrink-0', f ? 'text-amber-500' : 'text-slate-600', hidden && 'line-through opacity-60')}>{FINISHES.find((x) => x.id === f)?.name}</span>
                      </div>
                    )
                  })}
                  {!shownLayers.length && <p className="p-3 text-[11px] text-slate-500">{layers.length ? 'No layer has a finish yet.' : 'Loading layers…'}</p>}
                </div>
                {usedFinishes.length > 0 && (
                  <button onClick={() => set({ materials: {}, finishOpts: {}, finishOff: [] })} className="text-[11px] text-slate-400 underline self-start"><RotateCcw size={11} className="inline mr-1" />Every layer back to Auto</button>
                )}
              </section>
            </fieldset>
          )}
        </div>

        <div className="px-4 py-3 border-t border-slate-800 flex flex-col gap-2">
          {error && <span className="text-xs text-red-500">{error}</span>}
          {badge.model && <span className="text-[11px] text-amber-500">This badge has a 3D model, which the viewer shows instead of a relief. Remove it in the editor.</span>}
          <button onClick={apply} disabled={!kit || !!status} className="btn-primary justify-center disabled:opacity-50"><Check size={15} />Save relief to badge</button>
          <span className="text-[11px] text-slate-500 text-center">Saves the badge too — live for everyone straight away.</span>
        </div>
      </aside>
    </div>,
    document.body,
  )
}

function Slider({ label, value, min, max, step, fmt, onChange, hint }: {
  label: string; value: number; min: number; max: number; step: number; fmt: (v: number) => string; onChange: (v: number) => void; hint?: string
}) {
  return (
    <label className="block">
      <span className="flex items-center text-xs font-semibold text-slate-300">{label}<span className="ml-auto tabular-nums text-slate-400">{fmt(value)}</span></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-amber-500" />
      {hint && <span className="block text-[11px] text-slate-500">{hint}</span>}
    </label>
  )
}

// ── The 3D stage (same studio lighting as the collector's 3D view, PinInspector.tsx) ────────

interface Stage {
  load(kit: ReliefKit, artUrl: string): Promise<void>
  update(kit: ReliefKit, s: ReliefSettings): Composed | null
  relook(s: ReliefSettings): void
  highlight(kit: ReliefKit, pieces: number[]): void
  paint(kit: ReliefKit, view: View, c: Composed, stepped: boolean): void
  finishes(kit: ReliefKit, materials: Record<string, number>, opts: Record<string, Record<string, number>>): void
  lenticular(sets: string[][]): void
  /** Every piece under a circle of `radiusPx` screen pixels around (clientX, clientY). */
  brushPick(kit: ReliefKit, clientX: number, clientY: number, radiusPx: number): number[]
  setTurning(on: boolean): void
  dispose(): void
}

function createStage(mount: HTMLDivElement, onPick: (piece: number, e: PointerEvent) => void): Stage {
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(mount.clientWidth, mount.clientHeight)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 0.85
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.setClearColor(0x15120f)
  mount.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04, 0.1, 100, { size: 1024 }).texture
  scene.environmentIntensity = 0.32
  const key = new THREE.DirectionalLight(0xffe9c4, 3.2)
  key.position.set(-2.6, 3, 1.6)
  const rim = new THREE.DirectionalLight(0xa9c4ff, 1.6)
  rim.position.set(2.5, 1.2, -2.5)
  const fill = new THREE.DirectionalLight(0xc9d6ff, 0.35)
  fill.position.set(2.5, -1.5, 2)
  const backKey = new THREE.DirectionalLight(0xffe2b0, 1.8)
  backKey.position.set(-2, 2.5, -2.5)
  scene.add(key, rim, fill, backKey, new THREE.AmbientLight(0xffffff, 0.05))

  const camera = new THREE.PerspectiveCamera(30, mount.clientWidth / mount.clientHeight, 0.05, 50)
  camera.position.set(0.35, 0.15, 1)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.minDistance = 0.4
  controls.maxDistance = 6
  // Frame the 1-wide pin to fill ~85% of the view's shorter side, keeping the current angle
  const fit = () => {
    const view = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.min(1, camera.aspect)
    camera.position.setLength(1.05 / (0.85 * view))
    controls.update()
  }
  fit()

  // The pin on the stage and everything last applied to it — a hole rebuilds the pin (it changes
  // the body's shape), and the rebuilt one gets all of it back
  let relief: LiveRelief | null = null
  let faceMesh: THREE.Mesh | null = null
  let kitRef: ReliefKit | null = null
  let art: HTMLImageElement | null = null
  let normalTex: THREE.Texture | null = null
  let lastH: { h: Float32Array; size: number } | null = null
  let lastLook: ReliefSettings | null = null
  let lastHighlight: Uint8Array | null = null
  let lastOverlay: HTMLCanvasElement | null = null
  let lastFinish: Uint8Array | null = null
  let lastFrames: string[][] = []
  let holeKey = ''

  function build(kit: ReliefKit, holes?: Uint8Array) {
    if (relief) { scene.remove(relief.group); dispose(relief.group, normalTex) }
    const k = kit.preview
    relief = cleanRelief(art!, renderer.capabilities.getMaxAnisotropy(), k.alpha, k.size, PREVIEW_GRID, holes ? { mask: holes, size: k.size } : undefined)
    relief.faceMaterial.normalMap = normalTex
    relief.faceMaterial.normalMapType = THREE.ObjectSpaceNormalMap
    relief.faceMaterial.needsUpdate = true
    faceMesh = null
    relief.group.traverse((o) => { if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).material === relief!.faceMaterial) faceMesh = o as THREE.Mesh })
    scene.add(relief.group)
    if (lastH) relief.setHeight(lastH.h, lastH.size, lastLook ?? undefined)
    relief.setHighlight(lastHighlight, k.size)
    relief.setOverlay(lastOverlay)
    relief.setFinish(lastFinish, k.size)
    if (lastFrames.some((f) => f.length)) relief.setLenticular(lastFrames)
  }

  const ro = new ResizeObserver(() => {
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    camera.aspect = mount.clientWidth / mount.clientHeight
    camera.updateProjectionMatrix()
    fit()
  })
  ro.observe(mount)

  // A click (not a drag) on the pin picks the piece under it
  const ray = new THREE.Raycaster()
  let down: { x: number; y: number } | null = null
  const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY } }
  const onUp = (e: PointerEvent) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4 || !faceMesh || !kitRef) return
    const r = renderer.domElement.getBoundingClientRect()
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera)
    const hit = ray.intersectObject(faceMesh)[0]
    if (!hit?.uv) return onPick(0, e)
    const k = kitRef.preview
    const x = Math.min(k.size - 1, Math.floor(hit.uv.x * k.size)), y = Math.min(k.size - 1, Math.floor((1 - hit.uv.y) * k.size))
    onPick(k.pieces[y * k.size + x], e)
  }
  renderer.domElement.addEventListener('pointerdown', onDown)
  renderer.domElement.addEventListener('pointerup', onUp)

  // A screen circle → the pieces under it: where the centre hits the pin, then a disc of the
  // matching size on the pin's surface (screen radius × the pin's size per pixel at that depth)
  function brushPick(kit: ReliefKit, clientX: number, clientY: number, radiusPx: number): number[] {
    if (!faceMesh || kitRef !== kit) return []
    const r = renderer.domElement.getBoundingClientRect()
    ray.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), camera)
    const hit = ray.intersectObject(faceMesh)[0]
    if (!hit?.uv) return []
    const perPx = (2 * hit.distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / r.height
    const k = kit.preview
    const rad = Math.max(1, radiusPx * perPx * k.size)
    const cx = hit.uv.x * k.size, cy = (1 - hit.uv.y) * k.size
    const found = new Set<number>()
    const step = Math.max(1, rad / 24)
    for (let dy = -rad; dy <= rad; dy += step) for (let dx = -rad; dx <= rad; dx += step) {
      if (dx * dx + dy * dy > rad * rad) continue
      const x = Math.floor(cx + dx), y = Math.floor(cy + dy)
      if (x < 0 || y < 0 || x >= k.size || y >= k.size) continue
      const p = k.pieces[y * k.size + x]
      if (p) found.add(p)
    }
    return Array.from(found)
  }

  let raf = 0
  const tick = () => { controls.update(); renderer.render(scene, camera); raf = requestAnimationFrame(tick) }
  tick()

  return {
    async load(kit, artUrl) {
      art = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = artUrl })
      const normalUrl = URL.createObjectURL(kit.normal)
      normalTex?.dispose()
      normalTex = await new THREE.TextureLoader().loadAsync(normalUrl)
      URL.revokeObjectURL(normalUrl)
      lastH = null; lastHighlight = null; lastOverlay = null; lastFinish = null; holeKey = ''
      kitRef = kit
      build(kit)
    },
    update(kit, s) {
      if (!relief || kitRef !== kit) return null
      const c = compose(kit.preview, s)
      lastH = { h: c.h, size: kit.preview.size }
      lastLook = s
      relief.setHeight(c.h, kit.preview.size, s)
      return c
    },
    relook(s) {
      lastLook = s
      if (relief && lastH) relief.setHeight(lastH.h, lastH.size, s)
    },
    highlight(kit, pieces) {
      if (!relief || kitRef !== kit) return
      const k = kit.preview
      const on = new Set(pieces)
      lastHighlight = pieces.length ? Uint8Array.from(k.pieces, (p) => (on.has(p) ? 1 : 0)) : null
      relief.setHighlight(lastHighlight, k.size)
    },
    paint(kit, view, c, stepped) {
      if (!relief || kitRef !== kit) return
      lastOverlay = view === 'art' || (view === 'levels' && !stepped) ? null : view === 'pieces' ? piecesPicture(kit) : levelsPicture(kit, c)
      relief.setOverlay(lastOverlay)
    },
    finishes(kit, materials, opts) {
      if (!relief || kitRef !== kit) return
      const k = kit.preview
      const f = finishMap(k, materials, opts)
      lastFinish = f?.map ?? null
      // the pin is rebuilt only when the holes change (which, or how smoothed) — the body's shape does
      const holes = JSON.stringify(Object.entries(materials).filter(([, x]) => x === FINISH_HOLE).map(([id]) => [id, opts[id]?.smooth]).sort())
      if (holes !== holeKey) {
        holeKey = holes
        build(kit, f?.holes ?? undefined)
      } else relief.setFinish(lastFinish, k.size)
    },
    lenticular(sets) {
      if (JSON.stringify(sets) === JSON.stringify(lastFrames)) return
      lastFrames = sets
      relief?.setLenticular(sets)
    },
    brushPick,
    setTurning(on) { controls.enabled = on },
    dispose() {
      cancelAnimationFrame(raf)
      ro.disconnect()
      renderer.domElement.removeEventListener('pointerdown', onDown)
      renderer.domElement.removeEventListener('pointerup', onUp)
      if (relief) dispose(relief.group)
      normalTex?.dispose()
      controls.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}

// The Pieces view: every piece its own colour (objects bright, the areas between them muted), with
// dark outlines between pieces
function piecesPicture(kit: ReliefKit): HTMLCanvasElement {
  const k = kit.preview
  const colors = new Map<number, [number, number, number]>()
  const rgb = (p: number) => {
    let c = colors.get(p)
    if (!c) { c = hsl((p * 137.508) % 360, p <= k.objects ? 0.7 : 0.25, p <= k.objects ? 0.58 : 0.42); colors.set(p, c) }
    return c
  }
  return picture(k, (i, x, y) => {
    const p = k.pieces[i]
    const edge = (x > 0 && k.pieces[i - 1] !== p) || (y > 0 && k.pieces[i - k.size] !== p)
    return edge ? [20, 18, 16] : rgb(p)
  })
}

// The Levels view: each piece in the colour of the level it ends up on — the original level's
// colour from the list (a switched-off level's pieces show their new level's colour)
function levelsPicture(kit: ReliefKit, c: Composed): HTMLCanvasElement {
  const k = kit.preview
  const cols = LEVEL_COLORS.map((h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)] as [number, number, number])
  return picture(k, (i) => {
    const lv = c.level[k.pieces[i]]
    if (lv < 0) return [40, 36, 32]
    return cols[(c.live[lv] ?? lv) % cols.length]
  })
}

function picture(k: ReliefKit['preview'], color: (i: number, x: number, y: number) => [number, number, number]): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = k.size
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(k.size, k.size)
  for (let y = 0; y < k.size; y++) for (let x = 0; x < k.size; x++) {
    const i = y * k.size + x, o = i * 4
    const [r, g, b] = color(i, x, y)
    img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b
    img.data[o + 3] = k.alpha[i] >= 0.5 ? 255 : 0
  }
  ctx.putImageData(img, 0, 0)
  return c
}

function hsl(h: number, s: number, l: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    return Math.round(255 * (l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
  }
  return [f(0), f(8), f(4)]
}

function dispose(obj: THREE.Object3D, keep?: THREE.Texture | null) {
  obj.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    m.geometry.dispose()
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      for (const v of Object.values(mat)) if (v instanceof THREE.Texture && v !== keep) v.dispose()
      mat.dispose()
    }
  })
}

// Unsaved Studio work per badge, kept in this browser until the badge is saved with it
interface Draft { kit: Record<string, string>; settings: Partial<ReliefSettings> }
const draftKey = (badgeId: string) => `tcghaven-relief-draft:${badgeId || 'new'}`
function readDraft(badgeId: string): Draft | null {
  try { const d = JSON.parse(localStorage.getItem(draftKey(badgeId)) || 'null'); return d?.kit?.['art.webp'] ? d : null } catch { return null }
}
function writeDraft(badgeId: string, d: Draft) {
  try { localStorage.setItem(draftKey(badgeId), JSON.stringify(d)) } catch { /* storage full or blocked: nothing to do */ }
}
function clearDraft(badgeId: string) {
  try { localStorage.removeItem(draftKey(badgeId)) } catch { /* blocked */ }
}

// The Material tab's layers: one per piece, with a thumbnail of that piece cut from the art
interface Layer { id: number; area: number; thumb: string }
async function buildLayers(kit: ReliefKit): Promise<Layer[]> {
  const k = kit.preview
  const bmp = await createImageBitmap(kit.art, { resizeWidth: k.size, resizeHeight: k.size })
  const c = new OffscreenCanvas(k.size, k.size)
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bmp, 0, 0)
  const art = ctx.getImageData(0, 0, k.size, k.size).data
  const P = k.pieceCount + 1
  const box = Array.from({ length: P }, () => [k.size, k.size, -1, -1])
  const area = new Int32Array(P)
  for (let y = 0; y < k.size; y++) for (let x = 0; x < k.size; x++) {
    const p = k.pieces[y * k.size + x]
    if (!p) continue
    area[p]++
    const b = box[p]
    if (x < b[0]) b[0] = x
    if (y < b[1]) b[1] = y
    if (x > b[2]) b[2] = x
    if (y > b[3]) b[3] = y
  }
  const T = 48
  const thumb = document.createElement('canvas')
  thumb.width = thumb.height = T
  const tctx = thumb.getContext('2d')!
  const out: Layer[] = []
  for (let p = 1; p < P; p++) {
    if (!area[p]) continue
    const [x0, y0, x1, y1] = box[p]
    const w = x1 - x0 + 1, h = y1 - y0 + 1
    const crop = new ImageData(w, h)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y0 + y) * k.size + x0 + x
      if (k.pieces[i] !== p) continue
      const o = (y * w + x) * 4
      crop.data[o] = art[i * 4]; crop.data[o + 1] = art[i * 4 + 1]; crop.data[o + 2] = art[i * 4 + 2]; crop.data[o + 3] = 255
    }
    const cc = new OffscreenCanvas(w, h)
    cc.getContext('2d')!.putImageData(crop, 0, 0)
    const sc = Math.min(T / w, T / h)
    tctx.clearRect(0, 0, T, T)
    tctx.drawImage(cc, (T - w * sc) / 2, (T - h * sc) / 2, w * sc, h * sc)
    out.push({ id: p, area: area[p], thumb: thumb.toDataURL() })
  }
  return out
}

/** The materials actually applied: every layer's finish except the hidden ones (the eye). */
function activeMaterials(s: ReliefSettings): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [id, f] of Object.entries(s.materials)) if (!s.finishOff.includes(Number(id))) out[id] = f
  return out
}
