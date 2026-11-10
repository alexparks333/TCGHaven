import { verifyAdminRequest } from '@/lib/firebase/verifyAdminRequest'
import { runTcgplayerGameSync } from '@/lib/api/tcgplayerGameRoutes'

export const dynamic = 'force-dynamic'
// Every TCGplayer set download + comparing the catalog: may outrun the function limit on the
// bigger games — the daily job (sync-tcgplayer-games.yml) and `npm run download-cards -- --only swu`
// are the reliable paths
export const maxDuration = 300

// The staff portal's "Sync Card Data" (admin only). The logic is shared: lib/api/tcgplayerGameRoutes.ts
export async function POST(request: Request) {
  const unauthorized = await verifyAdminRequest(request)
  if (unauthorized) return unauthorized
  return runTcgplayerGameSync('swu')
}
