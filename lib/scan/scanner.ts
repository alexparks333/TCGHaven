// The site's side of the iPhone card scanner. The native screen (ios/App/App/CardScanner.swift)
// owns the camera: it finds each card, flattens it, reads its text and tells us. We match the
// text against the catalog (POST /api/cards/scan), ask the phone which candidate photo looks most
// like the card, decide (lib/scan/decide.ts) and show the answer in the phone's tray. When the
// person taps Add we get their picks back — ScanReviewDialog adds them to the inventory.
//
// Matching lives here and on the server on purpose: improving it ships with a normal deploy, no
// new app build. Plan and research: CardScanner.md.

import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import type { Game } from '../types'
import { cardImage } from '../cardImage'
import { formatCurrency } from '../utils'
import { decide, type ScanStatus } from './decide'
import type { OcrLine } from './scanMatch'
import type { ScanMatch, ScanSlab } from './server'
import type { CardSearchResult } from '../api/search'

interface TrayOption {
  key: string      // "catalog:id" — how a pick comes back
  title: string
  subtitle: string
  price: string
  imageUrl: string
  detail: string   // why it matched — kept with the scan in test builds (CardScanner.md "Debug scans")
}

interface CardScannerPlugin {
  open(opts: { title: string }): Promise<{ items: Array<{ scanId: string; choice: number; confirmed?: boolean; key?: string }> }>
  searchResults(opts: { requestId: string; options: TrayOption[] }): Promise<void>
  compare(opts: { scanId: string; imageUrls: string[] }): Promise<{ distances: Array<number | null> }>
  update(opts: { scanId: string; status: ScanStatus | 'error'; options: TrayOption[]; choice: number; note?: string }): Promise<void>
  addListener(event: 'cardScanned', fn: (e: { scanId: string; lines: OcrLine[] }) => void): Promise<PluginListenerHandle>
  addListener(event: 'searchCards', fn: (e: { requestId: string; query: string }) => void): Promise<PluginListenerHandle>
}

const CardScanner = registerPlugin<CardScannerPlugin>('CardScanner')

export interface ScannedCard {
  scanId: string
  options: ScanMatch[]   // best first
  choice: number         // which option the person kept
  status: ScanStatus
  slab: ScanSlab | null  // a graded slab: its company, grade and cert, read off the label
}

// How many look-alikes the phone compares by picture — small thumbnails (~10 KB each); the
// comparison itself works on a 40 × 56 grid, so a thumbnail is plenty
const MAX_COMPARE = 40
const MATCH_TIMEOUT_MS = 12000

function trayOption(m: ScanMatch & { final?: number; distance?: number | null }, slab: ScanSlab | null): TrayOption {
  return {
    key: m.key,
    title: m.name,
    subtitle: [m.setName, m.number ? `#${m.number}` : '', m.language === 'ja' ? 'Japanese' : '', slab?.grade ? `${slab.company} ${slab.grade}` : ''].filter(Boolean).join(' · '),
    price: m.price > 0 ? formatCurrency(m.price) : '',
    imageUrl: cardImage(m.imageUrl, 'grid') ?? m.imageUrl,
    detail: `text ${m.score}${m.final !== undefined ? ` → ${m.final}` : ''}${typeof m.distance === 'number' ? ` · picture ${m.distance.toFixed(3)}` : ''} · ${m.why}${m.exact ? '' : ' · name only'}`,
  }
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
          price: r.marketPrice > 0 ? r.marketPrice : r.marketPriceFoil, score: 0, why: 'searched', exact: true,
        }]
      }).slice(0, 8)
    })
  }))
  // Best of each game first, then the rest
  const out: ScanMatch[] = []
  for (let i = 0; i < 8; i++) for (const list of perGame) if (list[i]) out.push(list[i])
  return out.slice(0, 24)
}

async function fetchCandidates(lines: OcrLine[], games: Game[]): Promise<{ candidates: ScanMatch[]; slab: ScanSlab | null }> {
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), MATCH_TIMEOUT_MS)
    try {
      const res = await fetch('/api/cards/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lines, games }),
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

async function identify(scanId: string, lines: OcrLine[], games: Game[]): Promise<{ card: ScannedCard; tray: TrayOption[] }> {
  const { candidates, slab } = await fetchCandidates(lines, games)

  // Only the candidates still in the running get compared by picture
  const best = candidates[0]?.score ?? 0
  const close = candidates.filter((c) => c.score >= best - 20).slice(0, MAX_COMPARE)
  let distances: Array<number | null> | undefined
  if (close.length > 0) {
    try {
      const urls = close.map((c) => cardImage(c.imageUrl, 'thumb') ?? c.imageUrl)
      distances = (await CardScanner.compare({ scanId, imageUrls: urls })).distances
    } catch {
      distances = undefined // no picture check — the text decides, and ties become a pick
    }
  }
  const { ranked, status } = decide(close, distances)
  const rest = candidates.filter((c) => !close.includes(c))
  const ordered: Array<ScanMatch & { final?: number; distance?: number | null }> = [...ranked, ...rest]
  return {
    card: { scanId, options: ordered.map(({ final: _f, distance: _d, ...m }) => m), choice: 0, status, slab },
    tray: ordered.map((m) => trayOption(m, slab)),
  }
}

/** Opens the native scanner; resolves with what the person kept when they tap Add (empty if they
 *  closed it). Only call inside the app (lib/nativeApp.ts inApp()). */
export async function scanCards(games: Game[]): Promise<ScannedCard[]> {
  // Wake the server and load the catalogs while the camera starts
  fetch(`/api/cards/scan?warm=1&games=${games.join(',')}`).catch(() => {})

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
  const listener = await CardScanner.addListener('cardScanned', ({ scanId, lines }) => {
    identify(scanId, lines, games)
      .then(({ card, tray }) => {
        found.set(scanId, card)
        return CardScanner.update({
          scanId,
          status: card.status,
          options: tray,
          choice: 0,
          note: card.status === 'none' ? 'Not found — try again, flatter and out of the glare' : undefined,
        })
      })
      .catch(() => CardScanner.update({ scanId, status: 'error', options: [], choice: 0, note: 'Couldn’t reach TCGHaven — check your connection' }).catch(() => {}))
  })
  try {
    const { items } = await CardScanner.open({ title: 'Scan cards' })
    return items.flatMap(({ scanId, choice, confirmed, key }) => {
      const card = found.get(scanId) ?? { scanId, options: [], choice: 0, status: 'none' as ScanStatus, slab: null }
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
