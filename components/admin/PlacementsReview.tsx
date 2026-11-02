'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Check, Plus } from 'lucide-react'
import { adminFetch } from '@/lib/firebase/authFetch'
import { cn } from '@/lib/utils'

// New TCGplayer cards (staff portal → Needs Review): every Riftbound sync places promos and other
// TCGplayer-only products into the set it thinks they belong to (catalog-sync.mjs's
// discoverRiftboundProducts()). They're live in the catalog straight away; this list is for
// checking the guesses — move a card to another set, leave it out, or start a new set for it.
// Writes go through POST /api/set-registry/placements (moves the catalog card at once).

interface Placement {
  productId: number
  groupId: number
  groupName?: string
  name: string
  number: string
  setName: string | null
  auto: boolean
  reviewed: boolean
}

interface RegistrySet {
  setName: string
  cardexGroup: string | null
  tcgplayerOnly?: boolean
}

interface RegistryResponse {
  riftbound: { groupOrder: string[]; sets: RegistrySet[]; placements?: Placement[] }
}

const LEFT_OUT = '__left_out__'
const NEW_SET = '__new_set__'

export function PlacementsReview() {
  const [registry, setRegistry] = useState<RegistryResponse['riftbound'] | null>(null)
  const [loading, setLoading] = useState(true)
  const [showAll, setShowAll] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newSetFor, setNewSetFor] = useState<number[] | null>(null)

  useEffect(() => {
    // no-store: the public GET is CDN-cached for a minute, and a review needs the current list
    fetch('/api/set-registry', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: RegistryResponse | null) => setRegistry(data?.riftbound ?? null))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function save(changes: Array<{ productId: number; setName?: string | null; reviewed?: boolean }>) {
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
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

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
  }

  const placements = useMemo(() => registry?.placements ?? [], [registry])
  // Cardex categories: the registry's order, then any a set uses that it doesn't list ("Special").
  const categories = useMemo(() => {
    const list = [...(registry?.groupOrder ?? [])]
    for (const s of registry?.sets ?? []) if (s.cardexGroup && !list.includes(s.cardexGroup)) list.push(s.cardexGroup)
    return list
  }, [registry])
  const shown = showAll ? placements : placements.filter((p) => !p.reviewed)
  // Grouped by where they landed; the cards the sync couldn't place come first.
  const groups = useMemo(() => {
    const map = new Map<string, Placement[]>()
    for (const p of shown) {
      const key = p.setName ?? LEFT_OUT
      map.set(key, [...(map.get(key) ?? []), p])
    }
    return Array.from(map.entries()).sort(([a], [b]) => (a === LEFT_OUT ? -1 : b === LEFT_OUT ? 1 : a.localeCompare(b)))
  }, [shown])

  if (loading) {
    return (
      <div className="card-glass p-5 flex items-center gap-2 text-slate-500 text-sm">
        <Loader2 size={14} className="animate-spin" /> Loading new cards…
      </div>
    )
  }
  if (!registry || placements.length === 0) return null

  const unreviewed = placements.filter((p) => !p.reviewed).length

  return (
    <div className="card-glass p-5">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h2 className="text-ink font-semibold">New Riftbound cards from TCGplayer</h2>
        <label className="flex items-center gap-1.5 text-xs text-slate-400 shrink-0">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          Show reviewed
        </label>
      </div>
      <p className="text-slate-400 text-sm mb-4">
        The sync put these in the set it thinks they belong to, and they&apos;re already in the catalog. Move any that are
        wrong — changes apply right away. {unreviewed} waiting for review.
      </p>
      {error && <div className="text-xs text-red-600 mb-3">{error}</div>}
      {shown.length === 0 && <div className="text-sm text-slate-400">All caught up.</div>}

      <div className="space-y-5">
        {groups.map(([key, list]) => (
          <div key={key}>
            <div className="flex items-center gap-2 mb-2">
              <span className={cn('text-sm font-semibold', key === LEFT_OUT ? 'text-amber-600' : 'text-ink')}>
                {key === LEFT_OUT ? 'Couldn’t place — left out' : key}
              </span>
              <span className="text-[11px] text-slate-500">{list.length}</span>
              {list.some((p) => !p.reviewed) && (
                <button
                  disabled={busy}
                  onClick={() => save(list.filter((p) => !p.reviewed).map((p) => ({ productId: p.productId, reviewed: true })))}
                  className="ml-auto text-[11px] font-medium px-2 py-1 rounded-lg bg-cyan-600/20 text-cyan-700 hover:bg-cyan-600/30 disabled:opacity-50"
                >
                  Approve all {list.filter((p) => !p.reviewed).length}
                </button>
              )}
            </div>
            <div className="space-y-1.5">
              {list.map((p) => (
                <PlacementRow
                  key={p.productId}
                  placement={p}
                  sets={registry.sets}
                  groupOrder={categories}
                  busy={busy}
                  onMove={(setName) => save([{ productId: p.productId, setName, reviewed: true }])}
                  onApprove={() => save([{ productId: p.productId, reviewed: true }])}
                  onNewSet={() => setNewSetFor([p.productId])}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {newSetFor && (
        <NewSetDialog
          categories={categories}
          busy={busy}
          onCancel={() => setNewSetFor(null)}
          onCreate={(name, group, isNew) => createSet(name, group, isNew, newSetFor)}
        />
      )}
    </div>
  )
}

function PlacementRow({
  placement: p, sets, groupOrder, busy, onMove, onApprove, onNewSet,
}: {
  placement: Placement
  sets: RegistrySet[]
  groupOrder: string[]
  busy: boolean
  onMove: (setName: string | null) => void
  onApprove: () => void
  onNewSet: () => void
}) {
  return (
    <div className={cn('flex items-center gap-3 bg-slate-900/50 border border-slate-800 rounded-lg p-2', p.reviewed && 'opacity-60')}>
      <img
        src={`https://tcgplayer-cdn.tcgplayer.com/product/${p.productId}_200w.jpg`}
        alt=""
        loading="lazy"
        className="w-9 h-12 object-cover rounded shrink-0 bg-slate-800"
      />
      <div className="min-w-0 flex-1">
        <a
          href={`https://www.tcgplayer.com/product/${p.productId}`}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-ink hover:underline truncate block"
        >
          {p.name}
        </a>
        <div className="text-[11px] text-slate-500 truncate">
          {p.number} · {p.groupName ?? `TCGplayer group ${p.groupId}`}{p.auto ? ' · sync’s guess' : ''}
        </div>
      </div>
      <select
        disabled={busy}
        value={p.setName ?? LEFT_OUT}
        onChange={(e) => {
          const v = e.target.value
          if (v === NEW_SET) onNewSet()
          else onMove(v === LEFT_OUT ? null : v)
        }}
        className="bg-slate-950 border border-slate-800 rounded px-1.5 py-1 text-xs text-slate-300 max-w-[11rem]"
      >
        {groupOrder.map((g) => (
          <optgroup key={g} label={g}>
            {sets.filter((s) => s.cardexGroup === g).map((s) => <option key={s.setName} value={s.setName}>{s.setName}</option>)}
          </optgroup>
        ))}
        {sets.some((s) => !s.cardexGroup || !groupOrder.includes(s.cardexGroup)) && (
          <optgroup label="Other">
            {sets.filter((s) => !s.cardexGroup || !groupOrder.includes(s.cardexGroup)).map((s) => <option key={s.setName} value={s.setName}>{s.setName}</option>)}
          </optgroup>
        )}
        <option value={LEFT_OUT}>Leave out</option>
        <option value={NEW_SET}>New set…</option>
      </select>
      {!p.reviewed && (
        <button
          disabled={busy}
          onClick={onApprove}
          title="Looks right"
          className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center bg-cyan-600/20 text-cyan-700 hover:bg-cyan-600/30 disabled:opacity-50"
        >
          <Check size={14} />
        </button>
      )}
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
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const isNew = group === NEW_CATEGORY
  const category = isNew ? newCategory.trim() : group
  const taken = isNew && categories.some((c) => c.toLowerCase() === category.toLowerCase())
  const ready = !busy && !!name.trim() && !!category && !taken
  const submit = () => { if (ready) onCreate(name.trim(), category, isNew) }

  // Portalled to <body>: inside the review card (whose backdrop-filter makes it the containing
  // block for `fixed`) the dialog centred on the whole long list and focusing it scrolled the page.
  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="card-glass p-5 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
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
            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-cyan-600/20 text-cyan-700 hover:bg-cyan-600/30 disabled:opacity-50 flex items-center gap-1"
          >
            <Plus size={12} /> Create &amp; move
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
