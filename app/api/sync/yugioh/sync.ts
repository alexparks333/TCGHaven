import { NextResponse } from 'next/server'
import { ensureSignedIn, downloadYugioh } from '@/scripts/lib/catalog-sync.mjs'
import { invalidateYugiohSetsCache } from '@/lib/api/yugioh'
import { invalidateSetsCache } from '@/lib/api/search'
import { invalidateCatalogCache } from '@/lib/api/catalog'
import { recordSyncStatus } from '@/lib/api/syncStatus'
import { findNewRarities } from '@/lib/api/syncHealth'

// The Yu-Gi-Oh! sync with no auth check of its own (route.ts may only export Next's names — rule
// 24). The daily job runs the same thing from the CLI (.github/workflows/sync-yugioh.yml); this is
// the staff portal's "Sync Card Data" button. ~660 TCGplayer downloads: on a short Vercel time
// limit the CLI is the reliable path (writes already made are kept if it times out).
export async function runYugiohSync(): Promise<Response> {
  try {
    await ensureSignedIn()
    const result = await downloadYugioh()
    invalidateYugiohSetsCache()
    invalidateSetsCache('yugioh')
    invalidateCatalogCache('yugioh')
    const status = {
      ok: true, at: new Date().toISOString(), setCount: result.sets,
      newSets: result.newSetNames, newRarities: findNewRarities(result.cards),
      totalBrokenImages: result.totalBrokenImages, newlyBrokenImages: result.newlyBrokenImages, newlyFixedImages: result.newlyFixedImages,
      sourceReport: result.sourceReport,
    }
    await recordSyncStatus('yugioh', status)
    return NextResponse.json(status)
  } catch (err) {
    await recordSyncStatus('yugioh', { ok: false, at: new Date().toISOString(), error: (err as Error).message })
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
