// The site's side of the iPhone card scanner. The native screen (ios/App/App/CardScanner.swift)
// owns the camera: it finds each card, flattens it, reads its text and tells us. We match the
// text — and the picture AI's fingerprint of the card (docs/scanner-ai.md) — against the catalog
// (POST /api/cards/scan), ask the phone which candidate photo looks most like the card, decide
// (lib/scan/decide.ts) and show the answer in the phone's tray. When the
// person taps Add we get their picks back — ScanReviewDialog adds them to the inventory.
//
// Matching lives here and on the server on purpose: improving it ships with a normal deploy, no
// new app build. Plan and research: docs/card-scanner.md.

import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { CONDITION_LABELS, type Condition, type Game } from '../types'
import { cardImage } from '../cardImage'
import { formatCurrency } from '../utils'
import { decide, AI_OFFER, type ScanStatus } from './decide'
import type { OcrLine } from './scanMatch'
import type { ScanMatch, ScanSlab } from './server'
import type { CardSearchResult } from '../api/search'

interface TrayOption {
  key: string      // "catalog:id" — how a pick comes back
  title: string
  subtitle: string
  price: string
  imageUrl: string
  detail: string   // why it matched — kept with the scan in test builds (docs/card-scanner.md "Debug scans")
  printings: Array<{ key: string; label: string; price: string }>  // the card sheet's Finish row
}

interface CardScannerPlugin {
  open(opts: { title: string }): Promise<{ items: Array<{ scanId: string; choice: number; confirmed?: boolean; key?: string; slab?: ScanSlab | null; printing?: string; condition?: string }> }>
  searchResults(opts: { requestId: string; options: TrayOption[] }): Promise<void>
  compare(opts: { scanId: string; imageUrls: string[] }): Promise<{ distances: Array<number | null> }>
  update(opts: { scanId: string; status: ScanStatus | 'error' | 'reject'; options: TrayOption[]; choice: number; note?: string; slab?: ScanSlab | null }): Promise<void>
  // The picture AI model to have ready (downloaded once per version, then kept on the phone).
  // Older app builds don't have it — calling it there fails harmlessly.
  prepareModel(opts: { version: string; files: Record<string, string> }): Promise<{ ready: boolean }>
  // fingerprints: the picture AI's numbers for the scan (one per way up for a landscape card);
  // absent until the model is ready, and on older app builds
  // barcodes: a graded slab label's barcode / QR code (its cert number) — newer app builds
  addListener(event: 'cardScanned', fn: (e: { scanId: string; lines: OcrLine[]; fingerprints?: number[][]; barcodes?: string[] }) => void): Promise<PluginListenerHandle>
  addListener(event: 'searchCards', fn: (e: { requestId: string; query: string }) => void): Promise<PluginListenerHandle>
}

const CardScanner = registerPlugin<CardScannerPlugin>('CardScanner')

export interface ScannedCard {
  scanId: string
  options: ScanMatch[]   // best first
  choice: number         // which option the person kept
  status: ScanStatus
  slab: ScanSlab | null  // a graded slab: its company, grade and cert, read off the label
  printing?: string      // the finish picked in the card sheet ("unlimited:reverse", "foil")
  condition?: Condition  // picked in the card sheet (absent = Near Mint)
}

// How many look-alikes the phone compares by picture — small thumbnails (~10 KB each); the
// comparison itself works on a 40 × 56 grid, so a thumbnail is plenty
const MAX_COMPARE = 40
const MATCH_TIMEOUT_MS = 12000
// A picture-only find shown in the tray (asked about, never added): this alike or more
const PICTURE_SHOWS = 0.55

function trayOption(m: ScanMatch & { final?: number; distance?: number | null }, slab: ScanSlab | null): TrayOption {
  const ai = typeof m.picture === 'number' ? ` · AI ${m.picture.toFixed(2)}` : ''
  return {
    key: m.key,
    title: m.name,
    subtitle: [m.setName, m.number ? `#${m.number}` : '', m.language === 'ja' ? 'Japanese' : '', slab?.grade ? `${slab.company} ${slab.grade}` : ''].filter(Boolean).join(' · '),
    price: m.price > 0 ? formatCurrency(m.price) : '',
    imageUrl: cardImage(m.imageUrl, 'grid') ?? m.imageUrl,
    printings: (m.printings ?? []).map((p) => ({ key: p.key, label: p.label, price: p.price > 0 ? formatCurrency(p.price) : '' })),
    detail: `text ${m.score}${m.final !== undefined ? ` → ${m.final}` : ''}${typeof m.distance === 'number' ? ` · picture ${m.distance.toFixed(3)}` : ''}${ai} · ${m.why}${m.exact || m.why === 'picture' ? '' : ' · name only'}`,
  }
}

