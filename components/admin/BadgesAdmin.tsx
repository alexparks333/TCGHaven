'use client'

import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import {
  Plus, Pencil, Trash2, Box, Loader2, Search, X, Upload, Check, Cuboid, BookOpen, AlertTriangle, ImageIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { badgeAsset } from '@/lib/badgeAssets'
import { staffDb, staffStorage } from '@/lib/firebase/staff'
import { useBadgeCatalog, saveBadgeCatalog } from '@/lib/badgeCatalog'
import { PIN_BACKS, type PinBackId, badgeSlug, badgesInSet, chaptersOf, type BadgeCatalog, type BadgeDef, type BadgeSet, type BadgeSlot, type SlotCard } from '@/lib/badges'
import { GAME_LABELS, type Game } from '@/lib/types'
import { BadgePin, BUILT_IN_PIN_ART } from '@/components/badges/BadgePin'
import { BookCover } from '@/components/badges/BadgeLibrary'
import ChaptersBoard from './ChaptersBoard'
import CardexCardPicker from './CardexCardPicker'

const PinInspector = dynamic(() => import('@/components/badges/PinInspector'), { ssr: false })

// Staff portal → Badges: the pin books (badge sets) and Haven Badges every collector sees. Saved to
// Firestore badge_catalog/main (one doc — lib/badgeCatalog.ts); changes go live for everyone
// immediately. Files (pin art, 3D models, normal maps) upload to Storage under badges/{id}/.

const GAMES: Game[] = ['riftbound', 'pokemon', 'lorcana', 'onepiece', 'mtg']

export function BadgesAdmin() {
  const { catalog, loaded } = useBadgeCatalog()
  const [setId, setSetId] = useState<string | null>(null)
  const [editBadge, setEditBadge] = useState<BadgeDef | null>(null)
  const [editSet, setEditSet] = useState<BadgeSet | null>(null)
  const [preview, setPreview] = useState<BadgeDef | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const selected = catalog.sets.find((s) => s.id === setId) ?? catalog.sets[0]
  async function persist(next: BadgeCatalog) {
    setBusy(true); setError('')
    try { await saveBadgeCatalog(staffDb, next) } catch (e) {
      console.error(e); setError('Couldn’t save — check you’re signed in as staff and try again.')
      throw e
    } finally { setBusy(false) }
  }

  async function deleteBadge(b: BadgeDef) {
    if (!confirm(`Delete the "${b.name}" badge? Collectors who earned it keep the record, but it won't show anywhere.`)) return
    await persist({ ...catalog, badges: catalog.badges.filter((x) => x.id !== b.id) })
  }

  async function deleteSet(s: BadgeSet) {
    if (badgesInSet(catalog, s.id).length) { setError('Move or delete this book’s badges first.'); return }
    if (!confirm(`Delete the "${s.name}" book?`)) return
    await persist({ ...catalog, sets: catalog.sets.filter((x) => x.id !== s.id) })
    setSetId(null)
  }

  function newBadge(chapter: string): BadgeDef {
    return {
      id: '', set: selected?.id ?? catalog.sets[0]?.id ?? '', page: chapter,
      name: '', description: '', game: selected?.game ?? 'riftbound', slotNoun: 'cards', slots: [], art: 'crest',
    }
  }

  if (!loaded) return <div className="flex justify-center py-24"><Loader2 size={26} className="animate-spin text-slate-500" /></div>

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-ink">Badges</h1>
        <p className="text-slate-400 text-sm mt-0.5">
          The pin books and Haven Badges collectors earn. Changes go live for everyone as soon as you save.
        </p>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-600/40 bg-red-100/20 px-3 py-2 text-sm text-red-600">
          <AlertTriangle size={15} />{error}
        </div>
      )}

      {/* Books */}
      <div className="flex items-center gap-2 flex-wrap mb-5">
        {catalog.sets.map((s) => (
          <button
            key={s.id}
            onClick={() => setSetId(s.id)}
            className={cn(
              'flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-xl border text-sm font-semibold transition-colors',
              selected?.id === s.id ? 'bg-slate-800 border-slate-600 text-ink' : 'border-slate-800 text-slate-400 hover:text-ink',
            )}
          >
            <span className="w-4 h-5 rounded-sm" style={{ background: `linear-gradient(150deg, ${s.cover.from}, ${s.cover.to})` }} />
            {s.name}
            <span className="text-[11px] text-slate-500">{badgesInSet(catalog, s.id).length}</span>
          </button>
        ))}
        <button onClick={() => setEditSet({ id: '', name: '', subtitle: 'Haven Badges', monogram: '', game: 'riftbound', cover: { from: '#5a4632', to: '#1c140c', accent: '#e8b35a' } })}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-dashed border-slate-700 text-sm font-semibold text-slate-400 hover:text-ink hover:border-slate-600">
          <Plus size={14} />New book
        </button>
      </div>

      {selected && (
        <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)] items-start">
          {/* The book */}
          <div className="flex flex-col items-center gap-3">
            <div className="relative w-[200px] aspect-[0.71]"><BookCover set={selected} badges={null} /></div>
            <div className="flex gap-2">
              <button onClick={() => setEditSet(selected)} className="btn-secondary !px-3 !py-1.5 !text-xs"><Pencil size={13} />Edit book</button>
              <button onClick={() => deleteSet(selected)} className="btn-secondary !px-3 !py-1.5 !text-xs hover:!text-red-600"><Trash2 size={13} />Delete</button>
            </div>
            <div className="text-[11px] text-slate-500 text-center">{GAME_LABELS[selected.game]} · id <code>{selected.id}</code></div>
          </div>

          {/* Its chapters, each with its pages of pins */}
          <div>
            <div className="flex items-center mb-3">
              <h2 className="text-lg font-bold text-ink">{selected.name} · chapters</h2>
              <span className="ml-3 text-xs text-slate-500 hidden md:inline">Drag pins to reorder or move them between chapters · click a chapter&rsquo;s name to rename it</span>
            </div>
            <ChaptersBoard
              catalog={catalog}
              set={selected}
              persist={persist}
              onEdit={setEditBadge}
              onNew={(chapter) => setEditBadge(newBadge(chapter))}
              onPreview={setPreview}
              onDelete={deleteBadge}
            />
          </div>
        </div>
      )}

      {busy && <div className="fixed bottom-4 right-4 flex items-center gap-2 rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-ink shadow-lg"><Loader2 size={14} className="animate-spin" />Saving…</div>}

      {editBadge && (
        <BadgeEditor
          catalog={catalog}
          initial={editBadge}
          onPreview={setPreview}
          onClose={() => setEditBadge(null)}
          onSave={async (b, originalId) => {
            const exists = catalog.badges.some((x) => x.id === originalId && originalId)
            const badges = exists ? catalog.badges.map((x) => (x.id === originalId ? b : x)) : [...catalog.badges, b]
            // a chapter typed in the editor joins the book's chapter list (at the end)
            const sets = catalog.sets.map((s) => (s.id === b.set && !chaptersOf(catalog, s.id).includes(b.page) ? { ...s, chapters: [...chaptersOf(catalog, s.id), b.page] } : s))
            await persist({ ...catalog, sets, badges })
            setSetId(b.set)
            setEditBadge(null)
          }}
        />
      )}
      {editSet && (
        <SetEditor
          catalog={catalog}
          initial={editSet}
          onClose={() => setEditSet(null)}
          onSave={async (s, originalId) => {
            const exists = !!originalId && catalog.sets.some((x) => x.id === originalId)
            const sets = exists ? catalog.sets.map((x) => (x.id === originalId ? s : x)) : [...catalog.sets, s]
            await persist({ ...catalog, sets })
            setSetId(s.id)
            setEditSet(null)
          }}
        />
      )}
      {preview && <PinInspector def={preview} onClose={() => setPreview(null)} />}
    </div>
  )
}

