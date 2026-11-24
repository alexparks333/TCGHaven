'use client'

import { useEffect, useMemo, useState } from 'react'
import { doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { Bot, Check, Copy, ExternalLink, Link2, Loader2, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { staffDb } from '@/lib/firebase/staff'
import { adminFetch } from '@/lib/firebase/authFetch'
import { refreshCatalogCaches } from '@/lib/api/catalog'
import { cardImage } from '@/lib/cardImage'
import type { CatalogKey } from '@/lib/types'

// The staff portal's Stagnant prices page (every game but Magic — STAGNANT_SKIP_GAMES): catalog cards whose price nothing updates on its own —
// no sync price, no TCGplayer product, no PriceCharting link (scripts/lib/stagnant.mjs). Staff only;
// collectors never see the word. Price one here, or send the AI agent
// (/update-stagnant-prices in Claude Code → scripts/stagnant-prices.mjs). A price set by hand
// stays through every sync until a live price turns up: TCGplayer, or PriceCharting's ungraded price
// (the daily PriceCharting job). A hand-added Riftbound card TCGplayer starts listing is linked by
// the sync when the match is clear; unclear ones show here as "Found on TCGplayer" to pick
// (sync_status/riftbound handAddedMatches — hand-added-tcgplayer.mjs). docs/catalog.md "Stagnant prices".

const CATALOGS: Array<[CatalogKey, string]> = [
  ['pokemon', 'Pokémon'], ['pokemon-jp', 'Pokémon (Japanese)'], ['lorcana', 'Lorcana'], ['riftbound', 'Riftbound'], ['onepiece', 'One Piece'],
  ['yugioh', 'Yu-Gi-Oh!'], ['swu', 'Star Wars'], ['gundam', 'Gundam'],
  ['fab', 'Flesh and Blood'], ['digimon', 'Digimon'], ['palworld', 'Palworld'], ['cyberpunk', 'Cyberpunk'],
]

type Reason = 'hand-added' | 'manual' | 'no-price'
interface Row {
  game: CatalogKey; id: string; name: string; setName: string; number: string; rarity: string; imageUrl: string
  reason: Reason; marketPrice: number; marketPriceFoil: number; manualPriceAt: string | null; manualPriceNote: string | null
}

const REASON: Record<Reason, { label: string; hint: string; cls: string }> = {
  'no-price': { label: 'No price', hint: 'No sync price, no TCGplayer product and no PriceCharting link', cls: 'bg-red-500/15 text-red-700' },
  'hand-added': { label: 'Hand-added card', hint: 'Added by hand — no sync ever prices it', cls: 'bg-amber-500/15 text-amber-700' },
  manual: { label: 'Priced by hand', hint: 'Its sync has no price, so it was priced by hand — re-check it now and then', cls: 'bg-violet-500/15 text-violet-700' },
}
const usd = (n: number) => `$${n.toFixed(2)}`
interface Product { productId: number; groupId: number | null; name: string; extNumber: string; marketPrice: number }
const AGENT_COMMAND = '/update-stagnant-prices'

export function StagnantPrices() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [game, setGame] = useState<CatalogKey | null>(null)
  const [reason, setReason] = useState<Reason | 'all'>('all')
  const [q, setQ] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  // Hand-added cards with several possible TCGplayer products (the Riftbound sync's list)
  const [found, setFound] = useState<Record<string, Product[]>>({})
  useEffect(() => {
    getDoc(doc(staffDb, 'sync_status', 'riftbound'))
      .then((d) => {
        const list = JSON.parse(String(d.data()?.handAddedMatches ?? '[]')) as Array<{ cardId: string; products: Product[] }>
        setFound(Object.fromEntries(list.map((x) => [x.cardId, x.products])))
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    adminFetch('/api/admin/catalog/stagnant')
      .then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((d: { cards: Row[]; counts: Record<string, number> }) => {
        setRows(d.cards); setCounts(d.counts)
        setGame((g) => g ?? CATALOGS.find(([k]) => d.counts[k])?.[0] ?? 'riftbound')
      })
      .catch((e) => { console.error(e); setError('Couldn’t load the list.'); setRows([]) })
  }, [])

  const shown = useMemo(() => {
    const f = q.trim().toLowerCase()
    return (rows ?? [])
      .filter((r) => r.game === game && (reason === 'all' || r.reason === reason)
        && (!f || r.name.toLowerCase().includes(f) || r.setName.toLowerCase().includes(f) || r.id.toLowerCase().includes(f)))
      .sort((a, b) => a.setName.localeCompare(b.setName) || a.number.localeCompare(b.number, undefined, { numeric: true }))
  }, [rows, game, reason, q])

  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  const pill = (on: boolean) => cn('text-xs font-medium px-3 py-1 rounded-full transition-colors whitespace-nowrap', on ? 'bg-slate-800 text-ink' : 'text-slate-500 hover:text-ink')

  function saved(id: string, patch: Partial<Row>) {
    setRows((rs) => (rs ?? []).map((r) => (r.id === id && r.game === game ? { ...r, ...patch } : r)))
  }

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-ink">Stagnant prices</h1>
        <p className="text-slate-400 text-sm mt-0.5 max-w-3xl">
          Cards whose price nothing updates on its own — no price from TCGplayer and none from PriceCharting.
          Staff only: collectors never see this. A price set here stays until a live one turns up: when TCGplayer or PriceCharting
          (ungraded) starts pricing a card, it leaves this list and tracks that price automatically.
        </p>
        <div className="mt-3 flex items-center gap-2 flex-wrap text-xs text-slate-400">
          <Bot size={14} className="text-slate-500" />
          To have an AI agent price them, run
          <code className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-ink">{AGENT_COMMAND}</code>
          in Claude Code (add a game, e.g. <code className="text-ink">{AGENT_COMMAND} riftbound</code>).
          <button
            onClick={() => { navigator.clipboard.writeText(AGENT_COMMAND).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }, () => {}) }}
            className="inline-flex items-center gap-1 text-slate-500 hover:text-ink"
          >
            {copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1 flex-wrap rounded-2xl border border-slate-700 p-1 mb-4">
        {CATALOGS.map(([k, label]) => (
          <button key={k} onClick={() => setGame(k)} className={pill(game === k)}>
            {label}{counts[k] ? <span className="ml-1 text-slate-500">{counts[k]}</span> : null}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3 flex-wrap mb-4">
        <div className="flex items-center rounded-full border border-slate-700 p-0.5">
          <button onClick={() => setReason('all')} className={pill(reason === 'all')}>All</button>
          {(Object.keys(REASON) as Reason[]).map((k) => (
            <button key={k} onClick={() => setReason(k)} className={pill(reason === k)} title={REASON[k].hint}>{REASON[k].label}</button>
          ))}
        </div>
        <label className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 w-full sm:w-72">
          <Search size={14} className="text-slate-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a card or set" className="bg-transparent text-sm text-ink placeholder-slate-500 focus:outline-none w-full" />
        </label>
        {rows && <span className="text-xs text-slate-500">{shown.length} shown · {total.toLocaleString()} stagnant in all games</span>}
      </div>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
      {rows === null ? (
        <div className="py-16 flex justify-center"><Loader2 className="animate-spin text-slate-500" /></div>
      ) : shown.length === 0 ? (
        <div className="card-glass py-14 text-center text-sm text-slate-500">Nothing stagnant here{q || reason !== 'all' ? ' with these filters' : ''}.</div>
      ) : (
        <div className="space-y-2">
          {shown.slice(0, 300).map((r) => (
            <StagnantRow key={`${r.game}:${r.id}`} row={r} found={r.game === 'riftbound' ? found[r.id] : undefined}
              onSaved={(p) => saved(r.id, p)} onLinked={() => setRows((rs) => (rs ?? []).filter((x) => !(x.game === r.game && x.id === r.id)))} />
          ))}
          {shown.length > 300 && <p className="text-xs text-slate-500 text-center py-2">Showing the first 300 — search to narrow it down.</p>}
        </div>
      )}
    </div>
  )
}

function StagnantRow({ row, found, onSaved, onLinked }: { row: Row; found?: Product[]; onSaved: (patch: Partial<Row>) => void; onLinked: () => void }) {
  const [open, setOpen] = useState(false)
  const [price, setPrice] = useState(row.marketPrice ? String(row.marketPrice) : '')
  const [foil, setFoil] = useState(row.marketPriceFoil ? String(row.marketPriceFoil) : '')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const r = REASON[row.reason]

  // Link a hand-added card to its TCGplayer product: it leaves this list and the Riftbound sync
  // prices it live from then on (within a day — the sync after a staff edit skips the card once)
  async function link(p: Product) {
    setBusy(true); setErr(null)
    try {
      await updateDoc(doc(staffDb, 'catalog', row.game, 'cards', row.id), {
        tcgProductId: p.productId, ...(p.groupId && { tcgGroupId: p.groupId }), updatedAt: serverTimestamp(),
      })
      await refreshCatalogCaches(row.game)
      onLinked()
    } catch (e) { console.error(e); setErr('Couldn’t link it.') } finally { setBusy(false) }
  }

  async function save() {
    const p = parseFloat(price)
    const f = foil.trim() ? parseFloat(foil) : undefined
    if (!(p >= 0) || (f !== undefined && !(f >= 0))) { setErr('Enter a price in US dollars.'); return }
    if (!note.trim()) { setErr('Say where the price came from (e.g. “eBay sold, 3 sales in Nov”).'); return }
    setBusy(true); setErr(null)
    const patch = {
      marketPrice: p, priceSource: 'manual', manualPriceAt: new Date().toISOString(), manualPriceNote: note.trim().slice(0, 300),
      ...(f !== undefined && { marketPriceFoil: f }),
    }
    try {
      await updateDoc(doc(staffDb, 'catalog', row.game, 'cards', row.id), { ...patch, updatedAt: serverTimestamp() })
      await refreshCatalogCaches(row.game)
      onSaved({ marketPrice: p, ...(f !== undefined && { marketPriceFoil: f }), manualPriceAt: patch.manualPriceAt, manualPriceNote: patch.manualPriceNote,
        reason: row.reason === 'no-price' ? 'manual' : row.reason })
      setOpen(false); setNote('')
    } catch (e) { console.error(e); setErr('Couldn’t save the price.') } finally { setBusy(false) }
  }

  return (
    <div className="card-glass p-3 flex gap-3">
      {row.imageUrl
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={cardImage(row.imageUrl, 'thumb') ?? row.imageUrl} alt="" className="w-12 aspect-[5/7] object-contain rounded-md bg-slate-900 shrink-0" loading="lazy" />
        : <div className="w-12 aspect-[5/7] rounded-md bg-slate-900 shrink-0 flex items-center justify-center text-[0.5625rem] text-slate-600">No picture</div>}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-ink">{row.name} <span className="font-normal text-slate-500">· {row.setName} · #{row.number}</span></div>
            <div className="text-xs text-slate-500 mt-1 flex items-center gap-2 flex-wrap">
              <span className={cn('text-[0.625rem] font-bold uppercase tracking-wide px-1.5 py-px rounded-full', r.cls)} title={r.hint}>{r.label}</span>
              <span className="text-ink font-medium">{row.marketPrice ? usd(row.marketPrice) : '—'}</span>
              {row.marketPriceFoil ? <span>/ {usd(row.marketPriceFoil)} foil</span> : null}
              {row.manualPriceAt && <span>· priced {new Date(row.manualPriceAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}{row.manualPriceNote ? ` — ${row.manualPriceNote}` : ''}</span>}
              <span className="font-mono text-[0.625rem] text-slate-600">{row.id}</span>
            </div>
          </div>
          {!open && <button onClick={() => setOpen(true)} className="btn-secondary shrink-0">Set price</button>}
        </div>
        {!!found?.length && (
          <div className="mt-2 rounded-lg border border-emerald-300/60 bg-emerald-500/5 p-2">
            <div className="text-[0.6875rem] font-semibold text-emerald-700 mb-1">Found on TCGplayer — which one is it? Linking prices it live from now on.</div>
            <div className="flex flex-col gap-1">
              {found.map((p) => (
                <div key={p.productId} className="flex items-center gap-2 text-xs text-slate-400 flex-wrap">
                  <span className="text-ink">{p.name}</span> <span>#{p.extNumber}</span>
                  {p.marketPrice ? <span className="text-ink font-medium">{usd(p.marketPrice)}</span> : <span>no sales yet</span>}
                  <a href={`https://www.tcgplayer.com/product/${p.productId}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-ink">TCGplayer <ExternalLink size={10} /></a>
                  <button disabled={busy} onClick={() => link(p)} className="btn-secondary text-xs"><Link2 size={12} />Link</button>
                </div>
              ))}
            </div>
          </div>
        )}
        {open && (
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Price (USD)" inputMode="decimal"
              className="w-28 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:border-violet-600" />
            <input value={foil} onChange={(e) => setFoil(e.target.value)} placeholder="Foil (optional)" inputMode="decimal"
              className="w-32 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:border-violet-600" />
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Where from? e.g. eBay sold, 3 sales Nov 2026"
              className="flex-1 min-w-[14rem] bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:border-violet-600" />
            <button disabled={busy} onClick={save} className="btn-primary">{busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}Save</button>
            <button disabled={busy} onClick={() => { setOpen(false); setErr(null) }} className="btn-secondary">Cancel</button>
            {err && <p className="w-full text-xs text-red-600">{err}</p>}
          </div>
        )}
      </div>
    </div>
  )
}