/** A printing key ("1st:normal", "unlimited:reverse") as shown in the card sheet's Finish row */
function printingLabel(key: string, game: Game): string {
  const [edition, finish] = key.split(':')
  const ed: Record<string, string> = { unlimited: '', shadowless: 'Shadowless', '1st': '1st Edition', limited: 'Limited Edition' }
  const fin: Record<string, string> = { normal: 'Normal', holofoil: 'Holo', reverse: 'Reverse Holo', rainbow: 'Rainbow Foil', cold: 'Cold Foil' }
  // Yu-Gi-Oh! has editions only — its foil is the rarity
  if (game === 'yugioh') return edition === 'unlimited' ? 'Unlimited' : ed[edition] ?? edition
  return [ed[edition] ?? edition, fin[finish] ?? finish].filter(Boolean).join(' ')
}

// The card sheet's "Search for another card": Add Card's own search, in every game being scanned
async function searchCatalog(query: string, games: Game[]): Promise<ScanMatch[]> {
  const perGame = await Promise.all(games.flatMap((game) => {
    const langs: Array<'ja' | undefined> = game === 'pokemon' ? [undefined, 'ja'] : [undefined]
    return langs.map(async (lang) => {
      const params = new URLSearchParams({ game, q: query })
      if (lang) params.set('lang', lang)
      const res = await fetch(`/api/cards/search?${params}`).catch(() => null)
      const rows = res?.ok ? ((await res.json()) as CardSearchResult[]) : []
      const seen = new Set<string>()
      return rows.flatMap((r): ScanMatch[] => {
        if (seen.has(r.id)) return []
        seen.add(r.id)
        const catalog = lang === 'ja' ? 'pokemon-jp' : game
        return [{
          key: `${catalog}:${r.id}`, game, ...(lang && { language: lang }), id: r.id,
          name: r.name.replace(/ ✦ (Foil|Holo)$/, ''), setName: r.setName, number: r.number, imageUrl: r.imageUrl,
          price: r.marketPrice > 0 ? r.marketPrice : r.marketPriceFoil, score: 0, why: 'searched', exact: true, picture: null,
          printings: r.variantPrices && Object.keys(r.variantPrices).length
            ? Object.entries(r.variantPrices).map(([k, v]) => ({ key: k, label: printingLabel(k, game), price: v }))
            : [],
        }]
      }).slice(0, 8)
    })
  }))
  // Best of each game first, then the rest
  const out: ScanMatch[] = []
  for (let i = 0; i < 8; i++) for (const list of perGame) if (list[i]) out.push(list[i])
  return out.slice(0, 24)
}

async function fetchCandidates(lines: OcrLine[], games: Game[], fingerprints?: number[][], barcodes?: string[]): Promise<{ candidates: ScanMatch[]; slab: ScanSlab | null }> {
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), MATCH_TIMEOUT_MS)
    try {
      const res = await fetch('/api/cards/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lines, games, ...(fingerprints?.length && { fingerprints }), ...(barcodes?.length && { barcodes }) }),
        signal: ctrl.signal,
      })
      if (!res.ok) throw new Error(`scan match ${res.status}`)
      return (await res.json()) as { candidates: ScanMatch[]; slab: ScanSlab | null }
    } catch (err) {
      if (attempt >= 1) throw err   // one retry — a dropped connection on a phone is common
    } finally {
      clearTimeout(timer)
    }
  }
}

async function identify(scanId: string, lines: OcrLine[], games: Game[], fingerprints?: number[][], barcodes?: string[]): Promise<{ card: ScannedCard; tray: TrayOption[]; topDistance: number | null; topPicture: number | null }> {
  const { candidates, slab } = await fetchCandidates(lines, games, fingerprints, barcodes)

  // Only the candidates still in the running get compared by picture — plus the picture AI's own
  // finds (cards the text didn't bring in)
  const best = Math.max(0, ...candidates.filter((c) => c.why !== 'picture').map((c) => c.score))
  // (the picture's finds first: a name shared by 40+ printings must not push them out)
  const fromPicture = candidates.filter((c) => c.why.endsWith('picture') && (c.picture ?? 0) >= AI_OFFER)
  const close = [...fromPicture, ...candidates.filter((c) => !fromPicture.includes(c) && c.why !== 'picture' && c.score >= best - 20)].slice(0, MAX_COMPARE)
  let distances: Array<number | null> | undefined
  // The picture AI already compared every one of them → skip the slower photo-by-photo check
  // (it downloads each candidate's thumbnail)
  const aiCoversAll = close.length > 0 && close.every((c) => typeof c.picture === 'number')
  if (close.length > 0 && !aiCoversAll) {
    try {
      const urls = close.map((c) => cardImage(c.imageUrl, 'thumb') ?? c.imageUrl)
      distances = (await CardScanner.compare({ scanId, imageUrls: urls })).distances
    } catch {
      distances = undefined // no picture check — the text decides, and ties become a pick
    }
  }
  const { ranked, status } = decide(close.map((c) => ({ ...c, trusted: c.why.includes(' label ') })), distances, close.map((c) => c.picture))
  const rest = candidates.filter((c) => !close.includes(c))
  const ordered: Array<ScanMatch & { final?: number; distance?: number | null }> = [...ranked, ...rest]
  return {
    card: { scanId, options: ordered.map(({ final: _f, distance: _d, ...m }) => m), choice: 0, status, slab },
    tray: ordered.map((m) => trayOption(m, slab)),
    topDistance: ranked[0]?.distance ?? null,
    topPicture: ranked[0]?.similarity ?? null,
  }
}

