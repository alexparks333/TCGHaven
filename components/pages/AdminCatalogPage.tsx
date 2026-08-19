'use client'

import { Fragment, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Search, Plus, Eye, EyeOff, Pencil, Wand2, Upload, AlertCircle, CheckCircle2, LocateFixed, FolderPlus, ScanSearch, Trash2, X, ChevronRight, ChevronDown, StickyNote, RefreshCw } from 'lucide-react'
import {
  doc, setDoc, updateDoc, getDoc, deleteDoc, serverTimestamp, collection, query, where, getDocs,
} from 'firebase/firestore'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { useAuth } from '@/components/auth/AuthProvider'
import { useStore } from '@/lib/store'
import { editCard as editCardInFirestore } from '@/lib/firebase/db'
import { db, storage, ADMIN_UID } from '@/lib/firebase/config'
import { regenerateSnapshot, normNum } from '@/lib/api/catalog'
import { cn } from '@/lib/utils'
import { GAME_COLORS, type Game, type CatalogSyncNotice } from '@/lib/types'

interface SetOption {
  code: string
  name: string
  releaseDate: string
  cardCount?: number
  isCustom?: boolean
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
  // Set-level fact, not stored per card — populated client-side from the active set (browse
  // mode) or passed through by the whole-catalog search route (search mode, where rows span
  // multiple sets so it can't just be read off one shared "active set").
  releaseDate?: string
  // Present at runtime on the underlying Firestore doc (spread straight through by the admin
  // catalog routes) but not previously typed on the frontend — surfaced in the per-card expand
  // panel below. lowPriceNM/lowPriceNMFoil: Pokemon/Riftbound only. cardType/tags: Riftbound only.
  lowPriceNM?: number
  lowPriceNMFoil?: number
  cardType?: string
  tags?: string[]
  // Free-text field an admin can attach to any card — never sourced from a scraper, purely a
  // curation aid (e.g. "error card", "reprint of X", "watch for reprint"). Persists on the
  // Firestore doc like any other field.
  notes?: string
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
        <SyncPanel />
        <CatalogBrowser />
      </div>
    </AuthGuard>
  )
}

// ── Sync Card Data ──────────────────────────────────────────────────────────
// Runs directly against Firestore via app/api/sync/{game}/route.ts — one plain, synchronous
// request per game, no build/restart step (see CLAUDE.md §14). Works identically against
// localhost and the deployed Vercel app, since neither writes to the local filesystem anymore.

interface GameSyncResult {
  setCount: number
  newSets?: string[]
  groupMatches?: Array<{ setName: string; matched: boolean; confidence: number | null }>
}

interface GameSyncState {
  status: 'idle' | 'running' | 'done' | 'error'
  error?: string
  result?: GameSyncResult
}

const SYNC_GAMES: { game: Game; label: string }[] = [
  { game: 'pokemon', label: 'Pokémon' },
  { game: 'lorcana', label: 'Lorcana' },
  { game: 'riftbound', label: 'Riftbound' },
]

