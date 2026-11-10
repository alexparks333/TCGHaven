# Card search, prices & the Cardex

Moved out of CLAUDE.md (2026-10-30) so it's read only when needed. Section numbers (§N) refer to
the original CLAUDE.md layout.

## Card Search Flow

When Alex types a name in the AddCardDialog search box:

```
User types query
  → AddCardDialog debounces 300ms
  → fetch("/api/cards/search?game=lorcana&q=mickey")
  → app/api/cards/search/route.ts (server-side)
  → searchCards(game, query) in lib/api/search.ts — caps the final result list at 40
    (searchCardsUncapped() does the real per-game work; each per-game search*Cards()
    already returns matches best-first, so slicing after is a safe cut, not a re-ranking)
  → calls searchLorcanaCards(query) / searchPokemonCards(query) / searchRiftboundCards(query) /
    searchOnePieceCards(query) / searchMtgCards(query)
  → loadVisibleCatalog(game) in lib/api/catalog.ts — Firestore-backed, in-memory cached
    per server process (see §4 for the caching/staleness mechanics). Pokémon's own
    searchPokemonCards() only falls back to a live api.pokemontcg.io call if the catalog is
    completely empty (i.e. before the first sync has ever run) — see §7's AddCardDialog note.
  → rankCards() (lib/api/cardSearch.ts) ranks every card, eBay-style — see below
  → returns up to 40 results as JSON
  → AddCardDialog renders dropdown with name, image, set, price
```

**Why server-side?** The Pokémon TCG API blocks browser CORS requests. By routing all
searches through Next.js API routes, we avoid CORS entirely for every game.

**The ranking engine — `lib/api/cardSearch.ts` (2026-10-26, modeled on eBay's keyword
search).** One engine for all five games, Add Card, Personal Collections and the Admin
whole-catalog search. Collectors kept failing to find cards ("sabrinas" found nothing because
the old `scoreMatch()` split "Sabrina's" at the apostrophe; "Charizard 9" hard-filtered to cards
numbered 9, hiding the rest), so the old scorer was replaced, not patched:

- **Normalization:** case, accents and punctuation never matter. Apostrophes are *removed*
  ("Sabrina's" → "sabrinas"), every other symbol becomes a space; ★/δ/◇/♀/♂/&/Æ are spelled out
  (star/delta/prism/female/male/and/ae). A word may also span tokens ("hooh" = "Ho-Oh",
  "mrmime" = "Mr. Mime", "pokeball" = "Poké Ball").
