'use client'

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Search, Plus, Eye, EyeOff, Pencil, Wand2, AlertCircle, CheckCircle2, LocateFixed, FolderPlus, ScanSearch, Trash2, X, ChevronRight, ChevronDown, StickyNote, RefreshCw, ImagePlus, ZoomIn, ZoomOut } from 'lucide-react'
import {
  doc, setDoc, updateDoc, getDoc, deleteDoc, serverTimestamp, collection, query, where, getDocs, writeBatch,
} from 'firebase/firestore'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { useAuth } from '@/components/auth/AuthProvider'
import { useStore } from '@/lib/store'
import { editCard as editCardInFirestore } from '@/lib/firebase/db'
import { db, storage, ADMIN_UID } from '@/lib/firebase/config'
import { adminFetch } from '@/lib/firebase/authFetch'
import { regenerateSnapshot, normNum } from '@/lib/api/catalog'
import { getAllSyncStatuses, getSyncStatus, type SyncStatus } from '@/lib/api/syncStatus'
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

const GAMES: Game[] = ['pokemon', 'lorcana', 'riftbound', 'onepiece', 'mtg']

export default function AdminCatalogPage() {
  return (
    <AuthGuard>
      <div className="pb-20 md:pb-0">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-ink">Admin Catalog</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            Browse the full card catalog in display order. This is the shared catalog everyone&apos;s
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
  newRarities?: string[]
  totalBrokenImages?: number
  newlyBrokenImages?: number
  newlyFixedImages?: number
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
  { game: 'onepiece', label: 'One Piece' },
  { game: 'mtg', label: 'Magic: The Gathering' },
]

// Relative "how long ago" for a sync_status timestamp — short-form since it sits inline next to
// a small status line, not a full date picker.
function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.floor(ms / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  return `${Math.floor(hr / 24)}d ago`
}

function SyncPanel() {
  const { user } = useAuth()
  const isAdmin = !!user && !!ADMIN_UID && user.uid === ADMIN_UID
  const [state, setState] = useState<Record<Game, GameSyncState>>({
    pokemon: { status: 'idle' }, lorcana: { status: 'idle' }, riftbound: { status: 'idle' }, onepiece: { status: 'idle' }, mtg: { status: 'idle' },
  })
  // Last-known status per game, including from runs this session never triggered — the
  // automatic 4x/day cron, or an admin syncing from a different browser/device. Without this, a
  // failed cron run at 3am stays invisible until someone notices the catalog looks stale days
  // later; sync_status/{game} is what makes that visible here instead.
  const [lastStatus, setLastStatus] = useState<Partial<Record<Game, SyncStatus>>>({})
  const [mtgCheck, setMtgCheck] = useState<SyncStatus | null>(null)

  useEffect(() => {
    if (!isAdmin) return
    getAllSyncStatuses().then(setLastStatus).catch(() => {})
    getSyncStatus('mtg-new-set-check').then(setMtgCheck).catch(() => {})
  }, [isAdmin])

  if (!isAdmin) return null

  async function runSync(game: Game) {
    setState((s) => ({ ...s, [game]: { status: 'running' } }))
    try {
      const res = await adminFetch(`/api/sync/${game}`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setState((s) => ({ ...s, [game]: { status: 'error', error: data.error ?? `Request failed (${res.status})` } }))
        return
      }
      setState((s) => ({ ...s, [game]: { status: 'done', result: data } }))
      getSyncStatus(game).then((st) => st && setLastStatus((prev) => ({ ...prev, [game]: st }))).catch(() => {})
    } catch {
      setState((s) => ({ ...s, [game]: { status: 'error', error: 'Could not reach the server.' } }))
    }
  }

  return (
    <div className="card-glass p-5 mb-6">
      <h2 className="text-ink font-semibold mb-1">Sync Card Data</h2>
      <p className="text-slate-400 text-sm mb-4">
        Re-downloads a game&apos;s catalog and registers any newly-found sets. Each game syncs
        independently — Pokémon has by far the most sets/cards, so it can take a while.
      </p>
      <div className="space-y-3">
        {SYNC_GAMES.map(({ game, label }) => {
          const s = state[game]
          const running = s.status === 'running'
          const last = lastStatus[game]
          return (
            <div key={game} className="border-t border-slate-800 pt-3 first:border-t-0 first:pt-0">
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-ink font-medium">{label}</span>
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

              {/* Last-known status — from this session's own click, the automatic cron, or a
                  sync from another device, whichever is more recent. Shown whenever this
                  session hasn't already displayed a fresher result of its own below. Only
                  rendered when last.ok — recordSyncStatus() merges rather than replaces, so a
                  failed run's write leaves an earlier successful run's newRarities/broken-image
                  counts sitting in the doc; showing them next to a failure would look like this
                  run found them, when it never got far enough to check anything. */}
              {s.status === 'idle' && last && (
                <div className={cn('flex items-center gap-1.5 text-xs mt-2', last.ok ? 'text-slate-500' : 'text-red-600')}>
                  {last.ok ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                  <span>
                    Last sync {timeAgo(last.at)}{last.ok ? (last.setCount != null ? ` — ${last.setCount} sets` : '') : ` — failed: ${last.error}`}
                  </span>
                </div>
              )}
              {s.status === 'idle' && last?.ok && !!last.newRarities?.length && (
                <div className="text-xs text-amber-600 mt-1">
                  New rarity value{last.newRarities.length > 1 ? 's' : ''} from last sync: {last.newRarities.join(', ')} — needs a color/label in CardexPage.tsx.
                </div>
              )}
              {s.status === 'idle' && last?.ok && !!last.totalBrokenImages && (
                <div className="text-xs text-amber-600 mt-1">
                  {last.totalBrokenImages} card image{last.totalBrokenImages > 1 ? 's' : ''} still unavailable upstream (rechecked every sync).
                </div>
              )}
              {game === 'mtg' && s.status === 'idle' && mtgCheck?.ok && !!mtgCheck.newSets?.length && (
                <div className="text-xs text-amber-600 mt-1">
                  New Scryfall set{mtgCheck.newSets.length > 1 ? 's' : ''} not yet synced: {mtgCheck.newSets.join(', ')}
                </div>
              )}

              {s.status === 'error' && (
                <div className="flex items-start gap-2 text-red-600 text-xs bg-red-100/30 border border-red-200/50 rounded-lg px-3 py-2 mt-2">
                  <AlertCircle size={14} className="shrink-0 mt-0.5" />
                  <span>{s.error}</span>
                </div>
              )}

              {s.status === 'done' && s.result && (
                <div className="text-xs text-slate-400 mt-2 space-y-1">
                  <div className="flex items-center gap-1.5 text-emerald-600">
                    <CheckCircle2 size={13} />
                    <span>{s.result.setCount} sets synced</span>
                  </div>
                  {!!s.result.newSets?.length && (
                    <div>
                      New set{s.result.newSets.length > 1 ? 's' : ''} found: {s.result.newSets.join(', ')}
                      {game === 'pokemon' || game === 'mtg' ? ' — already visible in the set picker automatically.' : ' — flagged for review below.'}
                    </div>
                  )}
                  {!!s.result.newRarities?.length && (
                    <div className="text-amber-600">
                      New rarity value{s.result.newRarities.length > 1 ? 's' : ''} found: {s.result.newRarities.join(', ')} — the rarity toggle
                      already works for {s.result.newRarities.length > 1 ? 'them' : 'it'}, but needs a color/label added in CardexPage.tsx&apos;s
                      RARITY_COLORS/RARITY_LABELS_BY_GAME for full polish.
                    </div>
                  )}
                  {!!s.result.newlyFixedImages && (
                    <div className="text-emerald-600">
                      {s.result.newlyFixedImages} previously-broken card image{s.result.newlyFixedImages > 1 ? 's' : ''} now resolve upstream.
                    </div>
                  )}
                  {!!s.result.newlyBrokenImages && (
                    <div className="text-amber-600">
                      {s.result.newlyBrokenImages} new card image{s.result.newlyBrokenImages > 1 ? 's' : ''} unavailable upstream (will recheck next sync).
                    </div>
                  )}
                  {!!s.result.totalBrokenImages && (
                    <div>{s.result.totalBrokenImages} card image{s.result.totalBrokenImages > 1 ? 's' : ''} total still unavailable.</div>
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

  // useCallback (not a plain function) so the effect below can safely list it as a dependency —
  // a plain function is a fresh reference every render, which would either need omitting from
  // the deps array (the exhaustive-deps lint warning this used to have) or, if added naively,
  // re-run the effect on every render since a new function reference never equals the last one.
  const loadCards = useCallback(() => {
    if (!activeSet) return
    setLoadingCards(true)
    const setReleaseDate = activeSet.releaseDate
    fetch(`/api/admin/catalog?game=${activeGame}&set=${encodeURIComponent(activeSet.name)}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: CatalogCard[]) => setCards(data.map((c) => ({ ...c, releaseDate: setReleaseDate }))))
      .catch(() => {})
      .finally(() => setLoadingCards(false))
  }, [activeGame, activeSet])

  useEffect(() => {
    loadCards()
    setJumpName(''); setJumpNumber(''); setJumpNameMissed(false); setJumpNumberMissed(false)
  }, [loadCards])

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
      // writeBatch instead of one deleteDoc per card via Promise.all — a single commit per 450
      // cards instead of one network round-trip each (a large Pokemon set can be 250+ cards).
      const refs = snap.docs.map((d) => d.ref)
      const CHUNK = 450
      for (let i = 0; i < refs.length; i += CHUNK) {
        const batch = writeBatch(db)
        for (const ref of refs.slice(i, i + CHUNK)) batch.delete(ref)
        await batch.commit()
      }
      await regenerateSnapshot(activeGame)

      const res = await adminFetch('/api/set-registry', {
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
          className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-8 py-2.5 text-sm text-ink"
        />
        {globalQuery && (
          <button
            type="button"
            onClick={() => setGlobalQuery('')}
            title="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-ink"
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
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-ink"
          >
            <LocateFixed size={14} />
          </button>
          <input
            value={jumpName}
            onChange={(e) => handleJumpName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleJumpName(jumpName) }}
            placeholder="Jump to name…"
            className={cn(
              'bg-slate-900 border rounded-lg pl-8 pr-3 py-2 text-sm text-ink w-48',
              jumpNameMissed ? 'border-red-300' : 'border-slate-800',
            )}
          />
        </div>
        <div className="relative">
          <button
            type="button"
            onClick={() => handleJumpNumber(jumpNumber)}
            title="Jump to this number"
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-ink"
          >
            <LocateFixed size={14} />
          </button>
          <input
            value={jumpNumber}
            onChange={(e) => handleJumpNumber(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleJumpNumber(jumpNumber) }}
            placeholder="Jump to number…"
            className={cn(
              'bg-slate-900 border rounded-lg pl-8 pr-3 py-2 text-sm text-ink w-40',
              jumpNumberMissed ? 'border-red-300' : 'border-slate-800',
            )}
          />
        </div>
        {(jumpNameMissed || jumpNumberMissed) && <span className="text-xs text-red-600">No match</span>}
      </div>

      <div className="flex gap-2 mb-4">
        {GAMES.map((g) => (
          <button
            key={g}
            onClick={() => setActiveGame(g)}
            className={cn(
              'px-4 py-2 rounded-xl text-sm font-medium transition-all capitalize',
              activeGame === g ? 'text-ink' : 'bg-slate-900 text-slate-400 hover:text-ink hover:bg-slate-800',
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
            className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-ink"
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
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-red-100/40 text-red-600 hover:bg-red-100/70 disabled:opacity-50"
            title="Permanently delete this custom set and every card in it — cannot be undone"
          >
            {deletingSet ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            Delete Set
          </button>
        )}
      </div>

      {actionError && (
        <div className="flex items-start gap-2 text-red-600 text-xs bg-red-100/30 border border-red-200/50 rounded-lg px-3 py-2 mb-4">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>{actionError}</span>
        </div>
      )}

      {actionSuccess && (
        <div className="flex items-start gap-2 text-emerald-600 text-xs bg-emerald-100/30 border border-emerald-200/50 rounded-lg px-3 py-2 mb-4">
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
              // CLAUDE.md's set-registry section), so editing always works. Pokemon's and MTG's
              // official sets come live from an external API (api.pokemontcg.io / Scryfall) with
              // no registry entry to patch — only their own custom ("New Set") sets are
              // registry-backed and thus editable.
              editable={(activeGame !== 'pokemon' && activeGame !== 'mtg') || !!activeSet.isCustom}
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
      const res = await adminFetch('/api/set-registry', {
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
      <span className="text-ink font-medium">{activeSet.name}</span>
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
          <button onClick={save} disabled={saving} className="text-cyan-600 hover:text-cyan-700 font-medium disabled:opacity-50 flex items-center gap-1">
            {saving && <Loader2 size={11} className="animate-spin" />} Save
          </button>
          <button onClick={() => { setEditing(false); setReleaseDate(activeSet.releaseDate || '') }} className="text-slate-500 hover:text-ink">
            Cancel
          </button>
        </>
      ) : (
        <>
          <span className="text-slate-400">Released {activeSet.releaseDate || 'unknown'}</span>
          {isAdmin && editable && (
            <button onClick={() => setEditing(true)} className="flex items-center gap-1 text-slate-500 hover:text-ink" title="Fix this set's release date">
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
        <span className="text-[10px] font-bold uppercase text-violet-600 border border-violet-300 rounded px-1 py-0.5">custom</span>
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
                    className="text-slate-600 hover:text-ink"
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
                <td className="px-3 py-2 text-ink">
                  {c.name}
                  {c.isCustom && <span className="ml-2 text-[10px] font-bold uppercase text-violet-600 border border-violet-300 rounded px-1 py-0.5">custom</span>}
                  {c.isHidden && <span className="ml-2 text-[10px] font-bold uppercase text-slate-500 border border-slate-700 rounded px-1 py-0.5">hidden</span>}
                  {c.notes && <StickyNote size={11} className="inline ml-2 text-amber-500 align-text-top" aria-label="Has notes" />}
                </td>
                {showSetColumn && (
                  <td className="px-3 py-2">
                    <button
                      onClick={() => onJumpToSet?.(c.setName, c.id)}
                      className="block text-slate-400 hover:text-ink hover:underline text-left"
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
                        className="flex items-center gap-1 text-xs text-slate-500 hover:text-ink"
                        title="Edit this card — changes apply immediately and cascade to matching inventory"
                      >
                        <Pencil size={12} /> Edit
                      </button>
                      <button
                        onClick={() => onToggleHide(c.id)}
                        className={cn(
                          'flex items-center gap-1 text-xs',
                          c.isHidden ? 'text-slate-500 hover:text-emerald-600' : 'text-slate-500 hover:text-red-600',
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

// Every card image in this app renders as a small thumbnail in most places, but the Cardex zoom
// overlay (CardexPage.tsx's CardZoomOverlay) blows it up to `min(80vw, 300px)` at a fixed 5/7
// aspect ratio — the same ratio every card grid tile uses (Cardex, Personal Collections). A photo
// uploaded straight from a phone is framed however the photo happened to be taken, not to that
// ratio, so letting CSS `object-cover` auto-crop it at render time picks an arbitrary center-crop
// that often cuts off the top/bottom of the actual card art. The crop tool below lets the admin
// choose exactly what part of the photo fills that frame *once*, at upload time, rather than
// leaving it to chance on every future render.
const CROP_ASPECT_W = 5
const CROP_ASPECT_H = 7
const CROP_OUTPUT_H = 700
const CROP_OUTPUT_W = Math.round((CROP_OUTPUT_H * CROP_ASPECT_W) / CROP_ASPECT_H) // 500
const CROP_QUALITY = 0.85
const CROP_MAX_ZOOM = 4

function ImageUploadField({
  game, uploadId, imageUrl, onChange, onBusyChange,
}: {
  game: Game
  uploadId: string
  imageUrl: string
  onChange: (url: string) => void
  // Lets the parent form (AddCardForm/EditCardForm) disable its own Save button while an upload
  // is still in flight — without this, clicking "Use this image" then immediately "Save Changes"
  // saves whatever `imageUrl` was *before* the upload resolves (onChange(url) only fires once
  // uploadBytes()+getDownloadURL() both complete), silently discarding the crop: the photo really
  // did get uploaded to Storage, it just never got linked to the card doc.
  onBusyChange?: (busy: boolean) => void
}) {
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [cropSource, setCropSource] = useState<Blob | null>(null)
  const [fetchingExisting, setFetchingExisting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { onBusyChange?.(uploading || fetchingExisting) }, [uploading, fetchingExisting, onBusyChange])

  function pickFile(file: File) {
    setUploadError(null)
    const ext = UPLOAD_ALLOWED_TYPES[file.type]
    if (!ext) { setUploadError('Only JPEG, PNG, WebP, or AVIF images are accepted'); return }
    if (file.size > UPLOAD_MAX_BYTES) {
      setUploadError(`Image is too large (${(file.size / 1024 / 1024).toFixed(1)}MB) — max 8MB`)
      return
    }
    setCropSource(file)
  }

  // Re-opens the crop tool on whatever image is already set, without asking for a new file. The
  // browser can't draw a cross-origin image straight onto a <canvas> to crop it (missing
  // Access-Control-Allow-Origin taints the canvas — true of Firebase Storage's own download URLs,
  // not just third-party ones, confirmed with `curl -I`), so this fetches the bytes through
  // /api/admin/catalog/image-proxy (same-origin from the browser's perspective) instead of
  // loading `imageUrl` directly into an <img> for the crop source.
  async function resizeExisting() {
    if (!imageUrl) return
    setUploadError(null)
    setFetchingExisting(true)
    try {
      const res = await adminFetch(`/api/admin/catalog/image-proxy?url=${encodeURIComponent(imageUrl)}`)
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || `Request failed (${res.status})`)
      }
      setCropSource(await res.blob())
    } catch (err) {
      setUploadError(`Couldn't load the current image to resize: ${(err as Error).message}`)
    } finally {
      setFetchingExisting(false)
    }
  }

  async function uploadCropped(blob: Blob) {
    setUploading(true)
    setUploadError(null)
    try {
      const safeId = uploadId.replace(/[^a-zA-Z0-9_-]/g, '-')
      const storageRef = ref(storage, `catalog/${game}/${safeId}.webp`)
      await uploadBytes(storageRef, blob, { contentType: 'image/webp' })
      const url = await getDownloadURL(storageRef)
      onChange(url)
      setCropSource(null)
    } catch (err) {
      setUploadError(`Upload failed: ${(err as Error).message}`)
    } finally {
      setUploading(false)
    }
  }

  // Deliberately no <input> for the URL here — the caller (AddCardForm/EditCardForm) renders
  // that as a plain field alongside its others; this component is just the image box itself,
  // sized to sit as its own column next to the field list rather than inline with them.
  return (
    <div className="w-40 sm:w-44 shrink-0 mx-auto sm:mx-0 flex flex-col gap-2">
      {/* Plain <img>, deliberately not next/image: this previews whatever URL is set so far
          (e.g. a pasted TCGPlayer link), which can be any domain — next/image would throw at
          runtime for anything outside next.config.js's remotePatterns allowlist. */}
      <div
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          const f = e.dataTransfer.files?.[0]
          if (f) pickFile(f)
        }}
        className={cn(
          'group relative w-full aspect-[5/7] rounded-xl border-2 border-dashed flex items-center justify-center overflow-hidden bg-slate-950 transition-colors cursor-pointer',
          dragOver ? 'border-violet-500 bg-violet-100/30' : 'border-slate-700 hover:border-violet-400/60',
        )}
        title="Click, or drag & drop a photo, to upload and fit it to the card frame"
      >
        {uploading ? (
          <Loader2 size={24} className="animate-spin text-slate-500" />
        ) : imageUrl ? (
          <>
            <img src={imageUrl} alt="" className="w-full h-full object-cover" />
            <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/50 opacity-0 group-hover:opacity-100 transition-all">
              <span className="flex items-center gap-1.5 text-xs font-medium text-ink">
                <Pencil size={12} /> Replace
              </span>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 text-slate-600 px-4 text-center">
            <ImagePlus size={28} />
            <span className="text-[11px] leading-tight">Drag &amp; drop a photo, or click to upload</span>
          </div>
        )}
      </div>
      {imageUrl && (
        <button
          type="button"
          onClick={resizeExisting}
          disabled={fetchingExisting || uploading}
          className="w-full flex items-center justify-center gap-1.5 text-xs font-medium py-2 rounded-lg bg-slate-800 text-slate-300 hover:bg-violet-600 hover:text-white transition-colors disabled:opacity-50"
          title="Reposition and zoom the current image to better fit the card frame — no re-upload needed"
        >
          {fetchingExisting ? <Loader2 size={13} className="animate-spin" /> : <ZoomIn size={13} />}
          Resize
        </button>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) pickFile(f); e.target.value = '' }}
      />
      {uploadError && <div className="text-[10.5px] text-red-600 text-center leading-tight">{uploadError}</div>}
      {cropSource && (
        <ImageCropModal source={cropSource} uploading={uploading} onCancel={() => setCropSource(null)} onConfirm={uploadCropped} />
      )}
    </div>
  )
}

// Drag-to-pan / slider-to-zoom cropper — a full-screen takeover, the same "the tool IS the
// screen" treatment as the Cardex zoom overlay (CardZoomOverlay in this file's sibling
// CardexPage.tsx), not a small floating dialog. A fixed-size dialog box was tried first and
// shipped two real problems in a row: too small to see the card clearly, and on a short browser
// window the footer buttons could end up entirely below the viewport with no way to reach them
// (the backdrop is `fixed`, so page-scrolling never moves it, and centering a too-tall flex child
// clips it top AND bottom). Full-screen with a pinned header/footer sidesteps both at once: the
// crop frame gets the full remaining height of the screen to work with (so it's always as big as
// it can be), and the footer controls are laid out in normal flow below it — never scrolled away,
// never off-screen, since the header+footer heights are subtracted from the frame's available
// space rather than competing with it inside one scrollable box.
//
// The frame's on-screen size is therefore responsive (CSS `h-full`/`aspect-[5/7]`, not a fixed
// px constant) and measured via ResizeObserver into `frameSize` — every bit of the crop math
// (base scale, pan clamping, and the final crop rect) reads that measured size instead of a
// hardcoded width/height, so it stays correct at any window size or on rotation.
const CROP_ZOOM_STEP = 0.25

function ImageCropModal({
  source, uploading, onCancel, onConfirm,
}: { source: Blob; uploading: boolean; onCancel: () => void; onConfirm: (blob: Blob) => void }) {
  const [src] = useState(() => URL.createObjectURL(source))
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [zoom, setZoom] = useState(1)
  // The zoom % text field's own displayed string, deliberately NOT derived straight from `zoom`
  // on every keystroke — clamping (and therefore re-rendering the controlled value) on every
  // single character typed makes typing a 2+ digit number nearly impossible: typing "150" one
  // key at a time hits "1" first, which parses to 1% and instantly clamps up to the 100% floor,
  // snapping the field back to "100" before the "5" or "0" is ever entered. This mirrors how any
  // "type a number with a min/max" field should work: let the text be whatever's typed, and only
  // parse+clamp+apply on blur or Enter (see commitZoomText/onKeyDown below) — never mid-keystroke.
  const [zoomText, setZoomText] = useState('100')
  const zoomInputFocused = useRef(false)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [frameSize, setFrameSize] = useState({ w: 280, h: 392 }) // fallback until measured
  const imgRef = useRef<HTMLImageElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startX: number; startY: number; startOffset: { x: number; y: number } } | null>(null)

  useEffect(() => () => URL.revokeObjectURL(src), [src])

  // Keeps the text field showing the current zoom whenever it changes from anywhere ELSE (the
  // slider, the +/- buttons, scroll/pinch) — but never while the field itself has focus, so it
  // doesn't fight live typing.
  useEffect(() => {
    if (!zoomInputFocused.current) setZoomText(String(Math.round(zoom * 100)))
  }, [zoom])

  function commitZoomText(raw: string) {
    const pct = parseInt(raw, 10)
    const next = isNaN(pct) ? zoom : Math.min(CROP_MAX_ZOOM, Math.max(1, pct / 100))
    setZoom(next)
    setZoomText(String(Math.round(next * 100)))
  }

  useLayoutEffect(() => {
    const el = frameRef.current
    if (!el) return
    const update = () => setFrameSize({ w: el.clientWidth, h: el.clientHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const baseScale = natural ? Math.max(frameSize.w / natural.w, frameSize.h / natural.h) : 1
  const displayScale = baseScale * zoom
  const displayW = natural ? natural.w * displayScale : 0
  const displayH = natural ? natural.h * displayScale : 0
  const maxOffsetX = Math.max(0, (displayW - frameSize.w) / 2)
  const maxOffsetY = Math.max(0, (displayH - frameSize.h) / 2)

  function clampOffset(o: { x: number; y: number }) {
    return {
      x: Math.min(maxOffsetX, Math.max(-maxOffsetX, o.x)),
      y: Math.min(maxOffsetY, Math.max(-maxOffsetY, o.y)),
    }
  }

  // Zooming out (or the frame itself resizing) shrinks the valid offset range — re-clamp so a
  // pan made at high zoom, or in a bigger frame, doesn't leave a gap at the edge afterward.
  useEffect(() => { setOffset((o) => clampOffset(o)) }, [zoom, natural, frameSize.w, frameSize.h]) // eslint-disable-line react-hooks/exhaustive-deps

  function handlePointerDown(e: React.PointerEvent) {
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startY: e.clientY, startOffset: offset }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  function handlePointerMove(e: React.PointerEvent) {
    if (!dragRef.current) return
    setOffset(clampOffset({
      x: dragRef.current.startOffset.x + (e.clientX - dragRef.current.startX),
      y: dragRef.current.startOffset.y + (e.clientY - dragRef.current.startY),
    }))
  }
  function handlePointerUp() { dragRef.current = null }
  function handleWheel(e: React.WheelEvent) {
    e.preventDefault()
    setZoom((z) => Math.min(CROP_MAX_ZOOM, Math.max(1, z - e.deltaY * 0.0015)))
  }

  function confirm() {
    const el = imgRef.current
    if (!el || !natural) return
    const canvas = document.createElement('canvas')
    canvas.width = CROP_OUTPUT_W
    canvas.height = CROP_OUTPUT_H
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    // Invert the on-screen positioning math to find which rectangle of the *original* photo
    // (in its natural pixel coordinates) is currently visible inside the frame.
    const srcW = frameSize.w / displayScale
    const srcH = frameSize.h / displayScale
    const srcX = natural.w / 2 - (frameSize.w / 2 + offset.x) / displayScale
    const srcY = natural.h / 2 - (frameSize.h / 2 + offset.y) / displayScale
    ctx.drawImage(el, srcX, srcY, srcW, srcH, 0, 0, CROP_OUTPUT_W, CROP_OUTPUT_H)
    canvas.toBlob((blob) => { if (blob) onConfirm(blob) }, 'image/webp', CROP_QUALITY)
  }

  if (typeof document === 'undefined') return null

  // Rendered via portal straight to <body>, not inline here: this component is always mounted
  // inside AddCardForm/EditCardForm's `.card-glass` container, which uses `backdrop-blur-sm` —
  // and per the CSS spec, a `backdrop-filter` on an ancestor creates a new containing block for
  // `position: fixed` descendants. Left inline, this "full-screen" overlay actually centers on
  // that (possibly scrolled, definitely not viewport-sized) card-glass box instead of the real
  // viewport — which is exactly what shipped broken before this was portaled out. See the
  // matching fix (and same root cause) on CardTable's hover-preview portal above.
  return createPortal(
    <div className="crop-modal-backdrop fixed inset-0 z-50 bg-slate-950 flex flex-col">
      <div className="shrink-0 flex items-center justify-between px-4 sm:px-6 py-4 border-b border-slate-800">
        <div className="flex items-center gap-2 text-base font-semibold text-ink">
          <ZoomIn size={18} className="text-violet-600" />
          Fit the card to the frame
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="w-9 h-9 flex items-center justify-center rounded-full text-slate-400 hover:text-ink hover:bg-slate-800 transition-colors"
        >
          <X size={20} />
        </button>
      </div>

      <div className="flex-1 min-h-0 flex items-center justify-center p-4 sm:p-8 overflow-hidden">
        <div
          ref={frameRef}
          className="crop-modal-frame relative h-full max-h-[640px] w-auto aspect-[5/7] max-w-[92vw] rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl shadow-black/60 overflow-hidden touch-none select-none cursor-move ring-1 ring-black/40"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onWheel={handleWheel}
        >
          <img
            ref={imgRef}
            src={src}
            alt=""
            draggable={false}
            onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            className="absolute pointer-events-none max-w-none"
            style={{
              width: displayW || undefined,
              height: displayH || undefined,
              left: '50%',
              top: '50%',
              transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px)`,
            }}
          />
          {/* Rule-of-thirds guide + viewfinder corners — purely decorative, pointer-events-none so
              drag/wheel/scroll still land on the frame div's own handlers underneath. */}
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute inset-y-0 left-1/3 w-px bg-white/20" />
            <div className="absolute inset-y-0 left-2/3 w-px bg-white/20" />
            <div className="absolute inset-x-0 top-1/3 h-px bg-white/20" />
            <div className="absolute inset-x-0 top-2/3 h-px bg-white/20" />
            <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-white/80 rounded-tl-lg" />
            <div className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-white/80 rounded-tr-lg" />
            <div className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-white/80 rounded-bl-lg" />
            <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-white/80 rounded-br-lg" />
          </div>
        </div>
      </div>

      <div className="shrink-0 border-t border-slate-800 px-4 sm:px-6 py-4">
        <div className="max-w-md mx-auto w-full space-y-3">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(1, z - CROP_ZOOM_STEP))}
              className="shrink-0 w-9 h-9 flex items-center justify-center rounded-full bg-slate-800 text-slate-300 hover:bg-violet-600 hover:text-white transition-colors"
              title="Zoom out"
            >
              <ZoomOut size={16} />
            </button>
            <input
              type="range"
              min={1}
              max={CROP_MAX_ZOOM}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(parseFloat(e.target.value))}
              className="flex-1 accent-violet-600 cursor-pointer"
            />
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(CROP_MAX_ZOOM, z + CROP_ZOOM_STEP))}
              className="shrink-0 w-9 h-9 flex items-center justify-center rounded-full bg-slate-800 text-slate-300 hover:bg-violet-600 hover:text-white transition-colors"
              title="Zoom in"
            >
              <ZoomIn size={16} />
            </button>
            <div className="shrink-0 flex items-center gap-0.5 bg-slate-950 border border-slate-800 rounded-lg pl-2.5 pr-2 py-1.5">
              <input
                type="number"
                min={100}
                max={Math.round(CROP_MAX_ZOOM * 100)}
                step={5}
                value={zoomText}
                onFocus={() => { zoomInputFocused.current = true }}
                onChange={(e) => setZoomText(e.target.value)}
                onBlur={(e) => { zoomInputFocused.current = false; commitZoomText(e.target.value) }}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return
                  commitZoomText(e.currentTarget.value)
                  e.currentTarget.blur()
                }}
                className="w-10 bg-transparent text-right text-sm text-slate-200 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <span className="text-sm text-slate-500">%</span>
            </div>
          </div>
          <div className="text-xs text-slate-500 text-center">Drag the photo to reposition it — scroll, pinch, or zoom above.</div>
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onCancel}
              disabled={uploading}
              className="btn-secondary justify-center py-2.5 disabled:opacity-50"
              title={uploading ? 'Upload in progress — the crop can no longer be discarded' : undefined}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={uploading || !natural}
              className="btn-primary justify-center py-2.5 disabled:opacity-50"
            >
              {uploading && <Loader2 size={14} className="animate-spin" />}
              Use this image
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// Shared by AddCardForm/EditCardForm's field lists — a slightly bigger, rounder, focus-styled
// take on the plain "bg-slate-950 border ..." classes the rest of this file's compact admin
// tables use, since these two forms are more of a "fill out a card" experience than a data grid.
const FIELD_CLASS = 'bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-slate-200 outline-none transition-colors focus:border-violet-600'

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
  const [imageBusy, setImageBusy] = useState(false)

  // Lorcana/Riftbound sets always have a registry entry (it's the source of truth for their
  // whole set list); Pokemon's and MTG's official sets come live from an external API
  // (api.pokemontcg.io / Scryfall) with nothing local to patch — only their own custom
  // ("New Set") sets are registry-backed.
  const setDateEditable = (game !== 'pokemon' && game !== 'mtg') || !!activeSet.isCustom

  async function runLookup() {
    setLooking(true)
    onError(null)
    try {
      const res = await adminFetch('/api/admin/catalog/lookup', {
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
    if (imageBusy) { onError('Still uploading the image — wait for it to finish before saving.'); return }
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
      // Reuse the real official id when we have one (e.g. Pokemon's apiId, or MTG's Scryfall
      // UUID) so the card behaves identically to a normally-scraped one; otherwise the add route
      // synthesizes one.
      ...((game === 'pokemon' || game === 'mtg') && apiId ? { id: apiId } : {}),
    }
    try {
      // Reuse a real external id when we have one (e.g. a genuine Pokemon/MTG apiId) so the card
      // behaves identically to a normally-scraped one; otherwise synthesize a placeholder.
      const id = typeof card.id === 'string' && card.id ? card.id : synthesizeId(game, card, variant)
      const cardRef = doc(db, 'catalog', game, 'cards', id)
      const existing = await getDoc(cardRef)
      if (existing.exists()) { onError(`A custom card with id "${id}" already exists`); return }

      await setDoc(cardRef, { ...card, id, hidden: false, source: 'manual', updatedAt: serverTimestamp() })
      await regenerateSnapshot(game)

      const trimmedDate = releaseDate.trim()
      if (setDateEditable && trimmedDate !== (activeSet.releaseDate || '')) {
        const res = await adminFetch('/api/set-registry', {
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
    <div className="card-glass p-5 mb-4">
      <div className="text-sm font-semibold text-ink">Add a card missing from {activeSet.name}</div>
      {prefill && (
        <div className="text-xs text-cyan-600 bg-cyan-100/30 border border-cyan-200/50 rounded-lg px-2.5 py-1.5 mt-2">
          Prefilled from the raw source check — double-check price/image before saving.
        </div>
      )}
      <div className="flex flex-col-reverse sm:flex-row gap-5 mt-4">
        <div className="flex-1 min-w-0 space-y-2.5 text-xs">
          <div className="flex gap-2">
            <input placeholder="No." value={number} onChange={(e) => setNumber(e.target.value)}
              className={cn(FIELD_CLASS, 'w-16 shrink-0')} title="Collector number (e.g. 21b)" />
            <input placeholder="Rarity" value={rarity} onChange={(e) => setRarity(e.target.value)}
              className={cn(FIELD_CLASS, 'flex-1 min-w-0')} />
            <input placeholder="Variant (e.g. showcase)" value={variant} onChange={(e) => setVariant(e.target.value)}
              className={cn(FIELD_CLASS, 'flex-1 min-w-0')} />
          </div>
          <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)}
            className={cn(FIELD_CLASS, 'w-full')} />
          {(game === 'pokemon' || game === 'mtg') && (
            <input
              placeholder={game === 'mtg' ? 'Official Scryfall id (UUID, optional)' : 'Official apiId (e.g. sv7-1)'}
              value={apiId} onChange={(e) => setApiId(e.target.value)}
              className={cn(FIELD_CLASS, 'w-full')} />
          )}
          <input placeholder="Image URL (paste a link, or use the box →)" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)}
            className={cn(FIELD_CLASS, 'w-full')} />
          <div className="flex gap-2">
            <input placeholder="Price" value={marketPrice} onChange={(e) => setMarketPrice(e.target.value)}
              className={cn(FIELD_CLASS, 'flex-1 min-w-0')} />
            <input placeholder="Foil price" value={marketPriceFoil} onChange={(e) => setMarketPriceFoil(e.target.value)}
              className={cn(FIELD_CLASS, 'flex-1 min-w-0')} />
          </div>
          {setDateEditable ? (
            <input placeholder="Set release date (YYYY-MM-DD)" value={releaseDate} onChange={(e) => setReleaseDate(e.target.value)}
              title="This set's release date — saved to the set itself, not just this card"
              className={cn(FIELD_CLASS, 'w-full')} />
          ) : (
            <div className="flex items-center px-2.5 py-2 text-slate-600" title="Sourced live from the official Pokémon TCG API, not editable here">
              Released {activeSet.releaseDate || 'unknown'}
            </div>
          )}
          <textarea
            placeholder="Keyword notes (optional) — e.g. &quot;error card&quot;, &quot;watch for reprint&quot;"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className={cn(FIELD_CLASS, 'w-full resize-y')}
          />
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={runLookup}
              disabled={looking || !number}
              className="flex items-center gap-1.5 text-xs font-medium px-3.5 py-2 rounded-lg bg-cyan-600/20 text-cyan-700 hover:bg-cyan-600/30 disabled:opacity-50"
            >
              {looking ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
              Auto-fetch price &amp; image
            </button>
            <button
              onClick={save}
              disabled={saving || imageBusy}
              title={imageBusy ? 'Waiting for the image to finish uploading…' : undefined}
              className="flex items-center gap-1.5 text-xs font-medium px-3.5 py-2 rounded-lg bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-50"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
              Save to catalog
            </button>
            {imageBusy && (
              <span className="flex items-center gap-1.5 text-xs text-slate-500">
                <Loader2 size={12} className="animate-spin" /> Uploading image…
              </span>
            )}
          </div>
        </div>
        <ImageUploadField game={game} uploadId={uploadId} imageUrl={imageUrl} onChange={setImageUrl} onBusyChange={setImageBusy} />
      </div>

      {candidates.length > 0 && (
        <div className="space-y-1.5 mt-4">
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
  const [imageBusy, setImageBusy] = useState(false)

  async function save() {
    if (!number || !name || imageBusy) return
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
    <div className="card-glass p-5 mb-4 border-violet-300/50">
      <div className="text-sm font-semibold text-ink">
        Editing &quot;{card.name}&quot; · {card.publicCode ?? card.number}
      </div>
      <div className="text-xs text-slate-500 mt-1 mb-4">
        Changes apply immediately and cascade to any inventory entries with this apiId
        (number, name, image only — never price).
      </div>
      <div className="flex flex-col-reverse sm:flex-row gap-5">
        <div className="flex-1 min-w-0 space-y-2.5 text-xs">
          <div className="flex gap-2">
            <input placeholder="No." value={number} onChange={(e) => setNumber(e.target.value)}
              className={cn(FIELD_CLASS, 'w-16 shrink-0')} title="Collector number (e.g. 21b)" />
            <input placeholder="Rarity" value={rarity} onChange={(e) => setRarity(e.target.value)}
              className={cn(FIELD_CLASS, 'flex-1 min-w-0')} />
          </div>
          <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)}
            className={cn(FIELD_CLASS, 'w-full')} />
          <input placeholder="Image URL (paste a link, or use the box →)" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)}
            className={cn(FIELD_CLASS, 'w-full')} />
          <div className="flex gap-2">
            <input placeholder="Price" value={marketPrice} onChange={(e) => setMarketPrice(e.target.value)}
              className={cn(FIELD_CLASS, 'flex-1 min-w-0')} />
            <input placeholder="Foil price" value={marketPriceFoil} onChange={(e) => setMarketPriceFoil(e.target.value)}
              className={cn(FIELD_CLASS, 'flex-1 min-w-0')} />
          </div>
          <textarea
            placeholder="Keyword notes (optional) — e.g. &quot;error card&quot;, &quot;watch for reprint&quot;"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className={cn(FIELD_CLASS, 'w-full resize-y')}
          />
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={save}
              disabled={saving || imageBusy}
              title={imageBusy ? 'Waiting for the image to finish uploading…' : undefined}
              className="flex items-center gap-1.5 text-xs font-medium px-3.5 py-2 rounded-lg bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-50"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Pencil size={12} />}
              Save Changes
            </button>
            <button
              onClick={onCancel}
              className="text-xs font-medium px-3.5 py-2 rounded-lg text-slate-400 hover:text-ink"
            >
              Cancel
            </button>
            {imageBusy && (
              <span className="flex items-center gap-1.5 text-xs text-slate-500">
                <Loader2 size={12} className="animate-spin" /> Uploading image…
              </span>
            )}
          </div>
        </div>
        <ImageUploadField game={game} uploadId={card.id} imageUrl={imageUrl} onChange={setImageUrl} onBusyChange={setImageBusy} />
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
  // Pokemon, One Piece, and MTG all derive their Cardex groups automatically (Pokemon: live
  // `series` field; One Piece: set-code prefix; MTG: Scryfall's `set_type` — see CLAUDE.md quirk
  // #9), so a custom set in any of them has no cardexGroup to pick; it only needs a name (and
  // optionally a code/release date) to become addable/searchable in the catalog.
  const needsCardexGroup = game !== 'pokemon' && game !== 'onepiece' && game !== 'mtg'
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
      const res = await adminFetch('/api/set-registry', {
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
    <div className="card-glass p-4 mb-4 space-y-3 border-cyan-300/50">
      <div className="text-sm font-semibold text-ink">Register a new {game} set</div>
      <div className="text-xs text-slate-500">
        Use this for a real set the auto-sync hasn&apos;t picked up yet, or a fully custom/curated
        set. It starts with no cards and no sync link — add cards to it with &quot;Add Missing Card&quot;.
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <input placeholder="Set name (e.g. T1 Champion Set)" value={setName} onChange={(e) => setSetName(e.target.value)}
          className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-slate-200 col-span-2" />
        <input placeholder={game === 'riftbound' ? 'Set code (e.g. T1C)' : game === 'onepiece' ? 'Code (e.g. OP01, optional)' : game === 'mtg' ? 'Scryfall set code (e.g. khm, optional)' : 'Code (optional)'} value={code} onChange={(e) => setCode(e.target.value)}
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
        <button onClick={onCancel} className="text-xs font-medium px-3 py-1.5 rounded-lg text-slate-400 hover:text-ink">
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
    <div className="card-glass p-4 mb-4 space-y-4 border-cyan-300/50">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-ink">Raw source check</div>
        <button onClick={onClose} className="p-1 rounded text-slate-500 hover:text-ink hover:bg-slate-800">
          <X size={14} />
        </button>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-slate-500 text-sm py-4">
          <Loader2 size={16} className="animate-spin" /> Fetching TCGCSV and the official gallery…
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 text-red-600 text-xs bg-red-100/30 border border-red-200/50 rounded-lg px-3 py-2">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {result && (
        <>
          <div className="text-xs text-slate-500">
            Local catalog has <span className="text-ink font-medium">{result.localCardCount}</span> cards for {result.setName}.
          </div>

          <div>
            <div className="text-xs font-semibold text-slate-300 mb-2">
              Official gallery — {result.gallery.totalFound} cards found upstream
              {result.gallery.missingFromCatalog.length > 0 && (
                <span className="text-cyan-600"> · {result.gallery.missingFromCatalog.length} not in the local catalog</span>
              )}
            </div>
            {result.gallery.error && <div className="text-xs text-red-600 mb-2">{result.gallery.error}</div>}
            {result.gallery.missingFromCatalog.length === 0 && !result.gallery.error && (
              <div className="text-xs text-emerald-600">Every card the gallery has for this set is in the local catalog.</div>
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
                      className="shrink-0 text-[11px] font-medium text-cyan-600 hover:text-cyan-700 flex items-center gap-1"
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
                  <span className="text-cyan-600"> · {result.tcgcsv.unmatchedRows.length} rows with no matching local card</span>
                )
              )}
            </div>
            {result.tcgcsv.error && <div className="text-xs text-red-600 mb-2">{result.tcgcsv.error}</div>}
            {result.tcgcsv.groupId != null && result.tcgcsv.unmatchedRows.length === 0 && !result.tcgcsv.error && (
              <div className="text-xs text-emerald-600">Every priced row in TCGCSV matches a local card by number.</div>
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
