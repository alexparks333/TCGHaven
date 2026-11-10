'use client'

// After the iPhone scanner (lib/scan/scanner.ts): every scanned card, its printing, condition and
// quantity, one last look before "Add N cards". Each card is saved exactly the way Add Card saves
// one picked from the search (handleSubmit in AddCardDialog.tsx — keep the two in step), from the
// same catalog rows Add Card uses (/api/cards/search?id=, fetched here for the cards kept).

import { useEffect, useMemo, useState } from 'react'
import { X, Loader2, AlertCircle } from 'lucide-react'
import { useStore } from '@/lib/store'
import { useAuth } from '@/components/auth/AuthProvider'
import { newCardRef, saveCard } from '@/lib/firebase/db'
import { CONDITION_LABELS, hasPrintings, type Card, type Condition, type Edition, type Finish, type Language } from '@/lib/types'
import {
  EDITION_LABELS, FINISH_LABELS, editionsOf, finishesOf, defaultEdition, defaultFinish, variantPrice,
} from '@/scripts/lib/pokemon-variants.mjs'
import type { CardSearchResult } from '@/lib/api/search'
import type { ScannedCard } from '@/lib/scan/scanner'
import type { ScanMatch } from '@/lib/scan/server'
import { cn, localDateString, isFirstCopyOfCard, formatCurrency } from '@/lib/utils'
import { useScrollLock } from '@/lib/useScrollLock'
import { cardImage } from '@/lib/cardImage'

const CONDITIONS = Object.entries(CONDITION_LABELS) as [Condition, string][]

interface Row {
  rowId: string
  options: ScanMatch[]
  choice: number
  needsPick: boolean   // the scanner wasn't sure — ask before adding
  foil?: boolean       // games priced as regular / foil rows (set once the rows load)
  edition?: Edition    // Pokémon printings
  finish?: Finish
  condition: Condition
  quantity: number
  slab: ScannedCard['slab']   // graded: company + grade from the slab's label
}

type Rows = CardSearchResult[] | 'loading' | 'error'

function vpOf(r: CardSearchResult): Record<string, number> | null {
  return r.variantPrices && Object.keys(r.variantPrices).length ? r.variantPrices : null
}

// The printing a freshly picked card starts on — the same default as Add Card's selectCard()
function defaultsFor(rows: CardSearchResult[]) {
  const base = rows.find((r) => !r.isFoil) ?? rows[0]
  const vp = vpOf(base)
  const edition = vp ? (defaultEdition(vp) as Edition) : undefined
  const finish = vp && edition ? (defaultFinish(vp, edition, base.isFoil) as Finish) : undefined
  return { foil: !vp && base.isFoil, edition, finish }
}

// The catalog row and price for what's picked — the same rule as Add Card's catalogMarketPrice()
function picked(row: Row, rows: CardSearchResult[]): { result: CardSearchResult; price: number; isFoil: boolean } {
  const vp = vpOf(rows[0])
  if (vp) {
    const isFoil = !!row.finish && row.finish !== 'normal'
    return { result: rows[0], price: variantPrice(vp, { edition: row.edition, finish: row.finish, isFoil }), isFoil }
  }
  const result = rows.find((r) => r.isFoil === !!row.foil) ?? rows[0]
  const price = result.isFoil ? (result.marketPriceFoil > 0 ? result.marketPriceFoil : result.marketPrice) : result.marketPrice
  return { result, price: price > 0 ? price : 0, isFoil: result.isFoil }
}

async function loadRows(m: ScanMatch): Promise<CardSearchResult[]> {
  const params = new URLSearchParams({ game: m.game, q: m.name, id: m.id })
  if (m.language === 'ja') params.set('lang', 'ja')
  const res = await fetch(`/api/cards/search?${params}`)
  if (!res.ok) throw new Error(`search ${res.status}`)
  const rows = (await res.json()) as CardSearchResult[]
  if (rows.length === 0) throw new Error('card not found')
  return rows
}

