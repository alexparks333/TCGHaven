'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  ChevronDown, ChevronUp, Edit3, Check, X,
  TrendingUp, TrendingDown, Minus, Info, Loader2, RefreshCw, type LucideIcon,
} from 'lucide-react'
import { useStore } from '@/lib/store'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { formatCurrency } from '@/lib/utils'
import { GAME_COLORS, GAME_LABELS, type Game, type PackSet } from '@/lib/types'
import { cn } from '@/lib/utils'
import { PULL_RATES } from '@/lib/pack-analysis/riftbound-ev'
import { LORCANA_PULL_RATES, type LorcanaSetEV } from '@/lib/pack-analysis/lorcana-ev'

const GAMES: Game[] = ['pokemon', 'lorcana', 'riftbound']
const RB_COLOR = GAME_COLORS['riftbound']
const LC_COLOR = GAME_COLORS['lorcana']

// Match the shape returned by /api/pack-analysis/riftbound
interface RBSetAPI {
  setCode: string
  setName: string
  releaseDate: string
  packPrice: number
  cardsPerPack: number
  avgCommon: number; avgUncommon: number; avgRare: number; avgEpic: number
  avgFoilCommon: number; avgFoilUncommon: number
  avgAltArt: number; avgOvernumber: number; avgSignature: number
  countCommon: number; countUncommon: number; countRare: number; countEpic: number
  countAltArt: number; countOvernumber: number; countSignature: number
  topEpics: CardHit[]; topRares: CardHit[]; topAltArts: CardHit[]
  topOvernumbers: CardHit[]; topSignatures: CardHit[]
  ev: {
    commons: number; uncommons: number; rarePlusSlots: number; wildcardSlot: number
    wildcardBase: number; wildcardAltArt: number; wildcardOvernumber: number; wildcardSignature: number
    total: number
  }
}

interface CardHit { name: string; price: number; imageUrl: string }

