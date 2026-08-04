import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { Card, PriceHistory, PackSet, Game, SoldCard, CatalogSyncNotice } from './types'
import type { Purchase } from './spending/types'

interface TCGStore {
  cards: Card[]
  soldCards: SoldCard[]
  priceHistory: PriceHistory[]
  packSets: PackSet[]
  packPriceOverrides: Record<string, number>
  activeGame: Game
  lastPriceRefresh: string | null
  purchases: Purchase[]
  calcFloor: number
  showFilters: boolean
  activeGames: Game[]
  timeFrame: 'entry' | '1d' | '7d' | '30d'
  priceMode: 'market' | 'lowestNM'
  hiddenGroups: string[]
  catalogSyncNotices: CatalogSyncNotice[]

  // Populated by AuthProvider on login
  loadUserCards: (cards: Card[]) => void
  loadUserSoldCards: (cards: SoldCard[]) => void
  loadUserPriceHistory: (history: PriceHistory[]) => void
  loadPurchases: (data: Purchase[]) => void
  clearUserData: () => void

  // Local state mutations (caller is responsible for Firestore sync)
  addCard: (card: Card) => void
  updateCard: (id: string, updates: Partial<Card>) => void
  deleteCard: (id: string) => void
  addSoldCard: (card: SoldCard) => void
  removeSoldCard: (id: string) => void
  setActiveGame: (game: Game) => void
  updateCardPrice: (id: string, price: number) => void
  addPriceHistoryPoint: (cardId: string, price: number, date: string) => void
  setLastPriceRefresh: (date: string) => void
  updatePackSet: (id: string, updates: Partial<PackSet>) => void
  setPackPriceOverride: (id: string, price: number) => void
  addPurchase: (purchase: Purchase) => void
  setCalcFloor: (v: number) => void
  setShowFilters: (v: boolean) => void
  setActiveGames: (games: Game[]) => void
  setTimeFrame: (frame: 'entry' | '1d' | '7d' | '30d') => void
  setPriceMode: (mode: 'market' | 'lowestNM') => void
  toggleHiddenGroup: (group: string) => void
  editPurchase: (id: string, updates: Partial<Purchase>) => void
  removePurchase: (id: string) => void
  addCatalogSyncNotice: (notice: CatalogSyncNotice) => void
  dismissCatalogSyncNotice: (id: string) => void
}

const defaultPackSets: PackSet[] = [
  {
    id: 'sv-prismatic-evolutions',
    game: 'pokemon',
    name: 'Prismatic Evolutions',
    releaseDate: '2025-01-17',
    packPrice: 4.99,
    cardsPerPack: 10,
    totalCards: 193,
    expectedValue: 6.20,
    pullRates: [
      { rarity: 'Illustration Rare', rate: 1/8, avgValue: 12.50 },
      { rarity: 'Special Illustration Rare', rate: 1/80, avgValue: 85.00 },
      { rarity: 'Hyper Rare', rate: 1/150, avgValue: 120.00 },
      { rarity: 'Rare', rate: 1/4, avgValue: 2.50 },
    ],
  },
  {
    id: 'sv-journey-together',
    game: 'pokemon',
    name: 'Journey Together',
    releaseDate: '2025-03-28',
    packPrice: 4.99,
    cardsPerPack: 10,
    totalCards: 190,
    expectedValue: 4.80,
    pullRates: [
      { rarity: 'Illustration Rare', rate: 1/8, avgValue: 9.00 },
      { rarity: 'Special Illustration Rare', rate: 1/80, avgValue: 60.00 },
      { rarity: 'Hyper Rare', rate: 1/150, avgValue: 90.00 },
      { rarity: 'Rare', rate: 1/4, avgValue: 2.00 },
    ],
  },
  {
    id: 'lorcana-azurite-sea',
    game: 'lorcana',
    name: 'Azurite Sea',
    releaseDate: '2025-05-09',
    packPrice: 5.99,
    cardsPerPack: 12,
    totalCards: 204,
    expectedValue: 5.10,
    pullRates: [
      { rarity: 'Legendary', rate: 1/24, avgValue: 25.00 },
      { rarity: 'Enchanted', rate: 1/72, avgValue: 45.00 },
      { rarity: 'Super Rare', rate: 1/6, avgValue: 4.00 },
    ],
  },
  {
    id: 'lorcana-shimmering-skies',
    game: 'lorcana',
    name: 'Shimmering Skies',
    releaseDate: '2024-08-09',
    packPrice: 5.99,
    cardsPerPack: 12,
    totalCards: 204,
    expectedValue: 4.50,
    pullRates: [
      { rarity: 'Legendary', rate: 1/24, avgValue: 18.00 },
      { rarity: 'Enchanted', rate: 1/72, avgValue: 35.00 },
      { rarity: 'Super Rare', rate: 1/6, avgValue: 3.50 },
    ],
  },
  {
    id: 'riftbound-core-set',
    game: 'riftbound',
    name: 'Riftbound Core Set',
    releaseDate: '2025-06-01',
    packPrice: 5.00,
    cardsPerPack: 10,
    totalCards: 220,
    expectedValue: 4.20,
    pullRates: [
      { rarity: 'Mythic', rate: 1/20, avgValue: 30.00 },
      { rarity: 'Legendary', rate: 1/8, avgValue: 8.00 },
      { rarity: 'Rare', rate: 1/3, avgValue: 2.00 },
    ],
  },
]

