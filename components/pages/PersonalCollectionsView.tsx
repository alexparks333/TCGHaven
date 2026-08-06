'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import {
  DndContext, PointerSensor, useSensor, useSensors, closestCenter,
  type DragEndEvent,
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
import { cn } from '@/lib/utils'

const RARITY_COLORS: Record<string, string> = {
  Common: '#6b7280', Uncommon: '#22c55e', Rare: '#3b82f6',
  Super_rare: '#a855f7', Legendary: '#f97316', Enchanted: '#ec4899',
  Epic: '#06b6d4', Showcase: '#fbbf24', Star: '#fbbf24', Promo: '#84cc16',
}

function isOwned(card: PersonalCollectionCard, ownedCards: Card[]): { owned: boolean; quantity: number } {
  const matches = ownedCards.filter((c) => c.apiId === card.id)
  return { owned: matches.length > 0, quantity: matches.reduce((s, c) => s + c.quantity, 0) }
}

export function PersonalCollectionsView() {
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
      <div className="flex items-center justify-center py-24 gap-3 text-slate-500">
        <Loader2 size={24} className="animate-spin text-violet-400" />
        <span className="text-sm">Loading your collections…</span>
      </div>
    )
  }

  return (
    <div>
      {error && (
        <div className="mb-4 text-xs text-red-400 bg-red-950/30 border border-red-900/50 rounded-lg px-3 py-2">
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
            Make one for anything you want to track — a champion's cards across every set, a
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
                              ? 'text-white border-transparent'
                              : 'bg-slate-900/50 text-slate-400 border-slate-800 hover:text-white hover:bg-slate-800',
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
      <div className="text-sm font-semibold text-white">New Personalized Collection</div>
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex gap-2 shrink-0">
          {(['lorcana', 'riftbound'] as const).map((g) => (
            <button
              key={g}
              onClick={() => setGame(g)}
              className={cn(
                'px-3 py-2 rounded-lg text-xs font-medium transition-all border',
                game === g ? 'text-white border-transparent' : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white',
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
          className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-600"
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
        <button onClick={onCancel} className="text-xs font-medium px-3 py-1.5 rounded-lg text-slate-400 hover:text-white">
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── Collection detail (grid + Add Card modal) ─────────────────────────────────

function CollectionDetail({
  collection, ownedCards, onDelete, onCardsChanged, showAddModal, onOpenAddModal, onCloseAddModal,
}: {
  collection: PersonalCollection
  ownedCards: Card[]
  onDelete: () => void
  onCardsChanged: (cards: PersonalCollectionCard[]) => void
  showAddModal: boolean
  onOpenAddModal: () => void
  onCloseAddModal: () => void
}) {
  const { user } = useAuth()
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const color = GAME_COLORS[collection.game]
  const cardIds = useMemo(() => new Set(collection.cards.map((c) => c.id)), [collection.cards])

  // Drag-to-reorder — visual order lives here so dragging feels instant; only persisted to
  // Firestore once the drag actually ends, not on every intermediate swap. Resynced whenever
  // the collection's real card list changes (add/remove), not just on mount.
  const [orderedIds, setOrderedIds] = useState<string[]>(() => collection.cards.map((c) => c.id))
  useEffect(() => {
    setOrderedIds(collection.cards.map((c) => c.id))
  }, [collection.cards])

  async function addCard(result: CardSearchResult) {
    if (!user || cardIds.has(result.id)) return
    const newCard: PersonalCollectionCard = {
      id: result.id, name: result.name, number: result.number, setName: result.setName,
      imageUrl: result.imageUrl, marketPrice: result.marketPrice,
    }
    const updated = [...collection.cards, newCard]
    onCardsChanged(updated) // optimistic
    await setCollectionCards(user.uid, collection.id, updated).catch(() => setSaveError('Failed to save — try again.'))
  }

  async function removeCard(cardId: string) {
    if (!user) return
    const updated = collection.cards.filter((c) => c.id !== cardId)
    onCardsChanged(updated) // optimistic
    await setCollectionCards(user.uid, collection.id, updated).catch(() => setSaveError('Failed to save — try again.'))
  }

  async function persistOrder(newOrderIds: string[]) {
    if (!user) return
    const cardsById = new Map(collection.cards.map((c) => [c.id, c]))
    const reordered = newOrderIds.map((id) => cardsById.get(id)).filter((c): c is PersonalCollectionCard => !!c)
    onCardsChanged(reordered)
    await setCollectionCards(user.uid, collection.id, reordered).catch(() => setSaveError('Failed to save the new order — try again.'))
  }

  // Small activation distance so a plain click (e.g. the remove-card button, or opening the
  // hover tooltip) never gets mistaken for a drag — a real drag has to move the pointer first.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = orderedIds.indexOf(String(active.id))
    const newIndex = orderedIds.indexOf(String(over.id))
    if (oldIndex === -1 || newIndex === -1) return
    const newOrder = arrayMove(orderedIds, oldIndex, newIndex)
    setOrderedIds(newOrder)
    persistOrder(newOrder)
  }

  const cardsById = useMemo(() => new Map(collection.cards.map((c) => [c.id, c])), [collection.cards])
  const enriched = orderedIds
    .map((id) => cardsById.get(id))
    .filter((c): c is PersonalCollectionCard => !!c)
    .map((c) => ({ ...c, ...isOwned(c, ownedCards) }))
  const ownedCount = enriched.filter((c) => c.owned).length
  const totalCount = enriched.length
  const pct = totalCount > 0 ? Math.round((ownedCount / totalCount) * 100) : 0

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
          <h2 className="text-lg font-bold text-white">{collection.name}</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onOpenAddModal}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-violet-600 text-white hover:bg-violet-500"
          >
            <Plus size={13} /> Add Card
          </button>
          {confirmingDelete ? (
            <div className="flex items-center gap-2 bg-red-950/30 border border-red-900/50 rounded-lg px-2.5 py-1.5">
              <span className="text-xs text-red-300">Delete &quot;{collection.name}&quot;? This can&apos;t be undone.</span>
              <button
                onClick={onDelete}
                className="text-xs font-semibold text-white bg-red-600 hover:bg-red-500 rounded-md px-2 py-1"
              >
                Yes, Delete
              </button>
              <button
                onClick={() => setConfirmingDelete(false)}
                className="text-xs font-medium text-slate-400 hover:text-white px-2 py-1"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmingDelete(true)}
              className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-red-400"
            >
              <Trash2 size={13} /> Delete Collection
            </button>
          )}
        </div>
      </div>

      {saveError && <div className="text-xs text-red-400 mb-3">{saveError}</div>}

      {/* Progress */}
      {totalCount > 0 && (
        <div className="mb-5 card-glass px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-white">Progress</span>
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
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={orderedIds} strategy={rectSortingStrategy}>
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))' }}>
              {enriched.map((card) => (
                <SortablePersonalCardTile
                  key={card.id}
                  card={card}
                  gameColor={color}
                  isHovered={hoveredId === card.id}
                  onHover={() => setHoveredId(card.id)}
                  onLeave={() => setHoveredId(null)}
                  onRemove={() => removeCard(card.id)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
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
    setJustAdded((prev) => new Set(prev).add(result.id))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg card-glass rounded-2xl p-6 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-white">Add Card to Collection</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-slate-700">
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
            const added = alreadyAddedIds.has(result.id) || justAdded.has(result.id)
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
                  <div className="text-sm text-white font-medium truncate">{result.name}</div>
                  <div className="text-xs text-slate-500 truncate">{result.setName} · #{result.number}</div>
                </div>
                {added ? (
                  <span className="text-[10px] text-emerald-400 font-medium shrink-0">Added</span>
                ) : (
                  <Plus size={16} className="text-violet-400 shrink-0" />
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
  isHovered: boolean
  onHover: () => void
  onLeave: () => void
  onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.card.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 10 : undefined,
  }
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing touch-none">
      <PersonalCardTile {...props} />
    </div>
  )
}

// ── Card tile — same visual language as the main Cardex grid, plus a remove button ──

function PersonalCardTile({
  card, gameColor, isHovered, onHover, onLeave, onRemove,
}: {
  card: PersonalCollectionCard & { owned: boolean; quantity: number }
  gameColor: string
  isHovered: boolean
  onHover: () => void
  onLeave: () => void
  onRemove: () => void
}) {
  const rarityColor = RARITY_COLORS[card.rarity ?? ''] ?? '#6b7280'

  return (
    <div className="relative group cursor-default" onMouseEnter={onHover} onMouseLeave={onLeave}>
      <div
        className={cn('relative w-full rounded-lg overflow-hidden transition-all duration-200', card.owned ? 'shadow-lg' : 'opacity-30')}
        style={{
          aspectRatio: '5/7',
          filter: card.owned ? 'none' : 'grayscale(1)',
          outline: card.owned ? `2px solid ${gameColor}40` : '1px solid #1e293b',
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

        <button
          onClick={onRemove}
          title="Remove from this collection"
          className="absolute top-1 left-1 w-4 h-4 rounded-full bg-black/70 flex items-center justify-center text-white/70 hover:text-red-400 hover:bg-black/90 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <X size={10} />
        </button>
      </div>

      {isHovered && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-20 pointer-events-none">
          <div className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-center shadow-xl whitespace-nowrap">
            <div className="text-xs font-semibold text-white leading-tight max-w-[140px] truncate">{card.name}</div>
            <div className="text-[10px] mt-0.5 text-slate-400">{card.setName}</div>
            {(card.marketPrice ?? 0) > 0 && <div className="text-[10px] text-slate-400 mt-0.5">${card.marketPrice!.toFixed(2)}</div>}
            {card.owned
              ? <div className="text-[10px] text-emerald-400 mt-0.5">✓ {card.quantity > 1 ? `×${card.quantity} owned` : 'owned'}</div>
              : <div className="text-[10px] text-slate-500 mt-0.5">not collected</div>}
          </div>
          <div className="w-2 h-2 bg-slate-900 border-r border-b border-slate-700 rotate-45 mx-auto -mt-1" />
        </div>
      )}
    </div>
  )
}
