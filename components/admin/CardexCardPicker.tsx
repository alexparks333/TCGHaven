'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import dynamic from 'next/dynamic'
import { X, Loader2 } from 'lucide-react'
import { RARITY_LABELS_BY_GAME } from '@/lib/utils'
import type { BadgeSlot, SlotCard } from '@/lib/badges'
import type { Game } from '@/lib/types'
import type { CatalogCard } from '@/components/pages/CardexPage'

// "Pick from the Cardex" in the badge editor: the real Cardex (same sets, groups, rarity filters
// and search), every card in full colour. Click a card to select it, Shift+Click to select
// everything between it and the last one clicked; pick across as many sets as you like. "Add"
// makes one slot per picked card — plus, for each, the other printings of the same card (same set
// and number) whose rarities you tick (e.g. its Signature), which count for that slot too.

const CardexPage = dynamic(() => import('@/components/pages/CardexPage'), { ssr: false })

export interface CatalogRow {
  id: string
  name: string
  number: string
  setName: string
  rarity?: string
  imageUrl?: string
  isHidden?: boolean
}

export const rarityLabel = (game: Game, r?: string) => (r ? RARITY_LABELS_BY_GAME[game]?.[r] ?? r : 'No rarity')
const toSlotCard = (c: { id: string; name: string; setName: string; number: string; imageUrl?: string }): SlotCard =>
  ({ id: c.id, name: c.name, setName: c.setName, number: c.number, imageUrl: c.imageUrl })
// A slot is named after the card (Riftbound names its Signatures "X (Signature)")
const slotLabel = (name: string) => name.replace(/\s*\((Signature|Alt Art|Overnumbered)\)\s*$/i, '').trim()

/** The other printings of a card: same set, same collector number, different card. */
export function siblingsOf(card: { id: string; number?: string }, setCards: CatalogRow[]): CatalogRow[] {
  return setCards.filter((c) => c.number === card.number && c.id !== card.id)
}

const setCache = new Map<string, Promise<CatalogRow[]>>()
export function fetchSetCards(game: Game, setName: string): Promise<CatalogRow[]> {
  const key = `${game}|${setName}`
  if (!setCache.has(key)) {
    setCache.set(key, fetch(`/api/admin/catalog?game=${game}&set=${encodeURIComponent(setName)}`)
      .then((r) => r.json())
      .then((rows: CatalogRow[]) => (Array.isArray(rows) ? rows.filter((c) => !c.isHidden) : []))
      .catch(() => { setCache.delete(key); return [] }))
  }
  return setCache.get(key)!
}

export default function CardexCardPicker({ game, onAdd, onClose, title, addLabel }: {
  game: Game
  onAdd: (slots: BadgeSlot[]) => void
  onClose: () => void
  title?: string                        // e.g. adding to one slot: 'Add cards to "Lee Sin"'
  addLabel?: (n: number) => string
}) {
  const [picked, setPicked] = useState<Map<string, CatalogCard>>(new Map())
  const [setRows, setSetRows] = useState<Record<string, CatalogRow[]>>({})
  const [alsoCount, setAlsoCount] = useState<Set<string>>(new Set(['Star']))
  const selected = useMemo(() => new Set(picked.keys()), [picked])

  // Escape closes just the picker
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  // Load the sets the picked cards come from, to know their other printings
  const pickedSets = useMemo(() => Array.from(new Set(Array.from(picked.values()).map((c) => c.setName))), [picked])
  useEffect(() => {
    for (const s of pickedSets) if (!setRows[s]) fetchSetCards(game, s).then((rows) => setSetRows((r) => ({ ...r, [s]: rows })))
  }, [pickedSets, game, setRows])

  const siblingRarities = useMemo(() => {
    const out = new Set<string>()
    picked.forEach((c) => { for (const s of siblingsOf(c, setRows[c.setName] ?? [])) if (!picked.has(s.id)) out.add(s.rarity ?? '') })
    return Array.from(out)
  }, [picked, setRows])

  function select(cards: CatalogCard[], on: boolean) {
    setPicked((m) => {
      const next = new Map(m)
      for (const c of cards) { if (on) next.set(c.id, c); else next.delete(c.id) }
      return next
    })
  }

  function add() {
    const slots: BadgeSlot[] = Array.from(picked.values()).map((c) => {
      const extra = siblingsOf(c, setRows[c.setName] ?? []).filter((s) => !picked.has(s.id) && alsoCount.has(s.rarity ?? ''))
      const all = [toSlotCard(c), ...extra.map(toSlotCard)]
      return { label: slotLabel(c.name), cardIds: all.map((x) => x.id), cards: all }
    })
    onAdd(slots)
    onClose()
  }

  const loadingSiblings = pickedSets.some((s) => !setRows[s])
  const toggle = (r: string) => setAlsoCount((s) => { const n = new Set(s); if (n.has(r)) n.delete(r); else n.add(r); return n })

  return createPortal(
    <div className="fixed inset-0 z-[80] flex flex-col bg-slate-950" role="dialog" aria-label="Pick cards from the Cardex">
      <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-800">
        <div>
          <div className="text-base font-bold text-ink">{title ?? 'Pick cards from the Cardex'}</div>
          <div className="text-xs text-slate-500">Click to select · Shift+Click to select a range · pick from as many sets as you like</div>
        </div>
        <button onClick={onClose} aria-label="Close" className="ml-auto w-9 h-9 flex items-center justify-center rounded-lg text-slate-500 hover:text-ink hover:bg-slate-800"><X size={18} /></button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
        <CardexPage picker={{ game, selected, onSelect: select }} />
      </div>

      <div className="border-t border-slate-800 bg-slate-950 px-5 py-3 flex flex-wrap items-center gap-3">
        <span className="text-sm font-bold text-ink">{picked.size} picked</span>
        {picked.size > 0 && <button className="text-xs font-semibold text-slate-500 hover:text-ink" onClick={() => setPicked(new Map())}>Clear</button>}
        {(siblingRarities.length > 0 || loadingSiblings) && picked.size > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
            <span>Also counts:</span>
            {loadingSiblings && <Loader2 size={12} className="animate-spin" />}
            {siblingRarities.map((r) => (
              <label key={r} className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-slate-700 text-ink cursor-pointer">
                <input type="checkbox" checked={alsoCount.has(r)} onChange={() => toggle(r)} />
                {rarityLabel(game, r)}
              </label>
            ))}
          </div>
        )}
        <div className="ml-auto flex gap-2">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={add} disabled={!picked.size} className="btn-primary disabled:opacity-50">
            {addLabel ? addLabel(picked.size) : `Add ${picked.size || ''} slot${picked.size === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
