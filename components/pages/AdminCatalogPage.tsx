'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, Search, Plus, Eye, EyeOff, Pencil, Wand2, Upload, AlertCircle, CheckCircle2, LocateFixed } from 'lucide-react'
import {
  doc, setDoc, updateDoc, getDoc, serverTimestamp,
} from 'firebase/firestore'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { useAuth } from '@/components/auth/AuthProvider'
import { useStore } from '@/lib/store'
import { editCard as editCardInFirestore } from '@/lib/firebase/db'
import { db, storage, ADMIN_UID } from '@/lib/firebase/config'
import { regenerateSnapshot } from '@/lib/api/catalog'
import { cn } from '@/lib/utils'
import { GAME_COLORS, type Game, type CatalogSyncNotice } from '@/lib/types'

interface SetOption {
  code: string
  name: string
  releaseDate: string
  cardCount?: number
}

interface CatalogCard {
  id: string
  name: string
  number: string
  set?: string
  setCode?: string
  setName: string
  rarity?: string
  publicCode?: string
  imageUrl: string
  marketPrice?: number
  marketPriceFoil?: number
  isCustom?: boolean
  isHidden?: boolean
}

interface LookupCandidate {
  name?: string
  imageUrl?: string
  marketPrice?: number
  marketPriceFoil?: number
  rarity?: string
  source: string
  note?: string
}

const GAMES: Game[] = ['pokemon', 'lorcana', 'riftbound']

export default function AdminCatalogPage() {
  return (
    <AuthGuard>
      <div className="pb-20 md:pb-0">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white">Admin Catalog</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            Browse the full card catalog in display order. This is the shared catalog everyone's
            copy of the app reads from — edits here apply immediately for everyone.
          </p>
        </div>
        <CatalogBrowser />
      </div>
    </AuthGuard>
  )
}

