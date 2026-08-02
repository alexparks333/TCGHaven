import { NextResponse } from 'next/server'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { invalidateCatalogCache } from '@/lib/api/catalog'
import { loadCustomCatalog, saveCustomCatalog, type CatalogGame } from '@/lib/api/custom-catalog'

const FILES: Record<CatalogGame, string> = {
  pokemon: 'pokemon-cards.json',
  lorcana: 'lorcana-cards.json',
  riftbound: 'riftbound-cards.json',
}

const RUNNING_SYNC_PHASES = new Set([
  'downloading', 'diffing', 'matching-riftbound-groups', 'updating-registry',
  'repricing', 'building', 'restarting',
])

function readSyncPhase(): string {
  try {
    const raw = readFileSync(join(process.cwd(), 'data', 'sync-status.json'), 'utf-8')
    return JSON.parse(raw).phase ?? 'idle'
  } catch {
    return 'idle'
  }
}

// "Hide from catalog," never delete — this only ever adds an id to a reversible exclusion
// list. Dev-only, same guard direction as /api/admin/catalog/add.
export async function POST(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { error: 'Catalog editing only works in dev — production is read-only.' },
      { status: 400 },
    )
  }
  if (RUNNING_SYNC_PHASES.has(readSyncPhase())) {
    return NextResponse.json({ error: 'A catalog sync is currently running — try again once it finishes.' }, { status: 409 })
  }

  const body = await request.json().catch(() => null)
  const game = body?.game as CatalogGame
  const id = body?.id as string | undefined

  if (!game || !FILES[game] || !id) {
    return NextResponse.json({ error: 'Expected { game, id }' }, { status: 400 })
  }

  const registry = loadCustomCatalog()
  if (!registry[game].exclusions.includes(id)) registry[game].exclusions.push(id)
  // If this id was itself a custom addition, drop it from additions too — hiding your own
  // addition is just undoing it, not a duplicate-suppression case.
  registry[game].additions = registry[game].additions.filter((c) => c.id !== id)
  saveCustomCatalog(registry)

  const filePath = join(process.cwd(), 'public', 'data', FILES[game])
  const catalog: Array<Record<string, unknown>> = JSON.parse(readFileSync(filePath, 'utf-8'))
  writeFileSync(filePath, JSON.stringify(catalog.filter((c) => c.id !== id)))
  invalidateCatalogCache(FILES[game])

  return NextResponse.json({ ok: true, hiddenId: id })
}
