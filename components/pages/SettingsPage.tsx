'use client'

import { useEffect, useRef, useState } from 'react'
import { RefreshCw, Loader2, CheckCircle2, AlertCircle, ChevronRight, Search, Wrench } from 'lucide-react'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { useAuth } from '@/components/auth/AuthProvider'
import { useStore } from '@/lib/store'
import { editCard } from '@/lib/firebase/db'
import { cn, riftboundDisplayNumber, riftboundInherentFoil } from '@/lib/utils'

// ── Types (mirror app/api/sync/status and lib/api/registry.ts shapes) ─────────

interface SyncPhaseInfo { status: 'pending' | 'running' | 'done' | 'failed'; reason?: string; groupsFetched?: boolean }

interface SyncStatus {
  phase: string
  runId?: string
  startedAt?: string
  updatedAt?: string
  phases?: Record<string, SyncPhaseInfo>
  summary?: {
    newSets: { pokemon: number; lorcana: string[]; riftbound: string[] }
    riftboundGroupMatches: { setName: string; matched: boolean; groupId: number | null; confidence: number | null }[]
    registryUpdates: { game: string; setName: string; needsReview: boolean }[]
    build: { success: boolean | null; durationMs: number | null; errorTail: string | null }
    restart: { attempted: boolean; success: boolean | null; oldPid: number | null; newPid: number | null }
  }
  error?: string | null
}

interface LorcanaRegistrySet {
  setName: string
  code: string | null
  releaseDate: string | null
  cardexGroup: string | null
  packAnalysis: { included: boolean; packPrice?: number; hasEpic?: boolean }
  needsReview: boolean
  source: string
}

interface RiftboundRegistrySet {
  setName: string
  setCode: string
  releaseDate: string | null
  cardCount: number
  cardexGroup: string | null
  tcgcsvGroupId: number | null
  groupMatchConfidence: number | null
  needsReview: boolean
  source: string
}

interface SetRegistryResponse {
  lorcana: { groupOrder: string[]; sets: LorcanaRegistrySet[] }
  riftbound: { groupOrder: string[]; sets: RiftboundRegistrySet[] }
}

const RUNNING_PHASES = new Set([
  'downloading', 'diffing', 'matching-riftbound-groups', 'updating-registry',
  'repricing', 'building', 'restarting',
])

const PHASE_LABELS: Record<string, string> = {
  idle: 'Idle',
  backup: 'Backing up current catalogs…',
  downloading: 'Downloading catalogs…',
  diffing: 'Checking for new sets…',
  'matching-riftbound-groups': 'Matching new Riftbound sets to TCGPlayer…',
  'updating-registry': 'Registering new sets…',
  repricing: 'Fetching prices for newly-matched sets…',
  building: 'Rebuilding the app…',
  restarting: 'Restarting the server…',
  done: 'Done',
  failed: 'Failed',
}

export default function SettingsPage() {
  return (
    <AuthGuard>
      <div className="pb-20 md:pb-0 max-w-2xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white">Settings</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            Keep card catalogs, prices, and set registrations up to date.
          </p>
        </div>

        <SyncCard />
        <InventoryNumberRepairCard />
        <NeedsReviewCard />
      </div>
    </AuthGuard>
  )
}

// ── Sync Card Data ──────────────────────────────────────────────────────────