// ── Modal shell ─────────────────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-3xl max-h-[92dvh] card-glass bg-slate-900 rounded-2xl flex flex-col overflow-hidden">
        <div className="flex items-center px-5 py-4 border-b border-slate-800">
          <h2 className="text-lg font-bold text-ink">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="ml-auto w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-ink hover:bg-slate-800"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
        <div className="px-5 py-3 border-t border-slate-800 flex items-center gap-2 justify-end">{footer}</div>
      </div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-slate-500 mt-1">{hint}</span>}
    </label>
  )
}

// ── Badge editor ────────────────────────────────────────────────────────────────────────────

function BadgeEditor({ catalog, initial, onClose, onSave, onPreview }: {
  catalog: BadgeCatalog
  initial: BadgeDef
  onClose: () => void
  onSave: (b: BadgeDef, originalId: string) => Promise<void>
  onPreview: (b: BadgeDef) => void
}) {
  const isNew = !initial.id
  const [b, setB] = useState<BadgeDef>(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const book = catalog.sets.find((s) => s.id === b.set)
  const chaptersInBook = chaptersOf(catalog, b.set)
  const [newChapter, setNewChapter] = useState(!!initial.page && !chaptersOf(catalog, initial.set).includes(initial.page))
  const id = isNew ? badgeSlug(b.name) : b.id
  const patch = (p: Partial<BadgeDef>) => setB((x) => ({ ...x, ...p }))

  async function save() {
    setError('')
    if (!b.name.trim()) return setError('Give the badge a name.')
    if (!b.set) return setError('Pick a book.')
    if (!b.page.trim()) return setError('Pick a chapter (or start a new one).')
    if (isNew && catalog.badges.some((x) => x.id === id)) return setError(`A badge with the id "${id}" already exists — change the name.`)
    setSaving(true)
    try {
      await onSave({ ...b, id, game: book?.game ?? b.game, name: b.name.trim(), page: b.page.trim() }, initial.id)
    } catch {
      setError('Couldn’t save.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={isNew ? 'New badge' : `Edit · ${initial.name}`}
      onClose={onClose}
      footer={<>
        <button onClick={() => onPreview({ ...b, id: id || 'preview' })} className="btn-secondary mr-auto"><Cuboid size={15} />Preview in 3D</button>
        {error && <span className="text-xs text-red-600 mr-2">{error}</span>}
        <button onClick={onClose} className="btn-secondary">Cancel</button>
        <button onClick={save} disabled={saving} className="btn-primary disabled:opacity-60">{saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}Save badge</button>
      </>}
    >
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_200px]">
        <div className="flex flex-col gap-4">
          <Field label="Name" hint={isNew ? `id: ${id || '—'} (set from the name; can't change later)` : `id: ${b.id}`}>
            <input className="input-field" value={b.name} onChange={(e) => patch({ name: e.target.value })} placeholder="Origins Overnumbered" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Book">
              <select className="input-field" value={b.set} onChange={(e) => patch({ set: e.target.value })}>
                {catalog.sets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Chapter" hint="The chapter of the book it's pinned in.">
              {newChapter || !chaptersInBook.length ? (
                <div className="flex gap-1.5">
                  <input className="input-field" autoFocus value={b.page} onChange={(e) => patch({ page: e.target.value })} placeholder="New chapter name" />
                  {chaptersInBook.length > 0 && <button type="button" onClick={() => { setNewChapter(false); patch({ page: chaptersInBook[0] }) }} className="btn-secondary !px-2" title="Pick an existing chapter"><X size={14} /></button>}
                </div>
              ) : (
                <select className="input-field" value={b.page} onChange={(e) => { if (e.target.value === '__new') { setNewChapter(true); patch({ page: '' }) } else patch({ page: e.target.value }) }}>
                  {!b.page && <option value="">Pick a chapter…</option>}
                  {chaptersInBook.map((c) => <option key={c} value={c}>{c}</option>)}
                  <option value="__new">＋ New chapter…</option>
                </select>
              )}
            </Field>
          </div>
          <Field label="How to earn it" hint="Shown when collectors hover the pin.">
            <textarea className="input-field resize-none" rows={2} value={b.description} onChange={(e) => patch({ description: e.target.value })}
              placeholder="Collect the Overnumbered or Signature printing of every Legend in Riftbound: Origins." />
          </Field>
          <Field label="What each slot is called" hint={`Progress reads like "3 / ${b.slots.length || 12} ${b.slotNoun || 'cards'}".`}>
            <input className="input-field" value={b.slotNoun} onChange={(e) => patch({ slotNoun: e.target.value })} placeholder="Legends" />
          </Field>

          <SlotsEditor game={book?.game ?? b.game} slots={b.slots} onChange={(slots) => patch({ slots })} />
        </div>

        {/* Look */}
        <div className="flex flex-col gap-3">
          <div className="rounded-2xl bg-[#181513] p-4 flex items-center justify-center">
            <BadgePin art={b.art} imageUrl={b.imageUrl} size={120} />
          </div>
          <FileField label="Pin art" accept="image/png,image/webp,image/jpeg" badgeId={id || 'new'} kind="art" value={b.imageUrl} onChange={(imageUrl) => patch({ imageUrl })} />
          {!b.imageUrl && (
            <Field label="Built-in art">
              <select className="input-field" value={b.art} onChange={(e) => patch({ art: e.target.value })}>
                {BUILT_IN_PIN_ART.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </Field>
          )}
          <FileField label="3D model (.glb)" accept=".glb,.gltf" badgeId={id || 'new'} kind="model" value={b.model} onChange={(model) => patch({ model })} icon={<Box size={13} />} />
          {b.model && <ModelFront badge={b} badgeId={id || 'new'} patch={patch} />}
          {b.model && (
            <Field label="Pin back">
              <select className="input-field" value={b.pinBack ?? 'classic'} onChange={(e) => patch({ pinBack: e.target.value as PinBackId })}>
                {PIN_BACKS.map((pb) => <option key={pb.id} value={pb.id}>{pb.label}</option>)}
              </select>
            </Field>
          )}
          <FileField label="Normal map" accept="image/*" badgeId={id || 'new'} kind="normal" value={b.normalMapUrl} onChange={(normalMapUrl) => patch({ normalMapUrl })} />
          <FileField label="Depth map" accept="image/*" badgeId={id || 'new'} kind="depth" value={b.depthMapUrl} onChange={(depthMapUrl) => patch({ depthMapUrl })} />
          <p className="text-[11px] text-slate-500 leading-snug">
            With a 3D model, that&rsquo;s what the 3D view shows. Without one, it builds the pin from the art — a depth map of the art (white = near) gives it its real sculpted shape.
          </p>
        </div>
      </div>
    </Modal>
  )
}

// A badge with a 3D model: which side is the front, and the pin book's picture.
// Meshy mirrors the front onto the back and isn't consistent about which side is the real one, so
// both sides are rendered for staff to pick from (and, when the badge has its uploaded art, the
// one matching the art is picked automatically). The book's picture is a straight-on render of the
// chosen side, remade whenever the side changes, so the book shows exactly the 3D pin.
// (components/badges/pinSnapshot.ts — loaded on demand.) Generated pictures are saved as
// picture-*.png, uploaded art as art-*.png, so the art can still be told apart for matching.
const isUploadedArt = (url?: string) => !!url && /%2Fart-\d+\./.test(url)

function ModelFront({ badge, badgeId, patch }: { badge: BadgeDef; badgeId: string; patch: (p: Partial<BadgeDef>) => void }) {
  const [sides, setSides] = useState<string[] | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState('')
  const guessed = useRef('')
  const front = badge.modelFrontPositiveZ ? 1 : 0
  const art = isUploadedArt(badge.imageUrl) ? badge.imageUrl : undefined

  async function makePicture(frontPositiveZ: boolean) {
    setStatus('Making the book picture…'); setError('')
    try {
      const { renderPinFront } = await import('@/components/badges/pinSnapshot')
      const png = await renderPinFront(badgeAsset(badge.model)!, { back: badge.pinBack, frontPositiveZ })
      const r = ref(staffStorage, `badges/${badgeId}/picture-${Date.now()}.png`)
      await uploadBytes(r, png, { contentType: 'image/png' })
      patch({ modelFrontPositiveZ: frontPositiveZ, imageUrl: await getDownloadURL(r) })
    } catch (e) {
      console.error(e); setError('Couldn’t make the picture')
    } finally { setStatus(null) }
  }

  // Render both sides whenever the model changes; with uploaded art, pick the matching side
  useEffect(() => {
    if (!badge.model) return
    let live = true
    setSides(null); setStatus('Checking both sides…'); setError('')
    ;(async () => {
      try {
        const { renderPinSides, guessFront } = await import('@/components/badges/pinSnapshot')
        const blobs = await renderPinSides(badgeAsset(badge.model)!, badge.pinBack)
        if (!live) return
        setSides(blobs.map((b) => URL.createObjectURL(b)))
        const key = `${badge.model}|${art}`
        if (art && guessed.current !== key) {
          guessed.current = key
          setStatus('Matching to the art…')
          const pick = await guessFront(blobs, badgeAsset(art)!)
          if (!live) return
          await makePicture(pick === 1)
        } else setStatus(null)
      } catch (e) {
        console.error(e); if (live) { setError('Couldn’t render the model'); setStatus(null) }
      }
    })()
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [badge.model, badge.pinBack, art])

  return (
    <div>
      <span className="field-label">Front of the pin</span>
      <div className="grid grid-cols-2 gap-2">
        {[0, 1].map((i) => (
          <button key={i} type="button" disabled={!sides || status !== null}
            onClick={() => makePicture(i === 1)}
            className={cn('relative aspect-square rounded-xl border-2 bg-[#1b1611] overflow-hidden transition-colors disabled:cursor-default',
              front === i ? 'border-emerald-600' : 'border-transparent hover:border-slate-500')}>
            {/* eslint-disable-next-line @next/next/no-img-element -- a local blob render */}
            {sides ? <img src={sides[i]} alt={`Side ${i === 0 ? 'A' : 'B'}`} className="w-full h-full object-contain p-1.5" />
              : <Loader2 size={16} className="animate-spin text-slate-500 absolute inset-0 m-auto" />}
            {front === i && <span className="absolute top-1 right-1 w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center"><Check size={12} /></span>}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-slate-500 mt-1.5 leading-snug">
        {status ?? 'Pick the side that matches your art (not mirrored). The book picture is made from it.'}
      </p>
      <button type="button" onClick={() => makePicture(front === 1)} disabled={status !== null}
        className="mt-1.5 w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-700 text-[11px] font-semibold text-slate-400 hover:text-ink hover:border-slate-600 disabled:opacity-60">
        <ImageIcon size={12} />Remake book picture
      </button>
      {error && <div className="text-[11px] text-red-600 mt-1">{error}</div>}
    </div>
  )
}

// Upload a badge file to Storage (badges/{id}/{kind}-{time}.{ext}) and hand back its URL.
function FileField({ label, accept, badgeId, kind, value, onChange, icon }: {
  label: string; accept: string; badgeId: string; kind: string; value?: string; onChange: (url: string | undefined) => void; icon?: React.ReactNode
}) {
  const input = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<string | null>(null) // what it's doing, while busy
  const [error, setError] = useState('')
  const busy = status !== null
  async function upload(picked: File) {
    setError('')
    let file: Blob = picked
    const ext = (picked.name.split('.').pop() || 'bin').toLowerCase()
    try {
      // A 3D model is compressed here first (same mesh — lib/pinOptimize.ts): raw Meshy files are
      // 30MB+, over the 25MB limit and slow for every collector who opens the pin
      if (ext === 'glb') {
        setStatus('Compressing…')
        const { compressPinModel } = await import('@/lib/pinOptimize')
        const labels = { reading: 'Reading model…', mesh: 'Compressing mesh…', textures: 'Compressing textures…', packing: 'Packing…' }
        file = await compressPinModel(picked, (step) => setStatus(labels[step]))
      }
    } catch (e) {
      console.error(e); setError('Couldn’t compress that model — is it a valid .glb?'); setStatus(null)
      return
    }
    // Storage rules cap badge files at 25MB (storage.rules) — say so instead of a vague failure
    if (file.size > 25 * 1024 * 1024) {
      setError(`Too big: ${(file.size / 1048576).toFixed(1)}MB${file !== picked ? ' after compressing' : ''} (max 25MB)`)
      setStatus(null)
      return
    }
    setStatus('Uploading…')
    try {
      const r = ref(staffStorage, `badges/${badgeId}/${kind}-${Date.now()}.${ext}`)
      const type = picked.type || (ext === 'glb' ? 'model/gltf-binary' : ext === 'gltf' ? 'model/gltf+json' : 'application/octet-stream')
      await uploadBytes(r, file, { contentType: type })
      onChange(await getDownloadURL(r))
    } catch (e) {
      console.error(e); setError('Upload failed')
    } finally { setStatus(null) }
  }
  return (
    <div>
      <span className="field-label">{label}</span>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => input.current?.click()} disabled={busy}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-dashed border-slate-700 text-xs font-semibold text-slate-400 hover:text-ink hover:border-slate-600 disabled:opacity-60">
          {busy ? <Loader2 size={13} className="animate-spin" /> : value ? <Check size={13} className="text-emerald-600" /> : (icon ?? <Upload size={13} />)}
          {status ?? (value ? 'Replace' : 'Upload')}
        </button>
        {value && <button type="button" onClick={() => onChange(undefined)} title="Remove" className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:text-red-600 hover:bg-slate-800"><X size={14} /></button>}
      </div>
      {error && <div className="text-[11px] text-red-600 mt-1">{error}</div>}
      <input ref={input} type="file" accept={accept} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }} />
    </div>
  )
}

// ── Requirements: slots, each filled by owning any of its cards ────────────────────────────

function SlotsEditor({ game, slots, onChange }: { game: Game; slots: BadgeSlot[]; onChange: (s: BadgeSlot[]) => void }) {
  const update = (i: number, p: Partial<BadgeSlot>) => onChange(slots.map((s, j) => (j === i ? { ...s, ...p } : s)))
  // The Cardex picker: 'new' = each picked card becomes a slot; a number = add the picked cards
  // to that slot (more cards that fill it)
  const [picking, setPicking] = useState<'new' | number | null>(null)
  function addPicked(add: BadgeSlot[]) {
    if (picking === 'new' || picking === null) return onChange([...slots, ...add])
    const s = slots[picking]
    const cards = [...(s.cards ?? [])]
    const ids = [...s.cardIds]
    for (const c of add.flatMap((x) => x.cards ?? [])) if (!ids.includes(c.id)) { ids.push(c.id); cards.push(c) }
    update(picking, { cardIds: ids, cards, label: s.label || add[0]?.label || '' })
  }
  return (
    <div>
      <div className="flex items-center mb-1.5">
        <span className="field-label !mb-0">Requirements · {slots.length} {slots.length === 1 ? 'slot' : 'slots'}</span>
      </div>
      <button onClick={() => setPicking('new')} className="btn-primary !px-3 !py-1.5 !text-xs mb-2"><Plus size={13} />Pick from the Cardex</button>
      {picking !== null && (
        <CardexCardPicker
          game={game}
          title={picking === 'new' ? undefined : `Add cards to “${slots[picking]?.label || `slot ${picking + 1}`}”`}
          addLabel={picking === 'new' ? undefined : (n) => `Add ${n || ''} to this slot`}
          onAdd={addPicked}
          onClose={() => setPicking(null)}
        />
      )}
      <div className="flex flex-col gap-2">
        {slots.map((s, i) => (
          <div key={i} className="rounded-xl border border-slate-800 bg-slate-950/60 p-2.5">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[11px] font-bold text-slate-500 w-5">{i + 1}.</span>
              <input className="input-field !py-1 !text-sm" value={s.label} onChange={(e) => update(i, { label: e.target.value })} placeholder="Slot name, e.g. Lee Sin" />
              <button onClick={() => onChange(slots.filter((_, j) => j !== i))} title="Remove slot" className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg text-slate-500 hover:text-red-600 hover:bg-slate-800"><Trash2 size={14} /></button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 mb-2">
              {s.cardIds.map((id, k) => {
                const info = s.cards?.find((c) => c.id === id)
                return (
                  <span key={id} className="contents">
                  {k > 0 && <span className="text-[10px] font-bold uppercase text-slate-500">or</span>}
                  <span className="flex items-center gap-1.5 pl-1 pr-1.5 py-1 rounded-lg bg-slate-800 text-xs text-ink">
                    {info?.imageUrl
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={info.imageUrl} alt="" className="w-5 h-7 object-cover rounded-sm" />
                      : <span className="w-5 h-7 rounded-sm bg-slate-700" />}
                    <span className="max-w-[160px] truncate">{info ? `${info.name}${info.number ? ` #${info.number}` : ''}` : id}</span>
                    <button onClick={() => update(i, { cardIds: s.cardIds.filter((x) => x !== id), cards: s.cards?.filter((c) => c.id !== id) })} className="text-slate-500 hover:text-red-600"><X size={12} /></button>
                  </span>
                  </span>
                )
              })}
              {!s.cardIds.length && <span className="text-[11px] text-amber-700">No cards yet — search below.</span>}
              <button onClick={() => setPicking(i)} title="Pick more cards from the Cardex that also fill this slot"
                className="flex items-center gap-1 px-2 py-1 rounded-lg border border-dashed border-slate-700 text-[11px] font-semibold text-slate-400 hover:text-ink">
                <Plus size={11} />Add cards
              </button>
            </div>
            <CardSearch game={game} exclude={s.cardIds} placeholder="Or search for a card to add to this slot" onPick={(c) => update(i, { cardIds: [...s.cardIds, c.id], cards: [...(s.cards ?? []), c] })} />
          </div>
        ))}
      </div>
      <button onClick={() => onChange([...slots, { label: '', cardIds: [], cards: [] }])} className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-dashed border-slate-700 text-xs font-semibold text-slate-400 hover:text-ink">
        <Plus size={13} />Add slot
      </button>
    </div>
  )
}

function CardSearch({ game, exclude, onPick, placeholder }: { game: Game; exclude: string[]; onPick: (c: SlotCard) => void; placeholder?: string }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<SlotCard[]>([])
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return }
    let live = true
    setLoading(true)
    const t = setTimeout(() => {
      fetch(`/api/admin/catalog/search?game=${game}&q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((rows: SlotCard[]) => { if (live) setResults(Array.isArray(rows) ? rows.slice(0, 12) : []) })
        .catch(() => { if (live) setResults([]) })
        .finally(() => { if (live) setLoading(false) })
    }, 250)
    return () => { live = false; clearTimeout(t) }
  }, [q, game])
  return (
    <div>
      <div className="relative">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
        <input className="input-field !py-1.5 !pl-7 !text-xs" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder ?? `Add a card — search ${GAME_LABELS[game]} by name or number`} />
        {loading && <Loader2 size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-slate-500" />}
      </div>
      {results.length > 0 && (
        <div className="mt-1.5 max-h-56 overflow-y-auto rounded-lg border border-slate-800 divide-y divide-slate-800">
          {results.map((c) => {
            const added = exclude.includes(c.id)
            return (
              <button key={c.id} disabled={added} onClick={() => onPick({ id: c.id, name: c.name, setName: c.setName, number: c.number, imageUrl: c.imageUrl })}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-slate-800/60 disabled:opacity-50">
                {c.imageUrl
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={c.imageUrl} alt="" className="w-6 h-8 object-cover rounded-sm" />
                  : <span className="w-6 h-8 rounded-sm bg-slate-700" />}
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold text-ink truncate">{c.name}</span>
                  <span className="block text-[10px] text-slate-500 truncate">{c.setName} · #{c.number} · <code>{c.id}</code></span>
                </span>
                {added ? <Check size={13} className="text-emerald-600" /> : <Plus size={13} className="text-slate-500" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Book editor ─────────────────────────────────────────────────────────────────────────────

function SetEditor({ catalog, initial, onClose, onSave }: {
  catalog: BadgeCatalog
  initial: BadgeSet
  onClose: () => void
  onSave: (s: BadgeSet, originalId: string) => Promise<void>
}) {
  const isNew = !initial.id
  const [s, setS] = useState<BadgeSet>(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const id = isNew ? badgeSlug(s.name) : s.id
  const patch = (p: Partial<BadgeSet>) => setS((x) => ({ ...x, ...p }))
  const color = (k: keyof BadgeSet['cover'], v: string) => setS((x) => ({ ...x, cover: { ...x.cover, [k]: v } }))

  async function save() {
    setError('')
    if (!s.name.trim()) return setError('Give the book a name.')
    if (isNew && catalog.sets.some((x) => x.id === id)) return setError(`A book with the id "${id}" already exists.`)
    setSaving(true)
    try {
      await onSave({ ...s, id, name: s.name.trim(), monogram: (s.monogram || s.name.trim()[0] || '?').toUpperCase().slice(0, 3) }, initial.id)
    } catch { setError('Couldn’t save.') } finally { setSaving(false) }
  }

  return (
    <Modal
      title={isNew ? 'New pin book' : `Edit · ${initial.name}`}
      onClose={onClose}
      footer={<>
        {error && <span className="text-xs text-red-600 mr-2">{error}</span>}
        <button onClick={onClose} className="btn-secondary">Cancel</button>
        <button onClick={save} disabled={saving} className="btn-primary disabled:opacity-60">{saving ? <Loader2 size={15} className="animate-spin" /> : <BookOpen size={15} />}Save book</button>
      </>}
    >
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_200px]">
        <div className="flex flex-col gap-4">
          <Field label="Name" hint={isNew ? `id: ${id || '—'}` : `id: ${s.id}`}>
            <input className="input-field" value={s.name} onChange={(e) => patch({ name: e.target.value })} placeholder="Riftbound" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Small line above the name"><input className="input-field" value={s.subtitle} onChange={(e) => patch({ subtitle: e.target.value })} /></Field>
            <Field label="Monogram" hint="Shown on the cover until it has badges."><input className="input-field" maxLength={3} value={s.monogram} onChange={(e) => patch({ monogram: e.target.value })} placeholder="R" /></Field>
          </div>
          <Field label="Game" hint="Card searches for this book's badges use this game.">
            <select className="input-field" value={s.game} onChange={(e) => patch({ game: e.target.value as Game })}>
              {GAMES.map((g) => <option key={g} value={g}>{GAME_LABELS[g]}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-3 gap-3">
            {(['from', 'to', 'accent'] as const).map((k) => (
              <Field key={k} label={k === 'from' ? 'Leather (light)' : k === 'to' ? 'Leather (dark)' : 'Gold accent'}>
                <input type="color" className="w-full h-10 rounded-lg border border-slate-800 bg-transparent cursor-pointer" value={s.cover[k]} onChange={(e) => color(k, e.target.value)} />
              </Field>
            ))}
          </div>
        </div>
        <div className="relative w-[200px] aspect-[0.71] mx-auto"><BookCover set={{ ...s, id: id || 'preview', name: s.name || 'Book name' }} badges={null} /></div>
      </div>
    </Modal>
  )
}
