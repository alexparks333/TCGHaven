export type Game = 'pokemon' | 'lorcana' | 'riftbound'

export type Condition = 'mint' | 'near_mint' | 'lightly_played' | 'moderately_played' | 'heavily_played'

export interface Card {
  id: string
  game: Game
  name: string
  set: string
  setCode: string
  number: string
  condition: Condition
  quantity: number
  purchasePrice: number
  purchaseDate: string
  isFoil: boolean
  imageUrl?: string
  apiId?: string
  currentPrice?: number
  priceUpdatedAt?: string
  createdAt?: string
  priceAtEntry?: number   // market price snapshotted when card was first added
  gradingCompany?: string // e.g. "PSA", "CGC", "BGS", "SGC"
  grade?: string          // e.g. "10", "9.5", "Authentic"
  group?: string          // user-defined group label, e.g. "Alex & Brother's Cards"
  priceLocked?: boolean   // when true, Refresh Prices never overwrites currentPrice
  rarity?: string         // from the catalog at add time; Pokemon catalog cards don't carry one
  nexus?: boolean         // Riftbound only — user-flagged Nexus Night promo-foil variant
}

export interface SoldCard extends Card {
  soldDate: string    // YYYY-MM-DD
  soldPrice: number   // total amount received for this lot
  soldAt: string      // ISO timestamp of the sale
}

export interface PricePoint {
  date: string
  price: number
}

export interface PriceHistory {
  cardId: string
  points: PricePoint[]
}

export interface PackSet {
  id: string
  game: Game
  name: string
  releaseDate: string
  packPrice: number
  cardsPerPack: number
  totalCards: number
  imageUrl?: string
  pullRates?: PullRate[]
  expectedValue?: number
}

export interface PullRate {
  rarity: string
  rate: number
  avgValue: number
}

// Surfaced on the Inventory page after an Admin Catalog edit auto-cascades to matching
// inventory entries — a record of "here's what just changed," not the change itself (the
// Firestore write already happened by the time this exists).
export interface CatalogSyncNotice {
  id: string
  cardName: string
  apiId: string
  matchedCount: number
  changedFields: Array<{ field: string; from: string; to: string }>
}

export const CONDITION_LABELS: Record<Condition, string> = {
  mint: 'Mint',
  near_mint: 'Near Mint',
  lightly_played: 'Lightly Played',
  moderately_played: 'Moderately Played',
  heavily_played: 'Heavily Played',
}

export const GAME_LABELS: Record<Game, string> = {
  pokemon: 'Pokémon',
  lorcana: 'Lorcana',
  riftbound: 'Riftbound',
}

export const GAME_COLORS: Record<Game, string> = {
  pokemon: '#FFCB05',
  lorcana: '#7B61FF',
  riftbound: '#E8472A',
}

export const CONDITION_MULTIPLIER: Record<Condition, number> = {
  mint: 1.0,
  near_mint: 0.9,
  lightly_played: 0.75,
  moderately_played: 0.6,
  heavily_played: 0.4,
}
