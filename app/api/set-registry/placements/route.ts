import { NextResponse } from 'next/server'
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase/config'
import { loadSetRegistry, saveSetRegistry, type RiftboundPlacement } from '@/lib/api/registry'
import { regenerateSnapshot } from '@/lib/api/catalog'
import { ensureAdminAuth } from '@/lib/firebase/adminAuth'
import { verifyAdminRequest } from '@/lib/firebase/verifyAdminRequest'

export const dynamic = 'force-dynamic'

// Staff review of the TCGplayer products a Riftbound sync placed on its own (Needs Review page) —
// see discoverRiftboundProducts() in scripts/lib/catalog-sync.mjs.
//
// POST { changes: [{ productId, setName?, reviewed?, denied?, displayName? }] }
//   setName      — move the card to that set
//   denied       — true: hide it and never add it back on a sync; false: recover it (into setName
//                  if given, else where it was before it was denied), back in the review queue
//   displayName  — the name the website shows ('' = back to the name built from TCGplayer's)
//   reviewed     — mark checked
// Every change applies to the catalog card (`tcg-{productId}`) right away, so it doesn't wait for
// the next sync, which then keeps it.

// Same naming as placementDefaultName() in catalog-sync.mjs (duplicated across the runtime
// boundary on purpose, like the other shared helpers there).
function defaultName(tcgplayerName: string): string {
  const base = tcgplayerName.replace(/\s*\([^)]*\)/g, '').trim()
  const parens = Array.from(tcgplayerName.matchAll(/\(([^)]*)\)/g)).map((m) => m[1].trim()).filter(Boolean)
  return `${base} (${parens.join(', ') || 'Promo'})`
}

interface Change {
  productId: number
  setName?: string | null
  reviewed?: boolean
  denied?: boolean
  displayName?: string
}

export async function POST(request: Request) {
  const unauthorized = await verifyAdminRequest(request)
  if (unauthorized) return unauthorized

  const body = await request.json().catch(() => null)
  const changes = Array.isArray(body?.changes) ? (body.changes as Change[]) : null
  if (!changes || changes.some((c) => typeof c?.productId !== 'number')) {
    return NextResponse.json({ error: 'Expected { changes: [{ productId: number, setName?, reviewed?, denied?, displayName? }] }' }, { status: 400 })
  }

  const registry = await loadSetRegistry()
  const placements = registry.riftbound.placements ?? []
  const setByName = new Map(registry.riftbound.sets.map((s) => [s.setName, s]))
  const touched = new Map<number, { placement: RiftboundPlacement; moved: boolean; renamed: boolean }>()
  const mark = (p: RiftboundPlacement, what: 'moved' | 'renamed') => {
    const t = touched.get(p.productId) ?? { placement: p, moved: false, renamed: false }
    t[what] = true
    touched.set(p.productId, t)
  }

  for (const change of changes) {
    const p = placements.find((x) => x.productId === change.productId)
    if (!p) return NextResponse.json({ error: `No placement for TCGplayer product ${change.productId}` }, { status: 404 })
    if (typeof change.setName === 'string' && !setByName.has(change.setName)) {
      return NextResponse.json({ error: `No Riftbound set named "${change.setName}"` }, { status: 404 })
    }

    if (change.denied === true && !p.denied) {
      p.previousSetName = p.setName
      p.setName = null
      p.denied = true
      p.reviewed = true
      p.auto = false
      mark(p, 'moved')
    } else if (change.denied === false && (p.denied || p.setName === null)) {
      // (setName null without `denied` = left out before Deny existed, or the sync couldn't place it)
      p.denied = false
      p.setName = change.setName !== undefined ? change.setName : p.previousSetName ?? null
      delete p.previousSetName
      p.reviewed = false
      p.auto = false
      mark(p, 'moved')
    } else if (change.setName !== undefined && change.setName !== p.setName) {
      p.setName = change.setName
      p.denied = false
      p.auto = false
      mark(p, 'moved')
    }

    if (change.displayName !== undefined) {
      const name = change.displayName.trim()
      if (name && name !== defaultName(p.name)) p.displayName = name
      else delete p.displayName
      mark(p, 'renamed')
    }
    if (change.reviewed !== undefined) p.reviewed = change.reviewed
  }
  registry.riftbound.placements = placements

  await ensureAdminAuth()
  await saveSetRegistry(registry)

  // Apply to the catalog cards now. One the sync hasn't built yet is created by the next sync.
  let changedCards = 0
  for (const { placement: p, moved, renamed } of Array.from(touched.values())) {
    const ref = doc(db, 'catalog', 'riftbound', 'cards', `tcg-${p.productId}`)
    if (!(await getDoc(ref)).exists()) continue
    const set = p.setName ? setByName.get(p.setName) : null
    const patch: Record<string, unknown> = { updatedAt: serverTimestamp() }
    if (moved) {
      if (set) Object.assign(patch, { setName: set.setName, setCode: set.setCode, hidden: false, rarity: set.tcgplayerOnly ? set.tcgplayerRarity || 'Event Promo' : 'Promo' })
      else patch.hidden = true
    }
    if (renamed) patch.name = p.displayName ?? defaultName(p.name)
    await updateDoc(ref, patch)
    changedCards++
  }
  if (changedCards > 0) await regenerateSnapshot('riftbound', db)

  return NextResponse.json({ ok: true, placements, changedCards })
}
