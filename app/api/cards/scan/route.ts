import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { matchScannedCard, cleanLines, warmScanner } from '@/lib/scan/server'
import { GAME_LABELS, type Game } from '@/lib/types'

// The iPhone app's card scanner (lib/scan/server.ts). Public, like card search — it only reads
// the public catalog.
//   POST { lines: OCR lines from one card, games }  → ranked catalog candidates
//   GET ?warm=1&games=pokemon,mtg                    → loads those catalogs (as the scanner opens)

const ALL = Object.keys(GAME_LABELS) as Game[]
const pickGames = (raw: unknown[]) => {
  const games = raw.filter((g): g is Game => ALL.includes(g as Game))
  return games.length ? games : ALL
}

export async function GET(req: NextRequest) {
  const games = pickGames((req.nextUrl.searchParams.get('games') ?? '').split(','))
  await warmScanner(games).catch(() => {})
  return NextResponse.json({ ok: true })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const lines = cleanLines(body?.lines)
  if (lines.length === 0) return NextResponse.json({ candidates: [] })
  const candidates = await matchScannedCard(lines, pickGames(Array.isArray(body?.games) ? body.games : []))
  return NextResponse.json({ candidates })
}
