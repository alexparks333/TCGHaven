# TCGHaven — Complete Architecture & Data Reference

Personal Mac/iPhone app for tracking a TCG card collection. Built with Next.js 14 App Router,
TypeScript, Tailwind CSS v3, Firebase Auth + Firestore, Zustand.

---

## Table of Contents

1. [Tech Stack](#tech-stack)
2. [Running the App](#running-the-app)
3. [How Card Data Works (The Big Picture)](#how-card-data-works-the-big-picture)
4. [Card Catalog System — Deep Dive (Firestore-backed)](#card-catalog-system--deep-dive-firestore-backed)
5. [Admin Catalog Page — Architecture, Caching & Diagnostics](#admin-catalog-page--architecture-caching--diagnostics)
6. [Personal Collections (vs. the Admin Catalog)](#personal-collections-vs-the-admin-catalog)
7. [Pokémon — Data Source, Schema, Add-a-Set Guide](#pokemon--data-source-schema-add-a-set-guide)
8. [Lorcana — Data Source, Schema, Add-a-Set Guide](#lorcana--data-source-schema-add-a-set-guide)
9. [Riftbound — Data Source, Schema, Add-a-Set Guide](#riftbound--data-source-schema-add-a-set-guide)
10. [One Piece — Data Source, Schema, Add-a-Set Guide](#one-piece--data-source-schema-add-a-set-guide)
11. [Magic: The Gathering — Data Source, Schema, Add-a-Set Guide](#magic-the-gathering--data-source-schema-add-a-set-guide)
12. [Card Search Flow](#card-search-flow)
13. [Price Data](#price-data)
14. [Cardex Feature — How Sets Register](#cardex-feature--how-sets-register)
15. [Pack Analysis Feature — How Sets Register](#pack-analysis-feature--how-sets-register)
16. [Spending — Hardcoded Product Catalog](#spending--hardcoded-product-catalog)
17. [Automated Sync — Admin Catalog](#automated-sync--admin-catalog)
18. [Cron-Driven Price Sync](#cron-driven-price-sync)
19. [Firestore / User Data](#firestore--user-data)
20. [Zustand Store](#zustand-store)
21. [Full File Map](#full-file-map)
22. [Key Quirks & Gotchas](#key-quirks--gotchas)

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 App Router (TypeScript) |
| Styling | Tailwind CSS v3 |
| State | Zustand v4 — in-memory client cache; a small slice of filter/display prefs (not inventory data) persists to localStorage — see [§20](#zustand-store) |
| Auth | Firebase Auth (Google OAuth + email/password) |
| Database | Firebase Firestore (per-user subcollections) |
| Dev server | `npm run dev` (port 3000, hot reload) |
| Prod server | `npm run start` (also port 3000 — hardcoded via `next start -p 3000` in `package.json`; requires `npm run build` first) |

---

## Running the App

**Port 4000 belongs to a different, unrelated project (AuctionHous-TCG) that may be running on this
same machine. Never kill, restart, or otherwise touch anything on port 4000 — only ever target port
3000 for TCGHaven.** In particular, don't use broad process kills like `pkill -f "next dev"`, since
that matches every Next.js dev server on the machine, not just this one — scope any kill to port 3000
specifically, e.g. `lsof -ti :3000 | xargs -r kill -9`.

```bash
# Development (hot reload, no build needed)
npm run dev

# Production (must rebuild after any CODE change) — serves port 3000,
# same as dev; `package.json`'s "start" script hardcodes `next start -p 3000`,
# so a PORT env var has no effect here.
npm run build
npm run start

# Kill production server and restart cleanly
lsof -ti :3000 | xargs -r kill -9
npm run start

# Download fresh card catalogs (run when new sets release) — syncs straight into
# Firestore, no rebuild needed (see §4). Only still useful for actually picking up
# new upstream sets/cards; it is NOT how Admin Catalog edits get applied — see §5.
npm run download-cards

# Full one-time image-health scan for a game (or `all`) — seeds catalog_meta/{game}.brokenImageIds
# so the ongoing per-sync check (§16) has a real baseline. Run this once per game, or any time you
# suspect a broader image problem than the ongoing check would catch on its own.
npm run check-images -- riftbound
npm run check-images -- all

# Type-check only, no build output (fast — this is what CI-equivalent verification
# should run before trusting a change; `next build` also re-runs lint/type-checks
# as part of the real build, and only `next build` catches an invalid Next.js
# route-handler export/signature — see quirk #24). ESLint (next/core-web-vitals)
# also now runs as part of `npm run build`.
npm run typecheck
npm run lint
```

**Card catalog data no longer requires a rebuild to pick up changes** — as of the Firestore
migration (see [§4](#card-catalog-system--deep-dive-firestore-backed)), the catalog lives in
Firestore and is read live (with a short in-memory staleness window), not bundled into the
build. `npm run build && npm run start` is still required for actual **code** changes (editing
`.tsx`/`.ts` files), just not for `npm run download-cards` or any edit made from the Admin
Catalog page.

All of the above download+registry-sync workflow is also available as one click: Admin Catalog →
"Sync Card Data" (see [§17](#automated-sync--admin-catalog)) — a plain per-game API request with
no build/restart step, so it works identically against `npm run dev`, `npm run start`, and the
deployed Vercel app. Pokémon's sync can take several minutes (170+ sets, 20k+ cards) and may time
out on a shorter Vercel function limit — `npm run download-cards` locally has no such limit and
is the reliable fallback for Pokémon specifically.

---

## How Card Data Works (The Big Picture)

There are **two completely separate data concerns**:

### 1. Card Catalog (Search & Display) — shared, admin-owned, Firestore-backed

As of the "Migrate card catalog to Firestore as shared source of truth" migration, this is
**no longer static JSON files**. All card names, images, set names, prices, and collector
numbers live in **Firestore**, under `catalog/{game}/cards/{cardId}` — one document per card,
readable by anyone, writable only by the admin account (see `firestore.rules`). This is what
makes it a genuinely *shared* catalog: every user's copy of the app reads the same live data,
and an admin edit (hide a card, fix a name, add a missing card, register a whole new set)
applies to everyone immediately, no rebuild/redeploy required. See
[§4](#card-catalog-system--deep-dive-firestore-backed) for the caching mechanics and
[§5](#admin-catalog-page--architecture-caching--diagnostics) for the admin-facing page that
edits it.

When Alex (or the admin) types in the AddCardDialog search box, the app hits a Next.js server
route (`/api/cards/search`) which searches this Firestore-backed catalog (via an in-memory
cache, not a live Firestore read per keystroke) and returns matches. No external card-database
API call happens during a normal search.

`npm run download-cards` (`scripts/download-card-catalog.mjs`) is what keeps this catalog in
sync with the five upstream sources (Pokémon TCG data, lorcast, the Riftbound gallery/TCGCSV,
apitcg's One Piece dataset, Scryfall) — it scrapes fresh data and **writes it into Firestore**,
never clobbering an admin edit made since the last sync (see
[§4](#card-catalog-system--deep-dive-firestore-backed)). It's for picking up new upstream
cards/sets, not a prerequisite for the catalog to work at all. **MTG is the one exception** —
its first sync is deliberately not yet run; see [§11](#magic-the-gathering--data-source-schema-add-a-set-guide)
and "MTG Integration.md" at the repo root.

### 2. User Collection (Inventory)
When Alex adds a card, the card data is written to **Firestore** under
`users/{uid}/cards/{cardId}`. The Zustand store is updated immediately (optimistic UI),
and the Firestore write happens in the background. On next login, Firestore is read and
Zustand is populated.

The catalog and the user collection are connected only by the `apiId` field — the catalog's
unique card ID that gets stored on the Card object when a card is selected from search results.

---

## Card Catalog System — Deep Dive (Firestore-backed)

### Firestore collections

```
catalog/{game}/cards/{cardId}          — one doc per card, full schema (see per-game sections
                                          below). `hidden: boolean` controls visibility;
                                          `updatedAt` (serverTimestamp) drives both admin-edit-
                                          wins-over-resync logic and the delta-sync below.
catalog_snapshot/{game}/chunks/{0,1,…} — pre-sharded full-catalog snapshot, ~1500 cards/chunk
                                          (Firestore's 1MiB/doc limit), JSON-stringified in a
                                          `cards` field. What a cold app instance reads instead
                                          of scanning every card doc individually.
catalog_meta/{game}                    — { lastBulkSyncAt, brokenImageIds } — lastBulkSyncAt lets
                                          download-card-catalog.mjs know whether an admin edit
                                          happened since its last run, so it never clobbers one;
                                          brokenImageIds is the image-health check's own bookkeeping
                                          (§16) — card ids whose imageUrl doesn't actually resolve,
                                          re-verified every sync.
```

`game` is `pokemon` | `lorcana` | `riftbound`. Reads are public (`allow read: if true`);
writes require the admin UID (see `firestore.rules`).

### How reads work — `lib/api/catalog.ts`

`loadCatalog<T>(game)` is the shared entry point every real consumer goes through
(`lib/api/pokemon.ts`, `lorcana.ts`, `riftbound.ts` all call it under the hood via
`loadVisibleCatalog`, which is the same thing minus `hidden` cards). It keeps one **in-memory
cache per game, per Node.js server process** — the same "lives for the process lifetime" shape
the old static-JSON cache had, just fed from Firestore instead of a file:

1. **Cold cache** (first call, or after `invalidateCatalogCache()`): reads the full catalog from
   `catalog_snapshot/{game}/chunks/*` — cheap, a handful of doc reads instead of thousands.
2. **Warm cache, < 2 minutes old** (`STALE_MS`): served straight from memory, zero Firestore
   reads.
3. **Warm cache, ≥ 2 minutes old**: runs `pullDeltas()` — a single query for
   `catalog/{game}/cards where updatedAt > lastSyncAt` — and merges just the changed docs into
   the in-memory Map. This is why every catalog write (hide, edit, add, and the download
   script's own upserts) **must** stamp `updatedAt: serverTimestamp()` — a write that skips it
   is invisible to this delta mechanism forever, only fixable by a full cache invalidation.

`regenerateSnapshot(game)` rewrites `catalog_snapshot/{game}/chunks/*` from the current
`catalog/{game}/cards` collection and calls `invalidateCatalogCache(game)` — called after every
Admin Catalog write so a fresh app instance (or a stale one past the 2-minute window) sees the
change without a full resync.

### The cache-invalidation gotcha (client vs. server module instances)

**This bit is easy to get wrong and did in fact ship wrong once.** `regenerateSnapshot()` is
only ever called from Admin Catalog's client-side code (`AdminCatalogPage.tsx`, a `'use client'`
component) — meaning it executes in the **browser's** JS bundle, which has its own separate copy
of `lib/api/catalog.ts` (and therefore its own separate `_cache` module variable) from the copy
running in the Next.js **server** process that `/api/admin/catalog`, `/api/cards/search`,
`/api/cardex`, etc. actually read through. Calling `invalidateCatalogCache()` from the browser
only clears the browser's own unused copy — the server's cache, which is what matters, never
hears about it, and silently keeps serving pre-edit data until its own 2-minute staleness timer
happens to expire (and even then, only for cards whose write stamped `updatedAt`).

The fix (already applied): `regenerateSnapshot()` additionally does
`fetch('/api/admin/catalog/invalidate', { method: 'POST', body: { game } })` whenever
`typeof window !== 'undefined'` — a tiny server route (`app/api/admin/catalog/invalidate/route.ts`)
that calls `invalidateCatalogCache(game)` **in the server's own process**, which is what
actually needs to happen. If you ever add a new way to write to the catalog from client code,
route it through `regenerateSnapshot()` (or replicate this invalidate-fetch) rather than
inventing a new write path — otherwise the same silent-staleness bug reappears.

The exact same class of bug exists for `getSetsForGame()`'s `setsCache` in `lib/api/search.ts`
(a separate, never-expiring cache of the set picker's contents) — see
[§5](#admin-catalog-page--architecture-caching--diagnostics)'s New Set section for how that one
gets invalidated (it's simpler, because that write path is server-side already).

---

## Admin Catalog Page — Architecture, Caching & Diagnostics

`/admin` (`components/pages/AdminCatalogPage.tsx`) is the UI for the shared, Firestore-backed
catalog described in [§4](#card-catalog-system--deep-dive-firestore-backed). It is **the**
source of truth every user's search, inventory-add, and Cardex read from — not a personal
per-user thing (see [§6](#personal-collections-vs-the-admin-catalog) for the feature that
actually is per-user and easy to confuse this with). Gated by `isAdmin` (`user.uid ===
NEXT_PUBLIC_ADMIN_UID`, enforced for real by `firestore.rules`, not just hidden in the UI) —
anyone can browse the table read-only; only the admin sees the write controls.

### What it does

- **Hide / Unhide** (`toggleHideCard`) — flips `hidden` on a card's Firestore doc. Reversible,
  never deletes data. Hidden cards stay visible in this table (greyed out, "hidden" badge) but
  disappear from `loadVisibleCatalog()` — search, Cardex, Pack Analysis, everywhere else.
- **Edit** (`saveCardEdit`) — patches a card's fields, then **cascades** `number`/`name`/
  `imageUrl` (never price) to any inventory entries across all users whose `apiId` matches, via
  `editCardInFirestore`. Auto-applies with no confirm gate — [[feedback_catalog_source_of_truth]]:
  the Admin Catalog is meant to be trusted as ground truth, so an edit here should just take
  effect everywhere, not require per-user approval.
- **Add Missing Card** (`AddCardForm`) — manually add a card the scrapers missed (or a fully
  custom one) to the currently-selected set. Supports an "Auto-fetch price & image" lookup
  (`POST /api/admin/catalog/lookup`) that does an *exact* number-match query against TCGCSV/
  lorcast/pokemontcg.io — this is a convenience prefill, not the diagnostic tool (see Raw Source
  Check below for why an exact-match lookup isn't enough to answer "is this card upstream at
  all?"). Accepts an optional `prefill` prop so other tools (Raw Source Check) can hand it a
  ready-made candidate.
- **New Set** (`NewSetForm`, `POST /api/set-registry`) — registers a brand new set in
  the registry (Firestore `registry/main`), Lorcana or Riftbound only (Pokémon's set list comes live from
  `api.pokemontcg.io`, a different mechanism entirely — see [§7](#pokemon--data-source-schema-add-a-set-guide)).
  Two real use cases: (a) a real upstream set the sync hasn't auto-detected/matched yet, or (b)
  a fully custom/curated set that will never come from any scraper. Either way it's created with
  `tcgcsvGroupId`/`lorcastId` left `null` and `source: "manual"`, so a future sync never mistakes
  it for something it should be overwriting or re-scraping — cards get added to it one at a time
  via "Add Missing Card" afterward. Requires picking an existing `cardexGroup` label from that
  game's `groupOrder` (see [§14](#cardex-feature--how-sets-register)) so the new set actually
  shows up in the Cardex set picker once it has cards.
  - **Cache gotcha, same shape as the one in §4:** `getSetsForGame()` (`lib/api/search.ts`)
    caches the set picker's contents in a module-level `setsCache` that, unlike the catalog
    cache, **never expires on its own** — "only cache non-empty results so a transient API
    failure doesn't stick" means once populated it's permanent until server restart. The `POST
    /api/set-registry` route calls `invalidateSetsCache(game)` directly after writing — this one
    doesn't need the client-fetch dance §4 describes, because set creation is *already* a
    server-side round trip (unlike `regenerateSnapshot()`, which runs client-side).
  - Lorcana has its own extra wrinkle: `getLorcanaSets()` normally prefers the **live** lorcast
    `/sets` API over the registry, so a manually-created Lorcana set (which lorcast has never
    heard of) would never surface even with the registry correctly updated. Fixed by always
    merging in any `source: "manual"` registry sets that the live/fallback list doesn't already
    contain.
- **Check Raw Source** (`RawSourceCheckPanel`, `GET /api/admin/catalog/raw-source`) — Riftbound
  only, for now. Answers "is a card actually upstream and we're just silently skipping it?" by
  fetching the **raw** TCGCSV CSV and the **raw** official gallery (`playriftbound.com`)
  `__NEXT_DATA__` blob directly, then diffing each against the local catalog — deliberately
  independent of `download-card-catalog.mjs`'s own `tcgKey()`/`catalogKey()` matching logic, so
  a bug in that matching wouldn't hide the gap from this tool the way it hid it from the sync.
  Two independent diffs are shown:
  - **Gallery vs. local catalog**, matched by Riot's own card `id` (the catalog stores the
    gallery's `id` verbatim for gallery-sourced cards) — anything in the gallery with no
    matching local `id` is a card the scrape flow is missing entirely.
  - **TCGCSV rows vs. local catalog**, matched by collector number — **must** compare against
    both a card's bare `number` *and* the number+suffix embedded in its `publicCode`,
    not `number` alone. Alt Art/Overnumbered/Signature variants share their base card's bare
    `number` (the `a`/`*` suffix only ever lives in `publicCode` — see
    [§9](#riftbound--data-source-schema-add-a-set-guide)'s variant table), while TCGCSV's
    `extNumber` column always carries that suffix (e.g. `"007a/298"`). Matching only against
    `number` produces a wall of false-positive "unmatched" Alt Art rows — this was caught and
    fixed the same session this tool was built; if you touch this matching logic again, test it
    against a set with Alt Art cards (e.g. Origins) before trusting the output.
  - Each finding has an "Add" button that opens Add Missing Card prefilled from the raw source
    entry (name/number/rarity/image — price is left for the admin to fill in, since the exact
    row that matched isn't surfaced through this button, only through the separate TCGCSV-only
    diff list).
  - Real example this tool caught on first use: Vendetta's TCGCSV feed has a priced
    "Zed - Master of Shadows (Signature)" row that doesn't exist under any name in the local
    catalog at all — a genuinely missing card the normal sync silently skipped.

- **Whole-catalog Search** (`GET /api/admin/catalog/search?game=&q=`) — the search box at the top
  of `CatalogBrowser` that finds a card across every set for the active game at once (unlike the
  set-scoped table below it), capped at `MAX_RESULTS = 300` with a `truncated` flag the UI can
  check. Reads the in-memory catalog the same way every other search does (`scoreMatch`/
  `parseSearchQuery` from `lib/api/catalog.ts`) — no separate index, no writes.

### Key files

- `components/pages/AdminCatalogPage.tsx` — the whole page: `SyncPanel` (§17), `CatalogBrowser`,
  `CardTable`, `AddCardForm`, `EditCardForm`, `NewSetForm`, `RawSourceCheckPanel`, `ImageUploadField`.
- `app/api/admin/catalog/route.ts` — `GET`, read-only listing (includes hidden cards, unlike
  every other catalog consumer — the admin table needs to show and un-hide them). No auth check
  of its own — browsing is harmless, this route never writes.
- `app/api/admin/catalog/search/route.ts` — the whole-catalog search above. Also unauthenticated
  (read-only), capped at 300 results.
- `app/api/admin/catalog/lookup/route.ts` — exact-match external price/image lookup, used by
  "Auto-fetch price & image" in Add Missing Card. Never writes anything, but does proxy live
  requests to TCGCSV/lorcast/pokemontcg.io/Scryfall on the caller's behalf, so it's admin-gated
  (`verifyAdminRequest()`, see below) to avoid becoming a free abuse vector against those quotas.
- `app/api/admin/catalog/invalidate/route.ts` — `POST { game }`, drops the **server's** catalog
  cache for a game. See the cache-invalidation gotcha in [§4](#card-catalog-system--deep-dive-firestore-backed).
- `app/api/admin/catalog/raw-source/route.ts` — the Raw Source Check diff, Riftbound-only today.
- `app/api/set-registry/route.ts` — `GET` full registry (public, no auth); `PUT` a structured
  patch to one existing set entry (Settings "Needs Review" editor, itself gated behind `isAdmin`
  — see below); `POST` registers a brand new set entry (New Set form); `DELETE` removes one,
  restricted server-side to `source: "manual"` sets only (official/auto-detected sets would just
  reappear on the next sync). All four only ever touch the registry (Firestore `registry/main`),
  never TypeScript source.
- `lib/api/catalog.ts` — `loadCatalog`/`loadVisibleCatalog`/`regenerateSnapshot`/
  `invalidateCatalogCache`, plus `sortCatalogCards`/`scoreMatch`/`parseSearchQuery` shared by all
  five games' search.
- `lib/firebase/config.ts` — exports `ADMIN_UID` (from `NEXT_PUBLIC_ADMIN_UID`), used by both
  this page's `isAdmin` check and (independently, for real enforcement) `firestore.rules`.
- `lib/firebase/verifyAdminRequest.ts` / `lib/firebase/authFetch.ts` — the server-side check and
  client-side fetch wrapper behind every admin-only write route's real auth gate (see the next
  paragraph). Any route that writes shared/admin data — not just this page's own routes, but also
  the 5 `sync/{game}` routes (§17) — goes through these.

### Auth model — `isAdmin` is UX, but every write route now checks the caller too

`isAdmin` (`user.uid === NEXT_PUBLIC_ADMIN_UID`) gates which controls the UI shows, and
`firestore.rules` is the real enforcement for any write this page makes with the client Firestore
SDK directly (hide/edit/add card, image upload) — this part was always correctly gated. What
wasn't, until a later audit pass caught it: every write that instead goes through a **Next.js API
route** (`set-registry`'s PUT/POST/DELETE, `admin/catalog/invalidate`, `admin/catalog/lookup`,
and all 5 `sync/{game}` routes in §17) used to have no check of *who* was calling it — the route
itself signs in as the admin bot account (`ensureAdminAuth()`/`ensureSignedIn()`) purely so the
Firestore *write* is allowed, which is a completely different thing from verifying the *request*
came from the admin. Any anonymous caller who found one of these URLs could already trigger it.

**The fix:** every one of those routes' handlers now starts with
`const unauthorized = await verifyAdminRequest(request); if (unauthorized) return unauthorized`.
`verifyAdminRequest()` reads the caller's Firebase ID token from an `Authorization: Bearer <token>`
header and checks it against Firebase's Identity Toolkit REST API (`accounts:lookup`), rejecting
anyone whose uid isn't `ADMIN_UID` — no `firebase-admin` SDK/service account needed, matching this
codebase's existing "lightweight REST calls over a heavier server SDK" pattern
(`adminAuth.ts`). Every client-side call site that writes through one of these routes
(`AdminCatalogPage.tsx`, `SettingsPage.tsx`'s Needs Review editor, `regenerateSnapshot()` in
`catalog.ts`) uses `adminFetch()` instead of a plain `fetch()` to attach that token automatically.
Settings' "Needs Review" card is also now gated behind `isAdmin` itself — it used to be reachable
(and would attempt to write) for any signed-in user, not just the admin, even though the write
would previously have silently succeeded regardless.

---

## Personal Collections (vs. the Admin Catalog)

`components/pages/PersonalCollectionsView.tsx` (a tab inside `/cardex`, backed by
`lib/firebase/collections.ts`) is **easy to confuse with the Admin Catalog and is a
fundamentally different feature** — worth stating plainly since a past conversation conflated
them before landing on the right design:

| | Admin Catalog (§5) | Personal Collections |
|---|---|---|
| Scope | Shared — every user reads the same data | Private — `users/{uid}/collections/{id}`, one user's own |
| Who can write | Admin only (`isAdmin`, enforced by `firestore.rules`) | Any signed-in user, their own collections only |
| What it holds | Real catalog card **documents** (name, image, price, `hidden`, etc.) | A named list of **references** to existing catalog card ids — no new card data, just curation |
| Can it add a brand-new, never-cataloged card? | Yes — that's the whole point of "Add Missing Card" / "New Set" | No — `AddCardToCollectionModal` only searches the existing catalog via `/api/cards/search` |
| Purpose | Be the ground truth the rest of the app (search, Cardex, inventory) reads from | Let a user build their own themed want-list/grouping ("Fury Runes", an alt-art wishlist, a champion's cards across every set) and track completion against their own inventory, Cardex-style |

If a request is "I want to track a themed group of cards I already own or want" → Personal
Collections. If a request is "the catalog is missing/wrong about a real card, or I want a whole
new *set* other users would see too" → Admin Catalog (§5).

**Currently limited to Lorcana and Riftbound only** — `PersonalCollection['game']` is typed
`Extract<Game, 'lorcana' | 'riftbound'>`, and the game picker/create form hardcode the same two.
Pokémon/One Piece/MTG were all added to the rest of the app after this feature was built and
never got a Personal Collections equivalent; there's no technical blocker to adding the other
three games, just work not yet done.

**Foil-aware identity:** a `PersonalCollectionCard` carries its own `isFoil` field, because
Riftbound search can return two rows sharing the same catalog `id` (a non-foil and a foil
listing, when a card is priced both ways) — every place a collection card needs a stable identity
(the "already added" dedup check in the Add Card modal, drag-to-reorder, removal) keys on a
composite `${id}::${isFoil ? 'foil' : 'normal'}` (`cardKey()` in `PersonalCollectionsView.tsx`),
not the bare catalog id, so adding one variant doesn't collapse onto — or permanently block
re-adding — the other.

---

## Pokémon — Data Source, Schema, Add-a-Set Guide

### Data Source

**GitHub repository:** `github.com/PokemonTCG/pokemon-tcg-data`

This is the official Pokémon TCG SDK data repository. It contains one JSON file per set
in `cards/en/` (e.g. `sv7.json`, `swsh1.json`, `base1.json`). The download script
fetches the GitHub file listing via the GitHub API, then downloads all set files in
parallel using their raw CDN URLs (no rate limiting, no API key required).

Set metadata (names) comes from:
`https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master/sets/en.json`

**Prices:** `tcgcsv.com` category 3 (TCGPlayer mirror) — same "download script fetches this at
sync time and stores it on the card doc" shape every other game uses, see below.

### Catalog Schema (`catalog/pokemon/cards/{id}` Firestore doc)

Each card doc:
```json
{
  "id": "sv7-1",           // "{setId}-{number}" — globally unique
  "name": "Pikachu",       // card name only (no version/subtitle)
  "set": "sv7",            // set ID (matches GitHub file name without .json)
  "setName": "Stellar Crown",  // human-readable set name
  "number": "1",           // collector number as string
  "rarity": "Rare Holo",   // straight from the GitHub source's own `rarity` field — see the
                            // rarity guide below for the full 44-value taxonomy. '' for the
                            // small number of cards with none at all (mostly Basic Energy).
  "imageUrl": "https://images.pokemontcg.io/sv7/1_hires.png",
  "marketPrice": 4.21,     // from tcgcsv (normal print)
  "marketPriceFoil": 6.80, // from tcgcsv (holofoil)
  "lowPriceNM": 3.10,
  "lowPriceNMFoil": 5.25
}
```

Prices and rarity are both fetched/synced the same way every other game's are — the "Pokémon
catalog cards do NOT include price" design this doc used to describe predates the tcgcsv
price-merge phase `downloadPokemon()` now has (Phase 2, right after the GitHub card-data fetch);
this section was stale on that point until corrected. `rarity` was added later still (see the
Pokémon rarity toggle note under [§14](#cardex-feature--how-sets-register)) — before that, the
field was silently dropped at sync time despite always being present in the source data.

### Pokémon Rarity — Full Taxonomy (researched, verified current)

Cross-checked the entire 176-set GitHub dataset (1999–2026) against the live
`api.pokemontcg.io/v2/rarities` endpoint — they match exactly, **44 distinct values** as of this
writing (the newest 4 came from a set released days before this research). There is no fixed
enum anywhere upstream; new sets add new tiers regularly (2 more sets after the research above
already needed a 3rd). This is why the Cardex's rarity toggle (below) derives its list from
whatever's actually present in a set rather than a hardcoded array — the same lesson the
Riftbound rarity-filter fix already established, now generalized.

| Era | Values (oldest → newest within era) |
|---|---|
| Base/Jungle/Fossil (1999) | Common, Uncommon, Rare, Rare Holo, Promo |
| 2000–2010 | Rare Secret, Rare Shining, Rare Holo EX, Rare Holo Star, Rare Holo LV.X, LEGEND, Rare Prime |
| Black & White–XY (2011–2016) | Rare Ultra, Rare ACE, Rare BREAK |
| Sun & Moon (2017–2019) | Rare Holo GX, Rare Rainbow, Rare Prism Star, Rare Shiny, Rare Shiny GX |
| Sword & Shield (2020–2022) | Rare Holo V, Rare Holo VMAX, Amazing Rare, Classic Collection, Rare Holo VSTAR, Trainer Gallery Rare Holo, Radiant Rare |
| Scarlet & Violet (2023–2025) | Double Rare, Ultra Rare, Illustration Rare, Special Illustration Rare, Hyper Rare, ACE SPEC Rare, Shiny Rare, Shiny Ultra Rare, Black White Rare |
| Mega Evolution (2025–present) | Mega Hyper Rare, MEGA_ATTACK_RARE (displayed as "Mega Attack Rare" — the one value the API returns SCREAMING_SNAKE_CASE), Futuristic Rare, Pikachu Rare, Holo Rare V/VMAX/VSTAR, Rare Holo ex |

`CARDEX_RARITY_ORDER` (`lib/api/catalog.ts`) has all 44 with a priority number each, assigned by
first real-world appearance (an objective, reproducible ordering — there's no single "value"
hierarchy that makes sense across 25+ years of different rarity systems). A rarity not yet in
this map (a genuinely new one from a future set) still works — it just sorts after every known
value instead of being silently invisible to sorting/filtering.

### How New Pokémon Sets Are Added

New sets appear in the GitHub repo automatically when Pokémon releases them (usually
within 24 hours of release). To pull them in:

```bash
npm run download-cards   # re-downloads all sets from GitHub, syncs into Firestore
```

That's it — no `npm run build`/restart needed (see [§4](#card-catalog-system--deep-dive-firestore-backed)),
no code changes required. The download script fetches the full GitHub file listing
dynamically — it does not have a hardcoded set list. There's no Admin Catalog "New Set"
equivalent for Pokémon (its set list comes live from `api.pokemontcg.io`, not
the registry) — for Pokémon, individual missing cards can still be added via
"Add Missing Card" once the set itself exists in that live list.

### AddCardDialog behavior for Pokémon

`searchPokemonCards()` (`lib/api/pokemon.ts`) is catalog-first, not live-API-first as this section
used to say: it reads `loadVisibleCatalog<CatalogCard>('pokemon')` (same Firestore-backed,
in-memory-cached read every other game's search goes through, [§4](#card-catalog-system--deep-dive-firestore-backed))
and only falls back to a live `api.pokemontcg.io` call if the catalog is completely empty (i.e.
before any sync has ever run). When a Pokémon card is selected from the dropdown, `AddCardDialog`
calls `getPokemonCardMarketPrice(card, isFoil)` which reads prices directly from the
`card.tcgplayer.prices` object `searchPokemonCards()` built from the catalog doc's own
`marketPrice`/`marketPriceFoil`. This price is stored as `purchasePrice` if Alex leaves it blank.

The `apiId` stored on the Card is the catalog's `id` field (e.g. `"sv7-1"`). `getPokemonCardPrice(apiId,
isFoil)` (`lib/api/pokemon.ts`) is dead code with zero callers — Portfolio's price refresh reads the
catalog directly via `app/api/prices/pokemon/route.ts`, same catalog-only shape as every other
game (see [Price Data](#price-data)), not this function.

---

## Lorcana — Data Source, Schema, Add-a-Set Guide

### Data Source

**API:** `api.lorcast.com/v0` — community-maintained Lorcana card database with prices.

The download strategy is unusual and important to understand:

**Phase 1 — Text searches:** Query for `q=a`, `q=e`, `q=i`, `q=o`, `q=u`, `q=y`, `q=th`.
Since virtually every card name contains a vowel, this catches all Common, Uncommon, Rare,
Super Rare, and Legendary cards.

**Phase 2 — Rarity searches:** Query for `rarity:enchanted`, `rarity:epic`, `rarity:iconic`,
`rarity:mythic`, `rarity:special`. **This is critical.** Enchanted, Epic, and Iconic cards do
NOT appear in text searches — the lorcast API only returns them via rarity-filtered queries.
These are the most valuable cards in each set ($5–$1000+) and would be completely missing
without Phase 2. (Iconic was missing from this list until it was discovered the catalog had
zero Iconic-rarity cards despite Iconic being a real, valuable rarity tier lorcast returns.)

A `seen` Map deduplicates by card ID across both phases.

### Catalog Schema (`catalog/lorcana/cards/{id}` Firestore doc)

Each card doc:
```json
{
  "id": "5-100",                    // lorcast internal ID
  "name": "Mickey Mouse - Bob Cratchit",  // "{name} - {version}" combined
  "set": "5",                       // numeric set code as string (lorcast internal)
  "setName": "Shimmering Skies",    // human-readable set name
  "number": "100",                  // collector number as string
  "rarity": "Super_rare",           // Common, Uncommon, Rare, Super_rare, Legendary,
                                    //   Enchanted, Epic, Promo
  "imageUrl": "https://cards.lorcast.io/...",  // AVIF format image
  "marketPrice": 12.50,             // non-foil market price in USD (0 if not available)
  "marketPriceFoil": 45.00          // foil market price in USD (0 if not available)
}
```

### Important: Card Name Format

Lorcana cards have a name AND a version (subtitle). In the catalog, these are combined:
`"Mickey Mouse - Bob Cratchit"` where `Mickey Mouse` is the name and `Bob Cratchit` is
the version. The `" - "` separator is how the app splits them back apart when displaying.

When stored in the user's Card record, `card.name` = `"Mickey Mouse - Bob Cratchit"` (full),
`card.set` = the setName string (e.g. `"Shimmering Skies"`), and `card.setCode` = the
numeric set code (e.g. `"5"`).

### Lorcana Image Format

Images are **AVIF** format hosted on `cards.lorcast.io`. AVIF requires:
- Safari 16+
- Chrome 85+
- Firefox 93+

Older browsers will not display these images. This is a lorcast limitation.

### Known Lorcana Sets (as of July 2026)

| # | Set Code | Set Name | Released | Notes |
|---|----------|----------|----------|-------|
| 1 | TFC | The First Chapter | 2023-08-18 | First set |
| 2 | ROF | Rise of the Floodborn | 2023-11-17 | |
| 3 | ITI | Into the Inklands | 2024-02-23 | |
| 4 | UR (URR) | Ursula's Return | 2024-05-17 | |
| 5 | SS (SSK) | Shimmering Skies | 2024-08-09 | |
| 6 | AZS | Azurite Sea | 2024-11-01 | |
| 7 | AI (ARI) | Archazia's Island | 2025-03-07 | |
| 8 | ROJ | Reign of Jafar | 2025-05-16 | |
| — | WIW | Whispers in the Well | 2025-08-08 | First set with Epic rarity |
| — | WS | Winterspell | 2025-11-14 | Has Epic |
| — | WU | Wilds Unknown | 2026-02-27 | Has Epic |
| — | FAB | Fabled | 2025-09-05 | Premium set (no booster packs) |
| — | AOV | Attack of the Vine! | 2026-07-24 | Supplemental set |
| — | — | Promo Set 2 | ongoing | Promo cards (2 cards in catalog) |

Note: Set codes vary between lorcast (numeric like "5") and shorthand codes (like "SSK").
The `setName` string is the canonical match key used everywhere in this app.

### How New Lorcana Sets Are Added

**Three ways to do this, in increasing order of manual effort:**

1. **Admin Catalog → "New Set"** (see [§5](#admin-catalog-page--architecture-caching--diagnostics)) —
   fastest for a set that isn't fully synced yet or a curated/custom one. Registers the set in
   the registry (Firestore `registry/main`) directly from the UI with no group-metadata guessing.
2. **Admin Catalog → "Sync Card Data"** (see [§17](#automated-sync--admin-catalog)) — the steps below
   run automatically for real, newly-detected upstream sets, with conservative review-required
   defaults.
3. **Manual**, described below — what both of the above actually do under the hood, and the
   fallback if you'd rather not use either UI.

When Ravensburger releases a new set, lorcast.com adds it within days. To pull it in:

```bash
npm run download-cards   # lorcast API returns all sets automatically, syncs into Firestore
```

No `npm run build`/restart needed for the card data itself (see
[§4](#card-catalog-system--deep-dive-firestore-backed)) — only the registry entry below is what
makes a set show up in the Cardex/Pack Analysis, and that's a plain Firestore write too.

Then register the set in **the registry** (Firestore `registry/main` — this one doc replaced the
three hardcoded arrays that used to need separate edits — see [§17](#automated-sync--admin-catalog)):

```json
{ "setName": "New Set Name", "code": "XYZ", "lorcastId": "14", "releaseDate": "2026-08-01",
  "cardexGroup": "Booster Sets",
  "packAnalysis": { "included": true, "id": "NSN", "released": "2026-08-01", "packPrice": 5.99, "hasEpic": true },
  "needsReview": false, "source": "manual" }
```

- `setName` MUST exactly match the `setName` field on the catalog's Firestore card docs.
  Verify via the Admin Catalog page (`/admin` → Lorcana → pick the set from the picker), or
  `GET /api/sets?game=lorcana` for the full list of names the app currently knows about.
- `lorcastId` is the lorcast numeric set ID — check via `api.lorcast.com/v0/sets`.
- `cardexGroup` must be one of the labels in `groupOrder` for the Cardex set picker to show it
  (`"Booster Sets"`, `"Special Sets"`, or `"Promos & Other"` today).
- `packAnalysis.included: false` if it's not sold in standard booster packs (Fabled, Attack of the Vine!, etc).
- `hasEpic: true` for any set released after Shimmering Skies (set 9+); `false` for sets 1–8. This flag
  changes the foil pull rate calculation: `false` → foilSR = 22%, no Epic slot; `true` → foilSR = 20%,
  foilEpic = 1/48 packs.
- `source: "manual"` sets created via Admin Catalog's "New Set" form don't exist on lorcast at
  all — `getLorcanaSets()` (`lib/api/lorcana.ts`) specifically merges these in since the live
  lorcast `/sets` call would otherwise never include them (see [§5](#admin-catalog-page--architecture-caching--diagnostics)).

`lib/api/lorcana.ts`, `components/pages/CardexPage.tsx`, and
`app/api/pack-analysis/lorcana/route.ts` all read this file at runtime via `lib/api/registry.ts` —
no code changes needed once the entry is added.

---

## Riftbound — Data Source, Schema, Add-a-Set Guide

### Data Sources

**Card data:** `playriftbound.com/en-us/card-gallery/` — official Riot Games Riftbound
website. The page is a Next.js SSR app that embeds all card data in a `<script id="__NEXT_DATA__">`
JSON blob. The download script fetches the HTML and parses this blob — no official API needed.

**Price data:** `tcgcsv.com` — a third-party service that mirrors TCGPlayer price data as
downloadable CSV files. Riftbound cards are in TCGPlayer category 89. Each set has a
"group ID" that maps to a `ProductsAndPrices.csv` file.

### TCGCSV Group IDs (Riftbound)

These are the TCGPlayer group IDs for each set. They are hardcoded in the download script:

| Set Code | Set Name | Group ID |
|----------|----------|----------|
| OGN | Origins | 24344 |
| SFD | Spiritforged | 24519 |
| UNL | Unleashed | 24560 |
| OGS | Proving Grounds | 24439 |

When a new set releases on TCGPlayer, you need to find its group ID. Go to:
`https://tcgcsv.com/tcgplayer/89/` and look for the new group, OR search TCGPlayer for
the set and extract the groupId from the URL structure.

### Catalog Schema (`catalog/riftbound/cards/{id}` Firestore doc)

Each card doc:
```json
{
  "id": "origins-001-regular",  // Riot's internal card ID from __NEXT_DATA__
  "name": "Ahri - Alluring",   // card name as-is from official gallery
  "number": "1",                // collector number as string
  "publicCode": "OGN-001/298", // official code shown on card (e.g. "OGN-007a/298" for alt-art)
  "setCode": "OGN",            // set code: OGN, SFD, UNL, OGS, VEN, RAD
  "setName": "Origins",        // human-readable set name
  "rarity": "Common",          // Common, Uncommon, Rare, Epic (called "Champion" by Riot),
                               //   Alt Art, Overnumbered, Star (Signature = "Star" in catalog)
  "cardType": "Unit",          // Unit, Spell, Item, etc.
  "tags": ["Ahri"],            // champion tags — "Deceiver" is tagged ["LeBlanc"] etc.
  "imageUrl": "https://cmsassets.rgpub.io/...",  // Riot CDN, JPEG format
  "marketPrice": 1.25,         // TCGPlayer normal market price (0 if unpriced)
  "marketPriceFoil": 0         // TCGPlayer foil market price (Alt Art/Star only have foil)
}
```

### Riftbound Card Variants (CRITICAL — read this carefully)

Riftbound has multiple "alt-art" variants for the same card, all sharing the same collector
number. This is why a simple number-based lookup causes false positives in the Cardex.

Alt Art and Overnumbered used to be flattened into a single `rarity: "Showcase"` value (both
are visually "showcase-style" prints upstream on Riot's own gallery) — the catalog now splits
them into their own distinct rarity strings so the app calls each variant what collectors
actually call it. `lib/utils.ts`'s `riftboundVariantFlags()` is the shared classifier every
consumer (search, Cardex, pricing) goes through; it still re-derives the Overnumbered signal
from `publicCode` (not just the rarity string) as a defensive fallback for any doc a resync
hasn't touched yet.

| Variant | Rarity | publicCode | Description |
|---------|--------|-----------|-------------|
| Base | Common/Uncommon/Rare/Epic | `OGN-001/298` | Normal card |
| Alt Art | Alt Art | `OGN-007a/298` | Same-number alt art (foil-only, "a" suffix in publicCode) |
| Overnumbered | Overnumbered | `OGN-227/221` | Collector number exceeds set size (prints like a regular card, not foil-only) |
| Signature | Star | `OGN-227*/221` | Signed variant, `*` suffix in publicCode |

The `RARITY_ORDER` in the Cardex API sorts these:
- Common=0, Uncommon=1, Rare=2, Epic=3 (Champion), Alt Art=90, Overnumbered=90, Star=91

Alt Art, Overnumbered, and Star always appear after the base card with the same number.

### Price Matching Logic (Riftbound)

The download script uses a `tcgKey()` / `catalogKey()` system to match TCGPlayer prices
to catalog cards:

```
catalogKey(card) → "OGN:7:regular"  (base Ahri card #7)
catalogKey(card) → "OGN:7:altart"   (Alt Art with publicCode "007a/298")
catalogKey(card) → "OGN:227:over"   (Overnumbered)
catalogKey(card) → "OGN:227:star"   (Signature)
```

Alt Art and Star cards only have foil prices. The script assigns `marketPrice` as the foil
price for these variants. Overnumbered prints like a regular card (not foil-only).

### Known Riftbound Sets (as of July 2026)

| Set Code | Set Name | Group ID | Released | Card Count |
|----------|----------|----------|----------|-----------|
| OGN | Origins | 24344 | 2025-10-31 | 298 |
| SFD | Spiritforged | 24519 | 2026-02-13 | 221 |
| UNL | Unleashed | 24560 | 2026-05-08 | 219 |
| OGS | Proving Grounds | 24439 | — | 24 (promo/event set) |
| VEN | Vendetta | TBD | 2026-07-31 | TBD |
| RAD | Radiance | TBD | 2026-10-01 | TBD |

### How New Riftbound Sets Are Added

**Four ways, in increasing order of manual effort:**

1. **Admin Catalog → "New Set"** (see [§5](#admin-catalog-page--architecture-caching--diagnostics))
   — fastest for a set with no TCGCSV group yet, or a curated/custom one. No group-ID hunting
   needed since it's created with `tcgcsvGroupId: null`.
2. **Admin Catalog → "Check Raw Source"** (see [§5](#admin-catalog-page--architecture-caching--diagnostics))
   — once a set exists (via either path here), use this to catch individual cards the scrape
   silently skipped, independent of whether the set-level sync worked.
3. **Admin Catalog → "Sync Card Data"** (see [§17](#automated-sync--admin-catalog)) — this whole flow,
   including the group-ID lookup, runs automatically for real newly-detected sets.
4. **Manual**, described below — what the automated paths actually do under the hood, and the
   fallback if you'd rather not use either UI. Card data (names, images, sets) is already fully
   automatic via the `__NEXT_DATA__` gallery scrape with zero code changes; the only genuinely
   manual piece here is finding the set's TCGPlayer group ID for prices.

New sets appear on `playriftbound.com/en-us/card-gallery/` when Riot adds them.
The download script automatically finds all cards in `__NEXT_DATA__` regardless of set.

**Step 1 — Find the new set's TCGCSV group ID**

Once the set is on TCGPlayer, find its group ID:
```
https://tcgcsv.com/tcgplayer/89/
```
Look for the new group in the listing. The group ID is a number like `24344`.
(A sync attempts this automatically via fuzzy name-matching in `scripts/lib/text-norm.mjs`'s
`matchSetName()` — only accepting confident matches; anything uncertain is left for the
Settings page's "Needs Review" list instead of guessing.)

**Step 2 — Register the set in the registry (Firestore `registry/main`)**

This one file replaced the old `TCGCSV_GROUPS`/`RIFTBOUND_SETS`/`RIFTBOUND_GROUPS`/`RIFTBOUND_KNOWN`
edits that used to be needed across three separate files:

```json
{ "setName": "Vendetta", "setCode": "VEN", "releaseDate": "2026-07-31", "cardCount": 228,
  "cardexGroup": "Main Sets", "tcgcsvGroupId": 12345, "groupMatchConfidence": null,
  "needsReview": false, "source": "manual" }
```

- `setName` MUST exactly match the `setName` on the catalog's Firestore card docs. Verify via
  the Admin Catalog page (`/admin` → Riftbound → pick the set), or `GET /api/sets?game=riftbound`.
- `tcgcsvGroupId` is the group ID from Step 1 — `download-card-catalog.mjs` merges this into its
  bootstrap `TCGCSV_GROUPS` list at runtime via `getTcgcsvGroups()`, so no script edit is needed.
- `cardexGroup` must be one of `groupOrder`'s labels (`"Main Sets"` or `"Promos"` today) for the set
  to appear in the Cardex picker — sets present in the registry are automatically "known," so there's
  no separate catch-all-bucket list to update.
- Sort order for the final synced card list comes from `SET_ORDER` in the download script (a
  code edit) — it's cosmetic only (unknown codes default to sorting last), so it's not part of
  this file. (No local `riftbound-cards.json` gets written anymore — `download-card-catalog.mjs`
  only writes local files for its own bookkeeping now, `data/last-download-summary.json`; all
  card data goes straight to Firestore, see [§4](#card-catalog-system--deep-dive-firestore-backed).)

**Step 3 — Run the download**

```bash
npm run download-cards
```

No rebuild/restart needed for the card data itself — only actual code changes require one (see
[§4](#card-catalog-system--deep-dive-firestore-backed)).

---

## One Piece — Data Source, Schema, Add-a-Set Guide

The fourth game (added after Pokémon/Lorcana/Riftbound). Architecturally it's a hybrid of the
other three: card data comes from a GitHub-hosted JSON dataset like Pokémon's, but — like
Riftbound — there's no live external "sets" API, so the registry itself is the authoritative set
list. Price-matching, though, needs **none** of Riftbound's per-set TCGPlayer group-ID bootstrap
or fuzzy name-matching — see below for why. Cardex integration works like Pokémon's: sets are
grouped automatically (by set-code prefix here, not a `series` field), no per-set registry
curation.

### Data Sources

**Card data:** `github.com/apitcg/one-piece-tcg-data` (community-maintained, MIT-shaped exactly
like `PokemonTCG/pokemon-tcg-data` — one JSON file per set/bucket under `cards/en/`, no API key,
no rate limit beyond plain GitHub raw-content serving). Every print variant is already a separate
array entry: a base card `"OP01-024"` and its "Parallel" alt-art reprint(s) `"OP01-024_p1"`,
`"OP01-024_p2"`, ... share the same `code` but have distinct `id`s. This is also where secret
rares (`SEC`) and one-off promo cards live — e.g. a special "DODGERS ONE PIECE NIGHT" giveaway
Leader card shows up here as its own tiny "set" with exactly one card in it, the same way Lorcana's
tcgcsv-sourced promo groups do.

**Price data:** `tcgcsv.com` category **68**. Unlike the other three games, price matching needs
**no per-set group-ID bootstrap and no fuzzy set-name matching at all** — tcgcsv's `extNumber`
column is *literally* the same card code apitcg uses (`"OP01-024"`), so cards match across the
two sources by an exact string compare, with zero normalization. `downloadOnePiece()`
(`scripts/lib/catalog-sync.mjs`) just fetches *every* tcgcsv group (there are ~90) and builds one
global `code -> prices` map, rather than needing to know in advance which TCGPlayer group
corresponds to which set.

**Phase 3 — synthesizing cards for sets apitcg hasn't scraped yet:** apitcg's GitHub dataset can
lag real TCGPlayer releases by weeks. When this app first synced One Piece, apitcg's `cards/en/`
topped out at `op12.json` while OP13 through OP17 (five whole sets, hundreds of cards, including
one of the game's most famous chase cards — OP13-118's "Red Super Alternate Art" secret-rare
Luffy) were already selling on TCGPlayer with real prices. Rather than have those sets be
invisible until apitcg catches up, `downloadOnePiece()` builds minimal card entries directly from
tcgcsv's own CSV columns (`name`, `extRarity`, `imageUrl`) for any code with priced rows but no
matching apitcg card — mirroring apitcg's own `id` scheme (base = the bare code, Parallels =
`_p1`/`_p2`/...) so a synthesized card is indistinguishable from a real one to the rest of the
app. Same "build catalog cards straight from TCGPlayer data when the primary source doesn't have
them" pattern `downloadLorcana()`'s own Phase 3 already uses for its TCGPlayer-only promo groups.
This also needs a set *name* for each synthesized set, which comes from the tcgcsv group's own
`name` field — matched to a card's code prefix via that group's `abbreviation`, which turned out
to need real parsing: some groups combine two sets under one abbreviation ("OP15-EB04" — one
prefix per segment, e.g. `"Adventure on Kami's Island"` for **both** "OP15" and "EB04") or split
one prefix's number across segments ("ST-31" → "ST31", "EB-03-04" → "EB03" **and** "EB04"). See
the `groupNameByPrefix` parsing loop in `downloadOnePiece()` for the resulting rule (a pure-letters
segment sets the "current" prefix for any pure-digits segment that follows it; a segment that's
already letters+digits registers immediately and becomes the new current prefix).

Synthesized sets still need a registry `code` for Cardex's Main-Sets-vs-Special-Sets bucketing
(see below) — every synthesized card exists only because tcgcsv has a real numbered product group
for it, which is the functional equivalent of apitcg's official bracket, so `downloadOnePiece()`
registers each synthesized setName's prefix into the same `setBracketCodes` map real
bracket-derived sets use (see Set Code Parsing below), letting a genuine OP13-17 set land in Main
Sets the same as OP01-12 rather than getting stuck in Special Sets for lacking an apitcg bracket
it was never going to have.

### Catalog Schema (`catalog/onepiece/cards/{id}` Firestore doc)

Each card doc:
```json
{
  "id": "OP01-024",           // apitcg's own id — "OP01-024_p1" for a Parallel print, "_p2" etc.
  "name": "Monkey.D.Luffy",    // same for every print variant — see Print Variants below
  "set": "OP01",               // print-numbering prefix (always present, never empty) — NOT
                                // the same thing as the registry's set-level `code` (see Cardex
                                // Grouping below); this is a per-card display field
  "setName": "Romance Dawn",   // human-readable set name
  "number": "024",             // bare collector number, no set-size denominator
  "rarity": "SR",              // L, C, UC, R, SR, TR, SEC, "SP CARD", P, PR — unlike Pokemon,
                                // always present. TR = Treasure Rare, a genuine premium chase
                                // tier (~1 per booster box, OP-06+, EN/CN/FR-exclusive) missing
                                // from this doc until the Cardex rarity toggle work found it by
                                // aggregating real live data instead of trusting this list. P/PR
                                // are both promo-card codes from two different scrape paths
                                // (apitcg's own vs. a tcgcsv-synthesized promo group), not a real
                                // collector-value distinction — see §14's rarity toggle note.
  "imageUrl": "https://tcgplayer-cdn.tcgplayer.com/product/453508_200w.jpg", // TCGPlayer's own
                                // product photo, NOT the official gallery — see Image Hosting below
  "marketPrice": 2.34          // no marketPriceFoil — see Print Variants below
}
```

### Image Hosting — TCGPlayer CDN, not the official gallery

apitcg's own `images.large`/`images.small` fields are `en.onepiece-cardgame.com` URLs (the
official Bandai site never rehosts images anywhere else). Those URLs return `200 OK` to a plain
`curl` or a server-side `fetch` — but they **never render in a browser `<img>` tag, from any
origin, in dev or in production**, because that domain sends
`Cross-Origin-Resource-Policy: same-site` on every image response, which every browser enforces
regardless of how the resource itself responds to a non-browser client. A raw HTTP 200 check on
one of these URLs is not evidence it'll actually display — this shipped broken once (silently:
every card tile just showed no artwork, no error in the console) before being caught by comparing
what `curl` saw against what actually rendered.

The fix: during the Phase 2 price-merge (see below), `downloadOnePiece()` also captures each
tcgcsv row's own `imageUrl` column (TCGPlayer's CDN sends no such CORP header) and overwrites
`card.imageUrl` with it whenever a price-matching row exists for that card — using the exact same
positional base/`_p1`/`_p2`/... pairing already established for price, so a Parallel print gets
its own distinct TCGPlayer product photo, not the base card's. This is the same "prefer a
TCGPlayer product image" pattern `downloadRiftbound()` already uses for its synthesized
Star/Signature stubs (`imageUrl: p.img || baseCard.imageUrl`), just applied unconditionally here
rather than only to synthesized cards, since the underlying problem (official-site images never
render for *any* card) isn't specific to those. The ~1% of cards with no tcgcsv price match at
all (see Print Variants below) keep the official gallery URL as a last resort — still broken in a
browser, but there's no better source to fall back to for those.

### Print Variants (Parallels, Secret Rares) — no foil/non-foil duality

Unlike Pokémon (holo vs. normal) or Lorcana/Riftbound (a foil toggle on the *same* printing), a
One Piece "Parallel" is a **fully separate physical print** with its own alternate art — apitcg
already models it as its own catalog `id`, so it's synced as its own independent catalog doc with
its own `marketPrice`, not as a second price field on the base card. Consequences:

- **No `marketPriceFoil` field** — there's nothing to put in it. `app/api/prices/onepiece/route.ts`
  is a plain `id -> marketPrice` lookup, no `isFoil`/`priceMode` branching at all.
- **`AddCardDialog`'s Foil toggle is hidden for One Piece** (`form.game !== 'onepiece'` guard) —
  selecting a Parallel print from the search dropdown (labeled e.g. `"Shanks (Parallel)"`, or
  `"Shanks (Parallel 2)"` for a rarer 2nd/3rd art) is how a Parallel gets added, not a checkbox.
- **Cardex ownership fallback** (no `apiId`, i.e. a manually-typed card) matches by
  `set === setName && number === number`, same shape as Lorcana's — safe for the same reason it's
  safe for Lorcana but not Riftbound: a catalog number here never has more than one *base* variant
  sharing it (the base/Parallel split lives entirely in separate `id`s, not in `number`).

**The one genuine approximation in this whole integration:** TCGPlayer doesn't tag which product
row is the "regular" print vs. which numbered Parallel it is — only the product *name* contains
`"(Parallel)"` (sometimes with more descriptive suffixes like `"(Parallel) (Manga) (Alternate
Art)"`). `downloadOnePiece()` sorts tcgcsv rows for a given code by `productId` ascending (a
reasonable proxy for catalog/release order) and matches them **positionally** against apitcg's own
base/`_p1`/`_p2`/... ordering. Rows with no market data are filtered out first (`price === 0` skip)
so an unpriced listing can't silently displace a real variant's slot — but this is still an
approximation, not a verified pairing. If a Parallel's price ever looks applied to the wrong art,
this positional matching is the place to look.

### How New One Piece Sets Are Added

There's no manual registry step needed the way Riftbound needs a TCGPlayer group ID — because
price-matching is fully code-keyed (see above), a set becomes fully priced the moment
`npm run download-cards` (or Admin Catalog's "Sync Card Data") next runs, automatically:

1. `scripts/lib/catalog-sync.mjs`'s `downloadOnePiece()` scrapes every `cards/en/*.json` file from
   the GitHub dataset — new sets appear there as soon as apitcg's own scraper picks them up from
   `en.onepiece-cardgame.com/cardlist/`, no code change needed on this app's side.
2. `app/api/sync/onepiece/route.ts` (what both the CLI script and Admin Catalog's "Sync Card
   Data" button call into) diffs the freshly-scraped `setName`s against the registry
   (`registry/main`'s `onepiece.sets`, Firestore) and backfills any new one with
   `{ setName, code, releaseDate: null, cardCount, source: 'auto-detected' }` — mirroring exactly
   how Riftbound's sync route backfills its own registry (Riftbound has no live sets API either),
   minus everything group-ID-related, which One Piece doesn't need.
3. That's it — no group-ID lookup, no fuzzy matching, no `needsReview` flag, nothing for
   Settings' "Needs Review" editor to ever show for this game (same as Pokémon).

A **custom/curated** set can still be registered manually via Admin Catalog's "New Set" form (no
`cardexGroup` needed, same as Pokémon) — it lands in Cardex's own "Special Sets" group (see
below) rather than a real numbered set, since it has no upstream product code to bucket by.

### Set Code Parsing (`parseOnePieceSetName()` in `catalog-sync.mjs`)

apitcg's raw `set.name` field looks like `"-ROMANCE DAWN- [OP01]"` (a real numbered booster) or
`"DODGERS ONE PIECE NIGHT"` (a one-off promo with no official bracketed code at all). The bracket,
when present, gives the real set code; its absence means the "set" is really just an event/promo
grouping, not a genuine product. **This distinction is tracked in two separate places for two
separate purposes, and conflating them was a real bug caught during this feature's own build:**

- A synced **card's own `set` field** is never empty — a bracket-less promo falls back to the
  card's own print-numbering prefix (e.g. `"EB02"` for a card sold at a special event but printed
  as part of Extra Booster 02's card pool). This is a reasonable per-card display value (it really
  does say which print run the card belongs to).
- The **registry's set-level `code` field** (what Cardex grouping actually keys on — see below)
  is bracket-only: `null`/empty for anything without a real bracket, *even if* its cards' own
  `set` fields resolved to something that looks like a real prefix via the fallback above.
  `downloadOnePiece()` tracks this separately as a `setName -> bracketCode|null` map
  (`setBracketCodes`, returned as `setCodesBySetName` alongside the usual sync result) precisely
  so `app/api/sync/onepiece/route.ts` can populate the registry from the *bracket-only* signal.
  Using the per-card fallback value instead (i.e. `cards[0].set`) — which is what the first version
  of this route did — miscategorized dozens of one-off tournament/event "sets" into the Cardex's
  Main Sets group, since a "Treasure Cup" promo printed from OP09's card pool would resolve to
  `code: "OP09"` under the fallback and look indistinguishable from the real OP09 booster set.

### Cardex Grouping — two groups, not a registry `cardexGroup`

Like Pokémon, One Piece doesn't get a hand-curated `cardexGroup` per set — hand-curating one for
~110 sets (most of them tiny one-off tournament/event promos, not real products) isn't worth it,
and splitting all of those into their own per-prefix sections (Starter Decks, Extra Boosters,
Premium Boosters, ...) just recreates the "too many sections to scan" clutter this scheme exists
to avoid. `CardexPage.tsx`'s `buildOnePieceGroups()` instead makes exactly two catalog-backed
groups, keyed on the registry's bracket-only `code` (see above, not a card's own `set` field):

- **Main Sets** — only real numbered boosters (`code` matches `/^OP(\d+)$/`, e.g. `OP01`..`OP12`
  as of this writing — apitcg's dataset lags Bandai's actual releases, so a just-released set may
  not appear here immediately even after a sync). Sorted newest-first by that number and labeled
  with it, e.g. `"Romance Dawn : OP-01"`, so the set's real product code is visible at a glance
  without opening it.
- **Special Sets** — everything else in one group: starter decks, extra/premium boosters, every
  tournament/event promo apitcg tracks, and any custom/manual set. This deliberately does not
  distinguish "a real Starter Deck box" from "a single-card giveaway" — both are equally
  legitimate things to want to browse, and splitting them apart again would just be re-introducing
  the clutter that having two groups instead of one-per-prefix was meant to fix.

See CLAUDE.md quirk #9 for the same "why not a registry" reasoning applied to Pokémon, and quirk
#22 for the fallback-vs-bracket bug this two-group design's `code` signal had to be fixed to avoid.

---

## Magic: The Gathering — Data Source, Schema, Add-a-Set Guide

The 5th game. Architecturally closest to Pokémon: a live external "sets" API means no registry
`cardexGroup` curation is needed (see quirk #9), and no per-set price-matching bootstrap the way
Riftbound needs — but unlike every other game here, its bulk data source returns **prices and
images directly on the card object itself**, so there's no separate TCGCSV/lorcast-style
price-merge pass at all; one bulk-data fetch is the whole sync.

**Read `MTG Integration.md` at the repo root before touching anything MTG-related** — it has the
full story on why the first real sync hasn't been run yet (Firestore write-quota risk) and the
exact steps to turn it on. Short version: the code below is fully built and wired everywhere
every other game is, but `app/api/cron/sync-prices/route.ts` (the 4x/day automatic price refresh)
and the default `npm run download-cards` (no flag) both deliberately skip MTG — only a manual
Admin Catalog "Sync Card Data" click, or `npm run download-cards -- --include-mtg`, actually
pulls it. Until a first sync runs, `catalog/mtg/cards` doesn't exist yet and every MTG search/
Cardex/Portfolio-price call just returns empty, same as any other game before its first sync.

### Data Source

**API:** `api.scryfall.com` — a free, no-key-required public API maintained independently of
Wizards of the Coast, generally considered the most complete and reliable Magic card database
available. **Every request must carry a `User-Agent` and `Accept` header or Scryfall returns a
plain 400** — this is handled by `SCRYFALL_HEADERS` in `lib/api/mtg.ts` (duplicated in
`scripts/lib/catalog-sync.mjs` and the Admin Catalog lookup route, same "duplicated across the
runtime boundary on purpose" pattern as this app's other external-source header constants).

**Bulk card data:** `GET https://api.scryfall.com/bulk-data` returns a listing of pre-built
dataset files; `downloadMTG()` (`scripts/lib/catalog-sync.mjs`) uses the `default_cards` entry —
one object per distinct **printing** (every reprint/set/finish counted separately, the same "one
catalog row per physical card" model every other game here uses), as opposed to `oracle_cards`
(one row per unique card, no reprint granularity — rejected, since that would lose per-printing
pricing/images) or `all_cards` (every language variant too — unnecessarily huge). As of this
writing that file is a **~75MB gzip-compressed `.jsonl`** (newline-delimited JSON, one card per
line — exposed as the listing's `jsonl_download_uri` field, not a plain `download_uri`)
decompressing to ~100k+ card objects, more text than fits in a single JS string (V8's ~512MB max
string length) — `downloadMTG()` therefore streams it (gunzip → `readline`, one JSON object per
line) rather than buffering the whole thing. **Scryfall has changed this bulk-data shape before —
re-verify `GET /bulk-data`'s response shape if this code ever needs touching again.**

**Set list:** `GET https://api.scryfall.com/sets` — used live by `lib/api/mtg.ts`'s
`getMtgSets()`, exactly the same "live external sets API, no registry entry needed for real sets"
shape as `lib/api/pokemon.ts`'s `getPokemonSets()` (see quirk #9). Cached in-process for an hour
(Scryfall adds new sets only a few times a year, far less often than the 2-minute catalog
staleness window everything else uses).

### Filtering — what's excluded from the catalog

Two independent filters, applied identically in `downloadMTG()` and `getMtgSets()` (the latter
via the same `MTG_EXCLUDED_SET_TYPES` blocklist, exported from `lib/api/mtg.ts`, so the set
picker never offers a set with zero cataloged cards in it):

- **`games.includes('paper')`** — excludes any printing only available on Magic Arena or MTGO.
  This alone already excludes every purely-digital "Alchemy" set, since none of its cards are
  ever in `games` alongside `'paper'`.
- **`set_type` blocklist** (`token`, `memorabilia`, `art_series`, `minigame`) — real paper
  products, but not "cards" in the collecting sense a physical binder would contain. This was a
  deliberate scope decision (every printing IS tracked, per-set/per-printing pricing and all —
  see the schema below — but these four set types specifically are not).

### Catalog Schema (`catalog/mtg/cards/{id}` Firestore doc)

Each card doc:
```json
{
  "id": "0000419b-0bba-4488-8f7a-6194544ce91e",  // Scryfall's own UUID for this exact printing —
                                                   // already globally unique, no set-prefixing
  "name": "Forest",                 // Scryfall already combines multi-faced cards as "Front // Back"
  "set": "blb",                     // Scryfall's lowercase set code
  "setName": "Bloomburrow",
  "number": "280",                  // collector_number as-is — can contain letters/suffixes
                                     // ("150a", "★") the way Riftbound's publicCode suffixes do
  "rarity": "common",               // common, uncommon, rare, mythic, special, bonus — always
                                     // lowercase, always present (unlike Pokemon's schema)
  "imageUrl": "https://cards.scryfall.io/normal/front/...",
  "marketPrice": 0.37,              // usd — 0 if Scryfall has no listing data
  "marketPriceFoil": 0.60           // usd_foil, falling back to usd_etched for etched-only
                                     // treatments that have no usd_foil price at all
}
```

Double-faced/split/adventure cards (`layout: "transform"` etc.) carry their images per-face
(`card_faces[0].image_uris...`) instead of top-level `image_uris` — `downloadMTG()` falls back to
the front face's image in that case. `prices` itself is always top-level regardless of layout, so
no equivalent fallback is needed there.

### Print Variants — closer to Pokemon/Lorcana than Riftbound/One Piece

Unlike Riftbound (Alt Art/Overnumbered/Signature sharing a bare collector number) or One Piece (a
Parallel print as a separate id sharing a bare number with its base card), a different art/border/
frame treatment of the same Magic card is virtually always given its **own distinct collector
number** as a fully separate Scryfall object — there's no same-number variant-sharing scheme to
worry about. Foil vs. nonfoil, meanwhile, is a **finish of one printing**, not a second catalog
id — `marketPrice`/`marketPriceFoil` on the same doc, exactly like Pokemon/Lorcana/Riftbound's
foil handling, not like One Piece's separate-id Parallels. This is why the Cardex ownership
fallback (no `apiId`, i.e. a manually-typed card) uses the same safe `set === setName && number
=== number` shape Pokemon/Lorcana already use — see quirk #9's reasoning, which applies here for
the same reason.

### How New MTG Sets Are Added

New sets appear on Scryfall's live `/sets` endpoint automatically, same day Wizards spoils them —
nothing to register anywhere for a *real* set to become searchable/addable; the next
`downloadMTG()` sync picks up its cards. A **custom/curated** set still needs Admin Catalog's
"New Set" form the same way Pokemon's does (no `cardexGroup` needed — see Cardex Grouping below),
registered in the registry (Firestore `registry/main`'s `mtg.sets`) with `source: "manual"` so
`getMtgSets()` merges it into the live Scryfall list the same way `getPokemonSets()` merges in
Pokemon's manual sets.

### Cardex Grouping — automatic, keyed on Scryfall's own `set_type`

Like Pokemon (by `series`) and One Piece (by set-code prefix), MTG doesn't get a hand-curated
`cardexGroup` per set — Scryfall tracks 650+ sets, most of them niche box sets/reprint products,
so hand-curating one per set isn't worth it (see quirk #9). `buildMtgGroups()`
(`CardexPage.tsx`) instead groups by Scryfall's own `set_type` field, with the handful of types a
collector actually thinks of as "a Magic set" getting their own labeled group (Expansions, Core
Sets, Masters & Reprint Sets, Commander, Draft Innovation, Un-Sets, Promos) and everything else
(duel decks, premium decks, From the Vault, Spellbook Series, Archenemy/Planechase/Vanguard
oversized-card products, starter sets, etc.) collapsing into one "Special Sets" catch-all — same
shape as One Piece's Main Sets/Special Sets split.

---

## Card Search Flow

When Alex types a name in the AddCardDialog search box:

```
User types query
  → AddCardDialog debounces 300ms
  → fetch("/api/cards/search?game=lorcana&q=mickey")
  → app/api/cards/search/route.ts (server-side)
  → searchCards(game, query) in lib/api/search.ts — caps the final result list at 25
    (searchCardsUncapped() does the real per-game work; each per-game search*Cards()
    already returns matches best-first, so slicing after is a safe cut, not a re-ranking)
  → calls searchLorcanaCards(query) / searchPokemonCards(query) / searchRiftboundCards(query) /
    searchOnePieceCards(query) / searchMtgCards(query)
  → loadVisibleCatalog(game) in lib/api/catalog.ts — Firestore-backed, in-memory cached
    per server process (see §4 for the caching/staleness mechanics). Pokémon's own
    searchPokemonCards() only falls back to a live api.pokemontcg.io call if the catalog is
    completely empty (i.e. before the first sync has ever run) — see §7's AddCardDialog note.
  → scoreMatch() ranks results by word-start prefix matching
  → returns up to 25 results as JSON
  → AddCardDialog renders dropdown with name, image, set, price
```

**Why server-side?** The Pokémon TCG API blocks browser CORS requests. By routing all
searches through Next.js API routes, we avoid CORS entirely for every game.

**The `scoreMatch` algorithm:** Splits both name and query into word tokens at spaces,
hyphens, and punctuation. Each query word must match the START of at least one name token
(not mid-word). Exact token match = 30 pts, prefix match = 15 pts, first-word bonus = 10 pts.
Returns -1 (filtered out) if any query word has no match at any word start. This prevents
"cr" from matching "incredible" but allows it to match "cratchit".

For Riftbound specifically, the search also checks `card.tags` — this lets a search for
"ahri" find cards tagged `["Ahri"]` even if the card name is `"Deceiver"` (LeBlanc's
themed card).

---

## Price Data

**As of the price-refresh redesign (see [§18](#cron-driven-price-sync)), live external price
fetches for all four games happen in exactly one place: the 6-hourly cron-driven catalog sync.**
Nothing else — not Portfolio's "Refresh Prices" button, not Pack Analysis — ever calls
tcgcsv.com/lorcast/pokemontcg.io directly anymore. Both instead read whatever the catalog
currently has (`loadCatalog()`/`loadVisibleCatalog()`, [§4](#card-catalog-system--deep-dive-firestore-backed)),
which is therefore at most ~6 hours stale. This was a deliberate trade (see [§18](#cron-driven-price-sync)
for the full rationale): dramatically fewer outbound API calls — no more re-fetching a full
tcgcsv CSV or hitting lorcast once per card on every user's every portfolio visit — at the cost of
prices only being as fresh as the last cron run rather than truly live-on-click.

Pokémon search used to be the one documented exception here (a live `api.pokemontcg.io` call per
search) — it no longer is: `searchPokemonCards()` is catalog-first now (see [Card Search
Flow](#card-search-flow) and §7's AddCardDialog note), reading `loadVisibleCatalog('pokemon')`
the same way every other game's search does, and only ever falling back to a live API call if the
catalog is completely empty. The price shown in the dropdown is whatever the catalog has, same
freshness as everywhere else (at most ~6 hours stale, per the cron above).

### Pokémon

- **Source:** `tcgcsv.com` (TCGPlayer mirror, category 3), synced into each card's Firestore doc
  — same shape as every other game now, including the search dropdown (see above).
- **When fetched:** By the cron sync ([§18](#cron-driven-price-sync)), or `npm run download-cards`
- **Fields in catalog:** `marketPrice`/`marketPriceFoil` (normal/holofoil) and
  `lowPriceNM`/`lowPriceNMFoil` (lowest normal/holofoil listing — powers the "Lowest NM" price mode)
- **Price refresh:** Portfolio page → "Refresh Prices" reads `catalog/pokemon/cards/*` for just
  the apiIds in Alex's own inventory (`app/api/prices/pokemon/route.ts`) — an in-memory catalog
  lookup, no network call to pokemontcg.io
- **Foil logic:** `isFoil=true` → holofoil market price; `isFoil=false` → normal market price
- **Stored on Card:** `currentPrice` field updated by refresh; `purchasePrice` set when card added

### Lorcana

- **Source:** `api.lorcast.com`, synced into each card's Firestore doc
- **When fetched:** By the cron sync ([§18](#cron-driven-price-sync)), or `npm run download-cards`.
  There is no live per-request lorcast call anywhere anymore — Portfolio's refresh used to fetch
  `api.lorcast.com/v0/cards/{id}` one card at a time (8-way concurrency) since lorcast has no bulk
  price endpoint, which made it by far the slowest of the three games to refresh; it now just
  reads the catalog like the other two games.
- **To update prices:** the cron sync, or `npm run download-cards` (no rebuild needed — see [§4](#card-catalog-system--deep-dive-firestore-backed))
- **Fields in catalog:** `marketPrice` (non-foil) and `marketPriceFoil` (foil/cold foil) — lorcast
  has no separate "lowest listing" price, so `priceMode: 'lowestNM'` just falls back to `marketPrice`
- **Note:** Enchanted and Epic cards may have `marketPrice: 0` because they are foil-only;
  their price is in `marketPriceFoil`

### Riftbound

- **Source:** `tcgcsv.com` (TCGPlayer mirror, category 89), synced into each card's Firestore doc
- **When fetched:** By the cron sync ([§18](#cron-driven-price-sync)), or `npm run download-cards`.
  Portfolio's refresh and Pack Analysis used to each independently re-download and re-parse every
  set's full `ProductsAndPrices.csv` live, on every single call — the single most expensive thing
  in the app before this redesign, since it scaled with every set ever added, on every user's
  every refresh/page view. Both now just read the catalog.
- **Alt Art/Star cards:** These are foil-only; `marketPrice` is set to the foil price,
  `marketPriceFoil` is 0 (they don't have separate foil vs non-foil listing)
- **To update prices:** the cron sync, or `npm run download-cards` (no rebuild needed — see [§4](#card-catalog-system--deep-dive-firestore-backed))

### One Piece

- **Source:** `tcgcsv.com` (TCGPlayer mirror, category 68), synced into each card's Firestore doc.
  Matched by exact card code (`extNumber` == apitcg's `code`) — no group-ID bootstrap or fuzzy
  set-name matching needed at all, unlike Riftbound (see
  [§10](#one-piece--data-source-schema-add-a-set-guide) for why).
- **When fetched:** By the cron sync ([§18](#cron-driven-price-sync)), or `npm run download-cards`
- **Fields in catalog:** `marketPrice` only — **no `marketPriceFoil`**. A "Parallel" print is a
  fully separate catalog card (its own `id`, its own `marketPrice`), not a foil toggle of the base
  card the way the other three games' foil variants are — see
  [§10](#one-piece--data-source-schema-add-a-set-guide)'s Print Variants section.
- **Price refresh:** Portfolio page → "Refresh Prices" reads `catalog/onepiece/cards/*` for just
  the apiIds in Alex's own inventory (`app/api/prices/onepiece/route.ts`) — plain `id ->
  marketPrice` lookup, no `isFoil`/`priceMode` branching (nothing to branch on)
- **To update prices:** the cron sync, or `npm run download-cards` (no rebuild needed — see [§4](#card-catalog-system--deep-dive-firestore-backed))

### Magic: The Gathering

- **Source:** `api.scryfall.com`, prices included directly on each card object — no separate
  price-matching/merge pass at all, unlike the TCGCSV-based games (see
  [§11](#magic-the-gathering--data-source-schema-add-a-set-guide) for why).
- **When fetched:** **Not yet on the cron sync** — MTG is deliberately excluded from
  `app/api/cron/sync-prices/route.ts` until its Firestore write-quota impact is confirmed
  acceptable (its first sync alone is ~99,000 document writes). Only a manual Admin Catalog
  "Sync Card Data" click, or `npm run download-cards -- --include-mtg`, actually syncs it right
  now. See "MTG Integration.md" at the repo root for the full writeup and how to turn it on.
- **Fields in catalog:** `marketPrice` (usd) and `marketPriceFoil` (usd_foil, falling back to
  usd_etched) — same shape as Lorcana/Riftbound's foil handling, not One Piece's separate-id
  Parallels.
- **Price refresh:** Portfolio page → "Refresh Prices" reads `catalog/mtg/cards/*` for just the
  apiIds in Alex's own inventory (`app/api/prices/mtg/route.ts`) — same `isFoil`-branching shape
  as `app/api/prices/lorcana/route.ts`.
- **To update prices:** a manual Admin Catalog sync or `npm run download-cards -- --include-mtg`
  only, for now (no rebuild needed once run — see [§4](#card-catalog-system--deep-dive-firestore-backed)).

---

## Cardex Feature — How Sets Register

The Cardex (`/cardex`) shows a Pokédex-style grid for any set. Cards are greyed out if
not in inventory, full color if owned, with quantity badges. It also hosts the unrelated,
per-user "Personalized Collections" tab — see [§6](#personal-collections-vs-the-admin-catalog)
for why that's a fundamentally different feature sharing a page, not another set source.

### Architecture

1. Alex picks a set in `components/pages/CardexPage.tsx`
2. The component calls `GET /api/cardex?game=lorcana&set=Shimmering+Skies`
3. `app/api/cardex/route.ts` reads the Firestore-backed catalog via `loadVisibleCatalog()`
   (`lib/api/catalog.ts`, see [§4](#card-catalog-system--deep-dive-firestore-backed)), filters
   by `setName`, sorts by number then rarity, and returns a simplified card array
4. The component overlays owned status by matching against Zustand `cards`

### The Two Matching Strategies

**Primary (apiId):** If `card.apiId` exists, it must exactly equal `catalogCard.id`.
This is the only reliable match for Riftbound Alt Art/Overnumbered/Signature cards that
share collector numbers with their base card.

**Fallback (set + number):** Used when `card.apiId` is absent (manually added cards).
- Lorcana: `card.set === catalogCard.setName && card.number === catalogCard.number`
- Riftbound: `card.setCode === catalogCard.setCode && card.number === catalogCard.number`
- Pokemon: `card.set === catalogCard.setName && card.number === catalogCard.number` — same shape
  as Lorcana's, and safe for the same reason: a Pokemon catalog number never has more than one
  card doc sharing it (no alt-art/overnumbered variant scheme), so unlike Riftbound there's no
  false-positive risk from the fallback alone.
- One Piece: `card.set === catalogCard.setName && card.number === catalogCard.number` — same
  shape and same safety reasoning as Pokemon's: a base card and its Parallel print(s) are
  distinct `id`s, not a shared `number` with a rarity/suffix distinguishing them, so this
  fallback can't collapse two real variants onto one slot the way Riftbound's can.

**Warning:** The fallback can cause false positives for Riftbound Alt Art/Overnumbered cards.
If Alex owns an Overnumbered card but added it without selecting from the search dropdown (so
no `apiId`), both the Overnumbered and Alt Art slot will show as owned. The fix is to always
select cards from the dropdown so `apiId` is set. This warning doesn't apply to Lorcana,
Pokemon, or One Piece — see above.

### Set Registration

**Lorcana/Riftbound:** To appear in the Cardex set picker, a set must have a `cardexGroup` value
in its **registry** entry (Firestore `registry/main`, see [§17](#automated-sync--admin-catalog))
matching one of that game's `groupOrder` labels. `CardexPage.tsx` fetches `GET /api/set-registry`
once on mount and derives the equivalent of the old hardcoded `LORCANA_GROUPS`/`RIFTBOUND_GROUPS`
client-side via `buildGroupsByGame()`. The `setName` field must exactly match the `setName` field
on the catalog's Firestore card docs — this is also exactly what Admin Catalog's "New Set" form
registers (see [§5](#admin-catalog-page--architecture-caching--diagnostics)).

**Pokemon:** No registry entry or `cardexGroup` needed — every set `GET /api/sets?game=pokemon`
returns (see [§7](#pokemon--data-source-schema-add-a-set-guide)) is automatically groupable, since
`CardexPage.tsx`'s `buildPokemonGroups()` derives groups from the live API's `series` field
instead. A custom/manual Pokemon set (Admin Catalog "New Set") still shows up too — it just lands
in its own trailing "Custom Sets" group rather than a real era, since it has no upstream `series`.
See quirk #9 for the full reasoning.

**One Piece:** Also no `cardexGroup` needed, for the same "too many sets to hand-curate" reason —
but unlike Pokemon there's no live external `series` field either, so `buildOnePieceGroups()`
derives the grouping from the set-code *prefix* it already parsed while syncing (`OP##` → Booster
Sets, `ST##` → Starter Decks, `EB##` → Extra Boosters, `PRB##` → Premium Boosters, anything else →
Promos & Events). See [§10](#one-piece--data-source-schema-add-a-set-guide) for the full table and
reasoning.

A set is automatically "known" (excluded from the "Special" catch-all below) simply by being
present in the registry with a non-null `cardexGroup` — there's no separate known-sets list to
keep in sync anymore (this replaced the old `LORCANA_KNOWN`/`RIFTBOUND_KNOWN` constants).

### The "Special / Metal" Inventory Bucket

Sets with `fromInventory: true` in the group config skip the API call entirely. Instead,
the component shows inventory cards (`game === activeGame`) whose `card.set` does NOT match
any registered set name for that game. These cards are grouped by their `card.set` value.

This is the catch-all for: D23 cards, Disney Cruise cards, Metal Riftbound cards, McDonald's/One
Piece tournament promos, or any card Alex adds manually with a custom set name. No catalog is
needed — anything in inventory with an unrecognized set name appears here automatically.

### Per-Game Rarity Toggle Filter

Inside a set, `CardexPage.tsx` can render a row of rarity pills (e.g. "Common", "Illustration
Rare", "Overnumbered Signature") that hide/show cards of that rarity — **wired up for all 5
games** (`RARITY_TOGGLE_GAMES`), added incrementally, one game per request, in this order:
Riftbound → Pokémon → Lorcana → One Piece → MTG. Each addition doubled as a live-data research
pass rather than trusting this doc's own older per-game rarity lists, which caught two real gaps:

- **Lorcana** needed zero mechanism changes — its 9 rarities were already in
  `CARDEX_RARITY_ORDER` from before this feature existed, just one missing `RARITY_COLORS` entry
  (`Iconic`).
- **One Piece** turned up `TR` (Treasure Rare — a genuine premium chase tier CLAUDE.md's own §10
  catalog schema had never documented) plus `P`/`PR` (two promo-card codes from different scrape
  paths, not a real collector-value distinction — both labeled "Promo"-ish so the toggles are
  distinguishable without asserting a difference that isn't really there). `ONEPIECE_RARITY_LABELS`
  (`lib/utils.ts`) spells out all 10 real values, since One Piece's rarity field is always a bare
  abbreviation (unlike Pokemon/Riftbound, where only a handful of oddities needed relabeling).
- **MTG** was the one game whose rarity strings had never been added to `CARDEX_RARITY_ORDER` at
  all (only `RARITY_COLORS` had them) — without that fix all 5 values would've sorted
  alphabetically among themselves instead of common→uncommon→rare→mythic→special→bonus. Verified
  the 6th documented value, `bonus` (Power 9 reprints like Black Lotus, e.g. Vintage Masters),
  correctly never appears in the synced catalog — confirmed live against Scryfall that those are
  MTGO-only digital cards, already excluded by `downloadMTG()`'s `games.includes('paper')` filter,
  not a gap. `MTG_RARITY_LABELS` just Title-Cases Scryfall's lowercase strings for visual
  consistency with every other game's pills — a cosmetic map, not a meaning correction.

- **The list is always computed from what's actually in the active set, never hardcoded.** An
  earlier Riftbound-only version used a fixed array of the "real" rarities — which meant any
  value outside it (Rune cards' TCGPlayer-sourced `Showcase`/`Promo` labels, unrelated to the
  champion-card rarities of the same name) was permanently un-hideable no matter what was
  toggled, since no button existed for it. `rarityFilters` (a `useMemo` over `enriched`) fixes
  this generically: every distinct `rarity` string present in the set gets a toggle, full stop —
  a genuinely new/unexpected value (a brand-new Pokémon set's brand-new tier, say) shows up as a
  toggle automatically instead of silently bypassing the filter.
- **Sort order** comes from `CARDEX_RARITY_ORDER` (`lib/api/catalog.ts`, shared with Inventory's
  own rarity filter and `sortCatalogCards()`) — known values sort by their assigned priority
  number, anything not in that map sorts after, alphabetically.
- **Display labels** come from `RARITY_LABELS_BY_GAME` (`lib/utils.ts`) — a genuinely per-game
  map, not one flat shared one, because the same raw string can mean different things in two
  games' catalogs (Riftbound's Rune "Promo" vs. Pokémon's real "Promo" tier). Most rarity strings
  are already human-readable as stored and need no entry here; only oddities get one (Riftbound's
  `Star`/`Showcase`/`Promo`, Pokémon's SCREAMING_SNAKE_CASE `MEGA_ATTACK_RARE`).
- **Colors** come from `RARITY_COLORS` (local to `CardexPage.tsx`). Pokémon's 44 values are
  bucketed into 4 tiers (blue/purple/orange/pink, roughly low-to-high value) rather than 44
  bespoke hex codes — see that constant's own comment for exactly which values land in which tier.
- **To add another game:** add it to `RARITY_TOGGLE_GAMES`, then fill in `RARITY_COLORS` entries
  for its rarity strings (falls back to gray if missing — functional, just visually flat) and a
  `RARITY_LABELS_BY_GAME` entry only if any of its raw strings need friendlier text. No changes
  needed to the filtering logic itself — it's already fully generic.
- `hiddenRarities` (component state, a `Set<string>`) is shared across whichever game is active
  and persists across set switches on purpose — toggling off "Overnumbered" on one Riftbound set
  keeps it off when switching to another. It's irrelevant for a game not in `RARITY_TOGGLE_GAMES`
  (never rendered, never populated for that game).

---

## Pack Analysis Feature — How Sets Register

The Pack Analysis (`/pack-analysis`) shows expected value (EV) per booster pack. It actually
covers three games with three different implementations, not just Lorcana — `PackAnalysisPage.tsx`
routes `lorcana`/`riftbound` to their own live, catalog-backed API routes (below) and `pokemon` to
`StandardView`, driven by `store.packSets` (`lib/store.ts`'s `defaultPackSets`) instead. One Piece
and MTG aren't in Pack Analysis at all — no pull-rate data exists for either.

### Architecture

1. `PackAnalysisPage` detects `activeGame === 'lorcana'`
2. Fetches `GET /api/pack-analysis/lorcana`
3. `app/api/pack-analysis/lorcana/route.ts` (`export const dynamic = 'force-dynamic'`, so Next
   never pre-renders/caches this route at build time):
   - Reads the catalog via `loadVisibleCatalog('lorcana')` (`lib/api/catalog.ts` — same
     Firestore-backed, in-memory-cached read every other consumer uses, see [§4](#card-catalog-system--deep-dive-firestore-backed)).
     Prices come from whatever the catalog has, kept fresh by the cron sync
     ([§18](#cron-driven-price-sync)) — this route no longer does its own live lorcast fetch on
     top (it used to; `app/api/pack-analysis/riftbound/route.ts` had the equivalent live tcgcsv
     CSV fetch, also removed — see [Price Data](#price-data))
   - Calls `getLorcanaBoosterSets()` (`lib/api/registry.ts`), which reads the registry (Firestore
     `registry/main`) and returns every set with `packAnalysis.included: true` — this replaced the old hardcoded
     `BOOSTER_SETS` array (see [§17](#automated-sync--admin-catalog))
   - Groups by rarity, computes average prices, applies pull rates, returns EV breakdown

### Pull Rates Used

Based on community box-opening analysis (Ravensburger does not publish official rates):

| Slot | Rate |
|------|------|
| Cold foil slot: Enchanted | 1 in 72 packs |
| Cold foil slot: Legendary | 1 in 24 packs |
| Cold foil slot: SR (sets without Epic) | 22% of packs |
| Cold foil slot: SR (sets with Epic) | 20% of packs |
| Cold foil slot: Epic | 1 in 48 packs (sets 9+ only) |
| Non-foil SR upgrade | 25% of packs |

Sets with Epic rarity (Whispers in the Well and later): `hasEpic: true`
Sets 1–8 (The First Chapter through Reign of Jafar): `hasEpic: false`

### Adding a New Lorcana Booster Set to Pack Analysis

Set `packAnalysis.included: true` (with `id`, `released`, `packPrice`, `hasEpic`) on the set's
entry in the registry (Firestore `registry/main`) — see the [Lorcana add-a-set guide](#lorcana--data-source-schema-add-a-set-guide)
above for the exact shape. No route code changes needed; it reads the registry fresh every
request, same as it always re-read the catalog fresh (`force-dynamic`).

**Note:** Fabled and Attack of the Vine! have `packAnalysis.included: false` in the registry
because they are not sold in standard booster packs. The Pack Analysis only covers traditional
booster sets.

### Riftbound Pack Analysis

`app/api/pack-analysis/riftbound/route.ts` — same "read the catalog only, `force-dynamic`" shape
as Lorcana's route, with its own hardcoded `SET_META`/`BOOSTER_SET_CODES` (Origins/Spiritforged/
Unleashed only — Proving Grounds is a promo/event set, excluded) and its own `PULL_RATES`
constant, independent of Lorcana's pack structure entirely (7 Commons + 3 Uncommons + 2 foil
Rare-or-better slots + 1 foil wildcard slot + 1 token, per pack):

| Slot | Rate | Source |
|------|------|--------|
| Epic (in the rare-or-better slots) | 25% | Official (playriftbound.com announcements) |
| Alt Art (foil wildcard slot) | 8.33% (~2 per 24-pack box) | Official |
| Overnumbered (foil wildcard slot) | 1.4% (~1 in 72) | Community |
| Signature (foil wildcard slot) | 0.14% (~1 in 720) | Community |

Sorting cards into Common/Uncommon/Rare/Epic/Alt Art/Overnumbered/Signature buckets for the EV
math goes through the shared `riftboundVariantFlags()` helper (`lib/utils.ts`, see quirk #5's
variant table) — this route used to have its own drifted copy of that classification logic
(string-matching `id.includes('-star-')`, a leftover `rarity === 'Showcase'` check, etc.), the
same duplication already fixed once in the Portfolio price route and search.

`lib/pack-analysis/riftbound-ev.ts` exports this same `PULL_RATES` constant for the frontend to
read directly — it used to also carry a large parallel EV implementation (`RIFTBOUND_EV_SETS`,
`computeEV()`, `RIFTBOUND_EV`) with per-set data frozen at authoring time, entirely unused by
anything (`PackAnalysisPage.tsx` only ever imported `PULL_RATES`) and already diverged from the
real, live-computed route above — removed as dead code.

### Pokémon Pack Analysis — static, not catalog-backed

Unlike Lorcana/Riftbound, Pokémon has no API route at all — `lib/store.ts`'s `defaultPackSets`
hardcodes a handful of `PackSet` entries (prices, pull rates, `expectedValue`) frozen at whatever
date they were authored (some carry an explicit "as of" date in a comment), and
`StandardView`/`PackAnalysisPage.tsx` just renders them. There's no refresh mechanism — these
numbers silently go stale forever unless someone manually edits `lib/store.ts`. If this becomes a
real pain point, the fix is the same shape as Lorcana/Riftbound's: a `force-dynamic` route reading
`loadVisibleCatalog('pokemon')` and computing EV live.

---

## Spending — Hardcoded Product Catalog

`/spending` (`components/pages/SpendingPage.tsx`, backed by `lib/firebase/spending.ts`) logs pack
purchases against a **hardcoded product catalog**, not the card catalog — `lib/spending/catalog.ts`'s
`SPENDING_CATALOG` is a hand-maintained array of `SpendingProduct` (`{ id, game, setCode, setName,
type, name, price, imageUrl, packsIncluded, releaseDate }`, `type` one of `pack` | `booster-box` |
`etb` | `bundle` | `case` | `pre-rift` | `vault-box`), each with a frozen MSRP `price` and a
product image sourced from each game's own CDN (see that file's header comments for the confirmed
CDN URL patterns per game). A `Purchase` (`lib/spending/types.ts` — `{ id, productId, pricePaid,
quantity, date }`, `users/{uid}/purchases/{id}` in Firestore) records what was actually paid for
one of these products, separately from its frozen catalog `price`. Like Pokémon's Pack Analysis
data above, `SPENDING_CATALOG`'s prices are a permanent snapshot with no update mechanism — real
MSRPs/promos will silently drift from what's shown over time.

---

## Automated Sync — Admin Catalog

`/admin` has a **"Sync Card Data"** panel (admin-gated, same as the rest of the page) with one
button per game — Pokémon, Lorcana, Riftbound, One Piece, Magic: The Gathering. Each is a plain, synchronous `POST` to its own API
route that runs the download/diff/registry-update logic directly against Firestore and returns a
JSON result when done; there's no build, no server restart, and no local file writes, so this
works identically whether you're on `npm run dev`, `npm run start`, or the deployed Vercel app.
This used to live on the Settings page as a single button that also ran `next build` and
kill-and-restarted whatever was on port 3000 — that model predated the Firestore migration (it
was a leftover from when the catalog was baked into the build) and couldn't work at all once
Vercel hosting was added: a Vercel function has a read-only filesystem and no persistent process
to restart, so the old `/api/sync` route just threw on every call once the site was hosted there.
The manual per-game instructions elsewhere in this doc remain accurate as a fallback and as an
explanation of what each sync does under the hood.

### What it does, per game

1. **Download** — calls the matching function in `scripts/lib/catalog-sync.mjs` (the same module
   `npm run download-cards` uses) to re-scrape that one game's catalog and sync it into Firestore.
2. **Diff** (Lorcana/Riftbound only) — compares the fresh catalog's distinct `setName` values
   against the registry (`registry/main` in Firestore) to find genuinely new sets.
3. **Riftbound group matching** — for any new (or previously unmatched) Riftbound set, fetches
   `https://tcgcsv.com/tcgplayer/89/groups` and fuzzy-matches the set name against it using
   `scripts/lib/text-norm.mjs`'s `matchSetName()` (exact match, or prefix-stripped/substring
   match, or a high-confidence Levenshtein fallback). Only confident matches are accepted —
   anything uncertain is left unmatched for manual review instead of guessing. If a match is
   found, the game re-downloads once more so that set's prices get merged in.
4. **Registry update** — appends new sets with conservative defaults (`needsReview: true`,
   Lorcana `packAnalysis.included: false`, Riftbound `cardexGroup: "Main Sets"`) and saves the
   updated registry back to Firestore.

Pokémon has no registry involvement at all (steps 2–4 don't apply) — its set list comes live from
`api.pokemontcg.io`, so syncing it is just the download/Firestore-sync step. It's also by far the
slowest of the three (170+ sets, 20k+ cards, a full existing-catalog read to diff against) — it
can take several minutes and may exceed a Vercel function's time limit depending on your plan;
`npm run download-cards` locally has no such limit and remains the reliable way to sync Pokémon.

**One Piece** does steps 1–2 (download + diff) but skips step 3 entirely — there's no group
matching to do, since `downloadOnePiece()` prices every card by exact code match against *every*
tcgcsv group up front, not by knowing which group belongs to which set (see
[§10](#one-piece--data-source-schema-add-a-set-guide)). `app/api/sync/onepiece/route.ts` just
backfills the registry with `{ setName, code, releaseDate: null, cardCount, source:
'auto-detected' }` for any newly-discovered `setName` — no `needsReview` flag, nothing for
Settings' "Needs Review" editor to ever show for this game (same as Pokémon).

**MTG** has no registry involvement at all either, exactly like Pokémon (its set list comes live
from `api.scryfall.com/sets`) — but it's by far the biggest sync here (~99,000 cards vs.
Pokémon's ~20k), and unlike every other game, it isn't wired into the automatic 4x/day cron at
all yet (see [§18](#cron-driven-price-sync)). Clicking this button IS still the one live way to
sync it — a deliberate one-off admin action rather than a recurring background one — but read
"MTG Integration.md" at the repo root before clicking it for the first time: that first click
writes ~99,000 Firestore documents in one run, which can exceed a Firebase Spark (free) plan's
daily write quota.

### New-Rarity Detection & Image Health Check

Every sync (all 5 games, regardless of whether that game has a registry) also does two more
things, surfaced in the Sync panel's result and persisted in `sync_status/{game}` so they're
visible even from the "last known status" view, not just right after clicking Sync:

- **New rarity detection** (`findNewRarities()`, `lib/api/syncHealth.ts`) — diffs the sync's
  distinct `rarity` values against `CARDEX_RARITY_ORDER` (`lib/api/catalog.ts`). The Cardex's
  per-game rarity toggle ([§14](#cardex-feature--how-sets-register)) already derives its button
  list dynamically, so a brand-new rarity value works as a toggle immediately with zero code
  changes — this check exists purely to tell the admin "hey, go add a color/label for it" rather
  than leaving it a flat-gray, un-relabeled pill forever. This is exactly the kind of gap that
  already bit One Piece's `TR`/`P`/`PR` and Pokémon's RGB Mew cards before anyone happened to
  notice by eye — now a sync itself says so.
- **Image health check** — `syncToFirestore()` (`scripts/lib/catalog-sync.mjs`) HEAD-checks every
  card's `imageUrl` and tracks ids whose image doesn't actually resolve in
  `catalog_meta/{game}.brokenImageIds`. The real bug that motivated this: Riftbound's Vendetta Alt
  Rune cards synced with a completely well-formed `tcgplayer-cdn.tcgplayer.com` URL that 403'd
  (TCGPlayer hadn't uploaded that specific product's photo yet) — nothing about the synced *data*
  looked wrong, only an actual HTTP check catches it. To keep this cheap, the **ongoing per-sync
  check only re-verifies two bounded sets**: cards that are brand-new this run, and cards already
  in `brokenImageIds` from a previous run — never the whole catalog on every sync. A previously-
  broken card whose photo TCGPlayer/the source has since uploaded gets detected and dropped from
  the list automatically, reported as `newlyFixedImages`; a newly-broken one is `newlyBrokenImages`.
  Because the ongoing check is bounded to new + already-flagged cards, it has **nothing to catch
  for a card that was already broken before this feature shipped** — that's what
  `npm run check-images -- <game>|all` (`scripts/check-image-health.mjs`) is for: a full one-time
  (or occasional re-run) scan of every card in a game's catalog, seeding `brokenImageIds` with a
  real baseline. Run once per game when this feature is new, or any time you suspect a broader
  problem than the ongoing check would catch; the ongoing per-sync check keeps it current after
  that with no further manual scans needed. `SyncStatus` (`lib/api/syncStatus.ts`) carries
  `newRarities`/`totalBrokenImages`/`newlyBrokenImages`/`newlyFixedImages` alongside the existing
  `newSets`/`setCount` — like `newSets`, these are only meaningful on a successful run;
  `recordSyncStatus()` merges rather than replaces (see quirk #25), so a failed run's write
  leaves an earlier run's counts sitting in the doc, which is why the Sync panel only ever
  displays them next to `last.ok`.
- **Pokémon and MTG's `newSets`** — both lack a registry to diff against (their set lists come
  live from `api.pokemontcg.io`/`api.scryfall.com`), so unlike Lorcana/Riftbound/One Piece they
  never had a "new sets found" signal at all before this. `syncToFirestore()` now computes this
  generically for every game (pre-sync vs. post-sync distinct `setName`s, no extra Firestore read
  — it already has the pre-sync collection in memory for its own admin-edit-wins diffing) and
  returns it as `newSetNames`; Pokémon/MTG's `sync.ts` wire this straight into their `newSets`
  response field, while Lorcana/Riftbound/One Piece keep using their own registry-based `newNames`
  (the one that actually drives registering the set, not just reporting it) since that's a
  materially different, more authoritative signal for those three.

### Key files

- **Firestore `registry/main`** — the single source of truth this whole feature reads/writes
  (formerly `data/set-registry.json`, migrated because a Vercel serverless function can't durably
  write to a git-tracked file). Replaced the hardcoded `LORCANA_GROUPS`/`RIFTBOUND_GROUPS`/
  `LORCANA_KNOWN`/`RIFTBOUND_KNOWN` (`CardexPage.tsx`), `BOOSTER_SETS` (pack-analysis route),
  `RIFTBOUND_SETS` (`lib/api/riftbound.ts`), and `LORCANA_SETS_FALLBACK` (`lib/api/lorcana.ts`).
- `lib/api/registry.ts` — `loadSetRegistry`/`saveSetRegistry`/`invalidateRegistryCache` plus the
  per-game `getXRegistrySets`/`getLorcanaBoosterSets` readers, all async now (a Firestore read
  isn't free the way a local fs read was) with a short in-process staleness cache, mirroring
  `lib/api/catalog.ts`'s shape just without the chunked-snapshot machinery (this doc is tiny).
- `scripts/lib/catalog-sync.mjs` — the actual per-game scraping + Firestore-sync logic
  (`downloadPokemon`/`downloadLorcana`/`downloadRiftbound`/`downloadOnePiece`/`downloadMTG`/
  `syncToFirestore`/`ensureSignedIn`), shared verbatim by `scripts/download-card-catalog.mjs`
  (the CLI entry point, which skips `downloadMTG` unless run with `--include-mtg` — see "MTG
  Integration.md") and `app/api/sync/{pokemon,lorcana,riftbound,onepiece,mtg}/route.ts`.
  Deliberately plain ESM, not TypeScript, so a bare `node` process can still run it directly — it
  does its own Firebase init/sign-in rather than importing `lib/firebase/config.ts` (same
  "duplicated on purpose across the runtime boundary" reasoning as
  `app/api/admin/catalog/lookup/route.ts`'s CSV parser).
- `lib/firebase/adminAuth.ts` — `ensureAdminAuth()`, a small helper the plain `set-registry`
  route (writes that don't need the scraping module) signs in with before writing; the sync
  routes instead call `catalog-sync.mjs`'s own `ensureSignedIn()`, which authenticates the same
  underlying Firebase Auth singleton (both resolve to the same app instance within one process —
  see that file's header comment) so either path leaves the process equally signed in.
- `app/api/sync/{pokemon,lorcana,riftbound,onepiece,mtg}/route.ts` — one route per game, `export
  const maxDuration` set generously (see Vercel's function-timeout docs for what your plan
  allows). Each returns `{ ok, setCount, newSets?, groupMatches? }` directly — no polling, no
  status file.
- `app/api/set-registry/route.ts` — `GET` returns the full registry; `PUT` does a structured
  patch of one set entry (used by the "Needs Review" editor, still on the Settings page); `POST`
  registers a brand new set (Admin Catalog "New Set"). All three read/write the Firestore doc via
  `lib/api/registry.ts`, never touch TypeScript source.

### Guardrails

- The Riftbound group-matching threshold is deliberately conservative (≥90% similarity with a
  confidence margin over the next-best candidate) — an unmatched set is left for manual review
  rather than risking a silently-wrong price feed.
- A confident name match that nonetheless yields zero priced cards after the repricing pass gets
  flagged `needsReview` anyway, as a second safety net against a coincidentally-plausible but wrong
  group ID.
- `syncToFirestore()`'s existing admin-edit-wins-over-resync protection (see [§4](#card-catalog-system--deep-dive-firestore-backed))
  is the only safety net now — there's no more pre-sync backup snapshot (`data/backups/<runId>/`
  doesn't exist anymore; it only made sense next to a local-file registry and local catalog JSON,
  both gone). Nothing is ever deleted by a sync, same as before, just no separate backup copy.

---

## Cron-Driven Price Sync

Before this, live price fetches happened on-demand, per user, every time anyone hit "Refresh
Prices" on Portfolio, plus a 30-minute auto-refresh that fired on every Portfolio page load. For
Riftbound that meant re-downloading and re-parsing every set's full `ProductsAndPrices.csv` live
on every single one of those calls (the single biggest external-API cost in the app, scaling with
every set ever added); for Lorcana it meant a live `api.lorcast.com` request per unique card (no
bulk endpoint exists), 8-way concurrency, making it the slowest game to refresh by far.

**The redesign:** live price fetches now happen in exactly one place — a scheduled sync, 4x/day
(intended as roughly 6am/12pm/6pm/12am) — instead of on every user's every page visit/click.

- **`app/api/cron/sync-prices/route.ts`** — `GET`/`POST`, protected by a shared secret
  (`CRON_SECRET` env var, checked against an `x-cron-secret` header or a `?secret=` query param —
  the query-param form exists because some free external schedulers can't set custom headers).
  Calls `runPokemonSync`/`runLorcanaSync`/`runRiftboundSync`/`runOnePieceSync` — plain functions
  exported from a sibling `sync.ts` module next to each game's `route.ts` (e.g.
  `app/api/sync/pokemon/sync.ts`), imported and invoked directly in-process (not over HTTP, no
  arguments) via `Promise.allSettled`, so one game failing/timing out doesn't block the others.
  The logic lives in `sync.ts` rather than being exported from `route.ts` itself for a build-level
  reason: Next.js's route-file export validator only allows a fixed allowlist of names
  (`GET`/`POST`/`dynamic`/`maxDuration`/...) from a `route.ts`, so a route.ts can't also export an
  arbitrary function the cron route could import — see [Firestore / User Data](#firestore--user-data)'s
  admin-auth paragraph for why this split exists at all (route.ts's own `POST` is now the
  auth-checked HTTP entry point; `sync.ts`'s function is the unauthenticated internal one the
  already-CRON_SECRET-checked cron route calls). `maxDuration = 300`, same headroom as the
  standalone Pokémon sync route, for the same reason (170+ sets, 20k+ cards).
- **MTG's full catalog sync is deliberately NOT included here.** Its first sync alone writes
  ~99,000 Firestore documents — far more than this cron route's other four games combined — which
  risks exceeding a Firebase Spark (free) plan's daily write quota in one automatic run. It only
  syncs via a manual Admin Catalog button click today. What *does* run automatically is
  `checkForNewMtgSets()` (`lib/api/mtg.ts`) — a read-only, zero-catalog-write check that fetches
  Scryfall's live set list and diffs it against a baseline stored in `sync_status/mtg-new-set-check`,
  so a new MTG set doesn't sit unnoticed between manual syncs, without the write-quota risk of a
  real sync. Both this check's own baseline write and `recordSyncStatus()`'s status write
  (`lib/api/syncStatus.ts`) target that same document — they use disjoint field sets and both pass
  `{ merge: true }`, which matters: an earlier version of this feature used a plain (non-merged)
  `setDoc` in both places, so each write silently wiped the other's fields and the check
  permanently reported zero new sets on every run after the first, with no error anywhere to
  surface it. `checkForNewMtgSets()` also explicitly calls `ensureAdminAuth()` itself now rather
  than relying on one of the other games' `ensureSignedIn()` calls happening to win the race
  inside the same `Promise.allSettled` — see [§11](#magic-the-gathering--data-source-schema-add-a-set-guide)
  and "MTG Integration.md" at the repo root for how to wire the real sync in once the write-quota
  concern is resolved.
- **Not a Vercel Cron job** — deliberately, so this works on Vercel plans that don't support
  sub-daily cron schedules. It's triggered by **`.github/workflows/sync-prices.yml`**, a scheduled
  GitHub Actions workflow checked into this repo (4x/day, `x-cron-secret` header sourced from a
  `CRON_SECRET` repository secret) — visible/runnable/auditable from the repo's Actions tab,
  including a manual "Run workflow" button for on-demand triggers. **Needs a one-time setup**
  before it actually fires: the workflow file has a placeholder Vercel URL that must be edited to
  your real deployment, and a `CRON_SECRET` GitHub repository secret matching the one in your
  Vercel project's env vars — see the comment block at the top of that file. (An external
  scheduler like cron-job.org would work exactly as well if you'd rather not use GitHub Actions —
  the route itself doesn't care who calls it, only that the secret matches.)
- **Portfolio's "Refresh Prices" button** (`components/pages/PortfolioPage.tsx`) no longer
  triggers any live external fetch, and the 30-minute auto-refresh-on-page-load is gone entirely
  — refresh only ever happens on an explicit click (or a price-mode toggle, which reuses the same
  function). It reads prices for just the apiIds already in Alex's own inventory from the catalog
  (`app/api/prices/{pokemon,lorcana,riftbound,onepiece,mtg}/route.ts`, all now plain in-memory
  `loadCatalog()` lookups, no network calls) and writes them into `currentPrice` + `priceHistory` exactly as
  before — this part (record a history point on every refresh) didn't change, see
  `applyPriceUpdatesBatch` in [Firestore / User Data](#firestore--user-data) below. Practically:
  price *history* granularity is now driven by how often Alex clicks Refresh, not a fixed timer —
  the catalog's own price data updates 4x/day regardless of whether anyone visits Portfolio at all.
- **Previously-known gap, now fixed:** `app/api/sync/{pokemon,lorcana,riftbound,onepiece,mtg}/route.ts`
  used to have no request-level auth check of their own — they only signed *themselves* in as the
  Firestore admin account internally, so anyone who knew the URL could POST to them directly and
  trigger a full resync (for MTG, that meant anyone who knew the URL could trigger the
  ~99,000-write sync this doc keeps warning about, entirely outside the deliberate manual-only
  gate described above). Every one of these routes' `POST` handlers now calls
  `verifyAdminRequest()` before doing anything — see [Firestore / User Data](#firestore--user-data)'s
  admin-auth paragraph for the mechanism. The cron route's own in-process calls (via each game's
  `sync.ts`) are unaffected, since they never go through `route.ts`'s `POST` at all. The same fix
  was applied to `/api/set-registry` (all three of PUT/POST/DELETE) and
  `/api/admin/catalog/invalidate`/`lookup`, which had the identical gap and weren't even
  documented as sharing it — see [§5](#admin-catalog-page--architecture-caching--diagnostics).

---

## Firestore / User Data

### Collections — the full picture

```
catalog/{game}/cards/{cardId}          — Shared catalog, admin-write-only (§4, §5)
catalog_snapshot/{game}/chunks/{n}     — Pre-sharded catalog snapshot for cheap cold reads (§4)
catalog_meta/{game}                    — { lastBulkSyncAt, brokenImageIds } — resync-vs-admin-edit
                                          bookkeeping + image-health tracking (§4, §16)
registry/main                          — Set registry, admin-write-only (§17)
sync_status/{game|"mtg-new-set-check"} — Last-run status per sync job, admin-write-only (§18)

users/{uid}/
  cards/{cardId}        — Card objects (this user's inventory)
  soldCards/{cardId}     — Sold-card records (see "Sold Cards" below) — same shape as Card plus
                            soldDate/soldPrice/soldAt
  priceHistory/{cardId} — Price history points per card
  purchases/{id}        — Pack purchase records (Spending page — see [§16](#spending--hardcoded-product-catalog)
                            for the current `{ id, productId, pricePaid, quantity, date }` shape)
  collections/{id}      — Personal Collections (§6) — { game, name, cards: [...], createdAt }
```

`game` throughout is `pokemon` | `lorcana` | `riftbound` | `onepiece` | `mtg`. The `catalog*`,
`registry`, and `sync_status` collections are public read / admin write; everything under
`users/{uid}/**` is readable/writable only by that same uid — see `firestore.rules` for the
actual enforcement. The app-level `isAdmin`/`ADMIN_UID` check is UX only for direct Firestore
writes (client SDK calls are still really gated by `firestore.rules`), but for the several
Next.js API routes that write admin-only data server-side (`set-registry`, `admin/catalog/
invalidate`, `admin/catalog/lookup`, `sync/{game}`), there previously was no real caller check at
all — any request reaching the route succeeded, regardless of who sent it, because the route
signed *itself* in as the admin bot account rather than verifying who was asking. This is now
closed: every one of those routes calls `verifyAdminRequest()` (`lib/firebase/
verifyAdminRequest.ts`), which checks the caller's own Firebase ID token (sent as `Authorization:
Bearer <token>`, attached client-side via `lib/firebase/authFetch.ts`'s `adminFetch()`) against
Firebase's Identity Toolkit REST API and rejects anyone whose uid isn't `ADMIN_UID`. The 5
`sync/{game}` routes each split their real logic into a sibling `sync.ts` module (`runPokemonSync`
etc.) precisely so the cron route can still call it in-process post-CRON_SECRET-check without a
second, redundant verification — see [§18](#cron-driven-price-sync).

### Card Object (stored in Firestore)

```typescript
{
  id: string           // Firestore document ID (generated client-side)
  game: 'pokemon' | 'lorcana' | 'riftbound' | 'onepiece' | 'mtg'
  name: string         // Card name (Lorcana includes version: "Mickey - Bob Cratchit")
  set: string          // Human-readable set name (e.g. "Shimmering Skies")
  setCode: string      // Short set code (e.g. "5" for Lorcana, "OGN" for Riftbound)
  number: string       // Collector number as string
  condition: Condition // mint | near_mint | lightly_played | moderately_played | heavily_played
  quantity: number
  purchasePrice: number
  purchaseDate: string  // ISO date string
  isFoil: boolean
  imageUrl?: string    // Cached from catalog at add time
  apiId?: string       // Catalog card ID — CRITICAL for variant matching in Cardex
  currentPrice?: number
  priceUpdatedAt?: string
  createdAt?: string
  priceAtEntry?: number   // market price snapshotted when the card was first added — baseline
                          // for Portfolio's "Since Entry" P&L timeframe
  gradingCompany?: string // e.g. "PSA", "CGC", "BGS", "SGC" — see cardIdentityKey() below
  grade?: string          // e.g. "10", "9.5", "Authentic"
  group?: string          // user-defined group label (e.g. "Alex & Brother's Cards") — drives
                          // Portfolio's hidden-groups filter feature
  priceLocked?: boolean   // when true, "Refresh Prices" never overwrites currentPrice for this card
  rarity?: string         // from the catalog at add time; Pokemon catalog cards don't carry one
  nexus?: boolean         // Riftbound only — user-flagged Nexus Night promo-foil variant
}
```

`lib/utils.ts`'s `cardIdentityKey(card)` is what Inventory groups multiple lots of the "same"
card under — it includes `apiId`/`game`/`isFoil` and, critically, `gradingCompany`+`grade`, so a
raw copy and a graded copy of the same print are never merged into one row with a shared cost
basis (they weren't originally — this was a real bug fixed during a later audit pass).

### Sold Cards

A card sold out of Inventory moves to `users/{uid}/soldCards/{cardId}` (`SoldPage.tsx`,
`/sold` route) rather than being deleted — `SoldCard` (`lib/types.ts`) is a `Card` plus
`soldDate`/`soldPrice`/`soldAt`, so P&L on a sale is still computable later. `lib/firebase/db.ts`
exports `loadSoldCards`/`saveSoldCard`/`deleteSoldCard`; a sold card can be restored back into
active inventory (calls the same `addCard` path AddCardDialog uses, deliberately *not* treated
as a "new card unlock" — see the CardUnlockToast note under [§20](#zustand-store)).

### Invite-Gated Signup

New account creation is gated by a single shared passcode, not open signup — `app/signup/
page.tsx` calls `verifyPasscode()` (`AuthProvider.tsx`), which posts to `POST /api/auth/
verify-passcode`. That route compares the submitted code against `SIGNUP_PASSCODE` (a
server-only env var, never `NEXT_PUBLIC_`) and returns only `{ ok: boolean }` — the real code
never reaches the client. `signInWithGoogle()`'s Google-OAuth signup path enforces the same gate
by deleting the freshly-created Firebase Auth account if the passcode step failed (falling back
to a plain sign-out if the delete itself throws for a reason other than requiring a recent
login).

### Key Firestore Rules

- Firestore rejects `undefined` values entirely. `db.ts` has a `clean()` function that
  strips undefined before any write.
- Always use `|| ''` fallbacks for optional string fields (not `?? undefined`).
- ID generation: `newCardRef(userId)` creates a Firestore doc reference client-side using
  `doc(collection(...))` — zero network cost, unique ID guaranteed.

### Optimistic UI Pattern

1. Card is saved to Zustand immediately (instant UI update)
2. `saveCard(userId, cardId, card)` writes to Firestore asynchronously in background
3. On page refresh, `loadCards(userId)` re-fetches from Firestore and re-populates Zustand

---

## Zustand Store

`lib/store.ts` — mostly in-memory (cards/priceHistory/purchases/soldCards are never persisted,
always re-loaded from Firestore on login), but wrapped in Zustand's `persist` middleware with a
`localStorage` backing (`createJSONStorage(() => localStorage)`, key `"tcghaven-filters"`) for a
small, deliberately-scoped slice of display/filter preferences via `partialize`:
`calcFloor`, `activeGames`, `timeFrame`, `packPriceOverrides`, `priceMode`, `hiddenGroups`,
`lastPriceRefresh`. None of this is inventory data — it's UI state that's reasonable to survive a
refresh/relaunch without waiting on Firestore, and none of it is per-account-sensitive enough to
need clearing on sign-out (a shared/public-device sign-out concern worth being aware of but not
yet addressed).

### State Shape (abridged — see `lib/store.ts` for the full shape)

```typescript
{
  cards: Card[]              // all user's cards, loaded from Firestore on login
  soldCards: SoldCard[]      // see "Sold Cards" in §19
  priceHistory: PriceHistory[]
  purchases: Purchase[]      // pack purchase records from Spending page (§16)
  packSets: PackSet[]        // Pokemon's hardcoded EV data — see §15's Pack Analysis note
  activeGame: Game           // selected game filter
  lastPriceRefresh: string | null
  cardUnlocks: Array<{ id: string; card: Card }>  // queue for CardUnlockToast, below

  // Actions (non-exhaustive)
  loadUserCards(cards)
  loadUserSoldCards(cards)
  loadUserPriceHistory(history)
  loadPurchases(purchases)
  addCard(card)
  updateCard(cardId, updates)
  removeCard(cardId)
  updateCardPrice(cardId, price)
  addPriceHistoryPoint(cardId, price, date)   // dedupes to one point per calendar day
  applyPriceUpdates(updates)                   // batched form of the above two, O(n) not O(n²)
  setLastPriceRefresh(date)
  pushCardUnlock(card) / dismissCardUnlock(id)
  clearUserData()            // called on sign out — clears cards/priceHistory/purchases/
                              // soldCards but NOT the persisted filter/display prefs above
}
```

### "Card Unlocked" celebration

`components/CardUnlockToast.tsx`, mounted once globally in `ClientWrapper.tsx`. When
`AddCardDialog` adds a card, `isFirstCopyOfCard()` (`lib/utils.ts`) checks — against the
in-memory inventory snapshot from *before* the add, so no race with the optimistic update —
whether this is the very first copy of that exact print the user has ever owned (same
apiId-then-set+number identity rules the Cardex uses; deliberately checked against inventory
alone, not the catalog, so it fires for a manually-typed card in an unregistered set too). If so,
`pushCardUnlock()` queues a celebration toast; the component renders only the front of that
queue so a burst of adds during a big unboxing session shows one celebration at a time. Restoring
a card from Sold (§19) reuses the same `addCard` path but is deliberately not treated as a new
unlock. Clicking the toast deep-links to that card's Cardex set.

### Data Loading on Login

`AuthProvider.tsx` runs a `Promise.all` on sign-in, with all four reads isolated by their own
`.catch`:
```typescript
Promise.all([
  loadCards(firebaseUser.uid).catch((err) => { console.error(...); return [] }),
  loadPriceHistory(firebaseUser.uid).catch((err) => { console.error(...); return [] }),
  loadPurchases(firebaseUser.uid).catch((err) => { console.error(...); return [] }),
  loadSoldCards(firebaseUser.uid).catch((err) => { console.error(...); return [] }),
])
```
`dataLoading` is set `false` once this resolves (which it now always does, since none of the four
can reject anymore) or in the outer `.catch` for anything outside those four reads (this used to
leave `dataLoading` `true` forever on failure — fixed earlier). This used to be a plain
`Promise.all` with only `loadSoldCards` individually isolated — if any of the other three
(`loadCards`/`loadPriceHistory`/`loadPurchases`) rejected, **none** of the four store-population
calls ran at all, landing the user on a fully empty Inventory/Portfolio/Spending with only a
`console.error`, indistinguishable from real data loss. Each read failing now independently falls
back to `[]` and logs its own specific error, so one flaky read no longer blanks the other three.

---

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
│       └── text-norm.mjs          ← normSetName(), levenshtein(), matchSetName() — fuzzy set
│                                     matching (Riftbound only — One Piece needs none, §10)
│
├── lib/
│   ├── types.ts                   ← Card, SoldCard, Game, Condition, GAME_COLORS, etc. — §19 has
│   │                                 the full current Card shape
│   ├── store.ts                   ← Zustand store — mostly in-memory, persists a small
│   │                                 filter/display-prefs slice to localStorage (§20)
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
│   │   ├── spending.ts            ← loadPurchases, savePurchase, updatePurchase, deletePurchase
│   │   │                             (§16 — Spending's actual product-catalog redesign)
│   │   └── collections.ts         ← Personal Collections CRUD (§6) — users/{uid}/collections/*
│   ├── auth-errors.ts             ← friendlyAuthError() — shared Firebase error messages
│   ├── spending/
│   │   ├── catalog.ts             ← SPENDING_CATALOG — hardcoded product list (§16)
│   │   └── types.ts               ← Purchase, ProductType (§16)
│   ├── api/
│   │   ├── syncStatus.ts          ← recordSyncStatus()/getSyncStatus()/getAllSyncStatuses() —
│   │   │                             durable per-job success/failure record at sync_status/{id},
│   │   │                             read by Admin Catalog's Sync panel (§17, §18)
│   │   ├── syncHealth.ts          ← findNewRarities() — diffs a sync's rarity values against
│   │   │                             CARDEX_RARITY_ORDER, used by every game's sync.ts (§16)
│   │   ├── catalog.ts             ← loadCatalog()/loadVisibleCatalog()/regenerateSnapshot()/
│   │   │                             invalidateCatalogCache() + scoreMatch() — Firestore-backed
│   │   │                             catalog read/write core shared by all 5 games (§4)
│   │   ├── registry.ts            ← loadSetRegistry()/saveSetRegistry() etc. — Firestore
│   │                             registry/main doc, short in-process staleness cache (§17)
│   │   ├── search.ts              ← searchCards(), getSetsForGame()/invalidateSetsCache() —
│   │   │                             unified entry point (§5's New Set cache note)
│   │   ├── pokemon.ts             ← searchPokemonCards(), getPokemonCardPrice()
│   │   ├── lorcana.ts             ← searchLorcanaCards(), getLorcanaSets() (merges in manual/
│   │   │                             registry-only sets — §5)
│   │   ├── riftbound.ts           ← searchRiftboundCards(), getRiftboundSets()
│   │   ├── onepiece.ts            ← searchOnePieceCards(), getOnePieceSets() (registry-backed,
│   │   │                             no live sets API — mirrors riftbound.ts's shape, §10)
│   │   └── mtg.ts                 ← searchMtgCards(), getMtgSets() (live api.scryfall.com/sets +
│   │                             manual-registry merge — mirrors pokemon.ts's shape, §11)
│   └── pack-analysis/
│       ├── lorcana-ev.ts          ← TypeScript interfaces for Lorcana EV data
│       └── riftbound-ev.ts        ← PULL_RATES only (§15) — used to also carry a large dead
│                                     parallel EV implementation, removed
│
├── app/
│   ├── layout.tsx                 ← Root HTML layout, ClientWrapper (SSR disabled)
│   ├── page.tsx                   ← Portfolio page (root route "/")
│   ├── inventory/page.tsx         ← Inventory page wrapper
│   ├── cardex/page.tsx            ← Cardex page wrapper (includes Personal Collections tab, §6)
│   ├── admin/page.tsx             ← Admin Catalog page wrapper (§5)
│   ├── settings/page.tsx          ← Settings page wrapper — inventory number repair (any signed-
│   │                                 in user) + Needs Review editor (isAdmin-gated, §5); "Sync
│   │                                 Card Data" itself lives at /admin, see §17
│   ├── portfolio/
│   │   ├── [cardId]/page.tsx      ← Individual card detail page → CardDetailPage.tsx
│   │   └── analytics/page.tsx     ← Portfolio analytics (dynamic-imported, ssr:false) →
│   │                                 components/portfolio/PortfolioAnalyticsPage.tsx — linked
│   │                                 from every Portfolio stat tile, undocumented elsewhere
│   ├── spending/page.tsx          ← Pack spending tracker (§16)
│   ├── pack-analysis/page.tsx     ← Pack EV analysis page (§15)
│   ├── sold/page.tsx              ← Sold cards tracker → components/pages/SoldPage.tsx (§19)
│   ├── login/page.tsx
│   ├── signup/page.tsx            ← Invite-passcode-gated signup (§19)
│   └── api/
│       ├── cards/search/route.ts  ← Unified search proxy (avoids browser CORS), capped at 25
│       │                             results (§12)
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
│       │   └── mtg/{route.ts,sync.ts} ← syncs MTG (§11, §17). NOT on the automatic cron below
│       │                             yet — manual-click-only until Firestore write-quota impact
│       │                             is confirmed OK (~99k writes on first run). See "MTG
│       │                             Integration.md" at the repo root.
│       ├── cron/
│       │   └── sync-prices/route.ts ← GET/POST, secret-protected — calls the pokemon/lorcana/
│       │                             riftbound/onepiece sync.ts functions above 4x/day (MTG's
│       │                             full sync excluded on purpose, see sync/mtg above — but its
│       │                             lightweight checkForNewMtgSets() runs here every time, see
│       │                             §18), triggered by an external scheduler outside this repo
│       ├── pack-analysis/
│       │   ├── lorcana/route.ts   ← Lorcana EV calculator (force-dynamic), reads catalog only (§15)
│       │   └── riftbound/route.ts ← Riftbound EV calculator (force-dynamic), reads catalog only,
│       │                             its own PULL_RATES/SET_META (§15). Pokémon's own Pack
│       │                             Analysis is NOT a route — it's lib/store.ts's hardcoded
│       │                             defaultPackSets (§15). One Piece/MTG aren't in Pack Analysis
│       │                             at all — no pull-rate data for either.
│       └── prices/
│           ├── pokemon/route.ts   ← Batch Pokémon price lookup (Portfolio refresh) — catalog-only
│           ├── lorcana/route.ts   ← Batch Lorcana price lookup — catalog-only
│           ├── riftbound/route.ts ← Batch Riftbound price lookup — catalog-only
│           ├── onepiece/route.ts  ← Batch One Piece price lookup — catalog-only, no isFoil
│           │                         branching (no foil/non-foil duality — §10)
│           ├── mtg/route.ts       ← Batch MTG price lookup — catalog-only, isFoil-branching
│           │                         (same shape as lorcana/route.ts — §11)
│           └── ebay/route.ts      ← eBay price lookup proxy
│
└── components/
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
    │   └── AddCardDialog.tsx       ← Add/edit card modal with live search dropdown; fires the
    │                                 "Card Unlocked" toast on a genuinely new print (§20)
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
    │   ├── SpendingPage.tsx        ← Pack purchase logging against SPENDING_CATALOG (§16)
    │   ├── PackAnalysisPage.tsx    ← Expected value analysis — routes per-game to StandardView
    │   │                             (Pokemon) or a live catalog-backed view (Lorcana/Riftbound) (§15)
    │   └── SettingsPage.tsx        ← Inventory number repair (any signed-in user) + Needs Review
    │                                 editor (isAdmin-gated, §5, §17)
    └── portfolio/
        ├── PriceHistoryChart.tsx   ← Recharts line chart for price over time
        ├── PortfolioPieChart.tsx   ← Recharts pie chart for portfolio breakdown by game
        └── PortfolioAnalyticsPage.tsx ← app/portfolio/analytics/page.tsx's real component,
                                      dynamic-imported with ssr:false — linked from every
                                      Portfolio stat tile
```

---

## Key Quirks & Gotchas

### 1. Production server serves stale builds — for CODE changes only
After any **code** change, you MUST:
```bash
npm run build && npm run start
```
Just restarting the server is not enough — Next.js bundles compiled code into build chunks.
**This no longer applies to catalog data** (as of the Firestore migration — see
[§4](#card-catalog-system--deep-dive-firestore-backed)): `npm run download-cards` and any Admin
Catalog edit apply live, no rebuild needed. What *can* still make catalog data look stale
without a rebuild is the in-memory cache gotchas in quirks #14 and #15 below — don't reach for
`npm run build` to fix those, it won't.

### 2. Firestore rejects `undefined`
All writes go through `clean()` in `db.ts` which strips undefined. Never pass
`{ field: undefined }` — it throws. Use `{ field: value || '' }` for optional strings.

### 3. Pokemon TCG API blocks browser CORS
All three games' search calls go through `/api/cards/search` (a Next.js server route)
specifically to avoid CORS. Never call `api.pokemontcg.io` directly from the browser.

### 4. Lorcana Enchanted/Epic/Iconic MUST use rarity queries
The lorcast API does NOT return Enchanted, Epic, or Iconic cards in text-based searches.
These cards only appear via `rarity:enchanted`, `rarity:epic`, and `rarity:iconic` queries. If
the download script's Phase 2 is removed or skipped, the catalog will be missing the most
valuable Lorcana cards entirely. (Iconic itself was missing from Phase 2's query list for a
stretch — any rarity tier introduced in a future set needs to be added here explicitly; lorcast
doesn't return an "all rarities" query that would catch new ones automatically.)

### 5. Riftbound Alt Art/Overnumbered/Signature share collector numbers
Cards #227 (Overnumbered), #227 (Signature), and the base card #227 all have the same
collector number. The `apiId` field (catalog `id`) is the only reliable unique key.
Always add cards via the search dropdown so `apiId` gets populated — fallback matching
by number alone will match all variants of a number.

### 6. Lorcana image format is AVIF
`cards.lorcast.io` serves AVIF images. They won't display on old browsers (pre-Safari 16,
pre-Chrome 85, pre-Firefox 93). No workaround without changing image source.

### 7. Pack Analysis route is force-dynamic
Both `app/api/pack-analysis/{lorcana,riftbound}/route.ts` have `export const dynamic =
'force-dynamic'` to prevent Next.js from pre-rendering them at build time. Without this, prices
would be baked in at build time and never update. Each route reads the catalog via
`loadVisibleCatalog()` on every request, same Firestore-backed cache as everywhere else described
in [§4](#card-catalog-system--deep-dive-firestore-backed) — neither does its own live price fetch
anymore (both used to; see [§18](#cron-driven-price-sync)). Freshness now comes entirely from how
recently the cron sync last ran, not from this route.

### 8. `apiId` is the catalog's `id` field
When Alex selects a card from the search dropdown in AddCardDialog, the `id` field from
the catalog card object is stored as `card.apiId` in the Card record. This is what the
Cardex uses for exact-match ownership detection. For Pokémon it looks like `"sv7-1"`,
for Lorcana like `"5-100"`, for Riftbound like `"origins-001-regular"`.

### 9. Cardex covers all five games — Pokémon/One Piece/MTG use automatic grouping, not a registry
Pokémon *is* in the Cardex (added after initially being excluded — see the history note below).
The "20,000+ cards across 170+ sets" concern this quirk used to describe was never actually a
per-request cost: `/api/cardex` (like Lorcana/Riftbound) only ever renders **one set at a time**,
and a single Pokémon set (60–250 cards) is the same order of magnitude as a Riftbound/Lorcana
set — `loadVisibleCatalog('pokemon')` is already loaded into the in-memory catalog cache for
search regardless (see [§4](#card-catalog-system--deep-dive-firestore-backed)), so filtering it
by `setName` per Cardex request is cheap.

The real obstacle was the **set picker**, not the grid: Lorcana/Riftbound group their sets via a
hand-curated `cardexGroup` field on each registry entry (see
[§17](#automated-sync--admin-catalog)), and hand-curating that for 170+ Pokémon sets one at a
time isn't worth it. The fix: Pokémon's groups are derived **automatically** from the `series`
field the live `api.pokemontcg.io` set list already carries (e.g. `"Scarlet & Violet"`,
`"Sword & Shield"`, `"Base"`) — `buildPokemonGroups()` in `CardexPage.tsx` groups by `series` and
relies on `Map` insertion order to get newest-era-first grouping for free, since
`getSetsForGame('pokemon')` already returns sets newest-first (see `lib/api/search.ts`). No
registry entry or `cardexGroup` value is needed per Pokémon set — this is a genuinely different
(and simpler) mechanism from Lorcana/Riftbound's, not a lesser version of it. Custom/manual
Pokémon sets (Admin Catalog "New Set") get their own trailing "Custom Sets" group instead of a
real era, since they have no upstream `series`.

Pokémon catalog cards now carry a real `rarity` field (see [§7](#pokemon--data-source-schema-add-a-set-guide)
for the full 44-value taxonomy and the Cardex rarity toggle this enabled) — but a small number of
cards (mostly Basic Energy, plus a handful of promo-only sets like McDonald's Collections) genuinely
have none upstream, synced as `''`. `/api/cardex` passes that through as-is, and `CardexPage.tsx`'s
card-hover tooltip conditionally skips the rarity chip (`{card.rarity && (...)}`) rather than
rendering it empty — if you touch that tooltip again, keep that guard, since Lorcana/Riftbound
cards can rely on `rarity` always being a non-empty string but a small fraction of Pokémon cards
still can't.

Ownership matching's fallback (no `apiId`, i.e. a manually-typed inventory card) works the same
way as Lorcana's — `card.set === catalogCard.setName && card.number === catalogCard.number` — and
is safe for Pokémon the same reason it's safe for Lorcana but *not* safe for Riftbound: a Pokémon
catalog number never has more than one card doc sharing it (no alt-art/overnumbered variant
scheme the way Riftbound has — see quirk #5), so there's no false-positive risk from the fallback
alone matching multiple variants at once.

One Piece (added after Pokémon) follows the exact same "too many sets, group automatically"
pattern, just with a different grouping signal: no `series` field exists in its data, so
`buildOnePieceGroups()` groups by the set-code *prefix* (`OP##`/`ST##`/`EB##`/`PRB##`, else
"Promos & Events") that `catalog-sync.mjs`'s `downloadOnePiece()` already derived while syncing —
see [§10](#one-piece--data-source-schema-add-a-set-guide) for the full table. Unlike Pokémon, One
Piece cards *do* always carry a `rarity` (`L`/`C`/`UC`/`R`/`SR`/`SEC`/`"SP CARD"`), so the
rarity-chip guard above doesn't matter for this game — but the *ownership-matching fallback* and
*apiId* story is closer to Lorcana's than Riftbound's, for a related but distinct reason: a One
Piece base card and its Parallel print(s) are separate catalog `id`s (not a shared number with a
rarity/suffix the way Riftbound's Alt Art/Overnumbered are), so the plain `setName`+`number`
fallback can't collapse two real variants onto one Cardex slot the way Riftbound's can.

MTG (added after One Piece) is the third game to follow this "too many sets, group
automatically" pattern — closest to Pokémon's shape (a live external sets API, so no registry
`cardexGroup` at all), but with a different grouping signal since Scryfall has nothing like
Pokémon's `series` field: `buildMtgGroups()` groups by Scryfall's own `set_type` (Expansions,
Core Sets, Masters & Reprint Sets, Commander, Draft Innovation, Un-Sets, Promos each get their
own group; everything else collapses into "Special Sets" — see
[§11](#magic-the-gathering--data-source-schema-add-a-set-guide) for the full table). Ownership
matching's fallback is the Pokémon/Lorcana shape too, for the same reason: a different
art/printing of an MTG card always gets its own distinct collector number as a separate Scryfall
object (finish — foil vs. nonfoil — is a price field on that one object, not a second catalog id
the way Riftbound's variants or One Piece's Parallels are), so there's no false-positive risk
from a plain `setName`+`number` fallback.

### 10. `diagnosFirestore()` — RESOLVED
`diagnosFirestore()` has been removed from `InventoryPage.tsx` and `db.ts` entirely.
No diagnostic writes happen on inventory mount anymore.

### 11. The catalog cache is per-process and self-heals within ~2 minutes — mostly
`loadCatalog()` (`lib/api/catalog.ts`) keeps one in-memory copy per game per Node.js process.
Unlike the old static-JSON era, this cache **does** self-heal without a restart: it treats
itself as stale after 2 minutes (`STALE_MS`) and pulls just the changed docs (`updatedAt >
lastSyncAt`). A server restart isn't required for `npm run download-cards` to show up — worst
case you wait ~2 minutes. What *does* still need explicit invalidation (see quirks #14–15) is
the sub-2-minute case, and any write that forgot to stamp `updatedAt` (permanently invisible to
the delta pull, any wait length).

### 12. Lorcana set matching uses `setName` string, not numeric code
Cards are matched between the catalog and user inventory using the full set name string
(e.g. `"Shimmering Skies"`) not the numeric lorcast ID. The `setCode` stored on Card
is the numeric code (e.g. `"5"`) but the Cardex and all matching logic uses `set` (the
name string). Make sure both fields are stored correctly when adding cards.

### 13. Portfolio "Total Invested" pack toggle
The `+ packs` toggle in Portfolio adds the Spending page's total pack purchases to the
cost basis for P&L calculations. The `purchases` state is loaded in `AuthProvider.tsx`
alongside cards and price history. If `purchases` is empty when toggling, check that
`loadPurchases` is being called in the `Promise.all` in `AuthProvider.tsx`.

### 14. A catalog write from client code needs a server round-trip to actually be seen
`regenerateSnapshot()` (`lib/api/catalog.ts`) is called from Admin Catalog's client-side code
(a `'use client'` component), which runs in the **browser's** copy of that module — a totally
separate JS instance from the one running in the Next.js **server** process that every real
read (`/api/cards/search`, `/api/cardex`, `/api/admin/catalog`, …) actually goes through.
`invalidateCatalogCache()` called from the browser clears only the browser's own unused copy of
`_cache`; the server's copy — the one that matters — hears nothing about it, and silently keeps
serving pre-edit data until its own 2-minute staleness timer happens to fire (see quirk #11),
*and even then* only for cards whose write stamped `updatedAt`. This shipped broken once (the
Admin Catalog Hide toggle looked like it worked, then reverted itself on refresh) before being
fixed with a dedicated `POST /api/admin/catalog/invalidate` route that runs the invalidation
**in the server's own process**. See [§4](#card-catalog-system--deep-dive-firestore-backed) for
the full writeup. **If you add a new client-side catalog write path, route it through
`regenerateSnapshot()` (or replicate its invalidate-fetch) — don't just call
`invalidateCatalogCache()` directly from client code, it silently does nothing useful.**

### 15. The set-picker cache (`getSetsForGame`) never expires on its own
Separate from quirk #14/§4's catalog cache: `lib/api/search.ts`'s `setsCache` module variable
caches each game's set list forever once populated ("only cache non-empty results so a
transient API failure doesn't stick" means no TTL at all). Registering a new set via `POST
/api/set-registry` calls `invalidateSetsCache(game)` directly — that route already runs
server-side, so (unlike quirk #14) no client-fetch round-trip is needed; the direct call already
executes in the same process as the cache. If you add another way to write the registry, remember
to invalidate this cache too, or new sets won't appear in `/api/sets` until server restart.

### 16. Riftbound raw-source/TCGCSV number matching must check `publicCode`, not just `number`
Alt Art/Overnumbered/Signature variants share their base card's bare `number` field — the `a`/`*`
suffix only ever lives in `publicCode` (see [§9](#riftbound--data-source-schema-add-a-set-guide)'s
variant table). TCGCSV's `extNumber` column, however, always carries that suffix (e.g.
`"007a/298"`). Any tool that diffs/matches Riftbound cards by collector number against an
external feed (like Admin Catalog's Raw Source Check, [§5](#admin-catalog-page--architecture-caching--diagnostics))
must normalize and check *both* a card's `number` and the number+suffix parsed out of its
`publicCode`, or every Alt Art card in the set shows up as a false-positive mismatch.

### 18. Riftbound rarity naming: "Alt Art" and "Overnumbered", not "Showcase"
These two variant types used to share a single flattened `rarity: "Showcase"` catalog value
(see [§9](#riftbound--data-source-schema-add-a-set-guide)'s variant table) — they're now stored
as distinct `"Alt Art"` and `"Overnumbered"` values so the app calls each variant what
collectors actually call it. `scripts/lib/catalog-sync.mjs`'s `downloadRiftbound()` assigns the
correct one going forward; `scripts/migrate-riftbound-rarity.mjs` is a one-off migration for
cards already in Firestore under the old `"Showcase"` value (run `node
scripts/migrate-riftbound-rarity.mjs` for a dry run, `--apply` to actually write — it also
rebuilds `catalog_snapshot/riftbound`). `lib/utils.ts`'s `riftboundVariantFlags()` still treats
a `"Showcase"` rarity as a fallback (re-deriving Overnumbered from `publicCode`) so any doc the
migration hasn't reached yet still displays and prices correctly.

### 17. Admin Catalog vs. Personal Collections — don't conflate them
See [§6](#personal-collections-vs-the-admin-catalog) for the full comparison table. Short
version: Admin Catalog (`/admin`) is the shared, admin-only-writable source of truth every user
reads from; Personal Collections (a tab inside `/cardex`) is a private, per-user curation tool
that can only reference cards already in that shared catalog. A request to add a whole new
*set* other users would see, or to add a card that doesn't exist anywhere in the catalog yet,
belongs in Admin Catalog — not Personal Collections, which has no way to do either.

### 19. Portfolio price refresh is manual-only and never hits a live external API
See [§18](#cron-driven-price-sync) for the full writeup. Short version: there is no more
30-minute (or any) auto-refresh on Portfolio page load — prices only change when Alex clicks
"Refresh Prices" (or toggles price mode), and that click only ever reads the catalog
(`loadCatalog()`, already in-memory-cached per [§4](#card-catalog-system--deep-dive-firestore-backed)) —
it never calls tcgcsv.com/lorcast/pokemontcg.io directly. The catalog itself is what stays live,
via a 4x/day cron hitting `app/api/cron/sync-prices/route.ts`. If prices look stale, check when
that cron last actually ran (it's triggered by an external scheduler outside this repo, not
anything in-app) before assuming a code bug — worst case, `npm run download-cards` or the Admin
Catalog "Sync Card Data" button both still work exactly as before for a manual catch-up.

### 20. Adding a new game means updating every `GAMES`/`ALL_GAMES` array — TS won't catch all of them
`Game` (`lib/types.ts`) is a plain string union, not something with a single source-of-truth
array — every page/route that iterates "all games" keeps its own `const GAMES: Game[] = [...]`
(or `ALL_GAMES`, `SYNC_GAMES`, etc.), so adding One Piece meant grepping for every one of them
individually (`app/api/admin/catalog/{route,invalidate,search}.ts`, `app/api/set-registry/route.ts`,
`components/layout/FilterPanel.tsx`, `components/inventory/AddCardDialog.tsx`,
`components/pages/{InventoryPage,SoldPage,SpendingPage,AdminCatalogPage}.tsx`) — `tsc` only
catches a missing game where the array itself is typed `Game[]` or assigned to a
`Record<Game, X>`-typed variable *without* an `as Record<Game, X>` cast in between; a cast (`{
pokemon: 0, lorcana: 0, riftbound: 0 } as Record<Game, number>`) defeats that check entirely,
since TS doesn't verify a literal matches the *target* of an `as` the way it would a direct
assignment. Two real instances of exactly this shipped broken during the One Piece build before
being caught by hand: `InventoryPage.tsx` and `SoldPage.tsx` both had a `gameCounts` initializer
shaped `{ pokemon: 0, lorcana: 0, riftbound: 0 } as Record<Game, number>` — the One Piece tab's
count badge silently rendered blank (not even `"0"`) because `counts.onepiece` was `undefined`,
not `0`, and React renders `undefined` as nothing. If you add a new game, grep for
`pokemon:.*lorcana:.*riftbound:` (or `onepiece:` once that's part of the pattern) across
`.ts`/`.tsx` first, and treat every hit as a checklist — don't rely on `tsc --noEmit` alone to
find them all. This is exactly the grep MTG's own addition used — `grep -rln "onepiece"` across
the repo (One Piece being the most recently added game at the time) turned up every file that
needed an `mtg` counterpart, `gameCounts` casts included, with zero missed on the first pass.

### 21. The Cardex catalog-fetch effect must reset `loading` on every early-return path, not just its own
`CardexPage.tsx`'s catalog-fetch `useEffect` bails early (no fetch) for the Personalized
Collections tab, a not-yet-loaded `activeSet`, and any `fromInventory` "Special" bucket set — but
only the real-fetch path used to reset `loading` (in its `finally`). Switching from a still-loading
real set straight to a `fromInventory` set left `loading` stuck `true` forever: the in-flight
fetch's own cleanup marks itself `stale` (correctly suppressing its now-unwanted
`setCatalogCards`), which *also* suppresses its `finally`'s `setLoading(false)` — and the
early-return branch that fires instead never called `setLoading` at all, so nothing ever unstuck
it. The loading spinner and the real content (`SpecialBucket`) aren't mutually exclusive in the
JSX (`{loading && ...}` and `{isSpecial && <SpecialBucket .../>}` are independent conditions), so
this didn't crash anything — it just left a spinner floating uselessly above correct content
forever, until the next full page reload. Reproduces trivially for any game whose *only* Cardex
group is "Special" (true for One Piece before its first successful sync populates the registry —
every single set click lands on the fromInventory branch), which is how this was caught; it was
already latent for Lorcana/Riftbound/Pokémon, just far less likely to be hit by a normal click.
Fixed by having the early-return branch explicitly call `setLoading(false)` itself rather than
assuming whatever the flag last was is fine. If you touch this effect again, every early-return
path needs to leave `loading` in a *known* state, not just avoid setting it to `true`.

### 22. `registry/main` must be merged over `EMPTY_REGISTRY`, not trusted as-is, when a new game key is added
`loadSetRegistry()` (`lib/api/registry.ts`) used to do `snap.exists() ? (snap.data() as
SetRegistry) : EMPTY_REGISTRY` — fine as long as the *real* Firestore document already has every
key `SetRegistry` claims to have. It doesn't, for any game added after the registry's first ever
write: the actual stored doc predates that game's key entirely, so `registry.onepiece` was
genuinely `undefined` at runtime the first time anything read it, despite the `as SetRegistry`
cast insisting otherwise to TypeScript. First symptom: `app/api/sync/onepiece/route.ts` threw
`Cannot read properties of undefined (reading 'sets')` on `registry.onepiece.sets.map(...)` —
`tsc` had nothing to say about it, since the cast suppresses exactly this kind of check. Fixed by
merging over `EMPTY_REGISTRY` instead of falling back to it only when the whole document is
missing: `{ ...EMPTY_REGISTRY, ...(snap.data() as Partial<SetRegistry>) }`. If a 5th game is ever
added, its registry key needs nothing further done for this specific problem — the merge already
covers it — but it's worth remembering this class of bug exists (a stored document can lag the
type that describes it) if `SetRegistry`'s shape changes in some other way later.

### 23. A `$` in `ADMIN_PASSWORD` silently breaks Next.js's own env loading (but not a raw file read)
`ensureSignedIn()` (`scripts/lib/catalog-sync.mjs`) failed with Firebase's `auth/invalid-credential`
when called from a Next.js API route, while the *exact same* email/password — read directly off
disk by a plain Node script, or sent straight to Firebase's REST `accounts:signInWithPassword`
endpoint — worked every time. The cause: Next.js's env loader (`@next/env`) runs `dotenv-expand`
over every `.env*` file, which treats an unescaped `$something` in a value as a reference to
*another* environment variable to interpolate. `ADMIN_PASSWORD` happened to contain a `$` (a
17-character password); since no env var named after whatever followed it existed, `dotenv-expand`
silently truncated `process.env.ADMIN_PASSWORD` down to 11 characters *inside the running Next.js
process only* — a naive `fs.readFileSync('.env.local')` (or curl, or a standalone script that
parses the file itself rather than relying on Next's loader) never goes through this expansion at
all, which is exactly why every diagnostic that didn't route through Next.js's own env loading
kept reporting the credential as fine. **Restarting the dev server, and even fully deleting
`.next`, does not fix this** — the mangling happens at env-load time on every process start, not
from a stale build cache; wasted time here checking those first. The fix is to escape the `$` as
`\$` in the `.env.local` value itself (both `dotenv` and `dotenv-expand` respect this). If a
future secret (API key, password, etc.) ever contains `$`, `` ` ``, or a bare (unquoted) `#`,
assume the same class of silent mismatch until proven otherwise — compare `.length` of the raw
file value against `process.env.X.length` as read by an actual Next.js route (not a standalone
script) before trusting that "the .env file looks right" means "Next.js is using what's in it."

**Part 2 — the fix above (escaping `$` as `\$`) broke the OTHER loader.** `scripts/
download-card-catalog.mjs` used to run via `node --env-file=.env.local` (see `package.json`'s
"download-cards" script). Node's built-in `--env-file` flag does **not** implement dotenv-expand's
escape semantics — it left the literal backslash IN the value (`\$` read as two characters, not
unescaped to `$`), so `npm run download-cards` sent Firebase an 18-character password with a
stray backslash instead of the real 17-character one, failing every sign-in with the same
`auth/invalid-credential` — silently, since the script's own error output doesn't call out *why*
credentials would be wrong when the `.env.local` file "looks right." This one was caught while
diagnosing why Portfolio's "Refresh Prices" looked stale for Riftbound: the catalog's
`lastBulkSyncAt` was over a week old because the CLI fallback for manually re-syncing had been
broken this whole time (the web Admin Catalog page was unaffected — it goes through Next.js's own
env loading, the thing Part 1 above already fixed correctly). **The fix:** `download-card-catalog.mjs`
no longer relies on `--env-file` at all — it parses `.env.local` itself (`loadEnvLocal()`, top of
the file) and unescapes `\$` the same way `dotenv-expand` does, via a **dynamic** `import()` of
`./lib/catalog-sync.mjs` *after* that parsing runs (a static top-level `import` would execute
`catalog-sync.mjs`'s module-level `initializeApp()` — which reads `process.env.NEXT_PUBLIC_FIREBASE_*`
— before `loadEnvLocal()` ever got a chance to set those vars). If you ever add a third way to run
this scraping code outside of Next.js's request lifecycle, re-derive its env loading from this
script's `loadEnvLocal()`, not from a fresh `--env-file`/`dotenv` call — every generic env loader
you reach for has its own opinion about backslash escapes, and this secret's `$` will keep
finding the ones that guess wrong.

### 24. A Next.js `route.ts` can't export an arbitrary function alongside its HTTP handlers
The fix for quirk-class "any caller who knows a URL can trigger an admin-only sync" (see §5's
"Auth model" and §18's now-fixed "Known gap") needed each `sync/{game}/route.ts`'s real logic
reachable from two callers with different trust levels: the cron route (already authorized via
`CRON_SECRET`, wants to call in-process with no further check) and a real HTTP `POST` (needs
`verifyAdminRequest()` first). The first attempt made `request` an optional parameter on `POST`
itself (`export async function POST(request?: Request)`, skipping the check when absent) — this
passes `tsc --noEmit` cleanly but fails `next build`: Next's route-handler type checking rejects
`Request | undefined` as an invalid first-argument type, and a second attempt (exporting a second
named function like `runPokemonSync` alongside `POST` from the same `route.ts`) fails for a
different reason — Next's route-file export validator only allows a fixed allowlist of names
(`GET`/`POST`/`dynamic`/`maxDuration`/...) from any file Next treats as a route, and rejects the
whole build the moment an unrecognized export appears. **Neither failure shows up in `tsc --noEmit`
alone** — only `next build` catches them, so a bare typecheck is not sufficient verification for
a change touching any `route.ts` file's exports or handler signatures; run a real `npm run build`
too (see quirk #1's dev/build-conflict warning before doing so while `npm run dev` is running).
The actual fix here: move the real logic into a sibling **non-route** file (`sync.ts`, not
`route.ts`) that both `route.ts`'s `POST` and the cron route can import — a plain module has no
export restrictions at all. If you ever need the same "authenticated HTTP entry point + trusted
internal caller" shape for a new route, this sibling-module split is the pattern, not an optional
argument or a second route.ts export.

### 25. Two writers to the same Firestore doc need `merge: true`, or the second write silently erases the first's fields
`checkForNewMtgSets()` (`lib/api/mtg.ts`) and `recordSyncStatus()` (`lib/api/syncStatus.ts`) both
write to `sync_status/mtg-new-set-check` — the former stores its own `{ codes, updatedAt }`
baseline for diffing against next time, the latter stores the generic `{ ok, at, newSets, error }`
status shape every other sync job's `sync_status/{game}` doc uses. Both used to call `setDoc(ref,
data)` with no options, which **replaces the whole document** rather than merging fields — so
every cron run, `checkForNewMtgSets()` would write its baseline, and `recordSyncStatus()` would
immediately overwrite the same doc and wipe that baseline back out. Next run, `checkForNewMtgSets()`
would read back `codes: undefined`, treat it as a first-ever run (no real baseline to diff
against), and unconditionally report zero new sets — forever, with `ok: true` on every run and
nothing anywhere indicating the feature was inert. This is the kind of bug that's invisible from
the outside (no error, a plausible-looking response) and only found by reading the actual
Firestore document and noticing `codes` was never actually there. The fix — `setDoc(ref, data, {
merge: true })` in both writers, since their field sets are disjoint by design — generalizes: any
time two independent pieces of code write to the same document id for different reasons, default
to `merge: true` unless one of them is deliberately meant to be a full replace, and if you're
debugging a "this write looks like it succeeded but the data isn't there next time" report, check
whether something else writes the same doc path without merging.

### 26. eBay Cmd+Click is a convention, applied by hand at each card-tile call site — not one component
`openEbaySearch()` (`lib/utils.ts`) builds and opens an eBay sold-listings search URL for a card.
Every place a card is clickable follows the same convention: `cursor-pointer`, an `onClick` that
checks `e.ctrlKey || e.metaKey` before calling `openEbaySearch(card)` (falling through to whatever
the plain click does, if anything — often nothing, for a pure browsing grid), and a
`title="⌘/Ctrl+Click to search eBay sold listings"` hint. There's no shared `<ClickableCardTile>`
wrapper component enforcing this — it's copy-pasted at each of the ~9 call sites across
`InventoryPage.tsx`, `PortfolioPage.tsx`, `CardexPage.tsx` (both `CardTile` and
`InventoryCardTile`), `PersonalCollectionsView.tsx`, `SoldPage.tsx`, and `CardDetailPage.tsx`. If
you add a new place a card is rendered as a clickable tile/row, match this exact convention by
hand rather than inventing a different gesture or wording — and if a card's shape doesn't
naturally have `openEbaySearch`'s required fields (`name`, `number`, `set`, `game`, plus optional
`gradingCompany`/`grade`/`isFoil`), construct a matching object rather than skipping the feature,
the way `CardTile`'s catalog-backed card (no native `game` field) and `PersonalCardTile`'s
collection card (no native `game` field either — comes from `collection.game`) both do.
Deliberately NOT wired up on `AddCardDialog`'s search results or Admin Catalog's browser table —
those are "picking a card to add" / "managing shared catalog data" contexts, not "viewing a card
you already have," which is what this gesture is for everywhere else.

### 27. `cards.scryfall.io` 400s any request with no `User-Agent` header — including Node's bare `fetch()`
The image-health check's `findBrokenImageUrls()` (`scripts/lib/catalog-sync.mjs`, §16) first shipped
broken against MTG's ~100k-card catalog: every single HEAD check failed, reporting the entire
catalog as broken (a sample included cards like Forest/Swamp/Birds of Paradise, confirmed working),
which blew past Firestore's 1MiB document limit and crashed the run. **First fix attempt
misdiagnosed the cause as CDN rate-limiting under concurrency** and added a retry-after-delay plus
a `suspicious`-result guard (skip trusting/persisting a run whose broken rate is implausibly high)
— the guard correctly stopped the crash from recurring, but a second full run still failed
100370/100370 with the retry in place, proving rate-limiting was never the real cause. **The actual
cause:** Node's built-in `fetch()` sends no `User-Agent` header by default, and `cards.scryfall.io`'s
edge 400s any request with none — confirmed by direct reproduction outside this app: a plain `curl`
HEAD to the exact same URL succeeds every time (curl always sends its own UA), a bare Node
`fetch()` HEAD 400s every time even at concurrency 1 (so retries never helped — the same missing
header fails identically on every attempt), and adding literally any non-empty `User-Agent` string
makes it 200 every time, no `Accept` header needed. This is a separate requirement from
`SCRYFALL_HEADERS` (§11 — `api.scryfall.com`'s JSON API, needs `Accept: application/json` too) —
an image HEAD check has no JSON body to accept, just needs *a* UA present. Fixed by adding a
dedicated `IMAGE_CHECK_HEADERS = { 'User-Agent': 'TCGHaven/1.0' }` to every `findBrokenImageUrls()`
request, sent unconditionally (not just for Scryfall URLs) since a harmless header addition is
simpler than per-CDN branching and can only help elsewhere. The retry-after-delay and `suspicious`-
rate guard are still worth keeping as a backstop against a genuine transient outage on some other
CDN — they just weren't what caused *this* particular 100%-failure run. If a future image-source
CDN ever shows the same "every single check fails, including retries" pattern, suspect a missing
required header (User-Agent, Referer, etc.) before assuming rate-limiting — a real rate limit
usually degrades gradually or recovers on retry; a header-rejection failure is 100% and deterministic.
