import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { searchCards, findCardById, warmCardSearch } from '@/lib/api/search'
import type { Game, Language } from '@/lib/types'

export async function GET(req: NextRequest) {
  const game = (req.nextUrl.searchParams.get('game') ?? 'pokemon') as Game
  // No card name is near 100 characters; a longer query only makes the fuzzy matching do far more
  // work (security review 2026-11-21)
  const q = (req.nextUrl.searchParams.get('q') ?? '').slice(0, 100)
  // ?id= narrows to that one catalog card (the Cardex's "add this card" — q is its name)
  const id = req.nextUrl.searchParams.get('id')
  // lang=ja → Japanese Pokémon catalog
  const language = req.nextUrl.searchParams.get('lang') === 'ja' ? 'ja' as Language : undefined

  if (req.nextUrl.searchParams.get('warm')) {
    await warmCardSearch(game, language).catch(() => {})
    return NextResponse.json({ ok: true })
  }

  if (!id && (!q || q.length < 2)) {
    return NextResponse.json([])
  }

  const results = id ? await findCardById(game, id, q, language) : await searchCards(game, q, language)
  // Same query → same answer for everyone: Vercel's CDN keeps it for a few minutes
  return NextResponse.json(results, { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600' } })
}
