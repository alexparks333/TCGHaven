'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Check, Plus, X, ChevronLeft, ChevronRight, ExternalLink, Ban, FolderInput, Sparkles, RotateCcw, Pencil, Undo2 } from 'lucide-react'
import { adminFetch } from '@/lib/firebase/authFetch'
import { cardImage, NO_CARD_IMAGE } from '@/lib/cardImage'
import { cn, formatCurrency } from '@/lib/utils'

// New TCGplayer cards (staff portal → Needs Review): every Riftbound sync places promos and other
// TCGplayer-only products into the set it thinks they belong to (catalog-sync.mjs's
// discoverRiftboundProducts()). They're live in the catalog straight away; this board is for
// checking the guesses. Pick a set in the sidebar, approve or move cards in bulk from the grid, or
// open a card to go through them one at a time with the keyboard (Enter = looks right, ←/→).
// Writes go through POST /api/set-registry/placements, which moves the catalog card at once.

interface Placement {
  productId: number
  groupId: number
  groupName?: string
  name: string
  number: string
  setName: string | null
  auto: boolean
  reviewed: boolean
  denied?: boolean
  previousSetName?: string | null
  displayName?: string
}

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
  imageUrl?: string
  marketPrice?: number
}

type Change = { productId: number; setName?: string | null; reviewed?: boolean; denied?: boolean; displayName?: string }

const ALL = '__all__'
const LEFT_OUT = '__left_out__'
const DENIED = '__denied__'
const ACCENT = '#b5532f' // Riftbound

const tcgPhotoUrl = (productId: number) => `https://tcgplayer-cdn.tcgplayer.com/product/${productId}_in_1000x1000.jpg`
// "Riftbound Organized Play Promotional Cards" → "Organized Play"
const sourceLabel = (p: Placement) =>
  (p.groupName ?? '').replace(/^riftbound:?\s*/i, '').replace(/promotional cards/i, '').trim() || 'Promo'
const numberSortKey = (n: string) => parseInt(n.replace(/^\D+/, ''), 10) || 0
// Denied = staff don't want the card (hidden, never re-added by a sync). A card left out before
// Deny existed (no set, already reviewed) counts too; an unreviewed one with no set is one the
// sync couldn't place.
const isDenied = (p: Placement) => !!p.denied || (p.setName === null && p.reviewed)
// Same as placementDefaultName() in catalog-sync.mjs
// The change that puts a placement back how it was (for Undo).
function restoreChange(prev: Placement, now: Placement): Change {
  const c: Change = { productId: prev.productId, reviewed: prev.reviewed }
  if (isDenied(prev) && !isDenied(now)) c.denied = true
  else if (!isDenied(prev) && isDenied(now)) { c.denied = false; c.setName = prev.setName }
  else if (prev.setName !== now.setName) c.setName = prev.setName
  if ((prev.displayName ?? '') !== (now.displayName ?? '')) c.displayName = prev.displayName ?? ''
  return c
}

// What an action did, for the Undo toast.
function describe(changes: Change[]): string {
  const n = changes.length
  const cards = n === 1 ? 'card' : `${n} cards`
  const c = changes[0]
  if (c.denied === true) return `Denied ${cards}`
  if (c.denied === false) return `Recovered ${cards}`
  if (c.displayName !== undefined) return c.displayName ? `Renamed to “${c.displayName}”` : 'Name reset'
  if (c.setName !== undefined) return `Moved ${cards} to ${c.setName ?? 'nowhere'}`
  if (c.reviewed === false) return `Marked ${cards} not reviewed`
  return `Marked ${cards} as right`
}

export function defaultCardName(tcgplayerName: string): string {
  const base = tcgplayerName.replace(/\s*\([^)]*\)/g, '').trim()
  const parens = Array.from(tcgplayerName.matchAll(/\(([^)]*)\)/g)).map((m) => m[1].trim()).filter(Boolean)
  return `${base} (${parens.join(', ') || 'Promo'})`
}