export function ScanReviewDialog({ scanned, onClose }: { scanned: ScannedCard[]; onClose: () => void }) {
  useScrollLock(true)
  const { user } = useAuth()
  const { addCard, cards: allCards, pushCardUnlock } = useStore()

  // The same card scanned twice is one row with quantity 2
  const [rows, setRows] = useState<Row[]>(() => {
    const out: Row[] = []
    for (const s of scanned) {
      const key = s.options[s.choice].key
      // (graded cards stay one row each — each slab is its own grade)
      const same = s.status === 'matched' && !s.slab && !s.printing && out.find((r) => !r.needsPick && !r.slab && r.foil === undefined && r.edition === undefined && r.options[r.choice].key === key)
      if (same) { same.quantity += 1; continue }
      // The finish picked in the scanner's card sheet, when one was
      const picked = s.printing
        ? s.printing.includes(':')
          ? { edition: s.printing.split(':')[0] as Edition, finish: s.printing.split(':')[1] as Finish }
          : { foil: s.printing === 'foil' }
        : {}
      out.push({ rowId: s.scanId, options: s.options, choice: s.choice, needsPick: s.status !== 'matched', condition: 'near_mint', quantity: 1, slab: s.slab, ...picked })
    }
    return out
  })
  const [catalogRows, setCatalogRows] = useState<Record<string, Rows>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const update = (rowId: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r)))

  // Load the catalog rows of each card's current pick (once per card)
  useEffect(() => {
    for (const row of rows) {
      const m = row.options[row.choice]
      if (catalogRows[m.key]) continue
      setCatalogRows((c) => ({ ...c, [m.key]: 'loading' }))
      loadRows(m)
        .then((r) => {
          setCatalogRows((c) => ({ ...c, [m.key]: r }))
          // Start on the default printing, unless the person already chose one
          setRows((rs) => rs.map((x) => (x.options[x.choice].key === m.key && x.foil === undefined && x.edition === undefined ? { ...x, ...defaultsFor(r) } : x)))
        })
        .catch(() => setCatalogRows((c) => ({ ...c, [m.key]: 'error' })))
    }
  }, [rows, catalogRows])

  const rowsFor = (row: Row): Rows => catalogRows[row.options[row.choice].key] ?? 'loading'
  const ready = rows.every((r) => Array.isArray(rowsFor(r)))
  const total = useMemo(() => rows.reduce((sum, r) => {
    const cr = catalogRows[r.options[r.choice].key]
    return sum + (Array.isArray(cr) ? picked(r, cr).price : r.options[r.choice].price) * r.quantity
  }, 0), [rows, catalogRows])
  const count = rows.reduce((n, r) => n + r.quantity, 0)

  async function addAll() {
    if (!user || saving || !ready) return
    setSaving(true)
    setError(null)
    const known: Card[] = [...allCards]
    // The inventory lists newest first: the first card scanned gets the latest time, so the
    // batch reads top to bottom in the order it was scanned
    const startedAt = Date.now()
    let done = 0
    try {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        const now = new Date(startedAt - i).toISOString()
        const cr = rowsFor(row) as CardSearchResult[]
        const { result, price, isFoil } = picked(row, cr)
        const match = row.options[row.choice]
        const vp = vpOf(cr[0])
        const cardData: Omit<Card, 'id'> = {
          game: match.game,
          name: result.name,
          set: result.setName || 'N/A',
          setCode: result.set || 'N/A',
          number: result.number || 'N/A',
          condition: row.condition,
          quantity: row.quantity,
          purchasePrice: 0,
          purchaseDate: localDateString(),
          isFoil,
          createdAt: now,
          imageUrl: result.imageUrl || '',
          apiId: result.id,
          ...(result.rarity && { rarity: result.rarity }),
          // Read off the slab's label (prices stay the raw card's — graded prices aren't tracked yet)
          ...(row.slab?.company && row.slab.grade && { gradingCompany: row.slab.company, grade: row.slab.grade }),
          ...(row.slab?.company && row.slab.cert && { certNumber: row.slab.cert }),
          ...(match.game === 'riftbound' && { nexus: false }),
          ...(hasPrintings(match.game) && vp && row.edition && { edition: row.edition }),
          ...(hasPrintings(match.game) && vp && row.finish && { finish: row.finish }),
          ...(match.language === 'ja' && { language: 'ja' as Language }),
          ...(price > 0 && { currentPrice: price, priceUpdatedAt: now, priceAtEntry: price }),
        }
        const ref = newCardRef(user.uid)
        await saveCard(user.uid, ref.id, cardData)
        const card: Card = { ...cardData, id: ref.id }
        addCard(card)
        if (isFirstCopyOfCard(card, known)) pushCardUnlock(card)
        known.push(card)
        done++
        setRows((rs) => rs.filter((r) => r.rowId !== row.rowId))
      }
      onClose()
    } catch (err) {
      console.error('Saving scanned cards failed:', err)
      const code = (err as { code?: string })?.code
      setError(`${done > 0 ? `${done} added. ` : ''}The rest didn’t save${code ? ` (${code})` : ''} — check your connection and try again.`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
      <div className="add-card-backdrop absolute inset-0 bg-black/60 backdrop-blur-sm touch-none" onClick={saving ? undefined : onClose} />
      <div className="add-card-panel relative w-full max-w-[600px] card-glass rounded-t-2xl sm:rounded-2xl max-h-[94dvh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-3 border-b border-slate-800">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-ink leading-tight">Review scanned cards</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {count} card{count === 1 ? '' : 's'} · <span className="text-ink tabular-nums">{formatCurrency(total)}</span>
              {rows.some((r) => r.needsPick) && <span className="text-amber-600 font-medium"> · {rows.filter((r) => r.needsPick).length} to check</span>}
            </p>
          </div>
          <button onClick={onClose} disabled={saving} className="p-2 rounded-lg text-slate-500 hover:text-ink hover:bg-slate-800" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* Cards */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4">
          {rows.length === 0 && <p className="text-sm text-slate-400 text-center py-8">Nothing left to add.</p>}
          <ul className="flex flex-col gap-3">
            {rows.map((row) => {
              const match = row.options[row.choice]
              const cr = rowsFor(row)
              const loaded = Array.isArray(cr) ? cr : null
              const pick = loaded ? picked(row, loaded) : null
              const vp = loaded ? vpOf(loaded[0]) : null
              const price = pick ? pick.price : match.price
              // Every printing as a button with its price: Pokémon edition × finish, else Normal / Foil
              const printings: Array<{ id: string; label: string; price: number; on: boolean; set: () => void }> = []
              if (vp) {
                for (const ed of editionsOf(vp) as Edition[]) {
                  for (const fin of finishesOf(vp, ed) as Finish[]) {
                    printings.push({
                      id: `${ed}:${fin}`,
                      label: [ed === 'unlimited' ? '' : EDITION_LABELS[ed], FINISH_LABELS[fin]].filter(Boolean).join(' '),
                      price: variantPrice(vp, { edition: ed, finish: fin, isFoil: fin !== 'normal' }),
                      on: row.edition === ed && row.finish === fin,
                      set: () => update(row.rowId, { edition: ed, finish: fin }),
                    })
                  }
                }
              } else if (loaded && loaded.some((r) => r.isFoil) && loaded.some((r) => !r.isFoil)) {
                const normal = loaded.find((r) => !r.isFoil)!, foil = loaded.find((r) => r.isFoil)!
                printings.push({ id: 'normal', label: 'Normal', price: normal.marketPrice, on: !row.foil, set: () => update(row.rowId, { foil: false }) })
                printings.push({ id: 'foil', label: 'Foil', price: foil.marketPriceFoil > 0 ? foil.marketPriceFoil : foil.marketPrice, on: !!row.foil, set: () => update(row.rowId, { foil: true }) })
              }
              return (
                <li key={row.rowId} className={cn('rounded-2xl border bg-slate-950/40 p-3', row.needsPick ? 'border-amber-500/70' : 'border-slate-800')}>
                  <div className="flex gap-3">
                    <div className="relative shrink-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={cardImage(match.imageUrl, 'thumb')} alt="" className="w-[72px] h-[100px] rounded-lg object-cover bg-slate-900 shadow" />
                      {row.slab?.grade && (
                        <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-white px-1.5 py-0.5 text-[10px] font-black text-[#1a1a1a] shadow ring-1 ring-[#c8102e]">
                          <span className="text-[#c8102e]">{row.slab.company}</span> {row.slab.grade}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-ink leading-snug line-clamp-2">{match.name}</div>
                          <div className="text-xs text-slate-400 truncate mt-0.5">
                            {match.setName}{match.number ? ` · #${match.number}` : ''}{match.language === 'ja' ? ' · Japanese' : ''}
                          </div>
                        </div>
                        <button onClick={() => setRows((rs) => rs.filter((r) => r.rowId !== row.rowId))} disabled={saving}
                          className="p-1.5 -mr-1 -mt-1 rounded-lg text-slate-500 hover:text-ink hover:bg-slate-800 shrink-0" aria-label="Remove">
                          <X size={16} />
                        </button>
                      </div>
                      <div className="mt-2 text-lg font-bold text-ink tabular-nums">
                        {price > 0 ? formatCurrency(price) : <span className="text-slate-500 text-sm font-medium">No price yet</span>}
                        {row.quantity > 1 && price > 0 && <span className="ml-2 text-xs font-medium text-slate-400">× {row.quantity} = {formatCurrency(price * row.quantity)}</span>}
                      </div>
                      {cr === 'loading' && <Loader2 size={14} className="animate-spin text-slate-400 mt-1" />}
                      {cr === 'error' && <p className="text-xs text-red-600 mt-1">Couldn’t load this card — remove it to add the rest</p>}
                    </div>
                  </div>

                  {(row.needsPick || row.options.length > 1) && (
                    <label className={cn('block mt-3 rounded-xl p-2.5 text-xs', row.needsPick ? 'bg-amber-500/10' : 'bg-slate-900/60')}>
                      <span className={cn('font-semibold', row.needsPick ? 'text-amber-600' : 'text-slate-400')}>
                        {row.needsPick ? 'Not sure which card — pick the right one' : 'Card'}
                      </span>
                      <select
                        className="input-field mt-1.5 py-2 text-sm"
                        value={row.choice}
                        onChange={(e) => update(row.rowId, { choice: Number(e.target.value), needsPick: false, foil: undefined, edition: undefined, finish: undefined })}
                      >
                        {row.options.slice(0, 12).map((o, i) => (
                          <option key={o.key} value={i}>
                            {o.name} — {o.setName}{o.number ? ` #${o.number}` : ''}{o.language === 'ja' ? ' (JP)' : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  {printings.length > 1 && (
                    <div className="mt-3">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Finish</div>
                      <div className="flex flex-wrap gap-1.5">
                        {printings.map((p) => (
                          <button key={p.id} type="button" onClick={p.set}
                            className={cn('rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors text-left',
                              p.on ? 'border-amber-500 bg-amber-500/15 text-ink' : 'border-slate-800 text-slate-400 hover:text-ink hover:border-slate-700')}>
                            {p.label}
                            {p.price > 0 && <span className="block text-[11px] font-medium tabular-nums opacity-80">{formatCurrency(p.price)}</span>}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="mt-3 flex items-end gap-2">
                    <label className="flex-1 min-w-0">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Condition</span>
                      <select className="input-field mt-1 py-2 text-sm" value={row.condition} onChange={(e) => update(row.rowId, { condition: e.target.value as Condition })}>
                        {CONDITIONS.map(([c, label]) => <option key={c} value={c}>{label}</option>)}
                      </select>
                    </label>
                    <div>
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Qty</span>
                      <div className="mt-1 flex items-center rounded-xl border border-slate-800 bg-slate-950 text-sm h-[38px]">
                        <button type="button" className="px-3 h-full text-slate-400 hover:text-ink disabled:opacity-40" disabled={row.quantity <= 1}
                          onClick={() => update(row.rowId, { quantity: Math.max(1, row.quantity - 1) })} aria-label="One fewer">−</button>
                        <span className="w-6 text-center text-ink font-semibold tabular-nums">{row.quantity}</span>
                        <button type="button" className="px-3 h-full text-slate-400 hover:text-ink"
                          onClick={() => update(row.rowId, { quantity: row.quantity + 1 })} aria-label="One more">+</button>
                      </div>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>

        {/* Footer: always in view */}
        <div className="border-t border-slate-800 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {error && (
            <div className="mb-3 flex items-start gap-2 text-sm text-red-600">
              <AlertCircle size={16} className="shrink-0 mt-0.5" /> {error}
            </div>
          )}
          <button onClick={addAll} disabled={saving || rows.length === 0 || !ready} className="btn-primary w-full justify-center py-3 text-base">
            {saving || (!ready && rows.length > 0) ? <Loader2 size={16} className="animate-spin" /> : null}
            Add {count} card{count === 1 ? '' : 's'} to inventory · {formatCurrency(total)}
          </button>
        </div>
      </div>
    </div>
  )
}