function SyncCard() {
  const [status, setStatus] = useState<SyncStatus>({ phase: 'idle' })
  const [triggering, setTriggering] = useState(false)
  const [triggerError, setTriggerError] = useState<string | null>(null)
  const [isProd, setIsProd] = useState<boolean | null>(null)
  const failuresRef = useRef(0)

  useEffect(() => {
    let stale = false
    function poll() {
      fetch('/api/sync/status', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((data: SyncStatus) => {
          if (stale) return
          failuresRef.current = 0
          setStatus(data)
        })
        .catch(() => {
          if (stale) return
          failuresRef.current += 1
          // Mid-restart the server is briefly unreachable — don't treat that as an error.
        })
    }
    poll()
    const interval = setInterval(poll, 2000)
    return () => { stale = true; clearInterval(interval) }
  }, [])

  const isRunning = RUNNING_PHASES.has(status.phase)

  async function handleSync() {
    setTriggerError(null)
    setTriggering(true)
    try {
      const res = await fetch('/api/sync', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setTriggerError(data.error ?? `Request failed (${res.status})`)
        if (res.status === 400) setIsProd(false)
        return
      }
      setStatus({ phase: 'backup' })
    } catch {
      setTriggerError('Could not reach the server.')
    } finally {
      setTriggering(false)
    }
  }

  const disabled = triggering || isRunning || isProd === false

  return (
    <div className="card-glass p-5 mb-6">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="text-white font-semibold">Sync Card Data</h2>
          <p className="text-slate-400 text-sm mt-1">
            Re-downloads all three catalogs, tries to auto-discover new Riftbound sets&apos; TCGPlayer
            prices, registers any newly-found sets, then rebuilds and restarts the app. If the rebuild
            fails, the currently running app is left untouched.
          </p>
        </div>
        <button
          onClick={handleSync}
          disabled={disabled}
          className={cn(
            'shrink-0 flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all',
            disabled
              ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
              : 'bg-violet-600 text-white hover:bg-violet-500',
          )}
        >
          {isRunning || triggering ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          Sync Card Data
        </button>
      </div>

      {isProd === false && (
        <div className="flex items-start gap-2 text-amber-400 text-xs bg-amber-950/30 border border-amber-900/50 rounded-lg px-3 py-2 mb-3">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>
            Sync only runs against the production server (<code>npm run build && npm run start</code>).
            You&apos;re on <code>npm run dev</code> right now — this would kill your dev server, so the button is disabled.
          </span>
        </div>
      )}

      {triggerError && isProd !== false && (
        <div className="flex items-start gap-2 text-red-400 text-xs bg-red-950/30 border border-red-900/50 rounded-lg px-3 py-2 mb-3">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>{triggerError}</span>
        </div>
      )}

      {status.phase !== 'idle' && (
        <div className="border-t border-slate-800 pt-4">
          <div className="flex items-center gap-2 mb-3">
            {status.phase === 'failed' ? (
              <AlertCircle size={16} className="text-red-400" />
            ) : status.phase === 'done' ? (
              <CheckCircle2 size={16} className="text-emerald-400" />
            ) : (
              <Loader2 size={16} className="animate-spin text-violet-400" />
            )}
            <span className="text-sm font-medium text-white">
              {PHASE_LABELS[status.phase] ?? status.phase}
            </span>
            {failuresRef.current > 3 && isRunning && (
              <span className="text-xs text-slate-500">(server restarting, reconnecting…)</span>
            )}
          </div>

          {status.phase === 'failed' && status.error && (
            <p className="text-xs text-red-400 mb-2">{status.error}</p>
          )}

          {status.summary && (status.phase === 'done' || status.phase === 'failed') && (
            <SyncSummary summary={status.summary} />
          )}
        </div>
      )}
    </div>
  )
}

function SyncSummary({ summary }: { summary: NonNullable<SyncStatus['summary']> }) {
  const hasNewSets =
    summary.newSets.pokemon > 0 || summary.newSets.lorcana.length > 0 || summary.newSets.riftbound.length > 0

  return (
    <div className="space-y-2 text-xs text-slate-400">
      <div>
        New sets found — Pokémon: {summary.newSets.pokemon}, Lorcana: {summary.newSets.lorcana.length || 0}
        {summary.newSets.lorcana.length > 0 && ` (${summary.newSets.lorcana.join(', ')})`}, Riftbound:{' '}
        {summary.newSets.riftbound.length || 0}
        {summary.newSets.riftbound.length > 0 && ` (${summary.newSets.riftbound.join(', ')})`}
        {!hasNewSets && ' — nothing new since last sync'}
      </div>

      {summary.riftboundGroupMatches.length > 0 && (
        <div>
          Riftbound TCGPlayer matches:{' '}
          {summary.riftboundGroupMatches.map((m) => (
            <span key={m.setName} className="inline-block mr-2">
              {m.setName}: {m.matched ? `matched (${Math.round((m.confidence ?? 0) * 100)}%)` : 'no confident match — needs manual group ID'}
            </span>
          ))}
        </div>
      )}

      {summary.build.success !== null && (
        <div>
          Build: {summary.build.success ? 'succeeded' : 'failed'}
          {summary.build.durationMs != null && ` in ${Math.round(summary.build.durationMs / 1000)}s`}
        </div>
      )}
      {summary.build.errorTail && (
        <pre className="bg-slate-950 border border-slate-800 rounded-lg p-2 overflow-x-auto max-h-40 text-[10px] text-red-400">
          {summary.build.errorTail}
        </pre>
      )}

      {summary.restart.attempted && (
        <div>Server restart: {summary.restart.success ? `succeeded (pid ${summary.restart.newPid})` : 'failed'}</div>
      )}

      {(summary.registryUpdates.length > 0) && (
        <div className="text-amber-400">
          {summary.registryUpdates.length} new set{summary.registryUpdates.length !== 1 ? 's' : ''} need review below.
        </div>
      )}
    </div>
  )
}

// ── Fix Riftbound Card Numbers (one-time repair for already-added inventory cards) ─────

interface CatalogCardLite {
  id: string
  number: string
  publicCode?: string
  rarity?: string
}

interface CardMismatch {
  cardId: string
  name: string
  set: string
  oldNumber?: string
  newNumber?: string
  oldFoil?: boolean
  newFoil?: boolean
}

function InventoryNumberRepairCard() {
  const { user } = useAuth()
  const { cards, updateCard } = useStore()
  const [scanning, setScanning] = useState(false)
  const [mismatches, setMismatches] = useState<CardMismatch[] | null>(null)
  const [fixing, setFixing] = useState(false)
  const [fixedCount, setFixedCount] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function scan() {
    setScanning(true)
    setError(null)
    setMismatches(null)
    setFixedCount(null)
    try {
      const res = await fetch('/api/admin/catalog?game=riftbound')
      if (!res.ok) throw new Error(`Catalog fetch failed (${res.status})`)
      const catalog: CatalogCardLite[] = await res.json()
      const byId = new Map(catalog.map((c) => [c.id, c]))

      const found: CardMismatch[] = []
      for (const card of cards) {
        if (card.game !== 'riftbound' || !card.apiId) continue
        const catalogCard = byId.get(card.apiId)
        if (!catalogCard) continue

        const m: CardMismatch = { cardId: card.id, name: card.name, set: card.set }
        let hasMismatch = false

        const correctNumber = riftboundDisplayNumber(catalogCard.number, catalogCard.publicCode)
        if (correctNumber !== card.number) {
          m.oldNumber = card.number
          m.newNumber = correctNumber
          hasMismatch = true
        }

        // Overnumbered/alt-art Showcase/Signature variants have a definitively correct foil
        // status (see riftboundInherentFoil) — regular cards return null and are left alone,
        // since foil-or-not there is a genuine purchase choice, not a data error.
        const correctFoil = riftboundInherentFoil(catalogCard.rarity, catalogCard.publicCode)
        if (correctFoil !== null && correctFoil !== card.isFoil) {
          m.oldFoil = card.isFoil
          m.newFoil = correctFoil
          hasMismatch = true
        }

        if (hasMismatch) found.push(m)
      }
      setMismatches(found)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setScanning(false)
    }
  }

  async function fixAll() {
    if (!user || !mismatches) return
    setFixing(true)
    setError(null)
    let fixed = 0
    try {
      for (const m of mismatches) {
        const patch: { number?: string; isFoil?: boolean } = {}
        if (m.newNumber !== undefined) patch.number = m.newNumber
        if (m.newFoil !== undefined) patch.isFoil = m.newFoil
        await editCard(user.uid, m.cardId, patch)
        updateCard(m.cardId, patch)
        fixed++
      }
      setFixedCount(fixed)
      setMismatches([])
    } catch (err) {
      setError(`Stopped after fixing ${fixed}/${mismatches.length} — ${(err as Error).message}`)
    } finally {
      setFixing(false)
    }
  }

  return (
    <div className="card-glass p-5 mb-6">
      <h2 className="text-white font-semibold mb-1">Fix Riftbound Numbers &amp; Foil Status</h2>
      <p className="text-slate-400 text-sm mb-4">
        Alt-art Riftbound cards (e.g. an alt-art printed as &quot;92a&quot;) were sometimes saved with
        just the bare number (&quot;92&quot;), missing the letter suffix printed on the card. Overnumbered
        and Signature cards could also be saved with the wrong Foil status. This only ever
        touches the card&apos;s number and foil fields — nothing else about the card (price,
        quantity, condition) is changed. Only cards originally added via the search dropdown
        (which carries a catalog link) can be checked.
      </p>

      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={scan}
          disabled={scanning}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:opacity-50"
        >
          {scanning ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
          Scan my inventory
        </button>
        {mismatches && mismatches.length > 0 && (
          <button
            onClick={fixAll}
            disabled={fixing}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-50"
          >
            {fixing ? <Loader2 size={14} className="animate-spin" /> : <Wrench size={14} />}
            Fix {mismatches.length} card{mismatches.length !== 1 ? 's' : ''}
          </button>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 text-red-400 text-xs bg-red-950/30 border border-red-900/50 rounded-lg px-3 py-2 mb-3">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {mismatches && mismatches.length === 0 && fixedCount === null && (
        <div className="flex items-center gap-2 text-sm text-emerald-400">
          <CheckCircle2 size={14} /> No mismatches found — your Riftbound numbers and foil status already look correct.
        </div>
      )}

      {fixedCount !== null && (
        <div className="flex items-center gap-2 text-sm text-emerald-400">
          <CheckCircle2 size={14} /> Fixed {fixedCount} card{fixedCount !== 1 ? 's' : ''}.
        </div>
      )}

      {mismatches && mismatches.length > 0 && (
        <div className="space-y-1 text-xs max-h-60 overflow-y-auto border-t border-slate-800 pt-2">
          {mismatches.map((m) => (
            <div key={m.cardId} className="flex justify-between items-center border-b border-slate-900 py-1 gap-3">
              <span className="text-white truncate">{m.name}</span>
              <span className="text-slate-400 flex items-center gap-3 shrink-0">
                {m.newNumber !== undefined && (
                  <span>{m.oldNumber} → <span className="text-violet-300 font-medium">{m.newNumber}</span></span>
                )}
                {m.newFoil !== undefined && (
                  <span>
                    {m.oldFoil ? '✨ Foil' : 'Normal'} →{' '}
                    <span className="text-violet-300 font-medium">{m.newFoil ? '✨ Foil' : 'Normal'}</span>
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Needs Review ────────────────────────────────────────────────────────────

function NeedsReviewCard() {
  const [registry, setRegistry] = useState<SetRegistryResponse | null>(null)
  const [loading, setLoading] = useState(true)

  function load() {
    setLoading(true)
    fetch('/api/set-registry')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setRegistry(data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  async function patch(game: 'lorcana' | 'riftbound', setName: string, p: Record<string, unknown>) {
    await fetch('/api/set-registry', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game, setName, patch: p }),
    })
    load()
  }

  if (loading) {
    return (
      <div className="card-glass p-5 flex items-center gap-2 text-slate-500 text-sm">
        <Loader2 size={14} className="animate-spin" /> Loading set registry…
      </div>
    )
  }

  const lorcanaReview = registry?.lorcana.sets.filter((s) => s.needsReview) ?? []
  const riftboundReview = registry?.riftbound.sets.filter((s) => s.needsReview) ?? []

  if (lorcanaReview.length === 0 && riftboundReview.length === 0) {
    return (
      <div className="card-glass p-5 text-sm text-slate-400">
        No sets need review. Newly auto-discovered sets will show up here after a sync.
      </div>
    )
  }

  return (
    <div className="card-glass p-5">
      <h2 className="text-white font-semibold mb-1">Needs Review</h2>
      <p className="text-slate-400 text-sm mb-4">
        These sets were auto-detected by a sync. Confirm the details before they&apos;re fully live.
      </p>

      <div className="space-y-3">
        {lorcanaReview.map((s) => (
          <LorcanaReviewRow
            key={s.setName}
            set={s}
            groupOrder={registry?.lorcana.groupOrder ?? []}
            onPatch={(p) => patch('lorcana', s.setName, p)}
          />
        ))}
        {riftboundReview.map((s) => (
          <RiftboundReviewRow
            key={s.setName}
            set={s}
            groupOrder={registry?.riftbound.groupOrder ?? []}
            onPatch={(p) => patch('riftbound', s.setName, p)}
          />
        ))}
      </div>
    </div>
  )
}

function LorcanaReviewRow({
  set, groupOrder, onPatch,
}: { set: LorcanaRegistrySet; groupOrder: string[]; onPatch: (p: Record<string, unknown>) => void }) {
  const [group, setGroup] = useState(set.cardexGroup ?? groupOrder[0] ?? '')
  const [included, setIncluded] = useState(set.packAnalysis.included)
  const [packPrice, setPackPrice] = useState(set.packAnalysis.packPrice ?? 5.99)
  const [hasEpic, setHasEpic] = useState(!!set.packAnalysis.hasEpic)

  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-3">
      <div className="flex items-center gap-2 mb-2">
        <ChevronRight size={14} className="text-violet-400" />
        <span className="text-sm font-medium text-white">{set.setName}</span>
        <span className="text-[10px] uppercase tracking-wide text-slate-500">Lorcana</span>
      </div>
      <div className="flex flex-wrap gap-3 items-center text-xs text-slate-400 mb-3">
        <label className="flex items-center gap-1.5">
          Group
          <select
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded px-1.5 py-1 text-slate-300"
          >
            {groupOrder.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={included} onChange={(e) => setIncluded(e.target.checked)} />
          Include in Pack Analysis
        </label>
        {included && (
          <>
            <label className="flex items-center gap-1.5">
              Pack price $
              <input
                type="number" step="0.01" value={packPrice}
                onChange={(e) => setPackPrice(parseFloat(e.target.value) || 0)}
                className="w-16 bg-slate-950 border border-slate-800 rounded px-1.5 py-1 text-slate-300"
              />
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={hasEpic} onChange={(e) => setHasEpic(e.target.checked)} />
              Has Epic rarity
            </label>
          </>
        )}
      </div>
      <button
        onClick={() => onPatch({
          cardexGroup: group,
          packAnalysis: included ? { included: true, id: set.code ?? set.setName, released: set.releaseDate ?? '', packPrice, hasEpic } : { included: false },
          needsReview: false,
        })}
        className="text-xs font-medium px-3 py-1.5 rounded-lg bg-violet-600/20 text-violet-300 hover:bg-violet-600/30"
      >
        Mark reviewed
      </button>
    </div>
  )
}

function RiftboundReviewRow({
  set, groupOrder, onPatch,
}: { set: RiftboundRegistrySet; groupOrder: string[]; onPatch: (p: Record<string, unknown>) => void }) {
  const [group, setGroup] = useState(set.cardexGroup ?? groupOrder[0] ?? '')
  const [groupId, setGroupId] = useState(set.tcgcsvGroupId ?? '')

  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-3">
      <div className="flex items-center gap-2 mb-2">
        <ChevronRight size={14} className="text-cyan-400" />
        <span className="text-sm font-medium text-white">{set.setName}</span>
        <span className="text-[10px] uppercase tracking-wide text-slate-500">Riftbound</span>
        <span className="text-[10px] text-slate-600">{set.cardCount} cards</span>
      </div>
      <div className="flex flex-wrap gap-3 items-center text-xs text-slate-400 mb-3">
        <label className="flex items-center gap-1.5">
          Group
          <select
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded px-1.5 py-1 text-slate-300"
          >
            {groupOrder.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          TCGPlayer group ID
          <input
            type="number" value={groupId}
            onChange={(e) => setGroupId(e.target.value ? parseInt(e.target.value, 10) : '')}
            placeholder="e.g. 24344"
            className="w-24 bg-slate-950 border border-slate-800 rounded px-1.5 py-1 text-slate-300"
          />
        </label>
        {set.groupMatchConfidence != null && (
          <span className="text-slate-600">(auto-matched at {Math.round(set.groupMatchConfidence * 100)}%)</span>
        )}
      </div>
      <button
        onClick={() => onPatch({
          cardexGroup: group,
          tcgcsvGroupId: groupId === '' ? null : groupId,
          needsReview: false,
        })}
        className="text-xs font-medium px-3 py-1.5 rounded-lg bg-cyan-600/20 text-cyan-300 hover:bg-cyan-600/30"
      >
        Mark reviewed
      </button>
    </div>
  )
}
