import { NextResponse } from 'next/server'
import { loadSetRegistry, saveSetRegistry } from '@/lib/api/registry'
import { ensureAdminAuth } from '@/lib/firebase/adminAuth'
import { invalidateSetsCache } from '@/lib/api/search'
import { invalidatePokemonSetsCache } from '@/lib/api/pokemon'
import { invalidateMtgSetsCache } from '@/lib/api/mtg'
import type { Game } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json(await loadSetRegistry())
}

// Structured patch of a single set entry — used by the Settings "Needs Review" editor.
// Only ever reads/writes the registry/main Firestore doc, never TypeScript source.
const REGISTRY_GAMES: Game[] = ['pokemon', 'lorcana', 'riftbound', 'onepiece', 'mtg']

export async function PUT(request: Request) {
  const body = await request.json().catch(() => null)
  const gameRaw = body?.game
  const setName = body?.setName
  const patch = body?.patch

  if (!REGISTRY_GAMES.includes(gameRaw) || typeof setName !== 'string' || typeof patch !== 'object' || patch === null) {
    return NextResponse.json({ error: 'Expected { game: "pokemon"|"lorcana"|"riftbound"|"onepiece"|"mtg", setName: string, patch: object }' }, { status: 400 })
  }
  const game: Game = gameRaw

  const registry = await loadSetRegistry()
  const sets = registry[game].sets as unknown as Array<Record<string, unknown>>
  const idx = sets.findIndex((s) => s.setName === setName)
  if (idx === -1) {
    return NextResponse.json({ error: `No ${game} set named "${setName}" in the registry` }, { status: 404 })
  }

  sets[idx] = { ...sets[idx], ...patch }

  await ensureAdminAuth()
  await saveSetRegistry(registry)

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
  const releaseDate = typeof body?.releaseDate === 'string' && body.releaseDate.trim() ? body.releaseDate.trim() : null
  // Pokemon's Cardex groups are derived automatically from the live api.pokemontcg.io `series`
  // field (see CLAUDE.md quirk #9), not from a registry cardexGroup — so a custom Pokemon set has
  // nowhere to plug one into (it lands in Cardex's own "Custom Sets" bucket instead). It also
  // isn't part of Pack Analysis. One Piece works the same way, grouping by set-code prefix
  // instead of `series` — a custom One Piece set lands in its own "Promos & Special" group. MTG
  // follows the same pattern as Pokemon (live external sets API, grouped by Scryfall's own
  // `set_type` — see buildMtgGroups() in CardexPage.tsx) — a custom MTG set lands in its own
  // trailing "Custom Sets" group too.
  const cardexGroup = typeof body?.cardexGroup === 'string' ? body.cardexGroup : null

  if (!REGISTRY_GAMES.includes(gameRaw) || !setName) {
    return NextResponse.json({ error: 'Expected { game: "pokemon"|"lorcana"|"riftbound"|"onepiece"|"mtg", setName: string, code?: string, releaseDate?: string, cardexGroup?: string }' }, { status: 400 })
  }
  const game: Game = gameRaw
  if (game !== 'pokemon' && game !== 'onepiece' && game !== 'mtg' && !cardexGroup) {
    return NextResponse.json({ error: 'cardexGroup is required for lorcana/riftbound sets' }, { status: 400 })
  }

  const registry = await loadSetRegistry()

  if (game !== 'pokemon' && game !== 'onepiece' && game !== 'mtg' && cardexGroup) {
    const groupOrder = registry[game].groupOrder
    if (!groupOrder.includes(cardexGroup)) {
      return NextResponse.json({ error: `"${cardexGroup}" isn't a known Cardex group for ${game} (expected one of: ${groupOrder.join(', ')})` }, { status: 400 })
    }
  }

  const sets = registry[game].sets as unknown as Array<Record<string, unknown>>
  if (sets.some((s) => String(s.setName).toLowerCase() === setName.toLowerCase())) {
    return NextResponse.json({ error: `A ${game} set named "${setName}" already exists` }, { status: 409 })
  }

  const newSet: Record<string, unknown> = game === 'riftbound'
    ? {
        setName,
        setCode: code || setName.slice(0, 3).toUpperCase(),
        releaseDate,
        cardCount: 0,
        cardexGroup,
        tcgcsvGroupId: null,
        groupMatchConfidence: null,
        needsReview: false,
        source: 'manual',
      }
    : game === 'lorcana'
    ? {
        setName,
        code: code || null,
        lorcastId: null,
        releaseDate,
        cardexGroup,
        packAnalysis: { included: false },
        needsReview: false,
        source: 'manual',
      }
    : game === 'onepiece'
    ? {
        // No code -> falls outside the OP/ST/EB/PRB prefixes buildOnePieceGroups() looks for,
        // landing this set in the "Promos & Special" bucket — a reasonable default for a custom
        // set that (unlike a real upstream one) has no official print-numbering prefix anyway.
        setName,
        code: code || '',
        releaseDate,
        cardCount: 0,
        source: 'manual',
      }
    : {
        setName,
        code: code || null,
        releaseDate,
        source: 'manual',
      }

  sets.push(newSet)

  await ensureAdminAuth()
  await saveSetRegistry(registry)

  // getSetsForGame() caches its result in-process indefinitely (see lib/api/search.ts) — this
  // runs server-side in the same process as that cache, so a direct call is enough (no client
  // round-trip needed, unlike the Admin Catalog card-hide cache fix). Pokemon has its own
  // separate cache one layer down (lib/api/pokemon.ts's getPokemonSets()) that also needs it.
  invalidateSetsCache(game)
  if (game === 'pokemon') invalidatePokemonSetsCache()
  if (game === 'mtg') invalidateMtgSetsCache()

  return NextResponse.json({ ok: true, set: newSet })
}

// Removes a set entry — restricted to source: "manual" sets (i.e. only ones created through
// this same New Set form). Official/auto-detected sets are never deletable here: they'd just
// reappear on the next sync anyway, and deleting one out from under real synced card data would
// only orphan it. The caller (Admin Catalog's "Delete Set") is expected to have already deleted
// every card doc for this set before calling this — this route only ever touches the registry,
// never the catalog itself.
export async function DELETE(request: Request) {
  const body = await request.json().catch(() => null)
  const gameRaw = body?.game
  const setName = body?.setName

  if (!REGISTRY_GAMES.includes(gameRaw) || typeof setName !== 'string' || !setName) {
    return NextResponse.json({ error: 'Expected { game: "pokemon"|"lorcana"|"riftbound"|"onepiece"|"mtg", setName: string }' }, { status: 400 })
  }
  const game: Game = gameRaw

  const registry = await loadSetRegistry()
  const sets = registry[game].sets as unknown as Array<Record<string, unknown>>
  const idx = sets.findIndex((s) => s.setName === setName)
  if (idx === -1) {
    return NextResponse.json({ error: `No ${game} set named "${setName}" in the registry` }, { status: 404 })
  }
  if (sets[idx].source !== 'manual') {
    return NextResponse.json({ error: `"${setName}" isn't a custom set — only sets created via "New Set" can be deleted.` }, { status: 400 })
  }

  sets.splice(idx, 1)

  await ensureAdminAuth()
  await saveSetRegistry(registry)

  invalidateSetsCache(game)
  if (game === 'pokemon') invalidatePokemonSetsCache()
  if (game === 'mtg') invalidateMtgSetsCache()

  return NextResponse.json({ ok: true })
}
