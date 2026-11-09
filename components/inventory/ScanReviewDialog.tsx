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
import { CONDITION_LABELS, type Card, type Condition, type Edition, type Finish, type Language } from '@/lib/types'
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
      const same = s.status === 'matched' && out.find((r) => !r.needsPick && r.options[r.choice].key === key)
      if (same) { same.quantity += 1; continue }
      out.push({ rowId: s.scanId, options: s.options, choice: s.choice, needsPick: s.status !== 'matched', condition: 'near_mint', quantity: 1 })
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
    const now = new Date().toISOString()
    let done = 0
    try {
      for (const row of rows) {
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
          ...(match.game === 'riftbound' && { nexus: false }),
          ...(match.game === 'pokemon' && vp && row.edition && { edition: row.edition }),
          ...(match.game === 'pokemon' && vp && row.finish && { finish: row.finish }),
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="add-card-backdrop absolute inset-0 bg-black/60 backdrop-blur-sm touch-none" onClick={saving ? undefined : onClose} />
      <div className="add-card-panel relative w-full max-w-[592px] card-glass rounded-2xl p-5 md:p-6 max-h-[92dvh] overflow-y-auto overflow-x-hidden overscroll-contain">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-ink">Scanned cards</h2>
          <button onClick={onClose} disabled={saving} className="p-1.5 rounded-lg text-slate-500 hover:text-ink hover:bg-slate-700">
            <X size={18} />
          </button>
        </div>

        {rows.length === 0 && <p className="text-sm text-slate-400">Nothing left to add.</p>}

        <ul className="flex flex-col gap-3">
          {rows.map((row) => {
            const match = row.options[row.choice]
            const cr = rowsFor(row)
            const loaded = Array.isArray(cr) ? cr : null
            const pick = loaded ? picked(row, loaded) : null
            const vp = loaded ? vpOf(loaded[0]) : null
            const editions = vp ? (editionsOf(vp) as Edition[]) : []
            const finishes = vp && row.edition ? (finishesOf(vp, row.edition) as Finish[]) : []
            const hasFoilRow = !!loaded && !vp && loaded.some((r) => r.isFoil) && loaded.some((r) => !r.isFoil)
            const price = pick ? pick.price : match.price
            return (
              <li key={row.rowId} className={cn('rounded-xl border p-3 flex gap-3', row.needsPick ? 'border-amber-500/70' : 'border-slate-800')}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={cardImage(match.imageUrl, 'thumb')} alt="" className="w-16 h-[89px] rounded-md object-cover bg-slate-900 shrink-0" />
                <div className="min-w-0 flex-1 flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-ink truncate">{match.name}</div>
                      <div className="text-xs text-slate-400 truncate">
                        {match.setName}{match.number ? ` · #${match.number}` : ''}{match.language === 'ja' ? ' · Japanese' : ''}
                      </div>
                    </div>
                    <button onClick={() => setRows((rs) => rs.filter((r) => r.rowId !== row.rowId))} disabled={saving} className="p-1 text-slate-500 hover:text-ink shrink-0" aria-label="Remove">
                      <X size={16} />
                    </button>
                  </div>

                  {(row.needsPick || row.options.length > 1) && (
                    <label className="text-xs">
                      {row.needsPick && <span className="text-amber-600 font-medium">Not sure which card — check this: </span>}
                      <select
                        className="input-field mt-1 py-1.5 text-sm"
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

                  <div className="flex flex-wrap gap-2">
                    {cr === 'loading' && <Loader2 size={16} className="animate-spin text-slate-400 self-center" />}
                    {cr === 'error' && <span className="text-xs text-red-600 self-center">Couldn’t load this card — remove it to add the rest</span>}
                    {editions.length > 1 && (
                      <select className="input-field py-1.5 text-sm w-auto" value={row.edition}
                        onChange={(e) => {
                          const edition = e.target.value as Edition
                          const fs = finishesOf(vp!, edition) as Finish[]
                          update(row.rowId, { edition, finish: row.finish && fs.includes(row.finish) ? row.finish : (defaultFinish(vp!, edition, false) as Finish) })
                        }}>
                        {editions.map((ed) => <option key={ed} value={ed}>{EDITION_LABELS[ed]}</option>)}
                      </select>
                    )}
                    {finishes.length > 1 && (
                      <select className="input-field py-1.5 text-sm w-auto" value={row.finish} onChange={(e) => update(row.rowId, { finish: e.target.value as Finish })}>
                        {finishes.map((f) => <option key={f} value={f}>{FINISH_LABELS[f]}</option>)}
                      </select>
                    )}
                    {hasFoilRow && (
                      <select className="input-field py-1.5 text-sm w-auto" value={row.foil ? 'foil' : 'normal'} onChange={(e) => update(row.rowId, { foil: e.target.value === 'foil' })}>
                        <option value="normal">Normal</option>
                        <option value="foil">Foil</option>
                      </select>
                    )}
                    <select className="input-field py-1.5 text-sm w-auto" value={row.condition} onChange={(e) => update(row.rowId, { condition: e.target.value as Condition })}>
                      {CONDITIONS.map(([c, label]) => <option key={c} value={c}>{label}</option>)}
                    </select>
                    <div className="flex items-center rounded-lg border border-slate-800 text-sm">
                      <button type="button" className="px-2.5 py-1 text-slate-400 hover:text-ink" disabled={row.quantity <= 1}
                        onClick={() => update(row.rowId, { quantity: Math.max(1, row.quantity - 1) })}>−</button>
                      <span className="w-6 text-center text-ink">{row.quantity}</span>
                      <button type="button" className="px-2.5 py-1 text-slate-400 hover:text-ink"
                        onClick={() => update(row.rowId, { quantity: row.quantity + 1 })}>+</button>
                    </div>
                    <span className="ml-auto self-center text-sm text-ink tabular-nums">{price > 0 ? formatCurrency(price) : '—'}</span>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>

        {error && (
          <div className="mt-4 flex items-start gap-2 text-sm text-red-600">
            <AlertCircle size={16} className="shrink-0 mt-0.5" /> {error}
          </div>
        )}

        <div className="mt-5 flex items-center justify-between gap-3">
          <span className="text-sm text-slate-400">{rows.length > 0 && <>Total <span className="text-ink tabular-nums">{formatCurrency(total)}</span></>}</span>
          <button onClick={addAll} disabled={saving || rows.length === 0 || !ready} className="btn-primary">
            {saving || (!ready && rows.length > 0) ? <Loader2 size={16} className="animate-spin" /> : null}
            Add {count} card{count === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  )
}
