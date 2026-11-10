# Adding a new game — the complete, step-by-step guide

_Written 2026-11-10 from the code as it stands (5 games: Pokémon EN + JP, Lorcana, Riftbound, One
Piece, Magic). Next planned: **Yu-Gi-Oh!** — its researched specifics are in the appendix._

**This is for the agent (Claude) doing the work, and the owner checking it.** Follow the phases in
order. Every phase ends with a **gate** — something checked and shown to the owner before the next
phase starts. Don't skip gates: a new game touches ~75 files, a shared catalog every user reads, the
twice-daily sync, the iPhone scanner and its AI. A mistake that ships becomes something collectors
log against.

> **Don't start this guide without the owner saying so.** Adding a game is planned work: it writes
> tens of thousands of Firestore documents, changes the sync schedule's time budget, and needs
> decisions only the owner can make (Phase 0).

---

> **Shortcut for a TCGplayer-only game (2026-11-10).** If the game's whole catalog comes from
> TCGplayer (no free card database of its own), most of Phases 1–4 is already built: add a settings
> block to `TCGPLAYER_GAMES` in `scripts/lib/tcgplayer-games.mjs` (category, name/number rules, set
> types), add its id to `TCGPLAYER_SOURCED_GAMES` in `lib/types.ts`, copy one of the one-line
> `app/api/prices/{game}` and `app/api/sync/{game}` routes, add it to the `--only` list in
> `sync-tcgplayer-games.yml`, then do Phase 5's hand-written lists (grep `'palworld'` — every list
> naming the last game added), the scanner's code pattern, and Phase 3's checks with
> `npm run tcgplayer-games-report -- --only {game}`. See docs/games.md "TCGplayer-sourced games".

## Contents

