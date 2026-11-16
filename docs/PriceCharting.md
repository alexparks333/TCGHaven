# PriceCharting — graded card prices (research, 2026-11-15)

**Status: idea, not built.** Waiting on a commercial license from PriceCharting. Contact: **sales@vgpc.com**
(VGPC = VideoGame PriceCharts, PriceCharting's original name). Email sent by the owner; nothing is
coded yet.

## The idea

Today a graded card is valued at its raw (ungraded) TCGplayer price. The plan: once a day, pull
PriceCharting's graded sold prices (PSA 10, Grade 9, 8, 7 …), match them to our catalog cards, and use
them **only** for cards a user has marked as graded. No graded price → fall back to raw and say so.

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
must be **deleted if the subscription ends**, so it is an ongoing dependency. **Don't build or ship this
before the licence is agreed.**

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

## How it would be built

1. **Daily job** on GitHub Actions, like the MTG sync (Pokémon already strains Vercel's function limit).
   It downloads the CSV, matches by `tcg-id` → `tcgProductId`, and writes a small graded-price block onto
   each matched catalog card. **Only changed cards** are written, with `update()` and
   `updatedAt: serverTimestamp()` (rules 29 and the catalog rule in CLAUDE.md). The token lives in
   1Password and `.env.local`, never in the repo.
2. **Pricing rule** (`lib/pricing.ts` `catalogPrice()`): a graded card looks up its column. PSA 10 → PSA
   10; BGS / CGC / SGC / TAG 10 → their own 10s, Pristine and Black Label included; 9.5 → Grade 9.5;
   8.5 → Grade 8; 7.5 → Grade 7. Nothing there → raw price, shown as "raw est.". Graded cards already store
   `gradingCompany`, `grade` and `gradeTier` (`lib/types.ts`, `lib/grading.ts`).
3. **Attribution:** "Prices from PriceCharting" with a link beside graded prices.

## Cost estimate (monthly)

| Item | Cost |
|---|---|
| PriceCharting Legendary | $49 |
| Commercial license | unknown, waiting on their quote |
| Firestore writes | ~$1–3 for changed cards only; worst case, every card rewritten daily, ~$15 |
| Firestore storage | pennies |
| Daily job (GitHub Actions) | $0 |

≈ **$50–65/month plus the licence.** The Firestore figures are an estimate: a few hundred thousand catalog
cards at standard prices ($0.18 per 100K writes).

## Questions sent to PriceCharting

1. Commercial license price and terms.
2. Are Grade 7–9.5 prices all grading companies, or PSA only?
3. Coverage of Riftbound, Gundam and Flesh and Blood.
4. Preferred attribution: logo, text link, or both.

## Sources

- https://www.pricecharting.com/api-documentation
- https://www.pricecharting.com/pricecharting-pro
- https://www.pricecharting.com/page/terms-of-service
- https://www.pricecharting.com/game/pokemon-base-set/charizard-4 (example card page; shows TCGplayer ID 42382)
- https://tcgtalk.com/guides/tcg-market-weekly-analysis (item counts)
