export type Game = 'pokemon' | 'lorcana' | 'riftbound' | 'onepiece' | 'mtg'

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
  priceLocked?: boolean   // when true, the automatic price updates never overwrite currentPrice
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
  onepiece: 'One Piece',
  mtg: 'Magic: The Gathering',
}

export const GAME_COLORS: Record<Game, string> = {
  // Muted, earthy takes on each game's brand color so nothing clashes with the parchment theme
  pokemon: '#B8860B',
  lorcana: '#6e4f6a',
  riftbound: '#b5532f',
  onepiece: '#566a5e',
  mtg: '#a8642e',
}

export const CONDITION_MULTIPLIER: Record<Condition, number> = {
  mint: 1.0,
  near_mint: 0.9,
  lightly_played: 0.75,
  moderately_played: 0.6,
  heavily_played: 0.4,
}
