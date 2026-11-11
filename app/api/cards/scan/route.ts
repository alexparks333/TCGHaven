import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { matchScannedCard, cleanLines, warmScanner } from '@/lib/scan/server'
import { cleanFingerprints, pictureModel } from '@/lib/scan/picture'
import { GAME_LABELS, type Game } from '@/lib/types'

// The iPhone app's card scanner (lib/scan/server.ts). Public, like card search — it only reads
// the public catalog.
//   POST { lines: OCR lines from one card, games, fingerprints?: the picture AI's numbers for the
//          scan (lib/scan/picture.ts) }                        → ranked catalog candidates
//   GET ?warm=1&games=pokemon,mtg                              → loads those catalogs and picture
//          indexes (as the scanner opens)
//   GET ?model=1[&platform=android]                            → the picture model the phone should
//          have: { version, files: { path in the .mlpackage (iPhone) / 'model.onnx' (Android): URL } } (or null)

const ALL = Object.keys(GAME_LABELS) as Game[]
const pickGames = (raw: unknown[]) => {
  const games = raw.filter((g): g is Game => ALL.includes(g as Game))
  return games.length ? games : ALL
}

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('model')) {
    const platform = req.nextUrl.searchParams.get('platform') === 'android' ? 'android' : 'ios'
    return NextResponse.json({ model: await pictureModel(platform).catch(() => null) })
  }
  const games = pickGames((req.nextUrl.searchParams.get('games') ?? '').split(','))
  await warmScanner(games).catch(() => {})
  return NextResponse.json({ ok: true })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const lines = cleanLines(body?.lines)
  const fingerprints = cleanFingerprints(body?.fingerprints)
  if (lines.length === 0 && fingerprints.length === 0) return NextResponse.json({ candidates: [], slab: null })
  return NextResponse.json(await matchScannedCard(lines, pickGames(Array.isArray(body?.games) ? body.games : []), fingerprints))
}
