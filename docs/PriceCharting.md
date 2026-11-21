# PriceCharting — graded card prices (research 2026-11-15, pre-built 2026-11-17)

**Status: licensed (2026-11-17); pre-built and switched off (`GRADED_PRICES`) — see "How it's built"
and "Before switching on".** PriceCharting allows it on the Legendary plan with attribution until
$1,000/month revenue (see "Their offer" below). Contact: **sales@vgpc.com** (VGPC = VideoGame
PriceCharts, PriceCharting's original name).

## The idea

Today a graded card is valued at its raw (ungraded) TCGplayer price. The plan: once a day, pull
PriceCharting's graded sold prices (PSA 10, Grade 9, 8, 7 …), match them to our catalog cards by
TCGplayer product ID, and use them **only** for cards a user has marked as graded. TCGplayer stays the
truth for everything ungraded. No graded price → fall back to raw and say so.

## What PriceCharting offers

- **Plan:** API access and the price list download need the **Legendary** plan, **$49/month**. Lower plans
  (Free, Collector $6/mo) have neither.
- **Daily price list:** a CSV rebuilt **once every 24 hours**. Downloads are limited to one every 10
  minutes, and the column names match the API's. Prices are in USD. Once a day is all we need.
- **API:** `/api/product` (one item by `id`, `upc` or `q`) and `/api/products` (up to 20 search results),
  with a 40-character token as `t`. Limited to **1 call per second**. They ask callers to cache in their own
  database, not call per user request.
- **IDs on every card:** `id` (PriceCharting's own) and **`tcg-id` = the TCGplayer product ID**, so cards
  can be matched by ID, not by name.

### Price columns for cards

| Grade | Column |
|---|---|
| Ungraded | `loose-price` |
| Grade 1 / 2 / 3 / 4 / 5 / 6 | `condition-9/10/13/14/15/16-price` |
| Grade 7 or 7.5 | `cib-price` |
| Grade 8 or 8.5 | `new-price` |
| Grade 9 | `graded-price` |
| Grade 9.5 | `box-only-price` |
| PSA 10 | `manual-only-price` |
| BGS 10 | `bgs-10-price` |
| CGC 10 | `condition-17-price` |
| SGC 10 | `condition-18-price` |
| CGC 10 Pristine | `condition-19-price` |
| BGS 10 Black Label | `condition-20-price` |
| TAG 10 | `condition-21-price` |
| ACE 10 | `condition-22-price` |

**Only the 10s are split by grading company.** Grade 7–9.5 is very likely a mix of PSA, BGS, CGC … sales.
Their docs say "a grading company", and their card pages list mixed-company sales under one grade. Label
these "Grade 9 sales", not "PSA 9", until PriceCharting confirms either way (it's question 2 in the email).

## The licence — what decides it

PriceCharting's docs and terms: API and CSV data are for **internal use only**. Showing it in an app others
use needs a **commercial license and their written permission**. Its price isn't published. With
permission they prefer attribution: a logo or a text link to the card's PriceCharting page. All stored data
must be **deleted if the subscription ends**, so it is an ongoing dependency. Permission for our use is now
in writing (below); attribution is a condition of it, so **never ship graded prices without the citation
link.**

### Their offer (2026-11-17)

**Written permission received (2026-11-17, PriceCharting sales by email):** until TCGHaven reaches
**$1,000/month in revenue**, the **Legendary subscription ($50/mo)** is enough to use the data via the API
in our product, **provided we cite them** — an icon or text with a link back to the card's PriceCharting
page. Past $1,000/month we move to a formal Commercial Agreement with a revenue share (quoted separately
as **8% of total revenue**). Keep that email; it is the licence until the agreement exists.

For the later Commercial Agreement, still to clarify with them:
whether "total" means all TCGHaven revenue or only revenue tied to their data; gross or after Apple's /
Stripe's cut; whether the $49/month Legendary plan is on top; any minimum, cap or reporting/audit terms;
and the length and exit terms of the contract. At $3.99/mo, 8% of gross is ≈ $0.32 per subscriber per month (≈ 9.4%
of the $3.39 kept after Apple's 15%).

## Coverage against our games

- **Listed by PriceCharting:** Pokémon (EN + Japanese), Magic, Yu-Gi-Oh!, Lorcana, One Piece, Digimon,
  Star Wars, plus Dragon Ball and Marvel, which we don't carry.
- **Not listed by name** (maybe under "Other TCG Cards", unconfirmed): Riftbound, Gundam, Flesh and Blood,
  Palworld, Cyberpunk.
- Third-party counts from PriceCharting data: Pokémon ~85K, Magic ~127K, Yu-Gi-Oh! ~76K, One Piece ~11K
  items.
- **Graded prices exist only where graded copies sell.** Chase cards and vintage are well covered; most
  commons and newer games will have no graded price, so the raw fallback is the common case.

## Matching to our catalog (by TCGplayer product ID)

- **Already have it:**
  - `tcgProductId` on Yu-Gi-Oh!, One Piece and the shared-engine games (Star Wars: Unlimited, Gundam, Flesh
    and Blood, Digimon, Palworld, Cyberpunk).
  - Built into the card ID for Pokémon Japanese (`jp-{productId}`) and every TCGplayer-only card
    (`tcg-{productId}`).
- **Don't save it yet:** Pokémon EN, Magic, Lorcana, Riftbound. Their syncs already see TCGplayer data, or
  a source that lists TCGplayer IDs (Scryfall, lorcast), so saving `tcgProductId` is a small change. It's
  worth doing whatever happens with PriceCharting.

## How it's built (pre-built 2026-11-17, switched off)

**The split:** TCGplayer stays the source of truth for everything ungraded — which cards exist, names,
images, set numbers, the Cardex and raw prices. PriceCharting adds **only graded prices**; its ungraded
`loose-price` is never imported. A card logged as a slab (PSA, CGC, BGS …) is priced from PriceCharting's
sales for its grade; with none, it keeps its TCGplayer price (shown as "raw est.").

1. **Pure logic** — `scripts/lib/pricecharting.mjs` (tests: `npm run test:pricecharting`, in CI): CSV
   parsing by header name, the column map above, matching `tcg-id` → our card (`tcgProductId`, or the id
   `tcg-{n}` / `jp-{n}`), grade → column (`gradedPriceKey()`), the citation link (`pcIdUrl()`: `/game/{productId}`, which always redirects to the exact card page — the old name-built address hit a search page for names with "&" or brackets, 2026-11-19).
   Several PriceCharting rows on one TCGplayer id: the plain-named row is the card (or, with none, a lone "[Holo]"), else skipped; its **versions** — "[Foil]", "[1st Edition]", "[Limited]", "[Shadowless]", "[Reverse Holo]" — are kept beside it (`v`) and `gradedVariantKey()` picks the one a copy is (2026-11-19: Magic 1,515, Lorcana 352, Yu-Gi-Oh! 8,114, Pokémon 11,836 reverse + 826 1st Edition; before, a 1st Edition Alakazam PSA 10 showed the raw $323 instead of $23,790). A version PriceCharting files under *another* TCGplayer id (Base Set's 1st Edition / Shadowless sit under TCGplayer's separate Shadowless product) joins the card whose plain row has the same set, name and number — only when exactly one plain row and one row of that version match (2026-11-19: Pokémon 1st Edition 826 → 3,935, Shadowless 0 → 77; 1st Edition Charizard PSA 10 $466,431 instead of a $100,000 raw est.). A version with no listing → Raw est. History keeps versions as `{id}~{version}`. Chunks are written to alternating slots (`a0…`/`b0…`, meta `slot`) so a reader never mixes two days. One TCGplayer
   id on several of our cards (One Piece Normal/Foil pairs): skipped.
2. **Daily job** — `npm run pricecharting-sync` (`scripts/pricecharting-sync.mjs`; `--file x.csv`,
   `--dry-run`, `--only pokemon-jp,onepiece`) and `.github/workflows/sync-graded-prices.yml` (manual
   until the first real run is checked). Downloads the Pokémon, Magic, Yu-Gi-Oh! and One Piece price lists
   (`/price-guide/download-custom?t={token}&category=…-cards`) with `PRICECHARTING_TOKEN` (secret; 1Password).
   Japanese Pokémon is inside pokemon-cards; PriceCharting offers no CSV for Lorcana, Digimon, Star Wars etc. Writes **`graded_prices/{catalog}`** (meta: `chunkCount`, `matched`,
   `asOf`) + `chunks/{n}` — **not** the catalog cards: a card's new `updatedAt` would read as a staff
   edit and the next catalog sync would skip it. Never deletes; a match count that halves keeps the
   last run's prices.
3. **Pricing** — `lib/pricing.ts`: `copyPrice()` takes `grading` and returns the graded price first
   when there is one (`gradedPrice()`; Pokémon: only the ordinary printing, not 1st Edition / Shadowless /
   Reverse). Every price route lays the prices on with `withGraded()` from `lib/api/gradedPrices.ts`
   (30-minute cache, read only when a graded card is asked about); `PriceAutoUpdater` sends each card's
   `gradingCompany` / `grade` / `gradeTier`.
4. **Switch:** server env **`GRADED_PRICES=on`** (Vercel + `.env.local`). Off → graded cards are priced
   raw exactly as before, whatever is in Firestore.

5. **What people see** (2026-11-18) — `components/GradedPriceTag.tsx`, only while graded pricing is on:
   - A slab priced from PriceCharting: a gold chip **"PSA 10 sales · PriceCharting ↗"** under its price
     (Inventory rows, Portfolio rows and top performers), linking to the card's PriceCharting page — the
     licence's citation. The card page says "From recent PSA 10 sales on PriceCharting ↗" under Current
     Value.
   - A slab with no sales for its grade: a dashed **"Raw est."** chip (tooltip: valued at TCGplayer's
     ungraded price).
   - How the app knows: PriceAutoUpdater sends `withSources: true`; the routes then answer
     `{ prices, graded: { cardId: { key, url } }, gradedOn }` (`priceReply()`), kept in the store
     (`gradedSources`, `gradedOn`) and in the on-device saved prices. Callers without `withSources`
     (Personal Collections, a friend's card) get the plain price map — and a friend's card is always
     priced ungraded, since that view has no citation.
   - **No fake jumps:** a graded-priced slab is measured "since added" against what was paid (its
     saved entry price is the ungraded one). Its 24h–1y changes and charts use the graded history (6.).

6. **Graded price history** (2026-11-18) — `scripts/lib/graded-history.mjs`. Each run of the daily job
   also keeps the day: `graded_history/{catalog}/days/{YYYY-MM-DD}__{n}` (whole catalog, gzipped —
   Portfolio's windows) and `graded_history/{catalog}/months/{setKey}__{YYYY-MM}` (`days.{DD}` = gzipped
   JSON — one card's chart, Analytics). Same layout as `price_history`, but each month day is gzipped:
   a big set's graded month is over 1MiB as plain JSON (Secret Lair ~1.7MB). A tuple is the card's
   prices in `GRADED_ORDER` — **append-only**, never reorder. `lib/api/priceHistory.ts` reads it for
   every slab that is graded-priced today (`gradedPricedKeys()` — the same test as the price routes):
   baselines, the card chart, Analytics. History starts 2026-11-19 (first day written 02:35 UTC), so a slab's 24h shows from
   the 20th, 7d from the 26th, and so on; until then "—". The job runs daily at 10:30 UTC.

7. **The one rule people see: one copy, one price.** A raw copy is worth TCGplayer's price; a slab
   PriceCharting's price for its grade, with the credit. Inventory, Portfolio (value, P&L, by game,
   top performers), Analytics, the card page, your profile, a friend's profile and the Add/Edit card
   dialog's Market Price all follow it — each inventory copy is priced on its own (PSA 10 + PSA 8 +
   CGC 10 + 2 raw = five prices summed). The only raw-only view is the Cardex tile hover.
   A **friend's profile** prices all their cards in one batch as it opens (`fetchCardPrices()` —
   their shared copies carry no prices) and ranks tiles by those; each grade is its own tile. Their
   full Cardex view gets their PriceCharting sources through `CardexViewer.graded`. `gradeTier` is
   shared (Black Label / Pristine change the price). **The Cardex:**
   - Hovering a tile shows the **raw** price — the card itself (with "raw" beside it when you own a
     slab of it), then the versions you own ("PSA 10 · PSA 7 · Raw").
   - The zoom view opens on your best slab (the one the tile shows). Owning more than one version
     (PSA 10, PSA 7, raw…) adds a small column of **bubbles** off the card's bottom-right corner (over
     it on a phone); tapping one (or the arrow keys) swaps the card: the old one tips away with a flash,
     the new one rises in. Each version shows its own price — a slab with the PriceCharting credit, or
     "Raw est." when its grade has no sales. `ownedVersions()` in `CardexPage.tsx`, `ZoomCardData.versions`.

**Before switching on:**
- Add the token (`PRICECHARTING_TOKEN`: `.env.local` on both machines + GitHub secret), run
  `npm run pricecharting-sync -- --dry-run`, then for real. (Firestore rules: deployed 2026-11-17.)
- Confirm on the real CSV: the price format, the One Piece category name (`one-piece-cards` — cut off in
  the screenshot), and that the citation links land on the right card page.
- Set `GRADED_PRICES=on` in Vercel (and `.env.local`), redeploy.
- Confirm `other-tcg-cards` downloads (Riftbound, Lorcana … sit under "Other TCG Cards" on
  PriceCharting — e.g. Teemo, Swift Scout [Alternate Art] #263A, PSA 10 $1,025 — but that list isn't on
  the download page).
- Done 2026-11-18: graded price history (6. above), and `tcgProductId` saved by the Pokémon EN,
  Magic, Lorcana and Riftbound syncs. Today matching also reads the id from a TCGplayer image link, which
  covers 301 of 1,754 Riftbound cards (the TCGplayer-sourced ones, like that Teemo) and 561 of 3,669
  Lorcana; Magic none.
- A friend's slab in the profile zoom view gets the graded price with the credit under it
  (`fetchCardPrice(card, slab)` → `{ price, source }`, `PriceChartingCredit`); so does your own.

**TCGplayer ids now saved (2026-11-18):** the Pokémon EN sync (`pokemon-tcgplayer.mjs`, from each card's linked product) and the Riftbound sync (`fetchRiftboundPrices`, from the TCGCSV row) now save `tcgProductId`. Measured with `planPokemonCatalog()`: Pokémon EN 28,662 of 28,691 cards get an id → **22,290 graded-priced** (was 2,375). Riftbound: up to the ~437 PriceCharting has (was 35). Takes effect after their next sync.

**All games (2026-11-18):** Magic (Scryfall `tcgplayer_id`), Lorcana (lorcast `tcgplayer_id`) and Riftbound Runes now save `tcgProductId` too — Magic ≈ 16,859 graded-priced after its next sync. Lists added after probing: `lorcana-cards`, `star-wars-cards`, `digimon-cards` (8 lists in all). An unknown list name quietly returns PriceCharting's **video-game** list (flesh-and-blood-cards, fab-cards, flesh-blood-cards, palworld-cards all did) — the job rejects a list with no TCGplayer ids. **Palworld** is inside other-tcg-cards (272 rows, 16 with a TCGplayer id, 0 graded prices yet) — it flows in automatically once PriceCharting has graded sales. **Flesh and Blood**: not on PriceCharting.

**First real dry run (2026-11-18):** all five lists downloaded — pokemon 98,036 rows, magic 135,560,
yugioh 79,490, one-piece 13,014, **other-tcg-cards 52,017** (Riftbound, Gundam, Cyberpunk… — the slug
works though it isn't on the download page). PriceCharting throttled the 4th back-to-back download
(HTTP 429) — the job now spaces them and retries. 89,806 TCGplayer products with graded prices; cards
priced: Yu-Gi-Oh! 28,647 · Pokémon JP 16,388 · One Piece 2,667 · Pokémon EN 2,375 · Gundam 439 ·
Riftbound 35 (incl. Teemo #263A, PSA 10 $1,025.01 ✓) · Cyberpunk 4. **None:** Magic (no ids saved),
Lorcana (not in other-tcg-cards — its own category? untested), Star Wars, Flesh and Blood, Digimon,
Palworld. Many columns are PriceCharting **estimates** (BGS 10 Black Label ≈ 5× BGS 10, CGC 10 ≈ 0.4×
PSA 10), so the chips say "PSA 10 · PriceCharting", never "sales".

Dry run on 2026-11-17 against the live catalog (fake CSV built from real ids): Pokémon JP, One Piece and
Yu-Gi-Oh! all matched. Pokémon EN: only 8,056 of 28,692 cards carry a TCGplayer id (the `tcg-*` ones);
Magic, Lorcana and Riftbound none — save `tcgProductId` in their syncs for full coverage.

## Cost estimate (monthly)

| Item | Cost |
|---|---|
| PriceCharting Legendary | ~$50 |
| Licence | $0 until $1,000/month revenue; then a revenue share (quoted 8%) |
| Firestore writes | pennies — a few dozen chunk docs a day, plus ~1,500 history month docs (one per set with graded prices) |
| Graded history storage | ~2MB a day gzipped → under 1GB a year (~$0.15/month after a year) |
| Firestore reads | pennies — each server reads a catalog's chunks at most every 30 min, only for graded cards |
| Daily job (GitHub Actions) | $0 |

≈ **$50/month** until the $1,000/month revenue mark.

## Questions for PriceCharting

1. ~~Commercial license price and terms~~ — answered 2026-11-17 (see "Their offer"); the later
   agreement's details are still open.
2. Are Grade 7–9.5 prices all grading companies, or PSA only? (unanswered — label them "Grade 9 sales")
3. Coverage of Riftbound, Gundam and Flesh and Blood. (unanswered)
4. Preferred attribution — answered: an icon or text with a link back to the card's page.
5. New: is the daily price-list download fine, given the email says "via API"? (same plan; worth a line)

## Sources

- https://www.pricecharting.com/api-documentation
- https://www.pricecharting.com/pricecharting-pro
- https://www.pricecharting.com/page/terms-of-service
- https://www.pricecharting.com/game/pokemon-base-set/charizard-4 (example card page; shows TCGplayer ID 42382)
- https://tcgtalk.com/guides/tcg-market-weekly-analysis (item counts)

## Graded links — PriceCharting rows with no TCGplayer id (2026-11-21)

About 1 in 5 PriceCharting rows with graded sales carry no TCGplayer id, so they can't link by id
(measured 2026-11-21: Lorcana 9%, Magic 12%, Pokémon 18%, Yu-Gi-Oh! 20%, One Piece 50%).

- **Automatic matching by set + name + number** (`backupMatch()`) — only unambiguous rows (one
  PriceCharting row, one of our cards, a card PriceCharting doesn't list under its own TCGplayer id,
  not already priced), and **only in catalogs whose daily self-check passes**: `validateBackup()`
  replays the rows that DO have ids with the id hidden and compares; on when ≥ 20 checked and ≤ 0.1%
  wrong (`BACKUP_MAX_WRONG`). Measured 2026-11-21: Pokémon 7 wrong of 11,530, Japanese 3 of 11,829,
  Lorcana 0 of 372, Yu-Gi-Oh! 0 of 102, Gundam 0 of 53 → on (213 new cards); One Piece 13 of 223,
  Magic 137 of 3,246, Riftbound 2 of 76 → off (suggestions only). Entries carry `via: 'match'`. The
  Owner accepted the small error rate and checks the matches now and then (the Graded links page's
  "Matched automatically" tab). The strictest variant (only cards with no TCGplayer id at all) and
  attaching no-id "[Foil]" rows as versions were tried and dropped (5 cards; hundreds wrong).
- **Any link can be changed** — Admin Catalog → Edit card → PriceCharting, or the Graded links page
  (`components/admin/PriceChartingLink.tsx`): paste the right `pricecharting.com/game/{id}` link
  (`links[cardId]._`, replaces any match — `via: 'staff'`), "Wrong — remove" (`blocked[cardId]`:
  no graded prices), or "Back to automatic".
- **The daily job** (`pricecharting-sync.mjs`) writes `graded_review/{catalog}` (staff read, bot
  write): those rows with graded sales, each with our cards in the same set (learned from that
  PriceCharting set's id rows) with the same number — `suggestLinks()` in `scripts/lib/pricecharting.mjs`,
  most valuable first, ≤ 400 per catalog.
- **The staff portal's Graded links page** (`/admin/graded`, `components/admin/GradedLinks.tsx`):
  Link / None of these. Saved to `graded_links/{catalog}` `{ links: { cardId: { slot: pcId } },
  ignored: { pcId: true }, blocked: { cardId: true } }` (staff only). Slot `_` = the card itself; a "[Foil]" / "[1st Edition]"
  row goes in as that version of the card (`linkSlot()`), unless the card picked is itself the foil
  card ("… (Foil)").
- **The next run applies them** (`applyManualLinks()`): staff always win — a card link replaces
  whatever matched, a version link adds or replaces that version, a block removes the card's graded
  prices. Entries set this way carry `via: 'staff'`.
- **Needs Review tags** (`components/admin/GradedTag.tsx`, `GET /api/admin/graded-status`): each
  card shows "Graded $…" (linked) or "No graded" (a slab of it is valued raw — Raw est.).
- Tests: `npm run test:pricecharting`.