function SyncPanel() {
  const { user } = useAuth()
  const isAdmin = !!user && !!ADMIN_UID && user.uid === ADMIN_UID
  const [state, setState] = useState<Record<Game, GameSyncState>>({
    pokemon: { status: 'idle' }, lorcana: { status: 'idle' }, riftbound: { status: 'idle' },
  })

  if (!isAdmin) return null

  async function runSync(game: Game) {
    setState((s) => ({ ...s, [game]: { status: 'running' } }))
    try {
      const res = await fetch(`/api/sync/${game}`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setState((s) => ({ ...s, [game]: { status: 'error', error: data.error ?? `Request failed (${res.status})` } }))
        return
      }
      setState((s) => ({ ...s, [game]: { status: 'done', result: data } }))
    } catch {
      setState((s) => ({ ...s, [game]: { status: 'error', error: 'Could not reach the server.' } }))
    }
  }

  return (
    <div className="card-glass p-5 mb-6">
      <h2 className="text-white font-semibold mb-1">Sync Card Data</h2>
      <p className="text-slate-400 text-sm mb-4">
        Re-downloads a game&apos;s catalog and registers any newly-found sets. Each game syncs
        independently — Pokémon has by far the most sets/cards, so it can take a while.
      </p>
      <div className="space-y-3">
        {SYNC_GAMES.map(({ game, label }) => {
          const s = state[game]
          const running = s.status === 'running'
          return (
            <div key={game} className="border-t border-slate-800 pt-3 first:border-t-0 first:pt-0">
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-white font-medium">{label}</span>
                <button
                  onClick={() => runSync(game)}
                  disabled={running}
                  className={cn(
                    'shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                    running
                      ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                      : 'bg-violet-600 text-white hover:bg-violet-500',
                  )}
                >
                  {running ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  Sync
                </button>
              </div>

              {s.status === 'error' && (
                <div className="flex items-start gap-2 text-red-400 text-xs bg-red-950/30 border border-red-900/50 rounded-lg px-3 py-2 mt-2">
                  <AlertCircle size={14} className="shrink-0 mt-0.5" />
                  <span>{s.error}</span>
                </div>
              )}

              {s.status === 'done' && s.result && (
                <div className="text-xs text-slate-400 mt-2 space-y-1">
                  <div className="flex items-center gap-1.5 text-emerald-400">
                    <CheckCircle2 size={13} />
                    <span>{s.result.setCount} sets synced</span>
                  </div>
                  {!!s.result.newSets?.length && (
                    <div>New sets found: {s.result.newSets.join(', ')} — flagged for review below.</div>
                  )}
                  {!!s.result.groupMatches?.length && (
                    <div>
                      TCGPlayer matches:{' '}
                      {s.result.groupMatches.map((m) => (
                        <span key={m.setName} className="inline-block mr-2">
                          {m.setName}: {m.matched ? `matched (${Math.round((m.confidence ?? 0) * 100)}%)` : 'no confident match — needs manual group ID'}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
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
  const [addFormPrefill, setAddFormPrefill] = useState<Partial<CatalogCard> | null>(null)
  const [showNewSetForm, setShowNewSetForm] = useState(false)
  const [deletingSet, setDeletingSet] = useState(false)
  const [showRawSourceCheck, setShowRawSourceCheck] = useState(false)
  const [editingCard, setEditingCard] = useState<CatalogCard | null>(null)
  const [jumpName, setJumpName] = useState('')
  const [jumpNumber, setJumpNumber] = useState('')
  const [jumpNameMissed, setJumpNameMissed] = useState(false)
  const [jumpNumberMissed, setJumpNumberMissed] = useState(false)
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const [pendingJumpId, setPendingJumpId] = useState<string | null>(null)
  const [globalQuery, setGlobalQuery] = useState('')
  const [globalResults, setGlobalResults] = useState<CatalogCard[]>([])
  const [globalSearching, setGlobalSearching] = useState(false)
  const isSearchMode = globalQuery.trim().length >= 2
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

  // Whole-catalog search results are game-scoped and would otherwise show stale matches from
  // whatever game was active before switching tabs.
  useEffect(() => { setGlobalQuery(''); setGlobalResults([]) }, [activeGame])

  useEffect(() => {
    const q = globalQuery.trim()
    if (q.length < 2) { setGlobalResults([]); setGlobalSearching(false); return }
    let stale = false
    setGlobalSearching(true)
    const timer = setTimeout(() => {
      fetch(`/api/admin/catalog/search?game=${activeGame}&q=${encodeURIComponent(q)}`)
        .then((r) => (r.ok ? r.json() : []))
        .then((data: CatalogCard[]) => { if (!stale) setGlobalResults(data) })
        .catch(() => { if (!stale) setGlobalResults([]) })
        .finally(() => { if (!stale) setGlobalSearching(false) })
    }, 300)
    return () => { stale = true; clearTimeout(timer) }
  }, [globalQuery, activeGame])

  // Re-fetches the set picker and jumps to a specific set by name (used after creating a new
  // one) — /api/sets is server-cached indefinitely (see invalidateSetsCache in lib/api/search.ts,
  // called by the set-registry POST route before this runs), so this refetch actually reflects it.
  function reloadSets(jumpToSetName?: string) {
    setLoadingSets(true)
    fetch(`/api/sets?game=${activeGame}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: SetOption[]) => {
        setSets(data)
        setActiveSet((jumpToSetName ? data.find((s) => s.name === jumpToSetName) : undefined) ?? data[0] ?? null)
      })
      .catch(() => {})
      .finally(() => setLoadingSets(false))
  }

  function loadCards() {
    if (!activeSet) return
    setLoadingCards(true)
    const setReleaseDate = activeSet.releaseDate
    fetch(`/api/admin/catalog?game=${activeGame}&set=${encodeURIComponent(activeSet.name)}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: CatalogCard[]) => setCards(data.map((c) => ({ ...c, releaseDate: setReleaseDate }))))
      .catch(() => {})
      .finally(() => setLoadingCards(false))
  }

  useEffect(() => {
    loadCards()
    setJumpName(''); setJumpNumber(''); setJumpNameMissed(false); setJumpNumberMissed(false)
  }, [activeGame, activeSet])

  // The card being acted on might currently be displayed via the per-set `cards` list or via
  // whole-catalog `globalResults` (search mode) — check both rather than assuming one.
  function findDisplayedCard(id: string): CatalogCard | undefined {
    return cards.find((c) => c.id === id) ?? globalResults.find((c) => c.id === id)
  }

  async function toggleHideCard(id: string) {
    setActionError(null)
    setActionSuccess(null)
    const current = findDisplayedCard(id)
    if (!current) return
    const nextHidden = !current.isHidden
    // Optimistic: flip it in local state immediately so the row updates instantly and another
    // card can be hidden right away, instead of waiting on a full table reload every click.
    // Applied to both lists — whichever one isn't currently rendered just stays in sync for
    // when the admin switches back to it.
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, isHidden: nextHidden } : c)))
    setGlobalResults((prev) => prev.map((c) => (c.id === id ? { ...c, isHidden: nextHidden } : c)))
    try {
      await updateDoc(doc(db, 'catalog', activeGame, 'cards', id), { hidden: nextHidden, updatedAt: serverTimestamp() })
      await regenerateSnapshot(activeGame)
    } catch (err) {
      setCards((prev) => prev.map((c) => (c.id === id ? { ...c, isHidden: !nextHidden } : c)))
      setGlobalResults((prev) => prev.map((c) => (c.id === id ? { ...c, isHidden: !nextHidden } : c)))
      setActionError(`Hide/unhide failed: ${(err as Error).message}`)
    }
  }

  // Permanently removes a card doc — restricted to isCustom cards (see CardTable's Delete
  // button gating) since those are the only ones with no other source of truth to regenerate
  // them. Unlike hide, this can't be undone, so it's confirmed here rather than optimistic.
  async function deleteCard(id: string) {
    setActionError(null)
    setActionSuccess(null)
    const card = findDisplayedCard(id)
    if (!card) return
    if (!window.confirm(`Permanently delete "${card.name}" (#${card.number}) from the catalog? This cannot be undone.`)) return
    try {
      await deleteDoc(doc(db, 'catalog', activeGame, 'cards', id))
      await regenerateSnapshot(activeGame)
      setCards((prev) => prev.filter((c) => c.id !== id))
      setGlobalResults((prev) => prev.filter((c) => c.id !== id))
      setActionSuccess(`Deleted "${card.name}" from the catalog.`)
    } catch (err) {
      setActionError(`Delete failed: ${(err as Error).message}`)
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
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } as CatalogCard : c)))
    setGlobalResults((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } as CatalogCard : c)))

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

  // Deletes a custom (source: "manual") set entirely: every card doc under its setName, then
  // the registry entry itself. Restricted to custom sets — an official/auto-detected set would
  // just come back on the next sync anyway, and deleting one out from under real card data (that
  // might be referenced by other users' inventory via apiId) would only cause harm for no benefit.
  // Cascades to cards rather than requiring the set to be emptied first: once a set's registry
  // entry is gone, the set picker (registry-driven) can no longer reach any cards left under its
  // name, so leaving them behind would just silently orphan them with no way to manage them.
  async function deleteSet() {
    if (!activeSet) return
    setActionError(null)
    setActionSuccess(null)
    const cardCount = cards.length
    if (!window.confirm(`Permanently delete the set "${activeSet.name}" and all ${cardCount} card${cardCount === 1 ? '' : 's'} in it? This cannot be undone.`)) return
    setDeletingSet(true)
    try {
      // Query fresh rather than trusting the currently-loaded `cards` state, in case it's stale.
      const snap = await getDocs(query(collection(db, 'catalog', activeGame, 'cards'), where('setName', '==', activeSet.name)))
      await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)))
      await regenerateSnapshot(activeGame)

      const res = await fetch('/api/set-registry', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ game: activeGame, setName: activeSet.name }),
      })
      const data = await res.json()
      if (!res.ok) { setActionError(data.error ?? 'Failed to delete set.'); return }

      setActionSuccess(`Deleted "${activeSet.name}" and ${snap.size} card${snap.size === 1 ? '' : 's'}.`)
      reloadSets()
    } catch (err) {
      setActionError(`Delete failed: ${(err as Error).message}`)
    } finally {
      setDeletingSet(false)
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

  // Resolves an "Open this card in its own set" jump (see handleJumpToSet below) once the
  // target set's cards have actually loaded (switching activeSet re-triggers loadCards()
  // asynchronously — the row doesn't exist to scroll to until that fetch resolves and this
  // table re-renders).
  useEffect(() => {
    if (pendingJumpId && cards.some((c) => c.id === pendingJumpId)) {
      jumpToRow(pendingJumpId)
      setPendingJumpId(null)
    }
  }, [cards, pendingJumpId])

  // "Open set" on a search-result row: exit search mode and switch to that card's set so it can
  // be seen in context (surrounding cards, etc.) — the effect above finishes the jump once that
  // set's cards finish loading.
  function handleJumpToSet(setName: string, cardId: string) {
    setGlobalQuery('')
    const targetSet = sets.find((s) => s.name === setName)
    if (!targetSet) return
    setPendingJumpId(cardId)
    setActiveSet(targetSet)
  }

  // A set-level fix (e.g. release date) from SetInfoBar — update it everywhere it's cached
  // locally so the UI reflects it immediately without a full sets/cards reload.
  function handleSetInfoUpdated(patch: { releaseDate?: string }) {
    if (!activeSet) return
    const updated = { ...activeSet, ...patch }
    setActiveSet(updated)
    setSets((prev) => prev.map((s) => (s.name === updated.name ? updated : s)))
    setCards((prev) => prev.map((c) => ({ ...c, releaseDate: updated.releaseDate })))
  }

  function handleJumpName(query: string) {
    setJumpName(query)
    if (!query.trim()) { setJumpNameMissed(false); return }
    const q = query.toLowerCase()
    const match = cards.find((c) => c.name.toLowerCase().includes(q))
    setJumpNameMissed(!jumpToRow(match?.id))
  }

  // Matches the literal number string first (handles non-numeric collector numbers like "R01"
  // or a typed suffix like "21b"), then falls back to a leading-zero-normalized numeric match —
  // catalog numbers are frequently zero-padded ("031") while an admin naturally types the bare
  // number ("31"), which a plain startsWith() would never match.
  function findNumberMatch(query: string): CatalogCard | undefined {
    const q = query.trim().toLowerCase()
    if (!q) return undefined
    const exact = cards.find((c) => c.number.toLowerCase() === q)
    if (exact) return exact
    if (/^\d+$/.test(q)) {
      const qNorm = normNum(q)
      const numMatch = cards.find((c) => /^\d+$/.test(c.number) && normNum(c.number) === qNorm)
      if (numMatch) return numMatch
    }
    return cards.find((c) => c.number.toLowerCase().startsWith(q))
  }

  function handleJumpNumber(query: string) {
    setJumpNumber(query)
    if (!query.trim()) { setJumpNumberMissed(false); return }
    setJumpNumberMissed(!jumpToRow(findNumberMatch(query)?.id))
  }

  const gameColor = GAME_COLORS[activeGame]

  return (
    <div>
      <div className="relative mb-4 max-w-md">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          value={globalQuery}
          onChange={(e) => setGlobalQuery(e.target.value)}
          placeholder={`Search the entire ${activeGame} catalog (e.g. "Pikachu")…`}
          className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-8 py-2.5 text-sm text-white"
        />
        {globalQuery && (
          <button
            type="button"
            onClick={() => setGlobalQuery('')}
            title="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
          >
            <X size={14} />
          </button>
        )}
      </div>

      <div className={cn('flex items-center gap-2 mb-4 flex-wrap', isSearchMode && 'opacity-40 pointer-events-none')}>
        <div className="relative">
          <button
            type="button"
            onClick={() => handleJumpName(jumpName)}
            title="Jump to this name"
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
          >
            <LocateFixed size={14} />
          </button>
          <input
            value={jumpName}
            onChange={(e) => handleJumpName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleJumpName(jumpName) }}
            placeholder="Jump to name…"
            className={cn(
              'bg-slate-900 border rounded-lg pl-8 pr-3 py-2 text-sm text-white w-48',
              jumpNameMissed ? 'border-red-800' : 'border-slate-800',
            )}
          />
        </div>
        <div className="relative">
          <button
            type="button"
            onClick={() => handleJumpNumber(jumpNumber)}
            title="Jump to this number"
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
          >
            <LocateFixed size={14} />
          </button>
          <input
            value={jumpNumber}
            onChange={(e) => handleJumpNumber(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleJumpNumber(jumpNumber) }}
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
            onClick={() => { setAddFormPrefill(null); setShowAddForm((v) => !v) }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-violet-600 text-white hover:bg-violet-500"
          >
            <Plus size={14} /> Add Missing Card
          </button>
        )}
        {isAdmin && (
          <button
            onClick={() => setShowNewSetForm((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-slate-800 text-slate-300 hover:bg-slate-700"
            title="Register a brand new set — official (not yet auto-synced) or fully custom"
          >
            <FolderPlus size={14} /> New Set
          </button>
        )}
        {isAdmin && activeGame === 'riftbound' && activeSet && (
          <button
            onClick={() => setShowRawSourceCheck((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-slate-800 text-slate-300 hover:bg-slate-700"
            title="Compare this set against the raw TCGCSV feed and the official Riftbound gallery, independent of the app's own matching logic"
          >
            <ScanSearch size={14} /> Check Raw Source
          </button>
        )}
        {isAdmin && activeSet?.isCustom && (
          <button
            onClick={deleteSet}
            disabled={deletingSet}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-red-950/40 text-red-400 hover:bg-red-950/70 disabled:opacity-50"
            title="Permanently delete this custom set and every card in it — cannot be undone"
          >
            {deletingSet ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            Delete Set
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

      {isAdmin && showNewSetForm && (
        <NewSetForm
          game={activeGame}
          onSaved={(setName) => { setShowNewSetForm(false); reloadSets(setName) }}
          onCancel={() => setShowNewSetForm(false)}
          onError={setActionError}
        />
      )}

      {isAdmin && showRawSourceCheck && activeGame === 'riftbound' && activeSet && (
        <RawSourceCheckPanel
          setCode={activeSet.code}
          onClose={() => setShowRawSourceCheck(false)}
          onAddCandidate={(prefill) => {
            setShowRawSourceCheck(false)
            setAddFormPrefill(prefill)
            setShowAddForm(true)
          }}
        />
      )}

      {isAdmin && showAddForm && activeSet && (
        <AddCardForm
          game={activeGame}
          activeSet={activeSet}
          prefill={addFormPrefill}
          onSaved={() => { setShowAddForm(false); setAddFormPrefill(null); loadCards() }}
          onError={setActionError}
          onSetInfoUpdated={handleSetInfoUpdated}
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

      {isSearchMode ? (
        <>
          <div className="text-xs text-slate-500 mb-2">
            {globalSearching
              ? 'Searching the entire catalog…'
              : `${globalResults.length} result${globalResults.length === 1 ? '' : 's'} across every ${activeGame} set, oldest release first.`}
          </div>
          {globalSearching ? (
            <div className="flex items-center justify-center py-16 gap-3 text-slate-500">
              <Loader2 size={20} className="animate-spin" style={{ color: gameColor }} />
              <span className="text-sm">Searching…</span>
            </div>
          ) : (
            <CardTable
              game={activeGame}
              cards={globalResults}
              isAdmin={isAdmin}
              onToggleHide={toggleHideCard}
              onEdit={setEditingCard}
              onDelete={deleteCard}
              rowRefs={rowRefs.current}
              highlightedId={highlightedId}
              showSetColumn
              onJumpToSet={handleJumpToSet}
              emptyMessage={`No matches for "${globalQuery.trim()}" across the entire ${activeGame} catalog.`}
            />
          )}
        </>
      ) : (
        <>
          {activeSet && (
            <SetInfoBar
              game={activeGame}
              activeSet={activeSet}
              isAdmin={isAdmin}
              // Lorcana/Riftbound sets always have a registry entry (it's the
              // source of truth for their whole set list, not just custom ones — see
              // CLAUDE.md's set-registry section), so editing always works. Pokemon's official
              // sets come live from api.pokemontcg.io with no registry entry to patch — only
              // its own custom ("New Set") sets are registry-backed and thus editable.
              editable={activeGame !== 'pokemon' || !!activeSet.isCustom}
              onSaved={handleSetInfoUpdated}
              onError={setActionError}
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
              onDelete={deleteCard}
              rowRefs={rowRefs.current}
              highlightedId={highlightedId}
            />
          )}
        </>
      )}
    </div>
  )
}

// One-line set metadata bar above the per-set browse table: name, release date, card count,
// code. Release date is the one field worth fixing in place (upstream sources are occasionally
// wrong or a custom set was created without one) — patches the registry's entry for
// this set via PUT /api/set-registry, which every Lorcana/Riftbound set always has (it's the
// registry-driven source of truth for their entire set list) but only custom Pokemon sets do
// (official Pokemon sets come live from api.pokemontcg.io with nothing local to patch).
function SetInfoBar({
  game, activeSet, isAdmin, editable, onSaved, onError,
}: {
  game: Game
  activeSet: SetOption
  isAdmin: boolean
  editable: boolean
  onSaved: (patch: { releaseDate?: string }) => void
  onError: (msg: string | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [releaseDate, setReleaseDate] = useState(activeSet.releaseDate || '')
  const [saving, setSaving] = useState(false)

  useEffect(() => { setReleaseDate(activeSet.releaseDate || ''); setEditing(false) }, [activeSet.name, activeSet.releaseDate])

  async function save() {
    setSaving(true)
    onError(null)
    try {
      const res = await fetch('/api/set-registry', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ game, setName: activeSet.name, patch: { releaseDate: releaseDate.trim() || null } }),
      })
      const data = await res.json()
      if (!res.ok) { onError(data.error ?? 'Failed to update set.'); return }
      onSaved({ releaseDate: releaseDate.trim() })
      setEditing(false)
    } catch (err) {
      onError(`Failed to update set: ${(err as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card-glass px-4 py-2.5 mb-3 flex items-center gap-2.5 flex-wrap text-xs">
      <span className="text-white font-medium">{activeSet.name}</span>
      <span className="text-slate-700">·</span>

      {editing ? (
        <>
          <input
            value={releaseDate}
            onChange={(e) => setReleaseDate(e.target.value)}
            placeholder="YYYY-MM-DD"
            autoFocus
            className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-200 w-32"
          />
          <button onClick={save} disabled={saving} className="text-cyan-400 hover:text-cyan-300 font-medium disabled:opacity-50 flex items-center gap-1">
            {saving && <Loader2 size={11} className="animate-spin" />} Save
          </button>
          <button onClick={() => { setEditing(false); setReleaseDate(activeSet.releaseDate || '') }} className="text-slate-500 hover:text-white">
            Cancel
          </button>
        </>
      ) : (
        <>
          <span className="text-slate-400">Released {activeSet.releaseDate || 'unknown'}</span>
          {isAdmin && editable && (
            <button onClick={() => setEditing(true)} className="flex items-center gap-1 text-slate-500 hover:text-white" title="Fix this set's release date">
              <Pencil size={11} /> Edit
            </button>
          )}
          {isAdmin && !editable && (
            <span className="text-slate-600 text-[11px]">(sourced live from the official Pokémon TCG API, not editable here)</span>
          )}
        </>
      )}

      <span className="text-slate-700">·</span>
      <span className="text-slate-500">{activeSet.cardCount ?? '?'} cards</span>
      <span className="text-slate-700">·</span>
      <span className="text-slate-500">Code: {activeSet.code}</span>
      {activeSet.isCustom && (
        <span className="text-[10px] font-bold uppercase text-violet-400 border border-violet-800 rounded px-1 py-0.5">custom</span>
      )}
    </div>
  )
}

function DetailField({ label, value, mono, truncate }: { label: string; value: string; mono?: boolean; truncate?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-slate-600 uppercase tracking-wide text-[10px]">{label}</div>
      <div className={cn('text-slate-300', mono && 'font-mono', truncate && 'truncate')} title={truncate ? value : undefined}>
        {value}
      </div>
    </div>
  )
}

function CardTable({
  game, cards, isAdmin, onToggleHide, onEdit, onDelete, rowRefs, highlightedId,
  showSetColumn, onJumpToSet, emptyMessage,
}: {
  game: Game
  cards: CatalogCard[]
  isAdmin: boolean
  onToggleHide: (id: string) => void
  onEdit: (card: CatalogCard) => void
  onDelete: (id: string) => void
  rowRefs: Map<string, HTMLTableRowElement>
  highlightedId: string | null
  showSetColumn?: boolean
  onJumpToSet?: (setName: string, cardId: string) => void
  emptyMessage?: string
}) {
  const [hoverPreviewUrl, setHoverPreviewUrl] = useState<string | null>(null)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  if (cards.length === 0) {
    return <div className="card-glass py-12 text-center text-slate-500 text-sm">{emptyMessage ?? 'No cards found for this set.'}</div>
  }

  const colSpan = showSetColumn ? 8 : 7

  return (
    <div className="card-glass overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-slate-500 text-xs uppercase tracking-wide border-b border-slate-800">
            <th className="px-2 py-2 font-medium"></th>
            <th className="px-3 py-2 font-medium">#</th>
            <th className="px-3 py-2 font-medium">Image</th>
            <th className="px-3 py-2 font-medium">Name</th>
            {showSetColumn && <th className="px-3 py-2 font-medium">Set / Released</th>}
            <th className="px-3 py-2 font-medium">Rarity</th>
            <th className="px-3 py-2 font-medium">Price</th>
            <th className="px-3 py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {cards.map((c, i) => {
            // In whole-catalog search mode, rows span multiple sets sorted oldest->newest, so
            // group dividers make more sense on a set change than a number change.
            const groupChanged = showSetColumn
              ? (i === 0 || cards[i - 1].setName !== c.setName)
              : (i === 0 || cards[i - 1].number !== c.number)
            return (
              <Fragment key={c.id}>
              <tr
                ref={(el) => { if (el) rowRefs.set(c.id, el); else rowRefs.delete(c.id) }}
                className={cn(
                  'border-b border-slate-900 transition-colors duration-500',
                  groupChanged && i > 0 && 'border-t border-slate-700',
                  highlightedId === c.id && 'bg-violet-500/20',
                  c.isHidden && 'opacity-40',
                )}
              >
                <td className="pl-3 py-2">
                  <button
                    onClick={() => toggleExpanded(c.id)}
                    className="text-slate-600 hover:text-white"
                    title={expandedIds.has(c.id) ? 'Hide details' : 'Show details (release date, IDs, and more)'}
                  >
                    {expandedIds.has(c.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                </td>
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
                  {c.imageUrl ? (
                    <img
                      src={c.imageUrl}
                      alt=""
                      className="w-8 h-11 object-cover rounded cursor-zoom-in"
                      onMouseEnter={() => setHoverPreviewUrl(c.imageUrl)}
                      onMouseLeave={() => setHoverPreviewUrl(null)}
                    />
                  ) : <div className="w-8 h-11 bg-slate-800 rounded" />}
                </td>
                <td className="px-3 py-2 text-white">
                  {c.name}
                  {c.isCustom && <span className="ml-2 text-[10px] font-bold uppercase text-violet-400 border border-violet-800 rounded px-1 py-0.5">custom</span>}
                  {c.isHidden && <span className="ml-2 text-[10px] font-bold uppercase text-slate-500 border border-slate-700 rounded px-1 py-0.5">hidden</span>}
                  {c.notes && <StickyNote size={11} className="inline ml-2 text-amber-500 align-text-top" aria-label="Has notes" />}
                </td>
                {showSetColumn && (
                  <td className="px-3 py-2">
                    <button
                      onClick={() => onJumpToSet?.(c.setName, c.id)}
                      className="block text-slate-400 hover:text-white hover:underline text-left"
                      title="Open this card in its own set"
                    >
                      {c.setName}
                    </button>
                    <span className="text-[10px] text-slate-600">{c.releaseDate || 'release date unknown'}</span>
                  </td>
                )}
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
                      {c.isCustom && (
                        <button
                          onClick={() => onDelete(c.id)}
                          className="flex items-center gap-1 text-xs text-slate-500 hover:text-red-500"
                          title="Permanently delete this custom card — cannot be undone"
                        >
                          <Trash2 size={12} /> Delete
                        </button>
                      )}
                    </div>
                  ) : null}
                </td>
              </tr>
              {expandedIds.has(c.id) && (
                <tr className="border-b border-slate-900 bg-slate-950/40">
                  <td colSpan={colSpan} className="px-6 py-3">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2 text-xs">
                      <DetailField label="Release date" value={c.releaseDate || 'unknown'} />
                      <DetailField label="Set" value={c.setName} />
                      <DetailField label="Set code" value={(c.setCode ?? c.set) || '—'} />
                      <DetailField label="Catalog ID" value={c.id} mono />
                      <DetailField label="Rarity" value={c.rarity || '—'} />
                      <DetailField label="Source" value={c.isCustom ? 'Custom (added manually)' : 'Scraped from upstream'} />
                      <DetailField label="Hidden" value={c.isHidden ? 'Yes' : 'No'} />
                      {c.publicCode && <DetailField label="Public code" value={c.publicCode} mono />}
                      {c.cardType && <DetailField label="Card type" value={c.cardType} />}
                      {c.tags && c.tags.length > 0 && <DetailField label="Tags" value={c.tags.join(', ')} />}
                      <DetailField label="Market price" value={c.marketPrice ? `$${c.marketPrice.toFixed(2)}` : '—'} />
                      <DetailField label="Foil price" value={c.marketPriceFoil ? `$${c.marketPriceFoil.toFixed(2)}` : '—'} />
                      {typeof c.lowPriceNM === 'number' && c.lowPriceNM > 0 && <DetailField label="Low price" value={`$${c.lowPriceNM.toFixed(2)}`} />}
                      {typeof c.lowPriceNMFoil === 'number' && c.lowPriceNMFoil > 0 && <DetailField label="Low price (foil)" value={`$${c.lowPriceNMFoil.toFixed(2)}`} />}
                      <DetailField label="Image URL" value={c.imageUrl || '—'} mono truncate />
                    </div>
                    {c.notes && (
                      <div className="mt-3 pt-3 border-t border-slate-800">
                        <div className="text-slate-600 uppercase tracking-wide text-[10px] mb-1">Notes / Keywords</div>
                        <div className="text-slate-300 text-xs whitespace-pre-wrap">{c.notes}</div>
                      </div>
                    )}
                  </td>
                </tr>
              )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
      {hoverPreviewUrl && typeof document !== 'undefined' && createPortal(
        // Rendered via portal straight to <body>, not inline here: this table's ancestor
        // (.card-glass) uses backdrop-blur-sm, and per the CSS spec a `backdrop-filter` on an
        // ancestor creates a new containing block for `position: fixed` descendants — so a
        // fixed element left inside this tree centers on that (possibly off-screen, scrolled)
        // container instead of the actual viewport. Escaping to <body> sidesteps that entirely.
        <div className="fixed inset-0 z-50 pointer-events-none flex items-center justify-center">
          <img
            src={hoverPreviewUrl}
            alt=""
            className="w-[380px] max-w-[80vw] max-h-[80vh] h-auto object-contain rounded-lg shadow-2xl border border-slate-700"
          />
        </div>,
        document.body,
      )}
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

// Every card image in this app renders as a small thumbnail (≤160px, see the Cardex grid —
// there's no zoom/detail view anywhere) and roughly matches what the official sources already
// provide (Pokemon's "large" ~600x825, lorcast's "small" digital variant). A photo uploaded
// straight from a phone can be 3000px+ and several MB — dead weight that's downloaded in full
// on every render everywhere (Cardex, Inventory, Portfolio, search dropdown) forever, only to
// be squeezed down by CSS. So resize once here, client-side, before the file ever reaches
// Storage — the cost is paid once at upload time instead of on every future page load.
const DISPLAY_MAX_DIM = 800
const DISPLAY_QUALITY = 0.85

// Downscales via canvas and re-encodes as WebP (universally supported by the browsers this app
// already requires for Lorcana's AVIF images — see CLAUDE.md's Lorcana image format note).
// Returns null (rather than throwing) if the browser can't do it, so callers can fall back to
// uploading the original untouched instead of failing the whole upload over this optimization.
async function resizeImageForDisplay(file: File): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, DISPLAY_MAX_DIM / Math.max(bitmap.width, bitmap.height))
    const w = Math.round(bitmap.width * scale)
    const h = Math.round(bitmap.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()
    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/webp', DISPLAY_QUALITY)
    })
  } catch {
    return null
  }
}

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
      const resized = await resizeImageForDisplay(file)
      const safeId = uploadId.replace(/[^a-zA-Z0-9_-]/g, '-')
      const storageRef = resized
        ? ref(storage, `catalog/${game}/${safeId}.webp`)
        : ref(storage, `catalog/${game}/${safeId}.${ext}`)
      await uploadBytes(storageRef, resized ?? file, { contentType: resized ? 'image/webp' : file.type })
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
        {/* Plain <img>, deliberately not next/image: this previews whatever URL the admin has
            typed/pasted so far (e.g. a manual TCGPlayer link), which can be any domain — next/image
            would throw at runtime for anything outside next.config.js's remotePatterns allowlist. */}
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
  // The real `number` field (stored on the card doc, e.g. "10/P3") can contain a "/" —
  // sanitize it here for the id only, since a "/" inside a doc() path segment breaks
  // Firestore's path splitting. The unsanitized value is still what gets saved/displayed.
  const numberSlug = String(card.number ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '')
  return `custom-${game}-${String(setCode ?? 'unknown').toLowerCase()}-${numberSlug}-${slug}`
}

function AddCardForm({
  game, activeSet, prefill, onSaved, onError, onSetInfoUpdated,
}: {
  game: Game
  activeSet: SetOption
  prefill?: Partial<CatalogCard> | null
  onSaved: () => void
  onError: (msg: string | null) => void
  onSetInfoUpdated: (patch: { releaseDate?: string }) => void
}) {
  // Only needs to be unique for the lifetime of this in-progress upload — the card's real
  // catalog id gets synthesized server-side on Save, independent of this filename.
  const [uploadId] = useState(() => `new-${Math.random().toString(36).slice(2)}`)
  const [number, setNumber] = useState(prefill?.number ?? '')
  const [name, setName] = useState(prefill?.name ?? '')
  const [rarity, setRarity] = useState(prefill?.rarity ?? '')
  const [variant, setVariant] = useState('')
  const [apiId, setApiId] = useState('')
  const [imageUrl, setImageUrl] = useState(prefill?.imageUrl ?? '')
  const [marketPrice, setMarketPrice] = useState(prefill?.marketPrice ? String(prefill.marketPrice) : '')
  const [marketPriceFoil, setMarketPriceFoil] = useState('')
  const [notes, setNotes] = useState('')
  // Release date is a SET fact, not a per-card one (see CLAUDE.md's set-registry section) — this
  // input exists here purely as a convenience so filling in a brand-new set's date doesn't
  // require a separate trip to the "Edit" button on the info bar above the table while you're
  // already here adding its first card. Saving a changed value patches the set's registry entry
  // (Firestore registry/main doc), not the card doc.
  const [releaseDate, setReleaseDate] = useState(activeSet.releaseDate || '')
  const [candidates, setCandidates] = useState<LookupCandidate[]>([])
  const [looking, setLooking] = useState(false)
  const [saving, setSaving] = useState(false)

  // Lorcana/Riftbound sets always have a registry entry (it's the source of truth for their
  // whole set list); Pokemon's official sets come live from api.pokemontcg.io with nothing local
  // to patch — only Pokemon's own custom ("New Set") sets are registry-backed.
  const setDateEditable = game !== 'pokemon' || !!activeSet.isCustom

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
      rarity: rarity || '',
      imageUrl: imageUrl || '',
      marketPrice: parseFloat(marketPrice) || 0,
      marketPriceFoil: parseFloat(marketPriceFoil) || 0,
      notes: notes.trim() || '',
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

      const trimmedDate = releaseDate.trim()
      if (setDateEditable && trimmedDate !== (activeSet.releaseDate || '')) {
        const res = await fetch('/api/set-registry', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ game, setName: activeSet.name, patch: { releaseDate: trimmedDate || null } }),
        })
        if (res.ok) onSetInfoUpdated({ releaseDate: trimmedDate })
        // A failure here shouldn't block the card save that already succeeded — the set's
        // release date can still be fixed separately via the info bar's Edit button.
      }

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
      {prefill && (
        <div className="text-xs text-cyan-400 bg-cyan-950/30 border border-cyan-900/50 rounded-lg px-2.5 py-1.5">
          Prefilled from the raw source check — double-check price/image before saving.
        </div>
      )}
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
        {setDateEditable ? (
          <input placeholder="Set release date (YYYY-MM-DD)" value={releaseDate} onChange={(e) => setReleaseDate(e.target.value)}
            title="This set's release date — saved to the set itself, not just this card"
            className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-slate-200" />
        ) : (
          <div className="flex items-center px-2 py-1.5 text-slate-600" title="Sourced live from the official Pokémon TCG API, not editable here">
            Released {activeSet.releaseDate || 'unknown'}
          </div>
        )}
        <textarea
          placeholder="Keyword notes (optional) — e.g. &quot;error card&quot;, &quot;watch for reprint&quot;"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-slate-200 col-span-2 sm:col-span-4 resize-y"
        />
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
  const [notes, setNotes] = useState(card.notes ?? '')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!number || !name) return
    setSaving(true)
    const patch: Record<string, unknown> = {
      number,
      name,
      rarity: rarity || '',
      imageUrl: imageUrl || '',
      marketPrice: parseFloat(marketPrice) || 0,
      marketPriceFoil: parseFloat(marketPriceFoil) || 0,
      notes: notes.trim() || '',
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
        <textarea
          placeholder="Keyword notes (optional) — e.g. &quot;error card&quot;, &quot;watch for reprint&quot;"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-slate-200 col-span-2 sm:col-span-4 resize-y"
        />
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

// ── New Set — registers a set in the registry (Firestore registry/main doc) ─────
// Covers two cases: a real upstream set the sync hasn't auto-detected/matched yet, and a
// wholly custom/curated set that will never come from any scraper. Either way it's created
// with tcgcsvGroupId/lorcastId left null, so a future sync never mistakes it for something it
// should be overwriting — "Add Missing Card" is how it actually gets populated afterward.

function NewSetForm({
  game, onSaved, onCancel, onError,
}: { game: Game; onSaved: (setName: string) => void; onCancel: () => void; onError: (msg: string | null) => void }) {
  // Pokemon has no Cardex/Pack Analysis integration at all (too many cards/sets — see
  // CLAUDE.md quirk #9), so a custom Pokemon set has no cardexGroup to pick; it only needs a
  // name (and optionally a code/release date) to become addable/searchable in the catalog.
  const needsCardexGroup = game !== 'pokemon'
  const [groupOrder, setGroupOrder] = useState<string[]>([])
  const [loadingGroups, setLoadingGroups] = useState(needsCardexGroup)
  const [setName, setSetName] = useState('')
  const [code, setCode] = useState('')
  const [releaseDate, setReleaseDate] = useState('')
  const [cardexGroup, setCardexGroup] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!needsCardexGroup) { setLoadingGroups(false); return }
    let stale = false
    setLoadingGroups(true)
    fetch('/api/set-registry')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (stale || !data) return
        const order: string[] = data[game]?.groupOrder ?? []
        setGroupOrder(order)
        setCardexGroup((prev) => prev || order[0] || '')
      })
      .catch(() => {})
      .finally(() => { if (!stale) setLoadingGroups(false) })
    return () => { stale = true }
  }, [game, needsCardexGroup])

  async function save() {
    if (!setName.trim()) { onError('Set name is required.'); return }
    if (needsCardexGroup && !cardexGroup) { onError('Pick a Cardex group.'); return }
    setSaving(true)
    onError(null)
    try {
      const res = await fetch('/api/set-registry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          game, setName: setName.trim(), code: code.trim(), releaseDate: releaseDate.trim(),
          ...(needsCardexGroup ? { cardexGroup } : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) { onError(data.error ?? 'Failed to create set.'); return }
      onSaved(setName.trim())
    } catch (err) {
      onError(`Failed to create set: ${(err as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card-glass p-4 mb-4 space-y-3 border-cyan-800/50">
      <div className="text-sm font-semibold text-white">Register a new {game} set</div>
      <div className="text-xs text-slate-500">
        Use this for a real set the auto-sync hasn&apos;t picked up yet, or a fully custom/curated
        set. It starts with no cards and no sync link — add cards to it with &quot;Add Missing Card&quot;.
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <input placeholder="Set name (e.g. T1 Champion Set)" value={setName} onChange={(e) => setSetName(e.target.value)}
          className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-slate-200 col-span-2" />
        <input placeholder={game === 'riftbound' ? 'Set code (e.g. T1C)' : 'Code (optional)'} value={code} onChange={(e) => setCode(e.target.value)}
          className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-slate-200" />
        <input placeholder="Release date (YYYY-MM-DD, optional)" value={releaseDate} onChange={(e) => setReleaseDate(e.target.value)}
          className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-slate-200" />
        {needsCardexGroup && (
          loadingGroups ? (
            <div className="flex items-center gap-1.5 text-slate-500"><Loader2 size={12} className="animate-spin" /> Loading groups…</div>
          ) : (
            <select
              value={cardexGroup}
              onChange={(e) => setCardexGroup(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-slate-200"
            >
              {groupOrder.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          )
        )}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={save}
          disabled={saving || loadingGroups}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-cyan-600 text-white hover:bg-cyan-500 disabled:opacity-50"
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <FolderPlus size={12} />}
          Create Set
        </button>
        <button onClick={onCancel} className="text-xs font-medium px-3 py-1.5 rounded-lg text-slate-400 hover:text-white">
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── Raw Source Check — diffs the raw TCGCSV feed + official gallery scrape against the local
// catalog, independent of the app's own matching logic, so a silently-skipped card is visible
// even if it's a matching bug (not a genuinely missing card) causing the gap. ──────────────────

interface RawSourceResult {
  setName: string
  localCardCount: number
  gallery: {
    totalFound: number
    missingFromCatalog: Array<{ id: string; name: string; number: string; publicCode?: string; rarity?: string; imageUrl?: string }>
    truncated: boolean
    error: string | null
  }
  tcgcsv: {
    groupId: number | null
    unmatchedRows: Array<{ name: string; number: string }>
    truncated: boolean
    error: string | null
  }
}

function RawSourceCheckPanel({
  setCode, onClose, onAddCandidate,
}: { setCode: string; onClose: () => void; onAddCandidate: (prefill: Partial<CatalogCard>) => void }) {
  const [result, setResult] = useState<RawSourceResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let stale = false
    setLoading(true)
    setError(null)
    fetch(`/api/admin/catalog/raw-source?game=riftbound&setCode=${encodeURIComponent(setCode)}`)
      .then(async (r) => {
        const data = await r.json()
        if (stale) return
        if (!r.ok) { setError(data.error ?? 'Raw source check failed.'); return }
        setResult(data)
      })
      .catch(() => { if (!stale) setError('Raw source check failed.') })
      .finally(() => { if (!stale) setLoading(false) })
    return () => { stale = true }
  }, [setCode])

  return (
    <div className="card-glass p-4 mb-4 space-y-4 border-cyan-800/50">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-white">Raw source check</div>
        <button onClick={onClose} className="p-1 rounded text-slate-500 hover:text-white hover:bg-slate-800">
          <X size={14} />
        </button>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-slate-500 text-sm py-4">
          <Loader2 size={16} className="animate-spin" /> Fetching TCGCSV and the official gallery…
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 text-red-400 text-xs bg-red-950/30 border border-red-900/50 rounded-lg px-3 py-2">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {result && (
        <>
          <div className="text-xs text-slate-500">
            Local catalog has <span className="text-white font-medium">{result.localCardCount}</span> cards for {result.setName}.
          </div>

          <div>
            <div className="text-xs font-semibold text-slate-300 mb-2">
              Official gallery — {result.gallery.totalFound} cards found upstream
              {result.gallery.missingFromCatalog.length > 0 && (
                <span className="text-cyan-400"> · {result.gallery.missingFromCatalog.length} not in the local catalog</span>
              )}
            </div>
            {result.gallery.error && <div className="text-xs text-red-400 mb-2">{result.gallery.error}</div>}
            {result.gallery.missingFromCatalog.length === 0 && !result.gallery.error && (
              <div className="text-xs text-emerald-400">Every card the gallery has for this set is in the local catalog.</div>
            )}
            {result.gallery.missingFromCatalog.length > 0 && (
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {result.gallery.missingFromCatalog.map((c) => (
                  <div key={c.id} className="flex items-center gap-2 text-xs bg-slate-900/60 rounded px-2 py-1.5">
                    {c.imageUrl ? <img src={c.imageUrl} alt="" className="w-6 h-8 object-cover rounded shrink-0" /> : <div className="w-6 h-8 bg-slate-800 rounded shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <div className="text-slate-200 truncate">{c.name}</div>
                      <div className="text-slate-500">#{c.number} {c.rarity ? `· ${c.rarity}` : ''} {c.publicCode ? `· ${c.publicCode}` : ''}</div>
                    </div>
                    <button
                      onClick={() => onAddCandidate({ number: c.number, name: c.name, rarity: c.rarity, imageUrl: c.imageUrl })}
                      className="shrink-0 text-[11px] font-medium text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
                    >
                      <Plus size={11} /> Add
                    </button>
                  </div>
                ))}
                {result.gallery.truncated && <div className="text-slate-600 text-[11px] px-1">Showing the first 200 — there are more.</div>}
              </div>
            )}
          </div>

          <div>
            <div className="text-xs font-semibold text-slate-300 mb-2">
              TCGCSV price feed
              {result.tcgcsv.groupId == null ? (
                <span className="text-slate-500"> — no group id registered for this set yet</span>
              ) : (
                result.tcgcsv.unmatchedRows.length > 0 && (
                  <span className="text-cyan-400"> · {result.tcgcsv.unmatchedRows.length} rows with no matching local card</span>
                )
              )}
            </div>
            {result.tcgcsv.error && <div className="text-xs text-red-400 mb-2">{result.tcgcsv.error}</div>}
            {result.tcgcsv.groupId != null && result.tcgcsv.unmatchedRows.length === 0 && !result.tcgcsv.error && (
              <div className="text-xs text-emerald-400">Every priced row in TCGCSV matches a local card by number.</div>
            )}
            {result.tcgcsv.unmatchedRows.length > 0 && (
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {result.tcgcsv.unmatchedRows.map((row, i) => (
                  <div key={i} className="text-xs bg-slate-900/60 rounded px-2 py-1.5 text-slate-300">
                    #{row.number} — {row.name}
                  </div>
                ))}
                {result.tcgcsv.truncated && <div className="text-slate-600 text-[11px] px-1">Showing the first 200 — there are more.</div>}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
