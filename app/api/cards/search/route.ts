import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { searchCards, findCardById, warmCardSearch } from '@/lib/api/search'
import type { Game, Language } from '@/lib/types'

export async function GET(req: NextRequest) {
  const game = (req.nextUrl.searchParams.get('game') ?? 'pokemon') as Game
  const q = req.nextUrl.searchParams.get('q') ?? ''
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
  return NextResponse.json(results)
}
