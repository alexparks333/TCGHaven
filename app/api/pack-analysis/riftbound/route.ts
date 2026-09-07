import { NextResponse } from 'next/server'
import { loadVisibleCatalog } from '@/lib/api/catalog'

export const dynamic = 'force-dynamic'

const PULL_RATES = {
  epicPerPack:       0.25,
  altArtPerPack:     0.0833,
  overnumberPerPack: 0.014,
  signaturePerPack:  0.0014,
}

const SET_META: Record<string, { setName: string; releaseDate: string; packPrice: number; cardsPerPack: number }> = {
  OGN: { setName: 'Origins',          releaseDate: '2025-10-31', packPrice: 5.00, cardsPerPack: 13 },
  SFD: { setName: 'Spiritforged',     releaseDate: '2026-02-13', packPrice: 5.00, cardsPerPack: 13 },
  UNL: { setName: 'Unleashed',        releaseDate: '2026-05-08', packPrice: 5.00, cardsPerPack: 13 },
  OGS: { setName: 'Proving Grounds',  releaseDate: '2026-01-01', packPrice: 0,    cardsPerPack: 0  },
}

const BOOSTER_SET_CODES = ['OGN', 'SFD', 'UNL']

interface CatalogCard {
  id: string
  name: string
  number: string
  publicCode: string
  setCode: string
  setName: string
  rarity: string
  imageUrl: string
  marketPrice: number
  marketPriceFoil: number
  hidden?: boolean
}

function avgOf(cards: CatalogCard[], key: 'marketPrice' | 'marketPriceFoil'): number {
  const priced = cards.filter((c) => c[key] > 0)
  if (!priced.length) return 0
  return priced.reduce((s, c) => s + c[key], 0) / priced.length
}

function top5(cards: CatalogCard[], key: 'marketPrice' | 'marketPriceFoil') {
  return [...cards].filter((c) => c[key] > 0).sort((a, b) => b[key] - a[key]).slice(0, 5)
    .map((c) => ({ name: c.name, price: c[key], imageUrl: c.imageUrl }))
}

// Prices come straight from the catalog (kept fresh by the 6-hourly cron —
// app/api/cron/sync-prices/route.ts) instead of this route re-downloading every set's full
// tcgcsv CSV on every page load — see CLAUDE.md "Price Data" for the full rationale.
export async function GET() {
  const enriched = await loadVisibleCatalog<CatalogCard>('riftbound')

  // Build per-set EV data for each booster set
  const results = BOOSTER_SET_CODES.map((setCode) => {
    const meta = SET_META[setCode]
    const setCards = enriched.filter((c) => c.setCode === setCode)

    const commons    = setCards.filter((c) => c.rarity === 'Common')
    const uncommons  = setCards.filter((c) => c.rarity === 'Uncommon')
    const rares      = setCards.filter((c) => c.rarity === 'Rare')
    const epics      = setCards.filter((c) => c.rarity === 'Epic')
    const signatures = setCards.filter((c) => c.id.includes('-star-') || c.rarity === 'Star')
    const altArts    = setCards.filter((c) => (c.rarity === 'Alt Art' || (c.publicCode ?? '').includes('a/')) && !c.id.includes('-star-'))
    const overnums   = setCards.filter((c) => (c.rarity === 'Overnumbered' || c.rarity === 'Showcase') && !(c.publicCode ?? '').includes('a/') && !c.id.includes('-star-'))

    const avgCommon       = avgOf(commons,    'marketPrice')
    const avgUncommon     = avgOf(uncommons,  'marketPrice')
    const avgRare         = avgOf(rares,      'marketPrice')
    const avgEpic         = avgOf(epics,      'marketPrice')
    const avgFoilCommon   = avgOf(commons,    'marketPriceFoil')
    const avgFoilUncommon = avgOf(uncommons,  'marketPriceFoil')
    const avgAltArt       = avgOf(altArts,    'marketPrice')
    const avgOvernumber   = avgOf(overnums,   'marketPrice')
    const avgSignature    = avgOf(signatures, 'marketPrice')

    const { epicPerPack, altArtPerPack, overnumberPerPack, signaturePerPack } = PULL_RATES
    const nonPremium = 1 - altArtPerPack - overnumberPerPack - signaturePerPack

    const evCommons          = 7 * avgCommon
    const evUncommons        = 3 * avgUncommon
    const evRarePlusSlots    = 0.75 * (2 * avgRare) + 0.25 * (avgRare + avgEpic)
    const evWildcardBase     = nonPremium * 0.5 * (avgFoilCommon + avgFoilUncommon)
    const evWildcardAltArt   = altArtPerPack * avgAltArt
    const evWildcardOvernum  = overnumberPerPack * avgOvernumber
    const evWildcardSig      = signaturePerPack * avgSignature
    const evWildcardSlot     = evWildcardBase + evWildcardAltArt + evWildcardOvernum + evWildcardSig
    const total              = evCommons + evUncommons + evRarePlusSlots + evWildcardSlot

    return {
      setCode,
      setName: meta.setName,
      releaseDate: meta.releaseDate,
      packPrice: meta.packPrice,
      cardsPerPack: meta.cardsPerPack,
      avgCommon, avgUncommon, avgRare, avgEpic,
      avgFoilCommon, avgFoilUncommon,
      avgAltArt, avgOvernumber, avgSignature,
      countCommon:    commons.length,
      countUncommon:  uncommons.length,
      countRare:      rares.length,
      countEpic:      epics.length,
      countAltArt:    altArts.length,
      countOvernumber:overnums.length,
      countSignature: signatures.length,
      topEpics:       top5(epics,      'marketPrice'),
      topRares:       top5(rares,      'marketPrice'),
      topAltArts:     top5(altArts,    'marketPrice'),
      topOvernumbers: top5(overnums,   'marketPrice'),
      topSignatures:  top5(signatures, 'marketPrice'),
      ev: {
        commons: evCommons,
        uncommons: evUncommons,
        rarePlusSlots: evRarePlusSlots,
        wildcardSlot: evWildcardSlot,
        wildcardBase: evWildcardBase,
        wildcardAltArt: evWildcardAltArt,
        wildcardOvernumber: evWildcardOvernum,
        wildcardSignature: evWildcardSig,
        total,
      },
    }
  })

  return NextResponse.json(results, { headers: { 'Cache-Control': 'no-store' } })
}
