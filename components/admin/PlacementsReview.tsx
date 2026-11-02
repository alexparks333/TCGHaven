'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Loader2, Check, Plus, X, ChevronLeft, ChevronRight, ExternalLink, Ban, FolderInput, Sparkles,
  RotateCcw, Pencil, Undo2, Clock, ArrowLeft,
} from 'lucide-react'
import { adminFetch } from '@/lib/firebase/authFetch'
import { cardImage, NO_CARD_IMAGE } from '@/lib/cardImage'
import { cn, formatCurrency } from '@/lib/utils'

// New TCGplayer cards (staff portal → Needs Review): every Riftbound sync places promos and other
// TCGplayer-only products into the set it thinks they belong to (catalog-sync.mjs's
// discoverRiftboundProducts()). Each sync's finds are one review "node" (placements share that
// sync's `addedAt`); opening one shows its board: a sidebar of where cards landed, a grid of the
// cards, and a card viewer to go through them one at a time. Every card gets one of three answers:
//
//   Accept — it's right (in the set picked)
//   Ignore — not sure yet: hidden for now, and the next sync offers it again (maybe with a photo)
//   Deny   — don't use it: hidden, and syncs never offer it again (recoverable from Denied)
//
// Writes go through POST /api/set-registry/placements, which updates the catalog card at once.

interface Placement {
  productId: number
  groupId: number
  groupName?: string
  name: string
  number: string
  setName: string | null
  auto: boolean
  reviewed: boolean
  addedAt: string
  denied?: boolean
  ignored?: boolean
  previousSetName?: string | null
  displayName?: string
  image?: ImageChoice
}

type ImageChoice = 'tcgplayer' | 'riot' | 'none'

interface RegistrySet {
  setName: string
  cardexGroup: string | null
}

interface RegistryResponse {
  riftbound: { groupOrder: string[]; sets: RegistrySet[]; placements?: Placement[] }
}

interface CatalogCard {
  id: string
  name?: string
  publicCode?: string
  imageUrl?: string
  marketPrice?: number
}

type Change = { productId: number; setName?: string | null; reviewed?: boolean; denied?: boolean; ignored?: boolean; displayName?: string; image?: ImageChoice | 'auto' }

const ALL = '__all__'
const LEFT_OUT = '__left_out__'
const DENIED = '__denied__'
const IGNORED = '__ignored__'
const ACCENT = '#b5532f' // Riftbound

const tcgPhotoUrl = (productId: number) => `https://tcgplayer-cdn.tcgplayer.com/product/${productId}_in_1000x1000.jpg`
// "Riftbound Organized Play Promotional Cards" → "Organized Play"
const sourceLabel = (p: Placement) =>
  (p.groupName ?? '').replace(/^riftbound:?\s*/i, '').replace(/promotional cards/i, '').trim() || 'Promo'
const numberSortKey = (n: string) => parseInt(n.replace(/^\D+/, ''), 10) || 0
// Denied = staff don't want the card (hidden, never re-added by a sync). A card left out before
// Deny existed (no set, already reviewed) counts too; an unreviewed one with no set is one the
// sync couldn't place.
const isDenied = (p: Placement) => !p.ignored && (!!p.denied || (p.setName === null && p.reviewed))
const isDone = (p: Placement) => p.reviewed || isDenied(p) || !!p.ignored
const syncTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

// The change that puts a placement back how it was (for Undo).
function restoreChange(prev: Placement, now: Placement): Change {
  const c: Change = { productId: prev.productId, reviewed: prev.reviewed }
  if (!!prev.ignored !== !!now.ignored) c.ignored = !!prev.ignored
  if (isDenied(prev) && !isDenied(now)) c.denied = true
  else if (!isDenied(prev) && isDenied(now)) { c.denied = false; c.setName = prev.setName }
  else if (prev.setName !== now.setName) c.setName = prev.setName
  if ((prev.displayName ?? '') !== (now.displayName ?? '')) c.displayName = prev.displayName ?? ''
  if ((prev.image ?? 'auto') !== (now.image ?? 'auto')) c.image = prev.image ?? 'auto'
  return c
}

// The same change the server makes (app/api/set-registry/placements/route.ts), applied locally
// so the board updates the moment you click; the server's answer then replaces it.
function applyLocal(p: Placement, c: Change): Placement {
  const n = { ...p }
  if (c.ignored === true && !n.ignored) { n.ignored = true; n.reviewed = false }
  else if (n.ignored && (c.ignored === false || c.reviewed === true || c.setName !== undefined || c.denied !== undefined)) n.ignored = false
  if (c.denied === true && !n.denied) { n.previousSetName = n.setName; n.setName = null; n.denied = true; n.reviewed = true; n.auto = false }
  else if (c.denied === false && (n.denied || n.setName === null)) {
    n.denied = false; n.setName = c.setName !== undefined ? c.setName : n.previousSetName ?? null; delete n.previousSetName; n.reviewed = false; n.auto = false
  } else if (c.setName !== undefined && c.setName !== n.setName) { n.setName = c.setName; n.denied = false; n.auto = false }
  if (c.displayName !== undefined) {
    if (c.displayName.trim() && c.displayName.trim() !== defaultCardName(n.name)) n.displayName = c.displayName.trim()
    else delete n.displayName
  }
  if (c.image !== undefined) { if (c.image === 'auto') delete n.image; else n.image = c.image }
  if (c.reviewed !== undefined) n.reviewed = c.reviewed
  return n
}

// What an action did, for the Undo toast.
function describe(changes: Change[]): string {
  const n = changes.length
  const cards = n === 1 ? 'card' : `${n} cards`
  const c = changes[0]
  if (c.ignored === true) return `Ignored ${cards} — back next sync`
  if (c.ignored === false) return `Un-ignored ${cards}`
  if (c.denied === true) return `Denied ${cards}`
  if (c.denied === false) return `Recovered ${cards}`
  if (c.displayName !== undefined) return c.displayName ? `Renamed to “${c.displayName}”` : 'Name reset'
  if (c.image !== undefined) return c.image === 'none' ? 'Picture removed' : c.image === 'tcgplayer' ? 'Using the TCGplayer photo' : c.image === 'riot' ? 'Using Riot’s art' : 'Picture back to automatic'
  if (c.setName !== undefined) return c.reviewed ? `Accepted ${cards} into ${c.setName}` : `Moved ${cards} to ${c.setName ?? 'nowhere'}`
  if (c.reviewed === false) return `Marked ${cards} not reviewed`
  return `Accepted ${cards}`
}

// Same as placementDefaultName() in catalog-sync.mjs
export function defaultCardName(tcgplayerName: string): string {
  const base = tcgplayerName.replace(/\s*\([^)]*\)/g, '').trim()
  const parens = Array.from(tcgplayerName.matchAll(/\(([^)]*)\)/g)).map((m) => m[1].trim()).filter(Boolean)
  return `${base} (${parens.join(', ') || 'Promo'})`
}

