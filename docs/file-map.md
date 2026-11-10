# Full file map

Moved out of CLAUDE.md (2026-10-30) so it's read only when needed. Section numbers (§N) refer to
the original CLAUDE.md layout.

## Full File Map

```
TCGHaven/
├── firestore.rules                ← Firestore security rules — public read/admin write on
│                                     catalog/*, catalog_snapshot/*, catalog_meta/*, registry/*,
│                                     sync_status/*; per-user read/write on users/{uid}/**
│                                     (§5, §17, §18) — this is the real write gate for the client
│                                     SDK writes Admin Catalog makes directly; the several Next.js
│                                     API routes that also need admin-only writes have their own
│                                     separate caller check now too, see §5's "Auth model" note
├── storage.rules                  ← Firebase Storage rules — catalog image uploads (Admin
│                                     Catalog's ImageUploadField)
├── firebase.json, .firebaserc     ← Just enough config for `firebase deploy --only
│                                     firestore:rules` (this app has no Firebase Hosting/Functions
│                                     — those sections of firebase.json don't exist here)
│
├── scripts/
│   ├── download-card-catalog.mjs  ← Thin CLI entry point (`npm run download-cards`) — calls
│   │                                 scripts/lib/catalog-sync.mjs, no local file writes anymore.
│   ├── check-image-health.mjs     ← `npm run check-images -- <game>|all` (§16) — full one-time
│   │                                 catalog scan seeding catalog_meta/{game}.brokenImageIds;
│   │                                 the ongoing per-sync check only covers new/already-flagged
│   │                                 cards, so this is what gives it a real baseline.
│   ├── gen-icons.mjs              ← Generates PWA icons at multiple sizes
│   └── lib/
│       ├── catalog-sync.mjs       ← The actual per-game scraping + Firestore-sync logic
│       │                             (downloadPokemon/downloadLorcana/downloadRiftbound/
│       │                             downloadOnePiece/downloadMTG/syncToFirestore/ensureSignedIn),
│       │                             shared by both the CLI script and each
│       │                             app/api/sync/{game}/sync.ts (§17 — not route.ts directly,
│       │                             see §5's "Auth model" note for why that split exists)
│       ├── text-norm.mjs          ← normSetName(), levenshtein(), matchSetName() — fuzzy set
│       │                             matching (Riftbound only — One Piece needs none, §10)
│       ├── pokemon-groups.mjs     ← fallbackPokemonSetId() — TCGplayer's older Pokémon group
│       │                             names → set ids (§13 Pokémon)
│       ├── pokemon-variants.mjs   ← editions × finishes: subtype classifier, variantPrices,
│       │                             default printing (§7 Editions & Finishes) — shared with
│       │                             lib/pricing.ts; tests: `npm run test:variants`
│       ├── pokemon-jp.mjs         ← Japanese catalog building blocks (§7 Japanese Pokémon)
│       ├── onepiece-tcgplayer.mjs ← One Piece: every card = a TCGplayer product (`tcgProductId`),
│       │                             apitcg secondary; existing cards never change (games.md One
│       │                             Piece) — tests: `npm run test:onepiece-source`
│       ├── yugioh-tcgplayer.mjs   ← Yu-Gi-Oh!: every English single = a TCGplayer product
│       │                             (`tcg-{productId}`), editions in variantPrices, set types
│       │                             (games.md Yu-Gi-Oh!) — tests: `npm run test:yugioh-source`
│       ├── pokemon-tcgplayer.mjs  ← English catalog: TCGplayer primary + GitHub secondary — linking,
│       │                             variants, new sets, claimed sets, id collisions (games.md
│       │                             Pokémon) — tests: `npm run test:pokemon-source`
│       ├── snapshot-codec.mjs     ← gzipped catalog snapshots (§4) — `npm run test:snapshot`
│       └── price-fallback.mjs     ← fillPokemonPriceGaps() — gap-only backup prices from
│                                     pokemontcg.io / tcgdex (§13 Pokémon)
│
├── lib/
│   ├── accountRoles.ts             ← Account titles (Regular / Premium / Creator / Staff), useAccountRole();
│   │                                 staff writes in firebase/accountRolesStaff.ts (community-and-badges.md)
│   ├── usage.ts                    ← Counts-only usage tracking written by each app (docs/insights.md)
│   ├── stats/aggregate.ts          ← The Statistics totals job (stats_daily); types in stats/types.ts
│   ├── finance.ts                  ← Finances: the Owner's cost tracker (finance/costs)
│   ├── premium.ts                  ← Haven Premium prices (premium/config) and promo codes (promo_codes)
│   ├── scan/                       ← The card scanner's site side (card-scanner.md):
│   │   ├── scanMatch.ts            ←   OCR lines → catalog candidates (pure; `npm run test:scan`)
│   │   ├── decide.ts               ←   text score + picture distance → matched / pick / none
│   │   ├── server.ts               ←   loads catalogs, adds Add-Card rows (for the route)
│   │   └── scanner.ts              ←   talks to the native scanner (CardScanner plugin)
│   ├── types.ts                   ← Card, SoldCard, Game, Condition, GAME_COLORS, etc. — §19 has
│   │                                 the full current Card shape
│   ├── store.ts                   ← Zustand store — mostly in-memory, persists a small
│   │                                 filter/display-prefs slice to localStorage (§20)
│   ├── csv.ts                     ← parseCSVText()/parseCsvRecords() for API routes (quirk #28)
│   ├── utils.ts                   ← cn(), formatCurrency(), cardIdentityKey()/isFirstCopyOfCard()
│   │                                 (inventory grouping + "Card Unlocked" detection — §19, §20),
│   │                                 riftboundVariantFlags()/riftboundInherentFoil() (the shared
│   │                                 Riftbound foil-classifier — §9), openEbaySearch()
│   ├── firebase/
│   │   ├── config.ts              ← Firebase app init, auth, db, storage instances, ADMIN_UID
│   │   ├── adminAuth.ts           ← ensureAdminAuth() — signs the server-process auth instance
│   │   │                             in as the ADMIN_EMAIL/PASSWORD sync account, once per
│   │   │                             process, for server-side admin Firestore writes (§17)
│   │   ├── verifyAdminRequest.ts  ← verifyAdminRequest(request) — the real per-request caller
│   │   │                             check every admin-only write route now runs first (§5)
│   │   ├── authFetch.ts           ← adminFetch() — client-side fetch wrapper that attaches the
│   │   │                             caller's Firebase ID token for the above (§5)
│   │   ├── db.ts                  ← loadCards, saveCard, editCard, removeCard, removeCards
│   │   │                             (writeBatch'd multi-delete — Inventory's "delete all lots"),
│   │   │                             newCardRef, loadSoldCards/saveSoldCard/deleteSoldCard (§19),
│   │   │                             addPricePoint/applyPriceUpdatesBatch (dedupe to one
│   │   │                             price-history point per day — §13, §18)
│   │   └── collections.ts         ← Personal Collections CRUD (§6) — users/{uid}/collections/*
│   ├── auth-errors.ts             ← friendlyAuthError() — shared Firebase error messages
│   ├── api/
│   │   ├── syncStatus.ts          ← recordSyncStatus()/getSyncStatus()/getAllSyncStatuses() —
│   │   │                             durable per-job success/failure record at sync_status/{id},
│   │   │                             read by Admin Catalog's Sync panel (§17, §18)
│   │   ├── syncHealth.ts          ← findNewRarities() — diffs a sync's rarity values against
│   │   │                             CARDEX_RARITY_ORDER, used by every game's sync.ts (§16)
│   │   ├── catalog.ts             ← loadCatalog()/loadVisibleCatalog()/regenerateSnapshot()/
│   │   │                             invalidateCatalogCache() — Firestore-backed
│   │   │                             catalog read/write core shared by all 5 games (§4)
│   │   ├── cardSearch.ts          ← searchCatalog()/rankCards() — the eBay-style search
│   │   │                             ranking every card search uses (§12); tests in
│   │   │                             cardSearch.test.mts (`npm run test:search`)
│   │   ├── searchTerms.ts         ← searchOptionsFor(game) — per-game extra searchable words
│   │   │                             (rarity labels, Riftbound cardType, One Piece "parallel")
│   │   ├── registry.ts            ← loadSetRegistry()/updateSetRegistry() etc. — Firestore
│   │                             registry/main doc, short in-process staleness cache (§17)
│   │   ├── search.ts              ← searchCards(), getSetsForGame()/invalidateSetsCache() —
│   │   │                             unified entry point (§5's New Set cache note)
│   │   ├── pokemon.ts             ← searchPokemonCards()
│   │   ├── lorcana.ts             ← searchLorcanaCards(), getLorcanaSets() (merges in manual/
│   │   │                             registry-only sets — §5)
│   │   ├── riftbound.ts           ← searchRiftboundCards(), getRiftboundSets()
│   │   ├── onepiece.ts            ← searchOnePieceCards(), getOnePieceSets() (registry-backed,
│   │   │                             no live sets API — mirrors riftbound.ts's shape, §10)
│   │   ├── yugioh.ts              ← searchYugiohCards(), getYugiohSets() (catalog_meta/yugioh,
│   │   │                             written by the sync), yugiohDisplayName()
│   │   └── mtg.ts                 ← searchMtgCards(), getMtgSets() (live api.scryfall.com/sets +
│   │                             manual-registry merge — mirrors pokemon.ts's shape, §11)
│
├── app/
│   ├── layout.tsx                 ← Root HTML layout, ClientWrapper (SSR disabled)
│   ├── page.tsx                   ← Portfolio page (root route "/")
│   ├── inventory/page.tsx         ← Inventory page wrapper
│   ├── cardex/page.tsx            ← Cardex page wrapper (includes Personal Collections tab, §6)
│   ├── admin/page.tsx             ← Admin Catalog page wrapper (§5)
│   ├── admin/accounts/page.tsx    ← Staff portal Accounts: give accounts their title (AccountsPage.tsx)
│   ├── creator/page.tsx           ← Creator Studio (CreatorPage.tsx) — Creators only
│   ├── admin/statistics, admin/finances, admin/premium ← Insights pages (docs/insights.md)
│   ├── api/cron/stats, api/admin/stats ← The Statistics totals job (cron secret / staff "Refresh now")
│   ├── settings/page.tsx          ← Redirects to /profile?settings=1 (Settings is a panel on the
│   │                                 profile now — see the staff-portal note in §5)
│   ├── portfolio/
│   │   ├── [cardId]/page.tsx      ← Individual card detail page → CardDetailPage.tsx
│   │   └── analytics/page.tsx     ← Portfolio analytics (dynamic-imported, ssr:false) →
│   │                                 components/portfolio/PortfolioAnalyticsPage.tsx — linked
│   │                                 from every Portfolio stat tile, undocumented elsewhere
│   ├── sold/page.tsx              ← Sold cards tracker → components/pages/SoldPage.tsx (§19)
│   ├── login/page.tsx
│   ├── signup/page.tsx            ← Invite-passcode-gated signup (§19)
│   └── api/
│       ├── cards/search/route.ts  ← Unified search proxy (avoids browser CORS), capped at 40
│       │                             results (§12)
│       ├── cards/scan/route.ts    ← POST — the iPhone card scanner: OCR lines → ranked catalog
│       │                             candidates (lib/scan/server.ts; card-scanner.md)
│       ├── cardex/route.ts        ← Cardex grid data (?game=&set=)
│       ├── sets/route.ts          ← Set list for AddCardDialog autocomplete (?game=)
│       ├── auth/verify-passcode/route.ts ← POST — checks a submitted signup code against the
│       │                             server-only SIGNUP_PASSCODE env var (§19); no auth of its
│       │                             own (it IS the auth gate), never echoes the real code back
│       ├── set-registry/route.ts  ← GET full registry (public); PUT a structured patch to one set
│       │                             (Needs Review editor); POST registers a brand new set
│       │                             (Admin Catalog "New Set"); DELETE removes a `source:
│       │                             "manual"` set. PUT/POST/DELETE all admin-gated via
│       │                             verifyAdminRequest() (§5, §17)
│       ├── admin/catalog/
│       │   ├── route.ts           ← GET read-only listing incl. hidden cards (§5), no auth check
│       │   ├── search/route.ts    ← GET whole-catalog cross-set search, capped at 300 results
│       │   │                         (§5), no auth check (read-only)
│       │   ├── lookup/route.ts    ← POST exact-match external price/image lookup (§5) — One
│       │                             Piece's case needs a live tcgcsv group lookup by
│       │                             `abbreviation` first (no registry group-id to read, §10).
│       │                             Admin-gated (verifyAdminRequest()) since it proxies live
│       │                             external requests on the caller's behalf.
│       │   ├── invalidate/route.ts← POST — drops the server's catalog cache for a game (§4, §5).
│       │   │                         Admin-gated.
│       │   └── raw-source/route.ts← GET — Raw Source Check diff, Riftbound-only (§5)
│       ├── sync/
│       │   ├── pokemon-jp/{route.ts,sync.ts} ← Japanese Pokémon catalog (§7); cron runs it at
│       │   │                         most once a day
│       │   ├── pokemon/{route.ts,sync.ts} ← POST — syncs Pokémon via scripts/lib/catalog-sync.mjs.
│       │   │                         route.ts's POST checks the caller (verifyAdminRequest) then
│       │   │                         calls sync.ts's runPokemonSync(), which has no auth check of
│       │   │                         its own — that's what the cron route imports directly (§17,
│       │   │                         §18; see §5's "Auth model" note for why the split exists).
│       │   │                         Every other game's sync route below follows this same
│       │   │                         route.ts/sync.ts split.
│       │   ├── lorcana/{route.ts,sync.ts} ← syncs Lorcana + registers any new sets (§17)
│       │   ├── riftbound/{route.ts,sync.ts} ← syncs Riftbound + TCGPlayer group-matching (§17)
│       │   ├── onepiece/{route.ts,sync.ts} ← syncs One Piece + registers any new sets, no
│       │   │                         group-matching needed (§10, §17)
│       │   ├── mtg/{route.ts,sync.ts} ← syncs MTG (§11, §17). NOT on the automatic cron below
│       │                             yet — manual-click-only until Firestore write-quota impact
│       │                             is confirmed OK (~99k writes on first run). See "MTG
│       │                             Integration.md" at the repo root.
│       │   └── yugioh/{route.ts,sync.ts} ← syncs Yu-Gi-Oh! (may outrun the function limit —
│       │                             the daily job .github/workflows/sync-yugioh.yml runs the CLI)
│       ├── cron/
│       │   └── sync-prices/route.ts ← GET/POST, secret-protected — calls the pokemon/lorcana/
│       │                             riftbound/onepiece sync.ts functions above twice a day (MTG's
│       │                             full sync excluded on purpose, see sync/mtg above — but its
│       │                             lightweight checkForNewMtgSets() runs here every time, see
│       │                             §18), triggered by an external scheduler outside this repo
│       └── prices/
│           ├── pokemon/route.ts   ← Batch Pokémon price lookup (Portfolio refresh) — catalog-only
│           ├── lorcana/route.ts   ← Batch Lorcana price lookup — catalog-only
│           ├── riftbound/route.ts ← Batch Riftbound price lookup — catalog-only
│           ├── onepiece/route.ts  ← Batch One Piece price lookup — catalog-only, no isFoil
│           │                         branching (no foil/non-foil duality — §10)
│           ├── yugioh/route.ts    ← Batch Yu-Gi-Oh! price lookup — catalog-only, by edition
│           └── mtg/route.ts       ← Batch MTG price lookup — catalog-only, isFoil-branching
│                                     (same shape as lorcana/route.ts — §11)
│
└── components/
    ├── GamePicker.tsx             ← The game bubbles on Inventory and the Cardex: one swipeable line on phones, spread out on desktop
    ├── UsageTracker.tsx           ← Feeds Statistics: time, sessions, pages used + a counts-only account summary
    ├── admin/insights/            ← Staff portal Insights: StatisticsPage, FinancesPage, PremiumPage, charts.tsx
    ├── CardUnlockToast.tsx        ← "Card Unlocked" celebration toast, mounted once in
    │                                 ClientWrapper.tsx — see §20's note
    ├── auth/
    │   ├── AuthProvider.tsx        ← Firebase auth context + data loading on login +
    │   │                             verifyPasscode() (§19's invite-gated signup)
    │   └── AuthGuard.tsx           ← Redirects unauthenticated users to /login
    ├── layout/
    │   ├── Sidebar.tsx             ← Desktop sidebar + mobile bottom nav
    │   └── ClientWrapper.tsx       ← Mounts CardUnlockToast globally
    ├── inventory/
    │   ├── AddCardDialog.tsx       ← Add/edit card modal with live search dropdown; fires the
    │   │                             "Card Unlocked" toast on a genuinely new print (§20)
    │   └── ScanReviewDialog.tsx    ← After the iPhone scanner: printing, condition, quantity,
    │                                 then "Add N cards" (saves like AddCardDialog — keep in step)
    ├── pages/
    │   ├── InventoryPage.tsx       ← Card list, search, filter, delete
    │   ├── PortfolioPage.tsx       ← P&L tracking, price refresh, sort/filter
    │   ├── CardDetailPage.tsx      ← Individual card detail (app/portfolio/[cardId]/page.tsx)
    │   ├── SoldPage.tsx            ← Sold-cards tracker (app/sold/page.tsx, §19) — sell a card
    │   │                             out of Inventory into users/{uid}/soldCards, or restore one
    │   │                             back (reuses AddCardDialog's addCard path, not a "new
    │   │                             unlock" — see §20)
    │   ├── CardexPage.tsx          ← Pokédex-style collection tracker (Pokemon + One Piece + MTG +
    │   │                             Lorcana + Riftbound + the Personal Collections tab, §6)
    │   ├── PersonalCollectionsView.tsx ← Per-user custom collections UI (§6, Lorcana/Riftbound
    │   │                             only today) — rendered inside CardexPage's "Personalized
    │   │                             Collections" tab
    │   ├── AdminCatalogPage.tsx    ← Admin Catalog page (§5): SyncPanel (§17), CatalogBrowser
    │   │                             (incl. whole-catalog search), CardTable, AddCardForm,
    │   │                             EditCardForm, NewSetForm, RawSourceCheckPanel
    │   └── ProfilePage.tsx         ← Your profile / someone else's (§19 Friends) — banner ⚙️ opens
    │                                 Settings (components/friends/SettingsDialog.tsx)
    └── portfolio/
        ├── PriceHistoryChart.tsx   ← Recharts line chart for price over time
        └── PortfolioAnalyticsPage.tsx ← app/portfolio/analytics/page.tsx's real component,
                                      dynamic-imported with ssr:false — linked from every
                                      Portfolio stat tile
```

---
