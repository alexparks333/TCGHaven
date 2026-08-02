import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const BASE = 'https://api.pokemontcg.io/v2'
const HEADERS: Record<string, string> = process.env.POKEMON_TCG_API_KEY
  ? { 'X-Api-Key': process.env.POKEMON_TCG_API_KEY }
  : {}

interface CardInput {
  id: string      // Firestore card ID
  apiId: string   // Pokemon TCG card ID (e.g. "sv7-1")
  isFoil: boolean
}

// Batch price lookup using the Pokemon TCG API's OR query.
// One API call for up to 250 cards — instead of one call per card.
const CHUNK_SIZE = 250

export async function POST(req: NextRequest) {
  const { cards, priceMode = 'market' }: { cards: CardInput[]; priceMode?: string } = await req.json()
  if (!cards.length) return NextResponse.json({})

  // Filter to cards that have an apiId
  const valid = cards.filter((c) => c.apiId)
  const results: Record<string, number> = {}

  // Process in chunks in case the collection is very large
  for (let i = 0; i < valid.length; i += CHUNK_SIZE) {
    const chunk = valid.slice(i, i + CHUNK_SIZE)

    // Build batch query: id:sv7-1 OR id:sv8-2 OR ...
    const q = chunk.map((c) => `id:${c.apiId}`).join(' OR ')

    try {
      const res = await fetch(
        `${BASE}/cards?q=${encodeURIComponent(q)}&pageSize=${CHUNK_SIZE}`,
        { headers: HEADERS, signal: AbortSignal.timeout(15000) }
      )
      if (!res.ok) continue

      const data = await res.json()

      // Map apiId → TCGPlayer prices from the batch response
      const priceByApiId = new Map<string, Record<string, { market?: number; low?: number }>>()
      for (const card of data.data ?? []) {
        if (card.tcgplayer?.prices) priceByApiId.set(card.id, card.tcgplayer.prices)
      }

      const pick = priceMode === 'lowestNM' ? 'low' : 'market'
      for (const { id, apiId, isFoil } of chunk) {
        const prices = priceByApiId.get(apiId)
        if (!prices) continue
        const price = isFoil
          ? (prices.holofoil?.[pick] ?? prices.reverseHolofoil?.[pick] ?? prices['1stEditionHolofoil']?.[pick] ?? prices.normal?.[pick])
          : (prices.normal?.[pick] ?? prices.holofoil?.[pick])
        if (price) results[id] = price
      }
    } catch {
      // Network error or timeout on this chunk — skip silently
    }
  }

  return NextResponse.json(results)
}
