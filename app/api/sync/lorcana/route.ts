import { NextResponse } from 'next/server'
import { loadSetRegistry, saveSetRegistry, invalidateRegistryCache } from '@/lib/api/registry'
import { ensureSignedIn, downloadLorcana } from '@/scripts/lib/catalog-sync.mjs'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST() {
  try {
    await ensureSignedIn()

    invalidateRegistryCache() // we're about to append to it — always start from the live doc
    const registry = await loadSetRegistry()
    const knownNames = new Set(registry.lorcana.sets.map((s) => s.setName))

    const result = await downloadLorcana()
    const newNames: string[] = result.setNames.filter((n: string) => !knownNames.has(n))

    if (newNames.length > 0) {
      const nowIso = new Date().toISOString()
      for (const setName of newNames) {
        registry.lorcana.sets.push({
          setName, code: null, lorcastId: null, releaseDate: null,
          cardexGroup: 'Special Sets',
          packAnalysis: { included: false },
          needsReview: true, source: 'auto-detected', addedAt: nowIso,
        } as (typeof registry.lorcana.sets)[number])
      }
      await saveSetRegistry(registry)
    }

    return NextResponse.json({ ok: true, setCount: result.setNames.length, newSets: newNames })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
