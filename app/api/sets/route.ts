import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getSetsForGame } from '@/lib/api/search'
import type { Game } from '@/lib/types'

export const dynamic = 'force-dynamic'

// Set list for the AddCardDialog autocomplete. Server-side because the
// Pokemon set list comes from api.pokemontcg.io (browser CORS-blocked)
// and the module-level cache belongs on the server.
export async function GET(req: NextRequest) {
  const game = (req.nextUrl.searchParams.get('game') ?? 'pokemon') as Game
  const sets = await getSetsForGame(game)
  return NextResponse.json(sets)
}
