import { NextRequest, NextResponse } from 'next/server'
import { loadCatalog } from '@/lib/api/catalog'
import { GAME_LABELS, catalogKeyFor, type CatalogKey, type Game, type Language } from '@/lib/types'

export const dynamic = 'force-dynamic'

const MAX_CARDS = 5000

// Which of the collector's copies are priced from PriceCharting's ungraded price — a stagnant card
// nothing else prices (scripts/lib/stagnant.mjs, catalog priceSource 'pricecharting' + pcUrl).
// The licence asks for the PriceCharting citation link wherever that price is shown, and the
// per-game price routes only answer with a number, so Inventory / Portfolio rows ask here for the
// link (components/GradedPriceTag.tsx useUngradedUrl). { cards: [{ id, apiId, game, language }] }
// → { [inventory card id]: PriceCharting page }. A handful of cards at most have one.

interface CardInput {
  id: string
  apiId?: string
  game: Game
  language?: Language
}

interface CatalogCard {
  id: string
  priceSource?: string
  pcUrl?: string
}

export async function POST(req: NextRequest) {
  const body: { cards?: CardInput[] } = await req.json().catch(() => ({}))
  // Public catalog data only (pcUrl is on the public catalog), read from the server's catalog cache —
  // still capped so a single request can't ask about an unbounded list
  if (!Array.isArray(body.cards) || body.cards.length > MAX_CARDS) return NextResponse.json({ error: 'Expected { cards: [...] } (at most 5,000)' }, { status: 400 })
  const cards = body.cards.filter((c) => c?.id && c.apiId && Object.prototype.hasOwnProperty.call(GAME_LABELS, c.game))
  const byKey = new Map<CatalogKey, CardInput[]>()
  for (const c of cards) {
    const key = catalogKeyFor(c.game, c.language)
    byKey.set(key, [...(byKey.get(key) ?? []), c])
  }
  const out: Record<string, string> = {}
  await Promise.all(Array.from(byKey, async ([key, list]) => {
    const urls = new Map<string, string>()
    for (const c of await loadCatalog<CatalogCard>(key)) {
      if (c.priceSource === 'pricecharting' && c.pcUrl) urls.set(c.id, c.pcUrl)
    }
    for (const c of list) {
      const url = urls.get(c.apiId!)
      if (url) out[c.id] = url
    }
  }))
  return NextResponse.json(out)
}
