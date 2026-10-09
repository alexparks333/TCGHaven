'use client'

import { useEffect, useState } from 'react'
import { Loader2, ChevronRight } from 'lucide-react'
import { adminFetch } from '@/lib/firebase/authFetch'

// Needs Review (staff portal) — sets a sync auto-detected, waiting for staff to confirm their
// details (Cardex group, TCGplayer group, release date) before they're fully live. Writes go
// through PUT /api/set-registry, which checks the caller is staff (verifyAdminRequest).

// ── Types (mirror lib/api/registry.ts shapes) ─────────

interface LorcanaRegistrySet {
  setName: string
  code: string | null
  releaseDate: string | null
  cardexGroup: string | null
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

// ── Needs Review ────────────────────────────────────────────────────────────

export function NeedsReviewCard() {
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
    await adminFetch('/api/set-registry', {
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
      <h2 className="text-ink font-semibold mb-1">Needs Review</h2>
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

  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-3">
      <div className="flex items-center gap-2 mb-2">
        <ChevronRight size={14} className="text-violet-600" />
        <span className="text-sm font-medium text-ink">{set.setName}</span>
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
      </div>
      <button
        onClick={() => onPatch({
          cardexGroup: group,
          needsReview: false,
        })}
        className="text-xs font-medium px-3 py-1.5 rounded-lg bg-violet-600/20 text-violet-700 hover:bg-violet-600/30"
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
        <ChevronRight size={14} className="text-cyan-600" />
        <span className="text-sm font-medium text-ink">{set.setName}</span>
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
        className="text-xs font-medium px-3 py-1.5 rounded-lg bg-cyan-600/20 text-cyan-700 hover:bg-cyan-600/30"
      >
        Mark reviewed
      </button>
    </div>
  )
}
