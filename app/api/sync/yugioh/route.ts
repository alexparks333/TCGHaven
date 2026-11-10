import { verifyAdminRequest } from '@/lib/firebase/verifyAdminRequest'
import { runYugiohSync } from './sync'

export const dynamic = 'force-dynamic'
// ~660 TCGplayer set downloads + comparing ~45k cards: may outrun the function limit — the daily
// job and `npm run download-cards -- --only yugioh` are the reliable paths
export const maxDuration = 300

// The staff portal's "Sync Card Data" → Yu-Gi-Oh! (admin only). The logic is in ./sync.
export async function POST(request: Request) {
  const unauthorized = await verifyAdminRequest(request)
  if (unauthorized) return unauthorized
  return runYugiohSync()
}
