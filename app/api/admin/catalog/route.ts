import { NextResponse } from 'next/server'
import { loadCatalog, sortCatalogCards } from '@/lib/api/catalog'
import type { Game } from '@/lib/types'

export const dynamic = 'force-dynamic'

const GAMES: Game[] = ['pokemon', 'lorcana', 'riftbound']

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
  hidden?: boolean
  source?: 'scraped' | 'manual'
}

// Read-only listing — no environment gating, browsing the catalog is harmless in prod.
// Deliberately includes hidden cards (unlike loadVisibleCatalog) so the Admin page can show
// and un-hide them.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const game = searchParams.get('game') as Game | null
  const setName = searchParams.get('set')

  if (!game || !GAMES.includes(game)) {
    return NextResponse.json({ error: 'game must be pokemon, lorcana, or riftbound' }, { status: 400 })
  }

  const catalog = await loadCatalog<CatalogCard>(game)
  const filtered = setName ? catalog.filter((c) => c.setName === setName) : catalog
  const sorted = sortCatalogCards(filtered)

  const cards = sorted.map((c) => ({ ...c, isCustom: c.source === 'manual', isHidden: !!c.hidden }))

  return NextResponse.json(cards)
}
