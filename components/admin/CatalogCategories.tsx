'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Check, FolderTree, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react'
import { adminFetch } from '@/lib/firebase/authFetch'
import { cn } from '@/lib/utils'
import type { Game } from '@/lib/types'

// Cardex categories for the Admin Catalog ("Main Sets", "Promos", "Special"…): the set picker is
// grouped by them, and the Categories panel adds, renames, reorders and deletes them and moves
// sets between them. Only Lorcana and Riftbound have curated categories (registry groupOrder +
// each set's cardexGroup); Pokémon's set picker groups by its era (series) instead. Writes go
// through POST /api/set-registry/categories.

export type CategoryGame = 'lorcana' | 'riftbound'
export const hasCategories = (game: Game): game is CategoryGame => game === 'lorcana' || game === 'riftbound'

interface CategoryState {
  order: string[]                       // categories in Cardex order (incl. ones only sets use)
  setCategory: Map<string, string | null> // setName → category
}

export function useCategories(game: Game) {
  const [state, setState] = useState<CategoryState | null>(null)

  const load = useCallback(() => {
    if (!hasCategories(game)) { setState(null); return }
    // no-store: the public GET is CDN-cached for a minute
    fetch('/api/set-registry', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((reg) => {
        const side = reg?.[game]
        if (!side) return
        const order: string[] = [...(side.groupOrder ?? [])]
        for (const s of side.sets ?? []) if (s.cardexGroup && !order.includes(s.cardexGroup)) order.push(s.cardexGroup)
        setState({ order, setCategory: new Map((side.sets ?? []).map((s: { setName: string; cardexGroup: string | null }) => [s.setName, s.cardexGroup])) })
      })
      .catch(() => {})
  }, [game])
  useEffect(() => { setState(null); load() }, [load])

  const act = useCallback(async (body: Record<string, unknown>) => {
    const res = await adminFetch('/api/set-registry/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game, ...body }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
    setState({
      order: data.groupOrder,
      setCategory: new Map((data.sets as Array<{ setName: string; cardexGroup: string | null }>).map((s) => [s.setName, s.cardexGroup])),
    })
  }, [game])

  return { categories: state, reload: load, act }
}

/** The set picker's sections: [label, sets][] — or null for a flat list. */
export function groupSets<T extends { name: string; series?: string }>(
  game: Game, sets: T[], categories: CategoryState | null,
): Array<[string, T[]]> | null {
  if (hasCategories(game) && categories) {
    const groups = new Map<string, T[]>(categories.order.map((c) => [c, []]))
    const other: T[] = []
    for (const s of sets) {
      const cat = categories.setCategory.get(s.name)
      if (cat && groups.has(cat)) groups.get(cat)!.push(s)
      else other.push(s)
    }
    const out = Array.from(groups.entries()).filter(([, list]) => list.length > 0)
    if (other.length) out.push(['No category', other])
    return out
  }
  if (game === 'pokemon' && sets.some((s) => s.series)) {
    const groups = new Map<string, T[]>()
    for (const s of sets) {
      const label = s.series || 'Other'
      groups.set(label, [...(groups.get(label) ?? []), s])
    }
    return Array.from(groups.entries())
  }
  return null
}

export function CategoriesPanel({
  game, setNames, categories, act, onClose, onOpenSet,
}: {
  game: CategoryGame
  setNames: string[]          // every set the picker lists, in its order
  categories: CategoryState
  act: (body: Record<string, unknown>) => Promise<void>
  onClose: () => void
  onOpenSet: (setName: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [newName, setNewName] = useState('')

  const run = async (body: Record<string, unknown>) => {
    setBusy(true)
    setError(null)
    try { await act(body); return true } catch (err) { setError((err as Error).message); return false } finally { setBusy(false) }
  }
  const move = (i: number, dir: -1 | 1) => {
    const order = [...categories.order]
    const j = i + dir
    if (j < 0 || j >= order.length) return
    ;[order[i], order[j]] = [order[j], order[i]]
    run({ action: 'reorder', order })
  }

  const setsIn = useMemo(() => {
    const m = new Map<string, string[]>(categories.order.map((c) => [c, []]))
    const none: string[] = []
    for (const name of setNames) {
      const cat = categories.setCategory.get(name)
      if (cat && m.has(cat)) m.get(cat)!.push(name)
      else none.push(name)
    }
    return { m, none }
  }, [categories, setNames])

  return (
    <div className="card-glass p-4 md:p-5 mb-4">
      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="flex items-center gap-2">
          <FolderTree size={16} className="text-slate-400" />
          <h3 className="text-ink font-semibold">Categories <span className="text-slate-500 font-normal text-sm capitalize">· {game}</span></h3>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:text-ink hover:bg-slate-800/60"><X size={15} /></button>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        The sections of the Cardex set picker (and this page’s set list), in order. Move a set with its menu.
        {game === 'riftbound' && ' “Special” also holds the Cardex’s Other Special Cards.'}
      </p>
      {error && <div className="text-xs text-red-600 mb-3">{error}</div>}

      <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(260px,1fr))]">
        {categories.order.map((cat, i) => {
          const list = setsIn.m.get(cat) ?? []
          return (
            <div key={cat} className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <span className="text-[10px] font-semibold text-slate-500 w-4 text-center">{i + 1}</span>
                {renaming === cat ? (
                  <>
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={async (e) => {
                        if (e.key === 'Escape') setRenaming(null)
                        if (e.key === 'Enter' && renameValue.trim() && await run({ action: 'rename', from: cat, to: renameValue.trim() })) setRenaming(null)
                      }}
                      className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-sm text-ink"
                    />
                    <button disabled={busy || !renameValue.trim()} onClick={async () => { if (await run({ action: 'rename', from: cat, to: renameValue.trim() })) setRenaming(null) }} className="p-1 rounded text-emerald-700 hover:bg-slate-800 disabled:opacity-40" title="Save"><Check size={14} /></button>
                    <button onClick={() => setRenaming(null)} className="p-1 rounded text-slate-500 hover:bg-slate-800" title="Cancel"><X size={14} /></button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 min-w-0 truncate text-sm font-semibold text-ink">{cat}</span>
                    <span className="text-[11px] text-slate-500 mr-1">{list.length}</span>
                    <button disabled={busy} onClick={() => { setRenaming(cat); setRenameValue(cat) }} className="p-1 rounded text-slate-500 hover:text-ink hover:bg-slate-800" title="Rename"><Pencil size={12} /></button>
                    <button disabled={busy || i === 0} onClick={() => move(i, -1)} className="p-1 rounded text-slate-500 hover:text-ink hover:bg-slate-800 disabled:opacity-30" title="Move up"><ArrowUp size={12} /></button>
                    <button disabled={busy || i === categories.order.length - 1} onClick={() => move(i, 1)} className="p-1 rounded text-slate-500 hover:text-ink hover:bg-slate-800 disabled:opacity-30" title="Move down"><ArrowDown size={12} /></button>
                    <button
                      disabled={busy || list.length > 0}
                      onClick={() => run({ action: 'delete', name: cat })}
                      className="p-1 rounded text-red-600 hover:bg-red-100/40 disabled:opacity-30 disabled:text-slate-500"
                      title={list.length ? 'Move its sets out first' : 'Delete this empty category'}
                    >
                      <Trash2 size={12} />
                    </button>
                  </>
                )}
              </div>
              <div className="space-y-1">
                {list.length === 0 && <div className="text-xs text-slate-600 italic px-1 py-2">Empty — move a set here, or delete it.</div>}
                {list.map((name) => (
                  <SetRow key={name} name={name} category={cat} categories={categories.order} busy={busy} onOpen={() => onOpenSet(name)} onMove={(to) => run({ action: 'assign', setName: name, category: to })} />
                ))}
              </div>
            </div>
          )
        })}

        {setsIn.none.length > 0 && (
          <div className="rounded-xl border border-dashed border-amber-400/60 p-3">
            <div className="text-sm font-semibold text-amber-700 mb-2">No category <span className="text-[11px] font-normal text-slate-500">— not in the Cardex picker</span></div>
            <div className="space-y-1">
              {setsIn.none.map((name) => (
                <SetRow key={name} name={name} category={null} categories={categories.order} busy={busy} onOpen={() => onOpenSet(name)} onMove={(to) => run({ action: 'assign', setName: name, category: to })} />
              ))}
            </div>
          </div>
        )}

        {/* New category */}
        <div className="rounded-xl border border-dashed border-slate-700 p-3 flex flex-col justify-center">
          <div className="text-sm font-semibold text-slate-400 mb-2">New category</div>
          <div className="flex gap-1.5">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={async (e) => { if (e.key === 'Enter' && newName.trim() && await run({ action: 'add', name: newName.trim() })) setNewName('') }}
              placeholder="e.g. Collector Bundles"
              className="flex-1 min-w-0 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-sm text-ink"
            />
            <button
              disabled={busy || !newName.trim()}
              onClick={async () => { if (await run({ action: 'add', name: newName.trim() })) setNewName('') }}
              className="px-2.5 rounded-lg bg-violet-600 text-white text-sm disabled:opacity-40 flex items-center gap-1"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Add
            </button>
          </div>
          <div className="text-[11px] text-slate-500 mt-1.5">Added at the end — move it up to place it.</div>
        </div>
      </div>
    </div>
  )
}

function SetRow({
  name, category, categories, busy, onOpen, onMove,
}: { name: string; category: string | null; categories: string[]; busy: boolean; onOpen: () => void; onMove: (to: string) => void }) {
  return (
    <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-800/50 group">
      <button onClick={onOpen} className="flex-1 min-w-0 text-left text-sm text-slate-300 hover:text-ink truncate" title="Open this set">{name}</button>
      <select
        disabled={busy}
        value={category ?? ''}
        onChange={(e) => e.target.value && onMove(e.target.value)}
        title="Move to another category"
        className={cn('bg-slate-950 border border-slate-800 rounded px-1 py-0.5 text-[11px] text-slate-400 max-w-[8rem]', 'opacity-60 group-hover:opacity-100')}
      >
        {category === null && <option value="">Move to…</option>}
        {categories.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
    </div>
  )
}
