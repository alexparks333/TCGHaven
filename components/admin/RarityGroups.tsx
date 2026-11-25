'use client'

import { useMemo, useState } from 'react'
import { Check, Loader2, Pencil, Plus, Trash2, X, Hand, ArrowUp, ArrowDown } from 'lucide-react'
import { sortRarities } from '@/lib/rarityOrder'

// A set's rarity groups (2026-11-24, the Owner's call) — opened from Admin Catalog's set line. A new
// set's cards are grouped by the rarity their sync reports; here staff fix the groups themselves:
// rename one (all its cards move to the new name), delete one (its cards move to another group first),
// or add an empty one to move cards into from each card's Rarity dropdown. Every move is a hand
// override the syncs keep (scripts/lib/rarity-override.mjs). ↑ / ↓ set the order of the set's rarity bubbles,
// here and in the Cardex (lib/rarityOrder.ts).

export interface RarityCard { id: string; name: string; rarity?: string; rarityOverride?: string; rarityAuto?: string }

export function RarityGroups({ setName, cards, added, label, busy, onAdd, onForget, onMove, order, onReorder, onClose }: {
  setName: string
  cards: RarityCard[]
  /** Groups added here that no card is in yet (kept by the page while it's open) */
  added: string[]
  label: (rarity: string) => string
  busy: boolean
  onAdd: (name: string) => void
  onForget: (name: string) => void
  /** Move these cards to `to` (each becomes a hand override) */
  onMove: (cards: RarityCard[], to: string) => Promise<void>
  /** The set's saved bubble order (none = the shared default) */
  order?: string[]
  /** Save the set's bubble order (every group, top to bottom) */
  onReorder: (list: string[]) => Promise<void>
  onClose: () => void
}) {
  const groups = useMemo(() => {
    const m = new Map<string, RarityCard[]>()
    for (const c of cards) {
      const r = c.rarity || '—'
      m.set(r, [...(m.get(r) ?? []), c])
    }
    for (const a of added) if (!m.has(a)) m.set(a, [])
    return sortRarities(Array.from(m.keys()), order).map((g) => [g, m.get(g)!] as [string, RarityCard[]])
  }, [cards, added, order])
  const names = groups.map(([g]) => g)

  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameTo, setRenameTo] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const [moveTo, setMoveTo] = useState('')
  const [newName, setNewName] = useState('')
  const [error, setError] = useState('')

  /** Move one group up or down; saves the whole set's order as shown */
  function move(i: number, by: -1 | 1) {
    const list = [...names]
    const j = i + by
    if (j < 0 || j >= list.length) return
    ;[list[i], list[j]] = [list[j], list[i]]
    void onReorder(list)
  }

  async function rename(from: string, list: RarityCard[]) {
    const to = renameTo.trim().replace(/\s+/g, ' ')
    setError('')
    if (!to || to === from) { setRenaming(null); return }
    if (list.length === 0) { onForget(from); onAdd(to) } else await onMove(list, to)
    // the renamed group keeps its place in the order
    if (order?.length) await onReorder(names.map((n) => (n === from ? to : n)).filter((n, i, a) => a.indexOf(n) === i))
    setRenaming(null)
  }

  async function remove(from: string, list: RarityCard[]) {
    setError('')
    if (list.length === 0) onForget(from)
    else {
      if (!moveTo || moveTo === from) { setError('Pick the group its cards move to first.'); return }
      await onMove(list, moveTo)
    }
    if (order?.includes(from)) await onReorder(names.filter((n) => n !== from))
    setDeleting(null)
  }

  function add() {
    const name = newName.trim().replace(/\s+/g, ' ')
    setError('')
    if (!name) return
    if (names.some((n) => n.toLowerCase() === name.toLowerCase() || label(n).toLowerCase() === name.toLowerCase())) { setError(`There's already a “${name}” group.`); return }
    onAdd(name)
    setNewName('')
  }

  const input = 'flex-1 min-w-0 bg-slate-950 border border-slate-700 focus:border-violet-600 rounded-lg px-2 py-1 text-sm text-ink outline-none'

  return (
    <div className="card-glass p-5">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h2 className="text-lg font-bold text-ink">Rarity groups — {setName}</h2>
        <button onClick={onClose} aria-label="Close" className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-ink hover:bg-slate-800"><X size={18} /></button>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        The sync groups a new set&rsquo;s cards by the rarity it reports. Rename or delete a group here, or add one and move cards into it with
        each card&rsquo;s Rarity dropdown. ↑ / ↓ set the order of the set&rsquo;s rarity bubbles, here and in the Cardex. Every change is a hand override (<Hand size={11} className="inline -mt-0.5" />) that syncs keep; set a card
        back to its automatic rarity any time.
      </p>

      <div className="rounded-2xl border border-slate-800 bg-slate-950/60 divide-y divide-slate-800">
        {groups.map(([g, list], i) => {
          const byHand = list.filter((c) => c.rarityOverride).length
          return (
            <div key={g} className="px-3 py-2.5">
              {renaming === g ? (
                <form onSubmit={(e) => { e.preventDefault(); void rename(g, list) }} className="flex items-center gap-2">
                  <input autoFocus value={renameTo} onChange={(e) => setRenameTo(e.target.value)} maxLength={60} aria-label={`New name for ${label(g)}`} className={input} />
                  <button type="submit" disabled={busy} className="btn-primary !py-1 !px-3 text-xs">{busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}Rename</button>
                  <button type="button" onClick={() => setRenaming(null)} className="text-xs text-slate-500 hover:text-ink px-2">Cancel</button>
                </form>
              ) : deleting === g ? (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-ink">Delete <b>{label(g)}</b>{list.length ? <> — move its {list.length} card{list.length === 1 ? '' : 's'} to</> : '?'}</span>
                  {list.length > 0 && (
                    <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)} aria-label="Move its cards to" className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-sm text-ink">
                      <option value="">Choose a group…</option>
                      {names.filter((n) => n !== g).map((n) => <option key={n} value={n}>{label(n)}</option>)}
                    </select>
                  )}
                  <button onClick={() => void remove(g, list)} disabled={busy} className="flex items-center gap-1 rounded-lg bg-red-600 text-white px-3 py-1 text-xs font-semibold hover:bg-red-500 disabled:opacity-60">
                    {busy ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}Delete group
                  </button>
                  <button onClick={() => setDeleting(null)} className="text-xs text-slate-500 hover:text-ink px-2">Cancel</button>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  {/* the bubble order, top = first (here and in the Cardex) */}
                  <span className="flex flex-col -my-1 shrink-0">
                    <button onClick={() => move(i, -1)} disabled={busy || i === 0} aria-label={`Move ${label(g)} up`} title="Move up"
                      className="w-6 h-5 flex items-center justify-center rounded text-slate-500 hover:text-ink hover:bg-slate-800 disabled:opacity-25 disabled:hover:bg-transparent"><ArrowUp size={13} /></button>
                    <button onClick={() => move(i, 1)} disabled={busy || i === groups.length - 1} aria-label={`Move ${label(g)} down`} title="Move down"
                      className="w-6 h-5 flex items-center justify-center rounded text-slate-500 hover:text-ink hover:bg-slate-800 disabled:opacity-25 disabled:hover:bg-transparent"><ArrowDown size={13} /></button>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-sm font-semibold text-ink">{label(g)}</span>
                    {label(g) !== g && <span className="ml-1.5 text-[0.6875rem] text-slate-500">stored as “{g}”</span>}
                    <span className="ml-2 text-xs text-slate-500">{list.length} card{list.length === 1 ? '' : 's'}{byHand ? ` · ${byHand} by hand` : ''}{list.length === 0 ? ' · new' : ''}</span>
                  </span>
                  <button onClick={() => { setRenaming(g); setRenameTo(label(g)); setDeleting(null); setError('') }} disabled={busy}
                    className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-ink px-2 py-1 rounded-lg hover:bg-slate-800"><Pencil size={12} />Rename</button>
                  <button onClick={() => { setDeleting(g); setMoveTo(''); setRenaming(null); setError('') }} disabled={busy}
                    className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-red-600 px-2 py-1 rounded-lg hover:bg-slate-800"><Trash2 size={12} />Delete</button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); add() }} className="mt-3 flex items-center gap-2">
        <input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={60} placeholder="New group, e.g. Rune" aria-label="New group name" className={input} />
        <button type="submit" disabled={!newName.trim()} className="btn-secondary !py-1.5 text-xs disabled:opacity-50"><Plus size={13} />Add group</button>
      </form>
      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
      <p className="text-[0.6875rem] text-slate-500 mt-3">
        A new group is only kept once a card is in it. Renaming a special rarity (Overnumbered, Overnumbered Signature, Alt Art, Ultimate)
        gives its cards the plain look of an ordinary rarity in the Cardex.
      </p>
    </div>
  )
}
