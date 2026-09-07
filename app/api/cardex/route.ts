import { NextResponse } from 'next/server'
import { sortCatalogCards, loadVisibleCatalog } from '@/lib/api/catalog'
import { riftboundDisplayNumber } from '@/lib/utils'
import type { Game } from '@/lib/types'

export const dynamic = 'force-dynamic'

interface CatalogCard {
  id: string
  name: string
  number: string
  set?: string        // Lorcana numeric set code, Pokemon set id ("sv7"), or One Piece set code ("OP01")
  setCode?: string    // Riftbound set code
  setName: string
  rarity?: string      // Pokemon catalog cards don't carry one — see CLAUDE.md's Pokemon schema note
  imageUrl: string
  marketPrice?: number
  hidden?: boolean
  publicCode?: string  // Riftbound only — carries the "a"/"*" variant suffix `number` lacks
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const game = searchParams.get('game')
  const setName = searchParams.get('set')

  if (!game || !setName) return NextResponse.json([])
  if (game !== 'lorcana' && game !== 'riftbound' && game !== 'pokemon' && game !== 'onepiece' && game !== 'mtg') return NextResponse.json([])

  // loadVisibleCatalog already excludes hidden cards (via the in-memory cache described in
  // lib/api/catalog.ts) — a hide/unhide shows up here as soon as this instance's cache next
  // syncs, no rebuild needed.
  const visible = await loadVisibleCatalog<CatalogCard>(game as Game)

  // sortCatalogCards runs first, on the untouched bare `number` — sort order must stay numeric
  // (Alt Art/Overnumbered/Signature variants share their base card's bare number; see
  // CLAUDE.md §9), so the "a"/"*" suffix is only added afterward, for display. Pokemon numbers
  // never carry that suffix, so riftboundDisplayNumber is a no-op for them (no publicCode field).
  const cards = sortCatalogCards(visible.filter((c) => c.setName === setName))
    .map((c) => ({
      id:         c.id,
      name:       c.name,
      number:     riftboundDisplayNumber(c.number, c.publicCode),
      setCode:    c.setCode ?? c.set ?? '',
      setName:    c.setName,
      rarity:     c.rarity ?? '',
      imageUrl:   c.imageUrl,
      marketPrice: c.marketPrice ?? 0,
    }))

  return NextResponse.json(cards)
}
