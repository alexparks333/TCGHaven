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
import dynamic from 'next/dynamic'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { X, Upload, Loader2, Search, Trash2, Box, Check, ImageIcon, PenLine, Layers, ArrowRight } from 'lucide-react'
import type { BadgeDef, BadgeSet, BadgeSlot } from '@/lib/badges'
import { BadgePin } from '@/components/badges/BadgePin'
import { useBadgeCatalog } from '@/lib/badgeCatalog'
import { badgeArt } from '@/lib/badgeAssets'
import { appStorage } from '@/lib/firebase/appStorage'
import { cutOutWhite } from '@/lib/pinArtCutout'
import { auth } from '@/lib/firebase/config'
import { RELIEF_SERVER, setReliefEndpoint } from '@/lib/reliefStudio'
import { GAME_LABELS, type Game } from '@/lib/types'
import type { CardSearchResult } from '@/lib/api/search'
import { cardImage } from '@/lib/cardImage'
import { useScrollLock } from '@/lib/useScrollLock'
import { cn } from '@/lib/utils'

const ReliefStudio = dynamic(() => import('@/components/admin/ReliefStudio'), { ssr: false })
const PinInspector = dynamic(() => import('@/components/badges/PinInspector'), { ssr: false }) // the sculpted pin, in 3D

const GAMES = Object.keys(GAME_LABELS) as Game[]

