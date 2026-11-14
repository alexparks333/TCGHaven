// Server side of the card scanner: OCR lines from the phone → ranked catalog candidates, with
// what the scanner's tray shows (name, set, number, photo, price). Kept light on purpose — every
// scan goes through here; the full Add-Card rows (prices per printing, foil rows) are fetched by
// the review screen only for the cards actually kept. Called by app/api/cards/scan/route.ts.
// Plan: docs/card-scanner.md.

import type { CatalogKey, Game, Language } from '../types'
import { loadVisibleCatalog, invalidateCatalogCache } from '../api/catalog'
import { getPokemonSets } from '../api/pokemon'
import { getSetsForGame } from '../api/search'
import { readClues, matchScan, catalogIndex, printedName, fold, tagBonus, type ScanCandidate, type OcrLine, type ScanCard, type ScanCatalog, type ScanCatalogKey, type SlabLabel } from './scanMatch'
import { pictureSearch, pictureSimilarity, warmPictures, pictureManifest } from './picture'

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
  // How much the scan looks like this card's photo, by the trained picture AI (cosine similarity:
  // a right card ~0.5–0.9 on a real scan) — null when the phone sent no fingerprint or the card
  // isn't in the picture index yet (lib/scan/picture.ts, docs/scanner-ai.md)
  picture: number | null
  // Every printing the card comes in, with its price — the card sheet's Finish row. Pokémon:
  // "edition:finish" keys ("unlimited:reverse"); other games "normal" / "foil".
  printings: Array<{ key: string; label: string; price: number }>
  // The same card is also printed in the same set as a holo / non-holo with the same art: the
  // picture can't choose between them (decide.ts)
  holoTwin?: boolean
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
  cyberpunk: ['cyberpunk'],
}

type RawCard = ScanCard & { hidden?: boolean; imageUrl?: string; marketPrice?: number; marketPriceFoil?: number; variantPrices?: Record<string, number> }

