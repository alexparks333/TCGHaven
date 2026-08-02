'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, Search, Plus, EyeOff, Wand2, AlertCircle, LocateFixed } from 'lucide-react'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { cn } from '@/lib/utils'
import { GAME_COLORS, type Game } from '@/lib/types'

interface SetOption {
  code: string
  name: string
  releaseDate: string
  cardCount?: number
}

interface CatalogCard {
  id: string
  name: string
  number: string
  set?: string
  setCode?: string
  setName: string
  rarity?: string
  imageUrl: string
  marketPrice?: number
  marketPriceFoil?: number
  isCustom?: boolean
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

const GAMES: Game[] = ['pokemon', 'lorcana', 'riftbound']

export default function AdminCatalogPage() {
  return (
    <AuthGuard>
      <div className="pb-20 md:pb-0">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white">Admin Catalog</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            Browse the full card catalog in display order. Adding or hiding cards only works when
            running in dev — production stays read-only until the next sync/rebuild ships the change.
          </p>
        </div>
        <CatalogBrowser />
      </div>
    </AuthGuard>
  )
}

function CatalogBrowser() {
  const [activeGame, setActiveGame] = useState<Game>('riftbound')
  const [sets, setSets] = useState<SetOption[]>([])
  const [activeSet, setActiveSet] = useState<SetOption | null>(null)
  const [cards, setCards] = useState<CatalogCard[]>([])
  const [loadingSets, setLoadingSets] = useState(false)
  const [loadingCards, setLoadingCards] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [jumpName, setJumpName] = useState('')
  const [jumpNumber, setJumpNumber] = useState('')
  const [jumpNameMissed, setJumpNameMissed] = useState(false)
  const [jumpNumberMissed, setJumpNumberMissed] = useState(false)
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
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

  function loadCards() {
    if (!activeSet) return
    setLoadingCards(true)
    fetch(`/api/admin/catalog?game=${activeGame}&set=${encodeURIComponent(activeSet.name)}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: CatalogCard[]) => setCards(data))
      .catch(() => {})
      .finally(() => setLoadingCards(false))
  }

  useEffect(() => {
    loadCards()
    setJumpName(''); setJumpNumber(''); setJumpNameMissed(false); setJumpNumberMissed(false)
  }, [activeGame, activeSet])

  async function hideCard(id: string) {
    setActionError(null)
    const res = await fetch('/api/admin/catalog/hide', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game: activeGame, id }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { setActionError(data.error ?? `Hide failed (${res.status})`); return }
    loadCards()
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

  function handleJumpName(query: string) {
    setJumpName(query)
    if (!query.trim()) { setJumpNameMissed(false); return }
    const q = query.toLowerCase()
    const match = cards.find((c) => c.name.toLowerCase().includes(q))
    setJumpNameMissed(!jumpToRow(match?.id))
  }

  function handleJumpNumber(query: string) {
    setJumpNumber(query)
    if (!query.trim()) { setJumpNumberMissed(false); return }
    const q = query.toLowerCase()
    const match =
      cards.find((c) => c.number.toLowerCase() === q) ??
      cards.find((c) => c.number.toLowerCase().startsWith(q))
    setJumpNumberMissed(!jumpToRow(match?.id))
  }

  const gameColor = GAME_COLORS[activeGame]

  return (
    <div>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="relative">
          <LocateFixed size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={jumpName}
            onChange={(e) => handleJumpName(e.target.value)}
            placeholder="Jump to name…"
            className={cn(
              'bg-slate-900 border rounded-lg pl-8 pr-3 py-2 text-sm text-white w-48',
              jumpNameMissed ? 'border-red-800' : 'border-slate-800',
            )}
          />
        </div>
        <div className="relative">
          <LocateFixed size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={jumpNumber}
            onChange={(e) => handleJumpNumber(e.target.value)}
            placeholder="Jump to number…"
            className={cn(
              'bg-slate-900 border rounded-lg pl-8 pr-3 py-2 text-sm text-white w-40',
              jumpNumberMissed ? 'border-red-800' : 'border-slate-800',
            )}
          />
        </div>
        {(jumpNameMissed || jumpNumberMissed) && <span className="text-xs text-red-400">No match</span>}
      </div>

      <div className="flex gap-2 mb-4">
        {GAMES.map((g) => (
          <button
            key={g}
            onClick={() => setActiveGame(g)}
            className={cn(
              'px-4 py-2 rounded-xl text-sm font-medium transition-all capitalize',
              activeGame === g ? 'text-white' : 'bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800',
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
            className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white"
          >
            {sets.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
          </select>
        )}
        <button
          onClick={() => setShowAddForm((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-violet-600 text-white hover:bg-violet-500"
        >
          <Plus size={14} /> Add Missing Card
        </button>
      </div>

      {actionError && (
        <div className="flex items-start gap-2 text-red-400 text-xs bg-red-950/30 border border-red-900/50 rounded-lg px-3 py-2 mb-4">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>{actionError}</span>
        </div>
      )}

      {showAddForm && activeSet && (
        <AddCardForm
          game={activeGame}
          activeSet={activeSet}
          onSaved={() => { setShowAddForm(false); loadCards() }}
          onError={setActionError}
        />
      )}

      {loadingCards ? (
        <div className="flex items-center justify-center py-16 gap-3 text-slate-500">
          <Loader2 size={20} className="animate-spin" style={{ color: gameColor }} />
          <span className="text-sm">Loading cards…</span>
        </div>
      ) : (
        <CardTable cards={cards} onHide={hideCard} rowRefs={rowRefs.current} highlightedId={highlightedId} />
      )}
    </div>
  )
}

function CardTable({
  cards, onHide, rowRefs, highlightedId,
}: {
  cards: CatalogCard[]
  onHide: (id: string) => void
  rowRefs: Map<string, HTMLTableRowElement>
  highlightedId: string | null
}) {
  if (cards.length === 0) {
    return <div className="card-glass py-12 text-center text-slate-500 text-sm">No cards found for this set.</div>
  }

  return (
    <div className="card-glass overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-slate-500 text-xs uppercase tracking-wide border-b border-slate-800">
            <th className="px-3 py-2 font-medium">#</th>
            <th className="px-3 py-2 font-medium">Image</th>
            <th className="px-3 py-2 font-medium">Name</th>
            <th className="px-3 py-2 font-medium">Rarity</th>
            <th className="px-3 py-2 font-medium">Price</th>
            <th className="px-3 py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {cards.map((c, i) => {
            const numberChanged = i === 0 || cards[i - 1].number !== c.number
            return (
              <tr
                key={c.id}
                ref={(el) => { if (el) rowRefs.set(c.id, el); else rowRefs.delete(c.id) }}
                className={cn(
                  'border-b border-slate-900 transition-colors duration-500',
                  numberChanged && i > 0 && 'border-t border-slate-700',
                  highlightedId === c.id && 'bg-violet-500/20',
                )}
              >
                <td className="px-3 py-2 text-slate-400 font-mono text-xs">{c.number}</td>
                <td className="px-3 py-2">
                  {c.imageUrl ? <img src={c.imageUrl} alt="" className="w-8 h-11 object-cover rounded" /> : <div className="w-8 h-11 bg-slate-800 rounded" />}
                </td>
                <td className="px-3 py-2 text-white">
                  {c.name}
                  {c.isCustom && <span className="ml-2 text-[10px] font-bold uppercase text-violet-400 border border-violet-800 rounded px-1 py-0.5">custom</span>}
                </td>
                <td className="px-3 py-2 text-slate-400">{c.rarity ?? '—'}</td>
                <td className="px-3 py-2 text-slate-300">
                  {c.marketPrice ? `$${c.marketPrice.toFixed(2)}` : '—'}
                  {c.marketPriceFoil ? <span className="text-slate-500"> / ${c.marketPriceFoil.toFixed(2)} foil</span> : null}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => onHide(c.id)}
                    className="flex items-center gap-1 text-xs text-slate-500 hover:text-red-400 ml-auto"
                    title="Hide from catalog (dev only) — reversible, never deletes data"
                  >
                    <EyeOff size={12} /> Hide
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function AddCardForm({
  game, activeSet, onSaved, onError,
}: { game: Game; activeSet: SetOption; onSaved: () => void; onError: (msg: string | null) => void }) {
  const [number, setNumber] = useState('')
  const [name, setName] = useState('')
  const [rarity, setRarity] = useState('')
  const [variant, setVariant] = useState('')
  const [apiId, setApiId] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [marketPrice, setMarketPrice] = useState('')
  const [marketPriceFoil, setMarketPriceFoil] = useState('')
  const [candidates, setCandidates] = useState<LookupCandidate[]>([])
  const [looking, setLooking] = useState(false)
  const [saving, setSaving] = useState(false)

  async function runLookup() {
    setLooking(true)
    onError(null)
    try {
      const res = await fetch('/api/admin/catalog/lookup', {
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
    setSaving(true)
    onError(null)
    const card: Record<string, unknown> = {
      name,
      number,
      setName: activeSet.name,
      rarity: rarity || undefined,
      imageUrl: imageUrl || '',
      marketPrice: parseFloat(marketPrice) || 0,
      marketPriceFoil: parseFloat(marketPriceFoil) || 0,
      ...(game === 'riftbound' ? { setCode: activeSet.code } : { set: activeSet.code }),
      // Reuse the real official id when we have one (e.g. Pokemon's apiId) so the card
      // behaves identically to a normally-scraped one; otherwise the add route synthesizes one.
      ...(game === 'pokemon' && apiId ? { id: apiId } : {}),
    }
    try {
      const res = await fetch('/api/admin/catalog/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ game, card, variant: variant || undefined }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { onError(data.error ?? `Save failed (${res.status})`); return }
      onSaved()
    } catch {
      onError('Save request failed.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card-glass p-4 mb-4 space-y-3">
      <div className="text-sm font-semibold text-white">Add a card missing from {activeSet.name}</div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <input placeholder="Number (e.g. 21b)" value={number} onChange={(e) => setNumber(e.target.value)}
          className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-slate-200" />
        <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)}
          className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-slate-200 col-span-2" />
        <input placeholder="Rarity" value={rarity} onChange={(e) => setRarity(e.target.value)}
          className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-slate-200" />
        <input placeholder="Variant (e.g. showcase)" value={variant} onChange={(e) => setVariant(e.target.value)}
          className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-slate-200" />
        {game === 'pokemon' && (
          <input placeholder="Official apiId (e.g. sv7-1)" value={apiId} onChange={(e) => setApiId(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-slate-200 col-span-2" />
        )}
        <input placeholder="Image URL" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)}
          className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-slate-200 col-span-2" />
        <input placeholder="Price" value={marketPrice} onChange={(e) => setMarketPrice(e.target.value)}
          className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-slate-200" />
        <input placeholder="Foil price" value={marketPriceFoil} onChange={(e) => setMarketPriceFoil(e.target.value)}
          className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-slate-200" />
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={runLookup}
          disabled={looking || !number}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-cyan-600/20 text-cyan-300 hover:bg-cyan-600/30 disabled:opacity-50"
        >
          {looking ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
          Auto-fetch price &amp; image
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-50"
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
          Save to catalog
        </button>
      </div>

      {candidates.length > 0 && (
        <div className="space-y-1.5">
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
