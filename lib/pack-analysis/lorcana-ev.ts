/**
 * Lorcana EV types and pull-rate constants.
 * Actual computation runs server-side in /api/pack-analysis/lorcana
 * so prices always reflect the current lorcana-cards.json catalog.
 *
 * Pack structure (12 cards per pack, $5.99 MSRP):
 *   6 non-foil Commons
 *   3 non-foil Uncommons
 *   2 non-foil Rare-or-better slots (one slot can upgrade to SR at ~25%)
 *   1 guaranteed "cold foil" card (any rarity)
 *
 * Cold foil slot distribution:
 *   Foil C/U/R : ~72%   (blend of all three — most packs)
 *   Foil SR    : ~22%   (1 in ~4.5 packs; 20% for sets with Epic)
 *   Foil Leg   : 1/24   (1 per box — ~4.2%)
 *   Foil Ench  : 1/72   (~1 per 3 boxes — 1.4%)
 *   Foil Epic  : 1/48   (~1 per 2 boxes — 2.1%, sets 9+ only)
 *
 * Sources: community box-opening analysis; official rates not publicly disclosed
 * by Ravensburger for all tiers.
 */

export interface LorcanaCardHit {
  name: string
  price: number
  imageUrl: string
}

export interface LorcanaEVBreakdown {
  commons: number      // 6 × avg_common
  uncommons: number    // 3 × avg_uncommon
  rares: number        // 2 × avg_rare + 0.25 × avg_sr_nonfoil (upgrade)
  foilSlot: number     // full cold foil contribution
  total: number
  // Foil slot sub-breakdown
  foilCUR: number      // foil Common/Uncommon/Rare blend
  foilSR: number       // foil Super Rare
  foilLeg: number      // foil Legendary
  foilEnch: number     // foil Enchanted
  foilEpic: number     // foil Epic (0 for sets without Epic)
}

export interface LorcanaSetEV {
  id: string
  name: string
  releaseDate: string
  packPrice: number
  hasEpic: boolean
  // Average prices per rarity
  avgCommon: number
  avgUncommon: number
  avgRare: number
  avgSR: number        // non-foil
  avgFoilSR: number
  avgFoilLeg: number
  avgFoilEnch: number
  avgFoilEpic: number
  // Card counts
  countCommon: number
  countUncommon: number
  countRare: number
  countSR: number
  countLeg: number
  countEnch: number
  countEpic: number
  // EV breakdown
  ev: LorcanaEVBreakdown
  // Pull rates actually applied (for display)
  rates: {
    foilSRRate: number
    foilLegRate: number
    foilEnchRate: number
    foilEpicRate: number
    foilCURRate: number
    srUpgradeRate: number
  }
  // Top cards for the hit-list tabs
  topSRs: LorcanaCardHit[]
  topLegendaries: LorcanaCardHit[]
  topEnchanted: LorcanaCardHit[]
  topEpics: LorcanaCardHit[]
}

// Exported so the UI can reference the constants in labels
export const LORCANA_PULL_RATES = {
  foilSRPerPack: 0.22,      // ~1 in 4.5 packs (20% for Epic sets)
  foilLegPerPack: 1 / 24,   // 1 per box of 24
  foilEnchPerPack: 1 / 72,  // 1 per 3 boxes
  foilEpicPerPack: 1 / 48,  // 1 per 2 boxes (sets 9–11 only)
  srUpgradeRate: 0.25,       // 1 in 4 packs: one rare slot → non-foil SR
} as const
