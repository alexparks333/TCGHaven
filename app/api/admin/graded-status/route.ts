import { NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/firebase/verifyAdminRequest'
import { loadGradedPricesForStaff } from '@/lib/api/gradedPrices'
import type { CatalogKey } from '@/lib/types'

// Staff only. GET ?catalog=lorcana&ids=a,b,c → { status: { [id]: { by: 'id' | 'match' | 'staff', pc,
// url, psa10, versions } | null } }: whether each card has graded prices from PriceCharting — the Needs Review
// tags (components/admin/PlacementsReview.tsx). null = no PriceCharting match yet. docs/PriceCharting.md.

const CATALOGS: CatalogKey[] = ['pokemon', 'pokemon-jp', 'lorcana', 'riftbound', 'onepiece', 'mtg', 'yugioh',
  'swu', 'gundam', 'fab', 'digimon', 'palworld', 'cyberpunk']

export async function GET(request: Request) {
  const denied = await verifyAdminRequest(request)
  if (denied) return denied
  const params = new URL(request.url).searchParams
  const catalog = params.get('catalog') as CatalogKey | null
  if (!catalog || !CATALOGS.includes(catalog)) return NextResponse.json({ error: 'Unknown catalog' }, { status: 400 })
  const ids = (params.get('ids') ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 500)
  const graded = await loadGradedPricesForStaff(catalog)
  const status: Record<string, { by: 'id' | 'match' | 'staff'; pc: string; url: string; psa10: number | null; versions: string[] } | null> = {}
  for (const id of ids) {
    const e = graded.get(id)
    status[id] = e ? { by: e.via ?? 'id', pc: e.pc, url: e.u, psa10: e.p.psa10 ?? null, versions: Object.keys(e.v ?? {}) } : null
  }
  return NextResponse.json({ status })
}
