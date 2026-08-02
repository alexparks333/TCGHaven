import { NextResponse } from 'next/server'
import { loadCatalog, sortCatalogCards } from '@/lib/api/catalog'
import { loadCustomCatalog, type CatalogGame } from '@/lib/api/custom-catalog'

export const dynamic = 'force-dynamic'

const FILES: Record<CatalogGame, string> = {
  pokemon: 'pokemon-cards.json',
  lorcana: 'lorcana-cards.json',
  riftbound: 'riftbound-cards.json',
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
}

// Read-only listing — no environment gating, browsing the catalog is harmless in prod.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const game = searchParams.get('game') as CatalogGame | null
  const setName = searchParams.get('set')

  if (!game || !FILES[game]) {
    return NextResponse.json({ error: 'game must be pokemon, lorcana, or riftbound' }, { status: 400 })
  }

  const catalog = loadCatalog<CatalogCard>(FILES[game])
  const filtered = setName ? catalog.filter((c) => c.setName === setName) : catalog
  const sorted = sortCatalogCards(filtered)

  const customIds = new Set(loadCustomCatalog()[game].additions.map((c) => c.id))
  const cards = sorted.map((c) => ({ ...c, isCustom: customIds.has(c.id) }))

  return NextResponse.json(cards)
}
