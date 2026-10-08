import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { Card, PriceHistory, Game, SoldCard, CatalogSyncNotice } from './types'
import type { Purchase } from './spending/types'

interface TCGStore {
  cards: Card[]
  soldCards: SoldCard[]
  priceHistory: PriceHistory[]
  activeGame: Game
  lastPriceRefresh: string | null
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
  priceMode: 'market' | 'lowestNM'
  hiddenGroups: string[]
  catalogSyncNotices: CatalogSyncNotice[]
  cardUnlocks: { id: string; card: Card }[]

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
  applyPriceUpdates: (updates: { cardId: string; price: number; date: string }[]) => void
  setLastPriceRefresh: (date: string) => void
  addPurchase: (purchase: Purchase) => void
  setCalcFloor: (v: number) => void
  setShowFilters: (v: boolean) => void
  setActiveGames: (games: Game[]) => void
  setTrackedGames: (games: Game[]) => void
  setTimeFrame: (frame: 'entry' | '1d' | '7d' | '30d' | '365d') => void
  setPriceMode: (mode: 'market' | 'lowestNM') => void
  toggleHiddenGroup: (group: string) => void
  editPurchase: (id: string, updates: Partial<Purchase>) => void
  removePurchase: (id: string) => void
  addCatalogSyncNotice: (notice: CatalogSyncNotice) => void
  dismissCatalogSyncNotice: (id: string) => void
  pushCardUnlock: (card: Card) => void
  dismissCardUnlock: (id: string) => void
}

export const DEFAULT_TRACKED_GAMES: Game[] = ['riftbound']

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
  priceHistory: [],
  activeGame: 'pokemon',
  lastPriceRefresh: null,
  purchases: [],
  calcFloor: 0,
  showFilters: false,
  activeGames: ['pokemon', 'lorcana', 'riftbound', 'onepiece', 'mtg'] as Game[],
  trackedGames: DEFAULT_TRACKED_GAMES,
  timeFrame: 'entry' as const,
  priceMode: 'market' as const,
  hiddenGroups: [] as string[],
  catalogSyncNotices: [] as CatalogSyncNotice[],
  cardUnlocks: [] as { id: string; card: Card }[],

  loadUserCards: (cards) => set({ cards }),
  loadUserSoldCards: (soldCards) => set({ soldCards }),
  loadUserPriceHistory: (priceHistory) => set({ priceHistory }),
  loadPurchases: (data) => set({ purchases: data }),
  clearUserData: () => set({ cards: [], soldCards: [], priceHistory: [], lastPriceRefresh: null, purchases: [], catalogSyncNotices: [], cardUnlocks: [], trackedGames: DEFAULT_TRACKED_GAMES }),

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

  // Batched form of updateCardPrice + addPriceHistoryPoint — a price refresh applies one update
  // per priced card, and each of those two single-card actions does a full O(n) map/find over
  // `cards`/`priceHistory`. Calling them once per card in a loop is O(n²) and, for a collection
  // in the thousands, synchronously blocks the main thread for seconds (including starving any
  // pending route navigation waiting to commit). This does the whole batch in one O(n) pass.
  applyPriceUpdates: (updates) =>
    set((state) => {
      if (updates.length === 0) return state
      const byCard = new Map(updates.map((u) => [u.cardId, u]))
      const cards = state.cards.map((c) => {
        const u = byCard.get(c.id)
        return u ? { ...c, currentPrice: u.price, priceUpdatedAt: u.date } : c
      })
      const historyByCard = new Map(state.priceHistory.map((h) => [h.cardId, h]))
      for (const u of updates) {
        const day = u.date.slice(0, 10)
        const newPoint = { date: u.date, price: u.price }
        const existing = historyByCard.get(u.cardId)
        if (existing) {
          const deduped = existing.points.filter((p) => p.date.slice(0, 10) !== day)
          historyByCard.set(u.cardId, { ...existing, points: [...deduped, newPoint] })
        } else {
          historyByCard.set(u.cardId, { cardId: u.cardId, points: [newPoint] })
        }
      }
      return { cards, priceHistory: Array.from(historyByCard.values()) }
    }),

  setLastPriceRefresh: (date) => set({ lastPriceRefresh: date }),

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
        trackedGames: state.trackedGames,
        timeFrame: state.timeFrame,
        priceMode: state.priceMode,
        hiddenGroups: state.hiddenGroups,
        lastPriceRefresh: state.lastPriceRefresh,
      }),
    }
  )
)