export function PlacementsReview() {
  const [registry, setRegistry] = useState<RegistryResponse['riftbound'] | null>(null)
  const [cards, setCards] = useState<Map<string, CatalogCard>>(new Map())
  // Riot's gallery art by collector code ("013/298") — the "Riot art" picture option
  const [riotByCode, setRiotByCode] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [openBatch, setOpenBatch] = useState<string | null>(null) // a sync's addedAt
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The last action, undoable from the toast (or ⌘Z) for a few seconds
  const [undo, setUndo] = useState<{ label: string; changes: Change[]; id: number } | null>(null)
  const placementsRef = useRef<Placement[]>([])
  const cardsRef = useRef(cards)
  cardsRef.current = cards
  const riotByCodeRef = useRef(riotByCode)
  riotByCodeRef.current = riotByCode

  useEffect(() => {
    // no-store: the public GET is CDN-cached for a minute, and a review needs the current list
    Promise.all([
      fetch('/api/set-registry', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)),
      // The catalog copy of each placed card (`tcg-{productId}`) — its art is Riot's when
      // TCGplayer has no photo yet, plus its price.
      fetch('/api/admin/catalog?game=riftbound').then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([reg, catalog]: [RegistryResponse | null, CatalogCard[]]) => {
        setRegistry(reg?.riftbound ?? null)
        const list = Array.isArray(catalog) ? catalog : []
        setCards(new Map(list.filter((c) => c.id.startsWith('tcg-')).map((c) => [c.id, c])))
        const riot = new Map<string, string>()
        for (const c of list) {
          const code = (c.publicCode ?? '').split('-').slice(1).join('-')
          if (!c.id.startsWith('tcg-') && code && c.imageUrl?.includes('rgpub') && !riot.has(code)) riot.set(code, c.imageUrl)
        }
        setRiotByCode(riot)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const placements = useMemo(() => registry?.placements ?? [], [registry])
  placementsRef.current = placements
  // One node per sync that found cards, newest first.
  const batches = useMemo(() => {
    const m = new Map<string, Placement[]>()
    for (const p of placements) m.set(p.addedAt, [...(m.get(p.addedAt) ?? []), p])
    return Array.from(m.entries()).sort(([a], [b]) => b.localeCompare(a)).map(([at, list]) => ({ at, list }))
  }, [placements])

  const save = useCallback(async (changes: Change[], { isUndo = false } = {}) => {
    if (changes.length === 0) return true
    const before = new Map(placementsRef.current.map((p) => [p.productId, { ...p }]))
    const cardsBefore = cardsRef.current
    // Show it now — the server's answer replaces this, or the old state comes back on failure.
    const byId = new Map(changes.map((c) => [c.productId, c]))
    setRegistry((r) => (r ? { ...r, placements: (r.placements ?? []).map((p) => (byId.has(p.productId) ? applyLocal(p, byId.get(p.productId)!) : p)) } : r))
    setCards((m) => {
      const next = new Map(m)
      for (const c of changes) {
        const id = `tcg-${c.productId}`
        const card = next.get(id)
        const p = before.get(c.productId)
        if (!card || !p) continue
        const upd = { ...card }
        if (c.displayName !== undefined) upd.name = c.displayName.trim() || defaultCardName(p.name)
        if (c.image === 'none') upd.imageUrl = ''
        else if (c.image === 'tcgplayer') upd.imageUrl = tcgPhotoUrl(c.productId)
        else if (c.image === 'riot') upd.imageUrl = riotByCodeRef.current.get((card.publicCode ?? '').split('-').slice(1).join('-')) ?? upd.imageUrl
        next.set(id, upd)
      }
      return next
    })
    setBusy(true)
    setError(null)
    try {
      const res = await adminFetch('/api/set-registry/placements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changes }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setRegistry((r) => (r ? { ...r, placements: data.placements } : r))
      if (isUndo) setUndo(null)
      else {
        const after = new Map((data.placements as Placement[]).map((p) => [p.productId, p]))
        const restore = changes
          .map((c) => (before.get(c.productId) && after.get(c.productId) ? restoreChange(before.get(c.productId)!, after.get(c.productId)!) : null))
          .filter((c): c is Change => !!c)
        setUndo({ label: describe(changes), changes: restore, id: Date.now() })
      }
      const images = (data.images ?? {}) as Record<string, string>
      if (Object.keys(images).length) {
        setCards((m) => {
          const next = new Map(m)
          for (const [pid, url] of Object.entries(images)) {
            const card = next.get(`tcg-${pid}`)
            if (card) next.set(card.id, { ...card, imageUrl: url })
          }
          return next
        })
      }
      const renamed = changes.filter((c) => c.displayName !== undefined)
      if (renamed.length) {
        setCards((m) => {
          const next = new Map(m)
          for (const c of renamed) {
            const p = (data.placements as Placement[]).find((x) => x.productId === c.productId)
            const card = next.get(`tcg-${c.productId}`)
            if (p && card) next.set(card.id, { ...card, name: p.displayName ?? defaultCardName(p.name) })
          }
          return next
        })
      }
      return true
    } catch (err) {
      setError(`Couldn't save — put back how it was. (${(err as Error).message})`)
      setRegistry((r) => (r ? { ...r, placements: (r.placements ?? []).map((p) => before.get(p.productId) ?? p) } : r))
      setCards(cardsBefore)
      return false
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    if (!undo) return
    const t = setTimeout(() => setUndo((u) => (u?.id === undo.id ? null : u)), 10000)
    return () => clearTimeout(t)
  }, [undo])
  const runUndo = useCallback(() => { if (undo && !busy) save(undo.changes, { isUndo: true }) }, [undo, busy, save])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !(e.target as HTMLElement)?.closest('input, textarea')) {
        e.preventDefault()
        runUndo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [runUndo])

  async function createSet(name: string, cardexGroup: string, isNewCategory: boolean): Promise<boolean> {
    setBusy(true)
    setError(null)
    try {
      const res = await adminFetch('/api/set-registry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ game: 'riftbound', setName: name, cardexGroup, newCardexGroup: isNewCategory }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setRegistry((r) => (r ? {
        ...r,
        groupOrder: isNewCategory && !r.groupOrder.includes(cardexGroup) ? [...r.groupOrder, cardexGroup] : r.groupOrder,
        sets: [...r.sets, { setName: name, cardexGroup }],
      } : r))
      return true
    } catch (err) {
      setError((err as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="card-glass p-5 flex items-center gap-2 text-slate-500 text-sm">
        <Loader2 size={14} className="animate-spin" /> Loading syncs…
      </div>
    )
  }
  if (!registry || batches.length === 0) return null

  const open = batches.find((b) => b.at === openBatch) ?? null

  return (
    <>
      <section className="card-glass p-5">
        <div className="flex items-center gap-2 mb-1">
          <Sparkles size={18} style={{ color: ACCENT }} />
          <h2 className="text-lg font-bold text-ink">New cards found by syncs</h2>
        </div>
        <p className="text-slate-400 text-sm mb-4">Each sync that found new TCGplayer cards waits here. Open one to accept, ignore or deny its cards.</p>
        <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(300px,1fr))]">
          {batches.map((b) => (
            <BatchNode key={b.at} at={b.at} list={b.list} cards={cards} onOpen={() => setOpenBatch(b.at)} />
          ))}
        </div>
      </section>

      {open && (
        <ReviewBoard
          key={open.at}
          at={open.at}
          placements={open.list}
          registry={registry}
          cards={cards}
          riotByCode={riotByCode}
          busy={busy}
          error={error}
          save={save}
          createSet={createSet}
          onClose={() => setOpenBatch(null)}
        />
      )}

      {undo && createPortal(
        <div key={undo.id} className="fixed left-1/2 -translate-x-1/2 bottom-5 z-[70] flex items-center gap-3 rounded-2xl bg-[#2a2018] text-[#f3e8d2] shadow-2xl pl-4 pr-2 py-2 border border-black/20">
          <Check size={14} className="text-emerald-400 shrink-0" />
          <span className="text-sm whitespace-nowrap">{undo.label}</span>
          <button disabled={busy} onClick={runUndo} className="text-xs font-semibold px-3 py-1.5 rounded-xl bg-white/15 hover:bg-white/25 flex items-center gap-1.5 disabled:opacity-50" title="Undo (⌘Z)">
            <Undo2 size={13} /> Undo
          </button>
          <button onClick={() => setUndo(null)} className="p-1.5 rounded-lg hover:bg-white/10" title="Dismiss"><X size={13} /></button>
        </div>,
        document.body,
      )}
    </>
  )
}

// One sync's finds, as a node on Needs Review.
function BatchNode({ at, list, cards, onOpen }: { at: string; list: Placement[]; cards: Map<string, CatalogCard>; onOpen: () => void }) {
  const done = list.filter(isDone).length
  const accepted = list.filter((p) => p.reviewed && !isDenied(p) && !p.ignored).length
  const ignored = list.filter((p) => p.ignored).length
  const denied = list.filter(isDenied).length
  const complete = done === list.length
  const pct = Math.round((done / list.length) * 100)
  const previews = list.filter((p) => !isDone(p)).concat(list.filter(isDone)).slice(0, 5)
  return (
    <button
      onClick={onOpen}
      className={cn(
        'group text-left rounded-2xl border p-4 transition-all hover:-translate-y-0.5 hover:shadow-lg',
        complete ? 'border-slate-800 bg-slate-900/30' : 'border-slate-700 bg-slate-900/60',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded text-white" style={{ background: ACCENT }}>Riftbound</span>
            {complete
              ? <span className="text-[11px] font-semibold text-emerald-700 flex items-center gap-1"><Check size={12} /> Done</span>
              : <span className="text-[11px] font-semibold" style={{ color: ACCENT }}>{list.length - done} to review</span>}
          </div>
          <div className="text-ink font-semibold mt-1.5 flex items-center gap-1.5"><Clock size={13} className="text-slate-500" /> Sync · {syncTime(at)}</div>
          <div className="text-xs text-slate-500 mt-0.5">
            {list.length} new card{list.length === 1 ? '' : 's'}
            {accepted ? ` · ${accepted} accepted` : ''}{ignored ? ` · ${ignored} ignored` : ''}{denied ? ` · ${denied} denied` : ''}
          </div>
        </div>
        {/* A fanned peek at the cards */}
        <div className="relative h-14 w-20 shrink-0">
          {previews.slice(0, 3).map((p, i) => {
            const art = cards.get(`tcg-${p.productId}`)?.imageUrl
            return (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={p.productId}
                src={art ? cardImage(art, 'thumb') ?? art : tcgPhotoUrl(p.productId)}
                alt=""
                className="absolute top-0 h-14 aspect-[5/7] object-cover rounded-md shadow-md border border-black/10 transition-transform group-hover:-translate-y-0.5"
                style={{ left: i * 14, transform: `rotate(${(i - 1) * 7}deg)`, zIndex: i }}
              />
            )
          })}
        </div>
      </div>
      <div className="mt-3 h-1.5 rounded-full bg-slate-800 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: complete ? '#4d8a5b' : `linear-gradient(90deg, ${ACCENT}, #e0a15a)` }} />
      </div>
      <div className="mt-3 text-xs font-semibold flex items-center gap-1" style={{ color: ACCENT }}>
        {complete ? 'Look again' : 'Review'} <ChevronRight size={13} className="transition-transform group-hover:translate-x-0.5" />
      </div>
    </button>
  )
}

// The review board for one sync's cards — a full-screen layer over the staff portal.
function ReviewBoard({
  at, placements, registry, cards, riotByCode, busy, error, save, createSet, onClose,
}: {
  at: string
  placements: Placement[]
  registry: RegistryResponse['riftbound']
  cards: Map<string, CatalogCard>
  riotByCode: Map<string, string>
  busy: boolean
  error: string | null
  save: (changes: Change[]) => Promise<boolean>
  createSet: (name: string, cardexGroup: string, isNewCategory: boolean) => Promise<boolean>
  onClose: () => void
}) {
  const [showReviewed, setShowReviewed] = useState(false)
  const [filter, setFilter] = useState<string>(ALL)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [focusId, setFocusId] = useState<number | null>(null)
  // Cards a New set is for — moved into it on create, or (from the card viewer) just handed the
  // new set's name to select, so the move still waits for Accept.
  const [newSetFor, setNewSetFor] = useState<{ ids: number[]; onCreated?: (setName: string) => void } | null>(null)
  const [moveMenu, setMoveMenu] = useState(false)

  // Esc closes the board when nothing on top of it is open
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && focusId == null && !newSetFor && !moveMenu) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focusId, newSetFor, moveMenu, onClose])

  // Cardex categories: the registry's order, then any a set uses that it doesn't list ("Special").
  const categories = useMemo(() => {
    const list = [...registry.groupOrder]
    for (const s of registry.sets) if (s.cardexGroup && !list.includes(s.cardexGroup)) list.push(s.cardexGroup)
    return list
  }, [registry])
  const setOrder = useMemo(() => {
    const order = new Map<string, number>()
    categories.forEach((cat, ci) => registry.sets.filter((s) => s.cardexGroup === cat).forEach((s, si) => order.set(s.setName, ci * 1000 + si)))
    return order
  }, [categories, registry])

  const pool = useMemo(
    () => placements
      .filter((p) => !isDenied(p) && !p.ignored && (showReviewed || !p.reviewed))
      .sort((a, b) =>
        (a.setName ? setOrder.get(a.setName) ?? 9e5 : -1) - (b.setName ? setOrder.get(b.setName) ?? 9e5 : -1)
        || numberSortKey(a.number) - numberSortKey(b.number)),
    [placements, showReviewed, setOrder],
  )
  const deniedList = useMemo(() => placements.filter(isDenied).sort((a, b) => a.name.localeCompare(b.name)), [placements])
  const ignoredList = useMemo(() => placements.filter((p) => p.ignored).sort((a, b) => a.name.localeCompare(b.name)), [placements])
  const visible = useMemo(
    () => (filter === ALL ? pool : filter === DENIED ? deniedList : filter === IGNORED ? ignoredList : pool.filter((p) => (p.setName ?? LEFT_OUT) === filter)),
    [pool, filter, deniedList, ignoredList],
  )
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of pool) m.set(p.setName ?? LEFT_OUT, (m.get(p.setName ?? LEFT_OUT) ?? 0) + 1)
    return m
  }, [pool])

  // Bulk actions on the selection
  const selectedIds = Array.from(selected)
  const selectedPlacements = placements.filter((p) => selected.has(p.productId))
  async function bulk(changes: Change[]) {
    if (await save(changes)) setSelected(new Set())
    setMoveMenu(false)
  }
  const toggle = (id: number) => setSelected((s) => {
    const n = new Set(s)
    if (n.has(id)) n.delete(id); else n.add(id)
    return n
  })

  // One-at-a-time review: act, then move on to the next card in view.
  const focusIndex = focusId == null ? -1 : visible.findIndex((p) => p.productId === focusId)
  const focus = focusIndex >= 0 ? visible[focusIndex] : null
  async function actOnFocus(change: Omit<Change, 'productId'>) {
    if (!focus) return
    // With reviewed cards hidden, the card leaves the list (its neighbour slides in); otherwise step on.
    const next = showReviewed ? visible[focusIndex + 1] ?? null : visible[focusIndex + 1] ?? visible[focusIndex - 1] ?? null
    if (await save([{ productId: focus.productId, ...change }])) setFocusId(next?.productId ?? null)
  }

  async function onCreateSet(name: string, group: string, isNew: boolean) {
    if (!newSetFor) return
    const target = newSetFor
    if (!(await createSet(name, group, isNew))) return
    setNewSetFor(null)
    if (target.onCreated) target.onCreated(name)
    else if (await save(target.ids.map((productId) => ({ productId, setName: name, reviewed: true })))) setSelected(new Set())
  }

  const doneCount = placements.filter(isDone).length
  const pct = Math.round((doneCount / placements.length) * 100)
  const destinations = [
    ...(counts.has(LEFT_OUT) ? [{ key: LEFT_OUT, label: 'Couldn’t place', category: null as string | null }] : []),
    ...categories.flatMap((cat) => registry.sets.filter((s) => s.cardexGroup === cat && counts.has(s.setName)).map((s) => ({ key: s.setName, label: s.setName, category: cat as string | null }))),
  ]
  const nameOf = (p: Placement) => cards.get(`tcg-${p.productId}`)?.name ?? p.displayName ?? defaultCardName(p.name)
  // The card's picture as the site has it — "" means it shows No Image
  const imageOf = (p: Placement) => {
    const card = cards.get(`tcg-${p.productId}`)
    if (card && card.imageUrl === '') return NO_CARD_IMAGE
    return card?.imageUrl || tcgPhotoUrl(p.productId)
  }
  const riotArtOf = (p: Placement) => riotByCode.get((cards.get(`tcg-${p.productId}`)?.publicCode ?? '').split('-').slice(1).join('-')) ?? null
  const title = filter === ALL ? (showReviewed ? 'All cards' : 'Everything to review')
    : filter === LEFT_OUT ? 'Couldn’t place' : filter === DENIED ? 'Denied' : filter === IGNORED ? 'Ignored' : filter

  return createPortal(
    <div className="fixed inset-0 z-30 bg-[#efe4cc] overflow-y-auto">
      {/* Top bar */}
      <div className="sticky top-0 z-10 bg-[#efe4cc]/95 backdrop-blur border-b border-[#d6c49f]">
        <div className="px-4 md:px-8 py-3 flex flex-wrap items-center gap-x-6 gap-y-3">
          <button onClick={onClose} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-ink" title="Back (Esc)">
            <ArrowLeft size={16} /> Needs Review
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded text-white" style={{ background: ACCENT }}>Riftbound</span>
              <h2 className="text-lg font-bold text-ink">Sync · {syncTime(at)}</h2>
            </div>
            <div className="text-xs text-slate-500">Accept what’s right · Ignore to decide next sync · Deny to never see it again</div>
          </div>
          <div className="ml-auto w-full sm:w-72">
            <div className="flex items-baseline justify-between text-xs mb-1.5">
              <span className="text-slate-400"><span className="text-ink font-semibold text-base">{doneCount}</span> of {placements.length} handled</span>
              <span className="font-semibold" style={{ color: ACCENT }}>{pct}%</span>
            </div>
            <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${ACCENT}, #e0a15a)` }} />
            </div>
          </div>
        </div>
        {error && <div className="px-4 md:px-8 pb-2 text-xs text-red-600">{error}</div>}
      </div>

      <div className="flex flex-col lg:flex-row">
        {/* Destinations */}
        <aside className="lg:w-64 shrink-0 border-b lg:border-b-0 lg:border-r border-[#d6c49f] p-3 lg:sticky lg:top-[73px] lg:self-start lg:max-h-[calc(100dvh-73px)] lg:overflow-y-auto">
          <label className="flex items-center gap-2 text-xs text-slate-400 px-2 py-1.5 mb-1 cursor-pointer select-none">
            <input type="checkbox" checked={showReviewed} onChange={(e) => setShowReviewed(e.target.checked)} />
            Show accepted cards
          </label>
          <div className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible">
            <DestinationButton active={filter === ALL} onClick={() => setFilter(ALL)} label={showReviewed ? 'All cards' : 'Everything to review'} count={pool.length} />
            {destinations.map((d, i) => (
              <div key={d.key} className="contents lg:block">
                {d.category && d.category !== destinations[i - 1]?.category && (
                  <div className="hidden lg:block text-[10px] uppercase tracking-wider text-slate-500 px-2 pt-3 pb-1">{d.category}</div>
                )}
                <DestinationButton active={filter === d.key} onClick={() => setFilter(d.key)} label={d.label} count={counts.get(d.key) ?? 0} warn={d.key === LEFT_OUT} />
              </div>
            ))}
            {(ignoredList.length > 0 || deniedList.length > 0) && (
              <div className="contents lg:block">
                <div className="hidden lg:block text-[10px] uppercase tracking-wider text-slate-500 px-2 pt-3 pb-1">Set aside</div>
                {ignoredList.length > 0 && <DestinationButton active={filter === IGNORED} onClick={() => setFilter(IGNORED)} label="Ignored — next sync" count={ignoredList.length} muted />}
                {deniedList.length > 0 && <DestinationButton active={filter === DENIED} onClick={() => setFilter(DENIED)} label="Denied" count={deniedList.length} muted />}
              </div>
            )}
          </div>
        </aside>

        {/* Grid */}
        <div className="flex-1 min-w-0 p-4 md:p-6 pb-28">
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <h3 className="text-ink font-semibold">{title}</h3>
            <span className="text-xs text-slate-500">{visible.length} card{visible.length === 1 ? '' : 's'}</span>
            {filter === DENIED && <span className="text-xs text-slate-500">— hidden, and syncs won’t offer them again. Recover any you want after all.</span>}
            {filter === IGNORED && <span className="text-xs text-slate-500">— hidden for now; the next sync offers them again.</span>}
            {visible.length > 0 && (
              <div className="ml-auto flex items-center gap-2">
                <button
                  onClick={() => setSelected(selected.size === visible.length ? new Set() : new Set(visible.map((p) => p.productId)))}
                  className="text-xs px-3 py-1.5 rounded-lg text-slate-400 hover:text-ink hover:bg-slate-800/60"
                >
                  {selected.size === visible.length ? 'Clear selection' : 'Select all'}
                </button>
                {filter === DENIED ? (
                  <button disabled={busy} onClick={() => bulk(visible.map((p) => ({ productId: p.productId, denied: false })))} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-800 text-ink hover:bg-slate-700 disabled:opacity-50 flex items-center gap-1.5">
                    <RotateCcw size={13} /> Recover all ({visible.length})
                  </button>
                ) : filter === IGNORED ? (
                  <button disabled={busy} onClick={() => bulk(visible.map((p) => ({ productId: p.productId, ignored: false })))} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-800 text-ink hover:bg-slate-700 disabled:opacity-50 flex items-center gap-1.5">
                    <RotateCcw size={13} /> Review now instead ({visible.length})
                  </button>
                ) : visible.some((p) => !p.reviewed && p.setName) && (
                  <button
                    disabled={busy}
                    onClick={() => bulk(visible.filter((p) => !p.reviewed && p.setName).map((p) => ({ productId: p.productId, reviewed: true })))}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg text-white disabled:opacity-50 flex items-center gap-1.5 shadow-sm"
                    style={{ background: ACCENT }}
                  >
                    <Check size={13} /> Accept all ({visible.filter((p) => !p.reviewed && p.setName).length})
                  </button>
                )}
              </div>
            )}
          </div>

          {visible.length === 0 ? (
            <div className="py-24 text-center">
              <div className="mx-auto w-12 h-12 rounded-full flex items-center justify-center mb-3" style={{ background: `${ACCENT}22`, color: ACCENT }}><Check size={22} /></div>
              <div className="text-ink font-semibold">{filter === DENIED ? 'No denied cards' : filter === IGNORED ? 'Nothing ignored' : 'All caught up'}</div>
              <div className="text-sm text-slate-400 mt-1">{doneCount === placements.length ? 'Every card from this sync is handled.' : 'Nothing left to review here.'}</div>
              {doneCount === placements.length && (
                <button onClick={onClose} className="mt-4 text-sm font-semibold px-4 py-2 rounded-xl text-white" style={{ background: ACCENT }}>Back to Needs Review</button>
              )}
            </div>
          ) : (
            <div className="grid gap-5 grid-cols-[repeat(auto-fill,minmax(160px,1fr))]">
              {visible.map((p) => (
                <CardTile
                  key={p.productId}
                  placement={p}
                  name={nameOf(p)}
                  denied={isDenied(p)}
                  image={cardImage(imageOf(p), 'grid') ?? imageOf(p)}
                  price={cards.get(`tcg-${p.productId}`)?.marketPrice}
                  selected={selected.has(p.productId)}
                  selecting={selected.size > 0}
                  busy={busy}
                  showSet={filter === ALL || filter === IGNORED}
                  onToggle={() => toggle(p.productId)}
                  onOpen={() => setFocusId(p.productId)}
                  onApprove={() => save([{ productId: p.productId, reviewed: true }])}
                  onRecover={() => save([{ productId: p.productId, denied: false }])}
                  onUnreview={() => save([{ productId: p.productId, reviewed: false }])}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bulk bar */}
      {selected.size > 0 && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 rounded-2xl bg-[#2a2018] text-[#f3e8d2] shadow-2xl px-3 py-2 border border-black/20">
          <span className="text-sm font-semibold px-2 whitespace-nowrap">{selected.size} selected</span>
          {filter === DENIED ? (
            <button disabled={busy} onClick={() => bulk(selectedIds.map((productId) => ({ productId, denied: false })))} className="text-xs font-semibold px-3 py-2 rounded-xl flex items-center gap-1.5 disabled:opacity-50 whitespace-nowrap" style={{ background: ACCENT }}>
              <RotateCcw size={13} /> Recover
            </button>
          ) : (
            <button disabled={busy || !selectedPlacements.some((p) => p.setName)} onClick={() => bulk(selectedPlacements.filter((p) => p.setName).map((p) => ({ productId: p.productId, reviewed: true })))} className="text-xs font-semibold px-3 py-2 rounded-xl flex items-center gap-1.5 disabled:opacity-50 whitespace-nowrap" style={{ background: ACCENT }}>
              <Check size={13} /> Accept
            </button>
          )}
          <div className="relative">
            <button disabled={busy} onClick={() => setMoveMenu((v) => !v)} className="text-xs font-semibold px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 flex items-center gap-1.5 disabled:opacity-50 whitespace-nowrap">
              <FolderInput size={13} /> Accept into…
            </button>
            {moveMenu && (
              <SetMenu
                categories={categories}
                sets={registry.sets}
                onPick={(setName: string) => bulk(selectedIds.map((productId) => (filter === DENIED ? { productId, denied: false, setName, reviewed: true } : { productId, setName, reviewed: true })))}
                onNewSet={() => { setMoveMenu(false); setNewSetFor({ ids: selectedIds }) }}
                onClose={() => setMoveMenu(false)}
              />
            )}
          </div>
          {filter !== DENIED && filter !== IGNORED && (
            <button disabled={busy} onClick={() => bulk(selectedIds.map((productId) => ({ productId, ignored: true })))} className="text-xs font-semibold px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 flex items-center gap-1.5 disabled:opacity-50 whitespace-nowrap" title="Not sure — hide for now, ask again next sync">
              <Clock size={13} /> Ignore
            </button>
          )}
          {filter !== DENIED && selectedPlacements.some((p) => p.reviewed && !isDenied(p)) && (
            <button disabled={busy} onClick={() => bulk(selectedPlacements.filter((p) => p.reviewed && !isDenied(p)).map((p) => ({ productId: p.productId, reviewed: false })))} className="text-xs font-semibold px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 flex items-center gap-1.5 disabled:opacity-50 whitespace-nowrap">
              <Undo2 size={13} /> Unaccept
            </button>
          )}
          {filter !== DENIED && (
            <button disabled={busy} onClick={() => bulk(selectedIds.map((productId) => ({ productId, denied: true })))} className="text-xs font-semibold px-3 py-2 rounded-xl bg-red-500/80 hover:bg-red-500 flex items-center gap-1.5 disabled:opacity-50 whitespace-nowrap">
              <Ban size={13} /> Deny
            </button>
          )}
          <button onClick={() => setSelected(new Set())} title="Clear selection" className="p-2 rounded-xl hover:bg-white/10"><X size={14} /></button>
        </div>
      )}

      {focus && (
        <FocusViewer
          placement={focus}
          name={nameOf(focus)}
          denied={isDenied(focus)}
          index={focusIndex}
          total={visible.length}
          image={imageOf(focus)}
          price={cards.get(`tcg-${focus.productId}`)?.marketPrice}
          categories={categories}
          sets={registry.sets}
          busy={busy}
          onClose={() => setFocusId(null)}
          onPrev={() => focusIndex > 0 && setFocusId(visible[focusIndex - 1].productId)}
          onNext={() => focusIndex < visible.length - 1 && setFocusId(visible[focusIndex + 1].productId)}
          onAccept={(setName) => actOnFocus(isDenied(focus) ? { denied: false, setName, reviewed: true } : { setName, reviewed: true })}
          onIgnore={() => actOnFocus({ ignored: true })}
          onDeny={() => actOnFocus({ denied: true })}
          onRename={(displayName) => save([{ productId: focus.productId, displayName }])}
          riotArt={riotArtOf(focus)}
          onImage={(image) => save([{ productId: focus.productId, image }])}
          onUnreview={() => save([{ productId: focus.productId, reviewed: false }])}
          onNewSet={(onCreated) => setNewSetFor({ ids: [focus.productId], onCreated })}
        />
      )}

      {newSetFor && (
        <NewSetDialog categories={categories} busy={busy} onCancel={() => setNewSetFor(null)} onCreate={onCreateSet} />
      )}
    </div>,
    document.body,
  )
}

function DestinationButton({ active, onClick, label, count, warn, muted }: { active: boolean; onClick: () => void; label: string; count: number; warn?: boolean; muted?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'shrink-0 lg:w-full flex items-center justify-between gap-3 px-3 py-2 rounded-xl text-sm text-left transition-colors',
        active ? 'text-white shadow-sm' : warn ? 'text-amber-700 hover:bg-amber-100/50' : muted ? 'text-slate-500 hover:bg-slate-800/60' : 'text-slate-300 hover:bg-slate-800/60',
      )}
      style={active ? { background: ACCENT } : undefined}
    >
      <span className="truncate">{label}</span>
      <span className={cn('text-[11px] font-semibold rounded-full px-1.5 min-w-[1.5rem] text-center', active ? 'bg-white/25' : 'bg-slate-800 text-slate-400')}>{count}</span>
    </button>
  )
}

function CardTile({
  placement: p, name, denied, image, price, selected, selecting, busy, showSet, onToggle, onOpen, onApprove, onRecover, onUnreview,
}: {
  placement: Placement
  name: string
  denied: boolean
  image: string
  price?: number
  selected: boolean
  selecting: boolean
  busy: boolean
  showSet: boolean
  onToggle: () => void
  onOpen: () => void
  onApprove: () => void
  onRecover: () => void
  onUnreview: () => void
}) {
  return (
    <div className="group">
      <div
        onClick={selecting ? onToggle : onOpen}
        className={cn(
          'relative aspect-[5/7] rounded-xl overflow-hidden cursor-pointer bg-slate-800 transition-all duration-200',
          'shadow-[0_2px_8px_-2px_rgba(60,40,20,0.35)] hover:-translate-y-1 hover:shadow-[0_10px_24px_-8px_rgba(60,40,20,0.5)]',
        )}
        style={selected ? { boxShadow: `0 0 0 3px #efe4cc, 0 0 0 6px ${ACCENT}` } : undefined}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image} alt={name} loading="lazy" className={cn('w-full h-full object-cover', denied ? 'grayscale opacity-50' : p.ignored ? 'opacity-50' : p.reviewed && 'opacity-60')} />
        <span className="absolute left-1.5 bottom-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-black/60 text-white backdrop-blur-sm">
          {sourceLabel(p)}
        </span>
        {denied && (
          <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-center pointer-events-none">
            <span className="px-2.5 py-1 rounded-full bg-red-700/90 text-white text-[11px] font-bold uppercase tracking-wide flex items-center gap-1 shadow"><Ban size={11} /> Denied</span>
          </span>
        )}
        {p.ignored && (
          <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-center pointer-events-none">
            <span className="px-2.5 py-1 rounded-full bg-slate-700/90 text-white text-[11px] font-bold uppercase tracking-wide flex items-center gap-1 shadow"><Clock size={11} /> Next sync</span>
          </span>
        )}
        {p.reviewed && !denied && (
          <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="w-10 h-10 rounded-full flex items-center justify-center text-white shadow-lg" style={{ background: ACCENT }}><Check size={20} /></span>
          </span>
        )}
        {/* Select */}
        <button
          onClick={(e) => { e.stopPropagation(); onToggle() }}
          title="Select"
          className={cn(
            'absolute top-1.5 left-1.5 w-6 h-6 rounded-md border-2 flex items-center justify-center transition-opacity',
            selected ? 'opacity-100 text-white border-transparent' : 'bg-black/40 border-white/80 text-transparent',
            !selected && (selecting ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'),
          )}
          style={selected ? { background: ACCENT } : undefined}
        >
          <Check size={14} />
        </button>
        {/* Quick recover */}
        {denied && !selecting && (
          <button
            disabled={busy}
            onClick={(e) => { e.stopPropagation(); onRecover() }}
            title="Recover — use this card after all"
            className="absolute top-1.5 right-1.5 h-7 px-2 rounded-lg bg-white/90 text-ink text-[11px] font-semibold flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shadow disabled:opacity-50"
          >
            <RotateCcw size={12} /> Recover
          </button>
        )}
        {/* Undo a review */}
        {p.reviewed && !denied && !selecting && (
          <button
            disabled={busy}
            onClick={(e) => { e.stopPropagation(); onUnreview() }}
            title="Unaccept — back to review"
            className="absolute top-1.5 right-1.5 h-7 px-2 rounded-lg bg-white/90 text-ink text-[11px] font-semibold flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shadow disabled:opacity-50"
          >
            <Undo2 size={12} /> Unaccept
          </button>
        )}
        {/* Quick approve */}
        {!p.reviewed && !denied && !p.ignored && !!p.setName && !selecting && (
          <button
            disabled={busy}
            onClick={(e) => { e.stopPropagation(); onApprove() }}
            title="Accept — it's in the right set"
            className="absolute top-1.5 right-1.5 h-7 px-2 rounded-lg text-white text-[11px] font-semibold flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shadow disabled:opacity-50"
            style={{ background: ACCENT }}
          >
            <Check size={12} /> Accept
          </button>
        )}
      </div>
      <div className="mt-2 px-0.5">
        <div className="text-sm font-medium text-ink leading-tight line-clamp-2" title={name}>
          {name}{p.displayName && <Pencil size={10} className="inline ml-1 text-slate-500" />}
        </div>
        <div className="flex items-center justify-between gap-2 mt-0.5 text-[11px] text-slate-500">
          <span className="truncate">{p.number}{denied && p.previousSetName ? ` · was ${p.previousSetName}` : showSet ? ` · ${p.setName ?? 'Couldn’t place'}` : ''}</span>
          {!!price && <span className="font-semibold text-slate-400 shrink-0">{formatCurrency(price)}</span>}
        </div>
      </div>
    </div>
  )
}

// Pick a set: categories as headings, sets as buttons.
function SetChoices({
  categories, sets, current, busy, onPick, onNewSet,
}: { categories: string[]; sets: RegistrySet[]; current?: string | null; busy?: boolean; onPick: (setName: string) => void; onNewSet: () => void }) {
  return (
    <div className="space-y-3">
      {categories.map((cat) => {
        const list = sets.filter((s) => s.cardexGroup === cat)
        if (list.length === 0) return null
        return (
          <div key={cat}>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">{cat}</div>
            <div className="flex flex-wrap gap-1.5">
              {list.map((s) => (
                <button
                  key={s.setName}
                  disabled={busy}
                  onClick={() => onPick(s.setName)}
                  className={cn(
                    'text-xs px-2.5 py-1.5 rounded-lg border transition-colors disabled:opacity-50',
                    current === s.setName ? 'text-white border-transparent' : 'border-slate-700 text-slate-300 hover:border-slate-500 hover:text-ink',
                  )}
                  style={current === s.setName ? { background: ACCENT } : undefined}
                >
                  {s.setName}
                </button>
              ))}
            </div>
          </div>
        )
      })}
      <div className="flex flex-wrap gap-1.5 pt-1">
        <button disabled={busy} onClick={onNewSet} className="text-xs px-2.5 py-1.5 rounded-lg border border-dashed border-slate-600 text-slate-300 hover:text-ink flex items-center gap-1 disabled:opacity-50">
          <Plus size={12} /> New set…
        </button>
      </div>
    </div>
  )
}

function SetMenu({
  categories, sets, onPick, onNewSet, onClose,
}: { categories: string[]; sets: RegistrySet[]; onPick: (setName: string) => void; onNewSet: () => void; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0" onClick={onClose} />
      <div className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 w-80 max-h-[60vh] overflow-y-auto rounded-2xl bg-[#f3e8d2] text-ink shadow-2xl border border-[#d6c49f] p-4">
        <div className="text-sm font-semibold mb-3">Accept into…</div>
        <SetChoices categories={categories} sets={sets} onPick={onPick} onNewSet={onNewSet} />
      </div>
    </>
  )
}

function FocusViewer({
  placement: p, name, denied, index, total, image, riotArt, price, categories, sets, busy, onClose, onPrev, onNext, onAccept, onNewSet, onIgnore, onDeny, onRename, onImage, onUnreview,
}: {
  placement: Placement
  name: string
  denied: boolean
  index: number
  total: number
  image: string
  price?: number
  categories: string[]
  sets: RegistrySet[]
  busy: boolean
  onClose: () => void
  onPrev: () => void
  onNext: () => void
  onAccept: (setName: string) => void
  onNewSet: (onCreated: (setName: string) => void) => void
  onIgnore: () => void
  onDeny: () => void
  onRename: (displayName: string) => void
  riotArt: string | null
  onImage: (image: ImageChoice | 'auto') => void
  onUnreview: () => void
}) {
  const [tcgOk, setTcgOk] = useState(true)
  // The set picked for this card — only a selection; nothing saves until Accept (or Deny).
  // Starts on where the card is (or, for a denied one, where it was).
  const startChoice = denied ? p.previousSetName ?? null : p.setName
  const [choice, setChoice] = useState<string | null>(startChoice)
  useEffect(() => { setTcgOk(true); setChoice(startChoice) }, [p.productId, startChoice])
  const accept = () => { if (choice) onAccept(choice) }
  // Latest handlers for the one window key listener
  const keys = useRef({ onClose, onPrev, onNext, onApprove: accept, busy })
  keys.current = { onClose, onPrev, onNext, onApprove: accept, busy }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return
      const k = keys.current
      if (e.key === 'Escape') k.onClose()
      else if (e.key === 'ArrowLeft') k.onPrev()
      else if (e.key === 'ArrowRight') k.onNext()
      else if (e.key === 'Enter' && !k.busy) { e.preventDefault(); k.onApprove() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  // The catalog art is TCGplayer's own photo unless TCGplayer had none (then it's Riot's art) —
  // show TCGplayer's photo beside it only when they differ.
  // Which picture the site uses: staff's pick, or (automatic) whichever the card has now
  const using: ImageChoice = p.image ?? (image === NO_CARD_IMAGE ? 'none' : image.includes('tcgplayer-cdn') ? 'tcgplayer' : 'riot')
  const pictureLabel = { tcgplayer: 'TCGplayer photo', riot: 'Riot’s card art', none: 'No image' }[using]

  return createPortal(
    <div className="fixed inset-0 z-50 bg-[#1b140e]/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="relative w-full max-w-4xl max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-3xl bg-[#f3e8d2] shadow-2xl border border-[#d6c49f]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#d6c49f]/70 text-xs text-slate-500">
          <span>Card {index + 1} of {total}</span>
          <span className="hidden sm:inline">Pick a set, then Accept (Enter) · Ignore · Deny · ← → to browse · Esc to close</span>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-black/5 text-slate-500"><X size={16} /></button>
        </div>

        <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-6 p-5 md:px-12 md:py-7">
          {/* Art */}
          <div className="flex flex-col items-center">
            <div className="w-full max-w-[280px]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={cardImage(image, 'full') ?? image} alt={name} className={cn('w-full aspect-[5/7] object-cover rounded-2xl shadow-[0_18px_40px_-14px_rgba(60,40,20,0.6)]', denied && 'grayscale opacity-60')} />
              <div className="text-[11px] text-slate-500 text-center mt-2">On the site: {pictureLabel}{p.image ? '' : ' (automatic)'}</div>
            </div>
            {/* Picture: which one the site shows */}
            <div className="mt-4 w-full max-w-[280px]">
              <div className="text-xs text-slate-500 mb-2 text-center">Picture</div>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { key: 'tcgplayer', label: tcgOk ? 'TCGplayer' : 'TCGplayer (none yet)', src: tcgOk ? tcgPhotoUrl(p.productId) : NO_CARD_IMAGE, disabled: false },
                  { key: 'riot', label: 'Riot art', src: riotArt ?? NO_CARD_IMAGE, disabled: !riotArt },
                  { key: 'none', label: 'No image', src: NO_CARD_IMAGE, disabled: false },
                ] as const).map((o) => (
                  <button
                    key={o.key}
                    disabled={busy || o.disabled}
                    onClick={() => onImage(o.key)}
                    title={o.disabled ? 'No Riot art for this card' : `Use ${o.label}`}
                    className={cn('rounded-xl p-1 transition-all disabled:opacity-40', using === o.key ? 'bg-white/70 shadow' : 'hover:bg-white/40')}
                    style={using === o.key ? { boxShadow: `0 0 0 2px ${ACCENT}` } : undefined}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={o.key === 'riot' && o.src !== NO_CARD_IMAGE ? cardImage(o.src, 'thumb') ?? o.src : o.src}
                      onError={o.key === 'tcgplayer' ? () => setTcgOk(false) : undefined}
                      alt=""
                      className="w-full aspect-[5/7] object-cover rounded-lg"
                    />
                    <div className={cn('text-[10px] mt-1 leading-tight', using === o.key ? 'font-semibold text-ink' : 'text-slate-500')}>{o.label}</div>
                  </button>
                ))}
              </div>
              {p.image && (
                <button disabled={busy} onClick={() => onImage('auto')} className="mt-2 w-full text-[11px] text-slate-500 underline hover:text-ink">
                  Back to automatic (TCGplayer’s photo when there is one, else Riot’s art)
                </button>
              )}
            </div>
          </div>

          {/* Details + decision */}
          <div className="min-w-0 flex flex-col">
            <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: ACCENT }}>{sourceLabel(p)}</div>
            <NameEditor key={p.productId} name={name} tcgplayerName={p.name} custom={!!p.displayName} busy={busy} onSave={onRename} />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500 mt-1.5">
              <span>#{p.number}</span>
              {!!price && <span className="font-semibold text-ink">{formatCurrency(price)}</span>}
              <a href={`https://www.tcgplayer.com/product/${p.productId}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-ink">
                TCGplayer <ExternalLink size={12} />
              </a>
            </div>

            <div className="mt-5 rounded-2xl bg-white/40 border border-[#d6c49f]/70 p-4">
              <div className="flex items-center justify-between gap-2 text-xs text-slate-500 mb-1">
                <span>
                  {denied
                    ? <span className="inline-flex items-center gap-1 font-semibold text-red-700"><Ban size={11} /> Denied — hidden from the site</span>
                    : p.ignored ? <span className="inline-flex items-center gap-1 font-semibold text-slate-600"><Clock size={11} /> Ignored — the next sync asks again</span>
                    : p.setName ? (p.auto ? <>The sync suggested <b className="text-ink">{p.setName}</b></> : <>Placed in <b className="text-ink">{p.setName}</b></>)
                    : 'The sync couldn’t tell where it goes'}
                </span>
                {p.reviewed && !denied && (
                  <button disabled={busy} onClick={onUnreview} className="inline-flex items-center gap-1 font-semibold hover:text-ink disabled:opacity-50" title="Put it back in the review queue">
                    <Check size={11} style={{ color: ACCENT }} /> Accepted · <Undo2 size={11} /> Unaccept
                  </button>
                )}
              </div>
              <div className="text-sm font-semibold text-ink mt-3 mb-2">1. Where does it go?</div>
              <SetChoices categories={categories} sets={sets} current={choice} busy={busy} onPick={setChoice} onNewSet={() => onNewSet(setChoice)} />

              <div className="text-sm font-semibold text-ink mt-5 mb-2">2. {denied ? 'Bring it back?' : 'Your call'}</div>
              <div className="flex gap-2">
                <button
                  disabled={busy || !choice}
                  onClick={accept}
                  className="flex-1 py-3 rounded-xl text-white font-semibold flex items-center justify-center gap-2 shadow-md disabled:opacity-40 min-w-0"
                  style={{ background: ACCENT }}
                  title={choice ? undefined : 'Pick a set first'}
                >
                  {busy ? <Loader2 size={16} className="animate-spin shrink-0" /> : <Check size={16} className="shrink-0" />}
                  <span className="truncate">{choice ? `Accept into ${choice}` : 'Pick a set to accept'}</span>
                </button>
                {!denied && !p.ignored && (
                  <button
                    disabled={busy}
                    onClick={onIgnore}
                    title="Not sure yet — hide it for now, and the next sync asks again (maybe with a photo)"
                    className="py-3 px-4 rounded-xl font-semibold flex items-center justify-center gap-2 border border-slate-600 text-slate-300 hover:bg-black/5 disabled:opacity-60"
                  >
                    <Clock size={16} /> Ignore
                  </button>
                )}
                {!denied && (
                  <button
                    disabled={busy}
                    onClick={onDeny}
                    title="Don't use this card — hidden, and syncs won't offer it again"
                    className="py-3 px-4 rounded-xl font-semibold flex items-center justify-center gap-2 border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-60"
                  >
                    <Ban size={16} /> Deny
                  </button>
                )}
              </div>
              {!denied && (
                <div className="mt-2 text-[11px] text-slate-500 leading-snug">
                  <b>Ignore</b> = not sure yet: hidden for now, back in the next sync’s review. <b>Deny</b> = never use it.
                </div>
              )}
            </div>
          </div>
        </div>

        <button onClick={onPrev} disabled={index === 0} title="Previous (←)" className="hidden md:flex absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/70 shadow items-center justify-center disabled:opacity-30"><ChevronLeft size={18} /></button>
        <button onClick={onNext} disabled={index >= total - 1} title="Next (→)" className="hidden md:flex absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/70 shadow items-center justify-center disabled:opacity-30"><ChevronRight size={18} /></button>
      </div>
    </div>,
    document.body,
  )
}

// The name the website shows for this card — click to edit; empty / "Reset" goes back to the
// name built from TCGplayer's.
function NameEditor({
  name, tcgplayerName, custom, busy, onSave,
}: { name: string; tcgplayerName: string; custom: boolean; busy: boolean; onSave: (displayName: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(name)
  useEffect(() => { if (!editing) setValue(name) }, [name, editing])
  const commit = () => {
    setEditing(false)
    if (value.trim() !== name) onSave(value.trim())
  }
  if (editing) {
    return (
      <div className="mt-1">
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation() // keep Enter / arrows / Esc away from the viewer's shortcuts
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') { setValue(name); setEditing(false) }
          }}
          onBlur={commit}
          className="input-field !text-xl !font-bold"
        />
        <div className="text-[11px] text-slate-500 mt-1">The name shown on the website. Enter to save, Esc to cancel. Leave empty for the default.</div>
      </div>
    )
  }
  return (
    <div className="mt-1">
      <button disabled={busy} onClick={() => setEditing(true)} className="group/name text-left w-full" title="Rename — how it shows on the website">
        <h3 className="text-2xl font-bold text-ink leading-tight inline">{name}</h3>
        <Pencil size={14} className="inline ml-2 -mt-1 text-slate-400 group-hover/name:text-ink" />
      </button>
      <div className="text-[11px] text-slate-500 mt-0.5">
        {custom ? (
          <>Renamed · TCGplayer calls it “{tcgplayerName}” · <button disabled={busy} onClick={() => onSave('')} className="underline hover:text-ink">Reset</button></>
        ) : (
          <>TCGplayer calls it “{tcgplayerName}”</>
        )}
      </div>
    </div>
  )
}

const NEW_CATEGORY = '__new_category__'

function NewSetDialog({
  categories, busy, onCancel, onCreate,
}: { categories: string[]; busy: boolean; onCancel: () => void; onCreate: (name: string, category: string, isNew: boolean) => void }) {
  const [name, setName] = useState('')
  const [group, setGroup] = useState(categories.includes('Promos') ? 'Promos' : categories[0] ?? NEW_CATEGORY)
  const [newCategory, setNewCategory] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)
  const categoryRef = useRef<HTMLInputElement>(null)
  useEffect(() => { nameRef.current?.focus({ preventScroll: true }) }, [])
  useEffect(() => {
    // Capture + stop: Esc closes only this dialog, not the card viewer under it
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); onCancel() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onCancel])

  const isNew = group === NEW_CATEGORY
  const category = isNew ? newCategory.trim() : group
  const taken = isNew && categories.some((c) => c.toLowerCase() === category.toLowerCase())
  const ready = !busy && !!name.trim() && !!category && !taken
  const submit = () => { if (ready) onCreate(name.trim(), category, isNew) }

  // Portalled to <body>: inside the review card (whose backdrop-filter makes it the containing
  // block for `fixed`) the dialog centred on the whole long list and focusing it scrolled the page.
  return createPortal(
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="w-full max-w-sm rounded-2xl bg-[#f3e8d2] border border-[#d6c49f] shadow-2xl p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-ink font-semibold mb-3">New Riftbound set</h3>
        <label className="block text-xs text-slate-400 mb-1">Set name</label>
        <input
          ref={nameRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
          placeholder="e.g. K/DA Couture Collection"
          className="input-field mb-3"
        />
        <label className="block text-xs text-slate-400 mb-1">Cardex category</label>
        <select
          value={group}
          onChange={(e) => {
            setGroup(e.target.value)
            if (e.target.value === NEW_CATEGORY) setTimeout(() => categoryRef.current?.focus({ preventScroll: true }))
          }}
          className="input-field mb-3"
        >
          {categories.map((g) => <option key={g} value={g}>{g}</option>)}
          <option value={NEW_CATEGORY}>New category…</option>
        </select>
        {isNew && (
          <>
            <input
              ref={categoryRef}
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
              placeholder="e.g. Collector Bundles"
              className="input-field mb-1"
            />
            <p className={cn('text-[11px] mb-3', taken ? 'text-red-600' : 'text-slate-500')}>
              {taken ? 'That category already exists — pick it from the list.' : 'Shown in the Cardex after the existing categories.'}
            </p>
          </>
        )}
        <div className="flex justify-end gap-2 mt-1">
          <button onClick={onCancel} className="text-xs px-3 py-1.5 rounded-lg text-slate-400 hover:text-ink">Cancel</button>
          <button
            disabled={!ready}
            onClick={submit}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg text-white disabled:opacity-50 flex items-center gap-1"
            style={{ background: ACCENT }}
          >
            <Plus size={12} /> Create &amp; move
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
