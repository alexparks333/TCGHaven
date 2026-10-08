'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useAuth } from '@/components/auth/AuthProvider'
import { useStore } from '@/lib/store'
import { authFetch } from '@/lib/firebase/authFetch'
import { loadPriceStatus } from '@/lib/api/priceStatus'
import type { Card, Game } from '@/lib/types'

// Prices live ONLY in the shared catalog (refreshed 4x a day by the scheduled sync) — nothing is
// ever copied onto a user's own cards anymore. This (mounted once in ClientWrapper, renders
// nothing) just reads:
//
//  1. Live prices for the user's cards, from app/api/prices/* — in-memory catalog lookups on the
//     server, so zero Firestore reads — laid over each card in memory (store.applyLivePrices).
//  2. Each card's price at the start of each Portfolio window (24h/7d/30d/365d ago), from the
//     shared price history via app/api/price-history ("baselines").
//  3. The shared price-update status for Portfolio's "Prices updated …" line.
//
// It reloads when the catalog has synced since the last load, when the set of owned cards
// changes, every CHECK_EVERY_MS, and when the tab comes back.

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
  const { cards, trackedGames, setLastPriceRefresh, setPriceStatus, applyLivePrices, setPriceBaselines, setPriceLoad } = useStore()

  // Latest values for the timer/visibility callbacks without re-subscribing every render.
  const latest = useRef({ cards, trackedGames })
  latest.current = { cards, trackedGames }
  const running = useRef(false)
  // What the last successful load was based on — reload only when one of these changes.
  const loadedFor = useRef<{ syncAt: number; cardsKey: string } | null>(null)

  // Only cards priced from the catalog take part; manual prices / unmatched cards keep their own.
  const cardsKey = cards.filter((c) => c.apiId && !c.priceLocked).map((c) => `${c.id}:${c.apiId}:${c.isFoil ? 1 : 0}`).sort().join('|')

  const check = useCallback(async () => {
    if (!user || running.current) return
    running.current = true
    try {
      const { cards, trackedGames } = latest.current
      const status = await loadPriceStatus(trackedGames)
      setPriceStatus(status)

      const syncAt = status.latestSyncAt?.getTime() ?? 0
      const eligible = cards.filter((c) => c.apiId && !c.priceLocked)
      const key = eligible.map((c) => `${c.id}:${c.apiId}:${c.isFoil ? 1 : 0}`).sort().join('|')
      const prev = loadedFor.current
      if (prev && prev.syncAt === syncAt && prev.cardsKey === key) return

      // Real progress for the logo loader on Portfolio/Analytics: one step per game's live prices,
      // plus one for the window baselines. Only reported on the session's first load — later
      // background reloads update prices in place without hiding the page again.
      const firstLoad = !useStore.getState().priceLoad.complete
      const gamesToLoad = ALL_GAMES.filter((g) => eligible.some((c) => c.game === g))
      const total = gamesToLoad.length + 1
      let done = 0
      const step = () => { done += 1; if (firstLoad) setPriceLoad({ done, total, complete: false }) }
      if (firstLoad) setPriceLoad({ done: 0, total, complete: false })

      // 1. Live prices (cheap server lookups).
      const prices: Record<string, number> = {}
      let failed = false
      await Promise.all(ALL_GAMES.map(async (game) => {
        const gameCards = eligible.filter((c) => c.game === game)
        if (gameCards.length === 0) return
        const { url, payload } = PRICE_ROUTES[game]
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cards: gameCards.map(payload) }),
          })
          if (!res.ok) { failed = true; return }
          Object.assign(prices, await res.json())
        } catch {
          failed = true
        } finally {
          step()
        }
      }))
      applyLivePrices(prices)

      // 2. Window baselines from the shared history.
      try {
        const res = await authFetch('/api/price-history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'baselines',
            items: eligible.map((c) => ({ key: c.id, game: c.game, apiId: c.apiId, isFoil: c.isFoil })),
          }),
        })
        if (res.ok) setPriceBaselines(await res.json())
        else failed = true
      } catch {
        failed = true
      } finally {
        step()
      }

      // Only remember this load as complete if everything came back; otherwise the next check
      // retries instead of leaving some cards on stale data.
      if (!failed) {
        loadedFor.current = { syncAt, cardsKey: key }
        if (status.latestSyncAt) setLastPriceRefresh(status.latestSyncAt.toISOString())
      }
    } catch (err) {
      console.error('Loading prices failed:', err)
    } finally {
      running.current = false
      // Release the pages even if part of it failed — they show whatever loaded (and Portfolio's
      // status line says so) rather than staying stuck behind the loader.
      if (!useStore.getState().priceLoad.complete) {
        const { total } = useStore.getState().priceLoad
        setPriceLoad({ done: total, total, complete: true })
      }
    }
  }, [user, setPriceStatus, applyLivePrices, setPriceBaselines, setLastPriceRefresh, setPriceLoad])

  // After sign-in + data load, when owned cards / tracked games change, on a timer,
  // and when the tab comes back into view.
  useEffect(() => {
    if (!user || dataLoading) return
    check()
    const timer = setInterval(check, CHECK_EVERY_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [user, dataLoading, check, trackedGames, cardsKey])

  // A different user signing in on this device starts fresh.
  useEffect(() => { loadedFor.current = null }, [user?.uid])

  return null
}
