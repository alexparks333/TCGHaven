'use client'

// Making (or editing) one of a creator's badges — opened from a "+" in their book (BookPlanner).
// Four friendly steps, with the pin shown big on velvet the whole time:
//   1. Pin art — upload the artwork, cut out or on plain white (the white is cut away on upload —
//      lib/pinArtCutout.ts — because the flat pin draws the picture as is)
//   2. Name it — the name on its brass plate, and how fans earn it
//   3. What fans collect — cards from the catalog; owning one of each earns the badge
//   4. Make it 3D — the Relief Studio (the same one staff use) sculpts the pin from the art, on a
//      GPU in the cloud (docs/creators.md "The 3D maker's GPU"). Optional: without it the pin still
//      gets an automatic 3D look.
// Files go to Storage creators/{uid}/badges/{id}/ (storage.rules).

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import dynamic from 'next/dynamic'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { X, Upload, Loader2, Search, Trash2, Box, Check, ImageIcon, PenLine, Layers, ArrowRight, LayoutGrid, Eye } from 'lucide-react'
import { DEFAULT_TIERS, CREATOR_MAX_SCALE, pagePin, pinDrawSize, pinShadowCss, looksOn, tierNeed, tierPercents, type BadgeDef, type BadgeSet, type BadgeSlot } from '@/lib/badges'
import { BadgePin } from '@/components/badges/BadgePin'
import { useBadgeCatalog } from '@/lib/badgeCatalog'
import { badgeArt } from '@/lib/badgeAssets'
import { appStorage } from '@/lib/firebase/appStorage'
import { cutOutWhite } from '@/lib/pinArtCutout'
import { auth } from '@/lib/firebase/config'
import { RELIEF_SERVER, setReliefEndpoint } from '@/lib/reliefStudio'
import { GAME_COLORS, GAME_LABELS, type Game } from '@/lib/types'
import type { CardSearchResult } from '@/lib/api/search'
import { cardImage } from '@/lib/cardImage'
import { useScrollLock } from '@/lib/useScrollLock'
import { Portal } from '@/components/creator/Portal'
import { cn, RARITY_LABELS_BY_GAME, zoomGlowColor } from '@/lib/utils'
import { CardZoomOverlay, RARITY_COLORS, type ZoomCardData } from '@/components/pages/CardexPage'

const ReliefStudio = dynamic(() => import('@/components/admin/ReliefStudio'), { ssr: false })
const CardexCardPicker = dynamic(() => import('@/components/admin/CardexCardPicker'), { ssr: false }) // the whole Cardex, full screen
const PinInspector = dynamic(() => import('@/components/badges/PinInspector'), { ssr: false }) // the sculpted pin, in 3D

const GAMES = Object.keys(GAME_LABELS) as Game[]

