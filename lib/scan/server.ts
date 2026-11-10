// Server side of the card scanner: OCR lines from the phone → ranked catalog candidates, with
// what the scanner's tray shows (name, set, number, photo, price). Kept light on purpose — every
// scan goes through here; the full Add-Card rows (prices per printing, foil rows) are fetched by
// the review screen only for the cards actually kept. Called by app/api/cards/scan/route.ts.
// Plan: docs/card-scanner.md.

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
  // Every printing the card comes in, with its price — the card sheet's Finish row. Pokémon:
  // "edition:finish" keys ("unlimited:reverse"); other games "normal" / "foil".
  printings: Array<{ key: string; label: string; price: number }>
}

const EDITION_LABEL: Record<string, string> = { unlimited: '', shadowless: 'Shadowless', '1st': '1st Edition', limited: 'Limited Edition' }
const FINISH_LABEL: Record<string, string> = { normal: 'Normal', holofoil: 'Holo', reverse: 'Reverse Holo', rainbow: 'Rainbow Foil', cold: 'Cold Foil' }

function printingsOf(card: RawCard, game: Game): ScanMatch['printings'] {
  const vp = card.variantPrices
  if (vp && Object.keys(vp).length) {
    const order = ['unlimited', 'shadowless', '1st', 'limited'], fin = ['normal', 'holofoil', 'reverse', 'rainbow', 'cold']
    return Object.entries(vp)
      .map(([key, price]) => {
        const [edition, finish] = key.split(':')
        // Yu-Gi-Oh! has editions only (its foil is the rarity): "1st Edition" / "Unlimited" / "Limited Edition"
        const label = game === 'yugioh'
          ? (edition === 'unlimited' ? 'Unlimited' : EDITION_LABEL[edition] ?? edition)
          : [EDITION_LABEL[edition] ?? edition, FINISH_LABEL[finish] ?? finish].filter(Boolean).join(' ')
        return { key, label, price, o: order.indexOf(edition) * 10 + fin.indexOf(finish) }
      })
      .sort((a, b) => a.o - b.o)
      .map(({ key, label, price }) => ({ key, label, price }))
  }
  const regular = card.marketPrice ?? 0, foil = card.marketPriceFoil ?? 0
  const out: ScanMatch['printings'] = []
  if (regular > 0) out.push({ key: 'normal', label: 'Normal', price: regular })
  if (foil > 0 && foil !== regular) out.push({ key: 'foil', label: 'Foil', price: foil })
  return out
}

const GAME_CATALOGS: Record<Game, ScanCatalogKey[]> = {
  pokemon: ['pokemon', 'pokemon-jp'],
  lorcana: ['lorcana'],
  riftbound: ['riftbound'],
  onepiece: ['onepiece'],
  mtg: ['mtg'],
  yugioh: ['yugioh'],
  swu: ['swu'],
  gundam: ['gundam'],
  fab: ['fab'],
  digimon: ['digimon'],
  palworld: ['palworld'],
}

type RawCard = ScanCard & { hidden?: boolean; imageUrl?: string; marketPrice?: number; marketPriceFoil?: number; variantPrices?: Record<string, number> }

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
      printings: printingsOf(card, c.catalog === 'pokemon-jp' ? 'pokemon' : c.catalog),
    }]
  }) }
}
