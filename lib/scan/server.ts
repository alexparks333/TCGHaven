// Server side of the card scanner: OCR lines from the phone → ranked catalog candidates, each with
// the same rows Add Card's search shows (prices, foil rows, Pokémon printings), so a scanned card
// is added exactly like a picked one. Called by app/api/cards/scan/route.ts. Plan: CardScanner.md.

import type { CatalogKey, Game, Language } from '../types'
import { loadVisibleCatalog } from '../api/catalog'
import { getPokemonSets } from '../api/pokemon'
import { getSetsForGame, findCardById, type CardSearchResult } from '../api/search'
import { readClues, matchScan, type OcrLine, type ScanCard, type ScanCatalog, type ScanCatalogKey } from './scanMatch'

export interface ScanMatch {
  key: string                 // "catalog:id"
  game: Game
  language?: Language
  id: string
  name: string
  score: number
  why: string
  exact: boolean
  rows: CardSearchResult[]    // first row = the default printing (non-foil where there is one)
}

const GAME_CATALOGS: Record<Game, ScanCatalogKey[]> = {
  pokemon: ['pokemon', 'pokemon-jp'],
  lorcana: ['lorcana'],
  riftbound: ['riftbound'],
  onepiece: ['onepiece'],
  mtg: ['mtg'],
}

async function scanCatalog(key: ScanCatalogKey): Promise<ScanCatalog> {
  const cards = await loadVisibleCatalog<ScanCard & { hidden?: boolean }>(key as CatalogKey)
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

export function cleanLines(raw: unknown): OcrLine[] {
  if (!Array.isArray(raw)) return []
  const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? Math.max(0, Math.min(1, v)) : 0)
  return raw.slice(0, 120).flatMap((l) => {
    const text = typeof l?.text === 'string' ? l.text.slice(0, 200) : ''
    return text.trim() ? [{ text, x: num(l.x), y: num(l.y), w: num(l.w), h: num(l.h) }] : []
  })
}

export async function matchScannedCard(lines: OcrLine[], games: Game[]): Promise<ScanMatch[]> {
  const keys = Array.from(new Set(games.flatMap((g) => GAME_CATALOGS[g] ?? [])))
  const catalogs = await Promise.all(keys.map(scanCatalog))
  const candidates = matchScan(readClues(lines), catalogs)

  const out = await Promise.all(candidates.map(async (c): Promise<ScanMatch | null> => {
    const game: Game = c.catalog === 'pokemon-jp' ? 'pokemon' : c.catalog
    const language: Language | undefined = c.catalog === 'pokemon-jp' ? 'ja' : undefined
    const rows = await findCardById(game, c.id, c.name, language).catch(() => [])
    if (rows.length === 0) return null
    return { key: `${c.catalog}:${c.id}`, game, language, id: c.id, name: c.name, score: c.score, why: c.why, exact: c.exact, rows }
  }))
  return out.filter((m): m is ScanMatch => m !== null)
}