export function BadgeMaker({ uid, book, badges = [], badge, onSave, onDelete, onClose }: {
  uid: string
  book: BadgeSet
  badges?: BadgeDef[]      // the book's other badges — the left side shows this one on its real page among them
  badge: BadgeDef          // a new one (no art yet) or the one being edited
  onSave: (b: BadgeDef) => Promise<void>
  onDelete?: () => Promise<void>
  onClose: () => void
}) {
  useScrollLock(true)
  const [draft, setDraft] = useState<BadgeDef>(badge)
  const set = (patch: Partial<BadgeDef>) => setDraft((d) => ({ ...d, ...patch }))
  const [step, setStep] = useState(badge.imageUrl ? 2 : 1)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [studio, setStudio] = useState(false)
  const [studioNote, setStudioNote] = useState('')
  const [artName, setArtName] = useState('')
  // Unsaved changes: the draft vs what was last saved. ✕ with changes asks first.
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(badge))
  const dirty = JSON.stringify(draft) !== savedJson
  const [confirmClose, setConfirmClose] = useState(false)
  const requestClose = () => { if (busy) return; if (dirty) setConfirmClose(true); else onClose() }
  // The left side: the flat pin on steps 1–3; on Make it 3D, once it's sculpted, the real 3D pin
  // (not while the Studio is open — it has its own big view)
  const sculpted = !!(step === 4 && draft.imageUrl && draft.reliefKit && !studio)
  const fileInput = useRef<HTMLInputElement>(null)
  const folder = `creators/${uid}/badges/${draft.id}`
  // An example to follow: one of TCG Haven's own finished pins (uploaded art, see-through background)
  const { catalog } = useBadgeCatalog()
  const example = catalog.badges.find((b) => b.imageUrl && !b.set.startsWith('creator-'))
  const { accent, from, to } = book.cover
  // The velvet side is a page: the pin's 100% size there, by the pin book's own rule (lib/badges.ts pagePin)
  const [pane, setPane] = useState<HTMLDivElement | null>(null)
  const [pin, setPin] = useState(120)
  useEffect(() => {
    if (!pane) return
    const fit = () => {
      const w = pane.clientWidth - 20 // the velvet is inset 10px all round
      setPin(pagePin(w, Math.max(pane.clientHeight - 20, w / 0.71)))
    }
    const ro = new ResizeObserver(fit)
    ro.observe(pane)
    fit()
    return () => ro.disconnect()
  }, [pane])

  async function uploadArt(file: File | undefined) {
    if (!file) return
    setBusy('Getting your art ready…'); setError('')
    try {
      // On white (or a JPG)? Cut the white away first, so the flat pin has no box around it
      const { blob, cut } = await cutOutWhite(file).catch(() => ({ blob: file as Blob, cut: false }))
      setBusy('Uploading your art…')
      const ext = cut ? 'png' : (file.name.split('.').pop() || 'png').toLowerCase()
      const r = ref(appStorage, `${folder}/art-${Date.now()}.${ext}`)
      await uploadBytes(r, blob, { contentType: cut ? 'image/png' : file.type || 'image/png' })
      const url = await getDownloadURL(r)
      // New art: any 3D work made from the old picture no longer fits it
      set({ imageUrl: url, reliefKit: undefined, relief: undefined, depthMapUrl: undefined, normalMapUrl: undefined, finishMapUrl: undefined, detailMapUrl: undefined, reliefBuildUrl: undefined, reliefBuildKey: undefined })
      setArtName(file.name) // stays on Pin art: the pin appears on the left first, then Next
    } catch (e) {
      setError('Couldn’t upload that — ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setBusy('')
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  // The 3D maker: a ticket for the cloud GPU from the site; on this computer with no GPU set up, the
  // HavenRelief server running here (staff testing — tools/havenrelief)
  async function openStudio() {
    setStudioNote('')
    setBusy('Waking the 3D maker…')
    try {
      const token = await auth.currentUser?.getIdToken()
      const res = await fetch('/api/relief/ticket', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {} })
      const body = (await res.json().catch(() => ({}))) as { url?: string | null; ticket?: string; error?: string }
      if (!res.ok) throw new Error(body.error || `status ${res.status}`)
      if (body.url) setReliefEndpoint(body.url, body.ticket)
      else if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') setReliefEndpoint(RELIEF_SERVER)
      else {
        setStudioNote('The 3D maker is being set up — your pin gets an automatic 3D look until then. You can sculpt it here as soon as it’s switched on.')
        return
      }
      setStudio(true)
    } catch (e) {
      setStudioNote('Couldn’t open the 3D maker — ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setBusy('')
    }
  }

  async function save() {
    if (!draft.name.trim()) { setStep(2); return setError('Give your badge a name') }
    if (!draft.imageUrl) { setStep(1); return setError('Add your pin art first') }
    setBusy('Saving…'); setError('')
    try {
      const game = draft.slots[0] ? (gameOf(draft.slots[0]) ?? draft.game) : draft.game
      await onSave({ ...draft, name: draft.name.trim(), game })
      setSavedJson(JSON.stringify(draft))
      onClose()
    } catch (e) {
      setError('Couldn’t save — ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setBusy('')
    }
  }

  const steps = [
    { n: 1, label: 'Pin art', icon: ImageIcon, done: !!draft.imageUrl },
    { n: 2, label: 'Name it', icon: PenLine, done: !!draft.name.trim() },
    { n: 3, label: 'Cards to collect', icon: Layers, done: draft.slots.length > 0 },
    { n: 4, label: 'Make it 3D', icon: Box, done: !!draft.reliefKit },
  ]

  return (
    <Portal>
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
      {/* No close on an outside click: a pin in progress would be lost to a stray click — only ✕ closes */}
      <div className="add-card-backdrop absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="add-card-panel relative w-full max-w-[920px] card-glass rounded-t-2xl sm:rounded-2xl h-[94dvh] md:h-[min(94dvh,760px)] flex flex-col md:flex-row overflow-hidden">
        {/* The pin, big, on the book's velvet */}
        <div ref={setPane} className="relative md:w-[42%] shrink-0 flex flex-col items-center justify-center gap-4 p-6 md:p-8" style={{ background: `linear-gradient(150deg, ${from}, ${to})` }}>
          <div className="absolute inset-[10px] rounded-xl pointer-events-none" style={{ background: 'radial-gradient(ellipse at 50% 40%, #2c2240 0%, #1a1427 60%, #0f0b18 100%)', boxShadow: 'inset 0 0 40px rgba(0,0,0,0.6)' }} />
          <div className="absolute inset-[18px] rounded-lg border pointer-events-none" style={{ borderColor: accent + '88' }} />
          <button type="button" onClick={requestClose} className="md:hidden absolute top-4 right-4 z-10 p-2 rounded-full bg-black/40 text-white" aria-label="Close"><X size={18} /></button>
          {/* Once it's sculpted: the real 3D pin, to turn over. Before that: the flat art */}
          {sculpted ? (
            <div className="relative w-full h-[min(420px,48dvh)]">
              <PinInspector key={draft.reliefBuildKey ?? draft.depthMapUrl} def={draft} embedded onClose={() => {}} />
              <p className="absolute bottom-1 inset-x-0 text-center text-[11px] text-[#e9dcc3]/60 pointer-events-none">Drag to turn it · scroll to zoom</p>
            </div>
          ) : (
          // The pin at its true size on a page: this velvet side is the page, and the pin is drawn by the
          // pin book's own rule for a page this big. The faint dashed outline is its spot (100%)
          <div className="relative flex items-center justify-center" style={{ width: pin, height: pin * 1.12 }}>
            {draft.imageUrl && (
              <>
                <span className="absolute inset-[-6px] rounded-2xl border border-dashed border-white/25 pointer-events-none" aria-hidden />
                <span className="absolute -top-6 inset-x-0 text-center text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40 pointer-events-none">Its spot on the page</span>
              </>
            )}
            {draft.imageUrl
              ? <span className="flex items-center justify-center" style={{ filter: pinShadowCss(book.insideStyle ?? {}) }}><BadgePin art={draft.art} imageUrl={draft.imageUrl} size={Math.round(pinDrawSize(draft, pin))} /></span>
              : <span className="w-[76%] aspect-square rounded-full border-2 border-dashed flex items-center justify-center text-center text-xs px-6" style={{ borderColor: accent + 'aa', color: accent }}>Your pin appears here</span>}
          </div>
          )}
          <span className="relative pinbook-serif max-w-[90%] truncate rounded px-2 py-0.5 font-bold uppercase tracking-wider" style={{ fontSize: Math.max(8, pin * 0.075), background: `linear-gradient(180deg, ${accent}, #6b4a17)`, color: '#1c1206' }}>
            {draft.name.trim() || '? ? ?'}
          </span>
          {draft.slots.length > 0 && (
            <span className="relative text-[11px] text-[#e9dcc3]/80">Collect {draft.slots.length} {draft.slotNoun || 'cards'} to earn it</span>
          )}
        </div>

        {/* The steps */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex items-center gap-1 px-4 pt-4 pb-3 border-b border-slate-800 overflow-x-auto no-scrollbar">
            {steps.map(({ n, label, icon: Icon, done }) => (
              <button key={n} type="button" onClick={() => setStep(n)}
                className={cn('shrink-0 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
                  step === n ? 'bg-violet-600 text-white' : done ? 'text-ink hover:bg-slate-800' : 'text-slate-500 hover:bg-slate-800')}>
                {done && step !== n ? <Check size={13} className="text-emerald-600" /> : <Icon size={13} />}{label}
              </button>
            ))}
            <button type="button" onClick={requestClose} className="hidden md:block ml-auto p-2 rounded-lg text-slate-500 hover:text-ink hover:bg-slate-800" aria-label="Close"><X size={18} /></button>
          </div>

          <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-5">
            {step === 1 && (
              <div>
                <h3 className="text-lg font-bold text-ink">Your pin art</h3>
                <p className="text-sm text-slate-400 mt-1">Just the pin itself — it becomes the enamel pin in your book.</p>
                {/* What to upload, compact: cut out, or on white (cut out for you on upload) */}
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-emerald-600/40 bg-slate-950/40 p-2 flex items-center gap-2.5">
                    <span className="w-16 h-16 shrink-0 rounded-lg bg-[repeating-conic-gradient(#d8ccb2_0%_25%,#ece2cc_0%_50%)] [background-size:12px_12px] flex items-center justify-center p-1.5">
                      {example?.imageUrl
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={badgeArt(example.imageUrl, 256)} alt="" className="max-w-full max-h-full object-contain" />
                          : <BadgePin art="crest" size={56} />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-xs font-bold text-emerald-700"><Check size={12} className="inline -mt-0.5 mr-0.5" />Cut out</span>
                      <span className="block text-[11px] text-slate-500 leading-snug">See-through around it</span>
                    </span>
                  </div>
                  <div className="rounded-xl border border-emerald-600/40 bg-slate-950/40 p-2 flex items-center gap-2.5">
                    <span className="w-16 h-16 shrink-0 rounded-lg bg-white shadow-inner flex items-center justify-center p-2">
                      {example?.imageUrl
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={badgeArt(example.imageUrl, 256)} alt="" className="max-w-full max-h-full object-contain" />
                          : <BadgePin art="crest" size={56} />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-xs font-bold text-emerald-700"><Check size={12} className="inline -mt-0.5 mr-0.5" />On plain white</span>
                      <span className="block text-[11px] text-slate-500 leading-snug">We cut the white away</span>
                    </span>
                  </div>
                </div>
                <p className="mt-2 text-[11px] text-slate-500">Any shape · at least 1000 × 1000 px · bold shapes and colours read best small</p>
                {draft.imageUrl && !busy ? (
                  <div className="mt-4 rounded-2xl border-2 border-emerald-600/50 bg-emerald-600/5 p-3 flex items-center gap-3">
                    <span className="w-16 h-16 shrink-0 rounded-xl bg-[repeating-conic-gradient(#d8ccb2_0%_25%,#ece2cc_0%_50%)] [background-size:12px_12px] flex items-center justify-center p-1.5">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={draft.imageUrl} alt="" className="max-w-full max-h-full object-contain" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-emerald-700 flex items-center gap-1"><Check size={15} />Pin art uploaded</p>
                      <p className="text-xs text-slate-500 truncate">{artName || 'Your pin is on the left — check it looks right'}</p>
                      <button type="button" onClick={() => fileInput.current?.click()} className="mt-1 text-xs font-semibold text-violet-700 hover:underline flex items-center gap-1"><Upload size={12} />Upload a different one</button>
                    </div>
                    <button type="button" onClick={() => setStep(2)} className="btn-primary shrink-0">Next<ArrowRight size={15} /></button>
                  </div>
                ) : (
                <button type="button" disabled={!!busy} onClick={() => fileInput.current?.click()}
                  className="mt-4 w-full rounded-2xl border-2 border-dashed border-slate-700 hover:border-violet-500 bg-slate-950/40 py-10 flex flex-col items-center gap-2 text-slate-500 hover:text-ink transition-colors">
                  {busy ? <Loader2 size={28} className="animate-spin" /> : <Upload size={28} />}
                  <span className="font-semibold">{busy || (draft.imageUrl ? 'Upload different art' : 'Choose your pin art')}</span>
                  <span className="text-xs">PNG, WebP or JPG · up to 25 MB</span>
                </button>
                )}
                <input ref={fileInput} type="file" accept="image/png,image/webp,image/jpeg" hidden onChange={(e) => uploadArt(e.target.files?.[0])} />
                {/* How big the pin sits in its spot on the page (BadgeDef.displayScale — the page on the left shows it) */}
                {draft.imageUrl && (
                  <div className="rounded-2xl border border-slate-800 p-4">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold text-ink flex-1">Size on the page</p>
                      <span className="text-xs tabular-nums text-slate-500">{Math.round((draft.displayScale ?? 1) * 100)}%</span>
                      {(draft.displayScale ?? 1) !== 1 && <button type="button" onClick={() => set({ displayScale: undefined })} className="text-[11px] font-semibold text-slate-500 hover:text-ink">Reset</button>}
                    </div>
                    <input type="range" min={0.3} max={CREATOR_MAX_SCALE} step={0.01} value={draft.displayScale ?? 1} className="mt-2 w-full accent-violet-600"
                      onChange={(e) => { const v = Number(e.target.value); set({ displayScale: Math.abs(v - 1) < 0.005 ? undefined : v }) }} />
                    <p className="mt-1 text-[11px] text-slate-500">The left side is a page at true scale: the pin is exactly as big as it will be in your book. The dashed outline is its spot (100%) — go over to let it grow past it.</p>
                  </div>
                )}
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4">
                <h3 className="text-lg font-bold text-ink">Name your badge</h3>
                <label className="block">
                  <span className="field-label">Badge name</span>
                  <input className="input-field text-base font-semibold" autoFocus maxLength={36} value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Brofist Legends" />
                </label>
                <label className="block">
                  <span className="field-label">How fans earn it <span className="font-normal normal-case tracking-normal text-slate-500">· shown when they hover the pin</span></span>
                  <textarea className="input-field min-h-[80px] text-sm" maxLength={200} value={draft.description} onChange={(e) => set({ description: e.target.value })} placeholder="Collect every card from my favourite deck" />
                </label>
                <label className="block">
                  <span className="field-label">What to call the cards</span>
                  <input className="input-field text-sm" maxLength={20} value={draft.slotNoun} onChange={(e) => set({ slotNoun: e.target.value })} placeholder="cards" />
                  <span className="text-[11px] text-slate-500 mt-1 block">Fans see “3 / 10 {draft.slotNoun || 'cards'}”</span>
                </label>
              </div>
            )}

            {step === 3 && (
              <>
                <CardPicker slots={draft.slots} onChange={(slots) => set({ slots })} />
                {draft.slots.length > 0 && <UnlockEditor def={draft} onChange={set} />}
              </>
            )}

            {step === 4 && (
              <div>
                <h3 className="text-lg font-bold text-ink">Make it 3D</h3>
                <p className="text-sm text-slate-400 mt-1">
                  Fans can pick up your pin and turn it in 3D. The Relief Studio sculpts it from your art — raised layers, gold edges,
                  gems, holo foil — and runs on our GPUs, so any computer works. Skip it and your pin gets an automatic 3D look.
                </p>
                <button type="button" disabled={!draft.imageUrl || !!busy} onClick={openStudio}
                  className="mt-5 w-full rounded-2xl py-4 font-bold text-base flex items-center justify-center gap-2 disabled:opacity-40 shadow-lg"
                  style={{ background: `linear-gradient(135deg, ${accent}, #8a5f1f)`, color: '#1c1206' }}>
                  {busy ? <Loader2 size={18} className="animate-spin" /> : <Box size={18} />}
                  {busy || (draft.reliefKit ? 'Open the Relief Studio again' : 'Open the Relief Studio')}
                </button>
                {!draft.imageUrl && <p className="text-xs text-slate-500 mt-2">Add your pin art first (step 1).</p>}
                {draft.reliefKit && <p className="text-xs text-emerald-700 mt-3 flex items-center gap-1.5"><Check size={13} />Sculpted in 3D</p>}
                {studioNote && <p className="text-sm text-slate-400 mt-3 rounded-xl bg-slate-950/50 border border-slate-800 p-3">{studioNote}</p>}
              </div>
            )}
            {error && <p className="text-sm text-red-600 mt-4">{error}</p>}
          </div>

          <div className="flex items-center gap-2 px-5 py-4 border-t border-slate-800">
            {onDelete && (
              <button type="button" disabled={!!busy}
                onClick={async () => { if (confirm(`Remove “${draft.name || 'this badge'}” from your book?`)) { setBusy('Removing…'); await onDelete(); onClose() } }}
                className="p-2.5 rounded-xl text-slate-500 hover:text-red-600 hover:bg-red-500/10" aria-label="Remove this badge"><Trash2 size={18} /></button>
            )}
            <div className="flex-1" />
            {step < 4 && <button type="button" onClick={() => setStep(step + 1)} className="btn-secondary !bg-slate-950 border border-slate-700 !text-ink">Next</button>}
            <button type="button" disabled={!!busy} onClick={save} className="btn-primary">
              {busy === 'Saving…' ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}Save badge
            </button>
          </div>
        </div>
      </div>

      {/* ✕ with unsaved changes */}
      {confirmClose && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setConfirmClose(false)} />
          <div role="alertdialog" aria-labelledby="close-q" className="add-card-panel relative card-glass rounded-2xl p-6 w-full max-w-sm text-center shadow-2xl">
            <h3 id="close-q" className="text-lg font-bold text-ink">Are you sure you want to close?</h3>
            <p className="text-sm text-slate-400 mt-1.5">There are unsaved changes to this badge. Closing now loses them.</p>
            <div className="mt-5 flex flex-col gap-2">
              <button type="button" autoFocus onClick={() => { setConfirmClose(false); save() }} className="btn-primary justify-center py-2.5"><Check size={16} />Save badge</button>
              <button type="button" onClick={() => setConfirmClose(false)} className="btn-secondary justify-center !bg-slate-950 border border-slate-700 !text-ink">Keep editing</button>
              <button type="button" onClick={onClose} className="py-2 text-sm font-semibold text-red-600 hover:underline">Close without saving</button>
            </div>
          </div>
        </div>
      )}

      {studio && (
        <ReliefStudio
          badge={draft}
          storage={appStorage}
          folder={folder}
          onClose={() => setStudio(false)}
          onApply={async (patch) => {
            const next = { ...draft, ...patch }
            setDraft(next)
            // Saved straight away, like the staff portal: the sculpting is the slow part
            if (next.name.trim()) { await onSave({ ...next, name: next.name.trim() }); setSavedJson(JSON.stringify(next)) }
          }}
        />
      )}
    </div>
    </Portal>
  )
}

function gameOf(slot: BadgeSlot): Game | undefined {
  return (slot as BadgeSlot & { game?: Game }).game
}

/** Cards fans collect: search the catalog, tap to add — each card is one spot of the badge */
function CardPicker({ slots, onChange }: { slots: BadgeSlot[]; onChange: (s: BadgeSlot[]) => void }) {
  const [game, setGame] = useState<Game>('pokemon')
  const [q, setQ] = useState('')
  const [results, setResults] = useState<CardSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [cardex, setCardex] = useState(false)
  // The eye on a result: the Cardex's own card view (big card, rarity, set, price)
  const [zoom, setZoom] = useState<ZoomCardData | null>(null)
  useScrollLock(zoom !== null)
  const look = (el: HTMLElement, r: CardSearchResult) => {
    const rarity = r.rarity ? (RARITY_LABELS_BY_GAME[r.game]?.[r.rarity] ?? r.rarity) : ''
    setZoom({
      imageUrl: r.imageUrl, name: r.name, number: r.number, setName: r.setName,
      rarityLabel: rarity.replace('_', ' '), rarityColor: (r.rarity && RARITY_COLORS[r.rarity]) || '#7a6a55',
      marketPrice: r.marketPrice, owned: false, quantity: 0,
      glowColor: zoomGlowColor(r.game, r.rarity ?? '', GAME_COLORS[r.game]),
      originRect: el.getBoundingClientRect(),
    } as ZoomCardData)
  }
  // From the Cardex: its slots for this game, minus cards already picked
  const addFromCardex = (picked: BadgeSlot[]) => {
    const have = new Set(slots.flatMap((s) => s.cardIds))
    const fresh = picked.filter((s) => !s.cardIds.some((id) => have.has(id))) // each carries its own game
    if (fresh.length) onChange([...slots, ...fresh])
  }
  useEffect(() => {
    const query = q.trim()
    if (query.length < 2) { setResults([]); return }
    const t = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/cards/search?${new URLSearchParams({ game, q: query })}`)
        const rows = res.ok ? ((await res.json()) as CardSearchResult[]) : []
        const seen = new Set<string>()
        setResults(rows.filter((r) => !seen.has(r.id) && seen.add(r.id)).slice(0, 24))
      } finally { setLoading(false) }
    }, 300)
    return () => clearTimeout(t)
  }, [q, game])
  const have = new Set(slots.flatMap((s) => s.cardIds))
  const add = (r: CardSearchResult) => {
    if (have.has(r.id)) return onChange(slots.filter((s) => !s.cardIds.includes(r.id)))
    onChange([...slots, { label: r.name, cardIds: [r.id], cards: [{ id: r.id, name: r.name, setName: r.setName, number: r.number, imageUrl: r.imageUrl }], game: r.game } as BadgeSlot])
  }
  return (
    <div>
      <h3 className="text-lg font-bold text-ink">What do fans collect?</h3>
      <p className="text-sm text-slate-400 mt-1">Pick the cards. Owning one of each earns the badge — fans see their progress fill up in your book.</p>
      {/* The picked cards: small tiles that wrap, in a tray that scrolls — fits 3 or 300 */}
      <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Picked</span>
          <span className="rounded-full bg-violet-600 text-white text-[11px] font-bold px-2 py-0.5 tabular-nums">{slots.length}</span>
          {slots.length > 1 && (
            <button type="button" onClick={() => { if (confirm(`Remove all ${slots.length} cards from this badge?`)) onChange([]) }}
              className="ml-auto text-[11px] font-semibold text-slate-500 hover:text-red-600">Clear all</button>
          )}
        </div>
        {slots.length === 0
          ? <p className="text-xs text-slate-500 py-2">None yet — tap cards below to add them.</p>
          : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(46px,1fr))] gap-1.5 max-h-[188px] overflow-y-auto overscroll-contain pr-1">
              {slots.map((s, i) => (
                <button key={s.cardIds.join() + i} type="button" title={`${s.label}${s.cards?.[0]?.setName ? ` · ${s.cards[0].setName}` : ''} — tap to remove`}
                  onClick={() => onChange(slots.filter((_, j) => j !== i))}
                  className="group relative aspect-[63/88] rounded-[5px] overflow-hidden border border-slate-800">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={cardImage(s.cards?.[0]?.imageUrl, 'thumb') ?? s.cards?.[0]?.imageUrl} alt={s.label} loading="lazy" className="w-full h-full object-cover" />
                  <span className="absolute inset-0 bg-red-700/70 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"><X size={16} /></span>
                </button>
              ))}
            </div>
          )}
      </div>
      {/* Which game: a row of pills (scrolls sideways) — then the search, full width */}
      <div className="mt-5">
        <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Game</p>
        <div className="-mx-5 px-5 flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
          {GAMES.map((g) => (
            <button key={g} type="button" onClick={() => setGame(g)}
              className={cn('shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold transition-colors border',
                game === g ? 'text-white border-transparent shadow-sm' : 'border-slate-700 text-slate-400 hover:text-ink hover:border-slate-600')}
              style={game === g ? { background: GAME_COLORS[g] } : undefined}>
              {GAME_LABELS[g]}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3 flex gap-2">
      <div className="relative flex-1 min-w-0">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
        <input className="input-field !pl-10 !pr-10 text-sm" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder={`Search ${GAME_LABELS[game]} cards — e.g. ${game === 'pokemon' ? 'Charizard 4' : 'a name and number'}`} />
        {loading
          ? <Loader2 size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 animate-spin" />
          : q && <button type="button" onClick={() => setQ('')} aria-label="Clear the search" className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-full text-slate-500 hover:text-ink hover:bg-slate-800"><X size={14} /></button>}
      </div>
        <button type="button" onClick={() => setCardex(true)} title={`Browse every ${GAME_LABELS[game]} card, set by set`}
          className="shrink-0 btn-secondary !bg-slate-950 border border-slate-700 !text-ink"><LayoutGrid size={15} /><span className="hidden sm:inline">Cardex</span></button>
      </div>
      {q.trim().length < 2 ? (
        <button type="button" onClick={() => setCardex(true)}
          className="group mt-3 w-full rounded-2xl border-2 border-dashed border-slate-700 hover:border-violet-500 hover:bg-violet-600/5 py-9 flex flex-col items-center gap-1.5 text-center transition-colors">
          <span className="w-12 h-12 rounded-2xl bg-violet-600 text-white flex items-center justify-center shadow-md group-hover:scale-105 transition-transform"><LayoutGrid size={22} /></span>
          <p className="mt-1 text-sm font-bold text-ink">Browse the whole {GAME_LABELS[game]} Cardex</p>
          <p className="text-xs text-slate-500 max-w-xs">Every set, full screen — tap cards to pick them, Shift+click for a run of cards. Or search above.</p>
        </button>
      ) : !loading && results.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500 text-center py-8">No {GAME_LABELS[game]} cards match &ldquo;{q.trim()}&rdquo;</p>
      ) : null}
      <div className="mt-3 grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-1.5">
        {results.map((r) => {
          const on = have.has(r.id)
          return (
            <button key={r.id} type="button" onClick={() => add(r)} title={on ? 'Tap to remove' : 'Tap to add'} className={cn('group relative text-left rounded-lg p-1 transition-colors hover:bg-slate-800', on && 'bg-emerald-600/10')}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={cardImage(r.imageUrl, 'thumb') ?? r.imageUrl} alt="" className={cn('w-full aspect-[63/88] object-cover rounded-md', on && 'ring-2 ring-emerald-600')} />
              {on && <span className="absolute top-2 right-2 w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center shadow"><Check size={14} /></span>}
              <span role="button" tabIndex={0} aria-label={`Look at ${r.name}`} title="Look at the card"
                onClick={(e) => { e.stopPropagation(); look(e.currentTarget.closest('button')!, r) }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); look(e.currentTarget.closest('button')!, r) } }}
                className="absolute top-2 left-2 w-7 h-7 rounded-full bg-black/60 text-white flex items-center justify-center shadow opacity-100 sm:opacity-0 sm:group-hover:opacity-100 hover:bg-black/80 transition-opacity"><Eye size={14} /></span>
              <p className="text-[11px] font-semibold text-ink truncate mt-1">{r.name}</p>
              <p className="text-[10px] text-slate-500 truncate">{r.setName}{r.number ? ` · #${r.number}` : ''}</p>
              {on && <p className="text-[10px] text-emerald-700 font-semibold">Added · tap to remove</p>}
            </button>
          )
        })}
      </div>
      {/* On the page itself: inside the panel (animated with a transform) a fixed overlay would be boxed in */}
      {typeof document !== 'undefined' && createPortal(<CardZoomOverlay data={zoom} onClose={() => setZoom(null)} viewOnly />, document.body)}
      {cardex && (
        <CardexCardPicker game={game} games={GAMES} onAdd={addFromCardex} onClose={() => setCardex(false)}
          title="Pick cards for this badge"
          addLabel={(n) => `Add ${n || ''} card${n === 1 ? '' : 's'} to the badge`} />
      )}
    </div>
  )
}

// When fans' pins change look (BadgeDef.tiers / tiersOff — the same rule as TCG Haven's own badges,
// lib/badges.ts badgeTier): Grayscale (can be switched off: the pin stays a hole until Full) and
// Full colour. Set as a % or as a number of cards; stored as a % either way, so it keeps working
// when cards are added later.
function UnlockEditor({ def, onChange }: { def: BadgeDef; onChange: (p: Partial<BadgeDef>) => void }) {
  const [byCards, setByCards] = useState(false)
  const total = def.slots.length
  const [grayPct, fullPct] = tierPercents(def)
  const grayOn = looksOn(def).includes(1)
  const grayN = tierNeed(def, 1, total), fullN = tierNeed(def, 3, total)
  const noun = def.slotNoun || 'cards'
  const put = (i: 0 | 1, pct: number) => {
    const next = [grayPct, fullPct] as [number, number]
    next[i] = Math.min(100, Math.max(1, pct))
    if (i === 0) next[1] = Math.max(next[1], next[0]); else next[0] = Math.min(next[0], next[1]) // Grayscale ≤ Full
    onChange({ tiers: next.join() === DEFAULT_TIERS.join() ? undefined : next })
  }
  // n cards → the exact % (not rounded: rounding could land a card off, lib/badges.ts tierNeed)
  const putCards = (i: 0 | 1, n: number) => put(i, (Math.min(total, Math.max(1, n)) * 100) / total)

  // a plain function, not a component: a component defined in here would remount on every change
  // and drop the slider mid-drag
  const row = (i: 0 | 1, title: string, hint: string, on: boolean, pct: number, n: number, color: string) => (
    <div key={i} className={cn('rounded-xl border border-slate-800 bg-slate-950/40 p-3', !on && 'opacity-50')}>
      <div className="flex items-center gap-2">
        <span className="w-3 h-3 rounded-full shrink-0" style={{ background: color }} />
        <span className="text-sm font-bold text-ink">{title}</span>
        {i === 0 && (
          <label className="ml-auto flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 cursor-pointer">
            <input type="checkbox" checked={on} onChange={(e) => onChange({ tiersOff: e.target.checked ? undefined : [1] })} />Use it
          </label>
        )}
        <span className={cn('text-xs font-bold tabular-nums text-ink', i === 0 ? '' : 'ml-auto')}>
          {byCards ? `${n} of ${total}` : `${Math.round(pct)}%`}
        </span>
      </div>
      <input type="range" disabled={!on} className="w-full mt-2 accent-[#7a5a3a]"
        min={1} max={byCards ? total : 100} step={1} value={byCards ? n : Math.round(pct)}
        onChange={(e) => (byCards ? putCards(i, Number(e.target.value)) : put(i, Number(e.target.value)))} />
      <p className="text-[11px] text-slate-500">{on ? (byCards ? `${Math.round(pct)}% of the badge` : `${n} of ${total} ${noun}`) + ' · ' + hint : 'Off — the pin stays an empty spot until Full colour'}</p>
    </div>
  )

  return (
    <div className="mt-6">
      <div className="flex items-center gap-2">
        <h3 className="text-base font-bold text-ink">When fans unlock the pin</h3>
        <div className="ml-auto flex rounded-lg bg-slate-950/60 border border-slate-800 p-0.5 text-[11px] font-bold">
          {(['%', 'Cards'] as const).map((m) => (
            <button key={m} type="button" onClick={() => setByCards(m === 'Cards')}
              className={cn('px-2.5 py-1 rounded-md', (m === 'Cards') === byCards ? 'bg-violet-600 text-white' : 'text-slate-500 hover:text-ink')}>{m}</button>
          ))}
        </div>
      </div>
      <p className="text-xs text-slate-500 mt-1">The pin changes as fans collect — first a grey version, then full colour.</p>
      {/* The two marks on one bar */}
      <div className="relative mt-3 h-2 rounded-full bg-slate-800">
        {grayOn && <span className="absolute inset-y-0 left-0 rounded-l-full bg-slate-500/70" style={{ width: `${(fullN / total) * 100}%` }} />}
        <span className="absolute inset-y-0 rounded-r-full" style={{ left: `${(fullN / total) * 100}%`, right: 0, background: 'linear-gradient(90deg, #c9a24a, #e8b35a)' }} />
        {grayOn && <span className="absolute -top-1 w-1 h-4 rounded bg-slate-300 -translate-x-1/2" style={{ left: `${(grayN / total) * 100}%` }} title={`Grayscale at ${grayN}`} />}
        <span className="absolute -top-1 w-1 h-4 rounded bg-[#e8b35a] -translate-x-1/2" style={{ left: `${(fullN / total) * 100}%` }} title={`Full at ${fullN}`} />
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {row(0, 'Grayscale pin', 'a grey preview of the pin', grayOn, grayPct, grayN, '#94a3b8')}
        {row(1, 'Full colour pin', fullN === total ? 'every card needed' : 'set to 100% to need every card', true, fullPct, fullN, '#e8b35a')}
      </div>
    </div>
  )
}

