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
  // no-store: this route already owns its own freshness (getSetsForGame's in-memory cache,
  // invalidated correctly on writes) — the browser's own HTTP cache has no business adding a
  // second, un-invalidatable layer on top of that. Without this, an open tab can keep serving a
  // stale set list from its own cache indefinitely, even after the server-side data is fixed —
  // this happened for real while diagnosing why a newly-released set wasn't showing up.
  return NextResponse.json(sets, { headers: { 'Cache-Control': 'no-store' } })
}
