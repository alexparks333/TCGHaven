import { verifyAdminRequest } from '@/lib/firebase/verifyAdminRequest'
import { runMtgSync } from './sync'

export const dynamic = 'force-dynamic'
// MTG's bulk data file is the largest of any game here (100k+ printings, several hundred MB) and
// only grows — this is very likely to exceed a Vercel function's time/memory limits on most
// plans, the same way Pokemon's sync sometimes does at a fraction of the size. Firestore writes
// already applied are unaffected by a timeout (syncToFirestore() commits in small batches as it
// goes) — rerun it, or fall back to `npm run download-cards` locally, which has no such limit and
// is the reliable way to sync MTG in practice.
export const maxDuration = 300

// Real HTTP entry point (Admin Catalog's "Sync Card Data" button, or any other direct caller) —
// verifies the caller is the admin before doing anything. The actual sync logic lives in ./sync
// (see that file's header comment for why it isn't just exported from here alongside POST).
export async function POST(request: Request) {
  const unauthorized = await verifyAdminRequest(request)
  if (unauthorized) return unauthorized
  return runMtgSync()
}
