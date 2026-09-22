import { verifyAdminRequest } from '@/lib/firebase/verifyAdminRequest'
import { runPokemonSync } from './sync'

export const dynamic = 'force-dynamic'
// Pokemon's catalog is large (170+ sets, 20k+ cards) — this is the slowest of the three games
// to resync. Give it the most headroom; on a Vercel plan whose function timeout is shorter than
// this, the request will simply time out (Firestore writes already applied are unaffected,
// since syncToFirestore() commits in small batches as it goes) — rerun it, or fall back to
// `npm run download-cards` locally, which has no such limit.
export const maxDuration = 300

// Real HTTP entry point (Admin Catalog's "Sync Card Data" button, or any other direct caller) —
// verifies the caller is the admin before doing anything. The actual sync logic lives in ./sync
// (see that file's header comment for why it isn't just exported from here alongside POST).
export async function POST(request: Request) {
  const unauthorized = await verifyAdminRequest(request)
  if (unauthorized) return unauthorized
  return runPokemonSync()
}
