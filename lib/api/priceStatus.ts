import { doc, getDoc, type Timestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase/config'
import type { Game } from '@/lib/types'
import type { SyncStatus } from './syncStatus'

// Everyone's prices come from the shared catalog, which the scheduled sync refreshes twice a day
// (.github/workflows/sync-prices.yml → app/api/cron/sync-prices/route.ts). This reads whether
// that's actually happening, for the "Prices updated …" / "update failed" line on Portfolio:
//
//  - sync_status/{game}.lastGoodAt — when the last SUCCESSFUL sync finished (written only on
//    success, by syncToFirestore() in scripts/lib/catalog-sync.mjs)
//  - sync_status/{game} — the most recent ATTEMPT, success or failure (lib/api/syncStatus.ts)
//
// One small doc per game, read by every open app every 15 minutes. Until a game's first sync
// since lastGoodAt existed, the same time is read from catalog_meta/{game}.lastBulkSyncAt instead
// — avoided otherwise, since that doc also carries the set list and broken-image ids (~180KB for
// Pokémon). Both are public-read in firestore.rules, so any signed-in user can show the same status.

// Flag a game once roughly two of its scheduled runs in a row have gone missing: the price sync runs
// twice a day (09:00 + 21:00 UTC — .github/workflows/sync-prices.yml; Japanese Pokémon syncs at most
// once a day of those), MTG once a day (sync-mtg.yml, 09:00 UTC), Yu-Gi-Oh! once a day (sync-yugioh.yml, 21:30 UTC).
const HOUR = 60 * 60 * 1000
const STALE_AFTER_MS: Partial<Record<Game, number>> = { mtg: 50 * HOUR, yugioh: 50 * HOUR }
const DEFAULT_STALE_AFTER_MS = 27 * HOUR
const staleAfter = (game: Game) => STALE_AFTER_MS[game] ?? DEFAULT_STALE_AFTER_MS

// MTG syncs once a day on its own schedule, so its time is left out of the shared "prices as of"
// time (it would drag it back by up to a day) unless it's all that's shown.
const OWN_SCHEDULE: Game[] = ['mtg', 'yugioh']

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
      const statusSnap = await getDoc(doc(db, 'sync_status', game))
      const lastGoodAt = statusSnap.data()?.lastGoodAt as Timestamp | undefined
      const lastGood = lastGoodAt
        ? lastGoodAt.toDate()
        : ((await getDoc(doc(db, 'catalog_meta', game))).data()?.lastBulkSyncAt as Timestamp | undefined)?.toDate() ?? null
      const attempt = statusSnap.exists() ? (statusSnap.data() as SyncStatus) : null
      const attemptAt = attempt?.at ? new Date(attempt.at) : null
      const lastAttemptFailed = !!attempt && attempt.ok === false && !!attemptAt && (!lastGood || attemptAt > lastGood)
      const overdue = !lastGood || now - lastGood.getTime() > staleAfter(game)
      return { game, lastGood, failed: lastAttemptFailed || overdue }
    }),
  )
  const goods = perGame.map((g) => g.lastGood).filter((d): d is Date => !!d)
  const scheduled = perGame.filter((g) => !OWN_SCHEDULE.includes(g.game)).map((g) => g.lastGood).filter((d): d is Date => !!d)
  const asOf = scheduled.length > 0 ? scheduled : goods
  const failedGames = perGame.filter((g) => g.failed).map((g) => g.game)
  return {
    updatedAt: asOf.length > 0 ? new Date(Math.min(...asOf.map((d) => d.getTime()))) : null,
    latestSyncAt: goods.length > 0 ? new Date(Math.max(...goods.map((d) => d.getTime()))) : null,
    failed: failedGames.length > 0,
    failedGames,
    checkedAt: new Date(now),
  }
}
