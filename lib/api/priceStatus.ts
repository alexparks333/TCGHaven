import { doc, getDoc, type Timestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase/config'
import type { Game } from '@/lib/types'
import type { SyncStatus } from './syncStatus'

// Everyone's prices come from the shared catalog, which the scheduled sync refreshes 4x a day
// (.github/workflows/sync-prices.yml → app/api/cron/sync-prices/route.ts). This reads whether
// that's actually happening, for the "Prices updated …" / "update failed" line on Portfolio:
//
//  - catalog_meta/{game}.lastBulkSyncAt — when the last SUCCESSFUL sync finished (written only
//    on success, by syncToFirestore() in scripts/lib/catalog-sync.mjs)
//  - sync_status/{game} — the most recent ATTEMPT, success or failure (lib/api/syncStatus.ts)
//
// Both are public-read in firestore.rules, so any signed-in user can show the same status.

// Four runs a day = one every 6h; flag it once roughly two runs in a row have gone missing.
const STALE_AFTER_MS = 9 * 60 * 60 * 1000

// MTG is deliberately not on the scheduled sync yet (see "MTG Integration.md"), so its catalog
// going "stale" is expected and must not trip the failure warning.
const NOT_ON_SCHEDULE: Game[] = ['mtg']

export interface PriceStatus {
  // Oldest last-successful-sync time across the games being shown — the honest "prices as of"
  // time when tracked games synced at different moments. null if none has ever synced.
  updatedAt: Date | null
  // Newest last-successful-sync time across those games — if this is newer than what a user's
  // cards were last priced from, there are fresh catalog prices to apply.
  latestSyncAt: Date | null
  // Latest scheduled update didn't go through for at least one tracked game (failed, or overdue).
  failed: boolean
  failedGames: Game[]
  checkedAt: Date
}

export async function loadPriceStatus(games: Game[]): Promise<PriceStatus> {
  const now = Date.now()
  const perGame = await Promise.all(
    games.map(async (game) => {
      const [metaSnap, statusSnap] = await Promise.all([
        getDoc(doc(db, 'catalog_meta', game)),
        getDoc(doc(db, 'sync_status', game)),
      ])
      const lastGood = (metaSnap.data()?.lastBulkSyncAt as Timestamp | undefined)?.toDate() ?? null
      const attempt = statusSnap.exists() ? (statusSnap.data() as SyncStatus) : null
      const attemptAt = attempt?.at ? new Date(attempt.at) : null
      const lastAttemptFailed = !!attempt && attempt.ok === false && !!attemptAt && (!lastGood || attemptAt > lastGood)
      const overdue = !NOT_ON_SCHEDULE.includes(game) && (!lastGood || now - lastGood.getTime() > STALE_AFTER_MS)
      return { game, lastGood, failed: lastAttemptFailed || overdue }
    }),
  )
  const goods = perGame.map((g) => g.lastGood).filter((d): d is Date => !!d)
  const failedGames = perGame.filter((g) => g.failed).map((g) => g.game)
  return {
    updatedAt: goods.length > 0 ? new Date(Math.min(...goods.map((d) => d.getTime()))) : null,
    latestSyncAt: goods.length > 0 ? new Date(Math.max(...goods.map((d) => d.getTime()))) : null,
    failed: failedGames.length > 0,
    failedGames,
    checkedAt: new Date(now),
  }
}