export const useStore = create<TCGStore>()(
  persist(
    (set) => ({
  cards: [],
  soldCards: [],
  priceHistory: [],
  packSets: defaultPackSets,
  packPriceOverrides: {},
  activeGame: 'pokemon',
  lastPriceRefresh: null,
  purchases: [],
  calcFloor: 0,
  showFilters: false,
  activeGames: ['pokemon', 'lorcana', 'riftbound'] as Game[],
  timeFrame: 'entry' as const,
  priceMode: 'market' as const,
  hiddenGroups: [] as string[],
  catalogSyncNotices: [] as CatalogSyncNotice[],

  loadUserCards: (cards) => set({ cards }),
  loadUserSoldCards: (soldCards) => set({ soldCards }),
  loadUserPriceHistory: (priceHistory) => set({ priceHistory }),
  loadPurchases: (data) => set({ purchases: data }),
  clearUserData: () => set({ cards: [], soldCards: [], priceHistory: [], lastPriceRefresh: null, purchases: [], catalogSyncNotices: [] }),

  addCard: (card) =>
    set((state) => ({ cards: [...state.cards, card] })),

  updateCard: (id, updates) =>
    set((state) => ({
      cards: state.cards.map((c) => (c.id === id ? { ...c, ...updates } : c)),
    })),

  deleteCard: (id) =>
    set((state) => ({ cards: state.cards.filter((c) => c.id !== id) })),

  addSoldCard: (card) =>
    set((state) => ({ soldCards: [card, ...state.soldCards] })),

  removeSoldCard: (id) =>
    set((state) => ({ soldCards: state.soldCards.filter((c) => c.id !== id) })),

  setActiveGame: (game) => set({ activeGame: game }),

  updateCardPrice: (id, price) =>
    set((state) => ({
      cards: state.cards.map((c) =>
        c.id === id ? { ...c, currentPrice: price, priceUpdatedAt: new Date().toISOString() } : c
      ),
    })),

  addPriceHistoryPoint: (cardId, price, date) =>
    set((state) => {
      const day = date.slice(0, 10) // YYYY-MM-DD — one point per calendar day
      const newPoint = { date, price }
      const existing = state.priceHistory.find((h) => h.cardId === cardId)
      if (existing) {
        const deduped = existing.points.filter((p) => p.date.slice(0, 10) !== day)
        return {
          priceHistory: state.priceHistory.map((h) =>
            h.cardId === cardId ? { ...h, points: [...deduped, newPoint] } : h
          ),
        }
      }
      return {
        priceHistory: [...state.priceHistory, { cardId, points: [newPoint] }],
      }
    }),

  setLastPriceRefresh: (date) => set({ lastPriceRefresh: date }),

  updatePackSet: (id, updates) =>
    set((state) => ({
      packSets: state.packSets.map((s) => (s.id === id ? { ...s, ...updates } : s)),
    })),

  setPackPriceOverride: (id, price) =>
    set((state) => ({ packPriceOverrides: { ...state.packPriceOverrides, [id]: price } })),

  addPurchase: (purchase) =>
    set((state) => ({ purchases: [purchase, ...state.purchases] })),

  editPurchase: (id, updates) =>
    set((state) => ({
      purchases: state.purchases.map((p) => (p.id === id ? { ...p, ...updates } : p)),
    })),

  removePurchase: (id) =>
    set((state) => ({ purchases: state.purchases.filter((p) => p.id !== id) })),

  addCatalogSyncNotice: (notice) =>
    set((state) => ({ catalogSyncNotices: [notice, ...state.catalogSyncNotices] })),

  dismissCatalogSyncNotice: (id) =>
    set((state) => ({ catalogSyncNotices: state.catalogSyncNotices.filter((n) => n.id !== id) })),

  setCalcFloor: (v) => set({ calcFloor: v }),
  setShowFilters: (v) => set({ showFilters: v }),
  setActiveGames: (games) => set({ activeGames: games }),
  setTimeFrame: (frame) => set({ timeFrame: frame }),
  setPriceMode: (mode) => set({ priceMode: mode }),
  toggleHiddenGroup: (group) =>
    set((state) => ({
      hiddenGroups: state.hiddenGroups.includes(group)
        ? state.hiddenGroups.filter((g) => g !== group)
        : [...state.hiddenGroups, group],
    })),
    }),
    {
      name: 'tcghaven-filters',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        calcFloor: state.calcFloor,
        activeGames: state.activeGames,
        timeFrame: state.timeFrame,
        packPriceOverrides: state.packPriceOverrides,
        priceMode: state.priceMode,
        hiddenGroups: state.hiddenGroups,
        lastPriceRefresh: state.lastPriceRefresh,
      }),
    }
  )
)
