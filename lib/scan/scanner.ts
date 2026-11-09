// The site's side of the iPhone card scanner. The native screen (ios/App/App/CardScanner.swift)
// owns the camera: it finds each card, flattens it, reads its text and tells us. We match the
// text against the catalog (POST /api/cards/scan), ask the phone which candidate photo looks most
// like the card, decide (lib/scan/decide.ts) and show the answer in the phone's tray. When the
// person taps Done we get their final picks back — ScanReviewDialog adds them to the inventory.
//
// Matching lives here and on the server on purpose: improving it ships with a normal deploy, no
// new app build. Plan and research: CardScanner.md.

import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import type { Game } from '../types'
import { cardImage } from '../cardImage'
import { formatCurrency } from '../utils'
import { decide, type ScanStatus } from './decide'
import type { OcrLine } from './scanMatch'
import type { ScanMatch } from './server'

interface TrayOption {
  title: string
  subtitle: string
  price: string
  imageUrl: string
}

interface CardScannerPlugin {
  open(opts: { title: string }): Promise<{ items: Array<{ scanId: string; choice: number; confirmed?: boolean }> }>
  compare(opts: { scanId: string; imageUrls: string[] }): Promise<{ distances: Array<number | null> }>
  update(opts: { scanId: string; status: ScanStatus | 'error'; options: TrayOption[]; choice: number; note?: string }): Promise<void>
  addListener(event: 'cardScanned', fn: (e: { scanId: string; lines: OcrLine[] }) => void): Promise<PluginListenerHandle>
}

const CardScanner = registerPlugin<CardScannerPlugin>('CardScanner')

export interface ScannedCard {
  scanId: string
  options: ScanMatch[]   // best first
  choice: number         // which option the person kept
  status: ScanStatus
}

// How many look-alikes the phone compares by picture — small thumbnails (~10 KB each); the
// comparison itself works on a 40 × 56 grid, so a thumbnail is plenty
const MAX_COMPARE = 40

function trayOption(m: ScanMatch): TrayOption {
  const row = m.rows[0]
  const price = row.marketPrice > 0 ? row.marketPrice : row.marketPriceFoil
  return {
    title: m.name,
    subtitle: [row.setName, row.number ? `#${row.number}` : '', m.language === 'ja' ? 'Japanese' : ''].filter(Boolean).join(' · '),
    price: price > 0 ? formatCurrency(price) : '',
    imageUrl: cardImage(row.imageUrl, 'grid') ?? row.imageUrl,
  }
}

async function identify(scanId: string, lines: OcrLine[], games: Game[]): Promise<ScannedCard> {
  const res = await fetch('/api/cards/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lines, games }),
  })
  if (!res.ok) throw new Error(`scan match ${res.status}`)
  const { candidates } = (await res.json()) as { candidates: ScanMatch[] }

  // Only the candidates still in the running get compared by picture
  const best = candidates[0]?.score ?? 0
  const close = candidates.filter((c) => c.score >= best - 20).slice(0, MAX_COMPARE)
  let distances: Array<number | null> | undefined
  if (close.length > 0) {
    try {
      const urls = close.map((c) => cardImage(c.rows[0].imageUrl, 'thumb') ?? c.rows[0].imageUrl)
      distances = (await CardScanner.compare({ scanId, imageUrls: urls })).distances
    } catch {
      distances = undefined // no picture check — the text decides, and ties become a pick
    }
  }
  const { ranked, status } = decide(close, distances)
  const rest = candidates.filter((c) => !close.includes(c))
  return { scanId, options: [...ranked.map(({ final: _f, distance: _d, ...m }) => m as ScanMatch), ...rest], choice: 0, status }
}

/** Opens the native scanner; resolves with what the person kept when they tap Done (empty if they
 *  closed it). Only call inside the app (lib/nativeApp.ts inApp()). */
export async function scanCards(games: Game[]): Promise<ScannedCard[]> {
  const found = new Map<string, ScannedCard>()
  const listener = await CardScanner.addListener('cardScanned', ({ scanId, lines }) => {
    identify(scanId, lines, games)
      .then((card) => {
        found.set(scanId, card)
        return CardScanner.update({
          scanId,
          status: card.status,
          options: card.options.map(trayOption),
          choice: 0,
          note: card.status === 'none' ? 'Not found — try again, flatter and out of the glare' : undefined,
        })
      })
      .catch(() => CardScanner.update({ scanId, status: 'error', options: [], choice: 0, note: 'Couldn’t reach TCGHaven — check your connection' }).catch(() => {}))
  })
  try {
    const { items } = await CardScanner.open({ title: 'Scan cards' })
    return items.flatMap(({ scanId, choice, confirmed }) => {
      const card = found.get(scanId)
      if (!card || card.options.length === 0) return []
      // Picked by hand in the tray → no need to ask again
      const status: ScanStatus = confirmed ? 'matched' : card.status
      return [{ ...card, status, choice: Math.max(0, Math.min(card.options.length - 1, choice)) }]
    })
  } finally {
    await listener.remove()
  }
}
