import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { searchCards } from '@/lib/api/search'
import type { Game } from '@/lib/types'

export async function GET(req: NextRequest) {
  const game = (req.nextUrl.searchParams.get('game') ?? 'pokemon') as Game
  const q = req.nextUrl.searchParams.get('q') ?? ''

  if (!q || q.length < 2) {
    return NextResponse.json([])
  }

  const results = await searchCards(game, q)
  return NextResponse.json(results)
}
