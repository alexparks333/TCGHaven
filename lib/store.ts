import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { Card, Game, SoldCard, CatalogSyncNotice } from './types'
import type { Purchase } from './spending/types'
import type { PriceStatus } from './api/priceStatus'

interface TCGStore {
  cards: Card[]
  soldCards: SoldCard[]
  // Live catalog price per user card id (from app/api/prices/*), laid over each card's
  // currentPrice in memory by withLivePrice() — never written to Firestore. Prices live only in
  // the shared catalog; see components/PriceAutoUpdater.tsx.
  livePrices: Record<string, number>
  // Each card's price at the start of each Portfolio window, from the shared price history
  // (app/api/price-history, mode "baselines"). Keyed by user card id.
  priceBaselines: Record<string, PriceBaseline>
  // Real progress of this session's first price load (live prices per game + window baselines).
  // Portfolio / Analytics stay behind the logo loader until it's complete, so they never flash
  // stale values or a false "no price history" note. Not persisted.
  priceLoad: { done: number; total: number; complete: boolean }
  activeGame: Game
  // ISO time of the catalog sync whose prices were last applied to this user's cards (see
  // components/PriceAutoUpdater.tsx) — not a manual-refresh time anymore.
  lastPriceRefresh: string | null
  // Shared price-update health for Portfolio's "Prices updated …" line; not persisted.
  priceStatus: PriceStatus | null
  purchases: Purchase[]
  calcFloor: number
  showFilters: boolean
  activeGames: Game[]
  // The games this user has chosen to track (Inventory's game tabs + "+" picker). Inventory,
  // Portfolio, and Cardex only ever show these — cards for an untracked game are kept untouched
  // in Firestore, just hidden until the game is tracked again. Loaded from
  // users/{uid}/settings/preferences on login (lib/firebase/preferences.ts); also persisted to
  // localStorage below purely so the first render after a reload doesn't flash the default.
  trackedGames: Game[]
  timeFrame: 'entry' | '1d' | '7d' | '30d' | '365d'
  hiddenGroups: string[]
  catalogSyncNotices: CatalogSyncNotice[]
  cardUnlocks: { id: string; card: Card }[]

  // Populated by AuthProvider on login
  loadUserCards: (cards: Card[]) => void
  loadUserSoldCards: (cards: SoldCard[]) => void
  loadPurchases: (data: Purchase[]) => void
  clearUserData: () => void

  // Local state mutations (caller is responsible for Firestore sync)
  addCard: (card: Card) => void
  updateCard: (id: string, updates: Partial<Card>) => void
  deleteCard: (id: string) => void
  addSoldCard: (card: SoldCard) => void
  removeSoldCard: (id: string) => void
  setActiveGame: (game: Game) => void
  applyLivePrices: (prices: Record<string, number>) => void
  setPriceBaselines: (baselines: Record<string, PriceBaseline>) => void
  setPriceLoad: (load: { done: number; total: number; complete: boolean }) => void
  setLastPriceRefresh: (date: string) => void
  setPriceStatus: (status: PriceStatus | null) => void
  addPurchase: (purchase: Purchase) => void
  setCalcFloor: (v: number) => void
  setShowFilters: (v: boolean) => void
  setActiveGames: (games: Game[]) => void
  setTrackedGames: (games: Game[]) => void
  setTimeFrame: (frame: 'entry' | '1d' | '7d' | '30d' | '365d') => void
  toggleHiddenGroup: (group: string) => void
  editPurchase: (id: string, updates: Partial<Purchase>) => void
  removePurchase: (id: string) => void
  addCatalogSyncNotice: (notice: CatalogSyncNotice) => void
  dismissCatalogSyncNotice: (id: string) => void
  pushCardUnlock: (card: Card) => void
  dismissCardUnlock: (id: string) => void
}

export const DEFAULT_TRACKED_GAMES: Game[] = ['riftbound']

export interface PriceBaseline {
  d1: number | null
  d7: number | null
  d30: number | null
  d365: number | null
  first: number | null   // earliest recorded price
}

// A catalog-priced card shows the live catalog price; a manually priced card (priceLocked) or one
// with no catalog match (no apiId) keeps its own stored price.
export function withLivePrice(card: Card, prices: Record<string, number>): Card {
  if (!card.apiId || card.priceLocked) return card
  const live = prices[card.id]
  return live != null && live !== card.currentPrice ? { ...card, currentPrice: live } : card
}

