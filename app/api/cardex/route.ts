import { NextResponse } from 'next/server'
import { sortCatalogCards, loadVisibleCatalog } from '@/lib/api/catalog'
import type { Game } from '@/lib/types'

export const dynamic = 'force-dynamic'

interface CatalogCard {
  id: string
  name: string
  number: string
  set?: string        // Lorcana numeric set code
  setCode?: string    // Riftbound set code
  setName: string
  rarity: string
  imageUrl: string
  marketPrice?: number
  hidden?: boolean
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const game = searchParams.get('game')
  const setName = searchParams.get('set')

  if (!game || !setName) return NextResponse.json([])
  if (game !== 'lorcana' && game !== 'riftbound') return NextResponse.json([])

  // loadVisibleCatalog already excludes hidden cards (via the in-memory cache described in
  // lib/api/catalog.ts) — a hide/unhide shows up here as soon as this instance's cache next
  // syncs, no rebuild needed.
  const visible = await loadVisibleCatalog<CatalogCard>(game as Game)

  const cards = sortCatalogCards(visible.filter((c) => c.setName === setName))
    .map((c) => ({
      id:         c.id,
      name:       c.name,
      number:     c.number,
      setCode:    c.setCode ?? c.set ?? '',
      setName:    c.setName,
      rarity:     c.rarity,
      imageUrl:   c.imageUrl,
      marketPrice: c.marketPrice ?? 0,
    }))

  return NextResponse.json(cards)
}