export default function PackAnalysisPage() {
  const { packSets, updatePackSet, packPriceOverrides, setPackPriceOverride } = useStore()
  const [activeGame, setActiveGame] = useState<Game>('riftbound')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingPrice, setEditingPrice] = useState<string | null>(null)
  const [priceInput, setPriceInput] = useState('')

  const [lorcanaSets, setLorcanaSets] = useState<LorcanaSetEV[] | null>(null)
  const [lorcanaLoading, setLorcanaLoading] = useState(false)
  const [riftboundSets, setRiftboundSets] = useState<RBSetAPI[] | null>(null)
  const [riftboundLoading, setRiftboundLoading] = useState(false)

  const fetchLorcana = useCallback(() => {
    setLorcanaLoading(true)
    setLorcanaSets(null)
    fetch('/api/pack-analysis/lorcana')
      .then((r) => r.json())
      .then((data) => setLorcanaSets(data))
      .catch(() => setLorcanaSets([]))
      .finally(() => setLorcanaLoading(false))
  }, [])

  const fetchRiftbound = useCallback(() => {
    setRiftboundLoading(true)
    setRiftboundSets(null)
    fetch('/api/pack-analysis/riftbound')
      .then((r) => r.json())
      .then((data) => setRiftboundSets(data))
      .catch(() => setRiftboundSets([]))
      .finally(() => setRiftboundLoading(false))
  }, [])

  useEffect(() => {
    if (activeGame === 'lorcana' && lorcanaSets === null && !lorcanaLoading) fetchLorcana()
    if (activeGame === 'riftbound' && riftboundSets === null && !riftboundLoading) fetchRiftbound()
  }, [activeGame]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleRefresh() {
    if (activeGame === 'lorcana') fetchLorcana()
    else if (activeGame === 'riftbound') fetchRiftbound()
  }

  function startEditPrice(id: string, current: number) {
    setEditingPrice(id)
    setPriceInput(current.toFixed(2))
  }

  function savePrice(id: string, isPokemon = false) {
    const price = parseFloat(priceInput)
    if (!isNaN(price) && price > 0) {
      if (isPokemon) updatePackSet(id, { packPrice: price })
      else setPackPriceOverride(id, price)
    }
    setEditingPrice(null)
  }

  function getVerdict(ev: number, price: number) {
    const ratio = ev / price
    if (ratio >= 1.15) return { label: 'Over EV', color: 'text-emerald-400', bg: 'bg-emerald-950/40 border-emerald-900', icon: TrendingUp }
    if (ratio >= 0.9)  return { label: 'Near EV', color: 'text-amber-400',   bg: 'bg-amber-950/40 border-amber-900',   icon: Minus }
    return              { label: 'Below EV', color: 'text-red-400',     bg: 'bg-red-950/40 border-red-900',     icon: TrendingDown }
  }

  const standardSets = packSets
    .filter((s) => s.game === activeGame)
    .sort((a, b) => (b.expectedValue ?? 0) / b.packPrice - (a.expectedValue ?? 0) / a.packPrice)

  const isLiveGame = activeGame === 'lorcana' || activeGame === 'riftbound'
  const isLoading  = (activeGame === 'lorcana' && lorcanaLoading) || (activeGame === 'riftbound' && riftboundLoading)

  return (
    <AuthGuard>
      <div className="pb-20 md:pb-0">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Pack Analysis</h1>
            <p className="text-slate-400 text-sm mt-0.5">
              Expected Value (EV) per pack based on pull rates and live market prices.
            </p>
          </div>
          {isLiveGame && (
            <button
              onClick={handleRefresh}
              disabled={isLoading}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-400 hover:text-white hover:border-slate-600 transition-all disabled:opacity-50"
            >
              <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
              {isLoading ? 'Loading…' : 'Refresh Prices'}
            </button>
          )}
        </div>

        <div className="flex gap-2 mb-6">
          {GAMES.map((game) => (
            <button
              key={game}
              onClick={() => setActiveGame(game)}
              className={cn(
                'px-4 py-2 rounded-xl text-sm font-medium transition-all',
                activeGame === game ? 'text-white shadow-lg' : 'bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800'
              )}
              style={activeGame === game ? { backgroundColor: GAME_COLORS[game] + '33', color: GAME_COLORS[game], border: `1px solid ${GAME_COLORS[game]}55` } : {}}
            >
              {GAME_LABELS[game]}
            </button>
          ))}
        </div>

        {activeGame === 'riftbound' ? (
          <RiftboundView
            sets={riftboundSets}
            loading={riftboundLoading}
            expandedId={expandedId}
            setExpandedId={setExpandedId}
            editingPrice={editingPrice}
            priceInput={priceInput}
            setPriceInput={setPriceInput}
            packPriceOverrides={packPriceOverrides}
            onEditPrice={startEditPrice}
            onSavePrice={(id) => savePrice(id)}
            onCancelEdit={() => setEditingPrice(null)}
            getVerdict={getVerdict}
          />
        ) : activeGame === 'lorcana' ? (
          <LorcanaView
            sets={lorcanaSets}
            loading={lorcanaLoading}
            expandedId={expandedId}
            setExpandedId={setExpandedId}
            editingPrice={editingPrice}
            priceInput={priceInput}
            setPriceInput={setPriceInput}
            packPriceOverrides={packPriceOverrides}
            onEditPrice={startEditPrice}
            onSavePrice={(id) => savePrice(id)}
            onCancelEdit={() => setEditingPrice(null)}
            getVerdict={getVerdict}
          />
        ) : (
          <StandardView
            sets={standardSets}
            game={activeGame}
            expandedId={expandedId}
            setExpandedId={setExpandedId}
            editingPrice={editingPrice}
            priceInput={priceInput}
            setPriceInput={setPriceInput}
            onEditPrice={(id, price) => startEditPrice(id, price)}
            onSavePrice={(id) => savePrice(id, true)}
            onCancelEdit={() => setEditingPrice(null)}
            getVerdict={getVerdict}
          />
        )}
      </div>
    </AuthGuard>
  )
}

// ── Shared loading / empty states ─────────────────────────────────────────────

function LoadingState({ color }: { color: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-3 text-slate-500">
      <Loader2 size={28} className="animate-spin" style={{ color }} />
      <span className="text-sm">Fetching live prices…</span>
    </div>
  )
}

// ── Price edit controls (shared) ──────────────────────────────────────────────

interface PriceEditProps {
  id: string
  packPrice: number
  color: string
  editingPrice: string | null
  priceInput: string
  setPriceInput: (v: string) => void
  onEditPrice: (id: string, price: number) => void
  onSavePrice: (id: string) => void
  onCancelEdit: () => void
}

function PackPriceCell({ id, packPrice, color, editingPrice, priceInput, setPriceInput, onEditPrice, onSavePrice, onCancelEdit }: PriceEditProps) {
  const isEditing = editingPrice === id
  return (
    <div className="text-center shrink-0" onClick={(e) => e.stopPropagation()}>
      <div className="text-xs text-slate-500 mb-1">Pack Price</div>
      {isEditing ? (
        <div className="flex items-center gap-1">
          <span className="text-xs text-slate-400">$</span>
          <input
            type="number" step="0.01" value={priceInput}
            onChange={(e) => setPriceInput(e.target.value)}
            className="w-16 bg-slate-800 border rounded px-1.5 py-0.5 text-sm text-white text-center focus:outline-none"
            style={{ borderColor: color }}
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') onSavePrice(id); if (e.key === 'Escape') onCancelEdit() }}
          />
          <button onClick={() => onSavePrice(id)} className="text-emerald-400 hover:text-emerald-300"><Check size={14} /></button>
          <button onClick={onCancelEdit} className="text-slate-500 hover:text-slate-300"><X size={14} /></button>
        </div>
      ) : (
        <button
          onClick={() => onEditPrice(id, packPrice)}
          className="flex items-center gap-1 text-white font-bold hover:opacity-70 transition-opacity"
        >
          {formatCurrency(packPrice)}<Edit3 size={11} className="text-slate-600" />
        </button>
      )}
    </div>
  )
}

