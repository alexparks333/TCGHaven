'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useAuth } from '@/components/auth/AuthProvider'
import { useStore } from '@/lib/store'
import { applyPriceUpdatesBatch } from '@/lib/firebase/db'
import { loadPriceStatus } from '@/lib/api/priceStatus'
import type { Card, Game } from '@/lib/types'

// Keeps every user's card prices in step with the shared catalog — there's no manual "Refresh
// Prices" anymore, so everyone sees the same prices on the same schedule (the catalog itself is
// refreshed 4x a day by the scheduled sync; see lib/api/priceStatus.ts).
//
// Mounted once in ClientWrapper (renders nothing). After sign-in, then every CHECK_EVERY_MS and
// whenever the tab comes back into view, it reads the price-update status (cheap: two tiny docs
// per tracked game). If the catalog has synced since this user's cards were last priced — or
// they switched 30d avg / Lowest NM — it copies the catalog prices onto their cards.
//
// Writes are kept small: a card is only written if its price actually changed, or if it has no
// price-history point yet today (one point per card per day, so period P&L and charts keep
// working exactly as they did with a once-a-day manual refresh).

const CHECK_EVERY_MS = 15 * 60 * 1000
const ALL_GAMES: Game[] = ['pokemon', 'lorcana', 'riftbound', 'onepiece', 'mtg']

// Per-game batch price endpoints — in-memory catalog lookups server-side, no live external fetch.
const PRICE_ROUTES: Record<Game, { url: string; payload: (c: Card) => object }> = {
  pokemon:   { url: '/api/prices/pokemon',   payload: (c) => ({ id: c.id, apiId: c.apiId, isFoil: c.isFoil }) },
  lorcana:   { url: '/api/prices/lorcana',   payload: (c) => ({ id: c.id, apiId: c.apiId, isFoil: c.isFoil }) },
  riftbound: { url: '/api/prices/riftbound', payload: (c) => ({ id: c.id, apiId: c.apiId, isFoil: c.isFoil }) },
  // No isFoil — a One Piece "Parallel" print is its own catalog id, not a foil toggle of the
  // base card (see app/api/prices/onepiece/route.ts).
  onepiece:  { url: '/api/prices/onepiece',  payload: (c) => ({ id: c.id, apiId: c.apiId }) },
  mtg:       { url: '/api/prices/mtg',       payload: (c) => ({ id: c.id, apiId: c.apiId, isFoil: c.isFoil }) },
}

export function PriceAutoUpdater() {
  const { user, dataLoading } = useAuth()
  const { cards, priceHistory, priceMode, trackedGames, lastPriceRefresh, setLastPriceRefresh, setPriceStatus, applyPriceUpdates } = useStore()

  // Latest values for the timer/visibility callbacks without re-subscribing them every render.
  const latest = useRef({ cards, priceHistory, priceMode, trackedGames, lastPriceRefresh })
  latest.current = { cards, priceHistory, priceMode, trackedGames, lastPriceRefresh }
  const running = useRef(false)
  const appliedMode = useRef<string | null>(null)

  const check = useCallback(async () => {
    if (!user || running.current) return
    running.current = true
    try {
      const { cards, priceHistory, priceMode, trackedGames, lastPriceRefresh } = latest.current
      const status = await loadPriceStatus(trackedGames)
      setPriceStatus(status)
      if (!status.latestSyncAt) return

      const modeChanged = appliedMode.current !== null && appliedMode.current !== priceMode
      const freshCatalog = !lastPriceRefresh || status.latestSyncAt.getTime() > new Date(lastPriceRefresh).getTime()
      if (!freshCatalog && !modeChanged && appliedMode.current !== null) return

      const now = new Date().toISOString()
      const today = now.slice(0, 10)
      const cardsById = new Map(cards.map((c) => [c.id, c]))
      const hasPointToday = new Set(
        priceHistory.filter((h) => h.points.some((p) => p.date.slice(0, 10) === today)).map((h) => h.cardId),
      )
      const updates: { cardId: string; price: number; date: string }[] = []
      let fetchFailed = false

      await Promise.all(ALL_GAMES.map(async (game) => {
        const eligible = cards.filter((c) => c.game === game && c.apiId && !c.priceLocked)
        if (eligible.length === 0) return
        const { url, payload } = PRICE_ROUTES[game]
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cards: eligible.map(payload), priceMode }),
          })
          if (!res.ok) { fetchFailed = true; return }
          const prices: Record<string, number> = await res.json()
          for (const [cardId, price] of Object.entries(prices)) {
            const card = cardsById.get(cardId)
            const changed = !card || Math.abs((card.currentPrice ?? -1) - price) >= 0.005
            if (changed || !hasPointToday.has(cardId)) updates.push({ cardId, price, date: now })
          }
        } catch {
          fetchFailed = true
        }
      }))

      if (updates.length > 0) {
        // History as loaded at sign-in (captured before applyPriceUpdates adds today's points),
        // so the batch write doesn't need to read every history doc back first.
        const knownPoints = new Map(priceHistory.map((h) => [h.cardId, h.points]))
        applyPriceUpdates(updates)
        await applyPriceUpdatesBatch(user.uid, updates, knownPoints)
      }
      // Only mark this sync as applied if every game's prices came back — otherwise the next
      // check retries instead of silently leaving some cards on old prices.
      if (!fetchFailed) {
        setLastPriceRefresh(status.latestSyncAt.toISOString())
        appliedMode.current = priceMode
      }
    } catch (err) {
      console.error('Automatic price update failed:', err)
    } finally {
      running.current = false
    }
  }, [user, setPriceStatus, applyPriceUpdates, setLastPriceRefresh])

  // After sign-in + data load, on tracked-games / price-mode changes, on a timer, and on focus.
  useEffect(() => {
    if (!user || dataLoading) return
    check()
    const timer = setInterval(check, CHECK_EVERY_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [user, dataLoading, check, trackedGames, priceMode])

  // A different user signing in on this device must get their own first apply.
  useEffect(() => { appliedMode.current = null }, [user?.uid])

  return null
}
