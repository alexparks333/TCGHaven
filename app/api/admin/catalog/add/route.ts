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

function synthesizeId(game: CatalogGame, card: Record<string, unknown>, variant?: string): string {
  const setCode = game === 'riftbound' ? card.setCode : card.set
  const slug = (variant || '1').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '') || '1'
  return `custom-${game}-${String(setCode ?? 'unknown').toLowerCase()}-${card.number}-${slug}`
}

// Dev-only — the OPPOSITE guard direction from /api/sync (which blocks dev, not prod):
// catalog edits are meant to happen locally before a rebuild ships them to production.
export async function POST(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { error: 'Catalog editing only works in dev — production is read-only. Edit locally, then sync/rebuild to ship the change.' },
      { status: 400 },
    )
  }
  if (RUNNING_SYNC_PHASES.has(readSyncPhase())) {
    return NextResponse.json({ error: 'A catalog sync is currently running — try again once it finishes.' }, { status: 409 })
  }

  const body = await request.json().catch(() => null)
  const game = body?.game as CatalogGame
  const card = body?.card as Record<string, unknown> | undefined
  const variant = body?.variant as string | undefined

  if (!game || !FILES[game] || !card || typeof card !== 'object') {
    return NextResponse.json({ error: 'Expected { game, card, variant? }' }, { status: 400 })
  }
  if (!card.number || !card.name) {
    return NextResponse.json({ error: 'card.number and card.name are required' }, { status: 400 })
  }

  // Reuse a real external id when the lookup step found one (e.g. a genuine Pokemon apiId or
  // Lorcana lorcast id) so the card behaves identically to a normally-scraped one. Only
  // synthesize a placeholder id when there's no real external id to anchor to.
  const id = typeof card.id === 'string' && card.id ? card.id : synthesizeId(game, card, variant)
  const finalCard = { ...card, id }

  const registry = loadCustomCatalog()
  if (registry[game].additions.some((c) => c.id === id)) {
    return NextResponse.json({ error: `A custom card with id "${id}" already exists` }, { status: 409 })
  }
  registry[game].exclusions = registry[game].exclusions.filter((exId) => exId !== id) // un-hide if re-adding the same id
  registry[game].additions.push(finalCard as typeof registry[typeof game]['additions'][number])
  saveCustomCatalog(registry)

  // Apply immediately so it shows up without waiting for a full re-download. Raw on-disk order
  // doesn't need to match the download script's exact per-game sort — every real consumer either
  // re-sorts for display (Cardex, this admin page) or doesn't care about array order (search, pack analysis).
  const filePath = join(process.cwd(), 'public', 'data', FILES[game])
  const catalog: Array<Record<string, unknown>> = JSON.parse(readFileSync(filePath, 'utf-8'))
  const withoutDupe = catalog.filter((c) => c.id !== id)
  withoutDupe.push(finalCard)
  writeFileSync(filePath, JSON.stringify(withoutDupe))
  invalidateCatalogCache(FILES[game])

  return NextResponse.json({ ok: true, card: finalCard })
}