async function scanCatalog(key: ScanCatalogKey): Promise<ScanCatalog & { cards: RawCard[] }> {
  const cards = await loadVisibleCatalog<RawCard>(key as CatalogKey)
  if (key === 'pokemon') {
    const sets = await getPokemonSets().catch(() => [])
    return { key, cards, sets: sets.map((s) => ({ id: s.id, name: s.name, total: s.total, ...(s.printedTotal && { printedTotal: s.printedTotal }) })) }
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
  const keys = catalogsFor(games)
  const [catalogs] = await Promise.all([loadCatalogsChecked(keys), warmPictures(keys)])
  for (const c of catalogs) catalogIndex(c)
}

/** The server can't answer a scan properly right now — the route answers 503 "busy" and the phone
 *  tries again, rather than guessing from a catalog that's missing cards */
export class ScannerUnavailable extends Error {}

// A loaded catalog must have at least this share of the cards its picture index holds (the index
// is every visible card with a photo, so a healthy catalog has as many or more)
const CATALOG_FLOOR = 0.8

/** The catalogs a scan is matched against, checked first: one that came back empty or far too
 *  small (a failed read on a cold server) is loaded again, and if it's still short the scan is
 *  refused. On 2026-11-13 servers that had lost the English Pokémon catalog answered clearly read
 *  Jigglypuff and Dark Vileplume scans with Japanese and Magic cards. */
async function loadCatalogsChecked(keys: ScanCatalogKey[]) {
  const manifest = await pictureManifest().catch(() => null)
  const short = (c: { key: ScanCatalogKey; cards: unknown[] }) =>
    c.cards.length < Math.max(1, Math.floor((manifest?.catalogs[c.key]?.count ?? 0) * CATALOG_FLOOR))
  let catalogs = await Promise.all(keys.map(scanCatalog))
  const bad = catalogs.filter(short)
  if (bad.length === 0) return catalogs
  console.warn(`Scanner: catalog too small, loading again — ${bad.map((c) => `${c.key} ${c.cards.length}`).join(', ')}`)
  for (const c of bad) invalidateCatalogCache(c.key as CatalogKey)
  catalogs = await Promise.all(keys.map(scanCatalog))
  const still = catalogs.filter(short)
  if (still.length) throw new ScannerUnavailable(`catalog too small: ${still.map((c) => `${c.key} ${c.cards.length}`).join(', ')}`)
  return catalogs
}

/** "Unown [B]" and "Unown" are the same printed name */
const baseName = (name: string) => fold(printedName(name))

// Cards the picture search brings in that the text didn't find: how many, and how alike they must
// be to be worth offering (a right card scores ~0.5–0.9 on a real scan; docs/scanner-ai.md)
const PICTURE_HITS = 8
const PICTURE_WAIT_MS = 3000
const PICTURE_HIT_MIN = 0.42

/** A graded slab's label, when the scan was of one — the review screen fills in the grade */
export type ScanSlab = Pick<SlabLabel, 'company' | 'grade' | 'cert'>

/** What the phone's barcode reader found (a graded slab's label: the cert, as a number or a link) */
export function cleanBarcodes(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((b): b is string => typeof b === 'string' && b.length > 0).slice(0, 6).map((b) => b.slice(0, 200)) : []
}

export async function matchScannedCard(lines: OcrLine[], games: Game[], fingerprints: Float32Array[] = [], barcodes: string[] = []): Promise<{ candidates: ScanMatch[]; slab: ScanSlab | null }> {
  const keys = catalogsFor(games)
  // A fresh server has no picture indexes yet: they load alongside the catalogs (which the scan
  // waits for anyway), plus a little longer — runs of scans used to go without the AI after every
  // new server (2026-11-13). Never more than PICTURE_WAIT_MS past the catalogs.
  const pictures = fingerprints.length ? warmPictures(keys) : null
  const catalogs = await loadCatalogsChecked(keys)
  if (pictures) await Promise.race([pictures, new Promise((r) => setTimeout(r, PICTURE_WAIT_MS))])
  let hits: ReturnType<typeof pictureSearch> = []
  try { hits = pictureSearch(fingerprints, keys, PICTURE_HITS) } catch { /* no picture search this time */ }
  const clues = readClues(lines, barcodes)
  const slab = clues.slab ? { company: clues.slab.company, grade: clues.slab.grade, cert: clues.slab.cert } : null
  const found = lines.length ? matchScan(clues, catalogs) : []
  // The picture's look-alikes the text didn't bring in (an old card with no number, a Japanese
  // name, glare over the code) — offered, never added without asking (exact: false)
  const have = new Set(found.map((c) => `${c.catalog}:${c.id}`))
  // A name read off the card that many printings share (24+ Unowns) brings in only some of them;
  // a picture find with that same name gets the name's text score — it's one of those cards, and
  // decide.ts's "name + clear picture" rule can then name it (a real Unown B scan, 2026-11-10)
  // (the name's score without its own card's letter bonus — "Unown [C]" read in the text must not
  // carry over to a picture find that's Unown [Z]: each gets its own, tagBonus)
  const nameScore = new Map<string, number>()
  for (const c of found) {
    const k = baseName(c.name), sc = c.score - tagBonus(c.name, clues)
    if (!c.exact && c.why.startsWith('name') && (nameScore.get(k) ?? -1) < sc) nameScore.set(k, sc)
  }
  for (const h of hits) {
    if (h.similarity < PICTURE_HIT_MIN || have.has(`${h.catalog}:${h.id}`)) continue
    const cat = catalogs.find((x) => x.key === h.catalog)
    const card = cat && (catalogIndex(cat).byId.get(h.id) as RawCard | undefined)
    if (!card) continue // hidden or gone from the catalog since it was fingerprinted
    const named = nameScore.get(baseName(card.name))
    found.push(named !== undefined
      ? { catalog: h.catalog, id: h.id, name: card.name, score: Math.max(0, Math.min(100, named + tagBonus(card.name, clues))), why: 'name + picture', exact: false }
      : { catalog: h.catalog, id: h.id, name: card.name, score: 0, why: 'picture', exact: false })
    have.add(`${h.catalog}:${h.id}`)
  }
  // Holo twins: one card printed as a holo and again as a non-holo with the same art in one set
  // (Jungle, Fossil, Team Rocket…) — the picture can't tell them apart, only the number can
  // (decide.ts). Marked when both are candidates: same name, same set, one "Holo" rarity, one not.
  const holoTwin = new Set<string>()
  {
    const groups = new Map<string, Array<{ key: string; holo: boolean }>>()
    for (const c of found) {
      const cat = catalogs.find((x) => x.key === c.catalog)
      const card = cat && (catalogIndex(cat).byId.get(c.id) as (RawCard & { rarity?: string }) | undefined)
      if (!card?.set) continue
      const g = `${c.catalog}|${card.set}|${baseName(c.name)}`
      groups.set(g, [...(groups.get(g) ?? []), { key: `${c.catalog}:${c.id}`, holo: /holo/i.test(String(card.rarity ?? '')) }])
    }
    for (const g of Array.from(groups.values())) if (g.some((x) => x.holo) && g.some((x) => !x.holo)) for (const x of g) holoTwin.add(x.key)
  }
  let sims: Array<number | null> = found.map(() => null)
  try { sims = pictureSimilarity(fingerprints, found.map((c) => ({ catalog: c.catalog, id: c.id }))) } catch { /* text only */ }
  return { slab, candidates: found.flatMap((c, i) => {
    const cat = catalogs.find((x) => x.key === c.catalog)
    const card = cat && (catalogIndex(cat).byId.get(c.id) as RawCard | undefined)
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
      picture: sims[i] === null ? null : Math.round(sims[i]! * 1000) / 1000,
      printings: printingsOf(card, c.catalog === 'pokemon-jp' ? 'pokemon' : c.catalog),
      ...(holoTwin.has(`${c.catalog}:${c.id}`) && { holoTwin: true }),
    }]
  }) }
}
