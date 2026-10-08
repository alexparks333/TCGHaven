import { NextResponse } from 'next/server'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase/config'
import { ensureAdminAuth } from '@/lib/firebase/adminAuth'
import { verifyAdminRequest } from '@/lib/firebase/verifyAdminRequest'
import { loadCatalog } from '@/lib/api/catalog'
import { PRICE_HISTORY_COLLECTION, setKeyOf, monthDocId } from '@/scripts/lib/price-history.mjs'
import type { Game } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// One-time import of the OLD per-user price history (users/{uid}/priceHistory — one doc per user
// card) into the shared, catalog-level history (scripts/lib/price-history.mjs), so past P&L and
// charts survive the move. The admin's browser reads its own old history and posts it here in
// chunks; this maps each card to its catalog set and fills in ONLY prices the shared history
// doesn't already have — real sync data is never overwritten, and running it again is harmless.
//
// An old point is the price the user saw for their own copy, so a foil copy's points go in the
// foil slot and a regular copy's in the regular slot. (Old points were "market" prices, so they
// only show in 30d-avg mode, not Lowest NM.)

interface ImportCard {
  game: Game
  apiId: string
  isFoil: boolean
  points: { date: string; price: number }[]
}

type DayEntry = { t: string; p: Record<string, number[]> }

export async function POST(request: Request) {
  const unauthorized = await verifyAdminRequest(request)
  if (unauthorized) return unauthorized

  const body = (await request.json().catch(() => null)) as { cards?: ImportCard[] } | null
  const cards = (body?.cards ?? []).filter((c) => c && c.game && c.apiId && Array.isArray(c.points))
  if (cards.length === 0) return NextResponse.json({ docsWritten: 0, pricesAdded: 0 })

  await ensureAdminAuth()

  // docPath -> day 'DD' -> catalogId -> [m, mf, l, lf] additions
  const additions = new Map<string, { game: Game; setKey: string; month: string; days: Map<string, { t: string; p: Map<string, number[]> }> }>()
  const catalogs = new Map<Game, Map<string, { set?: string; setCode?: string; setName?: string }>>()

  for (const card of cards) {
    if (!catalogs.has(card.game)) {
      const catalog = await loadCatalog<{ id: string; set?: string; setCode?: string; setName?: string }>(card.game)
      catalogs.set(card.game, new Map(catalog.map((c) => [c.id, c])))
    }
    const cat = catalogs.get(card.game)!.get(card.apiId)
    if (!cat) continue
    const setKey = setKeyOf(cat)
    for (const pt of card.points) {
      if (!(pt.price > 0) || !pt.date) continue
      const month = pt.date.slice(0, 7)
      const day = pt.date.slice(8, 10)
      const path = `${card.game}/${monthDocId(setKey, month)}`
      if (!additions.has(path)) additions.set(path, { game: card.game, setKey, month, days: new Map() })
      const days = additions.get(path)!.days
      if (!days.has(day)) days.set(day, { t: pt.date, p: new Map() })
      const tuple = days.get(day)!.p.get(card.apiId) ?? [0, 0, 0, 0]
      tuple[card.isFoil ? 1 : 0] = Math.round(pt.price * 100) / 100
      days.get(day)!.p.set(card.apiId, tuple)
    }
  }

  let docsWritten = 0
  let pricesAdded = 0
  for (const [path, { game, setKey, month, days }] of Array.from(additions.entries())) {
    const ref = doc(db, PRICE_HISTORY_COLLECTION, game, 'months', path.split('/')[1])
    const existing = ((await getDoc(ref)).data()?.days ?? {}) as Record<string, string>
    const merged: Record<string, string> = {}
    for (const [day, add] of Array.from(days.entries())) {
      let entry: DayEntry = { t: add.t, p: {} }
      if (existing[day]) {
        try { entry = JSON.parse(existing[day]) as DayEntry } catch { /* rebuild below */ }
      }
      let changed = false
      for (const [apiId, tuple] of Array.from(add.p.entries())) {
        const current = entry.p[apiId]
        if (!current) { entry.p[apiId] = tuple; changed = true; pricesAdded++; continue }
        // Fill only empty slots of an existing tuple — never replace a real synced price.
        tuple.forEach((v, i) => { if (v > 0 && !(current[i] > 0)) { current[i] = v; changed = true; pricesAdded++ } })
      }
      if (changed) merged[day] = JSON.stringify(entry)
    }
    if (Object.keys(merged).length > 0) {
      await setDoc(ref, { game, setKey, month, days: merged }, { merge: true })
      docsWritten++
    }
  }

  return NextResponse.json({ docsWritten, pricesAdded })
}