// ── Riftbound View ────────────────────────────────────────────────────────────

interface RiftboundViewProps {
  sets: RBSetAPI[] | null
  loading: boolean
  expandedId: string | null
  setExpandedId: (id: string | null) => void
  editingPrice: string | null
  priceInput: string
  setPriceInput: (v: string) => void
  packPriceOverrides: Record<string, number>
  onEditPrice: (id: string, price: number) => void
  onSavePrice: (id: string) => void
  onCancelEdit: () => void
  getVerdict: (ev: number, price: number) => { label: string; color: string; bg: string; icon: LucideIcon }
}

function RiftboundView({ sets, loading, expandedId, setExpandedId, editingPrice, priceInput, setPriceInput, packPriceOverrides, onEditPrice, onSavePrice, onCancelEdit, getVerdict }: RiftboundViewProps) {
  if (loading || sets === null) return <LoadingState color={RB_COLOR} />

  const sorted = [...sets].sort((a, b) => b.ev.total - a.ev.total)

  return (
    <div className="space-y-4">
      <div className="card-glass p-4 flex gap-3 items-start">
        <Info size={16} className="text-orange-400 mt-0.5 shrink-0" />
        <div className="text-sm text-slate-400 space-y-1">
          <div>
            <span className="text-white font-medium">Pack contents (14 cards):</span>
            {' '}7 Commons · 3 Uncommons · 2 foil Rare-or-better · 1 foil wildcard · 1 token
          </div>
          <div className="text-xs text-slate-500">
            Pull rates — Epic: {(PULL_RATES.epicPerPack * 100).toFixed(0)}% per pack (official) ·
            Alt Art: {(PULL_RATES.altArtPerPack * 100).toFixed(1)}% ·
            Overnumber: {(PULL_RATES.overnumberPerPack * 100).toFixed(1)}% ·
            Signature: {(PULL_RATES.signaturePerPack * 100).toFixed(2)}% (community)
          </div>
        </div>
      </div>

      {sorted.map((set, idx) => {
        const packPrice = packPriceOverrides[set.setCode] ?? set.packPrice
        const ev = set.ev.total
        const verdict = getVerdict(ev, packPrice)
        const VerdictIcon = verdict.icon
        const isExpanded = expandedId === set.setCode
        const ratio = ev / packPrice

        return (
          <div key={set.setCode} className="card-glass overflow-hidden">
            <div className="p-5 cursor-pointer hover:bg-slate-800/20 transition-colors" onClick={() => setExpandedId(isExpanded ? null : set.setCode)}>
              <div className="flex items-center gap-4">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-black shrink-0" style={{ backgroundColor: RB_COLOR + '22', color: RB_COLOR }}>
                  #{idx + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-white text-sm">{set.setName}</div>
                  <div className="text-xs text-slate-500">
                    {set.cardsPerPack} tradeable cards/pack ·{' '}
                    {set.countCommon}C / {set.countUncommon}U / {set.countRare}R / {set.countEpic}E ·{' '}
                    Released {new Date(set.releaseDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                  </div>
                </div>
                <PackPriceCell id={set.setCode} packPrice={packPrice} color={RB_COLOR} editingPrice={editingPrice} priceInput={priceInput} setPriceInput={setPriceInput} onEditPrice={onEditPrice} onSavePrice={onSavePrice} onCancelEdit={onCancelEdit} />
                <div className="text-center shrink-0">
                  <div className="text-xs text-slate-500 mb-1">EV / Pack</div>
                  <div className="text-white font-bold">{formatCurrency(ev)}</div>
                </div>
                <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold shrink-0 ${verdict.bg} ${verdict.color}`}>
                  <VerdictIcon size={12} />{verdict.label}
                </div>
                <div className="text-slate-600 shrink-0">{isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</div>
              </div>
              <div className="mt-3 flex items-center gap-3">
                <div className="flex-1 bg-slate-800 rounded-full h-1.5 overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(ratio * 50, 100)}%`, backgroundColor: ratio >= 1.15 ? '#34d399' : ratio >= 0.9 ? '#fbbf24' : '#f87171' }} />
                </div>
                <span className="text-xs text-slate-400 shrink-0">{(ratio * 100).toFixed(0)}% ROI</span>
              </div>
            </div>
            {isExpanded && (
              <div className="border-t border-slate-800">
                <RiftboundSetDetail set={set} packPrice={packPrice} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Riftbound Set Detail ──────────────────────────────────────────────────────

function RiftboundSetDetail({ set, packPrice }: { set: RBSetAPI; packPrice: number }) {
  const [activeTab, setActiveTab] = useState<'ev' | 'epics' | 'rares' | 'premium'>('ev')
  const ev = set.ev
  const total = ev.total

  const slots = [
    { label: '7 Commons',         value: ev.commons,       desc: `avg ${formatCurrency(set.avgCommon)}/card · ${set.countCommon} in pool` },
    { label: '3 Uncommons',       value: ev.uncommons,     desc: `avg ${formatCurrency(set.avgUncommon)}/card · ${set.countUncommon} in pool` },
    { label: '2 Rare+ foil slots',value: ev.rarePlusSlots, desc: `75% pack → 2 Rares (avg ${formatCurrency(set.avgRare)}) · 25% → 1 Epic (avg ${formatCurrency(set.avgEpic)})` },
    { label: 'Foil wildcard slot',value: ev.wildcardSlot,  desc: `${(PULL_RATES.altArtPerPack * 100).toFixed(1)}% Alt Art · ${(PULL_RATES.overnumberPerPack * 100).toFixed(1)}% Overnumber · ${(PULL_RATES.signaturePerPack * 100).toFixed(2)}% Signature` },
  ]

  const wildcardRows = [
    { label: `Foil C/U (~${((1 - PULL_RATES.altArtPerPack - PULL_RATES.overnumberPerPack - PULL_RATES.signaturePerPack) * 100).toFixed(0)}%)`, value: ev.wildcardBase },
    { label: `Alt Art (${(PULL_RATES.altArtPerPack * 100).toFixed(1)}% · avg ${formatCurrency(set.avgAltArt)})`,         value: ev.wildcardAltArt },
    { label: `Overnumber (${(PULL_RATES.overnumberPerPack * 100).toFixed(1)}% · avg ${formatCurrency(set.avgOvernumber)})`, value: ev.wildcardOvernumber },
    { label: `Signature (${(PULL_RATES.signaturePerPack * 100).toFixed(2)}% · avg ${formatCurrency(set.avgSignature)})`, value: ev.wildcardSignature },
  ]

  return (
    <div className="px-5 py-4">
      <div className="flex gap-1 mb-5 bg-slate-900 rounded-xl p-1 w-fit">
        {(['ev', 'epics', 'rares', 'premium'] as const).map((tab) => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-all', activeTab === tab ? 'text-white' : 'text-slate-500 hover:text-white')}
            style={activeTab === tab ? { backgroundColor: RB_COLOR + '30', color: RB_COLOR } : {}}
          >
            {{ ev: 'EV Breakdown', epics: 'Top Epics', rares: 'Top Rares', premium: 'Premium Hits' }[tab]}
          </button>
        ))}
      </div>

      {activeTab === 'ev' && (
        <div className="space-y-3">
          {slots.map((slot) => (
            <div key={slot.label} className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-sm text-white font-medium">{slot.label}</span>
                <span className="text-sm font-bold" style={{ color: RB_COLOR }}>{formatCurrency(slot.value)}</span>
              </div>
              <div className="text-xs text-slate-500">{slot.desc}</div>
              <div className="bg-slate-800 rounded-full h-1.5 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${(slot.value / total) * 100}%`, backgroundColor: RB_COLOR, opacity: 0.7 }} />
              </div>
            </div>
          ))}
          <div className="mt-4 pt-4 border-t border-slate-800">
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Wildcard Slot Detail</h4>
            {wildcardRows.map((row) => (
              <div key={row.label} className="flex justify-between py-1 text-sm border-b border-slate-800/50 last:border-0">
                <span className="text-slate-400">{row.label}</span>
                <span className="text-white">{formatCurrency(row.value)}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-slate-800 space-y-1">
            <div className="flex justify-between text-sm"><span className="text-slate-400">Total EV per pack</span><span className="text-white font-bold">{formatCurrency(total)}</span></div>
            <div className="flex justify-between text-sm"><span className="text-slate-400">Pack price</span><span className="text-white">{formatCurrency(packPrice)}</span></div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Net EV</span>
              <span className={`font-bold ${total - packPrice >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {total - packPrice >= 0 ? '+' : ''}{formatCurrency(total - packPrice)}
              </span>
            </div>
          </div>
        </div>
      )}
      {activeTab === 'epics'   && <CardHitList hits={set.topEpics}       label="Top Epics"          rateLabel={`25% per pack · avg ${formatCurrency(set.avgEpic)}`}       color="#c084fc" />}
      {activeTab === 'rares'   && <CardHitList hits={set.topRares}       label="Top Rares"          rateLabel={`Guaranteed (2/pack) · avg ${formatCurrency(set.avgRare)}`} color={RB_COLOR} />}
      {activeTab === 'premium' && (
        <div className="space-y-6">
          <CardHitList hits={set.topAltArts}    label="Alt Arts"          rateLabel={`${(PULL_RATES.altArtPerPack * 100).toFixed(1)}% per pack (~2/box) · avg ${formatCurrency(set.avgAltArt)}`}    color="#fb923c" />
          <CardHitList hits={set.topOvernumbers} label="Overnumbers"       rateLabel={`${(PULL_RATES.overnumberPerPack * 100).toFixed(1)}% per pack (1 in ~72) · avg ${formatCurrency(set.avgOvernumber)}`} color="#f472b6" />
          <CardHitList hits={set.topSignatures}  label="Signature Overnumbers" rateLabel={`${(PULL_RATES.signaturePerPack * 100).toFixed(2)}% per pack (1 in ~720) · avg ${formatCurrency(set.avgSignature)}`} color="#fbbf24" />
        </div>
      )}
    </div>
  )
}

// ── Card Hit List ─────────────────────────────────────────────────────────────

function CardHitList({ hits, label, rateLabel, color }: { hits: CardHit[]; label: string; rateLabel: string; color: string }) {
  return (
    <div>
      <div className="mb-3">
        <h4 className="text-sm font-bold text-white">{label}</h4>
        <p className="text-xs text-slate-500 mt-0.5">{rateLabel}</p>
      </div>
      <div className="space-y-2">
        {hits.map((hit, i) => (
          <div key={i} className="flex items-center gap-3 py-2 border-b border-slate-800/50 last:border-0">
            <div className="w-8 h-8 rounded-md overflow-hidden shrink-0" style={{ backgroundColor: color + '18' }}>
              <img src={hit.imageUrl} alt={hit.name} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-white font-medium truncate">{hit.name}</div>
            </div>
            <div className="text-sm font-bold shrink-0" style={{ color }}>{formatCurrency(hit.price)}</div>
            <div className="w-20 shrink-0">
              <div className="bg-slate-800 rounded-full h-1 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${Math.min((hit.price / (hits[0]?.price || 1)) * 100, 100)}%`, backgroundColor: color, opacity: 0.7 }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Lorcana View ──────────────────────────────────────────────────────────────

interface LorcanaViewProps {
  sets: LorcanaSetEV[] | null
  loading: boolean
  expandedId: string | null
  setExpandedId: (id: string | null) => void
  editingPrice: string | null
  priceInput: string
  setPriceInput: (v: string) => void
  packPriceOverrides: Record<string, number>
  onEditPrice: (id: string, price: number) => void
  onSavePrice: (id: string) => void
  onCancelEdit: () => void
  getVerdict: (ev: number, price: number) => { label: string; color: string; bg: string; icon: LucideIcon }
}

function LorcanaView({ sets, loading, expandedId, setExpandedId, editingPrice, priceInput, setPriceInput, packPriceOverrides, onEditPrice, onSavePrice, onCancelEdit, getVerdict }: LorcanaViewProps) {
  if (loading || sets === null) return <LoadingState color={LC_COLOR} />

  const sorted = [...sets].sort((a, b) => b.ev.total - a.ev.total)

  return (
    <div className="space-y-4">
      <div className="card-glass p-4 flex gap-3 items-start">
        <Info size={16} className="mt-0.5 shrink-0" style={{ color: LC_COLOR }} />
        <div className="text-sm text-slate-400 space-y-1">
          <div>
            <span className="text-white font-medium">Pack contents (12 cards):</span>
            {' '}6 Commons · 3 Uncommons · 2 Rares · 1 cold foil (any rarity)
          </div>
          <div className="text-xs text-slate-500">
            Foil slot — Super Rare: ~{(LORCANA_PULL_RATES.foilSRPerPack * 100).toFixed(0)}% ·
            Legendary: 1/24 · Enchanted: 1/72 · Epic: 1/48 (sets 9–11 only) ·
            SR upgrade: {(LORCANA_PULL_RATES.srUpgradeRate * 100).toFixed(0)}% of packs
          </div>
        </div>
      </div>

      {sorted.map((set, idx) => {
        const packPrice = packPriceOverrides[set.id] ?? set.packPrice
        const ev = set.ev.total
        const verdict = getVerdict(ev, packPrice)
        const VerdictIcon = verdict.icon
        const isExpanded = expandedId === set.id
        const ratio = ev / packPrice

        return (
          <div key={set.id} className="card-glass overflow-hidden">
            <div className="p-5 cursor-pointer hover:bg-slate-800/20 transition-colors" onClick={() => setExpandedId(isExpanded ? null : set.id)}>
              <div className="flex items-center gap-4">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-black shrink-0" style={{ backgroundColor: LC_COLOR + '22', color: LC_COLOR }}>
                  #{idx + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-white text-sm">{set.name}</div>
                  <div className="text-xs text-slate-500">
                    {set.countSR}SR · {set.countLeg}Leg · {set.countEnch}Ench
                    {set.hasEpic && ` · ${set.countEpic}Epic`}
                    {' '}· Released {new Date(set.releaseDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                  </div>
                </div>
                <PackPriceCell id={set.id} packPrice={packPrice} color={LC_COLOR} editingPrice={editingPrice} priceInput={priceInput} setPriceInput={setPriceInput} onEditPrice={onEditPrice} onSavePrice={onSavePrice} onCancelEdit={onCancelEdit} />
                <div className="text-center shrink-0">
                  <div className="text-xs text-slate-500 mb-1">EV / Pack</div>
                  <div className="text-white font-bold">{formatCurrency(ev)}</div>
                </div>
                <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold shrink-0 ${verdict.bg} ${verdict.color}`}>
                  <VerdictIcon size={12} />{verdict.label}
                </div>
                <div className="text-slate-600 shrink-0">{isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</div>
              </div>
              <div className="mt-3 flex items-center gap-3">
                <div className="flex-1 bg-slate-800 rounded-full h-1.5 overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(ratio * 50, 100)}%`, backgroundColor: ratio >= 1.15 ? '#34d399' : ratio >= 0.9 ? '#fbbf24' : '#f87171' }} />
                </div>
                <span className="text-xs text-slate-400 shrink-0">{(ratio * 100).toFixed(0)}% ROI</span>
              </div>
            </div>
            {isExpanded && <div className="border-t border-slate-800"><LorcanaSetDetail set={set} /></div>}
          </div>
        )
      })}
    </div>
  )
}

// ── Lorcana Set Detail ────────────────────────────────────────────────────────

function LorcanaSetDetail({ set }: { set: LorcanaSetEV }) {
  const [activeTab, setActiveTab] = useState<'ev' | 'srs' | 'legendary' | 'premium'>('ev')
  const ev = set.ev
  const total = ev.total

  const slots = [
    { label: '6 Commons',     value: ev.commons,   desc: `avg ${formatCurrency(set.avgCommon)}/card · ${set.countCommon} in pool` },
    { label: '3 Uncommons',   value: ev.uncommons, desc: `avg ${formatCurrency(set.avgUncommon)}/card · ${set.countUncommon} in pool` },
    { label: '2 Rare slots',  value: ev.rares,     desc: `avg ${formatCurrency(set.avgRare)} Rare · ${(set.rates.srUpgradeRate * 100).toFixed(0)}% upgrade → non-foil SR (avg ${formatCurrency(set.avgSR)})` },
    { label: 'Cold foil slot',value: ev.foilSlot,  desc: `${(set.rates.foilSRRate * 100).toFixed(0)}% foil SR · ${(set.rates.foilLegRate * 100).toFixed(1)}% foil Leg · ${(set.rates.foilEnchRate * 100).toFixed(1)}% Enchanted${set.hasEpic ? ` · ${(set.rates.foilEpicRate * 100).toFixed(1)}% Epic` : ''}` },
  ]

  const foilRows = [
    { label: `Foil C/U/R (~${((1 - set.rates.foilSRRate - set.rates.foilLegRate - set.rates.foilEnchRate - set.rates.foilEpicRate) * 100).toFixed(0)}%)`, value: ev.foilCUR },
    { label: `Foil SR (${(set.rates.foilSRRate * 100).toFixed(0)}% · avg ${formatCurrency(set.avgFoilSR)})`, value: ev.foilSR },
    { label: `Foil Legendary (${(set.rates.foilLegRate * 100).toFixed(1)}% · avg ${formatCurrency(set.avgFoilLeg)})`, value: ev.foilLeg },
    { label: `Foil Enchanted (${(set.rates.foilEnchRate * 100).toFixed(1)}% · avg ${formatCurrency(set.avgFoilEnch)})`, value: ev.foilEnch },
    ...(set.hasEpic ? [{ label: `Foil Epic (${(set.rates.foilEpicRate * 100).toFixed(1)}% · avg ${formatCurrency(set.avgFoilEpic)})`, value: ev.foilEpic }] : []),
  ]

  const tabs = [['ev', 'EV Breakdown'], ['srs', 'Top SRs'], ['legendary', 'Legendaries'], ['premium', set.hasEpic ? 'Enchanted & Epic' : 'Enchanted']] as const

  return (
    <div className="px-5 py-4">
      <div className="flex gap-1 mb-5 bg-slate-900 rounded-xl p-1 w-fit">
        {tabs.map(([tab, label]) => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-all', activeTab === tab ? 'text-white' : 'text-slate-500 hover:text-white')}
            style={activeTab === tab ? { backgroundColor: LC_COLOR + '30', color: LC_COLOR } : {}}
          >{label}</button>
        ))}
      </div>

      {activeTab === 'ev' && (
        <div className="space-y-3">
          {slots.map((slot) => (
            <div key={slot.label} className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-sm text-white font-medium">{slot.label}</span>
                <span className="text-sm font-bold" style={{ color: LC_COLOR }}>{formatCurrency(slot.value)}</span>
              </div>
              <div className="text-xs text-slate-500">{slot.desc}</div>
              <div className="bg-slate-800 rounded-full h-1.5 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${(slot.value / total) * 100}%`, backgroundColor: LC_COLOR, opacity: 0.7 }} />
              </div>
            </div>
          ))}
          <div className="mt-4 pt-4 border-t border-slate-800">
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Cold Foil Slot Detail</h4>
            {foilRows.map((row) => (
              <div key={row.label} className="flex justify-between py-1 text-sm border-b border-slate-800/50 last:border-0">
                <span className="text-slate-400">{row.label}</span><span className="text-white">{formatCurrency(row.value)}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-slate-800 space-y-1">
            <div className="flex justify-between text-sm"><span className="text-slate-400">Total EV per pack</span><span className="text-white font-bold">{formatCurrency(total)}</span></div>
            <div className="flex justify-between text-sm"><span className="text-slate-400">Pack price</span><span className="text-white">{formatCurrency(set.packPrice)}</span></div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Net EV</span>
              <span className={`font-bold ${total - set.packPrice >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {total - set.packPrice >= 0 ? '+' : ''}{formatCurrency(total - set.packPrice)}
              </span>
            </div>
          </div>
        </div>
      )}
      {activeTab === 'srs'       && <CardHitList hits={set.topSRs}        label="Top Super Rares (foil)"  rateLabel={`${(set.rates.foilSRRate * 100).toFixed(0)}% per pack from foil slot · avg ${formatCurrency(set.avgFoilSR)}`}              color={LC_COLOR} />}
      {activeTab === 'legendary' && <CardHitList hits={set.topLegendaries} label="Top Legendaries (foil)"  rateLabel={`${(set.rates.foilLegRate * 100).toFixed(1)}% per pack (1 per box) · avg ${formatCurrency(set.avgFoilLeg)}`}           color="#fbbf24" />}
      {activeTab === 'premium'   && (
        <div className="space-y-6">
          <CardHitList hits={set.topEnchanted} label="Enchanted (foil only)" rateLabel={`${(set.rates.foilEnchRate * 100).toFixed(1)}% per pack (1 per ~3 boxes) · avg ${formatCurrency(set.avgFoilEnch)}`} color="#e879f9" />
          {set.hasEpic && <CardHitList hits={set.topEpics} label="Epic (foil only)" rateLabel={`${(set.rates.foilEpicRate * 100).toFixed(1)}% per pack (1 per ~2 boxes) · avg ${formatCurrency(set.avgFoilEpic)}`} color="#a78bfa" />}
        </div>
      )}
    </div>
  )
}

// ── Standard View (Pokémon) ───────────────────────────────────────────────────

interface StandardViewProps {
  sets: PackSet[]
  game: Game
  expandedId: string | null
  setExpandedId: (id: string | null) => void
  editingPrice: string | null
  priceInput: string
  setPriceInput: (v: string) => void
  onEditPrice: (id: string, price: number) => void
  onSavePrice: (id: string) => void
  onCancelEdit: () => void
  getVerdict: (ev: number, price: number) => { label: string; color: string; bg: string; icon: LucideIcon }
}

function StandardView({ sets, game, expandedId, setExpandedId, editingPrice, priceInput, setPriceInput, onEditPrice, onSavePrice, onCancelEdit, getVerdict }: StandardViewProps) {
  const color = GAME_COLORS[game]
  return (
    <div className="space-y-4">
      <div className="card-glass p-4 flex gap-3 items-start">
        <div className="w-8 h-8 rounded-lg bg-violet-900/50 flex items-center justify-center shrink-0">
          <span className="text-violet-400 text-sm font-bold">?</span>
        </div>
        <div className="text-sm text-slate-400">
          <span className="text-white font-medium">Expected Value (EV)</span> is the average dollar value you&apos;d expect per pack, calculated from pull rates × card market prices. EV &gt; pack price = statistically worth opening.
        </div>
      </div>
      {sets.map((set, idx) => {
        const ev = set.expectedValue ?? 0
        const ratio = ev / set.packPrice
        const verdict = getVerdict(ev, set.packPrice)
        const VerdictIcon = verdict.icon
        const isExpanded = expandedId === set.id
        const isEditing = editingPrice === set.id
        return (
          <div key={set.id} className="card-glass overflow-hidden">
            <div className="p-5 cursor-pointer hover:bg-slate-800/20 transition-colors" onClick={() => setExpandedId(isExpanded ? null : set.id)}>
              <div className="flex items-center gap-4">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-black shrink-0" style={{ backgroundColor: color + '22', color }}>#{idx + 1}</div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-white text-sm">{set.name}</h3>
                  <div className="text-xs text-slate-500">{set.cardsPerPack} cards/pack · Released {new Date(set.releaseDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</div>
                </div>
                <div className="text-center shrink-0" onClick={(e) => e.stopPropagation()}>
                  <div className="text-xs text-slate-500 mb-1">Pack Price</div>
                  {isEditing ? (
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-slate-400">$</span>
                      <input type="number" step="0.01" value={priceInput} onChange={(e) => setPriceInput(e.target.value)} className="w-16 bg-slate-800 border border-violet-600 rounded px-1.5 py-0.5 text-sm text-white text-center focus:outline-none" autoFocus onKeyDown={(e) => { if (e.key === 'Enter') onSavePrice(set.id); if (e.key === 'Escape') onCancelEdit() }} />
                      <button onClick={() => onSavePrice(set.id)} className="text-emerald-400 hover:text-emerald-300"><Check size={14} /></button>
                      <button onClick={onCancelEdit} className="text-slate-500 hover:text-slate-300"><X size={14} /></button>
                    </div>
                  ) : (
                    <button onClick={() => onEditPrice(set.id, set.packPrice)} className="flex items-center gap-1 text-white font-bold hover:text-violet-400 transition-colors">
                      {formatCurrency(set.packPrice)}<Edit3 size={11} className="text-slate-600" />
                    </button>
                  )}
                </div>
                <div className="text-center shrink-0">
                  <div className="text-xs text-slate-500 mb-1">EV / Pack</div>
                  <div className="text-white font-bold">{formatCurrency(ev)}</div>
                </div>
                <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold shrink-0 ${verdict.bg} ${verdict.color}`}>
                  <VerdictIcon size={12} />{verdict.label}
                </div>
                <div className="text-slate-600 shrink-0">{isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</div>
              </div>
              <div className="mt-3 flex items-center gap-3">
                <div className="flex-1 bg-slate-800 rounded-full h-1.5 overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(ratio * 100, 100)}%`, backgroundColor: ratio >= 1.15 ? '#34d399' : ratio >= 0.9 ? '#fbbf24' : '#f87171' }} />
                </div>
                <span className="text-xs text-slate-400 shrink-0">{(ratio * 100).toFixed(0)}% ROI</span>
              </div>
            </div>
            {isExpanded && set.pullRates && (
              <div className="border-t border-slate-800 px-5 py-4">
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Pull Rate Breakdown</h4>
                <div className="space-y-2">
                  {set.pullRates.map((pr) => {
                    const contribution = pr.rate * pr.avgValue
                    return (
                      <div key={pr.rarity} className="flex items-center gap-4">
                        <div className="w-36 text-sm text-slate-300 shrink-0">{pr.rarity}</div>
                        <div className="text-xs text-slate-500 w-20 shrink-0">1 in {Math.round(1 / pr.rate)}</div>
                        <div className="flex-1 bg-slate-800 rounded-full h-1.5 overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${Math.min((contribution / ev) * 100, 100)}%`, backgroundColor: color, opacity: 0.8 }} />
                        </div>
                        <div className="text-xs text-slate-400 w-20 text-right shrink-0">+{formatCurrency(contribution)} EV</div>
                      </div>
                    )
                  })}
                </div>
                <div className="mt-4 pt-4 border-t border-slate-800 space-y-1 text-sm">
                  <div className="flex justify-between"><span className="text-slate-400">Total EV per pack</span><span className="text-white font-bold">{formatCurrency(ev)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Pack price</span><span className="text-white">{formatCurrency(set.packPrice)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Net EV</span><span className={`font-bold ${ev - set.packPrice >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{ev - set.packPrice >= 0 ? '+' : ''}{formatCurrency(ev - set.packPrice)}</span></div>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
