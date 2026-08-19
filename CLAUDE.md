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
10. [Card Search Flow](#card-search-flow)
11. [Price Data](#price-data)
12. [Cardex Feature — How Sets Register](#cardex-feature--how-sets-register)
13. [Pack Analysis Feature — How Sets Register](#pack-analysis-feature--how-sets-register)
14. [Automated Sync — Admin Catalog](#automated-sync--admin-catalog)
15. [Firestore / User Data](#firestore--user-data)
16. [Zustand Store](#zustand-store)
17. [Full File Map](#full-file-map)
18. [Key Quirks & Gotchas](#key-quirks--gotchas)

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 App Router (TypeScript) |
| Styling | Tailwind CSS v3 |
| State | Zustand v4 — in-memory client cache, no localStorage persist |
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
```

**Card catalog data no longer requires a rebuild to pick up changes** — as of the Firestore
migration (see [§4](#card-catalog-system--deep-dive-firestore-backed)), the catalog lives in
Firestore and is read live (with a short in-memory staleness window), not bundled into the
build. `npm run build && npm run start` is still required for actual **code** changes (editing
`.tsx`/`.ts` files), just not for `npm run download-cards` or any edit made from the Admin
Catalog page.

All of the above download+registry-sync workflow is also available as one click: Admin Catalog →
"Sync Card Data" (see [§14](#automated-sync--admin-catalog)) — a plain per-game API request with
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
sync with the three upstream sources (Pokémon TCG data, lorcast, the Riftbound gallery/TCGCSV)
— it scrapes fresh data and **writes it into Firestore**, never clobbering an admin edit made
since the last sync (see [§4](#card-catalog-system--deep-dive-firestore-backed)). It's for
picking up new upstream cards/sets, not a prerequisite for the catalog to work at all.

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
catalog_meta/{game}                    — { lastBulkSyncAt } — lets download-card-catalog.mjs
                                          know whether an admin edit happened since its last
                                          run, so it never clobbers one.
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
  game's `groupOrder` (see [§12](#cardex-feature--how-sets-register)) so the new set actually
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
    not `number` alone. Showcase/Overnumber/Signature variants share their base card's bare
    `number` (the `a`/`*` suffix only ever lives in `publicCode` — see
    [§9](#riftbound--data-source-schema-add-a-set-guide)'s variant table), while TCGCSV's
    `extNumber` column always carries that suffix (e.g. `"007a/298"`). Matching only against
    `number` produces a wall of false-positive "unmatched" Showcase rows — this was caught and
    fixed the same session this tool was built; if you touch this matching logic again, test it
    against a set with Showcase cards (e.g. Origins) before trusting the output.
  - Each finding has an "Add" button that opens Add Missing Card prefilled from the raw source
    entry (name/number/rarity/image — price is left for the admin to fill in, since the exact
    row that matched isn't surfaced through this button, only through the separate TCGCSV-only
    diff list).
  - Real example this tool caught on first use: Vendetta's TCGCSV feed has a priced
    "Zed - Master of Shadows (Signature)" row that doesn't exist under any name in the local
    catalog at all — a genuinely missing card the normal sync silently skipped.

### Key files

- `components/pages/AdminCatalogPage.tsx` — the whole page: `SyncPanel` (§14), `CatalogBrowser`,
  `CardTable`, `AddCardForm`, `EditCardForm`, `NewSetForm`, `RawSourceCheckPanel`, `ImageUploadField`.
- `app/api/admin/catalog/route.ts` — `GET`, read-only listing (includes hidden cards, unlike
  every other catalog consumer — the admin table needs to show and un-hide them).
- `app/api/admin/catalog/lookup/route.ts` — exact-match external price/image lookup, used by
  "Auto-fetch price & image" in Add Missing Card. Never writes anything.
- `app/api/admin/catalog/invalidate/route.ts` — `POST { game }`, drops the **server's** catalog
  cache for a game. See the cache-invalidation gotcha in [§4](#card-catalog-system--deep-dive-firestore-backed).
- `app/api/admin/catalog/raw-source/route.ts` — the Raw Source Check diff, Riftbound-only today.
- `app/api/set-registry/route.ts` — `GET` full registry; `PUT` a structured patch to one existing
  set entry (Settings "Needs Review" editor); `POST` registers a brand new set entry (New Set
  form). All three only ever touch the registry (Firestore `registry/main`), never TypeScript source.
- `lib/api/catalog.ts` — `loadCatalog`/`loadVisibleCatalog`/`regenerateSnapshot`/
  `invalidateCatalogCache`, plus `sortCatalogCards`/`scoreMatch`/`parseSearchQuery` shared by all
  three games' search.
- `lib/firebase/config.ts` — exports `ADMIN_UID` (from `NEXT_PUBLIC_ADMIN_UID`), used by both
  this page's `isAdmin` check and (independently, for real enforcement) `firestore.rules`.

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

### Catalog Schema (`catalog/pokemon/cards/{id}` Firestore doc)

Each card doc:
```json
{
  "id": "sv7-1",           // "{setId}-{number}" — globally unique
  "name": "Pikachu",       // card name only (no version/subtitle)
  "set": "sv7",            // set ID (matches GitHub file name without .json)
  "setName": "Stellar Crown",  // human-readable set name
  "number": "1",           // collector number as string
  "imageUrl": "https://images.pokemontcg.io/sv7/1_hires.png"
}
```

Note: Pokémon catalog cards do NOT include price. Prices are fetched live from
`api.pokemontcg.io` individually when a card is selected in AddCardDialog, or when
"Refresh Prices" is clicked in the Portfolio view.

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

When a Pokémon card is selected from the dropdown, `AddCardDialog` calls
`getPokemonCardMarketPrice(card, isFoil)` which reads prices directly from the
`card.tcgplayer.prices` object returned by the API. This price is stored as
`purchasePrice` if Alex leaves it blank.

The `apiId` stored on the Card is the catalog's `id` field (e.g. `"sv7-1"`). This is
later used by `getPokemonCardPrice(apiId, isFoil)` in the Portfolio price refresh.

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
2. **Admin Catalog → "Sync Card Data"** (see [§14](#automated-sync--admin-catalog)) — the steps below
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
three hardcoded arrays that used to need separate edits — see [§14](#automated-sync--admin-catalog)):

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
                               //   Showcase, Star (Signature = "Star" in catalog)
  "cardType": "Unit",          // Unit, Spell, Item, etc.
  "tags": ["Ahri"],            // champion tags — "Deceiver" is tagged ["LeBlanc"] etc.
  "imageUrl": "https://cmsassets.rgpub.io/...",  // Riot CDN, JPEG format
  "marketPrice": 1.25,         // TCGPlayer normal market price (0 if unpriced)
  "marketPriceFoil": 0         // TCGPlayer foil market price (Showcase/Star only have foil)
}
```

### Riftbound Card Variants (CRITICAL — read this carefully)

Riftbound has multiple "alt-art" variants for the same card, all sharing the same collector
number. This is why a simple number-based lookup causes false positives in the Cardex.

| Variant | Rarity | publicCode | Description |
|---------|--------|-----------|-------------|
| Base | Common/Uncommon/Rare/Epic | `OGN-001/298` | Normal card |
| Showcase | Showcase | `OGN-007a/298` | Alt art (same number, "a" suffix in publicCode) |
| Overnumber | Showcase | `OGN-227/221` | Collector number exceeds set size |
| Signature | Star | `OGN-227*/221` | Signed variant, `*` suffix in publicCode |

The `RARITY_ORDER` in the Cardex API sorts these:
- Common=0, Uncommon=1, Rare=2, Epic=3 (Champion), Showcase=90, Star=91

Showcase and Star always appear after the base card with the same number.

### Price Matching Logic (Riftbound)

The download script uses a `tcgKey()` / `catalogKey()` system to match TCGPlayer prices
to catalog cards:

```
catalogKey(card) → "OGN:7:regular"  (base Ahri card #7)
catalogKey(card) → "OGN:7:altart"   (Showcase with publicCode "007a/298")
catalogKey(card) → "OGN:227:over"   (Overnumber)
catalogKey(card) → "OGN:227:star"   (Signature)
```

Showcase and Star cards only have foil prices. The script assigns `marketPrice` as the foil
price for these variants.

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
3. **Admin Catalog → "Sync Card Data"** (see [§14](#automated-sync--admin-catalog)) — this whole flow,
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

## Card Search Flow

When Alex types a name in the AddCardDialog search box:

```
User types query
  → AddCardDialog debounces 300ms
  → fetch("/api/cards/search?game=lorcana&q=mickey")
  → app/api/cards/search/route.ts (server-side)
  → searchCards(game, query) in lib/api/search.ts
  → calls searchLorcanaCards(query) / searchPokemonCards(query) / searchRiftboundCards(query)
  → loadVisibleCatalog(game) in lib/api/catalog.ts — Firestore-backed, in-memory cached
    per server process (see §4 for the caching/staleness mechanics)
  → scoreMatch() ranks results by word-start prefix matching
  → returns top 20 results as JSON
  → AddCardDialog renders dropdown with name, image, set, price
```

**Why server-side?** The Pokémon TCG API blocks browser CORS requests. By routing all
searches through Next.js API routes, we avoid CORS entirely for all three games.

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

### Pokémon

- **Source:** `api.pokemontcg.io/v2` (official API)
- **When fetched:** Live, per-card, when Alex selects a card in AddCardDialog
- **API key:** Set `NEXT_PUBLIC_POKEMON_TCG_API_KEY` in `.env.local` for higher rate limits
  (5000/day with key vs 250/day without). Without a key, the app still works.
- **Price refresh:** Portfolio page → "Refresh Prices" button calls `getPokemonCardPrice(apiId, isFoil)`
  which hits `api.pokemontcg.io/v2/cards/{id}` and reads `tcgplayer.prices`
- **Foil logic:** `isFoil=true` → holofoil market price; `isFoil=false` → normal market price
- **Stored on Card:** `currentPrice` field updated by refresh; `purchasePrice` set when card added

### Lorcana

- **Source:** `api.lorcast.com`, synced into each card's Firestore doc
- **When fetched:** At `npm run download-cards` time (no live fetch during a normal search) —
  Pack Analysis is the one exception, see [§13](#pack-analysis-feature--how-sets-register)
- **To update prices:** `npm run download-cards` (no rebuild needed — see [§4](#card-catalog-system--deep-dive-firestore-backed))
- **Fields in catalog:** `marketPrice` (non-foil) and `marketPriceFoil` (foil/cold foil)
- **Note:** Enchanted and Epic cards may have `marketPrice: 0` because they are foil-only;
  their price is in `marketPriceFoil`

### Riftbound

- **Source:** `tcgcsv.com` (TCGPlayer mirror), synced into each card's Firestore doc
- **When fetched:** At `npm run download-cards` time
- **Showcase/Star cards:** These are foil-only; `marketPrice` is set to the foil price,
  `marketPriceFoil` is 0 (they don't have separate foil vs non-foil listing)
- **To update prices:** `npm run download-cards` (no rebuild needed — see [§4](#card-catalog-system--deep-dive-firestore-backed))

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
This is the only reliable match for Riftbound Showcase/Overnumber/Signature cards that
share collector numbers with their base card.

**Fallback (set + number):** Used when `card.apiId` is absent (manually added cards).
- Lorcana: `card.set === catalogCard.setName && card.number === catalogCard.number`
- Riftbound: `card.setCode === catalogCard.setCode && card.number === catalogCard.number`

**Warning:** The fallback can cause false positives for Riftbound Showcase cards. If Alex
owns an Overnumber card but added it without selecting from the search dropdown (so no
`apiId`), both the Overnumber and Showcase slot will show as owned. The fix is to always
select cards from the dropdown so `apiId` is set.

### Set Registration

To appear in the Cardex set picker, a set must have a `cardexGroup` value in its
**registry** entry (Firestore `registry/main`, see [§14](#automated-sync--admin-catalog)) matching one of
that game's `groupOrder` labels. `CardexPage.tsx` fetches `GET /api/set-registry` once on mount
and derives the equivalent of the old hardcoded `LORCANA_GROUPS`/`RIFTBOUND_GROUPS` client-side
via `buildGroupsByGame()`. The `setName` field must exactly match the `setName` field on the
catalog's Firestore card docs — this is also exactly what Admin Catalog's "New Set" form
registers (see [§5](#admin-catalog-page--architecture-caching--diagnostics)).

A set is automatically "known" (excluded from the "Special" catch-all below) simply by being
present in the registry with a non-null `cardexGroup` — there's no separate known-sets list to
keep in sync anymore (this replaced the old `LORCANA_KNOWN`/`RIFTBOUND_KNOWN` constants).

### The "Special / Metal" Inventory Bucket

Sets with `fromInventory: true` in the group config skip the API call entirely. Instead,
the component shows inventory cards (`game === activeGame`) whose `card.set` does NOT match
any registered set name for that game. These cards are grouped by their `card.set` value.

This is the catch-all for: D23 cards, Disney Cruise cards, Metal Riftbound cards, promotional
items, or any card Alex adds manually with a custom set name. No catalog is needed — anything
in inventory with an unrecognized set name appears here automatically.

---

## Pack Analysis Feature — How Sets Register

The Pack Analysis (`/pack-analysis`) shows expected value (EV) per booster pack for each
Lorcana set based on current market prices.

### Architecture

1. `PackAnalysisPage` detects `activeGame === 'lorcana'`
2. Fetches `GET /api/pack-analysis/lorcana`
3. `app/api/pack-analysis/lorcana/route.ts` (`export const dynamic = 'force-dynamic'`, so Next
   never pre-renders/caches this route at build time):
   - Reads the catalog via `loadVisibleCatalog('lorcana')` (`lib/api/catalog.ts` — same
     Firestore-backed, in-memory-cached read every other consumer uses, see [§4](#card-catalog-system--deep-dive-firestore-backed))
   - Additionally does its own **live** lorcast fetch for current prices on top of the catalog's
     cached prices (`fetchLivePrices()` in that route) — any card lorcast doesn't return for
     falls back to its catalog price
   - Calls `getLorcanaBoosterSets()` (`lib/api/registry.ts`), which reads the registry (Firestore
     `registry/main`) and returns every set with `packAnalysis.included: true` — this replaced the old hardcoded
     `BOOSTER_SETS` array (see [§14](#automated-sync--admin-catalog))
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

---

## Automated Sync — Admin Catalog

`/admin` has a **"Sync Card Data"** panel (admin-gated, same as the rest of the page) with one
button per game — Pokémon, Lorcana, Riftbound. Each is a plain, synchronous `POST` to its own API
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
  (`downloadPokemon`/`downloadLorcana`/`downloadRiftbound`/`syncToFirestore`/`ensureSignedIn`),
  shared verbatim by `scripts/download-card-catalog.mjs` (the CLI entry point) and
  `app/api/sync/{pokemon,lorcana,riftbound}/route.ts`. Deliberately plain ESM, not TypeScript, so
  a bare `node` process can still run it directly — it does its own Firebase init/sign-in rather
  than importing `lib/firebase/config.ts` (same "duplicated on purpose across the runtime
  boundary" reasoning as `app/api/admin/catalog/lookup/route.ts`'s CSV parser).
- `lib/firebase/adminAuth.ts` — `ensureAdminAuth()`, a small helper the plain `set-registry`
  route (writes that don't need the scraping module) signs in with before writing; the sync
  routes instead call `catalog-sync.mjs`'s own `ensureSignedIn()`, which authenticates the same
  underlying Firebase Auth singleton (both resolve to the same app instance within one process —
  see that file's header comment) so either path leaves the process equally signed in.
- `app/api/sync/{pokemon,lorcana,riftbound}/route.ts` — one route per game, `export const
  maxDuration` set generously (see Vercel's function-timeout docs for what your plan allows).
  Each returns `{ ok, setCount, newSets?, groupMatches? }` directly — no polling, no status file.
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

## Firestore / User Data

### Collections — the full picture

```
catalog/{game}/cards/{cardId}          — Shared catalog, admin-write-only (§4, §5)
catalog_snapshot/{game}/chunks/{n}     — Pre-sharded catalog snapshot for cheap cold reads (§4)
catalog_meta/{game}                    — { lastBulkSyncAt } — resync-vs-admin-edit bookkeeping (§4)

users/{uid}/
  cards/{cardId}        — Card objects (this user's inventory)
  priceHistory/{cardId} — Price history points per card
  purchases/{id}        — Pack purchase records (Spending page)
  collections/{id}      — Personal Collections (§6) — { game, name, cards: [...], createdAt }
```

`game` throughout is `pokemon` | `lorcana` | `riftbound`. The `catalog*` collections are public
read / admin write; everything under `users/{uid}/**` is readable/writable only by that same
uid — see `firestore.rules` for the actual enforcement (the app-level `isAdmin`/`ADMIN_UID`
checks are UX only, never the real gate).

### Card Object (stored in Firestore)

```typescript
{
  id: string           // Firestore document ID (generated client-side)
  game: 'pokemon' | 'lorcana' | 'riftbound'
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
}
```

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

`lib/store.ts` — in-memory only, no localStorage persistence.

### State Shape

```typescript
{
  cards: Card[]              // all user's cards, loaded from Firestore on login
  priceHistory: PriceHistory[]
  purchases: Purchase[]      // pack purchase records from Spending page
  activeGame: Game           // selected game filter
  lastPriceRefresh: string | null

  // Actions
  loadUserCards(cards)
  loadUserPriceHistory(history)
  loadPurchases(purchases)
  addCard(card)
  updateCard(cardId, updates)
  removeCard(cardId)
  updateCardPrice(cardId, price)
  setLastPriceRefresh(date)
  clearUserData()            // called on sign out
}
```

### Data Loading on Login

`AuthProvider.tsx` runs a `Promise.all` on sign-in:
```typescript
Promise.all([
  loadCards(firebaseUser.uid),
  loadPriceHistory(firebaseUser.uid),
  loadPurchases(firebaseUser.uid),
])
```
All three must succeed before `dataLoading` is set to false. If any fails,
`dataLoading` stays true and the user sees a loading state indefinitely.

---

## Full File Map

```
TCGHaven/
├── firestore.rules                ← Firestore security rules — public read/admin write on
│                                     catalog/*, catalog_snapshot/*, catalog_meta/*, registry/*;
│                                     per-user read/write on users/{uid}/** (§5, §14, §15)
├── storage.rules                  ← Firebase Storage rules — catalog image uploads (Admin
│                                     Catalog's ImageUploadField)
├── firebase.json, .firebaserc     ← Just enough config for `firebase deploy --only
│                                     firestore:rules` (this app has no Firebase Hosting/Functions
│                                     — those sections of firebase.json don't exist here)
│
├── scripts/
│   ├── download-card-catalog.mjs  ← Thin CLI entry point (`npm run download-cards`) — calls
│   │                                 scripts/lib/catalog-sync.mjs, no local file writes anymore.
│   ├── gen-icons.mjs              ← Generates PWA icons at multiple sizes
│   └── lib/
│       ├── catalog-sync.mjs       ← The actual per-game scraping + Firestore-sync logic
│       │                             (downloadPokemon/downloadLorcana/downloadRiftbound/
│       │                             syncToFirestore/ensureSignedIn), shared by both the CLI
│       │                             script and app/api/sync/{game}/route.ts (§14)
│       └── text-norm.mjs          ← normSetName(), levenshtein(), matchSetName() — fuzzy set matching
│
├── lib/
│   ├── types.ts                   ← Card, Game, Condition, GAME_COLORS, etc.
│   ├── store.ts                   ← Zustand store (in-memory, no persist)
│   ├── utils.ts                   ← cn(), formatCurrency(), formatPercent()
│   ├── firebase/
│   │   ├── config.ts              ← Firebase app init, auth, db, storage instances, ADMIN_UID
│   │   ├── adminAuth.ts           ← ensureAdminAuth() — signs the server-process auth instance
│   │   │                             in as the ADMIN_EMAIL/PASSWORD sync account, once per
│   │   │                             process, for server-side admin Firestore writes (§14)
│   │   ├── db.ts                  ← loadCards, saveCard, editCard, removeCard, newCardRef
│   │   ├── spending.ts            ← loadPurchases, savePurchase, removePurchase
│   │   └── collections.ts         ← Personal Collections CRUD (§6) — users/{uid}/collections/*
│   ├── auth-errors.ts             ← friendlyAuthError() — shared Firebase error messages
│   ├── api/
│   │   ├── catalog.ts             ← loadCatalog()/loadVisibleCatalog()/regenerateSnapshot()/
│   │   │                             invalidateCatalogCache() + scoreMatch() — Firestore-backed
│   │   │                             catalog read/write core shared by all 3 games (§4)
│   │   ├── registry.ts            ← loadSetRegistry()/saveSetRegistry() etc. — Firestore
│   │                             registry/main doc, short in-process staleness cache (§14)
│   │   ├── search.ts              ← searchCards(), getSetsForGame()/invalidateSetsCache() —
│   │   │                             unified entry point (§5's New Set cache note)
│   │   ├── pokemon.ts             ← searchPokemonCards(), getPokemonCardPrice()
│   │   ├── lorcana.ts             ← searchLorcanaCards(), getLorcanaSets() (merges in manual/
│   │   │                             registry-only sets — §5)
│   │   └── riftbound.ts           ← searchRiftboundCards(), getRiftboundSets()
│   └── pack-analysis/
│       └── lorcana-ev.ts          ← TypeScript interfaces for Lorcana EV data
│
├── app/
│   ├── layout.tsx                 ← Root HTML layout, ClientWrapper (SSR disabled)
│   ├── page.tsx                   ← Portfolio page (root route "/")
│   ├── inventory/page.tsx         ← Inventory page wrapper
│   ├── cardex/page.tsx            ← Cardex page wrapper (includes Personal Collections tab, §6)
│   ├── admin/page.tsx             ← Admin Catalog page wrapper (§5)
│   ├── settings/page.tsx          ← Settings page wrapper — Needs Review editor + inventory
│   │                                 number repair; "Sync Card Data" moved to /admin, see §14
│   ├── portfolio/
│   │   └── [cardId]/page.tsx      ← Individual card detail page
│   ├── spending/page.tsx          ← Pack spending tracker
│   ├── pack-analysis/page.tsx     ← Pack EV analysis page
│   ├── login/page.tsx
│   ├── signup/page.tsx
│   └── api/
│       ├── cards/search/route.ts  ← Unified search proxy (avoids browser CORS)
│       ├── cardex/route.ts        ← Cardex grid data (?game=&set=)
│       ├── sets/route.ts          ← Set list for AddCardDialog autocomplete (?game=)
│       ├── set-registry/route.ts  ← GET full registry; PUT a structured patch to one set
│       │                             (Needs Review editor); POST registers a brand new set
│       │                             (Admin Catalog "New Set", §5, §14)
│       ├── admin/catalog/
│       │   ├── route.ts           ← GET read-only listing incl. hidden cards (§5)
│       │   ├── lookup/route.ts    ← POST exact-match external price/image lookup (§5)
│       │   ├── invalidate/route.ts← POST — drops the server's catalog cache for a game (§4, §5)
│       │   └── raw-source/route.ts← GET — Raw Source Check diff, Riftbound-only (§5)
│       ├── sync/
│       │   ├── pokemon/route.ts   ← POST — syncs Pokémon via scripts/lib/catalog-sync.mjs (§14)
│       │   ├── lorcana/route.ts   ← POST — syncs Lorcana + registers any new sets (§14)
│       │   └── riftbound/route.ts ← POST — syncs Riftbound + TCGPlayer group-matching (§14)
│       ├── pack-analysis/
│       │   └── lorcana/route.ts   ← Lorcana EV calculator (force-dynamic)
│       └── prices/
│           ├── pokemon/route.ts   ← Batch Pokémon price lookup (Portfolio refresh)
│           ├── lorcana/route.ts   ← Batch Lorcana price lookup (lorcast proxy)
│           ├── riftbound/route.ts ← Batch Riftbound price lookup (TCGCSV proxy)
│           └── ebay/route.ts      ← eBay price lookup proxy
│
└── components/
    ├── auth/
    │   ├── AuthProvider.tsx        ← Firebase auth context + data loading on login
    │   └── AuthGuard.tsx           ← Redirects unauthenticated users to /login
    ├── layout/
    │   └── Sidebar.tsx             ← Desktop sidebar + mobile bottom nav
    ├── inventory/
    │   └── AddCardDialog.tsx       ← Add/edit card modal with live search dropdown
    ├── pages/
    │   ├── InventoryPage.tsx       ← Card list, search, filter, delete
    │   ├── PortfolioPage.tsx       ← P&L tracking, price refresh, sort/filter
    │   ├── CardexPage.tsx          ← Pokédex-style collection tracker (Lorcana + Riftbound +
    │   │                             the Personal Collections tab, §6)
    │   ├── PersonalCollectionsView.tsx ← Per-user custom collections UI (§6) — rendered inside
    │   │                             CardexPage's "Personalized Collections" tab
    │   ├── AdminCatalogPage.tsx    ← Admin Catalog page (§5): SyncPanel (§14), CatalogBrowser,
    │   │                             CardTable, AddCardForm, EditCardForm, NewSetForm, RawSourceCheckPanel
    │   ├── SpendingPage.tsx        ← Pack purchase logging
    │   ├── PackAnalysisPage.tsx    ← Expected value analysis per set
    │   └── SettingsPage.tsx        ← Needs Review editor + inventory number repair (§14)
    └── portfolio/
        ├── PriceHistoryChart.tsx   ← Recharts line chart for price over time
        └── PortfolioPieChart.tsx   ← Recharts pie chart for portfolio breakdown by game
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

### 5. Riftbound Showcase/Overnumber/Signature share collector numbers
Cards #227 (Overnumber), #227 (Signature), and the base card #227 all have the same
collector number. The `apiId` field (catalog `id`) is the only reliable unique key.
Always add cards via the search dropdown so `apiId` gets populated — fallback matching
by number alone will match all variants of a number.

### 6. Lorcana image format is AVIF
`cards.lorcast.io` serves AVIF images. They won't display on old browsers (pre-Safari 16,
pre-Chrome 85, pre-Firefox 93). No workaround without changing image source.

### 7. Pack Analysis route is force-dynamic
`app/api/pack-analysis/lorcana/route.ts` has `export const dynamic = 'force-dynamic'`
to prevent Next.js from pre-rendering it at build time. Without this, prices would be
baked in at build time and never update. The route reads the catalog via
`loadVisibleCatalog()` on each request (plus its own live lorcast price fetch layered on top —
see [§13](#pack-analysis-feature--how-sets-register)), same Firestore-backed cache as everywhere
else described in [§4](#card-catalog-system--deep-dive-firestore-backed).

### 8. `apiId` is the catalog's `id` field
When Alex selects a card from the search dropdown in AddCardDialog, the `id` field from
the catalog card object is stored as `card.apiId` in the Card record. This is what the
Cardex uses for exact-match ownership detection. For Pokémon it looks like `"sv7-1"`,
for Lorcana like `"5-100"`, for Riftbound like `"origins-001-regular"`.

### 9. Cardex only works for Lorcana and Riftbound
Pokémon is not in the Cardex because the Pokémon catalog has 20,000+ cards across 170+
sets — rendering a full grid would be extremely slow. The Cardex is designed for games
with smaller, bounded set sizes.

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
Showcase/Overnumber/Signature variants share their base card's bare `number` field — the `a`/`*`
suffix only ever lives in `publicCode` (see [§9](#riftbound--data-source-schema-add-a-set-guide)'s
variant table). TCGCSV's `extNumber` column, however, always carries that suffix (e.g.
`"007a/298"`). Any tool that diffs/matches Riftbound cards by collector number against an
external feed (like Admin Catalog's Raw Source Check, [§5](#admin-catalog-page--architecture-caching--diagnostics))
must normalize and check *both* a card's `number` and the number+suffix parsed out of its
`publicCode`, or every Showcase card in the set shows up as a false-positive mismatch.

### 17. Admin Catalog vs. Personal Collections — don't conflate them
See [§6](#personal-collections-vs-the-admin-catalog) for the full comparison table. Short
version: Admin Catalog (`/admin`) is the shared, admin-only-writable source of truth every user
reads from; Personal Collections (a tab inside `/cardex`) is a private, per-user curation tool
that can only reference cards already in that shared catalog. A request to add a whole new
*set* other users would see, or to add a card that doesn't exist anywhere in the catalog yet,
belongs in Admin Catalog — not Personal Collections, which has no way to do either.
