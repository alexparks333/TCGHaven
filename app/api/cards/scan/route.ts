import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { matchScannedCard, cleanLines } from '@/lib/scan/server'
import { GAME_LABELS, type Game } from '@/lib/types'

// The iPhone app's card scanner: POST { lines: OCR lines from one card, games: games to look in }
// → ranked catalog candidates (lib/scan/server.ts). Public, like card search — it only reads the
// public catalog.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const lines = cleanLines(body?.lines)
  const all = Object.keys(GAME_LABELS) as Game[]
  const asked = Array.isArray(body?.games) ? (body.games as unknown[]).filter((g): g is Game => all.includes(g as Game)) : []
  if (lines.length === 0) return NextResponse.json({ candidates: [] })
  const candidates = await matchScannedCard(lines, asked.length ? asked : all)
  return NextResponse.json({ candidates })
}
