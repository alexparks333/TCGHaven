# TCGHaven

A collector app (web + iPhone) for tracking TCG cards across Pokémon (EN + Japanese), Lorcana,
Riftbound, One Piece, Magic, Yu-Gi-Oh!, Star Wars: Unlimited, Gundam, Flesh and Blood, Digimon and
Palworld, plus a staff portal for the shared card catalog and Haven Badges.
Next.js 14 App Router · TypeScript · Tailwind v3 · Firebase Auth + Firestore + Storage · Zustand ·
three.js. Deployed on Vercel.

**This file is the short core. The detail lives in `docs/` — read the matching doc before working
in that area:**

| Working on… | Read |
|---|---|
| The card catalog, caching, staff portal / Admin Catalog, syncs, the price cron | `docs/catalog.md` |
| A game's data source, schema, variants, adding a set | `docs/games.md` |
| **Adding a whole new game** (e.g. Yu-Gi-Oh!) — every phase and file, step by step | `docs/adding-a-game.md` |
| Card search ranking, prices / price history, the Cardex | `docs/search-prices-cardex.md` |
| Friends, profiles, Haven Badges, the pin book, 3D pins, HavenRelief, the Relief Studio, badge tiers | `docs/community-and-badges.md` |
| Firestore collections, the Card object, inventory caching, the Zustand store | `docs/user-data.md` |
| The iPhone app (Capacitor: `capacitor.config.ts`, `ios/`), the site↔app bridge (`lib/nativeApp.ts`) — how it works, then its status and plan | `docs/ios-app.md` |
| The card scanner (`ios/App/App/CardScanner.swift`, `lib/scan/`, `/api/cards/scan`) | `docs/card-scanner.md` |
| Training the scanner's picture AI on the RTX 4090 PC | `docs/training-ai.md` |
| Staff portal Statistics & Finances, usage tracking (`usage_days`, `user_stats`, `stats_daily`) | `docs/insights.md` |
| Haven Premium's money side: Apple's cut, the Small Business Program, pricing plan, automatic costs | `docs/premium-business.md` |
| Where a file lives | `docs/file-map.md` |
| The full story behind any gotcha below | `docs/quirks.md` |

## Running the app

**Port 4000 belongs to a different project (AuctionHous-TCG). Never kill, restart or touch anything
on port 4000.** TCGHaven is port 3000 only; scope any kill to 3000 (Mac: `lsof -ti :3000 | xargs -r
kill -9`; Windows: `netstat -ano | findstr :3000` then `taskkill /PID <pid> /T /F`). Never use broad
kills like `pkill -f "next dev"`.

```bash
npm run dev            # port 3000, hot reload (scripts/dev.mjs — works on Mac and Windows; 4GB heap)
npm run build && npm run start   # production on 3000; rebuild after any CODE change
npm run typecheck      # tsc --noEmit — run before trusting a change
npm run lint
npm run download-cards # re-sync catalogs into Firestore (MTG only with -- --include-mtg; MTG also syncs daily via .github/workflows/sync-mtg.yml)
npm run check-images -- <game>|all
npm run test:search / test:snapshot / test:variants / test:pokemon-source / test:onepiece-source / test:yugioh-source / test:tcgplayer-games / test:scan
```

- The owner works on both a Mac and a Windows PC (RTX 4090). `.env.local` is gitignored and must be
  copied between them by hand.
- Catalog data is live in Firestore — no rebuild needed for a sync or an Admin Catalog edit. The
  staff portal's Sync buttons do the same as `download-cards`; Pokémon's can outrun a Vercel
  function limit, so `npm run download-cards` locally is its reliable fallback.
- Removed on purpose — don't bring back: Pack Analysis (2026-10-08) and Spending (2026-10-24).
  Leftover `registry/main` `packAnalysis` fields and `users/{uid}/purchases` docs are unread.
- **Deploy gate:** every push to main runs `.github/workflows/checks.yml` (typecheck, lint, 11 test
  suites, production build, ~90 s); Vercel holds the new version off www.tcghaven.org until it
  passes. Failed → fix and push again (`gh run watch` shows why); Vercel's Force Promote is the
  emergency override. CI uses only the six public `NEXT_PUBLIC_FIREBASE_*` repo variables — never real secrets.
- A change to any `route.ts`'s exports or handler signature needs a real `npm run build` too:
  `tsc` alone won't catch an invalid Next.js route export (quirk 24).
- HavenRelief (the pin AI) runs on the Windows PC: `tools/havenrelief/` (README there);
  `.venv\Scripts\python server.py` serves the Relief Studio at `http://127.0.0.1:7861`.

## The big picture

- **Shared catalog** — every card's name, image, set, rarity and price lives in Firestore
  `catalog/{game}/cards/{id}` (public read, staff write), read through an in-memory per-process
  cache (`lib/api/catalog.ts`). Kept fresh by per-game syncs (`scripts/lib/catalog-sync.mjs`),
  twice a day (09:00 + 21:00 UTC — tcgcsv publishes ~20:05 UTC) via the cron route. Every catalog write must stamp `updatedAt: serverTimestamp()`.
- **Inventory** — `users/{uid}/cards/*`, written only through `lib/firebase/db.ts`. Prices are never
  stored per user: they're laid over cards from the catalog (`lib/pricing.ts` `catalogPrice()` is
  the one pricing rule). Catalog ↔ inventory link: `card.apiId` = catalog `id`.
- **Staff portal** — `/admin`, its own app and sign-in (`lib/firebase/staff.ts`): Catalog, Sync,
  Needs Review, Badges, Team. Admin-only API routes check the caller with `verifyAdminRequest()`;
  the client sends `adminFetch()`.