export function PlacementsReview() {
  const [registry, setRegistry] = useState<RegistryResponse['riftbound'] | null>(null)
  const [cards, setCards] = useState<Map<string, CatalogCard>>(new Map())
  const [loading, setLoading] = useState(true)
  const [showReviewed, setShowReviewed] = useState(false)
  const [filter, setFilter] = useState<string>(ALL)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [focusId, setFocusId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newSetFor, setNewSetFor] = useState<number[] | null>(null)
  const [moveMenu, setMoveMenu] = useState(false)
  // The last action, undoable from the toast (or ⌘Z) for a few seconds
  const [undo, setUndo] = useState<{ label: string; changes: Change[]; id: number } | null>(null)
  const placementsRef = useRef<Placement[]>([])

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
        setCards(new Map((Array.isArray(catalog) ? catalog : []).filter((c) => c.id.startsWith('tcg-')).map((c) => [c.id, c])))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const placements = useMemo(() => registry?.placements ?? [], [registry])
  placementsRef.current = placements
  // Cardex categories: the registry's order, then any a set uses that it doesn't list ("Special").
  const categories = useMemo(() => {
    const list = [...(registry?.groupOrder ?? [])]
    for (const s of registry?.sets ?? []) if (s.cardexGroup && !list.includes(s.cardexGroup)) list.push(s.cardexGroup)
    return list
  }, [registry])
  const setOrder = useMemo(() => {
    const order = new Map<string, number>()
    categories.forEach((cat, ci) => (registry?.sets ?? []).filter((s) => s.cardexGroup === cat).forEach((s, si) => order.set(s.setName, ci * 1000 + si)))
    return order
  }, [categories, registry])

  const pool = useMemo(
    () => placements
      .filter((p) => !isDenied(p) && (showReviewed || !p.reviewed))
      .sort((a, b) =>
        (a.setName ? setOrder.get(a.setName) ?? 9e5 : -1) - (b.setName ? setOrder.get(b.setName) ?? 9e5 : -1)
        || numberSortKey(a.number) - numberSortKey(b.number)),
    [placements, showReviewed, setOrder],
  )
  const deniedList = useMemo(() => placements.filter(isDenied).sort((a, b) => a.name.localeCompare(b.name)), [placements])
  const visible = useMemo(
    () => (filter === ALL ? pool : filter === DENIED ? deniedList : pool.filter((p) => (p.setName ?? LEFT_OUT) === filter)),
    [pool, filter, deniedList],
  )
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of pool) m.set(p.setName ?? LEFT_OUT, (m.get(p.setName ?? LEFT_OUT) ?? 0) + 1)
    return m
  }, [pool])

  const save = useCallback(async (changes: Change[], { isUndo = false } = {}) => {
    if (changes.length === 0) return true
    const before = new Map(placementsRef.current.map((p) => [p.productId, { ...p }]))
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
          .map((c) => before.get(c.productId) && after.get(c.productId) ? restoreChange(before.get(c.productId)!, after.get(c.productId)!) : null)
          .filter((c): c is Change => !!c)
        setUndo({ label: describe(changes), changes: restore, id: Date.now() })
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
      setError((err as Error).message)
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

  async function createSet(name: string, cardexGroup: string, isNewCategory: boolean, productIds: number[]) {
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
      setNewSetFor(null)
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
      return
    }
    await save(productIds.map((productId) => ({ productId, setName: name, reviewed: true })))
    setSelected(new Set())
  }

  // Bulk actions on the selection
  const selectedIds = Array.from(selected)
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
    const base: Change = change.denied === false ? { productId: focus.productId } : { productId: focus.productId, reviewed: true }
    if (await save([{ ...base, ...change }])) setFocusId(next?.productId ?? null)
  }

  if (loading) {
    return (
      <div className="card-glass p-5 flex items-center gap-2 text-slate-500 text-sm">
        <Loader2 size={14} className="animate-spin" /> Loading new cards…
      </div>
    )
  }
  if (!registry || placements.length === 0) return null

  const reviewedCount = placements.filter((p) => p.reviewed).length
  const pct = Math.round((reviewedCount / placements.length) * 100)
  const destinations = [
    ...(counts.has(LEFT_OUT) ? [{ key: LEFT_OUT, label: 'Couldn’t place', category: null as string | null }] : []),
    ...categories.flatMap((cat) => registry.sets.filter((s) => s.cardexGroup === cat && counts.has(s.setName)).map((s) => ({ key: s.setName, label: s.setName, category: cat as string | null }))),
  ]
  const nameOf = (p: Placement) => cards.get(`tcg-${p.productId}`)?.name ?? p.displayName ?? defaultCardName(p.name)
  const imageOf = (p: Placement) => {
    const art = cards.get(`tcg-${p.productId}`)?.imageUrl
    return art || tcgPhotoUrl(p.productId)
  }

  return (
    <section className="card-glass">
      {/* Header + progress */}
      <div className="px-5 md:px-6 pt-5 pb-4 border-b border-slate-800">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles size={18} style={{ color: ACCENT }} />
              <h2 className="text-lg font-bold text-ink">New Riftbound cards from TCGplayer</h2>
            </div>
            <p className="text-slate-400 text-sm mt-1 max-w-2xl">
              The sync already put these in the catalog where it thinks they belong. Check its guesses —
              open a card to go through them one by one, or select several to move them together.
            </p>
          </div>
          <div className="w-full sm:w-72">
            <div className="flex items-baseline justify-between text-xs mb-1.5">
              <span className="text-slate-400"><span className="text-ink font-semibold text-base">{reviewedCount}</span> of {placements.length} reviewed</span>
              <span className="font-semibold" style={{ color: ACCENT }}>{pct}%</span>
            </div>
            <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${ACCENT}, #e0a15a)` }} />
            </div>
          </div>
        </div>
        {error && <div className="mt-3 text-xs text-red-600">{error}</div>}
      </div>

      <div className="flex flex-col lg:flex-row">
        {/* Destinations */}
        <aside className="lg:w-64 shrink-0 border-b lg:border-b-0 lg:border-r border-slate-800 p-3 lg:sticky lg:top-0 lg:self-start lg:max-h-[100dvh] lg:overflow-y-auto">
          <label className="flex items-center gap-2 text-xs text-slate-400 px-2 py-1.5 mb-1 cursor-pointer select-none">
            <input type="checkbox" checked={showReviewed} onChange={(e) => setShowReviewed(e.target.checked)} />
            Show reviewed cards
          </label>
          <div className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible">
            <DestinationButton active={filter === ALL} onClick={() => setFilter(ALL)} label={showReviewed ? 'All cards' : 'Everything to review'} count={pool.length} />
            {destinations.map((d, i) => (
              <div key={d.key} className="contents lg:block">
                {d.category && d.category !== destinations[i - 1]?.category && (
                  <div className="hidden lg:block text-[10px] uppercase tracking-wider text-slate-500 px-2 pt-3 pb-1">{d.category}</div>
                )}
                <DestinationButton
                  active={filter === d.key}
                  onClick={() => setFilter(d.key)}
                  label={d.label}
                  count={counts.get(d.key) ?? 0}
                  warn={d.key === LEFT_OUT}
                />
              </div>
            ))}
            {deniedList.length > 0 && (
              <div className="contents lg:block">
                <div className="hidden lg:block text-[10px] uppercase tracking-wider text-slate-500 px-2 pt-3 pb-1">Not used</div>
                <DestinationButton active={filter === DENIED} onClick={() => setFilter(DENIED)} label="Denied" count={deniedList.length} muted />
              </div>
            )}
          </div>
        </aside>

        {/* Grid */}
        <div className="flex-1 min-w-0 p-4 md:p-5">
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <h3 className="text-ink font-semibold">
              {filter === ALL ? (showReviewed ? 'All cards' : 'Everything to review') : filter === LEFT_OUT ? 'Couldn’t place' : filter === DENIED ? 'Denied cards' : filter}
            </h3>
            {filter === DENIED && <span className="text-xs text-slate-500">— hidden from the site, and syncs won’t add them back. Recover any you want after all.</span>}
            <span className="text-xs text-slate-500">{visible.length} card{visible.length === 1 ? '' : 's'}</span>
            {visible.length > 0 && (
              <div className="ml-auto flex items-center gap-2">
                <button
                  onClick={() => setSelected(selected.size === visible.length ? new Set() : new Set(visible.map((p) => p.productId)))}
                  className="text-xs px-3 py-1.5 rounded-lg text-slate-400 hover:text-ink hover:bg-slate-800/60"
                >
                  {selected.size === visible.length ? 'Clear selection' : 'Select all'}
                </button>
                {filter === DENIED ? (
                  <button
                    disabled={busy}
                    onClick={() => bulk(visible.map((p) => ({ productId: p.productId, denied: false })))}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-800 text-ink hover:bg-slate-700 disabled:opacity-50 flex items-center gap-1.5"
                  >
                    <RotateCcw size={13} /> Recover all ({visible.length})
                  </button>
                ) : filter === LEFT_OUT ? (
                  <button
                    disabled={busy}
                    onClick={() => bulk(visible.map((p) => ({ productId: p.productId, denied: true })))}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50 flex items-center gap-1.5"
                  >
                    <Ban size={13} /> Deny all ({visible.length})
                  </button>
                ) : visible.some((p) => !p.reviewed && p.setName) && (
                  <button
                    disabled={busy}
                    onClick={() => bulk(visible.filter((p) => !p.reviewed && p.setName).map((p) => ({ productId: p.productId, reviewed: true })))}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg text-white disabled:opacity-50 flex items-center gap-1.5 shadow-sm"
                    style={{ background: ACCENT }}
                  >
                    <Check size={13} /> All look right ({visible.filter((p) => !p.reviewed && p.setName).length})
                  </button>
                )}
              </div>
            )}
          </div>

          {visible.length === 0 ? (
            <div className="py-20 text-center">
              <div className="mx-auto w-12 h-12 rounded-full flex items-center justify-center mb-3" style={{ background: `${ACCENT}22`, color: ACCENT }}><Check size={22} /></div>
              <div className="text-ink font-semibold">{filter === DENIED ? 'No denied cards' : 'All caught up'}</div>
              <div className="text-sm text-slate-400 mt-1">{filter === DENIED ? 'Cards you deny show up here, ready to recover.' : 'Nothing left to review here.'}</div>
            </div>
          ) : (
            <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(150px,1fr))]">
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
                  showSet={filter === ALL}
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
      {selected.size > 0 && createPortal(
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 rounded-2xl bg-[#2a2018] text-[#f3e8d2] shadow-2xl px-3 py-2 border border-black/20">
          <span className="text-sm font-semibold px-2 whitespace-nowrap">{selected.size} selected</span>
          {filter === DENIED ? (
            <button disabled={busy} onClick={() => bulk(selectedIds.map((productId) => ({ productId, denied: false })))} className="text-xs font-semibold px-3 py-2 rounded-xl flex items-center gap-1.5 disabled:opacity-50 whitespace-nowrap" style={{ background: ACCENT }}>
              <RotateCcw size={13} /> Recover
            </button>
          ) : (
            <button disabled={busy} onClick={() => bulk(placements.filter((p) => selected.has(p.productId) && p.setName).map((p) => ({ productId: p.productId, reviewed: true })))} className="text-xs font-semibold px-3 py-2 rounded-xl flex items-center gap-1.5 disabled:opacity-50 whitespace-nowrap" style={{ background: ACCENT }}>
              <Check size={13} /> Looks right
            </button>
          )}
          <div className="relative">
            <button disabled={busy} onClick={() => setMoveMenu((v) => !v)} className="text-xs font-semibold px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 flex items-center gap-1.5 disabled:opacity-50 whitespace-nowrap">
              <FolderInput size={13} /> Move to…
            </button>
            {moveMenu && (
              <SetMenu
                categories={categories}
                sets={registry.sets}
                onPick={(setName: string) => bulk(selectedIds.map((productId) => (filter === DENIED ? { productId, denied: false, setName } : { productId, setName, reviewed: true })))}
                onNewSet={() => { setMoveMenu(false); setNewSetFor(selectedIds) }}
                onClose={() => setMoveMenu(false)}
              />
            )}
          </div>
          {filter !== DENIED && placements.some((p) => selected.has(p.productId) && p.reviewed) && (
            <button disabled={busy} onClick={() => bulk(placements.filter((p) => selected.has(p.productId) && p.reviewed).map((p) => ({ productId: p.productId, reviewed: false })))} className="text-xs font-semibold px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 flex items-center gap-1.5 disabled:opacity-50 whitespace-nowrap">
              <Undo2 size={13} /> Unreview
            </button>
          )}
          {filter !== DENIED && (
            <button disabled={busy} onClick={() => bulk(selectedIds.map((productId) => ({ productId, denied: true })))} className="text-xs font-semibold px-3 py-2 rounded-xl bg-red-500/80 hover:bg-red-500 flex items-center gap-1.5 disabled:opacity-50 whitespace-nowrap">
              <Ban size={13} /> Deny
            </button>
          )}
          <button onClick={() => setSelected(new Set())} title="Clear selection" className="p-2 rounded-xl hover:bg-white/10"><X size={14} /></button>
        </div>,
        document.body,
      )}

      {undo && createPortal(
        <div
          key={undo.id}
          className="fixed left-1/2 -translate-x-1/2 z-[70] flex items-center gap-3 rounded-2xl bg-[#2a2018] text-[#f3e8d2] shadow-2xl pl-4 pr-2 py-2 border border-black/20"
          style={{ bottom: selected.size > 0 ? '5.5rem' : '1.25rem' }}
        >
          <Check size={14} className="text-emerald-400 shrink-0" />
          <span className="text-sm whitespace-nowrap">{undo.label}</span>
          <button
            disabled={busy}
            onClick={runUndo}
            className="text-xs font-semibold px-3 py-1.5 rounded-xl bg-white/15 hover:bg-white/25 flex items-center gap-1.5 disabled:opacity-50"
            title="Undo (⌘Z)"
          >
            <Undo2 size={13} /> Undo
          </button>
          <button onClick={() => setUndo(null)} className="p-1.5 rounded-lg hover:bg-white/10" title="Dismiss"><X size={13} /></button>
        </div>,
        document.body,
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
          onApprove={() => actOnFocus({})}
          onMove={(setName) => actOnFocus(isDenied(focus) ? { denied: false, setName } : { setName })}
          onDeny={() => actOnFocus({ denied: true })}
          onRecover={() => actOnFocus({ denied: false })}
          onRename={(displayName) => save([{ productId: focus.productId, displayName }])}
          onUnreview={() => save([{ productId: focus.productId, reviewed: false }])}
          onNewSet={() => setNewSetFor([focus.productId])}
        />
      )}

      {newSetFor && (
        <NewSetDialog
          categories={categories}
          busy={busy}
          onCancel={() => setNewSetFor(null)}
          onCreate={(name, group, isNew) => createSet(name, group, isNew, newSetFor)}
        />
      )}
    </section>
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
        <img src={image} alt={name} loading="lazy" className={cn('w-full h-full object-cover', denied ? 'grayscale opacity-50' : p.reviewed && 'opacity-60')} />
        <span className="absolute left-1.5 bottom-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-black/60 text-white backdrop-blur-sm">
          {sourceLabel(p)}
        </span>
        {denied && (
          <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-center pointer-events-none">
            <span className="px-2.5 py-1 rounded-full bg-red-700/90 text-white text-[11px] font-bold uppercase tracking-wide flex items-center gap-1 shadow"><Ban size={11} /> Denied</span>
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
            title="Mark as not reviewed"
            className="absolute top-1.5 right-1.5 h-7 px-2 rounded-lg bg-white/90 text-ink text-[11px] font-semibold flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shadow disabled:opacity-50"
          >
            <Undo2 size={12} /> Unreview
          </button>
        )}
        {/* Quick approve */}
        {!p.reviewed && !denied && !!p.setName && !selecting && (
          <button
            disabled={busy}
            onClick={(e) => { e.stopPropagation(); onApprove() }}
            title="Looks right"
            className="absolute top-1.5 right-1.5 h-7 px-2 rounded-lg text-white text-[11px] font-semibold flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shadow disabled:opacity-50"
            style={{ background: ACCENT }}
          >
            <Check size={12} /> OK
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
        <div className="text-sm font-semibold mb-3">Move to…</div>
        <SetChoices categories={categories} sets={sets} onPick={onPick} onNewSet={onNewSet} />
      </div>
    </>
  )
}

function FocusViewer({
  placement: p, name, denied, index, total, image, price, categories, sets, busy, onClose, onPrev, onNext, onApprove, onMove, onNewSet, onDeny, onRecover, onRename, onUnreview,
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
  onApprove: () => void
  onMove: (setName: string) => void
  onNewSet: () => void
  onDeny: () => void
  onRecover: () => void
  onRename: (displayName: string) => void
  onUnreview: () => void
}) {
  const [tcgOk, setTcgOk] = useState(true)
  useEffect(() => setTcgOk(true), [p.productId])
  // Latest handlers for the one window key listener
  const keys = useRef({ onClose, onPrev, onNext, onApprove: denied ? onRecover : onApprove, busy })
  keys.current = { onClose, onPrev, onNext, onApprove: denied ? onRecover : onApprove, busy }
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
  const artIsTcgPhoto = image.includes('tcgplayer-cdn')

  return createPortal(
    <div className="fixed inset-0 z-50 bg-[#1b140e]/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="relative w-full max-w-4xl max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-3xl bg-[#f3e8d2] shadow-2xl border border-[#d6c49f]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#d6c49f]/70 text-xs text-slate-500">
          <span>Card {index + 1} of {total}</span>
          <span className="hidden sm:inline">Enter = {denied ? 'recover' : 'looks right'} · ← → to browse · Esc to close</span>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-black/5 text-slate-500"><X size={16} /></button>
        </div>

        <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-6 p-5 md:px-12 md:py-7">
          {/* Art */}
          <div className="flex items-start justify-center gap-3">
            <div className="flex-1 max-w-[280px]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={cardImage(image, 'full') ?? image} alt={name} className={cn('w-full aspect-[5/7] object-cover rounded-2xl shadow-[0_18px_40px_-14px_rgba(60,40,20,0.6)]', denied && 'grayscale opacity-60')} />
              <div className="text-[11px] text-slate-500 text-center mt-2">{artIsTcgPhoto ? 'TCGplayer photo' : 'Card art (from Riot)'}</div>
            </div>
            {!artIsTcgPhoto && (
              <div className="w-28 shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={tcgOk ? tcgPhotoUrl(p.productId) : NO_CARD_IMAGE}
                  onError={() => setTcgOk(false)}
                  alt=""
                  className="w-full aspect-[5/7] object-cover rounded-xl shadow-md"
                />
                <div className="text-[11px] text-slate-500 text-center mt-2">{tcgOk ? 'TCGplayer photo' : 'No TCGplayer photo yet'}</div>
              </div>
            )}
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

            {denied ? (
              <div className="mt-5 rounded-2xl bg-red-50/60 border border-red-200 p-4">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-red-700 mb-1"><Ban size={12} /> Denied</div>
                <div className="text-sm text-slate-600 mb-4">Hidden from the site, and syncs won’t add it back.</div>
                <button
                  disabled={busy}
                  onClick={onRecover}
                  className="w-full py-3 rounded-xl text-white font-semibold flex items-center justify-center gap-2 shadow-md disabled:opacity-60"
                  style={{ background: ACCENT }}
                >
                  {busy ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />}
                  Recover{p.previousSetName ? ` into ${p.previousSetName}` : ''}
                </button>
              </div>
            ) : (
              <div className="mt-5 rounded-2xl bg-white/40 border border-[#d6c49f]/70 p-4">
                <div className="flex items-center justify-between gap-2 text-xs text-slate-500 mb-1">
                  <span>{p.auto ? 'The sync put it in' : 'Placed in'}</span>
                  {p.reviewed && (
                    <button disabled={busy} onClick={onUnreview} className="inline-flex items-center gap-1 font-semibold hover:text-ink disabled:opacity-50" title="Put it back in the review queue">
                      <Check size={11} style={{ color: ACCENT }} /> Reviewed · <Undo2 size={11} /> Mark as not reviewed
                    </button>
                  )}
                </div>
                <div className="text-lg font-semibold text-ink mb-4">{p.setName ?? 'Nowhere yet — the sync couldn’t place it'}</div>
                <div className="flex gap-2">
                  {p.setName && (
                    <button
                      disabled={busy}
                      onClick={onApprove}
                      className="flex-1 py-3 rounded-xl text-white font-semibold flex items-center justify-center gap-2 shadow-md disabled:opacity-60"
                      style={{ background: ACCENT }}
                    >
                      {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Looks right
                    </button>
                  )}
                  <button
                    disabled={busy}
                    onClick={onDeny}
                    title="Don't use this card — hidden, and syncs won't add it back"
                    className={cn('py-3 px-4 rounded-xl font-semibold flex items-center justify-center gap-2 border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-60', !p.setName && 'flex-1')}
                  >
                    <Ban size={16} /> Deny
                  </button>
                </div>
              </div>
            )}

            <div className="mt-5">
              <div className="text-xs text-slate-500 mb-2">{denied ? 'Or recover it into' : 'Or move it to'}</div>
              <SetChoices categories={categories} sets={sets} current={denied ? undefined : p.setName} busy={busy} onPick={onMove} onNewSet={onNewSet} />
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
