// Shared handlers behind each TCGplayer-sourced game's routes (Star Wars: Unlimited, Gundam,
// Flesh and Blood, Digimon, Palworld, Cyberpunk): app/api/prices/{game}/route.ts and
// app/api/sync/{game}/route.ts are one-liners calling these (a route.ts may only export Next's
// allowed names — CLAUDE.md rule 24).
import { NextResponse } from 'next/server'
import { loadCatalog, invalidateCatalogCache } from './catalog'
import { catalogPrice } from '../pricing'
import { invalidateSetsCache } from './search'
import { invalidateTcgplayerGameSetsCache } from './tcgplayerGames'
import { recordSyncStatus } from './syncStatus'
import { findNewRarities } from './syncHealth'
import { ensureSignedIn, downloadTcgplayerGame } from '@/scripts/lib/catalog-sync.mjs'
import type { Edition, Finish, TcgplayerSourcedGame } from '../types'

interface PriceInput { id: string; apiId: string; isFoil: boolean; edition?: Edition; finish?: Finish }
interface CatalogPriceCard { id: string; marketPrice: number; marketPriceFoil: number; variantPrices?: Record<string, number> }

/** Live prices for a user's cards, straight from the catalog (refreshed daily by
 *  sync-tcgplayer-games.yml) — lib/pricing.ts, the one rule every price display uses. A Flesh and
 *  Blood card logged as a specific printing is priced as exactly that printing. */
export async function tcgplayerGamePrices(game: TcgplayerSourcedGame, req: Request): Promise<Response> {
  const { cards }: { cards: PriceInput[] } = await req.json()
  if (!cards?.length) return NextResponse.json({})
  const catalog = await loadCatalog<CatalogPriceCard>(game)
  const byId = new Map(catalog.map((c) => [c.id, c]))
  const results: Record<string, number> = {}
  for (const card of cards) {
    const cat = card.apiId ? byId.get(card.apiId) : undefined
    if (!cat) continue
    const price = catalogPrice(game, cat, { isFoil: card.isFoil, edition: card.edition, finish: card.finish })
    if (price > 0) results[card.id] = price
  }
  return NextResponse.json(results)
}

/** The staff portal's "Sync Card Data" for one game (no auth check of its own — the route does
 *  it). The daily job runs the same from the CLI; Flesh and Blood / Digimon (~110 sets each) may
 *  outrun a short Vercel limit — writes already made are kept, and the CLI is the reliable path. */
export async function runTcgplayerGameSync(game: TcgplayerSourcedGame): Promise<Response> {
  try {
    await ensureSignedIn()
    const result = await downloadTcgplayerGame(game)
    invalidateTcgplayerGameSetsCache(game)
    invalidateSetsCache(game)
    invalidateCatalogCache(game)
    const status = {
      ok: true, at: new Date().toISOString(), setCount: result.sets,
      newSets: result.newSetNames, newRarities: findNewRarities(result.cards),
      totalBrokenImages: result.totalBrokenImages, newlyBrokenImages: result.newlyBrokenImages, newlyFixedImages: result.newlyFixedImages,
      sourceReport: result.sourceReport,
    }
    await recordSyncStatus(game, status)
    return NextResponse.json(status)
  } catch (err) {
    await recordSyncStatus(game, { ok: false, at: new Date().toISOString(), error: (err as Error).message })
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
