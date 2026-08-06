import { NextResponse } from 'next/server'
import { invalidateCatalogCache } from '@/lib/api/catalog'
import type { Game } from '@/lib/types'

export const dynamic = 'force-dynamic'

const GAMES: Game[] = ['pokemon', 'lorcana', 'riftbound']

// Admin Catalog edits (hide/unhide, edit, add) run client-side and write straight to Firestore
// via the client SDK, so regenerateSnapshot()'s own invalidateCatalogCache() call only clears
// the browser's unused copy of the module cache — the server process's cache (what every real
// read route actually serves from) never hears about it. This route lets the browser tell the
// server to drop its cache for a game so the next read picks up the change immediately instead
// of waiting out the 2-minute staleness window.
export async function POST(request: Request) {
  const { game } = await request.json().catch(() => ({}) as { game?: string })

  if (!game || !GAMES.includes(game as Game)) {
    return NextResponse.json({ error: 'game must be pokemon, lorcana, or riftbound' }, { status: 400 })
  }

  invalidateCatalogCache(game as Game)
  return NextResponse.json({ ok: true })
}
