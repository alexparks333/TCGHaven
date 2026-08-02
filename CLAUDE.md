# TCGHaven — Complete Architecture & Data Reference

Personal Mac/iPhone app for tracking a TCG card collection. Built with Next.js 14 App Router,
TypeScript, Tailwind CSS v3, Firebase Auth + Firestore, Zustand.

---

## Table of Contents

1. [Tech Stack](#tech-stack)
2. [Running the App](#running-the-app)
3. [How Card Data Works (The Big Picture)](#how-card-data-works-the-big-picture)
4. [Static Catalog System — Deep Dive](#static-catalog-system--deep-dive)
5. [Pokémon — Data Source, Schema, Add-a-Set Guide](#pokemon--data-source-schema-add-a-set-guide)
6. [Lorcana — Data Source, Schema, Add-a-Set Guide](#lorcana--data-source-schema-add-a-set-guide)
7. [Riftbound — Data Source, Schema, Add-a-Set Guide](#riftbound--data-source-schema-add-a-set-guide)
8. [Card Search Flow](#card-search-flow)
9. [Price Data](#price-data)
10. [Cardex Feature — How Sets Register](#cardex-feature--how-sets-register)
11. [Pack Analysis Feature — How Sets Register](#pack-analysis-feature--how-sets-register)
12. [Automated Sync — Settings Page](#automated-sync--settings-page)
13. [Firestore / User Data](#firestore--user-data)
14. [Zustand Store](#zustand-store)
15. [Full File Map](#full-file-map)
16. [Key Quirks & Gotchas](#key-quirks--gotchas)

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

# Production (must rebuild after any code or data change) — serves port 3000,
# same as dev; `package.json`'s "start" script hardcodes `next start -p 3000`,
# so a PORT env var has no effect here.
npm run build
npm run start

# Kill production server and restart cleanly
lsof -ti :3000 | xargs -r kill -9
npm run start

# Download fresh card catalogs (run when new sets release)
npm run download-cards
npm run build
npm run start
```

All of the above is also available as one click: Settings → "Sync Card Data" (see
[§12](#automated-sync--settings-page)) runs the download + build + restart sequence
automatically, including for newly-released sets.

---

## How Card Data Works (The Big Picture)

There are **two completely separate data concerns**:

### 1. Card Catalog (Search & Display)
Used when Alex searches for a card to add to inventory. All card names, images, set names,
and collector numbers are pre-downloaded as **static JSON files** at build time and stored in
`public/data/`. When Alex types in the AddCardDialog search box, the app hits a Next.js
server route (`/api/cards/search`) which filters the static JSON in memory and returns
matches. No external API call happens during a search.

These JSON files must be regenerated with `npm run download-cards` whenever new sets release.
After regeneration, `npm run build` bundles the new JSON into the server.

### 2. User Collection (Inventory)
When Alex adds a card, the card data is written to **Firestore** under
`users/{uid}/cards/{cardId}`. The Zustand store is updated immediately (optimistic UI),
and the Firestore write happens in the background. On next login, Firestore is read and
Zustand is populated.

The catalog and the user collection are connected only by the `apiId` field — the catalog's
unique card ID that gets stored on the Card object when a card is selected from search results.

---

## Static Catalog System — Deep Dive

### Files

```
public/data/
  pokemon-cards.json     # ~20,000+ cards, all sets + promos
  lorcana-cards.json     # ~2,700+ cards, all sets including Enchanted/Epic/Promo
  riftbound-cards.json   # ~950+ cards, all sets including Showcase/Overnumber/Signature
```

### How they are generated

`scripts/download-card-catalog.mjs` downloads all three catalogs in parallel.
Run via `npm run download-cards`.

### How they are read

The server-side search functions (`lib/api/pokemon.ts`, `lib/api/lorcana.ts`,
`lib/api/riftbound.ts`) load the JSON using Node's `readFileSync` on the first
request, then cache it in a module-level variable (`_catalogCache` / `_cardCache`).
The cache lives for the lifetime of the server process and resets on restart.

### Module-level cache caveat

In **production**, the module cache is permanent until the server restarts. After
`npm run download-cards`, you must also `npm run build && npm run start` to pick up
new card data — just restarting the server is not enough because the build bundles
the JSON into the server chunks.

In **development** (`npm run dev`), Next.js hot-reloads server modules, so a fresh
`npm run download-cards` is picked up on the next request.

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

### Catalog Schema (`pokemon-cards.json`)

Each card in the array:
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
npm run download-cards   # re-downloads all sets from GitHub, new set is included
npm run build
npm run start
```

That's it. No code changes required. The download script fetches the full GitHub file
listing dynamically — it does not have a hardcoded set list.

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

**Phase 2 — Rarity searches:** Query for `rarity:enchanted`, `rarity:epic`, `rarity:mythic`,
`rarity:special`. **This is critical.** Enchanted and Epic cards do NOT appear in text
searches — the lorcast API only returns them via rarity-filtered queries. These are the most
valuable cards in each set ($5–$1000+) and would be completely missing without Phase 2.

A `seen` Map deduplicates by card ID across both phases.

### Catalog Schema (`lorcana-cards.json`)

Each card in the array:
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

**As of the Settings "Sync Card Data" button (see [§12](#automated-sync--settings-page)), the steps below
run automatically** — the manual version is kept here because it's still what happens under the hood,
and because the Settings page's "Needs Review" list uses the exact same registration fields described here.

When Ravensburger releases a new set, lorcast.com adds it within days. To pull it in:

```bash
npm run download-cards   # lorcast API returns all sets automatically
npm run build
npm run start
```

Then register the set in **`data/set-registry.json`** (this one file replaced the three
hardcoded arrays that used to need separate edits — see [§12](#automated-sync--settings-page)):

```json
{ "setName": "New Set Name", "code": "XYZ", "lorcastId": "14", "releaseDate": "2026-08-01",
  "cardexGroup": "Booster Sets",
  "packAnalysis": { "included": true, "id": "NSN", "released": "2026-08-01", "packPrice": 5.99, "hasEpic": true },
  "needsReview": false, "source": "manual" }
```

- `setName` MUST exactly match the `setName` field in the catalog JSON. Verify with:
  ```bash
  node -e "const d=require('./public/data/lorcana-cards.json'); console.log([...new Set(d.map(c=>c.setName))])"
  ```
- `lorcastId` is the lorcast numeric set ID — check via `api.lorcast.com/v0/sets`.
- `cardexGroup` must be one of the labels in `groupOrder` for the Cardex set picker to show it
  (`"Booster Sets"`, `"Special Sets"`, or `"Promos & Other"` today).
- `packAnalysis.included: false` if it's not sold in standard booster packs (Fabled, Attack of the Vine!, etc).
- `hasEpic: true` for any set released after Shimmering Skies (set 9+); `false` for sets 1–8. This flag
  changes the foil pull rate calculation: `false` → foilSR = 22%, no Epic slot; `true` → foilSR = 20%,
  foilEpic = 1/48 packs.

`lib/api/lorcana.ts`, `components/pages/CardexPage.tsx`, and
`app/api/pack-analysis/lorcana/route.ts` all read this file at runtime via `lib/api/registry.ts` —
no code changes needed once the entry is added. The Settings page's "Sync Card Data" button does
this step automatically for newly-detected sets (defaulting to conservative, review-required values);
this manual JSON edit is the fallback / what to do if you'd rather not wait for a sync.

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

### Catalog Schema (`riftbound-cards.json`)

Each card in the array:
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

**As of the Settings "Sync Card Data" button (see [§12](#automated-sync--settings-page)), this whole
flow — including the group-ID lookup — runs automatically.** The manual version below is the fallback,
and it's what a sync does under the hood: card data (names, images, sets) is already fully automatic
via the `__NEXT_DATA__` gallery scrape with zero code changes; the only genuinely manual piece is
finding the set's TCGPlayer group ID for prices.

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

**Step 2 — Register the set in `data/set-registry.json`**

This one file replaced the old `TCGCSV_GROUPS`/`RIFTBOUND_SETS`/`RIFTBOUND_GROUPS`/`RIFTBOUND_KNOWN`
edits that used to be needed across three separate files:

```json
{ "setName": "Vendetta", "setCode": "VEN", "releaseDate": "2026-07-31", "cardCount": 228,
  "cardexGroup": "Main Sets", "tcgcsvGroupId": 12345, "groupMatchConfidence": null,
  "needsReview": false, "source": "manual" }
```

- `setName` MUST exactly match the `setName` in the catalog. Verify with:
  ```bash
  node -e "const d=require('./public/data/riftbound-cards.json'); console.log([...new Set(d.map(c=>c.setName))])"
  ```
- `tcgcsvGroupId` is the group ID from Step 1 — `download-card-catalog.mjs` merges this into its
  bootstrap `TCGCSV_GROUPS` list at runtime via `getTcgcsvGroups()`, so no script edit is needed.
- `cardexGroup` must be one of `groupOrder`'s labels (`"Main Sets"` or `"Promos"` today) for the set
  to appear in the Cardex picker — sets present in the registry are automatically "known," so there's
  no separate catch-all-bucket list to update.
- Sort order in `riftbound-cards.json` still comes from `SET_ORDER` in the download script (a code
  edit) — it's cosmetic only (unknown codes default to sorting last), so it's not part of this file.

**Step 3 — Run download and rebuild**

```bash
npm run download-cards
npm run build && npm run start
```

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
  → reads static JSON catalog via readFileSync (cached in module memory)
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

- **Source:** `api.lorcast.com` via the static catalog
- **When fetched:** Included in `lorcana-cards.json` at download time (no live fetch during use)
- **To update prices:** `npm run download-cards && npm run build && npm run start`
- **Fields in catalog:** `marketPrice` (non-foil) and `marketPriceFoil` (foil/cold foil)
- **Note:** Enchanted and Epic cards may have `marketPrice: 0` because they are foil-only;
  their price is in `marketPriceFoil`

### Riftbound

- **Source:** `tcgcsv.com` (TCGPlayer mirror) via the static catalog
- **When fetched:** Included in `riftbound-cards.json` at download time
- **Showcase/Star cards:** These are foil-only; `marketPrice` is set to the foil price,
  `marketPriceFoil` is 0 (they don't have separate foil vs non-foil listing)
- **To update prices:** `npm run download-cards && npm run build && npm run start`

---

## Cardex Feature — How Sets Register

The Cardex (`/cardex`) shows a Pokédex-style grid for any set. Cards are greyed out if
not in inventory, full color if owned, with quantity badges.

### Architecture

1. Alex picks a set in `components/pages/CardexPage.tsx`
2. The component calls `GET /api/cardex?game=lorcana&set=Shimmering+Skies`
3. `app/api/cardex/route.ts` reads the appropriate static JSON, filters by `setName`,
   sorts by number then rarity, and returns a simplified card array
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
**`data/set-registry.json`** entry (see [§12](#automated-sync--settings-page)) matching one of
that game's `groupOrder` labels. `CardexPage.tsx` fetches `GET /api/set-registry` once on mount
and derives the equivalent of the old hardcoded `LORCANA_GROUPS`/`RIFTBOUND_GROUPS` client-side
via `buildGroupsByGame()`. The `setName` field must exactly match the `setName` field in the
catalog JSON.

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
3. `app/api/pack-analysis/lorcana/route.ts`:
   - Reads `lorcana-cards.json` fresh on every request (`export const dynamic = 'force-dynamic'`)
   - Calls `getLorcanaBoosterSets()` (`lib/api/registry.ts`), which reads `data/set-registry.json`
     and returns every set with `packAnalysis.included: true` — this replaced the old hardcoded
     `BOOSTER_SETS` array (see [§12](#automated-sync--settings-page))
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
entry in `data/set-registry.json` — see the [Lorcana add-a-set guide](#lorcana--data-source-schema-add-a-set-guide)
above for the exact shape. No route code changes needed; it reads the registry fresh every
request, same as it always re-read the catalog fresh (`force-dynamic`).

**Note:** Fabled and Attack of the Vine! have `packAnalysis.included: false` in the registry
because they are not sold in standard booster packs. The Pack Analysis only covers traditional
booster sets.

---

## Automated Sync — Settings Page

The Settings page (`/settings`) has a **"Sync Card Data"** button that automates the manual
workflows described in the sections above. It's the recommended way to pick up new sets;
the manual per-game instructions elsewhere in this doc remain accurate as a fallback and as an
explanation of what the sync does under the hood.

### What it does

1. **Download** — re-runs `scripts/download-card-catalog.mjs` (same as `npm run download-cards`)
   to refresh all three catalogs.
2. **Diff** — compares the fresh catalogs' distinct `setName` values against
   `data/set-registry.json` to find genuinely new sets.
3. **Riftbound group matching** — for any new (or previously unmatched) Riftbound set, fetches
   `https://tcgcsv.com/tcgplayer/89/groups` and fuzzy-matches the set name against it using
   `scripts/lib/text-norm.mjs`'s `matchSetName()` (exact match, or prefix-stripped/substring
   match, or a high-confidence Levenshtein fallback). Only confident matches are accepted —
   anything uncertain is left unmatched and surfaced in the "Needs Review" list instead of guessing.
4. **Registry update** — appends new sets to `data/set-registry.json` with conservative defaults
   (`needsReview: true`, Lorcana `packAnalysis.included: false`, Riftbound `cardexGroup: "Main Sets"`).
   If a new Riftbound TCGPlayer group was matched, re-runs the download once more so that set's
   prices get merged in.
5. **Build** — runs `next build`. **If this fails, the currently running server is left
   completely untouched** — nothing is restarted, and the failure (with an error tail) is
   surfaced in the Settings UI.
6. **Restart** — only reached if the build succeeded: kills whatever is listening on port 3000
   and starts a fresh `next start -p 3000`.

### Key files

- `data/set-registry.json` — the single source of truth this whole feature reads/writes. Replaced
  the hardcoded `LORCANA_GROUPS`/`RIFTBOUND_GROUPS`/`LORCANA_KNOWN`/`RIFTBOUND_KNOWN`
  (`CardexPage.tsx`), `BOOSTER_SETS` (pack-analysis route), `RIFTBOUND_SETS` (`lib/api/riftbound.ts`),
  and `LORCANA_SETS_FALLBACK` (`lib/api/lorcana.ts`).
- `lib/api/registry.ts` — shared, uncached reader (`loadSetRegistry`, `getLorcanaRegistrySets`,
  `getRiftboundRegistrySets`, `getLorcanaBoosterSets`) used by all the consumers above.
- `scripts/sync-runner.mjs` — the actual orchestrator. Spawned **detached and unref'd** by
  `app/api/sync/route.ts` so it survives the Next.js server process it may go on to kill and
  restart in its final phase. Writes progress to `data/sync-status.json` (atomic write-then-rename)
  after every phase; `GET /api/sync/status` just reads and returns that file, which is how the
  Settings page keeps showing progress across the brief window where the server is down mid-restart
  (the client tolerates a run of failed polls there rather than treating it as an error).
- `app/api/set-registry/route.ts` — `GET` returns the full registry (used by `CardexPage.tsx` and
  the Settings page); `PUT` does a structured JSON patch of one set entry (used by the "Needs
  Review" editor) — it only ever touches this one JSON file, never TypeScript source.
- `data/backups/<runId>/` — a copy of the catalogs + registry taken before every sync run, in case
  a bad upstream response ever needs to be rolled back by hand. Nothing is ever deleted automatically.

### Guardrails

- `POST /api/sync` returns `400` unless `NODE_ENV === 'production'` — it can never fire against
  `npm run dev`, since the restart phase kills whatever is on port 3000.
- Only a successful `next build` triggers the kill-and-restart step; a failed build always leaves
  the running app untouched.
- The Riftbound group-matching threshold is deliberately conservative (≥90% similarity with a
  confidence margin over the next-best candidate) — an unmatched set is left for manual review
  rather than risking a silently-wrong price feed.
- A confident name match that nonetheless yields zero priced cards after the repricing pass gets
  flagged `needsReview` anyway, as a second safety net against a coincidentally-plausible but wrong
  group ID.
- A coarse 15-minute overall timeout keeps a hung run from permanently blocking future syncs.

---

## Firestore / User Data

### Collections

```
users/{uid}/
  cards/{cardId}        — Card objects
  priceHistory/{cardId} — Price history points per card
  purchases/{id}        — Pack purchase records (Spending page)
  _diag/test            — Temporary diagnostics document (auto-deleted)
```

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
├── data/
│   ├── set-registry.json          ← Source of truth for Lorcana/Riftbound set metadata (§12)
│   ├── sync-status.json           ← Live progress of the current/last sync run. Not in git.
│   ├── sync-run.log               ← Combined stdout/stderr from sync subprocesses. Not in git.
│   ├── last-download-summary.json ← Written by download-card-catalog.mjs for sync-runner.mjs. Not in git.
│   └── backups/<runId>/           ← Pre-sync snapshots of catalogs + registry. Not in git.
│
├── scripts/
│   ├── download-card-catalog.mjs  ← Downloads all 3 game catalogs to public/data/
│   ├── sync-runner.mjs            ← Settings "Sync Card Data" orchestrator (§12), detached+unref'd
│   ├── gen-icons.mjs              ← Generates PWA icons at multiple sizes
│   └── lib/
│       ├── text-norm.mjs          ← normSetName(), levenshtein(), matchSetName() — fuzzy set matching
│       └── sync-status.mjs        ← writeStatus()/readStatus() — atomic data/sync-status.json I/O
│
├── public/
│   └── data/
│       ├── pokemon-cards.json     ← Generated (20K+ cards). Not in git.
│       ├── lorcana-cards.json     ← Generated (2700+ cards). Not in git.
│       └── riftbound-cards.json   ← Generated (950+ cards). Not in git.
│
├── lib/
│   ├── types.ts                   ← Card, Game, Condition, GAME_COLORS, etc.
│   ├── store.ts                   ← Zustand store (in-memory, no persist)
│   ├── utils.ts                   ← cn(), formatCurrency(), formatPercent()
│   ├── firebase/
│   │   ├── config.ts              ← Firebase app init, auth, db instances
│   │   ├── db.ts                  ← loadCards, saveCard, editCard, removeCard, newCardRef
│   │   └── spending.ts            ← loadPurchases, savePurchase, removePurchase
│   ├── auth-errors.ts             ← friendlyAuthError() — shared Firebase error messages
│   ├── api/
│   │   ├── catalog.ts             ← loadCatalog() + scoreMatch() — shared by all 3 games
│   │   ├── registry.ts            ← loadSetRegistry() etc. — reads data/set-registry.json (§12)
│   │   ├── search.ts              ← searchCards(), getSetsForGame() — unified entry point
│   │   ├── pokemon.ts             ← searchPokemonCards(), getPokemonCardPrice()
│   │   ├── lorcana.ts             ← searchLorcanaCards(), getLorcanaSets()
│   │   └── riftbound.ts           ← searchRiftboundCards(), getRiftboundSets()
│   └── pack-analysis/
│       └── lorcana-ev.ts          ← TypeScript interfaces for Lorcana EV data
│
├── app/
│   ├── layout.tsx                 ← Root HTML layout, ClientWrapper (SSR disabled)
│   ├── page.tsx                   ← Portfolio page (root route "/")
│   ├── inventory/page.tsx         ← Inventory page wrapper
│   ├── cardex/page.tsx            ← Cardex page wrapper
│   ├── settings/page.tsx          ← Settings page wrapper (§12)
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
│       ├── set-registry/route.ts  ← GET full registry, PUT a structured patch to one set (§12)
│       ├── sync/
│       │   ├── route.ts           ← POST — spawns scripts/sync-runner.mjs detached (§12)
│       │   └── status/route.ts    ← GET data/sync-status.json
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
    │   ├── CardexPage.tsx          ← Pokédex-style collection tracker (Lorcana + Riftbound)
    │   ├── SpendingPage.tsx        ← Pack purchase logging
    │   ├── PackAnalysisPage.tsx    ← Expected value analysis per set
    │   └── SettingsPage.tsx        ← Sync Card Data button + Needs Review editor (§12)
    └── portfolio/
        ├── PriceHistoryChart.tsx   ← Recharts line chart for price over time
        └── PortfolioPieChart.tsx   ← Recharts pie chart for portfolio breakdown by game
```

---

## Key Quirks & Gotchas

### 1. Production server serves stale builds
After any code change or `npm run download-cards`, you MUST:
```bash
npm run build && npm run start
```
Just restarting the server is not enough — Next.js bundles the catalog JSON into build
chunks. The static JSON cache in module memory is also stale until rebuild.

### 2. Firestore rejects `undefined`
All writes go through `clean()` in `db.ts` which strips undefined. Never pass
`{ field: undefined }` — it throws. Use `{ field: value || '' }` for optional strings.

### 3. Pokemon TCG API blocks browser CORS
All three games' search calls go through `/api/cards/search` (a Next.js server route)
specifically to avoid CORS. Never call `api.pokemontcg.io` directly from the browser.

### 4. Lorcana Enchanted/Epic MUST use rarity queries
The lorcast API does NOT return Enchanted or Epic cards in text-based searches.
These cards only appear via `rarity:enchanted` and `rarity:epic` queries. If the
download script's Phase 2 is removed or skipped, the catalog will be missing the most
valuable Lorcana cards entirely.

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
baked in at build time and never update. The route reads the catalog file on each request.

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

### 11. The catalog cache resets on server restart but not mid-session
All catalog files load through `lib/api/catalog.ts` (`loadCatalog()`), which keeps one
in-memory copy per file for the lifetime of the Node.js process. In production, they
load once and stay in memory until the server is restarted. This means a
`npm run download-cards` without a rebuild and restart has no effect in production.

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
