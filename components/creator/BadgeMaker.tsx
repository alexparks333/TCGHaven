'use client'

// Making (or editing) one of a creator's badges — opened from a "+" in their book (BookPlanner).
// Four friendly steps, with the pin shown big on velvet the whole time:
//   1. Pin art — upload the artwork (a PNG with a see-through background is best)
//   2. Name it — the name on its brass plate, and how fans earn it
//   3. What fans collect — cards from the catalog; owning one of each earns the badge
//   4. Make it 3D — the Relief Studio (the same one staff use) sculpts the pin from the art, on a
//      GPU in the cloud (docs/creators.md "The 3D maker's GPU"). Optional: without it the pin still
//      gets an automatic 3D look.
// Files go to Storage creators/{uid}/badges/{id}/ (storage.rules).

import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { X, Upload, Loader2, Search, Trash2, Box, Check, ImageIcon, PenLine, Layers } from 'lucide-react'
import type { BadgeDef, BadgeSet, BadgeSlot } from '@/lib/badges'
import { BadgePin } from '@/components/badges/BadgePin'
import { appStorage } from '@/lib/firebase/appStorage'
import { auth } from '@/lib/firebase/config'
import { RELIEF_SERVER, setReliefEndpoint } from '@/lib/reliefStudio'
import { GAME_LABELS, type Game } from '@/lib/types'
import type { CardSearchResult } from '@/lib/api/search'
import { cardImage } from '@/lib/cardImage'
import { useScrollLock } from '@/lib/useScrollLock'
import { cn } from '@/lib/utils'

const ReliefStudio = dynamic(() => import('@/components/admin/ReliefStudio'), { ssr: false })

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
  const fileInput = useRef<HTMLInputElement>(null)
  const folder = `creators/${uid}/badges/${draft.id}`
  const { accent, from, to } = book.cover

  async function uploadArt(file: File | undefined) {
    if (!file) return
    setBusy('Uploading your art…'); setError('')
    try {
      const r = ref(appStorage, `${folder}/art-${Date.now()}.${(file.name.split('.').pop() || 'png').toLowerCase()}`)
      await uploadBytes(r, file, { contentType: file.type || 'image/png' })
      const url = await getDownloadURL(r)
      // New art: any 3D work made from the old picture no longer fits it
      set({ imageUrl: url, reliefKit: undefined, relief: undefined, depthMapUrl: undefined, normalMapUrl: undefined, finishMapUrl: undefined, detailMapUrl: undefined, reliefBuildUrl: undefined, reliefBuildKey: undefined })
      setStep(2)
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
      <div className="add-card-backdrop absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={busy ? undefined : onClose} />
      <div className="add-card-panel relative w-full max-w-[920px] card-glass rounded-t-2xl sm:rounded-2xl max-h-[94dvh] flex flex-col md:flex-row overflow-hidden">
        {/* The pin, big, on the book's velvet */}
        <div className="relative md:w-[42%] shrink-0 flex flex-col items-center justify-center gap-4 p-6 md:p-8" style={{ background: `linear-gradient(150deg, ${from}, ${to})` }}>
          <div className="absolute inset-[10px] rounded-xl pointer-events-none" style={{ background: 'radial-gradient(ellipse at 50% 40%, #2c2240 0%, #1a1427 60%, #0f0b18 100%)', boxShadow: 'inset 0 0 40px rgba(0,0,0,0.6)' }} />
          <div className="absolute inset-[18px] rounded-lg border pointer-events-none" style={{ borderColor: accent + '88' }} />
          <button type="button" onClick={onClose} className="md:hidden absolute top-4 right-4 z-10 p-2 rounded-full bg-black/40 text-white" aria-label="Close"><X size={18} /></button>
          <div className="relative w-[min(240px,52vw)] aspect-square flex items-center justify-center drop-shadow-[0_14px_14px_rgba(0,0,0,0.6)]">
            {draft.imageUrl
              ? <BadgePin art={draft.art} imageUrl={draft.imageUrl} size={220} />
              : <span className="w-[70%] aspect-square rounded-full border-2 border-dashed flex items-center justify-center text-center text-xs px-6" style={{ borderColor: accent + 'aa', color: accent }}>Your pin appears here</span>}
          </div>
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
                <p className="text-sm text-slate-400 mt-1">Upload the artwork for this badge. A PNG with a see-through background looks best — it becomes the enamel pin in your book.</p>
                <button type="button" disabled={!!busy} onClick={() => fileInput.current?.click()}
                  className="mt-4 w-full rounded-2xl border-2 border-dashed border-slate-700 hover:border-violet-500 bg-slate-950/40 py-10 flex flex-col items-center gap-2 text-slate-500 hover:text-ink transition-colors">
                  {busy ? <Loader2 size={28} className="animate-spin" /> : <Upload size={28} />}
                  <span className="font-semibold">{busy || (draft.imageUrl ? 'Upload different art' : 'Choose your pin art')}</span>
                  <span className="text-xs">PNG, WebP or JPG · up to 25 MB</span>
                </button>
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
    if (have.has(r.id)) return
    onChange([...slots, { label: r.name, cardIds: [r.id], cards: [{ id: r.id, name: r.name, setName: r.setName, number: r.number, imageUrl: r.imageUrl }], game: r.game } as BadgeSlot])
  }
  return (
    <div>
      <h3 className="text-lg font-bold text-ink">What do fans collect?</h3>
      <p className="text-sm text-slate-400 mt-1">Pick the cards. Owning one of each earns the badge — fans see their progress fill up in your book.</p>
      {slots.length > 0 && (
        <div className="mt-4 flex gap-2 overflow-x-auto no-scrollbar pb-1">
          {slots.map((s, i) => (
            <div key={s.cardIds.join() + i} className="relative shrink-0 w-[68px]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={cardImage(s.cards?.[0]?.imageUrl, 'thumb') ?? s.cards?.[0]?.imageUrl} alt="" className="w-[68px] h-[95px] object-cover rounded-md border border-slate-800" />
              <button type="button" onClick={() => onChange(slots.filter((_, j) => j !== i))} className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-600 text-white flex items-center justify-center shadow" aria-label={`Remove ${s.label}`}><X size={12} /></button>
              <p className="text-[10px] text-slate-400 truncate mt-1">{s.label}</p>
            </div>
          ))}
        </div>
      )}
      <div className="mt-4 flex gap-2">
        <select className="input-field !w-auto text-sm" value={game} onChange={(e) => setGame(e.target.value as Game)}>
          {GAMES.map((g) => <option key={g} value={g}>{GAME_LABELS[g]}</option>)}
        </select>
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input className="input-field pl-9 text-sm" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a card — name, or name and number" />
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 sm:grid-cols-4 gap-2">
        {loading && <p className="col-span-full text-sm text-slate-500 flex items-center gap-2"><Loader2 size={14} className="animate-spin" />Searching…</p>}
        {results.map((r) => {
          const on = have.has(r.id)
          return (
            <button key={r.id} type="button" onClick={() => add(r)} disabled={on} className={cn('text-left rounded-lg p-1 transition-colors', on ? 'opacity-50' : 'hover:bg-slate-800')}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={cardImage(r.imageUrl, 'thumb') ?? r.imageUrl} alt="" className="w-full aspect-[63/88] object-cover rounded-md" />
              <p className="text-[11px] font-semibold text-ink truncate mt-1">{r.name}</p>
              <p className="text-[10px] text-slate-500 truncate">{r.setName}{r.number ? ` · #${r.number}` : ''}</p>
              {on && <p className="text-[10px] text-emerald-700 font-semibold">Added</p>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
