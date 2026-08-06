import { NextResponse } from 'next/server'
import { readFileSync, writeFileSync, renameSync } from 'fs'
import { join } from 'path'
import { loadSetRegistry, type SetRegistry } from '@/lib/api/registry'
import { invalidateSetsCache } from '@/lib/api/search'

export const dynamic = 'force-dynamic'

const REGISTRY_PATH = join(process.cwd(), 'data', 'set-registry.json')

export async function GET() {
  return NextResponse.json(loadSetRegistry())
}

// Structured patch of a single set entry — used by the Settings "Needs Review" editor.
// Never touches TypeScript source; only ever reads/writes this one JSON file.
export async function PUT(request: Request) {
  const body = await request.json().catch(() => null)
  const gameRaw = body?.game
  const setName = body?.setName
  const patch = body?.patch

  if ((gameRaw !== 'lorcana' && gameRaw !== 'riftbound') || typeof setName !== 'string' || typeof patch !== 'object' || patch === null) {
    return NextResponse.json({ error: 'Expected { game: "lorcana"|"riftbound", setName: string, patch: object }' }, { status: 400 })
  }
  const game: 'lorcana' | 'riftbound' = gameRaw

  let registry: SetRegistry
  try {
    registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf-8'))
  } catch {
    return NextResponse.json({ error: 'set-registry.json does not exist yet' }, { status: 404 })
  }

  const sets = registry[game].sets as unknown as Array<Record<string, unknown>>
  const idx = sets.findIndex((s) => s.setName === setName)
  if (idx === -1) {
    return NextResponse.json({ error: `No ${game} set named "${setName}" in the registry` }, { status: 404 })
  }

  sets[idx] = { ...sets[idx], ...patch }

  const tmpPath = REGISTRY_PATH + '.tmp'
  writeFileSync(tmpPath, JSON.stringify(registry, null, 2))
  renameSync(tmpPath, REGISTRY_PATH)

  return NextResponse.json({ ok: true, set: sets[idx] })
}

// Registers a brand new set — e.g. a curated/custom set that isn't sourced from any of the
// three scrapers, or a real upstream set the sync hasn't auto-detected yet. This is what makes
// a set selectable in the Admin Catalog (source of truth for search/inventory/Cardex): once
// registered, "Add Missing Card" can populate it one card at a time. Never touches a
// tcgcsvGroupId/lorcastId — those stay null so no future sync mistakes this for a real,
// scrapable set; an admin (or a later manual set-registry edit) can wire that up separately.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const gameRaw = body?.game
  const setName = typeof body?.setName === 'string' ? body.setName.trim() : ''
  const code = typeof body?.code === 'string' ? body.code.trim() : ''
  const cardexGroup = typeof body?.cardexGroup === 'string' ? body.cardexGroup : null

  if ((gameRaw !== 'lorcana' && gameRaw !== 'riftbound') || !setName || !cardexGroup) {
    return NextResponse.json({ error: 'Expected { game: "lorcana"|"riftbound", setName: string, code?: string, cardexGroup: string }' }, { status: 400 })
  }
  const game: 'lorcana' | 'riftbound' = gameRaw

  let registry: SetRegistry
  try {
    registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf-8'))
  } catch {
    return NextResponse.json({ error: 'set-registry.json does not exist yet' }, { status: 404 })
  }

  if (!registry[game].groupOrder.includes(cardexGroup)) {
    return NextResponse.json({ error: `"${cardexGroup}" isn't a known Cardex group for ${game} (expected one of: ${registry[game].groupOrder.join(', ')})` }, { status: 400 })
  }

  const sets = registry[game].sets as unknown as Array<Record<string, unknown>>
  if (sets.some((s) => String(s.setName).toLowerCase() === setName.toLowerCase())) {
    return NextResponse.json({ error: `A ${game} set named "${setName}" already exists` }, { status: 409 })
  }

  const newSet: Record<string, unknown> = game === 'riftbound'
    ? {
        setName,
        setCode: code || setName.slice(0, 3).toUpperCase(),
        releaseDate: null,
        cardCount: 0,
        cardexGroup,
        tcgcsvGroupId: null,
        groupMatchConfidence: null,
        needsReview: false,
        source: 'manual',
      }
    : {
        setName,
        code: code || null,
        lorcastId: null,
        releaseDate: null,
        cardexGroup,
        packAnalysis: { included: false },
        needsReview: false,
        source: 'manual',
      }

  sets.push(newSet)

  const tmpPath = REGISTRY_PATH + '.tmp'
  writeFileSync(tmpPath, JSON.stringify(registry, null, 2))
  renameSync(tmpPath, REGISTRY_PATH)

  // getSetsForGame() caches its result in-process indefinitely (see lib/api/search.ts) — this
  // runs server-side in the same process as that cache, so a direct call is enough (no client
  // round-trip needed, unlike the Admin Catalog card-hide cache fix).
  invalidateSetsCache(game)

  return NextResponse.json({ ok: true, set: newSet })
}

// Removes a set entry — restricted to source: "manual" sets (i.e. only ones created through
// this same New Set form). Official/auto-detected sets are never deletable here: they'd just
// reappear on the next sync anyway, and deleting one out from under real synced card data would
// only orphan it. The caller (Admin Catalog's "Delete Set") is expected to have already deleted
// every card doc for this set before calling this — this route only ever touches the registry
// JSON file, never Firestore.
export async function DELETE(request: Request) {
  const body = await request.json().catch(() => null)
  const gameRaw = body?.game
  const setName = body?.setName

  if ((gameRaw !== 'lorcana' && gameRaw !== 'riftbound') || typeof setName !== 'string' || !setName) {
    return NextResponse.json({ error: 'Expected { game: "lorcana"|"riftbound", setName: string }' }, { status: 400 })
  }
  const game: 'lorcana' | 'riftbound' = gameRaw

  let registry: SetRegistry
  try {
    registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf-8'))
  } catch {
    return NextResponse.json({ error: 'set-registry.json does not exist yet' }, { status: 404 })
  }

  const sets = registry[game].sets as unknown as Array<Record<string, unknown>>
  const idx = sets.findIndex((s) => s.setName === setName)
  if (idx === -1) {
    return NextResponse.json({ error: `No ${game} set named "${setName}" in the registry` }, { status: 404 })
  }
  if (sets[idx].source !== 'manual') {
    return NextResponse.json({ error: `"${setName}" isn't a custom set — only sets created via "New Set" can be deleted.` }, { status: 400 })
  }

  sets.splice(idx, 1)

  const tmpPath = REGISTRY_PATH + '.tmp'
  writeFileSync(tmpPath, JSON.stringify(registry, null, 2))
  renameSync(tmpPath, REGISTRY_PATH)

  invalidateSetsCache(game)

  return NextResponse.json({ ok: true })
}