function CatalogBrowser() {
  const { user } = useAuth()
  const isAdmin = !!user && !!ADMIN_UID && user.uid === ADMIN_UID
  const { cards: inventoryCards, updateCard: updateInventoryCard, addCatalogSyncNotice } = useStore()
  const [activeGame, setActiveGame] = useState<Game>('riftbound')
  const [sets, setSets] = useState<SetOption[]>([])
  const [activeSet, setActiveSet] = useState<SetOption | null>(null)
  const [cards, setCards] = useState<CatalogCard[]>([])
  const [loadingSets, setLoadingSets] = useState(false)
  const [loadingCards, setLoadingCards] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingCard, setEditingCard] = useState<CatalogCard | null>(null)
  const [jumpName, setJumpName] = useState('')
  const [jumpNumber, setJumpNumber] = useState('')
  const [jumpNameMissed, setJumpNameMissed] = useState(false)
  const [jumpNumberMissed, setJumpNumberMissed] = useState(false)
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>())
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let stale = false
    setLoadingSets(true)
    fetch(`/api/sets?game=${activeGame}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: SetOption[]) => {
        if (stale) return
        setSets(data)
        setActiveSet(data[0] ?? null)
      })
      .catch(() => {})
      .finally(() => { if (!stale) setLoadingSets(false) })
    return () => { stale = true }
  }, [activeGame])

  function loadCards() {
    if (!activeSet) return
    setLoadingCards(true)
    fetch(`/api/admin/catalog?game=${activeGame}&set=${encodeURIComponent(activeSet.name)}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: CatalogCard[]) => setCards(data))
      .catch(() => {})
      .finally(() => setLoadingCards(false))
  }

  useEffect(() => {
    loadCards()
    setJumpName(''); setJumpNumber(''); setJumpNameMissed(false); setJumpNumberMissed(false)
  }, [activeGame, activeSet])

  async function toggleHideCard(id: string) {
    setActionError(null)
    setActionSuccess(null)
    const current = cards.find((c) => c.id === id)
    try {
      await updateDoc(doc(db, 'catalog', activeGame, 'cards', id), { hidden: !current?.isHidden })
      await regenerateSnapshot(activeGame)
      loadCards()
    } catch (err) {
      setActionError(`Hide/unhide failed: ${(err as Error).message}`)
    }
  }

  // Saves an edit to a catalog card, then cascades the identity/display fields that changed
  // (number, name, image — never price) to any inventory entries that reference this card's
  // id via apiId. The Admin Catalog is the source of truth: this auto-applies, no confirm
  // gate, followed by an immediate success note here and a banner on Inventory's next visit.
  async function saveCardEdit(id: string, patch: Record<string, unknown>) {
    setActionError(null)
    setActionSuccess(null)
    const original = editingCard
    try {
      await updateDoc(doc(db, 'catalog', activeGame, 'cards', id), { ...patch, updatedAt: serverTimestamp() })
      await regenerateSnapshot(activeGame)
    } catch (err) {
      setActionError(`Edit failed: ${(err as Error).message}`)
      return
    }
    setEditingCard(null)
    loadCards()

    const matches = inventoryCards.filter((c) => c.apiId === id)
    const cascadeFields = ['number', 'name', 'imageUrl'] as const
    const cascadePatch: Record<string, unknown> = {}
    const changedFields: CatalogSyncNotice['changedFields'] = []
    for (const field of cascadeFields) {
      if (!(field in patch)) continue
      const from = original ? String((original as unknown as Record<string, unknown>)[field] ?? '') : ''
      const to = String(patch[field] ?? '')
      if (from === to) continue
      cascadePatch[field] = patch[field]
      changedFields.push({ field, from, to })
    }

    if (matches.length > 0 && Object.keys(cascadePatch).length > 0 && user) {
      for (const m of matches) {
        await editCardInFirestore(user.uid, m.id, cascadePatch).catch(() => {})
        updateInventoryCard(m.id, cascadePatch)
      }
      addCatalogSyncNotice({
        id: `${id}-${Date.now()}`,
        cardName: original?.name ?? String(patch.name ?? id),
        apiId: id,
        matchedCount: matches.length,
        changedFields,
      })
      setActionSuccess(`Catalog updated. ${matches.length} inventory ${matches.length === 1 ? 'entry' : 'entries'} updated to match.`)
    } else {
      setActionSuccess('Catalog updated.')
    }
  }

  function jumpToRow(id: string | undefined) {
    if (!id) return false
    const row = rowRefs.current.get(id)
    if (!row) return false
    row.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setHighlightedId(id)
    if (highlightTimer.current) clearTimeout(highlightTimer.current)
    highlightTimer.current = setTimeout(() => setHighlightedId(null), 1800)
    return true
  }

  function handleJumpName(query: string) {
    setJumpName(query)
    if (!query.trim()) { setJumpNameMissed(false); return }
    const q = query.toLowerCase()
    const match = cards.find((c) => c.name.toLowerCase().includes(q))
    setJumpNameMissed(!jumpToRow(match?.id))
  }

  function handleJumpNumber(query: string) {
    setJumpNumber(query)
    if (!query.trim()) { setJumpNumberMissed(false); return }
    const q = query.toLowerCase()
    const match =
      cards.find((c) => c.number.toLowerCase() === q) ??
      cards.find((c) => c.number.toLowerCase().startsWith(q))
    setJumpNumberMissed(!jumpToRow(match?.id))
  }

  const gameColor = GAME_COLORS[activeGame]

  return (
    <div>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="relative">
          <LocateFixed size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={jumpName}
            onChange={(e) => handleJumpName(e.target.value)}
            placeholder="Jump to name…"
            className={cn(
              'bg-slate-900 border rounded-lg pl-8 pr-3 py-2 text-sm text-white w-48',
              jumpNameMissed ? 'border-red-800' : 'border-slate-800',
            )}
          />
        </div>
        <div className="relative">
          <LocateFixed size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={jumpNumber}
            onChange={(e) => handleJumpNumber(e.target.value)}
            placeholder="Jump to number…"
            className={cn(
              'bg-slate-900 border rounded-lg pl-8 pr-3 py-2 text-sm text-white w-40',
              jumpNumberMissed ? 'border-red-800' : 'border-slate-800',
            )}
          />
        </div>
        {(jumpNameMissed || jumpNumberMissed) && <span className="text-xs text-red-400">No match</span>}
      </div>

      <div className="flex gap-2 mb-4">
        {GAMES.map((g) => (
          <button
            key={g}
            onClick={() => setActiveGame(g)}
            className={cn(
              'px-4 py-2 rounded-xl text-sm font-medium transition-all capitalize',
              activeGame === g ? 'text-white' : 'bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800',
            )}
            style={activeGame === g ? { backgroundColor: GAME_COLORS[g] + '33', color: GAME_COLORS[g], border: `1px solid ${GAME_COLORS[g]}55` } : {}}
          >
            {g}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {loadingSets ? (
          <span className="text-slate-500 text-sm flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading sets…</span>
        ) : (
          <select
            value={activeSet?.code ?? ''}
            onChange={(e) => setActiveSet(sets.find((s) => s.code === e.target.value) ?? null)}
            className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white"
          >
            {sets.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
          </select>
        )}
        {isAdmin && (
          <button
            onClick={() => setShowAddForm((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-violet-600 text-white hover:bg-violet-500"
          >
            <Plus size={14} /> Add Missing Card
          </button>
        )}
      </div>

      {actionError && (
        <div className="flex items-start gap-2 text-red-400 text-xs bg-red-950/30 border border-red-900/50 rounded-lg px-3 py-2 mb-4">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>{actionError}</span>
        </div>
      )}

      {actionSuccess && (
        <div className="flex items-start gap-2 text-emerald-400 text-xs bg-emerald-950/30 border border-emerald-900/50 rounded-lg px-3 py-2 mb-4">
          <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
          <span>{actionSuccess}</span>
        </div>
      )}

      {isAdmin && showAddForm && activeSet && (
        <AddCardForm
          game={activeGame}
          activeSet={activeSet}
          onSaved={() => { setShowAddForm(false); loadCards() }}
          onError={setActionError}
        />
      )}

      {isAdmin && editingCard && (
        <EditCardForm
          game={activeGame}
          card={editingCard}
          onSave={(patch) => saveCardEdit(editingCard.id, patch)}
          onCancel={() => setEditingCard(null)}
        />
      )}

      {loadingCards ? (
        <div className="flex items-center justify-center py-16 gap-3 text-slate-500">
          <Loader2 size={20} className="animate-spin" style={{ color: gameColor }} />
          <span className="text-sm">Loading cards…</span>
        </div>
      ) : (
        <CardTable
          game={activeGame}
          cards={cards}
          isAdmin={isAdmin}
          onToggleHide={toggleHideCard}
          onEdit={setEditingCard}
          rowRefs={rowRefs.current}
          highlightedId={highlightedId}
        />
      )}
    </div>
  )
}

function CardTable({
  game, cards, isAdmin, onToggleHide, onEdit, rowRefs, highlightedId,
}: {
  game: Game
  cards: CatalogCard[]
  isAdmin: boolean
  onToggleHide: (id: string) => void
  onEdit: (card: CatalogCard) => void
  rowRefs: Map<string, HTMLTableRowElement>
  highlightedId: string | null
}) {
  if (cards.length === 0) {
    return <div className="card-glass py-12 text-center text-slate-500 text-sm">No cards found for this set.</div>
  }

  return (
    <div className="card-glass overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-slate-500 text-xs uppercase tracking-wide border-b border-slate-800">
            <th className="px-3 py-2 font-medium">#</th>
            <th className="px-3 py-2 font-medium">Image</th>
            <th className="px-3 py-2 font-medium">Name</th>
            <th className="px-3 py-2 font-medium">Rarity</th>
            <th className="px-3 py-2 font-medium">Price</th>
            <th className="px-3 py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {cards.map((c, i) => {
            const numberChanged = i === 0 || cards[i - 1].number !== c.number
            return (
              <tr
                key={c.id}
                ref={(el) => { if (el) rowRefs.set(c.id, el); else rowRefs.delete(c.id) }}
                className={cn(
                  'border-b border-slate-900 transition-colors duration-500',
                  numberChanged && i > 0 && 'border-t border-slate-700',
                  highlightedId === c.id && 'bg-violet-500/20',
                  c.isHidden && 'opacity-40',
                )}
              >
                <td className="px-3 py-2 text-slate-400 font-mono text-xs">
                  {c.number}
                  {/* Raw publicCode surfaces the "a" (alt-art)/"*" (signature) markers the bare
                      number field never carries — curators need to see these to tell visually
                      similar variants apart, unlike the simplified end-user display elsewhere. */}
                  {game === 'riftbound' && c.publicCode && (
                    <div className="text-[10px] text-slate-600 font-mono">{c.publicCode}</div>
                  )}
                </td>
                <td className="px-3 py-2">
                  {c.imageUrl ? <img src={c.imageUrl} alt="" className="w-8 h-11 object-cover rounded" /> : <div className="w-8 h-11 bg-slate-800 rounded" />}
                </td>
                <td className="px-3 py-2 text-white">
                  {c.name}
                  {c.isCustom && <span className="ml-2 text-[10px] font-bold uppercase text-violet-400 border border-violet-800 rounded px-1 py-0.5">custom</span>}
                  {c.isHidden && <span className="ml-2 text-[10px] font-bold uppercase text-slate-500 border border-slate-700 rounded px-1 py-0.5">hidden</span>}
                </td>
                <td className="px-3 py-2 text-slate-400">{c.rarity ?? '—'}</td>
                <td className="px-3 py-2 text-slate-300">
                  {c.marketPrice ? `$${c.marketPrice.toFixed(2)}` : '—'}
                  {c.marketPriceFoil ? <span className="text-slate-500"> / ${c.marketPriceFoil.toFixed(2)} foil</span> : null}
                </td>
                <td className="px-3 py-2 text-right">
                  {isAdmin ? (
                    <div className="flex items-center gap-2 justify-end">
                      <button
                        onClick={() => onEdit(c)}
                        className="flex items-center gap-1 text-xs text-slate-500 hover:text-white"
                        title="Edit this card — changes apply immediately and cascade to matching inventory"
                      >
                        <Pencil size={12} /> Edit
                      </button>
                      <button
                        onClick={() => onToggleHide(c.id)}
                        className={cn(
                          'flex items-center gap-1 text-xs',
                          c.isHidden ? 'text-slate-500 hover:text-emerald-400' : 'text-slate-500 hover:text-red-400',
                        )}
                        title={c.isHidden ? 'Unhide — restore to search/Cardex/Pack Analysis' : 'Hide from catalog — reversible, never deletes data'}
                      >
                        {c.isHidden ? <><Eye size={12} /> Unhide</> : <><EyeOff size={12} /> Hide</>}
                      </button>
                    </div>
                  ) : null}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// Shared by AddCardForm/EditCardForm — lets a card's image be either a pasted URL (e.g. from
// the lookup button or a manual TCGPlayer search) or a photo uploaded straight from disk.
// `uploadId` only needs to be unique per in-progress upload, not the card's final catalog id.
const UPLOAD_ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
}
const UPLOAD_MAX_BYTES = 8 * 1024 * 1024 // 8MB

function ImageUploadField({
  game, uploadId, imageUrl, onChange,
}: { game: Game; uploadId: string; imageUrl: string; onChange: (url: string) => void }) {
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    setUploadError(null)
    const ext = UPLOAD_ALLOWED_TYPES[file.type]
    if (!ext) { setUploadError('Only JPEG, PNG, WebP, or AVIF images are accepted'); return }
    if (file.size > UPLOAD_MAX_BYTES) {
      setUploadError(`Image is too large (${(file.size / 1024 / 1024).toFixed(1)}MB) — max 8MB`)
      return
    }
    setUploading(true)
    try {
      const safeId = uploadId.replace(/[^a-zA-Z0-9_-]/g, '-')
      const storageRef = ref(storage, `catalog/${game}/${safeId}.${ext}`)
      await uploadBytes(storageRef, file, { contentType: file.type })
      const url = await getDownloadURL(storageRef)
      onChange(url)
    } catch (err) {
      setUploadError(`Upload failed: ${(err as Error).message}`)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="col-span-2 sm:col-span-4 space-y-1.5">
      <div className="flex gap-2 items-center">
        <input
          placeholder="Image URL (or upload a photo instead →)"
          value={imageUrl}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-slate-200"
        />
        {imageUrl && (
          <img src={imageUrl} alt="" className="w-8 h-11 object-cover rounded shrink-0 bg-slate-800" />
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-50 shrink-0"
        >
          {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
          Upload photo
        </button>
      </div>
      {uploadError && <div className="text-[11px] text-red-400">{uploadError}</div>}
    </div>
  )
}

// Mirrors the id scheme the old server-side add route used, so manually-added cards keep the
// same recognizable shape ("custom-riftbound-ven-227-showcase") as before this migration.
function synthesizeId(game: Game, card: Record<string, unknown>, variant?: string): string {
  const setCode = game === 'riftbound' ? card.setCode : card.set
  const slug = (variant || '1').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '') || '1'
  return `custom-${game}-${String(setCode ?? 'unknown').toLowerCase()}-${card.number}-${slug}`
}

function AddCardForm({
  game, activeSet, onSaved, onError,
}: { game: Game; activeSet: SetOption; onSaved: () => void; onError: (msg: string | null) => void }) {
  // Only needs to be unique for the lifetime of this in-progress upload — the card's real
  // catalog id gets synthesized server-side on Save, independent of this filename.
  const [uploadId] = useState(() => `new-${Math.random().toString(36).slice(2)}`)
  const [number, setNumber] = useState('')
  const [name, setName] = useState('')
  const [rarity, setRarity] = useState('')
  const [variant, setVariant] = useState('')
  const [apiId, setApiId] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [marketPrice, setMarketPrice] = useState('')
  const [marketPriceFoil, setMarketPriceFoil] = useState('')
  const [candidates, setCandidates] = useState<LookupCandidate[]>([])
  const [looking, setLooking] = useState(false)
  const [saving, setSaving] = useState(false)

  async function runLookup() {
    setLooking(true)
    onError(null)
    try {
      const res = await fetch('/api/admin/catalog/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ game, setCode: activeSet.code, number, name: name || undefined, apiId: apiId || undefined }),
      })
      const data = await res.json()
      setCandidates(data.candidates ?? [])
    } catch {
      onError('Lookup request failed.')
    } finally {
      setLooking(false)
    }
  }

  function applyCandidate(c: LookupCandidate) {
    if (c.name) setName(c.name)
    if (c.imageUrl) setImageUrl(c.imageUrl)
    if (c.marketPrice != null) setMarketPrice(String(c.marketPrice))
    if (c.marketPriceFoil != null) setMarketPriceFoil(String(c.marketPriceFoil))
    if (c.rarity) setRarity(c.rarity)
  }

  async function save() {
    if (!number || !name) { onError('Number and name are required.'); return }
    setSaving(true)
    onError(null)
    const card: Record<string, unknown> = {
      name,
      number,
      setName: activeSet.name,
      rarity: rarity || undefined,
      imageUrl: imageUrl || '',
      marketPrice: parseFloat(marketPrice) || 0,
      marketPriceFoil: parseFloat(marketPriceFoil) || 0,
      ...(game === 'riftbound' ? { setCode: activeSet.code } : { set: activeSet.code }),
      // Reuse the real official id when we have one (e.g. Pokemon's apiId) so the card
      // behaves identically to a normally-scraped one; otherwise the add route synthesizes one.
      ...(game === 'pokemon' && apiId ? { id: apiId } : {}),
    }
    try {
      // Reuse a real external id when we have one (e.g. a genuine Pokemon apiId) so the card
      // behaves identically to a normally-scraped one; otherwise synthesize a placeholder.
      const id = typeof card.id === 'string' && card.id ? card.id : synthesizeId(game, card, variant)
      const cardRef = doc(db, 'catalog', game, 'cards', id)
      const existing = await getDoc(cardRef)
      if (existing.exists()) { onError(`A custom card with id "${id}" already exists`); return }

      await setDoc(cardRef, { ...card, id, hidden: false, source: 'manual', updatedAt: serverTimestamp() })
      await regenerateSnapshot(game)
      onSaved()
    } catch (err) {
      onError(`Save failed: ${(err as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card-glass p-4 mb-4 space-y-3">
      <div className="text-sm font-semibold text-white">Add a card missing from {activeSet.name}</div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <input placeholder="Number (e.g. 21b)" value={number} onChange={(e) => setNumber(e.target.value)}
          className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-slate-200" />
        <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)}
          className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-slate-200 col-span-2" />
        <input placeholder="Rarity" value={rarity} onChange={(e) => setRarity(e.target.value)}
          className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-slate-200" />
        <input placeholder="Variant (e.g. showcase)" value={variant} onChange={(e) => setVariant(e.target.value)}
          className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-slate-200" />
        {game === 'pokemon' && (
          <input placeholder="Official apiId (e.g. sv7-1)" value={apiId} onChange={(e) => setApiId(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-slate-200 col-span-2" />
        )}
        <ImageUploadField game={game} uploadId={uploadId} imageUrl={imageUrl} onChange={setImageUrl} />
        <input placeholder="Price" value={marketPrice} onChange={(e) => setMarketPrice(e.target.value)}
          className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-slate-200" />
        <input placeholder="Foil price" value={marketPriceFoil} onChange={(e) => setMarketPriceFoil(e.target.value)}
          className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-slate-200" />
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={runLookup}
          disabled={looking || !number}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-cyan-600/20 text-cyan-300 hover:bg-cyan-600/30 disabled:opacity-50"
        >
          {looking ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
          Auto-fetch price &amp; image
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-50"
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
          Save to catalog
        </button>
      </div>

      {candidates.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs text-slate-500">Found — click one to prefill:</div>
          {candidates.map((c, i) => (
            <button
              key={i}
              onClick={() => applyCandidate(c)}
              disabled={!!c.note}
              className={cn(
                'w-full text-left text-xs px-2.5 py-1.5 rounded border',
                c.note ? 'border-slate-800 text-slate-500 cursor-default' : 'border-slate-700 text-slate-300 hover:bg-slate-800',
              )}
            >
              {c.note ?? `${c.name} — $${c.marketPrice ?? 0}${c.marketPriceFoil ? ` / $${c.marketPriceFoil} foil` : ''} (${c.source})`}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function EditCardForm({
  game, card, onSave, onCancel,
}: { game: Game; card: CatalogCard; onSave: (patch: Record<string, unknown>) => void; onCancel: () => void }) {
  const [number, setNumber] = useState(card.number)
  const [name, setName] = useState(card.name)
  const [rarity, setRarity] = useState(card.rarity ?? '')
  const [imageUrl, setImageUrl] = useState(card.imageUrl ?? '')
  const [marketPrice, setMarketPrice] = useState(card.marketPrice ? String(card.marketPrice) : '')
  const [marketPriceFoil, setMarketPriceFoil] = useState(card.marketPriceFoil ? String(card.marketPriceFoil) : '')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!number || !name) return
    setSaving(true)
    const patch: Record<string, unknown> = {
      number,
      name,
      rarity: rarity || undefined,
      imageUrl: imageUrl || '',
      marketPrice: parseFloat(marketPrice) || 0,
      marketPriceFoil: parseFloat(marketPriceFoil) || 0,
    }
    try {
      onSave(patch)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card-glass p-4 mb-4 space-y-3 border-violet-800/50">
      <div className="text-sm font-semibold text-white">
        Editing "{card.name}" · {card.publicCode ?? card.number}
      </div>
      <div className="text-xs text-slate-500">
        Changes apply immediately and cascade to any inventory entries with this apiId
        (number, name, image only — never price).
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <input placeholder="Number (e.g. 21b)" value={number} onChange={(e) => setNumber(e.target.value)}
          className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-slate-200" />
        <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)}
          className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-slate-200 col-span-2" />
        <input placeholder="Rarity" value={rarity} onChange={(e) => setRarity(e.target.value)}
          className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-slate-200" />
        <ImageUploadField game={game} uploadId={card.id} imageUrl={imageUrl} onChange={setImageUrl} />
        <input placeholder="Price" value={marketPrice} onChange={(e) => setMarketPrice(e.target.value)}
          className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-slate-200" />
        <input placeholder="Foil price" value={marketPriceFoil} onChange={(e) => setMarketPriceFoil(e.target.value)}
          className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-slate-200" />
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-50"
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Pencil size={12} />}
          Save Changes
        </button>
        <button
          onClick={onCancel}
          className="text-xs font-medium px-3 py-1.5 rounded-lg text-slate-400 hover:text-white"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
