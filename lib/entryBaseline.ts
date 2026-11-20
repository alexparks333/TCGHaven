import { conditionPrice } from './pricing'
import type { Card } from './types'
import type { PriceBaseline } from './store'
import type { GradedSource } from './api/gradedPrices'

/** A copy's "since added" price — what its gain is measured from (Portfolio's P&L, Top Performers,
 *  the value-over-time charts). Null = not known: no gain is shown rather than a fake one.
 *  - A slab valued at PriceCharting's graded price: its graded price on the day it was logged
 *    (baselines.first, lib/api/priceHistory.ts loadBaselines), else what was paid if anything was
 *    entered. Its saved priceAtEntry is TCGplayer's ungraded price, and an empty purchase price is
 *    $0 — measured from either, the whole slab looked like gain (2026-11-20).
 *  - Anything else: the market price saved when it was added (discounted for its condition), else
 *    the earliest shared-history price, else what was paid. */
export function entryBaseline(
  card: Pick<Card, 'id' | 'purchasePrice' | 'priceAtEntry' | 'condition' | 'gradingCompany'>,
  baselines: Record<string, PriceBaseline>,
  graded: Record<string, GradedSource>,
): number | null {
  if (graded[card.id]) return baselines[card.id]?.first ?? (card.purchasePrice > 0 ? card.purchasePrice : null)
  if (card.priceAtEntry != null) return conditionPrice(card.priceAtEntry, card)
  return baselines[card.id]?.first ?? card.purchasePrice
}
