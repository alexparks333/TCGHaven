import { NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/firebase/verifyAdminRequest'
import { loadCatalog } from '@/lib/api/catalog'
import { stagnantReason, STAGNANT_SKIP_GAMES } from '@/scripts/lib/stagnant.mjs'
import type { CatalogKey } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Staff only. GET ?game=riftbound,lorcana (default: every catalog) → { cards: StagnantCard[], counts }:
// the cards whose price nothing updates on its own — no sync price, no TCGplayer product, no
// PriceCharting ungraded price (scripts/lib/stagnant.mjs). The staff portal's Stagnant prices page and the
// Admin Catalog's "Stagnant" tag. Never shown to collectors. docs/catalog.md "Stagnant prices".

const CATALOGS: CatalogKey[] = (['pokemon', 'pokemon-jp', 'lorcana', 'riftbound', 'onepiece', 'mtg', 'yugioh',
  'swu', 'gundam', 'fab', 'digimon', 'palworld', 'cyberpunk'] as CatalogKey[]).filter((g) => !STAGNANT_SKIP_GAMES.has(g))  // not Magic

type Card = Record<string, unknown> & { id: string; name?: string; setName?: string; set?: string; number?: string; rarity?: string; imageUrl?: string; marketPrice?: number; marketPriceFoil?: number; manualPriceAt?: string; manualPriceNote?: string }

export async function GET(request: Request) {
  const denied = await verifyAdminRequest(request)
  if (denied) return denied
  const asked = new URL(request.url).searchParams.get('game')
  const games = asked ? asked.split(',').filter((g): g is CatalogKey => CATALOGS.includes(g as CatalogKey)) : CATALOGS
  if (!games.length) return NextResponse.json({ error: 'Unknown game' }, { status: 400 })

  const cards: Array<Record<string, unknown>> = []
  const counts: Record<string, number> = {}
  await Promise.all(games.map(async (game) => {
    for (const c of await loadCatalog<Card>(game)) {
      const reason = stagnantReason(c)
      if (!reason) continue
      counts[game] = (counts[game] ?? 0) + 1
      cards.push({
        game, id: c.id, name: c.name ?? '', setName: c.setName ?? c.set ?? '', number: c.number ?? '', rarity: c.rarity ?? '',
        imageUrl: c.imageUrl ?? '', reason, marketPrice: c.marketPrice ?? 0, marketPriceFoil: c.marketPriceFoil ?? 0,
        manualPriceAt: c.manualPriceAt || null, manualPriceNote: c.manualPriceNote || null,
      })
    }
  }))
  return NextResponse.json({ cards, counts })
}