// Which games Portfolio actually counts: the Filters panel's game toggles, narrowed to the games
// this user tracks. Falls back to every tracked game if that intersection is empty (e.g. the
// filter only had a now-untracked game switched on), so Portfolio never silently shows nothing.
export function portfolioGames(activeGames: Game[], trackedGames: Game[]): Game[] {
  const both = trackedGames.filter((g) => activeGames.includes(g))
  return both.length > 0 ? both : trackedGames
}

export const useStore = create<TCGStore>()(
  persist(
    (set) => ({
  cards: [],
  soldCards: [],
  livePrices: {},
  priceBaselines: {},
  priceLoad: { done: 0, total: 0, complete: false },
  activeGame: 'pokemon',
  lastPriceRefresh: null,
  priceStatus: null,
  purchases: [],
  calcFloor: 0,
  showFilters: false,
  activeGames: ['pokemon', 'lorcana', 'riftbound', 'onepiece', 'mtg'] as Game[],
  trackedGames: DEFAULT_TRACKED_GAMES,
  timeFrame: 'entry' as const,
  hiddenGroups: [] as string[],
  catalogSyncNotices: [] as CatalogSyncNotice[],
  cardUnlocks: [] as { id: string; card: Card }[],

  loadUserCards: (cards) => set((state) => ({ cards: cards.map((c) => withLivePrice(c, state.livePrices)) })),
  loadUserSoldCards: (soldCards) => set({ soldCards }),
  loadPurchases: (data) => set({ purchases: data }),
  clearUserData: () => set({ cards: [], soldCards: [], livePrices: {}, priceBaselines: {}, priceLoad: { done: 0, total: 0, complete: false }, lastPriceRefresh: null, purchases: [], catalogSyncNotices: [], cardUnlocks: [], trackedGames: DEFAULT_TRACKED_GAMES }),

  addCard: (card) =>
    set((state) => ({ cards: [...state.cards, withLivePrice(card, state.livePrices)] })),

  updateCard: (id, updates) =>
    set((state) => ({
      cards: state.cards.map((c) => (c.id === id ? withLivePrice({ ...c, ...updates }, state.livePrices) : c)),
    })),

  deleteCard: (id) =>
    set((state) => ({ cards: state.cards.filter((c) => c.id !== id) })),

  addSoldCard: (card) =>
    set((state) => ({ soldCards: [card, ...state.soldCards] })),

  removeSoldCard: (id) =>
    set((state) => ({ soldCards: state.soldCards.filter((c) => c.id !== id) })),

  setActiveGame: (game) => set({ activeGame: game }),

  applyLivePrices: (prices) =>
    set((state) => ({ livePrices: prices, cards: state.cards.map((c) => withLivePrice(c, prices)) })),

  setPriceBaselines: (priceBaselines) => set({ priceBaselines }),
  setPriceLoad: (priceLoad) => set({ priceLoad }),

  setLastPriceRefresh: (date) => set({ lastPriceRefresh: date }),
  setPriceStatus: (status) => set({ priceStatus: status }),

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

  // Queued rather than a single value — a fast burst of "first copy" adds (e.g. logging a whole
  // box unboxing) shouldn't clobber earlier unlocks before the user's seen them. CardUnlockToast
  // shows only the front of the queue at a time.
  pushCardUnlock: (card) =>
    set((state) => ({ cardUnlocks: [...state.cardUnlocks, { id: `${card.id}-${Date.now()}`, card }] })),

  dismissCardUnlock: (id) =>
    set((state) => ({ cardUnlocks: state.cardUnlocks.filter((u) => u.id !== id) })),

  setCalcFloor: (v) => set({ calcFloor: v }),
  setShowFilters: (v) => set({ showFilters: v }),
  setActiveGames: (games) => set({ activeGames: games }),
  // A newly tracked game also gets switched on in Portfolio's game filter — otherwise a game the
  // user had toggled off there long ago would look like it was tracked but showed nothing.
  setTrackedGames: (games) =>
    set((state) => ({
      trackedGames: games,
      activeGames: Array.from(new Set([...state.activeGames, ...games.filter((g) => !state.trackedGames.includes(g))])),
    })),
  setTimeFrame: (frame) => set({ timeFrame: frame }),
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
        trackedGames: state.trackedGames,
        timeFrame: state.timeFrame,
        hiddenGroups: state.hiddenGroups,
        lastPriceRefresh: state.lastPriceRefresh,
      }),
    }
  )
)
