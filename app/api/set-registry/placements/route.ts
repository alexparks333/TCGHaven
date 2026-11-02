import { NextResponse } from 'next/server'
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase/config'
import { loadSetRegistry, saveSetRegistry } from '@/lib/api/registry'
import { regenerateSnapshot } from '@/lib/api/catalog'
import { ensureAdminAuth } from '@/lib/firebase/adminAuth'
import { verifyAdminRequest } from '@/lib/firebase/verifyAdminRequest'

export const dynamic = 'force-dynamic'

// Staff review of the TCGplayer products a Riftbound sync placed on its own (Needs Review page) —
// see discoverRiftboundProducts() in scripts/lib/catalog-sync.mjs.
//
// POST { changes: [{ productId, setName?: string | null, reviewed?: boolean }] }
//   setName moves the card to that set (null = leave it out of the catalog); reviewed marks the
//   placement as checked. A move applies to the catalog card (`tcg-{productId}`) right away, so it
//   doesn't wait for the next sync, which then keeps it there.
export async function POST(request: Request) {
  const unauthorized = await verifyAdminRequest(request)
  if (unauthorized) return unauthorized

  const body = await request.json().catch(() => null)
  const changes = Array.isArray(body?.changes) ? body.changes : null
  if (!changes || changes.some((c: { productId?: unknown }) => typeof c?.productId !== 'number')) {
    return NextResponse.json({ error: 'Expected { changes: [{ productId: number, setName?: string | null, reviewed?: boolean }] }' }, { status: 400 })
  }

  const registry = await loadSetRegistry()
  const placements = registry.riftbound.placements ?? []
  const setByName = new Map(registry.riftbound.sets.map((s) => [s.setName, s]))
  const moved: Array<{ productId: number; setName: string | null }> = []

  for (const change of changes as Array<{ productId: number; setName?: string | null; reviewed?: boolean }>) {
    const p = placements.find((x) => x.productId === change.productId)
    if (!p) return NextResponse.json({ error: `No placement for TCGplayer product ${change.productId}` }, { status: 404 })
    if (change.setName !== undefined && change.setName !== p.setName) {
      if (change.setName !== null && !setByName.has(change.setName)) {
        return NextResponse.json({ error: `No Riftbound set named "${change.setName}"` }, { status: 404 })
      }
      p.setName = change.setName
      p.auto = false
      moved.push({ productId: p.productId, setName: p.setName })
    }
    if (change.reviewed !== undefined) p.reviewed = change.reviewed
  }
  registry.riftbound.placements = placements

  await ensureAdminAuth()
  await saveSetRegistry(registry)

  // Move the existing catalog cards now. One the sync hasn't built yet is created by the next sync.
  let changedCards = 0
  for (const m of moved) {
    const ref = doc(db, 'catalog', 'riftbound', 'cards', `tcg-${m.productId}`)
    if (!(await getDoc(ref)).exists()) continue
    const set = m.setName ? setByName.get(m.setName) : null
    await updateDoc(ref, set
      ? {
          setName: set.setName, setCode: set.setCode, hidden: false,
          rarity: set.tcgplayerOnly ? set.tcgplayerRarity || 'Event Promo' : 'Promo',
          updatedAt: serverTimestamp(),
        }
      : { hidden: true, updatedAt: serverTimestamp() })
    changedCards++
  }
  if (changedCards > 0) await regenerateSnapshot('riftbound', db)

  return NextResponse.json({ ok: true, placements, changedCards })
}
