'use client'

import { useEffect, useMemo, useState } from 'react'
import { authFetch } from '@/lib/firebase/authFetch'
import type { Card } from '@/lib/types'
import { usePremiumAccess } from '@/components/premium/PremiumProvider'

/** The collection's value on each past day — for Portfolio Analytics and the Portfolio's
 *  "Over time" chart, so the two can never disagree. Summed on the server from the shared price
 *  history (app/api/price-history, mode "portfolio"): only one number per day is downloaded. Each
 *  copy is valued the way it is today (one copy, one price): a graded-priced slab by its graded
 *  history, a raw copy discounted for its condition. Cards without a catalog match count at their
 *  own price every day (`fixedValue`, add it to each day). `enabled: false` loads nothing (a chart
 *  that isn't showing). `ready` = the days answer the cards passed in now. */
export function usePortfolioTimeline(cards: Card[], enabled = true): {
  dailyValues: { day: string; value: number }[]
  fixedValue: number
  ready: boolean
  /** Haven Premium: the value over time is a Premium feature (nothing is loaded) */
  locked: boolean
} {
  const locked = !usePremiumAccess().unlocked
  const catalogCards = useMemo(() => cards.filter((c) => c.apiId), [cards])
  const fixedValue = useMemo(
    () => cards.filter((c) => !c.apiId).reduce((s, c) => s + (c.currentPrice ?? c.purchasePrice) * c.quantity, 0),
    [cards],
  )
  // Everything that changes a card's price history — a new key reloads it
  const requestKey = catalogCards
    .map((c) => `${c.id}:${c.quantity}:${c.isFoil ? 1 : 0}:${c.gradingCompany ?? ''}${c.grade ?? ''}${c.gradeTier ?? ''}:${c.condition ?? ''}`)
    .join('|')
  const [loaded, setLoaded] = useState<{ key: string | null; days: { day: string; value: number }[] }>({ key: null, days: [] })

  useEffect(() => {
    if (!enabled || locked) return
    let stale = false
    if (catalogCards.length === 0) { setLoaded({ key: requestKey, days: [] }); return }
    authFetch('/api/price-history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'portfolio',
        days: 730,
        items: catalogCards.map((c) => ({
          key: c.id, game: c.game, apiId: c.apiId, isFoil: c.isFoil, edition: c.edition, finish: c.finish, language: c.language,
          gradingCompany: c.gradingCompany, grade: c.grade, gradeTier: c.gradeTier ?? undefined, // a graded-priced slab's days are its graded prices
          condition: c.condition, // a raw copy's days are discounted for its condition
          qty: c.quantity, fallback: c.currentPrice ?? c.purchasePrice,
        })),
      }),
    })
      .then((r) => (r.ok ? r.json() : { timeline: [] }))
      .then((data: { timeline?: { day: string; value: number }[] }) => { if (!stale) setLoaded({ key: requestKey, days: data.timeline ?? [] }) })
      .catch(() => { if (!stale) setLoaded({ key: requestKey, days: [] }) })
    return () => { stale = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, enabled, locked])

  const ready = loaded.key === requestKey
  return { dailyValues: ready ? loaded.days : [], fixedValue, ready: ready || locked, locked }
}
