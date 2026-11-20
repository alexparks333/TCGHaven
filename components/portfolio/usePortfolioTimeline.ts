'use client'

import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/components/auth/AuthProvider'
import { useStore } from '@/lib/store'
import { dayTotals, loadValueDays, localDay, sumDay, type ValueDay } from '@/lib/valueHistory'
import type { Game } from '@/lib/types'
import { usePremiumAccess } from '@/components/premium/PremiumProvider'

export interface TimelineDay { day: string; value: number; cost: number; entry: number }

/** The collection's value on each past day — for Portfolio Analytics and the Portfolio's
 *  "Over time" chart, so the two can never disagree. Read from the collector's own daily
 *  snapshots (lib/valueHistory.ts: what they actually had that day, not today's cards priced
 *  backwards), under the same filters as the pie chart: the games picked, hidden groups and the
 *  price floor (both read from the store here, as Portfolio does). Today is always the live
 *  inventory, so a card logged a minute ago shows at once and today's value equals the pie chart's
 *  total. `enabled: false` loads nothing (a chart that isn't showing). */
export function usePortfolioTimeline(games: Game[], enabled = true): {
  dailyValues: TimelineDay[]
  ready: boolean
  /** Haven Premium: the value over time is a Premium feature (nothing is loaded) */
  locked: boolean
} {
  const locked = !usePremiumAccess().unlocked
  const { user } = useAuth()
  const uid = user?.uid
  const cards = useStore((s) => s.cards)
  const priceBaselines = useStore((s) => s.priceBaselines)
  const gradedSources = useStore((s) => s.gradedSources)
  const hiddenGroups = useStore((s) => s.hiddenGroups)
  const calcFloor = useStore((s) => s.calcFloor)
  const [loaded, setLoaded] = useState<{ uid: string | null; days: ValueDay[] }>({ uid: null, days: [] })

  useEffect(() => {
    if (!enabled || locked || !uid) return
    let stale = false
    loadValueDays(uid)
      .then((days) => { if (!stale) setLoaded({ uid, days }) })
      .catch(() => { if (!stale) setLoaded({ uid, days: [] }) })
    return () => { stale = true }
  }, [uid, enabled, locked])

  const today = useMemo<ValueDay>(
    () => ({ day: localDay(), totals: dayTotals(cards, priceBaselines, gradedSources, calcFloor) }),
    [cards, priceBaselines, gradedSources, calcFloor],
  )
  const gamesKey = games.join(',')
  const groupsKey = hiddenGroups.join('\u0000')
  const dailyValues = useMemo(() => {
    const filter = { games: gamesKey ? (gamesKey.split(',') as Game[]) : [], hiddenGroups: groupsKey ? groupsKey.split('\u0000') : [], floor: calcFloor }
    const sum = (d: ValueDay): TimelineDay => {
      const x = sumDay(d.totals, filter)
      return { day: d.day, value: x.v, cost: x.c, entry: x.e }
    }
    const past = loaded.days.filter((d) => d.day < today.day).map(sum)
    return cards.length > 0 || past.length === 0 ? [...past, sum(today)] : past
  }, [loaded.days, today, gamesKey, groupsKey, calcFloor, cards.length])

  const ready = loaded.uid === uid && !!uid
  return { dailyValues: ready ? dailyValues : [], ready: ready || locked, locked }
}
