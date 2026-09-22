import { verifyAdminRequest } from '@/lib/firebase/verifyAdminRequest'
import { runLorcanaSync } from './sync'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// Real HTTP entry point (Admin Catalog's "Sync Card Data" button, or any other direct caller) —
// verifies the caller is the admin before doing anything. The actual sync logic lives in ./sync
// (see that file's header comment for why it isn't just exported from here alongside POST).
export async function POST(request: Request) {
  const unauthorized = await verifyAdminRequest(request)
  if (unauthorized) return unauthorized
  return runLorcanaSync()
}
