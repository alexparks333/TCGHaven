'use client'

import { useState, useEffect, useMemo, useRef, useCallback, forwardRef } from 'react'
import {
  DndContext, MouseSensor, TouchSensor, useSensor, useSensors, closestCenter,
  type DragEndEvent, type DragStartEvent, type CollisionDetection,
} from '@dnd-kit/core'
import {
  SortableContext, rectSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Loader2, Plus, Trash2, X, FolderHeart, Search } from 'lucide-react'
import { useAuth } from '@/components/auth/AuthProvider'
import { useStore } from '@/lib/store'
import {
  loadCollections, newCollectionRef, createCollection, deleteCollection, setCollectionCards,
  type PersonalCollection, type PersonalCollectionCard,
} from '@/lib/firebase/collections'
import type { CardSearchResult } from '@/lib/api/search'
import { GAME_COLORS, GAME_LABELS, type Card, type Game } from '@/lib/types'
import { cn, openEbaySearch, zoomGlowColor } from '@/lib/utils'
// Type-only import — erased at compile time, so this carries none of the runtime circular-import
// risk a value import would (CardexPage.tsx imports THIS file to render the Personalized
// Collections tab). See ZoomCardData's own comment in CardexPage.tsx for why the type lives there
// and zoomGlowColor() lives in lib/utils.ts instead.
import type { ZoomCardData } from './CardexPage'
import { LogoLoader } from '@/components/LogoLoader'
import { useScrollLock } from '@/lib/useScrollLock'

const RARITY_COLORS: Record<string, string> = {
  Common: '#7a6a55', Uncommon: '#5f7a32', Rare: '#5d6a55',
  Super_rare: '#7a4a5a', Legendary: '#b0602a', Enchanted: '#9a5a5a',
  Epic: '#5f7360', 'Alt Art': '#a8701e', Overnumbered: '#a8701e', Showcase: '#a8701e', Star: '#a8701e', Promo: '#7a8030',
}

function isOwned(card: PersonalCollectionCard, ownedCards: Card[]): { owned: boolean; quantity: number } {
  const matches = ownedCards.filter((c) => c.apiId === card.id)
  return { owned: matches.length > 0, quantity: matches.reduce((s, c) => s + c.quantity, 0) }
}

// Composite identity for a personal-collection card / search result — plain catalog `id` isn't
// unique on its own for Riftbound, where search can return two rows sharing the same id (one
// non-foil, one foil) for a card priced both ways. Used everywhere a card needs a stable,
// collision-free key: "already added" dedup, drag-reorder, removal, and list rendering — without
// this, adding one variant made the OTHER permanently show as "already added" with no way to add
// both, and both would have collapsed onto one drag-reorder slot.
function cardKey(c: { id: string; isFoil?: boolean }): string {
  return `${c.id}::${c.isFoil ? 'foil' : 'normal'}`
}

// Plain substring match against name and collector number — same shape as CardexPage's
// matchesSearch(), filtering an already-small list rather than ranking a whole-catalog search.
// How long a finger must rest on a collection card before it can be dragged to reorder (phones).
const MOVE_MODE_HOLD_MS = 1000
// While a finger is held on a card, it grows toward this scale over the full hold time, so the
// hold is visibly "charging" — and it's already at full size when move mode kicks in, instead of
// popping out all at once. Matches the TouchSensor tolerance: moving further cancels the hold.
const HOLD_GROW_SCALE = 1.08
const HOLD_MOVE_TOLERANCE_PX = 8

