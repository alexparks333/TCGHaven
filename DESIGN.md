# TCGHaven — Project Design Document

## Overview
A personal TCG (Trading Card Game) collection management app for Mac and iPhone, built as a Progressive Web App (PWA) using Next.js. Accessible via Safari on iPhone (add to home screen) and on Mac via any browser.

---

## Games Supported
- **Pokemon** — price data via Pokemon TCG API (free)
- **Lorcana** — price data via Lorcana API / lorcana.gg
- **Riftbound** — manual entry initially (very new game, limited API support)

---

## Section 1: Inventory
**Purpose:** Track every card you own across all games.

**Features:**
- Game tabs: Pokemon | Lorcana | Riftbound
- Add card: Name, Set, Number, Condition (Mint/NM/LP/MP/HP), Quantity, Purchase Price, Purchase Date, Foil/Holo toggle
- Quick search + filter (by set, condition, name)
- Bulk import via CSV
- Card image fetched automatically from API
- Edit / delete cards

**Data Model:**
```
Card {
  id: string
  game: "pokemon" | "lorcana" | "riftbound"
  name: string
  set: string
  setCode: string
  number: string
  condition: "mint" | "near_mint" | "lightly_played" | "moderately_played" | "heavily_played"
  quantity: number
  purchasePrice: number
  purchaseDate: string (ISO)
  isFoil: boolean
  imageUrl?: string
  apiId?: string  // external API reference
}
```

---

## Section 2: Portfolio
**Purpose:** See the real-time value of your collection and track investment performance.

**Features:**
- **Hero stats bar:** Total Collection Value | Total Invested | Total Gain/Loss | % Return
- **Portfolio breakdown chart:** Pie chart by game showing value distribution
- **Cards table:** Each card shows current price, purchase price, P&L, % change — sortable
- **Card detail view:** Click any card → price history chart (30d / 90d / 1y / All), key stats
- Color-coded gains (green) / losses (red)
- Filters: by game, by date range, sort by gain/loss

**Price refresh:** On-demand "Refresh Prices" button (calls APIs), last-updated timestamp shown.

---

## Section 3: Pack Analysis
**Purpose:** Help you decide which packs/products are worth buying based on EV (Expected Value).

**Features:**
- List of current sets per game with pack price
- **EV Calculator:** pulls pull rates + card values → calculates Expected Value per pack
- Visual: "Worth It" / "Not Worth It" badge based on EV vs pack price
- Sort sets by EV, value ratio, or ROI
- Drill into a set to see: top chase cards, their pull rates, individual contribution to EV
- Manual pack price entry (since retail prices vary)

---

## Tech Stack

| Layer | Choice | Reason |
|-------|--------|--------|
| Framework | Next.js 14 (App Router) | SSR + great PWA support |
| Language | TypeScript | Type safety |
| Styling | Tailwind CSS + shadcn/ui | Fast, beautiful UI |
| Charts | Recharts | React-native charts, price history |
| State | Zustand + localStorage | Simple, persistent, no backend needed |
| Price APIs | Pokemon TCG API, Lorcana API | Free tier available |
| Deployment | Vercel (free) | Easy PWA hosting, HTTPS required for PWA |

---

## App Structure

```
TCGHaven/
├── app/
│   ├── layout.tsx          # Root layout with nav
│   ├── page.tsx            # Dashboard home
│   ├── inventory/
│   │   └── page.tsx        # Inventory with game tabs
│   ├── portfolio/
│   │   ├── page.tsx        # Portfolio overview
│   │   └── [cardId]/
│   │       └── page.tsx    # Card detail + price chart
│   └── pack-analysis/
│       └── page.tsx        # Pack EV analysis
├── components/
│   ├── ui/                 # shadcn components
│   ├── inventory/
│   │   ├── CardTable.tsx
│   │   ├── AddCardDialog.tsx
│   │   └── GameTabs.tsx
│   ├── portfolio/
│   │   ├── HeroStats.tsx
│   │   ├── PortfolioChart.tsx
│   │   └── PriceHistoryChart.tsx
│   └── pack-analysis/
│       ├── SetCard.tsx
│       └── EVBreakdown.tsx
├── lib/
│   ├── store.ts            # Zustand store
│   ├── types.ts            # TypeScript types
│   └── api/
│       ├── pokemon.ts      # Pokemon TCG API client
│       └── lorcana.ts      # Lorcana API client
└── public/
    └── manifest.json       # PWA manifest
```

---

## PWA Setup
- `manifest.json` with app name, icons, theme color
- `next.config.js` with PWA headers
- Add to Home Screen on iPhone via Safari Share → Add to Home Screen
- Dark/light mode following system preference

---

## Phase 1 (Prototype) Checklist
- [x] Design document
- [ ] Project scaffold (Next.js + Tailwind + shadcn)
- [ ] Zustand store + localStorage persistence
- [ ] Inventory: Add/view/delete cards, game tabs
- [ ] Portfolio: Value totals, card table with P&L
- [ ] Portfolio: Price history chart (mock data → real API)
- [ ] Pack Analysis: Set list with EV estimates
- [ ] PWA manifest + mobile-responsive layout
- [ ] Pokemon TCG API integration for prices + images
