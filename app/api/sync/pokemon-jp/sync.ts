import { NextResponse } from 'next/server'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase/config'
import { ensureSignedIn, downloadPokemonJapanese } from '@/scripts/lib/catalog-sync.mjs'
import { invalidateSetsCache } from '@/lib/api/search'
import { invalidateCatalogCache } from '@/lib/api/catalog'
import { recordSyncStatus } from '@/lib/api/syncStatus'

// Japanese Pokémon catalog sync (scripts/lib/pokemon-jp.mjs). Same route.ts/sync.ts split as every
// other game (CLAUDE.md quirk #24): route.ts checks the caller, the cron route calls this directly.
//
// `minIntervalHours`: the cron runs 4x a day, but TCGplayer's feed (tcgcsv) only refreshes once a
// day and every run reads the whole ~30k-card catalog to diff against, so the scheduled run skips
// itself unless the last successful sync is at least this old. A manual Admin click passes 0.
export async function runPokemonJapaneseSync({ minIntervalHours = 0 } = {}): Promise<Response> {
  try {
    if (minIntervalHours > 0) {
      const last = (await getDoc(doc(db, 'catalog_meta', 'pokemon-jp'))).data()?.lastBulkSyncAt?.toDate?.() as Date | undefined
      if (last && Date.now() - last.getTime() < minIntervalHours * 3_600_000) {
        return NextResponse.json({ ok: true, skipped: true, reason: `synced ${last.toISOString()}` })
      }
    }
    await ensureSignedIn()
    const result = await downloadPokemonJapanese()
    invalidateSetsCache('pokemon-jp')
    invalidateCatalogCache('pokemon-jp')
    const status = {
      ok: true, at: new Date().toISOString(), setCount: result.sets.length, newSets: result.newSetNames,
    }
    await recordSyncStatus('pokemon-jp', status)
    return NextResponse.json(status)
  } catch (err) {
    await recordSyncStatus('pokemon-jp', { ok: false, at: new Date().toISOString(), error: (err as Error).message })
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
