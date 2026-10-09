'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, CheckCircle2, AlertCircle, Search, Wrench, LogOut } from 'lucide-react'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { useAuth } from '@/components/auth/AuthProvider'
import { useStore } from '@/lib/store'
import { editCard } from '@/lib/firebase/db'
import { cn, riftboundDisplayNumber, riftboundInherentFoil } from '@/lib/utils'

export default function SettingsPage() {
  return (
    <AuthGuard>
      <div className="max-w-2xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-ink">Settings</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            Your account, and fixes for your own inventory.
          </p>
        </div>

        <AccountActions />
        <InventoryNumberRepairCard />
      </div>
    </AuthGuard>
  )
}

// ── Account actions (phones only) ─────
// On a phone the sidebar is hidden and the bottom bar only has room for the six main pages, so
// Admin and Sign out live here instead (Filters is in the phone top bar). Desktop keeps them in
// the sidebar.
function AccountActions() {
  const { user, signOut } = useAuth()
  const router = useRouter()
  if (!user) return null
  const initials = user.displayName
    ? user.displayName.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : user.email?.[0]?.toUpperCase() ?? '?'
  const row = 'w-full flex items-center gap-3 px-4 py-3.5 text-[15px] font-medium text-slate-200 border-t border-slate-800 first:border-t-0'

  return (
    <div className="md:hidden card-glass overflow-hidden mb-6">
      <div className="flex items-center gap-3 px-4 py-3.5 bg-slate-950/40">
        <div className="w-9 h-9 rounded-full bg-violet-700 flex items-center justify-center text-xs font-bold text-white shrink-0">
          {initials}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-ink truncate">{user.displayName || 'Account'}</div>
          <div className="text-xs text-slate-500 truncate">{user.email}</div>
        </div>
      </div>
      <button
        onClick={async () => { await signOut(); router.replace('/login') }}
        className={cn(row, 'text-red-600')}
      >
        <LogOut size={18} />
        Sign out
      </button>
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
  oldRarity?: string
  newRarity?: string
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

        // Alt Art/Overnumbered used to be flattened into a single "Showcase" catalog rarity
        // value (some sets even kept the base rarity — Rare, Epic, etc. — on top of that); an
        // inventory card added back then still has whatever stale value it was given at add
        // time. The catalog is always the source of truth, so any drift gets synced here.
        if (catalogCard.rarity && catalogCard.rarity !== card.rarity) {
          m.oldRarity = card.rarity
          m.newRarity = catalogCard.rarity
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
        const patch: { number?: string; isFoil?: boolean; rarity?: string } = {}
        if (m.newNumber !== undefined) patch.number = m.newNumber
        if (m.newFoil !== undefined) patch.isFoil = m.newFoil
        if (m.newRarity !== undefined) patch.rarity = m.newRarity
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
      <h2 className="text-ink font-semibold mb-1">Fix Riftbound Numbers, Foil Status &amp; Rarity</h2>
      <p className="text-slate-400 text-sm mb-4">
        Alt-art Riftbound cards (e.g. an alt-art printed as &quot;92a&quot;) were sometimes saved with
        just the bare number (&quot;92&quot;), missing the letter suffix printed on the card. Overnumbered
        and Signature cards could also be saved with the wrong Foil status. Alt Art/Overnumbered
        cards added before the catalog split them out of a single &quot;Showcase&quot; rarity value may
        also still say &quot;Showcase&quot; here — this re-syncs rarity from the catalog too. This only
        ever touches the card&apos;s number, foil, and rarity fields — nothing else about the card
        (price, quantity, condition) is changed. Only cards originally added via the search
        dropdown (which carries a catalog link) can be checked.
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
        <div className="flex items-start gap-2 text-red-600 text-xs bg-red-100/30 border border-red-200/50 rounded-lg px-3 py-2 mb-3">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {mismatches && mismatches.length === 0 && fixedCount === null && (
        <div className="flex items-center gap-2 text-sm text-emerald-600">
          <CheckCircle2 size={14} /> No mismatches found — your Riftbound numbers, foil status, and rarities already look correct.
        </div>
      )}

      {fixedCount !== null && (
        <div className="flex items-center gap-2 text-sm text-emerald-600">
          <CheckCircle2 size={14} /> Fixed {fixedCount} card{fixedCount !== 1 ? 's' : ''}.
        </div>
      )}

      {mismatches && mismatches.length > 0 && (
        <div className="space-y-1 text-xs max-h-60 overflow-y-auto border-t border-slate-800 pt-2">
          {mismatches.map((m) => (
            <div key={m.cardId} className="flex justify-between items-center border-b border-slate-900 py-1 gap-3">
              <span className="text-ink truncate">{m.name}</span>
              <span className="text-slate-400 flex items-center gap-3 shrink-0">
                {m.newNumber !== undefined && (
                  <span>{m.oldNumber} → <span className="text-violet-700 font-medium">{m.newNumber}</span></span>
                )}
                {m.newFoil !== undefined && (
                  <span>
                    {m.oldFoil ? '✨ Foil' : 'Normal'} →{' '}
                    <span className="text-violet-700 font-medium">{m.newFoil ? '✨ Foil' : 'Normal'}</span>
                  </span>
                )}
                {m.newRarity !== undefined && (
                  <span>{m.oldRarity || '(none)'} → <span className="text-violet-700 font-medium">{m.newRarity}</span></span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