- **Every word must match somewhere** — the name (word starts only, no mid-word matches; "cr"
  still won't match "incredible"), Riftbound champion `tags`, or the card's "item specifics":
  set name, set code, rarity, plus per-game extras from `lib/api/searchTerms.ts` (rarity display
  labels — "secret rare" finds One Piece `SEC`, "signature" finds Riftbound `Star` — Riftbound
  `cardType`, and "parallel" for One Piece `_pN` ids). A name hit always outweighs the same word
  hitting a set/rarity.
- **Collector numbers are soft:** any word containing a digit ("9", "009", "#9", "4/102", "TG05",
  "OGN-007a", "OP01-024") boosts cards whose number matches (`numberKey()`: digit runs lose
  leading zeros, anything after "/" is ignored) to the top but never hides the others. It also
  counts if it's part of a set name or card name ("charizard 151", "porygon2"). A number-only
  query is a lookup: it lists only the number matches.
- **Expansion:** plurals ("charizards"); typos, but only for a word that matches nothing as
  typed, and only the closest corrections (1 edit, 2 for 9+ letters — "charzard" → Charizard,
  not Charmander).
- **Best Match order:** exact full name > name prefix > fewer extra name words ("Gengar" before
  "Gengar & Mimikyu-GX") > set/rarity hits; ties go to the more valuable card.
- **Fallback:** if nothing matches every word, cards matching at least half the words are shown
  (eBay's "results matching fewer words"). The Admin search turns this off.
- **Operators:** `-word` excludes, `"quoted phrase"` must appear in the name. Finish words (holo,
  foil, reverse, nonfoil) aren't matched; `searchCards()` uses them to put the foil (or regular)
  row of each card first.
- **Performance:** each card's search index is built once and cached in a `WeakMap` keyed on the
  catalog card object, so it lives exactly as long as the catalog cache's copy of that card. That
  costs ~19MB and ~1.2s on the first MTG search per server process (~3MB / 0.3s for Pokémon); after
  that a search takes ~25ms for Pokémon and ~90ms for MTG. Every caller searching a game must pass
  that game's `searchOptionsFor(game)`, since the index (extra terms included) is cached on first
  use.
- **Tests:** `npm run test:search` (`lib/api/cardSearch.test.mts`, offline, real card names).

---

---

## Price Data

**As of the price-refresh redesign (see [§18](#cron-driven-price-sync)), live external price
fetches for all four games happen in exactly one place: the 6-hourly cron-driven catalog sync.**
Nothing else — not Portfolio's "Refresh Prices" button — ever calls
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
  `lowPriceNM`/`lowPriceNMFoil` — despite the name, TCGCSV's lowest listing in ANY condition
  (damaged included), so it's never used for pricing; the app always uses market price (see quirk #19)
- **Price refresh:** Portfolio page → "Refresh Prices" reads `catalog/pokemon/cards/*` for just
  the apiIds in Alex's own inventory (`app/api/prices/pokemon/route.ts`) — an in-memory catalog
  lookup, no network call to pokemontcg.io
- **Foil logic:** `isFoil=true` → holofoil market price; `isFoil=false` → normal market price
- **Stored on Card:** `currentPrice` field updated by refresh; `purchasePrice` set when card added
- **Set matching:** each tcgcsv group is matched to a pokemon-tcg-data set by exact name, then
  abbreviation, then `scripts/lib/pokemon-groups.mjs` (TCGplayer's older naming — "XY - Flashfire",
  "EX Emerald", "SV01: Scarlet & Violet Base Set", "SV: Scarlet & Violet 151", McDonald's years,
  Black Star promo sets). Before that third step ~60 whole sets never got a TCGplayer price.
- **Variants sharing a number:** TCGplayer files "Charizard (Black Dot Error)", Master Ball
  Pattern reverse holos, Pokémon Center stamps etc. under the card's own number. The plain-named
  product always wins; a "(...)" variant only fills a price nothing plain set.
- **Backup prices (gap-only, 2026-10-25)** — `scripts/lib/price-fallback.mjs`, Phase 3 of
  `downloadPokemon()`. Only cards still at $0 after TCGplayer are looked up, never whole sets:
  layer 2 api.pokemontcg.io (TCGplayer's price for the exact catalog id, 40 ids per request,
  retried — that API is flaky), layer 3 api.tcgdex.net per card (its TCGplayer block, else
  Cardmarket EUR→USD via frankfurter.app). Each gap is checked at most once a day; results
  (including "nothing found", but only when both sources actually answered) are cached in
  `catalog_meta/pokemon-price-backup` and reused by the other syncs that day (`CACHE_VERSION` —
  bump it when the rules change). Capped at 1,500 lookups / 90s per run. A backup-priced card
  carries `priceSource` (`tcgplayer-backup` | `cardmarket`); `syncToFirestore`'s `fieldDefaults`
  resets it to `''` once TCGplayer prices the card again, without rewriting every other doc.
  `cardmarket` estimates show "Est." in the Cardex and are left out of price history (exchange-rate
  moves would look like price changes). Cardmarket's normal/holo split is unreliable for single-print
  rarities, so those take the higher of the two. As of this writing: TCGplayer prices 20,388 of
  20,635 cards; backups cover most of the remaining ~250.

### Lorcana

- **Source:** `api.lorcast.com`, synced into each card's Firestore doc
- **When fetched:** By the cron sync ([§18](#cron-driven-price-sync)), or `npm run download-cards`.
  There is no live per-request lorcast call anywhere anymore — Portfolio's refresh used to fetch
  `api.lorcast.com/v0/cards/{id}` one card at a time (8-way concurrency) since lorcast has no bulk
  price endpoint, which made it by far the slowest of the three games to refresh; it now just
  reads the catalog like the other two games.
- **To update prices:** the cron sync, or `npm run download-cards` (no rebuild needed — see [§4](#card-catalog-system--deep-dive-firestore-backed))
- **Fields in catalog:** `marketPrice` (non-foil) and `marketPriceFoil` (foil/cold foil) — lorcast
  has no separate "lowest listing" price
- **Note:** Enchanted and Epic cards may have `marketPrice: 0` because they are foil-only;
  their price is in `marketPriceFoil`

### Riftbound

- **Source:** `tcgcsv.com` (TCGPlayer mirror, category 89), synced into each card's Firestore doc
- **When fetched:** By the cron sync ([§18](#cron-driven-price-sync)), or `npm run download-cards`.
  Portfolio's refresh used to independently re-download and re-parse every set's full
  `ProductsAndPrices.csv` live, on every single call — the single most expensive thing in the app
  before this redesign, since it scaled with every set ever added, on every user's every
  refresh/page view. It now just reads the catalog.
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
  marketPrice` lookup, no `isFoil` branching (nothing to branch on)
- **To update prices:** the cron sync, or `npm run download-cards` (no rebuild needed — see [§4](#card-catalog-system--deep-dive-firestore-backed))

### Magic: The Gathering

- **Source:** `api.scryfall.com`, prices included directly on each card object — no separate
  price-matching/merge pass at all, unlike the TCGCSV-based games (see
  [§11](#magic-the-gathering--data-source-schema-add-a-set-guide) for why).
- **When fetched:** **Not yet on the cron sync** — MTG is deliberately excluded from
  `app/api/cron/sync-prices/route.ts` until its Firestore write-quota impact is confirmed
  acceptable (its first sync alone is ~99,000 document writes). Only a manual Admin Catalog
  "Sync Card Data" click, or `npm run download-cards -- --include-mtg`, actually syncs it right
  now. See docs/games.md (Magic section) for the full writeup and how to turn it on.
- **Fields in catalog:** `marketPrice` (usd) and `marketPriceFoil` (usd_foil, falling back to
  usd_etched) — same shape as Lorcana/Riftbound's foil handling, not One Piece's separate-id
  Parallels.
- **Price refresh:** Portfolio page → "Refresh Prices" reads `catalog/mtg/cards/*` for just the
  apiIds in Alex's own inventory (`app/api/prices/mtg/route.ts`) — same `isFoil`-branching shape
  as `app/api/prices/lorcana/route.ts`.
- **To update prices:** a manual Admin Catalog sync or `npm run download-cards -- --include-mtg`
  only, for now (no rebuild needed once run — see [§4](#card-catalog-system--deep-dive-firestore-backed)).

---

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
See quirk #9 for the full reasoning. Japanese Pokémon is its own Cardex tab, grouped by era the
same way (§7 Japanese Pokémon).

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
