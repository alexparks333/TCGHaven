import { NextResponse } from 'next/server'
import { loadCatalog, scoreMatch, parseSearchQuery, normNum } from '@/lib/api/catalog'
import { getSetsForGame } from '@/lib/api/search'
import type { Game } from '@/lib/types'

export const dynamic = 'force-dynamic'

const GAMES: Game[] = ['pokemon', 'lorcana', 'riftbound']
const MAX_RESULTS = 300

interface CatalogCard {
  id: string
  name: string
  number: string
  set?: string        // Pokemon: set id
  setCode?: string     // Riftbound: set code
  setName: string
  rarity?: string
  tags?: string[]      // Riftbound only
  imageUrl: string
  marketPrice?: number
  marketPriceFoil?: number
  hidden?: boolean
  source?: 'scraped' | 'manual'
}

// Whole-catalog name search across every set for a game, independent of whichever single set is
// currently open in the Admin Catalog browser — e.g. "pikachu" surfaces every Pikachu printing
// across all ~170 Pokemon sets in one query, not just the one currently loaded (that per-set
// scope is what /api/admin/catalog and the Jump to Name/Number inputs are for). Results are
// ordered oldest set release -> newest (then by collector number within a set), not by search
// relevance — the point here is chronological print-history browsing, not "best match first."
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const game = searchParams.get('game') as Game | null
  const q = searchParams.get('q') ?? ''

  if (!game || !GAMES.includes(game)) {
    return NextResponse.json({ error: 'game must be pokemon, lorcana, or riftbound' }, { status: 400 })
  }
  if (q.trim().length < 2) return NextResponse.json([])

  const { nameQuery, numberFilter } = parseSearchQuery(q)
  if (!nameQuery) return NextResponse.json([])

  const [catalog, sets] = await Promise.all([
    loadCatalog<CatalogCard>(game),
    getSetsForGame(game),
  ])

  // Sets are keyed differently per game depending on what each game's own card docs carry:
  // Lorcana cards only carry the human setName (see CLAUDE.md quirk #12 — lorcast's numeric set
  // id isn't what anything else matches on either); Pokemon/Riftbound cards carry a real set
  // code that lines up with SetOption.code.
  const releaseDateBySetKey = new Map<string, string>()
  for (const s of sets) releaseDateBySetKey.set(game === 'lorcana' ? s.name : s.code, s.releaseDate || '')
  function releaseDateFor(c: CatalogCard): string {
    const key = game === 'lorcana' ? c.setName : game === 'riftbound' ? (c.setCode ?? '') : (c.set ?? '')
    return releaseDateBySetKey.get(key) || ''
  }

  const matches = catalog
    .filter((c) => !numberFilter || normNum(c.number) === normNum(numberFilter))
    .map((c) => ({ c, score: scoreMatch(c.name, nameQuery, c.tags) }))
    .filter(({ score }) => score >= 0)
    .map(({ c }) => ({
      id: c.id,
      name: c.name,
      number: c.number,
      setName: c.setName,
      rarity: c.rarity,
      imageUrl: c.imageUrl,
      marketPrice: c.marketPrice,
      marketPriceFoil: c.marketPriceFoil,
      isCustom: c.source === 'manual',
      isHidden: !!c.hidden,
      // Sentinel so sets with no known release date (a brand-new custom set) sort last, not
      // first — an empty string would otherwise sort before every real "YYYY-MM-DD" date.
      releaseDate: releaseDateFor(c) || '9999-99-99',
    }))

  matches.sort((a, b) => {
    const dateDiff = a.releaseDate.localeCompare(b.releaseDate)
    if (dateDiff !== 0) return dateDiff
    const aNum = parseInt(a.number, 10)
    const bNum = parseInt(b.number, 10)
    if (!isNaN(aNum) && !isNaN(bNum) && aNum !== bNum) return aNum - bNum
    return a.number.localeCompare(b.number)
  })

  // The '9999-99-99' sentinel above exists only to sort unknown-date sets last — swap it back
  // out for undefined before this reaches the client, which otherwise displays it as a literal
  // (nonsensical) release date.
  return NextResponse.json(matches.slice(0, MAX_RESULTS).map((m) => ({
    ...m,
    releaseDate: m.releaseDate === '9999-99-99' ? undefined : m.releaseDate,
  })))
}
