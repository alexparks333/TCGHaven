import { NextResponse } from 'next/server'
import { sortCatalogCards, loadVisibleCatalog } from '@/lib/api/catalog'
import { riftboundDisplayNumber } from '@/lib/utils'
import { catalogKeyFor, isTcgplayerSourced, type Game } from '@/lib/types'

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
  marketPriceFoil?: number
  lowPriceNM?: number
  lowPriceNMFoil?: number
  hidden?: boolean
  publicCode?: string  // Riftbound only — carries the "a"/"*" variant suffix `number` lacks
  cardType?: string    // Riftbound only — the Cardex zoom shows 'Battlefield' cards landscape
  priceSource?: string // Pokémon backup price — see scripts/lib/price-fallback.mjs
  variant?: string     // Yu-Gi-Oh! only — TCGplayer's version ("Starlight Rare"), shown after the name
  variantPrices?: Record<string, number> // Pokémon / Yu-Gi-Oh! printings
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const game = searchParams.get('game')
  const setName = searchParams.get('set')

  // q= instead of set= → the whole game: every set's cards whose name (or number) matches —
  // the Cardex search box's "All {game}" scope
  const q = (searchParams.get('q') ?? '').trim()
  // ids= instead: exactly these cards (comma-separated catalog ids, up to 400) — a badge's
  // required cards whose picture wasn't saved with it (components/badges/BadgeCards.tsx)
  const ids = new Set((searchParams.get('ids') ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 400))
  if (!game || (!setName && q.length < 2 && ids.size === 0)) return NextResponse.json([])
  if (game !== 'lorcana' && game !== 'riftbound' && game !== 'pokemon' && game !== 'onepiece' && game !== 'mtg' && game !== 'yugioh' && !isTcgplayerSourced(game)) return NextResponse.json([])

  // loadVisibleCatalog already excludes hidden cards (via the in-memory cache described in
  // lib/api/catalog.ts) — a hide/unhide shows up here as soon as this instance's cache next
  // syncs, no rebuild needed.
  // lang=ja → the Japanese Pokémon catalog (its own Cardex)
  const visible = await loadVisibleCatalog<CatalogCard>(catalogKeyFor(game as Game, searchParams.get('lang') ?? undefined))

  // sortCatalogCards runs first, on the untouched bare `number` — sort order must stay numeric
  // (Alt Art/Overnumbered/Signature variants share their base card's bare number; see
  // CLAUDE.md §9), so the "a"/"*" suffix is only added afterward, for display. Pokemon numbers
  // never carry that suffix, so riftboundDisplayNumber is a no-op for them (no publicCode field).
  const picked = ids.size
    ? visible.filter((c) => ids.has(c.id))
    : setName
    ? sortCatalogCards(visible.filter((c) => c.setName === setName))
    : searchWholeGame(visible, q)
  const cards = picked
    .map((c) => ({
      id:         c.id,
      // Yu-Gi-Oh!: the version too, as search and Add Card show it (lib/api/yugioh.ts yugiohDisplayName)
      name:       c.variant ? `${c.name} (${c.variant})` : c.name,
      number:     riftboundDisplayNumber(c.number, c.publicCode),
      setCode:    c.setCode ?? c.set ?? '',
      setName:    c.setName,
      rarity:     c.rarity ?? '',
      imageUrl:   c.imageUrl,
      // All the raw price fields, not one pre-picked price: the Cardex computes the shown price
      // client-side with lib/pricing.ts's nearMintPrice() — the exact rule the price routes use
      // for Inventory/Portfolio — since only the client knows the viewer's price mode and
      // whether their copy is foil.
      marketPrice:     c.marketPrice ?? 0,
      marketPriceFoil: c.marketPriceFoil ?? 0,
      lowPriceNM:      c.lowPriceNM ?? 0,
      lowPriceNMFoil:  c.lowPriceNMFoil ?? 0,
      publicCode:      c.publicCode,
      cardType:        c.cardType,
      // '' / absent = TCGplayer's own feed; 'cardmarket' = an EUR→USD estimate (shown as Est.)
      priceSource:     c.priceSource || undefined,
    }))

  // Public catalog data: cached by Vercel's CDN, refreshed in the background (prices change at most
  // every few hours with the sync)
  return NextResponse.json(cards, { headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=86400' } })
}

// Most results a whole-game search returns — a one-letter-ish name ("a") would otherwise send a
// whole game's catalog (MTG's is 100k+ cards)
const GAME_SEARCH_LIMIT = 1000

// Accents and case don't matter ("pokemon" finds "Pokémon")
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

// Same idea as the Cardex's in-set filter (CardexPage.tsx matchesSearch): the name contains the
// query, or the collector number is it. Across a whole game a number has to match exactly
// ("42" → every set's #42, not #142 and #420 too); leading zeros and a "#" are ignored.
function searchWholeGame(cards: CatalogCard[], query: string): CatalogCard[] {
  const q = fold(query)
  const num = q.replace(/^#/, '').replace(/^0+(?=.)/, '')
  const matches = cards.filter((c) => {
    if (fold(c.variant ? `${c.name} ${c.variant}` : c.name).includes(q)) return true
    const n = (c.publicCode ?? c.number ?? '').toLowerCase().replace(/^0+(?=.)/, '')
    const bare = (c.number ?? '').toLowerCase().replace(/^0+(?=.)/, '')
    return !!num && (n === num || bare === num || (c.number ?? '').toLowerCase() === q)
  })
  // Grouped by set, in collector-number order within each (the client orders the sets)
  const bySet = new Map<string, CatalogCard[]>()
  for (const c of matches) {
    const list = bySet.get(c.setName)
    if (list) list.push(c)
    else bySet.set(c.setName, [c])
  }
  return Array.from(bySet.values()).flatMap((list) => sortCatalogCards(list)).slice(0, GAME_SEARCH_LIMIT)
}
