'use client'

import { useEffect, useRef, useState } from 'react'
import { useAuth } from '@/components/auth/AuthProvider'
import { useStore } from '@/lib/store'
import { dayTotals, localDay, saveValueDay } from '@/lib/valueHistory'

// Saves today's snapshot of the collection's value (lib/valueHistory.ts) — once this session's
// prices are in, and again a few seconds after the inventory or its prices change. Every account,
// Premium or not, so the history is there the day someone upgrades. Nothing on screen.
const SETTLE_MS = 4000

export function ValueSnapshotter() {
  const { user, dataLoading } = useAuth()
  const cards = useStore((s) => s.cards)
  const priceBaselines = useStore((s) => s.priceBaselines)
  const gradedSources = useStore((s) => s.gradedSources)
  const pricesIn = useStore((s) => s.priceLoad.complete)
  const calcFloor = useStore((s) => s.calcFloor) // saved with the day, so that floor applies exactly
  const lastSaved = useRef('')
  // The day rolls over while the app stays open: re-check now and then, and on coming back to it
  const [today, setToday] = useState(localDay)
  useEffect(() => {
    const tick = () => setToday(localDay())
    const timer = setInterval(tick, 10 * 60_000)
    const onVisible = () => { if (document.visibilityState === 'visible') tick() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [])

  useEffect(() => {
    // Not before the prices are in (it would save stale values), and nothing for an empty
    // collection (a brand-new account isn't a $0 day; a collection sold off entirely keeps its
    // last day on the chart)
    if (!user || dataLoading || !pricesIn || cards.length === 0) return
    const t = setTimeout(() => {
      const day = { day: today, totals: dayTotals(cards, priceBaselines, gradedSources, calcFloor) }
      const key = `${user.uid}|${JSON.stringify(day)}`
      if (key === lastSaved.current) return
      saveValueDay(user.uid, day)
        .then(() => { lastSaved.current = key })
        .catch((err) => console.warn('[value history] snapshot not saved', err))
    }, SETTLE_MS)
    return () => clearTimeout(t)
  }, [user, dataLoading, pricesIn, cards, priceBaselines, gradedSources, calcFloor, today])

  return null
}