export function BadgeMaker({ uid, book, badge, onSave, onDelete, onClose }: {
  uid: string
  book: BadgeSet
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
  const sculpted = !!(draft.imageUrl && draft.reliefKit && !studio) // the Studio has its own big view while open
  const fileInput = useRef<HTMLInputElement>(null)
  const folder = `creators/${uid}/badges/${draft.id}`
  // An example to follow: one of TCG Haven's own finished pins (uploaded art, see-through background)
  const { catalog } = useBadgeCatalog()
  const example = catalog.badges.find((b) => b.imageUrl && !b.set.startsWith('creator-'))
  const { accent, from, to } = book.cover

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
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
      {/* No close on an outside click: a pin in progress would be lost to a stray click — only ✕ closes */}
      <div className="add-card-backdrop absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="add-card-panel relative w-full max-w-[920px] card-glass rounded-t-2xl sm:rounded-2xl h-[94dvh] md:h-[min(94dvh,760px)] flex flex-col md:flex-row overflow-hidden">
        {/* The pin, big, on the book's velvet */}
        <div className="relative md:w-[42%] shrink-0 flex flex-col items-center justify-center gap-4 p-6 md:p-8" style={{ background: `linear-gradient(150deg, ${from}, ${to})` }}>
          <div className="absolute inset-[10px] rounded-xl pointer-events-none" style={{ background: 'radial-gradient(ellipse at 50% 40%, #2c2240 0%, #1a1427 60%, #0f0b18 100%)', boxShadow: 'inset 0 0 40px rgba(0,0,0,0.6)' }} />
          <div className="absolute inset-[18px] rounded-lg border pointer-events-none" style={{ borderColor: accent + '88' }} />
          <button type="button" onClick={onClose} className="md:hidden absolute top-4 right-4 z-10 p-2 rounded-full bg-black/40 text-white" aria-label="Close"><X size={18} /></button>
          {/* Once it's sculpted: the real 3D pin, to turn over. Before that: the flat art */}
          {sculpted ? (
            <div className="relative w-full flex-1 min-h-[260px] max-h-[460px]">
              <PinInspector key={draft.reliefBuildKey ?? draft.depthMapUrl} def={draft} embedded onClose={() => {}} />
              <p className="absolute bottom-1 inset-x-0 text-center text-[11px] text-[#e9dcc3]/60 pointer-events-none">Drag to turn it · scroll to zoom</p>
            </div>
          ) : (
          <div className="relative w-[min(240px,52vw)] aspect-square flex items-center justify-center drop-shadow-[0_14px_14px_rgba(0,0,0,0.6)]">
            {draft.imageUrl
              ? <BadgePin art={draft.art} imageUrl={draft.imageUrl} size={220} />
              : <span className="w-[70%] aspect-square rounded-full border-2 border-dashed flex items-center justify-center text-center text-xs px-6" style={{ borderColor: accent + 'aa', color: accent }}>Your pin appears here</span>}
          </div>
          )}
          <span className="relative pinbook-serif max-w-[90%] truncate rounded px-3 py-1 text-xs font-bold uppercase tracking-wider" style={{ background: `linear-gradient(180deg, ${accent}, #6b4a17)`, color: '#1c1206' }}>
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
            <button type="button" onClick={onClose} className="hidden md:block ml-auto p-2 rounded-lg text-slate-500 hover:text-ink hover:bg-slate-800" aria-label="Close"><X size={18} /></button>
          </div>

          <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-5">
            {step === 1 && (
              <div>
                <h3 className="text-lg font-bold text-ink">Your pin art</h3>
                <p className="text-sm text-slate-400 mt-1">Upload the artwork for this badge — just the pin itself. Already cut out, or on a plain white background: we take the white away for you. It becomes the enamel pin in your book.</p>
                {/* What to upload: a real pin cut out, and the same art on white (cut out for you on upload) */}
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border-2 border-emerald-600/50 bg-slate-950/40 p-3">
                    <div className="aspect-square rounded-xl bg-[repeating-conic-gradient(#d8ccb2_0%_25%,#ece2cc_0%_50%)] [background-size:18px_18px] flex items-center justify-center p-[10%]">
                      {example?.imageUrl
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={badgeArt(example.imageUrl, 384)} alt="An example pin" className="max-w-full max-h-full object-contain drop-shadow-[0_6px_6px_rgba(0,0,0,0.35)]" />
                        : <BadgePin art="crest" size={120} />}
                    </div>
                    <p className="mt-2 text-xs font-bold text-emerald-700 flex items-center gap-1"><Check size={13} />Like this</p>
                    <p className="text-[11px] text-slate-500 leading-snug">Already cut out (see-through around it)</p>
                  </div>
                  <div className="rounded-2xl border-2 border-emerald-600/50 bg-slate-950/40 p-3">
                    <div className="aspect-square rounded-xl bg-[repeating-conic-gradient(#d8ccb2_0%_25%,#ece2cc_0%_50%)] [background-size:18px_18px] flex items-center justify-center p-[6%]">
                      <span className="w-full h-full bg-white rounded-md shadow-inner flex items-center justify-center p-[12%] relative">
                        {example?.imageUrl
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={badgeArt(example.imageUrl, 384)} alt="" className="max-w-full max-h-full object-contain" />
                          : <BadgePin art="crest" size={100} />}
                      </span>
                    </div>
                    <p className="mt-2 text-xs font-bold text-emerald-700 flex items-center gap-1"><Check size={13} />This works too</p>
                    <p className="text-[11px] text-slate-500 leading-snug">On plain white — we cut the white away</p>
                  </div>
                </div>
                <ul className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[12px] leading-snug text-slate-400">
                  <li className="flex gap-1.5"><Check size={13} className="text-emerald-700 shrink-0 mt-0.5" />Cut out, or on plain white</li>
                  <li className="flex gap-1.5"><Check size={13} className="text-emerald-700 shrink-0 mt-0.5" />The pin&rsquo;s own shape — any shape works</li>
                  <li className="flex gap-1.5"><Check size={13} className="text-emerald-700 shrink-0 mt-0.5" />At least 1000 × 1000 px</li>
                  <li className="flex gap-1.5"><Check size={13} className="text-emerald-700 shrink-0 mt-0.5" />Bold shapes and colours read best small</li>
                </ul>
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

            {step === 3 && <CardPicker slots={draft.slots} onChange={(slots) => set({ slots })} />}

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
            if (next.name.trim()) await onSave({ ...next, name: next.name.trim() })
          }}
        />
      )}
    </div>
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
      <div className="mt-4 flex gap-2">
        <select className="input-field !w-auto text-sm" value={game} onChange={(e) => setGame(e.target.value as Game)}>
          {GAMES.map((g) => <option key={g} value={g}>{GAME_LABELS[g]}</option>)}
        </select>
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input className="input-field pl-9 text-sm" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a card — name, or name and number" />
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-1.5">
        {loading && <p className="col-span-full text-sm text-slate-500 flex items-center gap-2"><Loader2 size={14} className="animate-spin" />Searching…</p>}
        {results.map((r) => {
          const on = have.has(r.id)
          return (
            <button key={r.id} type="button" onClick={() => add(r)} title={on ? 'Tap to remove' : 'Tap to add'} className={cn('relative text-left rounded-lg p-1 transition-colors hover:bg-slate-800', on && 'bg-emerald-600/10')}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={cardImage(r.imageUrl, 'thumb') ?? r.imageUrl} alt="" className={cn('w-full aspect-[63/88] object-cover rounded-md', on && 'ring-2 ring-emerald-600')} />
              {on && <span className="absolute top-2 right-2 w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center shadow"><Check size={14} /></span>}
              <p className="text-[11px] font-semibold text-ink truncate mt-1">{r.name}</p>
              <p className="text-[10px] text-slate-500 truncate">{r.setName}{r.number ? ` · #${r.number}` : ''}</p>
              {on && <p className="text-[10px] text-emerald-700 font-semibold">Added · tap to remove</p>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
