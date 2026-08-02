import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { getLorcanaBoosterSets } from '@/lib/api/registry'

export const dynamic = 'force-dynamic'

interface CatalogCard {
  id: string
  name: string
  setName: string
  rarity: string
  marketPrice: number
  marketPriceFoil: number
  imageUrl: string
}

// Fetch current prices for all Lorcana cards from lorcast.com.
// Uses same search strategy as download-cards (vowels + rarity queries) to cover all cards.
// Falls back gracefully — any cards not returned by lorcast keep their catalog price.
async function fetchLivePrices(): Promise<Map<string, { marketPrice: number; marketPriceFoil: number }>> {
  const live = new Map<string, { marketPrice: number; marketPriceFoil: number }>()
  const queries = ['a', 'e', 'i', 'o', 'u', 'y', 'th', 'rarity:enchanted', 'rarity:epic', 'rarity:mythic', 'rarity:special']

  await Promise.all(queries.map(async (q) => {
    try {
      const res = await fetch(
        `https://api.lorcast.com/v0/cards/search?q=${encodeURIComponent(q)}&page_size=500`,
        { signal: AbortSignal.timeout(20000) }
      )
      if (!res.ok) return
      const data = await res.json()
      for (const c of (data.results ?? [])) {
        if (!c?.id || live.has(c.id)) continue
        live.set(c.id, {
          marketPrice: typeof c.prices?.usd === 'number' ? c.prices.usd : 0,
          marketPriceFoil: typeof c.prices?.usd_foil === 'number' ? c.prices.usd_foil : 0,
        })
      }
    } catch {
      // lorcast unreachable — catalog prices used as fallback
    }
  }))

  return live
}

function avg(cards: CatalogCard[], key: 'marketPrice' | 'marketPriceFoil'): number {
  const priced = cards.filter((c) => c[key] > 0)
  if (!priced.length) return 0
  return priced.reduce((s, c) => s + c[key], 0) / priced.length
}

function topN(cards: CatalogCard[], key: 'marketPrice' | 'marketPriceFoil', n: number) {
  return [...cards]
    .filter((c) => c[key] > 0)
    .sort((a, b) => b[key] - a[key])
    .slice(0, n)
    .map((c) => ({ name: c.name, price: c[key], imageUrl: c.imageUrl }))
}

export async function GET() {
  const catalogPath = path.join(process.cwd(), 'public', 'data', 'lorcana-cards.json')
  const catalog: CatalogCard[] = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'))

  // Fetch live prices — this is the primary source; catalog prices are the fallback
  const live = await fetchLivePrices()

  // Overlay live prices onto catalog cards
  const enriched = catalog.map((card) => {
    const p = live.get(card.id)
    if (!p) return card
    return {
      ...card,
      marketPrice: p.marketPrice > 0 ? p.marketPrice : card.marketPrice,
      marketPriceFoil: p.marketPriceFoil > 0 ? p.marketPriceFoil : card.marketPriceFoil,
    }
  })

  const results = getLorcanaBoosterSets().map((setConfig) => {
    const sc = enriched.filter((c) => c.setName === setConfig.name)

    const commons   = sc.filter((c) => c.rarity === 'Common')
    const uncommons = sc.filter((c) => c.rarity === 'Uncommon')
    const rares     = sc.filter((c) => c.rarity === 'Rare')
    const srs       = sc.filter((c) => c.rarity === 'Super_rare')
    const legs      = sc.filter((c) => c.rarity === 'Legendary')
    const ench      = sc.filter((c) => c.rarity === 'Enchanted')
    const epics     = sc.filter((c) => c.rarity === 'Epic')

    const avgCommon    = avg(commons,   'marketPrice')
    const avgUncommon  = avg(uncommons, 'marketPrice')
    const avgRare      = avg(rares,     'marketPrice')
    const avgSR        = avg(srs,       'marketPrice')
    const avgFoilC     = avg(commons,   'marketPriceFoil')
    const avgFoilU     = avg(uncommons, 'marketPriceFoil')
    const avgFoilR     = avg(rares,     'marketPriceFoil')
    const avgFoilSR    = avg(srs,       'marketPriceFoil')
    const avgFoilLeg   = avg(legs,      'marketPriceFoil')
    const avgFoilEnch  = avg(ench,      'marketPriceFoil')
    const avgFoilEpic  = avg(epics,     'marketPriceFoil')

    const foilEnchRate = 1 / 72
    const foilLegRate  = 1 / 24
    const foilSRRate   = setConfig.hasEpic ? 0.20 : 0.22
    const foilEpicRate = setConfig.hasEpic ? 1 / 48 : 0
    const foilCURRate  = 1 - foilEnchRate - foilLegRate - foilSRRate - foilEpicRate
    const srUpgradeRate = 0.25
    const avgFoilCUR = 0.4 * avgFoilC + 0.3 * avgFoilU + 0.3 * avgFoilR

    const evCommons   = 6 * avgCommon
    const evUncommons = 3 * avgUncommon
    const evRares     = 2 * avgRare + srUpgradeRate * avgSR
    const evFoilCUR   = foilCURRate  * avgFoilCUR
    const evFoilSR    = foilSRRate   * avgFoilSR
    const evFoilLeg   = foilLegRate  * avgFoilLeg
    const evFoilEnch  = foilEnchRate * avgFoilEnch
    const evFoilEpic  = foilEpicRate * avgFoilEpic
    const evFoilSlot  = evFoilCUR + evFoilSR + evFoilLeg + evFoilEnch + evFoilEpic
    const total       = evCommons + evUncommons + evRares + evFoilSlot

    return {
      id: setConfig.id,
      name: setConfig.name,
      releaseDate: setConfig.released,
      packPrice: setConfig.packPrice,
      hasEpic: setConfig.hasEpic,
      avgCommon, avgUncommon, avgRare, avgSR,
      avgFoilSR, avgFoilLeg, avgFoilEnch, avgFoilEpic,
      countCommon:   commons.length,
      countUncommon: uncommons.length,
      countRare:     rares.length,
      countSR:       srs.length,
      countLeg:      legs.length,
      countEnch:     ench.length,
      countEpic:     epics.length,
      ev: {
        commons: evCommons, uncommons: evUncommons, rares: evRares,
        foilSlot: evFoilSlot, foilCUR: evFoilCUR, foilSR: evFoilSR,
        foilLeg: evFoilLeg, foilEnch: evFoilEnch, foilEpic: evFoilEpic, total,
      },
      rates: { foilSRRate, foilLegRate, foilEnchRate, foilEpicRate, foilCURRate, srUpgradeRate },
      topSRs:        topN(srs,   'marketPriceFoil', 5),
      topLegendaries:topN(legs,  'marketPriceFoil', 5),
      topEnchanted:  topN(ench,  'marketPriceFoil', 5),
      topEpics:      topN(epics, 'marketPriceFoil', 5),
    }
  })

  return NextResponse.json(results, { headers: { 'Cache-Control': 'no-store' } })
}
