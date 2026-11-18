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
   `tcg-{n}` / `jp-{n}`), grade → column (`gradedPriceKey()`), the citation link (`pcProductUrl()`).
   Several PriceCharting rows on one TCGplayer id: the plain-named row wins, else skipped. One TCGplayer
   id on several of our cards (One Piece Normal/Foil pairs): skipped.
2. **Daily job** — `npm run pricecharting-sync` (`scripts/pricecharting-sync.mjs`; `--file x.csv`,
   `--dry-run`, `--only pokemon-jp,onepiece`) and `.github/workflows/sync-graded-prices.yml` (manual
   until the first real run is checked). Downloads the link(s) in `PRICECHARTING_CSV_URLS` (secret —
   contains the token; 1Password). Writes **`graded_prices/{catalog}`** (meta: `chunkCount`, `matched`,
   `asOf`) + `chunks/{n}` — **not** the catalog cards: a card's new `updatedAt` would read as a staff
   edit and the next catalog sync would skip it. Never deletes; a match count that halves keeps the
   last run's prices.
3. **Pricing** — `lib/pricing.ts`: `catalogPrice()` takes `grading` and returns the graded price first
   when there is one (`gradedPrice()`; Pokémon: only the ordinary printing, not 1st Edition / Shadowless /
   Reverse). Every price route lays the prices on with `withGraded()` from `lib/api/gradedPrices.ts`
   (30-minute cache, read only when a graded card is asked about); `PriceAutoUpdater` sends each card's
   `gradingCompany` / `grade` / `gradeTier`.
4. **Switch:** server env **`GRADED_PRICES=on`** (Vercel + `.env.local`). Off → graded cards are priced
   raw exactly as before, whatever is in Firestore.

**Before switching on:**
- Deploy `firestore.rules` (new `graded_prices` collection), add the secrets, run the job once by hand.
- **The citation UI** (a licence condition): "Prices from PriceCharting" linking to the card's page
  (`u` in each entry) beside every graded price, and "raw est." on a slab with no graded price. The price
  routes return only numbers today — the UI needs a way to know which cards got a graded price.
- **Portfolio changes:** baselines come from TCGplayer price history (`/api/price-history`), so a slab
  switching to its graded price would show a fake jump (raw $5 yesterday → PSA 10 $500 today). Graded
  cards need graded history, or to be left out of change figures.
- Confirm on a real CSV: the price format, the download link, and that the citation URL pattern lands
  on the right page.

Dry run on 2026-11-17 against the live catalog (fake CSV built from real ids): Pokémon JP, One Piece and
Yu-Gi-Oh! all matched. Pokémon EN: only 8,056 of 28,692 cards carry a TCGplayer id (the `tcg-*` ones);
Magic, Lorcana and Riftbound none — save `tcgProductId` in their syncs for full coverage.

## Cost estimate (monthly)

| Item | Cost |
|---|---|
| PriceCharting Legendary | ~$50 |
| Licence | $0 until $1,000/month revenue; then a revenue share (quoted 8%) |
| Firestore writes | pennies — a few dozen chunk docs a day, not one write per card |
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
