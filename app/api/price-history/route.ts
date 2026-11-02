import { NextResponse } from 'next/server'
import { verifyUserRequest } from '@/lib/firebase/verifyAdminRequest'
import { loadBaselines, loadPriceSeries, priceAtOrBefore, type HistoryItem } from '@/lib/api/priceHistory'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Answers questions about the shared price history (lib/api/priceHistory.ts) so the browser only
// ever downloads results, never raw history:
//
//  mode "baselines" — each item's price at the start of each Portfolio window (24h / 7d / 30d /
//                     365d ago), plus its earliest recorded price. Portfolio's P&L — runs on every
//                     app open, so it reads the small daily price files, not months of history.
//  mode "series"    — full daily points for a few items. The card detail chart.
//  mode "portfolio" — one total value per day across all items (qty × that day's price, falling
//                     back to `fallback` where a card has no price yet that day). Analytics.
//
// Signed-in users only: it's real server work per call, so it shouldn't be open to anyone.

const DAY_MS = 86_400_000
const MAX_SERIES_ITEMS = 25

interface Body {
  mode: 'baselines' | 'series' | 'portfolio'
  days?: number
  items: (HistoryItem & { qty?: number; fallback?: number })[]
}

export async function POST(request: Request) {
  const unauthorized = await verifyUserRequest(request)
  if (unauthorized) return unauthorized

  const body = (await request.json().catch(() => null)) as Body | null
  if (!body || !Array.isArray(body.items)) return NextResponse.json({ error: 'Expected { mode, items }' }, { status: 400 })
  const items = body.items.filter((i) => i && i.key && i.apiId && i.game)
  const now = Date.now()

  if (body.mode === 'baselines') {
    return NextResponse.json(await loadBaselines(items, now))
  }

  if (body.mode === 'series') {
    const days = Math.min(Math.max(Number(body.days) || 365, 1), 730)
    const series = await loadPriceSeries(items.slice(0, MAX_SERIES_ITEMS), new Date(now - days * DAY_MS))
    return NextResponse.json(Object.fromEntries(series))
  }

  if (body.mode === 'portfolio') {
    const days = Math.min(Math.max(Number(body.days) || 365, 1), 730)
    const series = await loadPriceSeries(items, new Date(now - days * DAY_MS))
    // One point per calendar day that has any recorded price.
    const daySet = new Set<string>()
    series.forEach((points) => points.forEach((p) => daySet.add(p.date.slice(0, 10))))
    const timeline = Array.from(daySet).sort().map((day) => {
      const endOfDay = new Date(`${day}T23:59:59.999Z`).getTime()
      let value = 0
      for (const item of items) {
        const points = series.get(item.key)
        const price = (points ? priceAtOrBefore(points, endOfDay) : null) ?? item.fallback ?? 0
        value += price * (item.qty ?? 1)
      }
      return { day, value }
    })
    return NextResponse.json({ timeline })
  }

  return NextResponse.json({ error: 'Unknown mode' }, { status: 400 })
}
