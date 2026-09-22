import { NextResponse } from 'next/server'
import { getLorcanaBoosterSets } from '@/lib/api/registry'
import { loadVisibleCatalog } from '@/lib/api/catalog'

export const dynamic = 'force-dynamic'

interface CatalogCard {
  id: string
  name: string
  setName: string
  rarity: string
  marketPrice: number
  marketPriceFoil: number
  imageUrl: string
  hidden?: boolean
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
  // Hidden cards must never factor into the EV math — loadVisibleCatalog already excludes them.
  // Reads straight from the catalog (kept fresh by the 6-hourly cron), same as the Riftbound
  // pack-analysis route — this used to also do its own live api.lorcast.com fetch on every
  // request (12 concurrent queries), which both duplicated download-cards' own scrape and
  // contradicted the documented "all live price fetches happen only in the cron" design.
  const catalog = await loadVisibleCatalog<CatalogCard>('lorcana')

  const boosterSets = await getLorcanaBoosterSets()
  const results = boosterSets.map((setConfig) => {
    const sc = catalog.filter((c) => c.setName === setConfig.name)

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