0. [Before anything: rules, decisions, research](#phase-0)
1. [The card source: TCGplayer through tcgcsv](#phase-1)
2. [Build the catalog — a pure, tested planner](#phase-2)
3. [Triple-check every card and every price](#phase-3)
4. [Write the catalog and wire the sync](#phase-4)
5. [Wire the game into every page, filter and list (the full file list)](#phase-5)
6. [Variations: editions, finishes, alternate arts](#phase-6)
7. [The card scanner](#phase-7)
8. [The scanner's AI: fingerprints and training](#phase-8)
9. [Docs](#phase-9)
10. [Release, watch, and roll back](#phase-10)

- [Appendix A — Yu-Gi-Oh! research (2026-11-10)](#appendix-a)
- [Appendix B — Commands cheat-sheet](#appendix-b)

---

<a id="phase-0"></a>
## Phase 0 — Before anything: rules, decisions, research

### 0.1 Read first

| Read | Why |
|---|---|
| `CLAUDE.md` | the short core; rules 20 (game lists by hand), 24 (route exports), 25 (merge writes), 28 (tcgcsv CSV), 29 (map fields), 33 (shared docs), 34–35 (catalog sources) |
| `docs/catalog.md` | how the shared catalog, snapshots, cache, staff portal and syncs work |
| `docs/games.md` | how each existing game is sourced — **One Piece** is the closest model (TCGplayer-first, one product = one card) |
| `docs/quirks.md` | the gotchas each game hit |
| `card-scanner.md` | how the scanner reads, matches and decides |
| `training-ai.md` | how the scanner's picture AI is trained |
| memory: never change logged cards | catalog changes must never alter cards people already logged |

### 0.2 The rules that never bend

1. **Nothing a collector already logged changes.** A brand-new game has no logged cards — but from
   the first public sync onward, every card id is permanent. Pick the id scheme once (Phase 2) and
   never change it.
2. **Ship order:** read-only reports → owner sees the numbers → push code → Checks pass → Vercel
   deploy → *then* run the sync. Never the other way round.
3. **No secrets in chat or files.** Admin credentials live in `.env.local` / 1Password; CI secrets in
   GitHub. Never print them.
4. **Never delete catalog data without the owner's explicit OK.** Hiding (`hidden: true`) is the
   reversible tool; deletion isn't.
5. **Polite to every source:** an honest `User-Agent` (`TCGHaven-catalog-sync/1.0`), throttling, and
   caching. tcgcsv is a free community mirror.

### 0.3 Decisions only the owner can make — ask, write the answers down here

Ask these with the AskUserQuestion tool, one screen, recommended option first:

| # | Decision | Options / notes |
|---|---|---|
| D1 | **Game key** (code id, lowercase, never changes) | e.g. `yugioh` |
| D2 | **Display name** + short tab label + colour | e.g. "Yu-Gi-Oh!" / "Yu-Gi-Oh!" / a hex that sits with `GAME_COLORS` |
| D3 | **Languages** | English only first (recommended), or also others as separate catalogs (like `pokemon-jp`) |
| D4 | **What's in the catalog** | singles only (recommended); exclude sealed product, accessories, code cards, oversized cards |
| D5 | **One card per printing?** | yes (recommended, like Magic and One Piece): each set code + rarity + art is its own card |
| D6 | **Editions / finishes** | which TCGplayer sub-types become printings (e.g. 1st Edition / Unlimited / Limited) — see Phase 6 |
| D7 | **Secondary (check) source** | a second, independent card list to verify against — for Yu-Gi-Oh!, YGOPRODeck (Appendix A) |
| D8 | **Cardex grouping** | automatic (by set type / series / code prefix — recommended) vs registry-curated (like Lorcana) |
| D9 | **Firestore cost** | the first sync writes one doc per card (Yu-Gi-Oh!: tens of thousands). Fine on Blaze; check the plan first |
| D10 | **Sync schedule** | in the twice-daily cron (`sync-prices.yml`) if the run fits the time budget, or its own daily job like Magic (`sync-mtg.yml`) |

### 0.4 Research (write findings into the game's section of `docs/games.md` as you go)

- tcgcsv category id, number of groups (sets), oldest/newest group.
- Which products are cards vs sealed/other (how to tell: e.g. the presence of a `Number`
  extended-data field — verify per game, don't assume).
- The card number format, and whether the number repeats across products (rarity / art variants).
- The price sub-types (`subTypeName`) and what each means.
- Image hosting (TCGplayer CDN works in browsers — the official site may not: see One Piece's
  CORP gotcha in `docs/games.md`).
- The secondary source's coverage (which sets it has / lacks) and terms of use.
- Rarities (full list, from live data — not memory; Lorcana's "Iconic" and One Piece's "TR" were both
  found only by aggregating real data).

**Gate 0:** the owner has answered D1–D10, and the research notes are in `docs/games.md`.

---

<a id="phase-1"></a>
## Phase 1 — The card source: TCGplayer through tcgcsv

TCGplayer is the primary source for every game (owner's decision, 2026-11-06): it decides which
cards exist; a second source is the check. tcgcsv.com mirrors TCGplayer once a day (~20:05 UTC).

### 1.1 Endpoints

```
https://tcgcsv.com/tcgplayer/categories                       every game (categoryId, name)
https://tcgcsv.com/tcgplayer/{categoryId}/groups              every set (groupId, name, abbreviation, publishedOn)
https://tcgcsv.com/tcgplayer/{categoryId}/{groupId}/products  products (productId, name, cleanName, imageUrl, extendedData[])
https://tcgcsv.com/tcgplayer/{categoryId}/{groupId}/prices    price rows (productId, subTypeName, marketPrice, lowPrice, …)
```

- Send `User-Agent: TCGHaven-catalog-sync/1.0`. Fetch groups with bounded concurrency (≤ 8) and
  retry with backoff — see `tcgplayerRowCache()` and friends in `scripts/lib/catalog-sync.mjs`.
- **Rule 28:** if you ever use tcgcsv's CSV files instead of JSON, never split on newlines and read
  columns by header name. Prefer the JSON endpoints above.
- A product can have **several price rows** — one per `subTypeName` (Normal / Foil / Holofoil /
  1st Edition / Unlimited …). That's the finish/edition axis (Phase 6).
- `imageUrl` comes as `…_200w.jpg`; `lib/cardImage.ts` swaps sizes (`200w` / `in_400x400` /
  `in_1000x1000`).

### 1.2 Map the category before writing code

Write a throwaway script in the scratchpad (never in the repo) that, for the whole category:

1. lists every group with its product count, card count and sealed count;
2. counts every `extendedData` field name across all products (that's the schema you get);
3. lists every distinct `subTypeName` and how many rows each has;
4. finds numbers shared by several products (variants) and shows a dozen examples;
5. prints 10 random products as full JSON.

Keep its output — Phase 3 compares against it.

**Gate 1:** the owner sees the category map (groups, card count, fields, sub-types, variant examples)
and agrees with D4–D6 in light of it.

---

<a id="phase-2"></a>
## Phase 2 — Build the catalog: a pure, tested planner

Model it on One Piece: `scripts/lib/onepiece-tcgplayer.mjs` (pure) + `planOnePieceCatalog()` /
`downloadOnePiece()` in `catalog-sync.mjs` (fetch + write) + `scripts/lib/onepiece-tcgplayer.test.mjs`.

### 2.1 The pure module — `scripts/lib/{game}-tcgplayer.mjs`

Pure means: data in, catalog out, no network, no Firestore. Export at least:

- `isCardProduct(product)` — singles vs sealed/other (D4).
- `cardFromProduct(product, group, priceRows)` → the catalog card, or null.
- `buildCatalog({ groups, productsByGroup, pricesByGroup, existing })` → `{ cards, report }`.

### 2.2 The card id — decided once, forever

- **`tcg-{productId}`** (one TCGplayer product = one card) is the default — stable, unique, and what
  every newer game uses. Never derive ids from names or positions (One Piece's old positional
  pairing showed the wrong version on ~1 in 9 cards).
- If the game also uses edition/finish *rows* of one product (Phase 6), those are **printings of the
  same card** (`variantPrices`), not separate ids.

### 2.3 The card document — fields every game carries

```jsonc
{
  "id": "tcg-731469",
  "name": "Blue-Eyes White Dragon, the White Phantom Beast",  // the name as printed — no variant suffix
  "number": "MAMS-EN001",            // the printed number, exactly as TCGplayer gives it
  "set": "MAMS",                      // set code (or tcgcsv group abbreviation)
  "setName": "Magnificent Maestros",
  "rarity": "Ultra Rare",
  "imageUrl": "https://tcgplayer-cdn.tcgplayer.com/product/731469_200w.jpg",
  "tcgProductId": 731469,
  "marketPrice": 1.23,                // the default printing's price
  "variantPrices": { "1st:normal": 1.23 },   // every printing → price (Phase 6)
  "updatedAt": "<serverTimestamp()>"  // EVERY catalog write stamps this (CLAUDE.md)
}
```

Plus game-specific fields only when something reads them (e.g. card type, attribute — useful later
for filters and for the scanner's text check). Never write `undefined` (rule 2).

**The display name:** when several products share a name (an Extended Art, a Starlight Rare), the
catalog `name` stays the printed name; the variant goes in its own field (`variant: "Extended Art"`)
and `lib/api/search.ts` adds it as a suffix for display — **the scanner relies on `name` being what's
printed** (`printedName()` strips bracketed suffixes; keep variants out of the name or in brackets).

### 2.4 Tests — `scripts/lib/{game}-tcgplayer.test.mjs` + `npm run test:{game}-source`

Real fixtures (trimmed real products), one assertion per rule: sealed excluded; a variant becomes its
own card; edition rows become `variantPrices`; a product with no price keeps the last known price;
ids are stable across two runs; nothing `undefined`. Add the script to `package.json` and to
`.github/workflows/checks.yml` (the deploy gate runs every test suite).

**Gate 2:** tests pass; the planner run on the full category prints the card count and a sample.

---

<a id="phase-3"></a>
## Phase 3 — Triple-check every card and every price

Nothing is written until all three checks pass. Build `scripts/{game}-source-report.mjs` (read-only,
like `pokemon-source-report.mjs` / `onepiece-source-report.mjs`; add `npm run {game}-source-report`).
It exits non-zero when a check fails, so it can guard every later sync too.

### Check 1 — Completeness: every card is there

1. **Per group:** cards planned = TCGplayer card products in that group (minus D4 exclusions). List
   any group where they differ.
2. **Against the secondary source:** for every set code the secondary source lists, compare its card
   numbers + rarities with ours. Report: cards it has that we don't (missing), cards we have that it
   doesn't (TCGplayer-only — usually promos, fine), and per-set count differences.
3. **No duplicates:** the same `tcgProductId` twice, or two cards with identical
   number + rarity + variant + name.
4. **Spot-check by hand:** pick **3 sets** (newest, oldest, one big one) and compare our list with
   TCGplayer's website set page card by card. Note anything off.

### Check 2 — Every card's fields are right

For **every** card: name non-empty and equal to the product's name minus variant suffix; number
matches the game's number pattern (write the regex — e.g. Yu-Gi-Oh! `^[A-Z0-9]{2,5}-[A-Z]{0,2}\d{2,3}[a-z]?$`);
rarity in the known rarity list (unknown ones → reported, never dropped); set name present; image URL
present (no-image cards listed, not hidden).

Then **one by one for a sample**: 50 random cards (seeded, reproducible) printed as a table — name,
number, set, rarity, image link, price, TCGplayer link (`https://www.tcgplayer.com/product/{id}`).
**The owner opens each TCGplayer link and confirms.** This is the human third check — the owner has
asked for it on every catalog change.

### Check 3 — Prices are right

1. **Coverage:** % of cards with a market price, per group. Big drops → investigate.
2. **Agreement:** for the 50-card sample, our price = TCGplayer's market price on the product page
   (within today's tcgcsv refresh). Edition/finish rows map to the right printing.
3. **Outliers:** prices > $10,000, or a printing priced below its common printing by 100×, listed for
   a look (real cases exist — Ghost Rares, serial-numbered cards — but each must be explained).
4. **No price → keep the last:** a card whose product has no price today keeps its previous price
   (existing `price-fallback.mjs` rule; `npm run test:prices`).

### Images

`npm run check-images -- {game}` (after Phase 5 adds the game to `scripts/check-image-health.mjs`)
must show no broken URLs beyond ones TCGplayer genuinely lacks.

**Gate 3:** the report's numbers + the 50-card table are shown to the owner; the owner has checked the
sample on TCGplayer; every listed difference is explained or fixed.

---

<a id="phase-4"></a>
## Phase 4 — Write the catalog and wire the sync

### 4.1 Download/plan functions — `scripts/lib/catalog-sync.mjs`

Add `plan{Game}Catalog()` (read-only: fetch + build, no writes — the report uses it) and
`download{Game}()` (plan + write). Follow One Piece's:

- **Writes:** only cards that changed (`stableStringify()` compare, rule 29 for map fields), in
  batches, each stamping `updatedAt: serverTimestamp()`.
- **Never delete** a card that vanished upstream — report it; hiding is an owner decision.
- **Snapshot:** regenerate `catalog_snapshot/{game}` (`writeCompressedSnapshot()`), so cold servers
  get the new catalog without reading every doc.
- **Meta:** `catalog_meta/{game}` with `lastBulkSyncAt`, the set list, broken-image ids.
- **Status:** `recordCliSyncStatus()` / `recordSyncStatus()` → `sync_status/{game}` (the Portfolio
  "Prices updated" line reads it — `lib/api/priceStatus.ts`).
- **Price history:** `writeDailyPriceSnapshot(game, cards)` (shared daily history —
  `scripts/lib/price-history.mjs`).
- **Safety:** if >10% of groups fail to fetch, abort the write (One Piece's rule).
- **New sets** → registry backfill (as One Piece / Riftbound do); **unplaceable cards** (promos with
  no clear set) → Needs Review: add the game to `REVIEW_DOCS` (`registry/{game}-review`) and to
  `lib/api/review.ts` / `components/admin/PlacementsReview.tsx`.

### 4.2 Routes — rule 24: a `route.ts` exports only Next's allowed names

- `app/api/sync/{game}/sync.ts` — `run{Game}Sync()` (shared logic).
- `app/api/sync/{game}/route.ts` — `POST` (admin-only via `verifyAdminRequest()`), `maxDuration`.
- `app/api/prices/{game}/route.ts` — the id → price lookup the price updater uses.
- **CLI:** add the game to `scripts/download-card-catalog.mjs` (`--only {game}` works).
- **Cron:** add to `app/api/cron/sync-prices/route.ts`'s `Promise.allSettled([...])` + `summarize()`
  — **only if the whole run still fits `maxDuration` (300 s)**. Time the game's sync alone first; if
  it's long (Magic was), give it its own workflow like `.github/workflows/sync-mtg.yml` and add it to
  `OWN_SCHEDULE` + `STALE_AFTER_MS` in `lib/api/priceStatus.ts`.
- `npm run build` after any route change (rule 24 — `tsc` won't catch a bad export).

### 4.3 Firestore

`firestore.rules` already matches `catalog/{game}/…`, `catalog_snapshot/{game}/…`,
`catalog_meta/{game}` with a wildcard — check that's still true, and that nothing lists games by name.

### 4.4 The first write

1. Push the code (Phases 2–5 together), wait for Checks + the Vercel deploy.
2. Run the report once more (Gate 3 numbers unchanged).
3. Run the first sync **from the CLI** (`npm run download-cards -- --only {game}`) — no Vercel time
   limit, progress visible. Watch Firestore usage.
4. Run the report again: it now compares against what's written — expect zero differences.

**Gate 4:** written count = planned count; report clean; the owner sees the game in the Admin Catalog.

---

<a id="phase-5"></a>
## Phase 5 — Wire the game into every page, filter and list

**Rule 20: `tsc` will not find all of these.** Many lists are `Game[]` literals that type-check fine
without the new game. Work from this list, then **grep** (5.3) — the grep is the real check.

### 5.1 Core types and labels

| File | Change |
|---|---|
| `lib/types.ts` | add to `Game`; `GAME_LABELS`; `GAME_COLORS`; `catalogKeyFor()` if a language catalog |
| `lib/utils.ts` | `RARITY_LABELS_BY_GAME` (rarity → short label); any per-game display helper |
| `lib/pricing.ts` | `catalogPrice()` — the one pricing rule; make sure the game's printings price right |
| `lib/cardImage.ts` | image host size rewrite if not TCGplayer's CDN |
| `next.config.js` | `images.remotePatterns` for any new image host |
| `lib/api/registry.ts` | `SetRegistry` type + `EMPTY_REGISTRY` entry (rule 22: merge over it) |
| `lib/store.ts` | `activeGames` default |
| `lib/firebase/preferences.ts` | `VALID_GAMES` |
| `lib/api/priceStatus.ts` | `OWN_SCHEDULE` / `STALE_AFTER_MS` if it syncs on its own schedule |

### 5.2 Every `Game[]` list and per-game branch (found by grep on 2026-11-10)

**Hand-written game lists — add the new game to each:**

| File | List |
|---|---|
| `app/api/admin/catalog/route.ts` | `GAMES` |
| `app/api/admin/catalog/invalidate/route.ts` | `GAMES` |
| `app/api/admin/catalog/search/route.ts` | `GAMES` |
| `app/api/set-registry/route.ts` | `REGISTRY_GAMES` |
| `components/PriceAutoUpdater.tsx` | `ALL_GAMES` |
| `components/layout/FilterPanel.tsx` | `ALL_GAMES` |
| `components/admin/BadgesAdmin.tsx` | `GAMES` |
| `components/admin/insights/charts.tsx` | `GAME_ORDER` |
| `components/inventory/AddCardDialog.tsx` | `GAMES` (+ `GAME_TAB_LABELS` if the label is long) |
| `components/pages/InventoryPage.tsx` | `GAMES` |
| `components/pages/PortfolioPage.tsx` | the game list in the per-game breakdown (~line 193) |
| `components/pages/SoldPage.tsx` | `GAMES` |
| `components/pages/AdminCatalogPage.tsx` | `GAMES` |
| `components/pages/CardexPage.tsx` | `RARITY_TOGGLE_GAMES`; the catalog-key list (~line 1126) |
| `scripts/check-image-health.mjs` | `ALL_GAMES` |
| `scripts/backfill-daily-prices.mjs` | its game loop |
| `scripts/backfill-compressed-snapshots.mjs` | its game loop |
| `scripts/check-collection.mjs` | `GAMES` for `--all` (if the game gets a source report) |
| `lib/scan/server.ts` | `GAME_CATALOGS` (Phase 7) |
| `components/pages/PersonalCollectionsView.tsx` | the `['lorcana', 'riftbound']` lists — decide whether the new game belongs |

**Per-game branches — read each and add the game's case:**

| File | What's per game |
|---|---|
| `lib/api/{game}.ts` (**new**) | `search{Game}Cards(query, onlyId)` and `get{Game}Sets()` — copy `lib/api/onepiece.ts` |
| `lib/api/search.ts` | `searchCardsUncapped()` branch (search rows, foil/variant rows, display suffixes); `getSetsForGame()` |
| `lib/api/searchTerms.ts` | search options for the game (aliases, number formats) |
| `lib/api/cardSearch.ts` | number-format handling if the number looks new (e.g. `MAMS-EN001`) + a test in `cardSearch.test.mts` |
| `lib/api/catalog.ts` | `CARDEX_RARITY_ORDER` — the game's rarities in Cardex order |
| `app/api/cardex/route.ts` | how a set's cards load for the Cardex |
| `components/pages/CardexPage.tsx` | set grouping (`buildGroups()` — automatic grouping for the game, D8), rarity toggles, ownership matching |
| `components/inventory/AddCardDialog.tsx` | edition/finish pickers for the game (Phase 6), foil toggle rules |
| `components/PrintingTags.tsx` | how a card's printing is labelled |
| `components/pages/AdminCatalogPage.tsx` | sync button, raw-source lookup, set editor fields |
| `app/api/admin/catalog/lookup/route.ts`, `…/raw-source/route.ts` | look a card up at the source |
| `components/admin/CatalogCategories.tsx`, `CardexCardPicker.tsx` | per-game categories |
| `components/pages/ProfilePage.tsx`, `CardDetailPage.tsx` | per-game display bits |
| `components/CardUnlockToast.tsx` | per-game styling |
| `components/admin/insights/StatisticsPage.tsx` | per-game rows |
| `lib/badges.ts` | per-game badge rules if any |
| `app/api/cron/sync-prices/route.ts` | Phase 4 |
| `lib/api/syncStatus.ts` | status shape if the game reports extra fields |

### 5.3 The grep that proves it

```bash
# every place an existing game is named — each hit needs the new game too, or a reason it doesn't
grep -rn "'onepiece'\|\"onepiece\"\|onepiece:" app components lib scripts --exclude-dir=node_modules
grep -rn "'mtg'\|mtg:" app components lib scripts --exclude-dir=node_modules
grep -rn "Record<Game" app components lib --exclude-dir=node_modules
```

Go through **every** hit. A `Record<Game, …>` fails `tsc` until filled (good); a `Game[]` literal
doesn't (dangerous). Then: `npm run typecheck`, `npm run lint`, every `npm run test:*`, `npm run build`.

### 5.4 Click through it (dev server, port 3000 only)

Inventory tab + Add Card (search by name, by number, a variant), Cardex (every set group, rarity
toggles, ownership), Portfolio (value, per-game breakdown, "Prices updated" line), Sold, Profile,
Filters, Admin Catalog (browse, search, sync button, set editor), Needs Review, Statistics. Use a test
account, never the owner's.

**Gate 5:** every page shows the game correctly; screenshots or a written walkthrough for the owner.

---

<a id="phase-6"></a>
## Phase 6 — Variations: editions, finishes, alternate arts

Three different things — keep them apart:

| Kind | Example | How it's stored |
|---|---|---|
| **Separate product** (own art / rarity) | Extended Art, Starlight Rare, Parallel | its **own card** (`tcg-{productId}`), `variant` field |
| **Edition / finish of one product** (same art) | 1st Edition / Unlimited, Normal / Holo / Reverse | **`variantPrices`** on the one card: `"edition:finish" → price` |
| **Same art, different listing** | reprints, a/b versions | separate cards; the scanner's AI groups them (Phase 8) |

- `variantPrices` keys follow Pokémon's scheme (`scripts/lib/pokemon-variants.mjs`:
  `unlimited|shadowless|1st` × `normal|holofoil|reverse`). For a new game, either map its sub-types
  onto these keys (e.g. Yu-Gi-Oh! "1st Edition" → `1st:normal`, "Unlimited" → `unlimited:normal`,
  "Limited" → a new edition key) or extend `pokemon-variants.mjs`'s edition list — and its tests.
- **Everything that shows printings must understand the keys:** `AddCardDialog` (Edition/Finish
  pickers), `lib/pricing.ts`, `ScanReviewDialog` (finish buttons), the scanner's card sheet (Finish
  row: `printingsOf()` in `lib/scan/server.ts` + labels), `PrintingTags`.
- Price history: `historyNeedsVariants()` decides whether per-printing history is kept.

**Gate 6:** a card with several printings shows each with its own price in Add Card, the scanner's
card sheet and the review screen; the saved card carries the printing.

---

<a id="phase-7"></a>
## Phase 7 — The card scanner

The scanner matches the **text read off the card** first (number, set code, name), then the picture.
For a new game it needs to know what that game prints and where. Files: `lib/scan/scanMatch.ts`
(pure, tested), `lib/scan/server.ts`, `lib/scan/decide.ts`, `ios/App/App/CardScanner.swift`.

### 7.1 Learn the card layout — from real cards

Photograph (or find official scans of) cards from ~10 sets across eras. Note where these sit, as a
fraction of the card's height from the top: **the name**, **the printed number / set code**, any
**ID code** (a passcode, a collector id), the **copyright line**. Run them through Apple Vision OCR on
the Mac (the same settings as the app — the harness in the scratchpad's `ocr.swift`, or recreate it:
`VNRecognizeTextRequest`, `.accurate`, revision 3, `automaticallyDetectsLanguage = true`) to see what
the reader actually returns, misreads included.

### 7.2 `lib/scan/scanMatch.ts`

1. **`ScanCatalogKey`** — add the key.
2. **`readClues()`** — a pattern for the game's printed number (with OCR-slip tolerance like
   `DIGITISH` / `toDigits()` / `latin()` already give), stored in a new clue field.
3. **`catalogIndex()`** — an index by that number (like `byOpCode` for One Piece).
4. **`matchScan()`** — a block for the game: look up the number, score it (an exact printed code is
   strong: ~60), let the name confirm.
5. **`gameHints()`** — words/marks unique to the game's layout (e.g. "ATK/" for Yu-Gi-Oh!).
6. **`NAME_ON_TOP`** — add the game if its name is printed along the top (enables the name
   requirement: a clearly read name rules out other-named cards).
7. **`NOT_A_NAME`** — layout words printed along the top that aren't names (card-type banners etc.).
8. **Variants sharing one number** (rarities, alt arts) tie on text → the picture or the person picks
   (`decide.ts`). Don't try to separate them by text.

### 7.3 `lib/scan/server.ts` — `GAME_CATALOGS`, and `printingsOf()` for Phase 6's printings.

### 7.4 `ios/App/App/CardScanner.swift` — `codePattern` (`hasCode`)

The native side stops reading frames once it sees "a card number". Add the game's number pattern to
`codePattern`, or every scan of the game reads 3 frames and waits. Also `isSlab` / `slabPattern` if
the game is commonly graded. **Native changes need a new app build** (Xcode / `xcodebuild` +
`devicectl install` — see `docs/ios-app.md`).

### 7.5 Tests and benchmarks

- `lib/scan/scanMatch.test.mts`: real OCR lines for 5+ cards (normal, variant sharing a number, promo,
  a misread number, a misread name) → the right card / a tie / no wrong-name win. `npm run test:scan`.
- The 180-card end-to-end benchmark (scratchpad scripts `ocr.swift`, `e2e1.mts`, `e2e2.swift`,
  `e2e3.mts` — described in `card-scanner.md`): add 30 random cards of the new game, re-run. **The bar:
  0 wrong cards added automatically; the right card offered for ≥ 95%.**
- On the phone: scan 20+ real cards (sleeved, toploader, holo, a slab), pull the saved scans
  (`DebugScans` in `CardScanner.swift`, `devicectl device copy from …`), and check each one.

**Gate 7:** tests + benchmark meet the bar; the owner has scanned real cards on the phone.

---

<a id="phase-8"></a>
## Phase 8 — The scanner's AI: fingerprints and training

The scanner's picture AI (DINOv2, Apache-2.0) fingerprints every catalog card; a scan's fingerprint
finds the closest ones. A new game's cards need fingerprints, and the model should be retrained so it
learns the new game's look. Details: `training-ai.md`; working folder on the Mac:
`~/Developer/tcghaven-vision/`.

1. **Images:** add the game to `fetch_all.py`'s game list; download its catalog images (polite:
   ≤ 8 at a time, ~8/s for hosts that ask, honest User-Agent) into `full/img/`, shrunk to 224 × 308.
2. **Fingerprints with the current model:** `embed_all.py` → `full/index.npy` + `full/ids.txt`.
3. **Identical-art groups and look-alikes:** `groups.py` → `full/labels.npy`, `neighbors.py` →
   `full/neighbors.npy`.
4. **Measure before training:** `fulleval.py` — add 30 of the new game to the benchmark list.
5. **Retrain:** rebuild the kit (`pc/` → `tcghaven-vision.zip`) and train on the RTX 4090 following
   `training-ai.md` (or `train.py` on the Mac for a quick pass). The real-scan score must not drop for
   the existing games.
6. **Bring the model back**, re-fingerprint (`embed_all.py` with the trained weights), convert to
   Core ML (`convert.py`), ship it in the app and the index to the server.
7. **Ongoing:** the catalog sync fingerprints each new card as it arrives (once the sync-side
   fingerprinting step exists — see `card-scanner.md` "What's next"), so new sets are recognised by
   picture the day they land, without retraining.

**Gate 8:** the new game's benchmark cards are found in the picture search's top 5 ≥ 95%; the
existing games' real-scan scores are unchanged or better.

---

<a id="phase-9"></a>
## Phase 9 — Docs

- `docs/games.md` — the game's section: data source (primary + check), schema, rarities, variants,
  Cardex grouping, how new sets arrive, gotchas — written like One Piece's.
- `CLAUDE.md` — the game in the intro line; a "rules that bite" line if it has a sharp edge; any new
  `npm run` command.
- `docs/catalog.md` — sync details; `docs/file-map.md` — new files; `card-scanner.md` — the game's
  scanning notes and benchmark row; `docs/quirks.md` — anything that bit.
- This guide — update anything that turned out different.

---

<a id="phase-10"></a>
## Phase 10 — Release, watch, and roll back

### Release order
1. All code pushed; Checks pass; Vercel deploy live.
2. First sync from the CLI (Phase 4.4); report clean.
3. Cron / own workflow live; watch the next two scheduled runs (GitHub Actions + `sync_status/{game}`).
4. The game appears for users who turn it on (Inventory → +).
5. App build with the scanner changes (TestFlight / App Store when relevant).

### Watch for a week
- `sync_status/{game}` ok every run; Portfolio's "Prices updated" line fresh.
- Admin Catalog → Needs Review for the game's unplaced promos.
- `npm run check-images -- {game}` weekly.
- Scanner debug scans of the game (test builds) — anything wrong becomes a `test:scan` case.

### Rolling back (without deleting anything)
- **Hide the game:** remove it from the UI lists (Phase 5.2) and redeploy — catalog data stays.
- **Stop syncing:** remove it from the cron / disable its workflow.
- **A bad card:** hide it in the Admin Catalog (`hidden: true`), never delete — someone may have
  logged it.
- **Deleting catalog data** needs the owner's explicit OK, every time.

---

<a id="appendix-a"></a>
## Appendix A — Yu-Gi-Oh! research (2026-11-10, read-only, from live tcgcsv data)

| | |
|---|---|
| tcgcsv category | **2** — "YuGiOh" |
| Groups (sets) | **659** — from *The Legend of Blue Eyes White Dragon* (LOB, 2002-03-08) to *Glorious Victors* (GLVI, 2026-12-04, pre-release listing) |
| Card vs sealed | card products carry a `Number` extended-data field; sealed (displays, boxes) don't — e.g. MAMS: 267 cards, 3 sealed |
| Card fields (`extendedData`) | `Number`, `Rarity`, `Attribute`, `Card Type`, `Description` (**full card text**), `MonsterType`, `Attack`, `Defense`, `LinkRating`, `LinkArrows` |
| Number format | `SETCODE-REGION###`, e.g. `MAMS-EN001` (regional: EN, also DE/FR/IT/PT/SP… — decide D3) |
| Variants | separate **products sharing one number**: e.g. `MAMS-EN001` is "…Phantom Beast", "… (Extended Art)", "… (Starlight Rare)" — each its own card (Phase 6, separate product) |
| Price sub-types | per product, e.g. MAMS: `1st Edition` (249 rows), `Normal` (3, the sealed). Older sets also have `Unlimited` and `Limited` → `variantPrices` editions |
| Images | TCGplayer CDN (`tcgplayer-cdn.tcgplayer.com`) — already allowed in `next.config.js` |

**Secondary source (D7) — YGOPRODeck API** (`https://db.ygoprodeck.com/api/v7/cardinfo.php`, free;
read its terms — it asks clients to cache and not hotlink images): every card with its `card_sets`
(set code, set name, rarity) — a per-set-code list to check our cards against in Phase 3.

**Scanner notes (Phase 7):**
- The **name** is printed along the top → add to `NAME_ON_TOP`.
- The **set code** (`MAMS-EN001`) is printed just **below the artwork on the right** — not along the
  bottom edge; `readClues()` must look for it anywhere, not only in the bottom band.
- The bottom-left carries an **8-digit passcode** (the card's game id — same for every printing of
  that card): a strong check that the *card* is right, while the set code picks the *printing*.
- `ATK/` `DEF/` / `LINK-` and the attribute icon text are Yu-Gi-Oh!-only layout words → `gameHints()`.
- Card-type banners (`[Spell Card]`, `[Trap Card]`, `[Dragon/Effect]`) are not names → `NOT_A_NAME`.
- Rarity versions share a set code → ties on text; the picture (and finish) decide.
- `Description` (card text) from TCGplayer makes the "every word on the card" signal possible: match
  the OCR'd effect text against each candidate's text.

**Open questions for the owner (Phase 0):** English only first? Include Speed Duel / Rush Duel? OCG
(Japanese/Asian) cards — separate catalog later? Duel Terminal / promo sets — all in, through Needs
Review?

---

<a id="appendix-b"></a>
## Appendix B — Commands cheat-sheet

```bash
npm run typecheck && npm run lint            # always
npm run test:{game}-source                   # the planner's tests (new)
npm run {game}-source-report                 # read-only checks (new) — exit ≠ 0 = stop
npm run download-cards -- --only {game}      # the sync, from the CLI
npm run check-images -- {game}
node scripts/check-collection.mjs --all      # logged cards unchanged (when the game has users)
npm run test:scan                            # scanner matching
npm run build                                # before pushing route changes (rule 24)
```

Mac AI folder (`~/Developer/tcghaven-vision/`): `fetch_all.py` → `embed_all.py` → `groups.py` →
`neighbors.py` → `fulleval.py` → kit for the 4090 (`training-ai.md`) → `convert.py`.