/** Opens the native scanner; resolves with what the person kept when they tap Add (empty if they
 *  closed it). Only call inside the app (lib/nativeApp.ts inApp()). */
export async function scanCards(games: Game[]): Promise<ScannedCard[]> {
  // Wake the server and load the catalogs while the camera starts
  fetch(`/api/cards/scan?warm=1&games=${games.join(',')}`).catch(() => {})
  // The picture AI: the phone downloads the current model once (~41 MB, then only when it changes)
  // and fingerprints every scan with it from then on
  fetch(`/api/cards/scan?model=1&platform=${Capacitor.getPlatform() === 'android' ? 'android' : 'ios'}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((r: { model?: { version: string; files: Record<string, string> } | null } | null) => (r?.model ? CardScanner.prepareModel(r.model) : null))
    .catch(() => {})

  const found = new Map<string, ScannedCard>()
  const searched = new Map<string, ScanMatch>()
  const searchListener = await CardScanner.addListener('searchCards', ({ requestId, query }) => {
    searchCatalog(query, games)
      .then((matches) => {
        for (const m of matches) searched.set(m.key, m)
        return CardScanner.searchResults({ requestId, options: matches.map((m) => trayOption(m, null)) })
      })
      .catch(() => CardScanner.searchResults({ requestId, options: [] }).catch(() => {}))
  })
  const listener = await CardScanner.addListener('cardScanned', ({ scanId, lines, fingerprints, barcodes }) => {
    identify(scanId, lines, games, fingerprints, barcodes)
      .then(({ card, tray, topDistance, topPicture }) => {
        found.set(scanId, card)
        // Not sure enough to show: nothing found, or only a loose guess (a word on a screen that
        // happens to be a card name) — the tray drops it and asks for another scan
        const top = card.options[0]
        // …unless the picture clearly says which card it is and only the version is in doubt
        // (Aquapolis Mr. Mime #95 / #95a / #95b): then it's a question, with the versions to pick
        // (or the picture AI found it with no text to go on — an old card, a worn number)
        const pictured = (topDistance !== null && topDistance <= 0.3) || (topPicture !== null && topPicture >= PICTURE_SHOWS)
        const loose = !top || card.status === 'none' || (card.status === 'pick' && (!top.exact || top.score < 55) && !pictured)
        return CardScanner.update({
          scanId,
          status: loose ? 'reject' : card.status,
          options: tray,
          choice: 0,
          note: card.status === 'none' ? 'Not found — try again, flatter and out of the glare' : undefined,
          // a graded slab: the tray and card sheet draw the card in its slab, grade showing
          slab: card.slab?.grade ? card.slab : null,
        })
      })
      .catch(() => CardScanner.update({ scanId, status: 'error', options: [], choice: 0, note: 'Couldn’t reach TCGHaven — check your connection' }).catch(() => {}))
  })
  try {
    const { items } = await CardScanner.open({ title: 'Scan cards' })
    return items.flatMap(({ scanId, choice, confirmed, key, slab, printing, condition }) => {
      const found0 = found.get(scanId) ?? { scanId, options: [], choice: 0, status: 'none' as ScanStatus, slab: null }
      const picked = condition && condition in CONDITION_LABELS ? { condition: condition as Condition } : {}
      const scanned = { ...found0, ...(printing && { printing }), ...picked }
      // The grading as the person left it in the card sheet (they can change or clear what was read)
      const card = slab !== undefined ? { ...scanned, slab: slab?.grade ? slab : null } : scanned
      // Picked by hand in the tray (one of the matches, or a card found with Search) → no need to ask again
      const status: ScanStatus = confirmed ? 'matched' : card.status
      const i = key ? card.options.findIndex((o) => o.key === key) : -1
      if (i >= 0) return [{ ...card, status, choice: i }]
      const extra = key ? searched.get(key) : undefined
      if (extra) return [{ ...card, status: 'matched' as ScanStatus, options: [extra, ...card.options], choice: 0 }]
      if (card.options.length === 0) return []
      return [{ ...card, status, choice: Math.max(0, Math.min(card.options.length - 1, choice)) }]
    })
  } finally {
    await listener.remove()
    await searchListener.remove()
  }
}
