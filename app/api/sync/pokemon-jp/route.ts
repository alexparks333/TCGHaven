import { verifyAdminRequest } from '@/lib/firebase/verifyAdminRequest'
import { runPokemonJapaneseSync } from './sync'

export const dynamic = 'force-dynamic'
// ~460 small CSVs plus a ~30k-card diff — the first run (every card new) is the slowest.
export const maxDuration = 300

export async function POST(request: Request) {
  const unauthorized = await verifyAdminRequest(request)
  if (unauthorized) return unauthorized
  return runPokemonJapaneseSync()
}