function matchesSearch(query: string, name: string, number: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return name.toLowerCase().includes(q) || number.toLowerCase().includes(q.replace(/^#/, ''))
}

export function PersonalCollectionsView({
  onZoom,
}: {
  onZoom: (el: HTMLElement, data: Omit<ZoomCardData, 'originRect'>) => void
}) {
  const { user } = useAuth()
  const { cards } = useStore()
  const [collections, setCollections] = useState<PersonalCollection[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    let stale = false
    loadCollections(user.uid)
      .then((data) => {
        if (stale) return
        setCollections(data)
        setSelectedId((prev) => prev ?? data[0]?.id ?? null)
      })
      .catch(() => { if (!stale) setError('Failed to load your collections.') })
      .finally(() => { if (!stale) setLoading(false) })
    return () => { stale = true }
  }, [user])

  const selected = collections.find((c) => c.id === selectedId) ?? null

  // Group collections by game, same shape as the official-set selector elsewhere in Cardex
  const grouped = useMemo(() => {
    const byGame = new Map<Game, PersonalCollection[]>()
    for (const c of collections) {
      if (!byGame.has(c.game)) byGame.set(c.game, [])
      byGame.get(c.game)!.push(c)
    }
    return byGame
  }, [collections])

  function handleCreated(c: PersonalCollection) {
    setCollections((prev) => [...prev, c])
    setShowCreateForm(false)
    setSelectedId(c.id)
  }

  async function handleDelete(id: string) {
    if (!user) return
    setCollections((prev) => prev.filter((c) => c.id !== id))
    if (selectedId === id) setSelectedId(null)
    await deleteCollection(user.uid, id).catch(() => setError('Failed to delete — try again.'))
  }

  function handleCardsChanged(id: string, newCards: PersonalCollectionCard[]) {
    setCollections((prev) => prev.map((c) => (c.id === id ? { ...c, cards: newCards } : c)))
  }

  if (loading) {
    return (
      <LogoLoader label="Loading your collections…" />
    )
  }

  return (
    <div>
      {error && (
        <div className="mb-4 text-xs text-red-600 bg-red-100/30 border border-red-200/50 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between mb-4">
        <p className="text-slate-400 text-sm">
          Your own custom collections — pick any cards across any set and track them like a mini Cardex.
        </p>
        <button
          onClick={() => setShowCreateForm((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-violet-600 text-white hover:bg-violet-500 shrink-0"
        >
          <Plus size={14} /> New Collection
        </button>
      </div>

      {showCreateForm && (
        <CreateCollectionForm
          onCreated={handleCreated}
          onCancel={() => setShowCreateForm(false)}
          onError={setError}
        />
      )}

      {collections.length === 0 ? (
        <div className="card-glass flex flex-col items-center justify-center py-20 text-center gap-3">
          <FolderHeart size={32} className="text-slate-700" />
          <div className="text-slate-400 font-medium">No personalized collections yet</div>
          <div className="text-slate-600 text-sm max-w-xs">
            Make one for anything you want to track — a champion&apos;s cards across every set, a
            theme, an alt-art wishlist, whatever you like.
          </div>
        </div>
      ) : (
        <>
          {/* Pill selector — same visual language as the Lorcana/Riftbound set picker */}
          <div className="space-y-3 mb-6">
            {(['lorcana', 'riftbound'] as const).map((game) => {
              const list = grouped.get(game)
              if (!list || list.length === 0) return null
              const color = GAME_COLORS[game]
              return (
                <div key={game}>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-slate-600 mb-1.5 px-0.5">
                    {GAME_LABELS[game]}
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {list.map((c) => {
                      const isActive = selectedId === c.id
                      return (
                        <button
                          key={c.id}
                          onClick={() => setSelectedId(c.id)}
                          className={cn(
                            'px-3 py-1.5 rounded-lg text-xs font-medium transition-all border',
                            isActive
                              ? 'text-ink border-transparent'
                              : 'bg-slate-900/50 text-slate-400 border-slate-800 hover:text-ink hover:bg-slate-800',
                          )}
                          style={isActive ? { backgroundColor: color + '28', borderColor: color + '60', color } : {}}
                        >
                          {c.name}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>

          {selected && (
            <CollectionDetail
              key={selected.id}
              collection={selected}
              ownedCards={cards}
              onDelete={() => handleDelete(selected.id)}
              onCardsChanged={(newCards) => handleCardsChanged(selected.id, newCards)}
              showAddModal={showAddModal}
              onOpenAddModal={() => setShowAddModal(true)}
              onCloseAddModal={() => setShowAddModal(false)}
              onZoom={onZoom}
            />
          )}
        </>
      )}
    </div>
  )
}

// ── Create form ───────────────────────────────────────────────────────────────

function CreateCollectionForm({
  onCreated, onCancel, onError,
}: { onCreated: (c: PersonalCollection) => void; onCancel: () => void; onError: (msg: string | null) => void }) {
  const { user } = useAuth()
  const [game, setGame] = useState<'lorcana' | 'riftbound'>('riftbound')
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!user || !name.trim()) { onError('Give the collection a name.'); return }
    setSaving(true)
    onError(null)
    try {
      const ref = newCollectionRef(user.uid)
      await createCollection(user.uid, ref.id, game, name.trim())
      onCreated({ id: ref.id, game, name: name.trim(), cards: [], createdAt: new Date().toISOString() })
    } catch {
      onError('Failed to create collection — try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card-glass p-4 mb-6 space-y-3">
      <div className="text-sm font-semibold text-ink">New Personalized Collection</div>
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex gap-2 shrink-0">
          {(['lorcana', 'riftbound'] as const).map((g) => (
            <button
              key={g}
              onClick={() => setGame(g)}
              className={cn(
                'px-3 py-2 rounded-lg text-xs font-medium transition-all border',
                game === g ? 'text-ink border-transparent' : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-ink',
              )}
              style={game === g ? { backgroundColor: GAME_COLORS[g] + '33', color: GAME_COLORS[g], borderColor: GAME_COLORS[g] + '55' } : {}}
            >
              {GAME_LABELS[g]}
            </button>
          ))}
        </div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Collection name (e.g. Fury Runes)"
          className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-ink placeholder-slate-500 focus:outline-none focus:border-violet-600"
        />
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-50"
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
          Create
        </button>
        <button onClick={onCancel} className="text-xs font-medium px-3 py-1.5 rounded-lg text-slate-400 hover:text-ink">
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── Collection detail (grid + Add Card modal) ─────────────────────────────────

function CollectionDetail({
  collection, ownedCards, onDelete, onCardsChanged, showAddModal, onOpenAddModal, onCloseAddModal, onZoom,
}: {
  collection: PersonalCollection
  ownedCards: Card[]
  onDelete: () => void
  onCardsChanged: (cards: PersonalCollectionCard[]) => void
  showAddModal: boolean
  onOpenAddModal: () => void
  onCloseAddModal: () => void
  onZoom: (el: HTMLElement, data: Omit<ZoomCardData, 'originRect'>) => void
}) {
  const { user } = useAuth()
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const color = GAME_COLORS[collection.game]
  const cardIds = useMemo(() => new Set(collection.cards.map(cardKey)), [collection.cards])

  // Drag-to-reorder — visual order lives here so dragging feels instant; only persisted to
  // Firestore once the drag actually ends, not on every intermediate swap. Resynced whenever
  // the collection's real card list changes (add/remove), not just on mount.
  // Live prices for this collection's cards, from the same price routes (and the same shared
  // rule, lib/pricing.ts) Inventory/Portfolio prices come from — a collection card's stored
  // `marketPrice` is only a snapshot from when it was added, so it'd drift from everything else.
  // null until loaded (the stored snapshot shows briefly meanwhile).
  const { priceMode } = useStore()
  const [livePrices, setLivePrices] = useState<Record<string, number> | null>(null)
  useEffect(() => {
    let stale = false
    const payload = collection.cards.map((c) => ({ id: cardKey(c), apiId: c.id, isFoil: !!c.isFoil }))
    if (payload.length === 0) { setLivePrices({}); return }
    fetch(`/api/prices/${collection.game}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cards: payload, priceMode }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((prices: Record<string, number> | null) => { if (!stale && prices) setLivePrices(prices) })
      .catch(() => {})
    return () => { stale = true }
  }, [collection.cards, collection.game, priceMode])

  const [orderedIds, setOrderedIds] = useState<string[]>(() => collection.cards.map(cardKey))
  useEffect(() => {
    setOrderedIds(collection.cards.map(cardKey))
  }, [collection.cards])

  async function addCard(result: CardSearchResult) {
    if (!user || cardIds.has(cardKey(result))) return
    const newCard: PersonalCollectionCard = {
      id: result.id, name: result.name, number: result.number, setName: result.setName,
      imageUrl: result.imageUrl, marketPrice: result.marketPrice, isFoil: result.isFoil,
    }
    const updated = [...collection.cards, newCard]
    onCardsChanged(updated) // optimistic
    await setCollectionCards(user.uid, collection.id, updated).catch(() => setSaveError('Failed to save — try again.'))
  }

  // The last card dragged into the trash, kept briefly so the "Removed · Undo" toast can put it
  // back exactly where it was.
  const [lastRemoved, setLastRemoved] = useState<{ card: PersonalCollectionCard; index: number } | null>(null)
  useEffect(() => {
    if (!lastRemoved) return
    const t = setTimeout(() => setLastRemoved(null), 5000)
    return () => clearTimeout(t)
  }, [lastRemoved])

  async function undoRemove() {
    if (!user || !lastRemoved) return
    const updated = [...collection.cards]
    updated.splice(Math.min(lastRemoved.index, updated.length), 0, lastRemoved.card)
    setLastRemoved(null)
    onCardsChanged(updated)
    await setCollectionCards(user.uid, collection.id, updated).catch(() => setSaveError('Failed to save — try again.'))
  }

  async function removeCard(key: string) {
    if (!user) return
    const index = collection.cards.findIndex((c) => cardKey(c) === key)
    if (index !== -1) setLastRemoved({ card: collection.cards[index], index })
    const updated = collection.cards.filter((c) => cardKey(c) !== key)
    onCardsChanged(updated) // optimistic
    await setCollectionCards(user.uid, collection.id, updated).catch(() => setSaveError('Failed to save — try again.'))
  }

  async function persistOrder(newOrderKeys: string[]) {
    if (!user) return
    const cardsByKey = new Map(collection.cards.map((c) => [cardKey(c), c]))
    const reordered = newOrderKeys.map((k) => cardsByKey.get(k)).filter((c): c is PersonalCollectionCard => !!c)
    onCardsChanged(reordered)
    await setCollectionCards(user.uid, collection.id, reordered).catch(() => setSaveError('Failed to save the new order — try again.'))
  }

  // Mouse and touch get separate sensors on purpose. Mouse: a small activation distance, so a
  // plain click (the remove button, opening the zoom view) never reads as a drag. Touch: nothing
  // happens until a finger has held still on a card for 1s ("move mode") — before that,
  // swiping scrolls the page normally and a tap opens the card. A single PointerSensor used to
  // handle both, which (together with touch-action: none on every tile) turned any swipe that
  // started on a card into an accidental reorder.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: MOVE_MODE_HOLD_MS, tolerance: HOLD_MOVE_TOLERANCE_PX } }),
  )
  // Which card is currently being moved by touch (lifted look), and when the last drag ended —
  // lifting a finger after a move must not also count as a tap that opens the zoom view.
  const [touchMovingId, setTouchMovingId] = useState<string | null>(null)
  // Any drag in progress (mouse or touch) — shows the trash drop zone.
  const [dragging, setDragging] = useState(false)
  // Finger/pointer is over the trash can right now. Drives the "about to remove" look (trash
  // grows, held card shrinks, the grid closes the gap) and decides removal on release.
  const [overTrash, setOverTrash] = useState(false)
  const trashElRef = useRef<HTMLDivElement | null>(null)
  // Latest real pointer position during a drag, from our own window listeners — the trash isn't
  // a dnd-kit droppable (see collisionDetection below), so we hit-test it ourselves.
  const pointerRef = useRef<{ x: number; y: number } | null>(null)
  const orderedIdsRef = useRef(orderedIds)
  orderedIdsRef.current = orderedIds
  const lastDragEndRef = useRef(0)
  const justDragged = () => Date.now() - lastDragEndRef.current < 400

  function pointerOverTrash(p: { x: number; y: number } | null) {
    const r = trashElRef.current?.getBoundingClientRect()
    return !!(p && r && p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom)
  }

  // Over the trash, report the LAST card as the drop target. dnd-kit only keeps the held card
  // under the finger and shifts the others while "over" is a real item in the list — with the
  // trash as "over" it froze everything and snapped the held card back to its slot (the old
  // clunky feel). Targeting the last slot instead shows exactly the collection without this card:
  // every card after it slides back one place. handleDragEnd checks the trash first, so the card
  // is removed rather than moved to the end.
  const collisionDetection = useCallback<CollisionDetection>((args) => {
    if (pointerOverTrash(args.pointerCoordinates)) {
      const ids = orderedIdsRef.current
      return [{ id: ids[ids.length - 1] }]
    }
    return closestCenter(args)
  }, [])

  useEffect(() => {
    if (!dragging) return
    const onMouse = (e: MouseEvent) => { pointerRef.current = { x: e.clientX, y: e.clientY } }
    const onTouch = (e: TouchEvent) => {
      const t = e.touches[0]
      if (t) pointerRef.current = { x: t.clientX, y: t.clientY }
    }
    window.addEventListener('mousemove', onMouse, { capture: true, passive: true })
    window.addEventListener('touchmove', onTouch, { capture: true, passive: true })
    return () => {
      window.removeEventListener('mousemove', onMouse, { capture: true })
      window.removeEventListener('touchmove', onTouch, { capture: true })
    }
  }, [dragging])

  function handleDragStart(event: DragStartEvent) {
    const a = event.activatorEvent
    if (a instanceof MouseEvent) pointerRef.current = { x: a.clientX, y: a.clientY }
    else if (typeof TouchEvent !== 'undefined' && a instanceof TouchEvent && a.touches[0]) pointerRef.current = { x: a.touches[0].clientX, y: a.touches[0].clientY }
    setDragging(true)
    if (typeof TouchEvent !== 'undefined' && a instanceof TouchEvent) {
      setTouchMovingId(String(event.active.id))
      navigator.vibrate?.(25) // a little "you're in move mode" buzz where supported (Android)
    }
  }

  function handleDragMove() {
    const over = pointerOverTrash(pointerRef.current)
    if (over !== overTrash) {
      setOverTrash(over)
      if (over) navigator.vibrate?.(15)
    }
  }

  function endDrag() {
    setOverTrash(false)
    setDragging(false)
    setTouchMovingId(null)
    lastDragEndRef.current = Date.now()
  }

  function handleDragCancel() {
    endDrag()
  }

  function handleDragEnd(event: DragEndEvent) {
    const droppedOnTrash = pointerOverTrash(pointerRef.current)
    endDrag()
    const { active, over } = event
    if (droppedOnTrash) { removeCard(String(active.id)); return }
    if (!over || active.id === over.id) return
    const oldIndex = orderedIds.indexOf(String(active.id))
    const newIndex = orderedIds.indexOf(String(over.id))
    if (oldIndex === -1 || newIndex === -1) return
    const newOrder = arrayMove(orderedIds, oldIndex, newIndex)
    setOrderedIds(newOrder)
    persistOrder(newOrder)
  }

  const cardsByKey = useMemo(() => new Map(collection.cards.map((c) => [cardKey(c), c])), [collection.cards])
  const enriched = orderedIds
    .map((k) => cardsByKey.get(k))
    .filter((c): c is PersonalCollectionCard => !!c)
    // Current catalog price (once loaded), not the snapshot saved when the card was added.
    .map((c) => ({ ...c, ...isOwned(c, ownedCards), marketPrice: livePrices ? (livePrices[cardKey(c)] ?? 0) : c.marketPrice }))
  const ownedCount = enriched.filter((c) => c.owned).length
  const totalCount = enriched.length
  const pct = totalCount > 0 ? Math.round((ownedCount / totalCount) * 100) : 0

  const normalizedQuery = searchQuery.trim()
  const filteredEnriched = normalizedQuery
    ? enriched.filter((c) => matchesSearch(searchQuery, c.name, c.number))
    : enriched

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span
            className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full"
            style={{ backgroundColor: color + '22', color }}
          >
            {GAME_LABELS[collection.game]}
          </span>
          <h2 className="text-lg font-bold text-ink">{collection.name}</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onOpenAddModal}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-violet-600 text-white hover:bg-violet-500"
          >
            <Plus size={13} /> Add Card
          </button>
          {confirmingDelete ? (
            <div className="flex items-center gap-2 bg-red-100/30 border border-red-200/50 rounded-lg px-2.5 py-1.5">
              <span className="text-xs text-red-700">Delete &quot;{collection.name}&quot;? This can&apos;t be undone.</span>
              <button
                onClick={onDelete}
                className="text-xs font-semibold text-white bg-red-600 hover:bg-red-500 rounded-md px-2 py-1"
              >
                Yes, Delete
              </button>
              <button
                onClick={() => setConfirmingDelete(false)}
                className="text-xs font-medium text-slate-400 hover:text-ink px-2 py-1"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmingDelete(true)}
              className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-red-600"
            >
              <Trash2 size={13} /> Delete Collection
            </button>
          )}
        </div>
      </div>

      {saveError && <div className="text-xs text-red-600 mb-3">{saveError}</div>}

      {/* Search within this collection */}
      {totalCount > 0 && (
        <div className="relative mb-4">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={`Search ${collection.name}…`}
            className="input-field pl-9"
          />
        </div>
      )}

      {/* Phones only: reordering needs a press-and-hold now (see MOVE_MODE_HOLD_MS), so say so */}
      {totalCount > 1 && !normalizedQuery && (
        <p className="md:hidden text-[11px] text-slate-500 mb-3">Press and hold a card to move it.</p>
      )}

      {/* Progress */}
      {totalCount > 0 && (
        <div className="mb-5 card-glass px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-ink">Progress</span>
            <span className="text-sm font-bold" style={{ color }}>
              {ownedCount} / {totalCount}
              <span className="text-slate-500 font-normal text-xs ml-1">({pct}%)</span>
            </span>
          </div>
          <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: color }} />
          </div>
        </div>
      )}

      {/* Grid */}
      {totalCount === 0 ? (
        <div className="card-glass flex flex-col items-center justify-center py-16 text-center">
          <div className="text-slate-400 font-medium">No cards added yet</div>
          <div className="text-slate-600 text-sm mt-1">Click &quot;Add Card&quot; above to start building this collection.</div>
        </div>
      ) : filteredEnriched.length === 0 ? (
        <div className="card-glass flex flex-col items-center justify-center py-16 text-center">
          <div className="text-4xl mb-3">🔍</div>
          <div className="text-slate-400 font-medium">No cards match &quot;{searchQuery}&quot;</div>
        </div>
      ) : normalizedQuery ? (
        // Drag-to-reorder is ambiguous against a filtered subset, so search results render as a
        // plain (non-sortable) grid — clear the search to go back to reordering.
        <div className="grid gap-2 md:gap-3 grid-cols-[repeat(auto-fill,minmax(96px,1fr))] md:grid-cols-[repeat(auto-fill,minmax(112px,1fr))]">
          {filteredEnriched.map((card) => (
            <PersonalCardTile
              key={cardKey(card)}
              card={card}
              gameColor={color}
              game={collection.game}
              isHovered={hoveredId === cardKey(card)}
              onHover={() => setHoveredId(cardKey(card))}
              onLeave={() => setHoveredId(null)}
              onZoom={onZoom}
            />
          ))}
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetection}
          // x threshold 0: dragging near the screen's left/right edge must never scroll the page
          // sideways — only near the top/bottom edge, to reach cards further up/down. The bottom
          // zone is kept below the trash can, and auto-scroll is off entirely while over the
          // trash, so hovering it never drags the page along.
          autoScroll={{ enabled: !overTrash, threshold: { x: 0, y: 0.1 } }}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <SortableContext items={orderedIds} strategy={rectSortingStrategy}>
            <div className="grid gap-2 md:gap-3 grid-cols-[repeat(auto-fill,minmax(96px,1fr))] md:grid-cols-[repeat(auto-fill,minmax(112px,1fr))]">
              {enriched.map((card) => (
                <SortablePersonalCardTile
                  key={cardKey(card)}
                  card={card}
                  gameColor={color}
                  game={collection.game}
                  isHovered={hoveredId === cardKey(card)}
                  onHover={() => setHoveredId(cardKey(card))}
                  onLeave={() => setHoveredId(null)}
                      onZoom={onZoom}
                  touchMoving={touchMovingId === cardKey(card)}
                  overTrash={overTrash}
                  justDragged={justDragged}
                />
              ))}
            </div>
          </SortableContext>
          {dragging && <TrashDropZone ref={trashElRef} isOver={overTrash} />}
        </DndContext>
      )}

      {/* Short-lived undo for a card dropped in the trash */}
      {lastRemoved && !dragging && (
        <div className="trash-zone-in fixed left-1/2 z-[60] bottom-[calc(env(safe-area-inset-bottom)+84px)] md:bottom-24">
          <div className="flex items-center gap-3 bg-slate-950 border border-slate-700 rounded-full pl-4 pr-1.5 py-1.5 shadow-xl text-sm text-slate-300 whitespace-nowrap">
            <span>Removed <span className="font-semibold text-ink">{lastRemoved.card.name.split(',')[0]}</span></span>
            <button onClick={undoRemove} className="px-3 py-1 rounded-full bg-violet-600 text-white text-xs font-semibold">
              Undo
            </button>
          </div>
        </div>
      )}

      {showAddModal && (
        <AddCardToCollectionModal
          game={collection.game}
          alreadyAddedIds={cardIds}
          onAdd={addCard}
          onClose={onCloseAddModal}
        />
      )}
    </div>
  )
}

// ── Add Card modal — same chrome as the Inventory Add Card dialog, search only ──

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

function AddCardToCollectionModal({
  game, alreadyAddedIds, onAdd, onClose,
}: {
  game: 'lorcana' | 'riftbound'
  alreadyAddedIds: Set<string>
  onAdd: (result: CardSearchResult) => void
  onClose: () => void
}) {
  useScrollLock()
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounce(query, 300)
  const [results, setResults] = useState<CardSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [justAdded, setJustAdded] = useState<Set<string>>(new Set())
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    if (debouncedQuery.trim().length < 2) { setResults([]); return }
    let stale = false
    setSearching(true)
    fetch(`/api/cards/search?game=${game}&q=${encodeURIComponent(debouncedQuery)}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: CardSearchResult[]) => { if (!stale) setResults(data) })
      .catch(() => {})
      .finally(() => { if (!stale) setSearching(false) })
    return () => { stale = true }
  }, [debouncedQuery, game])

  function handleAdd(result: CardSearchResult) {
    onAdd(result)
    setJustAdded((prev) => new Set(prev).add(cardKey(result)))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm touch-none" onClick={onClose} />
      <div className="relative w-full max-w-lg card-glass rounded-2xl p-5 md:p-6 max-h-[85dvh] flex flex-col overscroll-contain">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-ink">Add Card to Collection</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:text-ink hover:bg-slate-700">
            <X size={18} />
          </button>
        </div>

        <div className="relative mb-2">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${GAME_LABELS[game]} cards…`}
            className="input-field pl-9 pr-9"
          />
          {searching && (
            <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 animate-spin" />
          )}
        </div>

        <div className="flex-1 overflow-y-auto -mx-2 px-2">
          {results.length === 0 && query.trim().length >= 2 && !searching && (
            <div className="text-xs text-slate-500 px-1 py-3">No results for &quot;{query}&quot;.</div>
          )}
          {results.map((result) => {
            const added = alreadyAddedIds.has(cardKey(result)) || justAdded.has(cardKey(result))
            return (
              <button
                key={`${result.id}-${result.isFoil ? 'foil' : 'normal'}`}
                type="button"
                onClick={() => !added && handleAdd(result)}
                disabled={added}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left border-b border-slate-800 last:border-0',
                  added ? 'opacity-40 cursor-default' : 'hover:bg-slate-800',
                )}
              >
                {result.imageUrl ? (
                  <div className="w-12 h-16 rounded-lg bg-white flex-shrink-0 flex items-center justify-center shadow-md overflow-hidden">
                    <img src={result.imageUrl} alt={result.name} className="w-full h-full object-contain" />
                  </div>
                ) : (
                  <div className="w-12 h-16 bg-slate-800 rounded-lg flex-shrink-0 flex items-center justify-center text-slate-600 text-xs">?</div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-ink font-medium truncate">{result.name}</div>
                  <div className="text-xs text-slate-500 truncate">{result.setName} · #{result.number}</div>
                </div>
                {added ? (
                  <span className="text-[10px] text-emerald-600 font-medium shrink-0">Added</span>
                ) : (
                  <Plus size={16} className="text-violet-600 shrink-0" />
                )}
              </button>
            )
          })}
        </div>

        <button onClick={onClose} className="btn-secondary justify-center mt-4">
          Done
        </button>
      </div>
    </div>
  )
}

// ── Sortable wrapper — dnd-kit drag handle + transform, same grid cell as before ──

function SortablePersonalCardTile(props: {
  card: PersonalCollectionCard & { owned: boolean; quantity: number }
  gameColor: string
  game: Game
  isHovered: boolean
  onHover: () => void
  onLeave: () => void
  onZoom: (el: HTMLElement, data: Omit<ZoomCardData, 'originRect'>) => void
  touchMoving: boolean
  overTrash: boolean
  justDragged: () => boolean
}) {
  const { touchMoving, overTrash, justDragged, ...tileProps } = props
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: cardKey(props.card) })
  const trashing = isDragging && overTrash

  // Finger currently resting on this card, before move mode has started — drives the gradual
  // grow. Cleared the moment the finger lifts or drifts far enough that it's a scroll, not a hold.
  const [holding, setHolding] = useState(false)
  const holdStart = useRef<{ x: number; y: number } | null>(null)
  function endHold() { holdStart.current = null; setHolding(false) }

  // The outer element only carries dnd-kit's own translate (so the scale below never fights it).
  // Mouse drags keep the original faded look; a touch drag gets the lifted shadow instead.
  const outerStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging && !touchMoving && !overTrash ? 0.4 : 1,
    zIndex: isDragging || holding ? 20 : undefined,
  }
  const grown = holding || touchMoving
  const innerStyle = {
    // Over the trash, the held card shrinks and fades a little — "this one's about to go".
    transform: trashing ? 'scale(0.72)' : grown ? `scale(${HOLD_GROW_SCALE})` : 'scale(1)',
    opacity: trashing ? 0.55 : 1,
    filter: touchMoving
      ? 'drop-shadow(0 12px 18px rgba(60, 40, 20, 0.35))'
      : holding
        ? 'drop-shadow(0 8px 12px rgba(60, 40, 20, 0.22))'
        : 'drop-shadow(0 0 0 rgba(60, 40, 20, 0))',
    // Slow, steady grow for the whole hold; quick settle back if the hold is abandoned.
    transition: holding && !touchMoving
      ? `transform ${MOVE_MODE_HOLD_MS}ms cubic-bezier(0.25, 0.6, 0.35, 1), filter ${MOVE_MODE_HOLD_MS}ms ease-out`
      : 'transform 200ms cubic-bezier(0.2, 0.8, 0.3, 1), filter 200ms ease-out, opacity 200ms ease-out',
  }

  return (
    <div
      ref={setNodeRef}
      style={{ ...outerStyle, position: 'relative' }}
      {...attributes}
      {...listeners}
      // Composed with dnd-kit's own touch listener (from `listeners`) rather than replacing it.
      onTouchStart={(e) => {
        listeners?.onTouchStart?.(e)
        const t = e.touches[0]
        if (e.touches.length === 1 && t) { holdStart.current = { x: t.clientX, y: t.clientY }; setHolding(true) }
      }}
      onTouchMove={(e) => {
        const t = e.touches[0]
        if (!holdStart.current || !t || touchMoving) return
        if (Math.hypot(t.clientX - holdStart.current.x, t.clientY - holdStart.current.y) > HOLD_MOVE_TOLERANCE_PX) endHold()
      }}
      onTouchEnd={endHold}
      onTouchCancel={endHold}
      // No touch-action: none here — that's what blocked page scrolling on phones. The touch
      // sensor stops scrolling itself, but only once move mode has actually started.
      // select-none + no touch callout keep the hold from popping the phone's own
      // "Save Image" / text-selection menu.
      className="cursor-grab active:cursor-grabbing select-none [-webkit-touch-callout:none]"
      onContextMenu={(e) => { if ((e.nativeEvent as PointerEvent).pointerType === 'touch') e.preventDefault() }}
      onClickCapture={(e) => { if (justDragged()) { e.stopPropagation(); e.preventDefault() } }}
    >
      {/* "You can move it now" cue: plays once behind the card the moment move mode starts */}
      {touchMoving && <MoveCue />}
      <div style={innerStyle} className="relative z-10">
        <PersonalCardTile {...tileProps} />
      </div>
    </div>
  )
}

// Bottom-center trash can that appears only while a card is being dragged; dropping a card on it
// removes the card from the collection (the only way to remove one — it replaced a hover-only ✕
// on each tile, which also made iOS need two taps to open a card). Sits above the phone bottom
// bar. Not a dnd-kit droppable: CollectionDetail hit-tests it against the pointer itself.
const TrashDropZone = forwardRef<HTMLDivElement, { isOver: boolean }>(function TrashDropZone({ isOver }, ref) {
  return (
    <div className="trash-zone-in fixed left-1/2 z-[60] pointer-events-none bottom-[calc(env(safe-area-inset-bottom)+84px)] md:bottom-24">
      <div
        ref={ref}
        className={cn(
          'flex flex-col items-center justify-center gap-1 w-[72px] h-[72px] rounded-full border-2 shadow-xl transition-all duration-200 ease-out',
          isOver
            ? 'scale-125 bg-red-600 border-red-700 text-white shadow-[0_0_0_10px_rgba(168,69,42,0.18),0_12px_28px_rgba(168,69,42,0.35)]'
            : 'bg-slate-950 border-slate-700 text-slate-300',
        )}
      >
        <Trash2 size={24} />
        <span className="text-[10px] font-semibold leading-none">{isOver ? 'Release' : 'Remove'}</span>
      </div>
    </div>
  )
})

// Four-way "move" arrows that fade in behind a card, push outward once, and vanish — a quiet
// hint that a touch-held card is now in move mode. Larger than the card so the arrow tips peek
// out past all four of its edges; the animation lives in globals.css (.move-cue).
function MoveCue() {
  return (
    <svg
      viewBox="0 0 100 100"
      aria-hidden
      // Square and ~2.6× the card's width, so all four tips clear a tall 5:7 card's edges.
      className="move-cue pointer-events-none absolute left-1/2 top-1/2 w-[260%] h-auto aspect-square text-ink"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      vectorEffect="non-scaling-stroke"
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      {/* one outlined arrow, rotated four ways around the center */}
      {[0, 90, 180, 270].map((deg) => (
        <path
          key={deg}
          transform={`rotate(${deg} 50 50)`}
          d="M46 41 L46 20 L40 20 L50 6 L60 20 L54 20 L54 41"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  )
}

// ── Card tile — same visual language as the main Cardex grid, plus a remove button ──

function PersonalCardTile({
  card, gameColor, game, isHovered, onHover, onLeave, onZoom,
}: {
  card: PersonalCollectionCard & { owned: boolean; quantity: number }
  gameColor: string
  game: Game
  isHovered: boolean
  onHover: () => void
  onLeave: () => void
  onZoom: (el: HTMLElement, data: Omit<ZoomCardData, 'originRect'>) => void
}) {
  const rarityColor = RARITY_COLORS[card.rarity ?? ''] ?? '#7a6a55'
  const ebayCard = { name: card.name, number: card.number, set: card.setName, game, isFoil: card.isFoil }

  return (
    <div
      className="relative group cursor-pointer"
      // Mouse only: on a phone, a tap that fires a hover handler which changes the page (this
      // shows a tooltip) makes iOS treat that first tap as a hover and wait for a second tap
      // before clicking — so tapping a card took two taps to open the zoom view.
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') onHover() }}
      onPointerLeave={(e) => { if (e.pointerType === 'mouse') onLeave() }}
      onClick={(e) => {
        if (e.ctrlKey || e.metaKey) { openEbaySearch(ebayCard); return }
        onZoom(e.currentTarget, {
          imageUrl: card.imageUrl,
          name: card.name,
          number: card.number,
          rarityLabel: card.rarity ?? '',
          rarityColor,
          marketPrice: card.marketPrice ?? 0,
          owned: card.owned,
          quantity: card.quantity,
          isFoil: card.isFoil,
          glowColor: zoomGlowColor(game, card.rarity ?? '', gameColor),
          ebayCard,
        })
      }}
      title="Click to view — ⌘/Ctrl+Click to search eBay sold listings"
    >
      <div
        className={cn('relative w-full rounded-lg overflow-hidden transition-all duration-200', card.owned ? 'shadow-lg' : 'opacity-30')}
        style={{
          aspectRatio: '5/7',
          filter: card.owned ? 'none' : 'grayscale(1)',
          outline: card.owned ? `2px solid ${gameColor}40` : '1px solid #d6c49f',
          boxShadow: card.owned && isHovered ? `0 0 12px ${gameColor}60` : undefined,
        }}
      >
        {card.imageUrl ? (
          <img src={card.imageUrl} alt={card.name} loading="lazy" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs font-bold" style={{ backgroundColor: rarityColor + '18', color: rarityColor }}>
            #{card.number}
          </div>
        )}

        {card.owned && (
          card.quantity > 1 ? (
            <div className="absolute top-1 right-1 rounded-full px-1.5 py-0.5 text-[9px] font-black text-white leading-none" style={{ backgroundColor: gameColor }}>
              ×{card.quantity > 99 ? '99+' : card.quantity}
            </div>
          ) : (
            <div className="absolute top-1 right-1 w-4 h-4 rounded-full flex items-center justify-center" style={{ backgroundColor: gameColor + 'cc' }}>
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                <path d="M1 4l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          )
        )}

        <div className="absolute bottom-1 left-1 bg-black/70 rounded px-1 py-0.5 text-[8px] font-bold text-white/80 leading-none">
          #{card.number}
        </div>

      </div>

      {isHovered && (
        // Web-only: on a phone (no real hover) the card's info lives in the tap-to-zoom view
        // instead, so this never renders there — even if a touch somehow sets the hover state.
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-20 pointer-events-none [@media(hover:none)]:hidden">
          <div className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-center shadow-xl whitespace-nowrap">
            <div className="text-xs font-semibold text-ink leading-tight max-w-[140px] truncate">{card.name}</div>
            <div className="text-[10px] mt-0.5 text-slate-400">{card.setName}</div>
            {(card.marketPrice ?? 0) > 0 && <div className="text-[10px] text-slate-400 mt-0.5">${card.marketPrice!.toFixed(2)}</div>}
            {card.owned
              ? <div className="text-[10px] text-emerald-600 mt-0.5">✓ {card.quantity > 1 ? `×${card.quantity} owned` : 'owned'}</div>
              : <div className="text-[10px] text-slate-500 mt-0.5">not collected</div>}
          </div>
          <div className="w-2 h-2 bg-slate-900 border-r border-b border-slate-700 rotate-45 mx-auto -mt-1" />
        </div>
      )}
    </div>
  )
}
