import { NextRequest, NextResponse } from 'next/server'
import { POST as syncPokemon } from '../../sync/pokemon/route'
import { POST as syncLorcana } from '../../sync/lorcana/route'
import { POST as syncRiftbound } from '../../sync/riftbound/route'
import { POST as syncOnePiece } from '../../sync/onepiece/route'

// Called by an external scheduler (cron-job.org, GitHub Actions, etc.) 4x/day to keep the shared
// catalog's prices fresh — this is what lets Portfolio's "Refresh Prices" button and Pack
// Analysis read prices straight from Firestore (loadCatalog(), see lib/api/catalog.ts) instead of
// each hitting tcgcsv/lorcast/pokemontcg.io live on every user click/page view. See CLAUDE.md
// §"Price Data" for the full before/after.
//
// Reuses the exact same per-game sync routes the Admin Catalog "Sync Card Data" button calls
// (each already does new-set detection/registry updates for Lorcana/Riftbound) — imported and
// invoked directly in-process rather than over HTTP, so this route's own maxDuration budget
// covers the whole run without an extra network hop.
export const dynamic = 'force-dynamic'
// Pokemon is the big one here (170+ sets, 20k+ cards) — see app/api/sync/pokemon/route.ts for why
// it can exceed this on some Vercel plans. Promise.allSettled below means one game timing out
// doesn't block the others, and Firestore writes already committed by a timed-out game aren't
// lost (syncToFirestore() batches as it goes) — worst case that one game's catalog is only as
// fresh as its last successful run, same as if the cron hadn't fired for it at all.
export const maxDuration = 300

// MTG is deliberately NOT wired into this automatic cron yet — its first sync alone writes
// ~99,000 Firestore documents (its "default_cards" catalog is far bigger than any other game
// here), which can blow through a Firebase Spark (free) plan's 20k writes/day quota in one run
// and starve every other write that day, including this cron's own remaining games. Once the
// Firebase plan/quota is confirmed to handle it, wire it in the same way the others are below
// (`import { POST as syncMtg } from '../../sync/mtg/route'`, add to the Promise.allSettled array
// and the summarize() calls) — see "MTG Integration.md" at the repo root for the full writeup.
// Until then, MTG only ever syncs when an admin manually clicks Admin Catalog → "Sync Card Data"
// → Magic: The Gathering, a deliberate one-off action rather than an automatic recurring one.

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false // refuse to run unprotected — better a broken cron than an open one
  const header = req.headers.get('x-cron-secret')
  const query = req.nextUrl.searchParams.get('secret')
  return header === secret || query === secret
}

async function runSync() {
  // Was missing One Piece entirely until this was touched to add MTG support elsewhere —
  // CLAUDE.md's file map always claimed this called "all four" sync routes, but the code only
  // ever called three. Fixed here; MTG stays out on purpose (see comment above).
  const [pokemon, lorcana, riftbound, onepiece] = await Promise.allSettled([
    syncPokemon(),
    syncLorcana(),
    syncRiftbound(),
    syncOnePiece(),
  ])

  const summarize = async (label: string, result: PromiseSettledResult<Response>) => {
    if (result.status === 'rejected') return { game: label, ok: false, error: String(result.reason) }
    try {
      return { game: label, ...(await result.value.json()) }
    } catch {
      return { game: label, ok: false, error: 'failed to parse sync response' }
    }
  }

  return Promise.all([
    summarize('pokemon', pokemon),
    summarize('lorcana', lorcana),
    summarize('riftbound', riftbound),
    summarize('onepiece', onepiece),
  ])
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const results = await runSync()
  return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), results })
}

export async function GET(req: NextRequest) { return handle(req) }
export async function POST(req: NextRequest) { return handle(req) }