- **Community** — Friends, profiles (`/u/{username}`), shared Cardex, Haven Badges (pin books,
  3D pins, two looks by progress), Pin Display.

## Rules that bite (one line each — full write-ups in `docs/quirks.md`)

1. Code changes need a rebuild in production; catalog data doesn't.
2. Firestore rejects `undefined` — strip it (`clean()` in db.ts; badge catalog saves via JSON round-trip).
3. External card APIs are called server-side only (CORS); search goes through `/api/cards/search`.
4. Lorcana Enchanted/Epic/Iconic only come from lorcast's rarity queries — never drop Phase 2.
5. Riftbound Alt Art / Overnumbered / Signature share a collector number — match by `apiId`.
6. Lorcana images are AVIF.
8. `apiId` is the catalog card's `id`.
9. Pokémon / One Piece / MTG Cardex groups are automatic (series / code prefix / set_type), not the registry.
11. The catalog cache self-heals after ~2 minutes via `updatedAt` deltas.
12. Lorcana matching uses the set *name*, not the numeric code.
14. A catalog write from client code must go through `regenerateSnapshot()` (it invalidates the *server's* cache).
15. `getSetsForGame()`'s cache never expires — invalidate it when writing the registry.
16. Riftbound number matching against TCGCSV must check `publicCode`, not just `number`.
17. Admin Catalog (shared truth) ≠ Personal Collections (a user's own lists).
18. Riftbound rarities are "Alt Art" and "Overnumbered", not "Showcase".
19. Prices live only in the shared catalog; inventory is cached per device (IndexedDB + change cursor).
20. Adding a game means updating every `GAMES` array by hand — grep, don't trust tsc (`docs/adding-a-game.md` lists them all).
21. Every early return in the Cardex fetch effect must reset `loading`.
22. Merge `registry/main` over `EMPTY_REGISTRY` — stored docs can lag the type.
23. A `$` in an env value must be escaped `\$`; the download script parses `.env.local` itself.
24. A `route.ts` may only export Next's allowed names — shared logic goes in a sibling `sync.ts`.
25. Two writers to one Firestore doc need `{ merge: true }`.
26. eBay ⌘/Ctrl-click is copied by hand at each card tile — follow the convention.
27. Requests to `cards.scryfall.io` need a `User-Agent`.
28. Never split a tcgcsv CSV on newlines; read columns by header name; send an honest User-Agent.
29. Catalog map fields: write with `update()`, compare with `stableStringify()`.
30. A `page.tsx` wraps its lazy component (`export default function Page()`), never exports it directly.
31. `sharpImageUrl()` upgrades old thumbnail-size inventory images.
32. Every card `<img>` goes through `cardImage(url, size)`.
33. Shared docs (registry, badge catalog, Text Keys) are saved as a change on the latest copy — `updateSetRegistry()`, `saveBadgeCatalog(db, base, next)` — never `setDoc` of a copy.
34. Pokémon EN: TCGplayer decides which cards exist, GitHub is the check; a card's id never changes (`pokemon-tcgplayer.mjs`, run `npm run pokemon-source-report` before touching matching).
36. Yu-Gi-Oh!: every card = one TCGplayer product (`tcg-{productId}`); editions are `variantPrices`; rarity versions are separate cards (`yugioh-tcgplayer.mjs`, `npm run yugioh-source-report`).
37. Star Wars: Unlimited / Gundam / Flesh and Blood / Digimon / Palworld: one shared TCGplayer engine, a settings block per game (`tcgplayer-games.mjs` `TCGPLAYER_GAMES`, `npm run tcgplayer-games-report`) — add the next TCGplayer-only game there, don't copy.
35. One Piece: every card = one TCGplayer product (`tcgProductId`); existing cards never change what they show (`onepiece-tcgplayer.mjs`, `npm run onepiece-source-report`).

## Badges & the Relief Studio — the essentials

(Full detail: `docs/community-and-badges.md`.)

- Books and badges are one Firestore doc, `badge_catalog/main`, edited in the staff portal
  (`components/admin/BadgesAdmin.tsx`); read live via `useBadgeCatalog()`.
- **Tiers** (`lib/badges.ts` `badgeTier()`): Grayscale (1) / Full (3), unlocked by current
  progress at each badge's `tiers` percentages (default 75 / 90). No Painted look any more (removed
  2026-11-03) — read old saved settings only through `tierPercents()` / `looksOn()`. Followed by the pin book,
  phone book, shelf counts, Pin Display and the 3D view. The Dev panel's "Preview badge progress"
  slider fakes progress on this device (dev server only).
- **3D pins** (`components/badges/pinRelief.ts` + `PinInspector.tsx`): a relief built from the art
  with a height map and an object-space normal map, gold skirt edges, a per-pixel finish map
  (RGBA: R = finish id + 16 × coverage, G/B = settings) and a tier look.
- **Relief Studio** (`components/admin/ReliefStudio.tsx` + `lib/reliefStudio.ts`): the AI runs once
  per picture (HavenRelief server, cached); all sculpting and finishes are live in the browser.
  "Save relief to badge" saves the badge in the same click; unsaved work is kept per badge in
  localStorage. Kits are stored in Storage under `badges/{id}/kit-*/` (rules allow subfolders).
- **HavenRelief models** (2026-11-08): Segment Anything 2.1 Large (pieces), Marigold Depth v1.1
  (layers), Marigold Normals v1.1 — all licensed for commercial use. Check a model's licence before
  swapping one in (Depth Anything V2 Base/Large and Depth Anything 3 Large/Giant are
  non-commercial). Stepped levels are ranked by borders (`lib/reliefLevels.ts`, Python twin
  `piece_heights()` — keep the two in step; `npm run test:relief`).
