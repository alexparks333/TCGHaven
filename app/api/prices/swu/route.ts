import { tcgplayerGamePrices } from '@/lib/api/tcgplayerGameRoutes'

export const dynamic = 'force-dynamic'

// Batch price lookup for this game's cards — the logic is shared by the TCGplayer-sourced
// games (lib/api/tcgplayerGameRoutes.ts)
export async function POST(req: Request) {
  return tcgplayerGamePrices('swu', req)
}
