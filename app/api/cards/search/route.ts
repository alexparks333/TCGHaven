import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { searchCards, findCardById } from '@/lib/api/search'
import type { Game } from '@/lib/types'

export async function GET(req: NextRequest) {
  const game = (req.nextUrl.searchParams.get('game') ?? 'pokemon') as Game
  const q = req.nextUrl.searchParams.get('q') ?? ''
  // ?id= narrows to that one catalog card (the Cardex's "add this card" — q is its name)
  const id = req.nextUrl.searchParams.get('id')

  if (!q || q.length < 2) {
    return NextResponse.json([])
  }

  const results = id ? await findCardById(game, id, q) : await searchCards(game, q)
  return NextResponse.json(results)
}
