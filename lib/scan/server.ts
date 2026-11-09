// Server side of the card scanner: OCR lines from the phone → ranked catalog candidates, with
// what the scanner's tray shows (name, set, number, photo, price). Kept light on purpose — every
// scan goes through here; the full Add-Card rows (prices per printing, foil rows) are fetched by
// the review screen only for the cards actually kept. Called by app/api/cards/scan/route.ts.
// Plan: CardScanner.md.

import type { CatalogKey, Game, Language } from '../types'
import { loadVisibleCatalog } from '../api/catalog'
import { getPokemonSets } from '../api/pokemon'
import { getSetsForGame } from '../api/search'
import { readClues, matchScan, catalogIndex, type OcrLine, type ScanCard, type ScanCatalog, type ScanCatalogKey, type SlabLabel } from './scanMatch'

export interface ScanMatch {
  key: string                 // "catalog:id"
  game: Game
  language?: Language
  id: string
  name: string
  setName: string
  number: string
  imageUrl: string
  price: number               // market price (foil when the card only comes foil)
  score: number
  why: string
  exact: boolean
}

const GAME_CATALOGS: Record<Game, ScanCatalogKey[]> = {
  pokemon: ['pokemon', 'pokemon-jp'],
  lorcana: ['lorcana'],
  riftbound: ['riftbound'],
  onepiece: ['onepiece'],
  mtg: ['mtg'],
}

type RawCard = ScanCard & { hidden?: boolean; imageUrl?: string; marketPrice?: number; marketPriceFoil?: number }

async function scanCatalog(key: ScanCatalogKey): Promise<ScanCatalog & { cards: RawCard[] }> {
  const cards = await loadVisibleCatalog<RawCard>(key as CatalogKey)
  if (key === 'pokemon') {
    const sets = await getPokemonSets().catch(() => [])
    return { key, cards, sets: sets.map((s) => ({ id: s.id, name: s.name, total: s.total })) }
  }
  if (key === 'pokemon-jp') {
    const sets = await getSetsForGame('pokemon', 'ja').catch(() => [])
    return { key, cards, sets: sets.map((s) => ({ id: s.code, name: s.name, total: s.cardCount })) }
  }
  return { key, cards }
}

function catalogsFor(games: Game[]) {
  return Array.from(new Set(games.flatMap((g) => GAME_CATALOGS[g] ?? [])))
}

export function cleanLines(raw: unknown): OcrLine[] {
  if (!Array.isArray(raw)) return []
  const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? Math.max(0, Math.min(1, v)) : 0)
  return raw.slice(0, 240).flatMap((l) => {
    const text = typeof l?.text === 'string' ? l.text.slice(0, 200) : ''
    return text.trim() ? [{ text, x: num(l.x), y: num(l.y), w: num(l.w), h: num(l.h) }] : []
  })
}

/** Loads the catalogs and builds their lookups — the scanner calls this as it opens, so the first
 *  card doesn't wait for a cold server */
export async function warmScanner(games: Game[]): Promise<void> {
  const catalogs = await Promise.all(catalogsFor(games).map(scanCatalog))
  for (const c of catalogs) catalogIndex(c)
}

/** A graded slab's label, when the scan was of one — the review screen fills in the grade */
export type ScanSlab = Pick<SlabLabel, 'company' | 'grade' | 'cert'>

export async function matchScannedCard(lines: OcrLine[], games: Game[]): Promise<{ candidates: ScanMatch[]; slab: ScanSlab | null }> {
  const catalogs = await Promise.all(catalogsFor(games).map(scanCatalog))
  const byId = new Map<string, RawCard>()
  const clues = readClues(lines)
  const slab = clues.slab ? { company: clues.slab.company, grade: clues.slab.grade, cert: clues.slab.cert } : null
  const candidates = matchScan(clues, catalogs)
  for (const c of candidates) {
    const cat = catalogs.find((x) => x.key === c.catalog)
    const card = cat && (catalogIndex(cat).byId.get(c.id) as RawCard | undefined)
    if (card) byId.set(`${c.catalog}:${c.id}`, card)
  }
  return { slab, candidates: candidates.flatMap((c) => {
    const card = byId.get(`${c.catalog}:${c.id}`)
    if (!card) return []
    const regular = card.marketPrice ?? 0, foil = card.marketPriceFoil ?? 0
    return [{
      key: `${c.catalog}:${c.id}`,
      game: c.catalog === 'pokemon-jp' ? 'pokemon' as Game : c.catalog,
      ...(c.catalog === 'pokemon-jp' && { language: 'ja' as Language }),
      id: c.id,
      name: c.name,
      setName: String(card.setName ?? ''),
      number: String(card.number ?? ''),
      imageUrl: card.imageUrl ?? '',
      price: regular > 0 ? regular : foil,
      score: c.score,
      why: c.why,
      exact: c.exact,
    }]
  }) }
}
