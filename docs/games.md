# Per-game data sources, schemas & add-a-set guides

Moved out of CLAUDE.md (2026-10-30) so it's read only when needed. Section numbers (§N) refer to
the original CLAUDE.md layout.

## Pokémon — Data Source, Schema, Add-a-Set Guide

### Data Source — TCGplayer primary, GitHub secondary (2026-11-06)

**Primary: TCGplayer** (`tcgcsv.com` category 3) decides which cards exist, and prices every card.
**Secondary: GitHub** (`github.com/PokemonTCG/pokemon-tcg-data`, one JSON file per set in
`cards/en/`, set metadata in `sets/en.json`) supplies names, images, rarities and ids for the cards
it has, and is the source TCGplayer is checked against. All of it is in
`scripts/lib/pokemon-tcgplayer.mjs` (pure, tested by `npm run test:pokemon-source`);
`downloadPokemon()` / `planPokemonCatalog()` in catalog-sync.mjs fetch and write.

Why: GitHub is days behind on new sets (Delta Reign was on TCGplayer on release day, not on
GitHub) and never has whole kinds of cards — Prismatic Evolutions' Poké Ball / Master Ball
patterns (GitHub 180 cards, TCGplayer 347), Black Bolt / White Flare / Ascended Heroes patterns,
Prize Pack, Jumbo, League, Blister and Deck exclusives, World Championship decks. ~28.7k cards vs
GitHub's ~20.5k. The pictures are practically identical for modern cards.

**The rule: a card's id never changes once it exists** (inventory links by `apiId` = catalog id).

- **Linked** — a TCGplayer product that IS a GitHub card keeps GitHub's id (`sv7-1`), name, image
  and rarity. Linking needs the same card, not just the same number: (A) same set + number + a name
  that agrees (`namesAgree()`: tolerant of "★"/"Star", "♀"/"F", "Bubbly W Energy", "Delta …"),
  (B) same set + a name unique on both sides (SV Black Star Promos are numbered differently past
  #100 — GitHub's Armarouge ex is 105, TCGplayer's 125), (C) any group, same number + name, one
  GitHub card fits (Best of Game sits in TCGplayer's "Best of Promos", Guardians Rising 19a in
  "Alternate Art Promos", the EX Trainer Kits…). The plain product is the card; a special copy
  (`SPECIAL_COPY`: Staff, Winner, Finalist, Misprint, Stamped…) never is, whatever its price.
- **Variants** — every other product in a GitHub set's group becomes its own card, id
  `tcg-{productId}`, in that set (`set` = GitHub set id): Poké Ball Pattern, [Staff], Black Dot
  Error… A finish the card itself isn't sold in at all keeps its first variant's price (Black Bolt
  has no plain reverse holo — the patterns are its reverse holos — as before the rewrite).
- **New sets** — an unmatched group that's a whole numbered set (`isNumberedSet()`: "NNN/TTT" with
  one total, not a promo-ish name) is added automatically as set `tcg-{groupId}`, named without
  TCGplayer's code ("ME06: Delta Reign" → "Delta Reign"), series from the prefix. Never reviewed.
- **Promo / special groups** (Prize Pack, Jumbo, WCD, League…) — a set per group (series
  "Promos & Special", last in the Cardex); their cards go through Needs Review (below).
- **Claimed sets** — a set built from TCGplayer is recorded on its set-list entry
  (`tcgplayerGroupId`) and stays TCGplayer's. When GitHub catches up, GitHub's copy is left out
  (`shadowedGithubSets`) — no duplicate, no id handover.
- **Safety:** a GitHub set file that fails to download → its TCGplayer groups are skipped (else
  they'd become duplicates); a group CSV that fails → its GitHub set is left out of that run (keeps
  today's prices instead of $0); >10% of groups failing aborts the sync; a group no name rule matches
  is matched by its contents (`matchGroupsByContent()`) before it could become a duplicate set.
- **GitHub id collisions** — a few GitHub sets reuse a number (Celebrations Classic Collection #15
  is four cards). They used to collapse into one catalog card; now the card the catalog shows keeps
  the id and the others use GitHub's own (`resolveIdCollisions()`).
- **Secondary check** — every sync compares linked cards (number / name / rarity *tier* — TCGplayer's
  rarities are coarser) and records counts in `sync_status/pokemon.sourceReport`, shown on the Sync
  panel. `npm run pokemon-source-report -- --out report.json` runs the whole plan read-only and
  diffs it against the live catalog (writes nothing) — run it before changing the matching.

### Pokémon promo review (2026-11-06)

Same Needs Review as Lorcana/Riftbound (`reviewTcgplayerPromos('pokemon', …)`), but stored in its
own doc, **`registry/pokemon-review`** (`{ placements, completedReviews, baseline }`) —
registry/main is one Firestore doc (1 MiB cap, ~311 bytes per placement) and Pokémon has ~6.5k
promo products. The first run records the existing ones as accepted by id only (`baseline`); only
promos TCGplayer adds after that are reviewed. `lib/api/review.ts` says where each game's review
lives (`REVIEW_DOCS`, mirrored in catalog-sync.mjs); GET `/api/set-registry/placements?game=pokemon`
returns it with Pokémon's sets (catalog_meta set list + custom sets). Review cards carry
`fromReview: true` so the Admin Catalog edits them through their review record.

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

Nothing to do. TCGplayer lists a new set on release day; the next sync (twice a day, or the staff
portal's Sync button / `npm run download-cards -- --only pokemon`) adds it as a `tcg-{groupId}` set.
When GitHub adds the same set later, the TCGplayer one stays (see Claimed sets above). Individual
missing cards can still be added via "Add Missing Card".

### AddCardDialog behavior for Pokémon

`searchPokemonCards()` (`lib/api/pokemon.ts`) is catalog-first, not live-API-first as this section
used to say: it reads `loadVisibleCatalog<CatalogCard>('pokemon')` (same Firestore-backed,
in-memory-cached read every other game's search goes through, [§4](#card-catalog-system--deep-dive-firestore-backed))
and only falls back to a live `api.pokemontcg.io` call if the catalog is completely empty (i.e.
before any sync has ever run). A Pokémon card with per-printing prices is **one** dropdown row
(no separate "✦ Holo" row — only backup-priced cards without `variantPrices` still get one);
selecting it shows the **Edition** picker (only when TCGplayer prices more than one edition) and the
**Finish** picker (only the finishes that card actually comes in), each button showing that
printing's price, and the card saves its `edition`/`finish` (see Editions & Finishes below). An
**English | Japanese** toggle above the search switches to the Japanese catalog (below).

The `apiId` stored on the Card is the catalog's `id` field (e.g. `"sv7-1"`). Card prices are read
from the catalog via `app/api/prices/pokemon/route.ts`, same catalog-only shape as every other game
(see [Price Data](#price-data) and quirk #19).

### Editions & Finishes (2026-10-26) — `scripts/lib/pokemon-variants.mjs`

TCGplayer prices WotC-era cards (and early Japanese sets) per **edition** — subtypes "1st Edition
Holofoil", "Unlimited Holofoil", "1st Edition", "Unlimited" — and modern cards per **finish**
("Normal", "Holofoil", "Reverse Holofoil"). The sync used to understand only the three finish names
and let whichever edition row came first (usually 1st Edition) fill the regular price: Jungle
Snorlax showed $445.14 (1st Ed) instead of $164.03 (Unlimited), ~840 cards across 11 vintage sets.

- **Catalog:** every Pokémon card (EN and JP) carries `variantPrices`, `${edition}:${finish}` →
  price (`edition` ∈ unlimited/shadowless/1st, `finish` ∈ normal/holofoil/reverse), e.g.
  `{ "unlimited:holofoil": 164.03, "1st:holofoil": 445.14 }`. Always present (`{}` when unpriced).
  The classic `marketPrice`/`marketPriceFoil` are the **default edition** (Unlimited when priced,
  else the first priced edition) with the old regular/foil semantics, so every card added before
  editions existed is priced exactly as before — just no longer at the 1st Edition price.
- **Base Set:** Unlimited is TCGplayer group "Base Set"; 1st Edition and Shadowless are in "Base
  Set (Shadowless)", whose "Unlimited" rows mean *Shadowless* (`EDITION_GROUPS`).
- **Inventory card:** `edition`/`finish` (saved when picked from catalog prices) — `catalogPrice()`
  (`lib/pricing.ts`) prices exactly that printing; a printing TCGplayer has no price for returns 0
  (the card keeps its own stored price) rather than borrowing another printing's.
- **Identity:** `cardIdentityKey()` keeps a non-Unlimited edition and a Reverse Holo in their own
  Inventory rows. Cardex ownership and "Card Unlocked" ignore edition — owning an Unlimited,
  Shadowless or 1st Edition copy all unlock the same card.
- **History:** a day's tuple gains a 5th element (the card's `variantPrices`) only for cards whose
  printings `[m, mf]` can't express (`historyNeedsVariants()`: another edition, or holo + reverse).
- **eBay:** ⌘/Ctrl-click appends `1st Edition` / `Shadowless -1st` / `-1st -shadowless`
  (Unlimited vintage), `Reverse Holo`, `Japanese` (`ebaySearchUrl()`).
- **Tags:** `components/PrintingTags.tsx` (1st Ed / Shadowless / Reverse Holo / Japanese) beside the
  name in Inventory, Portfolio and card detail.
- `scripts/fix-vintage-history.mjs` — one-off: removes the inflated pre-fix history entries for the
  affected vintage cards (dry run by default, `--apply` to write; idempotent).
- Known upstream oddities, left as TCGplayer reports them: Team Rocket Dark Charizard's 1st Edition
  "market" is $75 (stale — listings start at $995); Base Set 1st Edition Charizard has no market
  price, so the existing mid-price fallback shows its one $100,000 listing.

### Japanese Pokémon — its own catalog (`catalog/pokemon-jp`)

Built entirely from TCGplayer's Japanese category (tcgcsv **85**, ~460 sets, ~30k singles) by
`downloadPokemonJapanese()` + `scripts/lib/pokemon-jp.mjs` — one catalog card per TCGplayer
product, id `jp-{productId}`, set `jp-{groupId}`, TCGplayer's English card names (so search works
unchanged), its `_in_1000x1000` photo (none when `imageCount` is 0), prices through the same
edition/finish logic (many early Japanese sets have 1st Edition). Japanese WotC-era singles have
**no collector number** on TCGplayer, so a product is a single if it has a number or a rarity, or
its name doesn't look sealed (`isSingleRow()`). Names drop TCGplayer's " - 001/172" suffixes.

- **Sets:** `catalog_meta/pokemon-jp.sets` (written by the sync) — `{ code, name, releaseDate,
  cardCount, series }`, `series` = era by release date (`jpSetMeta()`); TCGplayer stamps a batch
  of back-catalog promo groups with one placeholder date (≥10 sets sharing a date) — those, and
  promo-named sets, go to "Promos & Special". `GET /api/sets?game=pokemon&lang=ja`.
- **Inventory:** still `game: 'pokemon'`, plus `language: 'ja'`. `catalogKeyFor(game, language)`
  (`lib/types.ts`) picks the catalog; the price route, history (`price_history/pokemon-jp`), search
  (`?lang=ja`), sets and Cardex (`/api/cardex?…&lang=ja`) all take the language.
- **Cardex:** its own tab, "Pokémon (Japanese)" (`CatalogGame` `'pokemon-jp'` in CardexPage —
  `baseGameOf()` maps it back to `'pokemon'` for pricing/rarity/eBay), grouped by era. The English
  Pokémon Cardex only counts English cards and vice versa.
- **Sync:** `app/api/sync/pokemon-jp/{route,sync}.ts`, an Admin "Pokémon (Japanese)" Sync button,
  `npm run download-cards` (or `-- --only pokemon-jp`), and the cron — but at most once a day
  (`minIntervalHours: 20`; TCGplayer's feed updates daily and each run reads the whole catalog).
  No per-sync image HEAD checks (`checkImages: false`). First sync ≈30k doc writes; a repeat
  writes only changed prices.

---

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

### Lorcana promo review (2026-11-02)

Only odd cards are reviewed — new regular sets and their cards arrive on their own. Lorcana's
"odd" cards are Phase 3's TCGplayer-only promo products (`tcg-{productId}`, e.g. Disney Lorcana
Promo Cards, D23, Illumineer's Quest). `reviewTcgplayerPromos('lorcana', …)` (catalog-sync.mjs)
gives each a `registry.lorcana.placements` entry — same shape and Needs Review UI as Riftbound's
(Accept / Ignore / Deny / move / rename / picture; per-sync nodes; Complete review), with no
"Riot art" option and TCGplayer's name kept as-is. The first run recorded the 356 promos already
in the catalog as an accepted, completed review. `sync/lorcana/sync.ts` reads the registry after
the download (which saves the placements). Not reviewed yet: the few unmatched TCGplayer rows in
real-set groups (Phase 3 skips a group that's mostly matched by lorcast).

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
makes a set show up in the Cardex, and that's a plain Firestore write too.

Then register the set in **the registry** (Firestore `registry/main` — this one doc replaced the
three hardcoded arrays that used to need separate edits — see [§17](#automated-sync--admin-catalog)):

```json
{ "setName": "New Set Name", "code": "XYZ", "lorcastId": "14", "releaseDate": "2026-08-01",
  "cardexGroup": "Booster Sets",
  "needsReview": false, "source": "manual" }
```

- `setName` MUST exactly match the `setName` field on the catalog's Firestore card docs.
  Verify via the Admin Catalog page (`/admin` → Lorcana → pick the set from the picker), or
  `GET /api/sets?game=lorcana` for the full list of names the app currently knows about.
- `lorcastId` is the lorcast numeric set ID — check via `api.lorcast.com/v0/sets`.
- `cardexGroup` must be one of the labels in `groupOrder` for the Cardex set picker to show it
  (`"Booster Sets"`, `"Special Sets"`, or `"Promos & Other"` today).
- `source: "manual"` sets created via Admin Catalog's "New Set" form don't exist on lorcast at
  all — `getLorcanaSets()` (`lib/api/lorcana.ts`) specifically merges these in since the live
  lorcast `/sets` call would otherwise never include them (see [§5](#admin-catalog-page--architecture-caching--diagnostics)).

`lib/api/lorcana.ts` and `components/pages/CardexPage.tsx` both read this at runtime via `lib/api/registry.ts` —
no code changes needed once the entry is added.

---

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

### TCGplayer-only promo sets (Worlds bundles etc.)

Some real Riftbound products never appear on Riot's gallery, so the gallery scrape can't create
them. A registry set with `tcgplayerOnly: true` + `tcgcsvGroupId` is instead built straight from
that TCGplayer group by `fetchTcgplayerOnlyRiftboundSets()` (`catalog-sync.mjs`) on every sync:
one card per TCGplayer product (sealed products and "(Oversized)" display cards skipped), id
`{setCode}-{productId}`, rarity `"Event Promo"`, name = TCGplayer's base name plus the
distinguishing part of its parentheticals (e.g. "Galio, Indefatigable (Signature Edition Bundle,
Serial Numbered)"), price = market price only (no lowest-listing fallback), image = TCGplayer's
`_in_1000x1000` photo — borrowed from the sibling with the same collector code when TCGplayer has
none (the serial-numbered copies), else the ORIGINAL card's gallery art (a Metal card's code
"247/298" is Origins #247's). These groups are kept out of the gallery price merge, and the CSV is
parsed as a whole (`parseCSVText`) since some descriptions contain line breaks. Optional registry
fields: `tcgplayerNameFilter` (only products whose name contains it), `tcgplayerProductIds` (only
exactly these products — a hand-picked set) and `tcgplayerRarity` (instead of "Event Promo"). Parentheticals that just repeat the set name ("(Metal)") are dropped.
Current: in `"Promos"`, **T1 Worlds Champion 2025** (`T1`, group 24861 — 5 cards ×
Player Bundle / Signature Edition / Serial Numbered), **Worlds Bundle 2025** (`RWB`, group 24502 —
4 foil promos); in `"Special"`, **Metal Cards** (`MTL`, group 24528 filtered to "(Metal)", rarity
"Metal" — 86: Best Of foil + Prize Wall non-foil printings) and **Nexus Night Grails** (`NXG`,
group 24528 picked by productId — the Nexus Night chase cards: GG EZ Teemo 197b/298, Lee Sin,
Centered 151b/298, Mel, Newly Awakened 069b/166) and **Regional Promos** (`RGP`, picked by
productId — Boneshiver 118a/221 Regional Qualifier, Poppy alt art 178a/219 Unleashed Regionals).

**New TCGplayer products are found and placed automatically (2026-11-02)** —
`discoverRiftboundProducts()` (`catalog-sync.mjs`) runs every Riftbound sync. It reads TCGplayer's
whole group list and skips the main sets' groups and any group a `tcgplayerOnly` set takes whole.
- **Promo "pool" groups** (already referenced by a set, or named promo / organized play / judge /
  prize): every numbered product nothing covers yet is placed into the main set its collector-number
  denominator belongs to (`052/298` → Origins, learned from the gallery's publicCodes), as
  rarity "Promo", named `Base (parentheticals)` or `Base (Promo)`. Tokens / unparseable numbers are
  recorded but left out.
- **Any other new group** with fewer than 60 numbered cards (a bundle) becomes a new
  `tcgplayerOnly` set in "Promos", `needsReview`, `source: 'auto-detected'`. Bigger groups are main
  sets the gallery will create; sealed-only groups are rechecked next sync.
- Saved to `registry/main` as `riftbound.placements` (`RiftboundPlacement`: productId, groupId,
  setName|null, auto, reviewed) and new `riftbound.sets` — written by the sync module itself, so
  `sync.ts` reads the registry *after* `downloadRiftbound()`. Placed cards' id is
  `tcg-{productId}` whatever set they're in; left-out ones are passed to `hideIds`.
- **Staff review:** Needs Review → "New Riftbound cards from TCGplayer"
  (`components/admin/PlacementsReview.tsx`): move a card to any set, leave it out, start a new set,
  or approve. `POST /api/set-registry/placements` saves it and moves the catalog card at once
  (+ `regenerateSnapshot`). Dry run: `discoverRiftboundProducts(registry, gallery, undefined, { save: false })`.
- **Review is per sync:** Needs Review lists one node per sync that found cards (placements
  sharing `addedAt`); opening one shows its board. Each card: **Accept** (reviewed), **Ignore**
  (`ignored`: hidden; the next sync's discovery offers it again with a new `addedAt`, i.e. in that
  sync's node, and `syncToFirestore({ unhideIds })` shows it again despite the staff-edit
  protection), or **Deny**.
- **Picture choice:** a placement's `image` ('tcgplayer' | 'riot' | 'none'; unset = TCGplayer's
  photo, else the same card's gallery art) — `placementCard()` sets `keepImage` so no fallback
  overrides it. The placements route applies edits to the catalog card directly and only drops
  its server's catalog cache (no snapshot rebuild — every other server picks the change up via
  the `updatedAt` delta pull); the board applies each change locally first (`applyLocal`).
- **Deny / recover / rename:** a placement can be `denied` (hidden; it stays in `placements`, so
  discovery never offers it again) and recovered into `previousSetName` or any set. `displayName`
  is the name the website shows (`placementCard()` applies it every sync; default =
  `placementDefaultName()`). A placement with no set that's already reviewed (old "Leave out")
  counts as denied; an unreviewed one is "Couldn't place".
- First run placed 172 backlog products (Organized Play, Promotional Cards, Judge groups).

**Images:** `tcgPhoto(row)` — TCGplayer's CSV links a thumbnail even for products with
`imageCount` 0 (403 forever); those now get `''`, and every TCGplayer photo is saved full size.
Riot's gallery art beats TCGplayer's photo for runes the gallery lists; Signature stubs without a
photo use the base card's art; photoless placed promos use the same card's gallery art. Anything
still without art shows the app-wide "No Image" card (`NO_CARD_IMAGE` in `lib/cardImage.ts`,
swapped in by ClientWrapper's image error listener for card-CDN images, and used by Cardex tiles).

**Extra products placed in a main set:** a main set's registry entry can list
`extraTcgplayerProducts: [{ groupId, productIds, nameSuffix }]` — TCGplayer products filed under
another group that really belong to that set (`placedExtraCard()`: id `{set}-{extNumber}`, rarity
"Promo", photo → the set's own alt-art copy of the same card when TCGplayer has none). Used for
the **Nexus Night Runes** (only in Nexus Night packs), named "X Rune (Nexus Night)": Origins
`007b/298`-style ("b" of the alt rune), Spiritforged `R01c`–`R06c` (that set's "b" was already a
different promo rune), Vendetta `R01b`–`R06b`. Not in Nexus Night Grails on purpose. "Special" is the Riftbound Cardex's
trailing area: `buildGroups()` puts the inventory-only bucket (now "Other Special Cards", formerly
"Metal & Special") into a registry group of that label when one exists, instead of a second one. To add another set: add a registry entry like those and sync.

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

---

## One Piece — Data Source, Schema, Add-a-Set Guide

The fourth game (added after Pokémon/Lorcana/Riftbound). Architecturally it's a hybrid of the
other three: card data comes from a GitHub-hosted JSON dataset like Pokémon's, but — like
Riftbound — there's no live external "sets" API, so the registry itself is the authoritative set
list. Price-matching, though, needs **none** of Riftbound's per-set TCGPlayer group-ID bootstrap
or fuzzy name-matching — see below for why. Cardex integration works like Pokémon's: sets are
grouped automatically (by set-code prefix here, not a `series` field), no per-set registry
curation.

### Data Sources — TCGplayer primary, apitcg secondary (2026-11-08)

**Every One Piece card is one TCGplayer product** (tcgcsv category 68), plus its finish for the 20
products TCGplayer prices as both Normal and Foil. The link is saved on the card — `tcgProductId`
(+ `tcgSubType`) — set once, never re-guessed. **apitcg** (`github.com/apitcg/one-piece-tcg-data`)
supplies names, rarities and set names for its cards, and the version descriptions the secondary
check compares against. All of it: `scripts/lib/onepiece-tcgplayer.mjs` (pure; tests `npm run
test:onepiece-source`); `downloadOnePiece()` / `planOnePieceCatalog()` fetch and write.

Why: apitcg stops at OP12 / EB02 / ST28 (3,048 versions) while TCGplayer has ~7,100 products
(OP13–OP18, EB03–05, ST29–36, every regional / tournament / event promo, starter-deck reprints, SP…)
— collectors couldn't find those. And the old sync gave apitcg's versions a price + photo **by
position** (a code's base/_p1/_p2… against its products in productId order), which showed the wrong
version on ~1 in 9 cards (EB01-006_p3, the Treasure Cup Chopper, showed the $3,000 PRB-01 Manga;
starter-deck reprints were priced as the original; Uta FILM RED as the plain Uta).

**The promise: no card already in the catalog changes anything a collector sees** — not its id,
name, set, number, rarity or photo. Each existing card keeps the product its photo shows (that's
how collectors logged it); only its price refreshes, from that product. When TCGplayer has no price
right now, the card keeps its last one. One exception: a card made before TCGplayer photographed
its product (`imageUrl` '' — OP18 before its Nov 20 release) gets the photo once there is one; an
existing photo is never replaced. Photos TCGplayer hasn't taken (OP16's 75 Release Event Cards on
2026-11-08) stay "No Image" — Bandai's official images (en.onepiece-cardgame.com, usable only through
a proxy — CORP) exist for released base cards but not for event versions, and a base card's art isn't
shown for a promo it might not match. Verified with `npm run onepiece-source-report` (exits 2 if
any existing card would change visibly) and `node scripts/check-collection.mjs --all`.

- **New cards** — every TCGplayer product (+ finish) that isn't a card yet becomes `tcg-{productId}`
  (`tcg-{productId}-foil` for a second finish). A product in its own product's group (a booster,
  starter deck, deck set) joins the set that group's cards are already in (else the group's name,
  cleaned: "ST-29: Starter Deck 29 Egghead" → "Egghead", "Extra Booster: X" → "X"). Products in
  TCGplayer's promo buckets (`PROMO_POOL`: Promotion Cards, Release Event / Pre-Release Cards,
  Anniversary Tournament Cards, Demo Deck, Revision Pack, Collection Sets) go through Needs Review,
  placed in the event their name says ("(Winner Pack 2025 Vol. 1)" → that set; a "[Winner]" placing
  isn't an event).
- **New apitcg versions** (apitcg catching up) are linked by description (`linkApitcgVersions()`:
  its `set.name` against the product's qualifiers + group name; a set's own versions in rarity order
  — Parallel/Alternate Art, Manga, SP…) — and only added if that product isn't a card already.
- **Secondary check** — the report lists apitcg versions whose description names a different product
  than the one the card shows (211 on 2026-11-08). Nothing changes them: which version a collector
  holds can't be told from here.
- **Safety** — >10% of TCGplayer groups failing aborts; a failed group's cards are left as they are.
- **Needs Review** is stored in `registry/onepiece-review` (like Pokémon's — see the Pokémon promo
  review); the first run accepted the existing backlog (`baseline`).

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
  is a plain `id -> marketPrice` lookup, no `isFoil` branching at all.
- **`AddCardDialog`'s Foil toggle is hidden for One Piece** (`form.game !== 'onepiece'` guard) —
  selecting a Parallel print from the search dropdown (labeled e.g. `"Shanks (Parallel)"`, or
  `"Shanks (Parallel 2)"` for a rarer 2nd/3rd art) is how a Parallel gets added, not a checkbox.
- **Cardex ownership fallback** (no `apiId`, i.e. a manually-typed card) matches by
  `set === setName && number === number`, same shape as Lorcana's — safe for the same reason it's
  safe for Lorcana but not Riftbound: a catalog number here never has more than one *base* variant
  sharing it (the base/Parallel split lives entirely in separate `id`s, not in `number`).

**Prices per version** come from each card's own TCGplayer product (`tcgProductId`) — see Data
Sources above. (Before 2026-11-08 they were paired by position, which was wrong on ~1 in 9 cards.)

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

---

## Magic: The Gathering — Data Source, Schema, Add-a-Set Guide

The 5th game. Architecturally closest to Pokémon: a live external "sets" API means no registry
`cardexGroup` curation is needed (see quirk #9), and no per-set price-matching bootstrap the way
Riftbound needs — but unlike every other game here, its bulk data source returns **prices and
images directly on the card object itself**, so there's no separate TCGCSV/lorcast-style
price-merge pass at all; one bulk-data fetch is the whole sync.

**Read `docs/games.md` (Magic section) at the repo root before touching anything MTG-related** — it has the
full story on why the first real sync hasn't been run yet (Firestore write-quota risk) and the
exact steps to turn it on. Short version: the code below is fully built and wired everywhere
every other game is, but `app/api/cron/sync-prices/route.ts` (the twice a day automatic price refresh)
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

### Daily price sync (2026-11-08)

Magic syncs once a day in its own GitHub Actions job, `.github/workflows/sync-mtg.yml` (09:00 UTC),
running `npm run download-cards -- --only mtg` — not in the twice a day sync-prices cron: a full run takes
~4.5 minutes (Scryfall's ~77MB bulk file + comparing ~102k cards), too close to the website's
5-minute limit. Needs the ADMIN_EMAIL / ADMIN_PASSWORD repository secrets. Cost estimate: ~102k
Firestore reads + ~40–70k writes a day ≈ $3–6/month. Before it, prices only updated when someone
clicked Sync (on 2026-11-08 they were 10 days old: 68,811 of 101,518 cards had moved).
`node scripts/mtg-source-report.mjs` shows what a run would write, read-only. Command-line syncs
record their result on `sync_status/{game}` (`recordCliSyncStatus()`), so a failed night shows on
the staff portal's Sync panel.

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

## Yu-Gi-Oh! — Data Source, Schema, Add-a-Set Guide

Added 2026-11-10, the sixth game, following `docs/adding-a-game.md`. Owner's scope: **English TCG
singles**; Speed Duel, Rush Duel, sealed product and non-English prints left out; Japanese / OCG
later as its own catalog if wanted.

**Japanese / OCG — on hold (owner, 2026-11-10).** Unlike Japanese Pokémon (tcgcsv 85), TCGplayer
sells no Japanese Yu-Gi-Oh! (0 `-JP` numbers in category 2), and no free, permitted feed has OCG
prices. A card list is possible from Yugipedia-derived community data (YGOJSON, yaml-yugi); prices
would mean scraping a Japanese shop (Yuyu-tei, bigweb — terms risk) or a paid API (Japanese
coverage unconfirmed). If picked up: model it on `catalog/pokemon-jp` (`catalogKeyFor()`, `language: 'ja'`).

### Data Source — TCGplayer only (YGOPRODeck as the check)

**TCGplayer (tcgcsv category 2) is the whole source** — every English single is one TCGplayer product
= one catalog card, id **`tcg-{productId}`** (set once, never changes). Each set (TCGplayer group) is
one `ProductsAndPrices.csv` download. Pure logic: `scripts/lib/yugioh-tcgplayer.mjs` (tests: `npm
run test:yugioh-source`); fetch + write: `planYugiohCatalog()` / `downloadYugioh()` in
`catalog-sync.mjs`.

**YGOPRODeck** (`db.ygoprodeck.com/api/v7/cardinfo.php`, free) is the independent check:
`npm run yugioh-source-report` compares every English set code it lists against the catalog (97.9%
present on 2026-11-10 — the rest are European-only printings, e.g. `MRD-E098`, that TCGplayer doesn't
sell, or printings TCGplayer files under another number, e.g. War of the Giants Reinforcements as
`BPW2-…`), checks every card's fields, price coverage and outliers, and prints a seeded 50-card
sample with TCGplayer links for a hand check. It exits 1 on duplicates, missing fields, or an
existing card that would change what collectors see.

What's in (2026-11-10): **44,600 cards in 588 sets**; 26 Speed Duel / Rush Duel sets, 1,313 sealed
products and 51 non-English prints left out; 97.6% priced.

### Catalog Schema (`catalog/yugioh/cards/{id}`)

```jsonc
{
  "id": "tcg-731471",
  "name": "Blue-Eyes White Dragon, the White Phantom Beast",  // as printed
  "variant": "Starlight Rare",     // TCGplayer's bracketed version, when the product has one
  "number": "MAMS-EN001",          // the printed set code + number, exactly as TCGplayer has it
  "set": "MAMS",                   // the code before the dash
  "setName": "Magnificent Maestros",
  "rarity": "Starlight Rare",
  "cardType": "Effect Monster", "attribute": "LIGHT",
  "imageUrl": "https://tcgplayer-cdn.tcgplayer.com/product/731471_200w.jpg",
  "tcgProductId": 731471, "tcgGroupId": 24808,
  "variantPrices": { "1st:normal": 900 },   // edition → price
  "marketPrice": 900, "lowPriceNM": 850     // the default edition's (Unlimited when priced, else 1st, else Limited)
}
```

### Variants — two different things

- **Rarity versions are separate cards.** TCGplayer sells `MAMS-EN001` as the plain Ultra Rare, an
  Extended Art, a Starlight Rare and a GMR — four products sharing one printed number. Each is its own
  card; the name stays as printed and the version goes in `variant`. Search, Add Card and the Cardex
  show it after the name — "Blue-Eyes … (Starlight Rare)" (`yugiohDisplayName()` in
  `lib/api/yugioh.ts`; `/api/cardex` does the same).
- **Editions are printings of one card** — 1st Edition / Unlimited / Limited, each priced, in
  `variantPrices` (`"1st:normal"`, `"unlimited:normal"`, `"limited:normal"` — Pokémon's scheme,
  `pokemon-variants.mjs`, which gained the `limited` edition). Yu-Gi-Oh! has no foil toggle (foil is
  the rarity). Add Card's Edition picker, the scanner's Finish row and the review screen offer them;
  `lib/pricing.ts` prices the edition logged. `PRINTING_GAMES` / `hasPrintings()` in `lib/types.ts`
  is where a game opts into printings.

### Rules that keep logged cards safe

An existing card never changes what it shows — name, number, set, rarity, version, photo stay as
collectors logged them (a card saved before TCGplayer photographed it gets the photo once). Only
prices refresh; an edition with no price today keeps its last one. Never deleted — a product that
vanishes is just no longer updated.

### Sets and the Cardex

The set list is written by the sync to `catalog_meta/yugioh.sets` (newest first) and read by
`getYugiohSets()` → `/api/sets?game=yugioh`. TCGplayer has no set type, so `setTypeOf()` reads it
from the set's name into six Cardex groups: **Booster Sets, Structure Decks, Starter & Theme Decks,
Tins & Mega Packs, Collections & Special Sets, Promos & Prizes** (`SET_TYPE_LABELS`). Custom sets
made with Admin Catalog's "New Set" live in the registry (`registry/main` `yugioh.sets`, like
Magic's). Within a set, cards sort by number ("MAMS-EN001" numerically) then rarity
(`CARDEX_RARITY_ORDER`).

### Syncing

Its own daily job — **`.github/workflows/sync-yugioh.yml`, 21:30 UTC** (after tcgcsv publishes and
after the 21:00 sync-prices run) — running `npm run download-cards -- --only yugioh`; ~660 per-set
downloads are too long for the twice-daily web sync. `lib/api/priceStatus.ts` treats it like Magic
(own schedule). The staff portal's Sync button calls `app/api/sync/yugioh` (may time out — the CLI
is the reliable path). New sets need no code change: they appear in TCGplayer's groups and sync in.

### Scanner

The set code is printed **under the artwork, on the right** — not along the bottom — so
`readClues()` looks for it anywhere (`ygoCodes`, O read as 0). The name is along the top
(`NAME_ON_TOP`); "ATK/", "DEF/", "[Spell Card]" mark a Yu-Gi-Oh! card (`gameHints`); attribute words
("DARK", "LIGHT") aren't names (`NOT_A_NAME`). Rarity versions share a code and tie on text — the
picture or the person picks. Not used yet: the 8-digit passcode bottom-left (the card's id across
printings — not in TCGplayer's data; YGOPRODeck has it) and TCGplayer's card text (`extDescription`).

### Gotchas

- **TCGplayer sometimes types a letter O for a zero** in a number ("LAVD-ENO09" — 51 cards). Kept as
  TCGplayer has it; search and the scanner compare with O as 0 (`ygoKey()`).
- `GAME_TAB_LABELS` / `GAME_LABELS`: "Yu-Gi-Oh!"; colour `#5b4a8a`.

---

## TCGplayer-sourced games — Star Wars: Unlimited, Gundam, Flesh and Blood, Digimon, Palworld, Cyberpunk

Added 2026-11-10 (owner: "Star Wars Unlimited… Gundam, flesh and blood, Digimon, Palworld"; then
"add cyberpunk in there as well").
Unlike the earlier games, none has a free card database of its own, so **TCGplayer (tcgcsv) is the
whole source** — and since the six share that shape, they share **one engine with a settings block
per game**: `scripts/lib/tcgplayer-games.mjs` (`TCGPLAYER_GAMES`; tests: `npm run
test:tcgplayer-games`; checks: `npm run tcgplayer-games-report -- [--only fab] [--sample 30]`).
Yu-Gi-Oh! has the same shape but its own module (it came first and has extras — YGOPRODeck check,
Speed Duel exclusion); new TCGplayer-only games should be added to `TCGPLAYER_GAMES`, not copied.

| id | Game | tcgcsv | Cards (2026-11-10) | Prices |
|---|---|---|---|---|
| `swu` | Star Wars: Unlimited | 79 | 9,771 in 33 sets | Normal / Foil |
| `gundam` | Gundam | 86 | 2,201 in 27 sets | Normal / Foil (TCGplayer: Holofoil) |
| `fab` | Flesh and Blood | 62 | 10,955 in 110 sets | **printings**: 1st Edition / Unlimited × Normal / Rainbow Foil / Cold Foil |
| `digimon` | Digimon | 63 | 9,516 in 103 sets | Normal / Foil |
| `palworld` | Palworld | 91 | 647 in 7 sets | Normal / Foil |
| `cyberpunk` | Cyberpunk | 92 | 504 in 14 sets | Normal / Foil — the Kickstarter **Beta** and shop **Retail** printings are separate TCGplayer sets, so separate cards (Beta numbers start with B: "B098") |

### The rules (all six)

- **One TCGplayer product = one card**, id `tcg-{productId}`, set once. Versions TCGplayer sells as
  their own product — SWU Hyperspace / Showcase / Prestige / prize copies, Gundam parallels (LR+, R+),
  Digimon alternate arts, Flesh and Blood Marvels / Extended Arts, Palworld SR / SP / 2nd Edition —
  are their own cards, the bracketed version in `variant`, shown after the name everywhere.
- **A single** = a product with a printed number **or** a rarity (catches numberless promos — SWU's
  Secrets of Power weekly promos, Palworld's "Soul (SSS)"); sealed product has neither.
- **Brackets that are part of the name stay in it** (`keepInName` / `variantOnly`): Flesh and Blood
  pitch "(Red)/(Yellow)/(Blue)", Digimon "(X Antibody)", Gundam mobile-suit forms ("(Destroy Mode)",
  "(EW)", factions). TCGplayer's habit of appending the card number ("Graphene Chelicera - GEM008")
  is dropped when it is the card's own number (`dropNumberSuffix`); 16 FaB promos whose suffix
  differs from their number keep TCGplayer's name.
- **Numbers**: as printed; Digimon's glued-on rarity letter is dropped ("BT26-066 C" → "BT26-066").
  **Set code**: TCGplayer's abbreviation, else the number's prefix ("SFC001" → SFC — newer FaB sets
  have none), else the set name (`setCodeOf`).
- **Photos**: a product TCGplayer hasn't photographed (`imageCount` 0) is stored with no image (the
  site's No Image card) and picks the photo up on a later sync.
- **Existing cards never change what they show**; only prices refresh, and a price TCGplayer lacks
  today keeps its last value (`mergePrices`).
- **Prices**: the four Normal/Foil games use the classic pair (`marketPrice` / `marketPriceFoil`) and
  the Foil checkbox like Lorcana — most foil versions are separate products with only a foil price
  (search shows one foil row). **Flesh and Blood** uses printings (`variantPrices`, Pokémon's
  scheme, `PRINTING_GAMES`): "1st:rainbow", "unlimited:cold"…; newer sets without editions are
  "unlimited". Finishes `rainbow` / `cold` were added to `pokemon-variants.mjs` (labels Rainbow Foil /
  Cold Foil; tags in `PrintingTags`).
- **Sets**: `catalog_meta/{game}.sets` written by the sync, each with a `setType` from its name →
  the Cardex groups (`setTypeLabels`). Custom sets ("New Set") in the registry like Magic's.

### App wiring

`lib/types.ts` `TCGPLAYER_SOURCED_GAMES` / `isTcgplayerSourced()`; `lib/api/tcgplayerGames.ts`
(sets, search, display name); `lib/api/tcgplayerGameRoutes.ts` (shared price + sync handlers behind
`app/api/prices/{game}` and `app/api/sync/{game}`); the Cardex's `META_SET_GAMES` (Yu-Gi-Oh! + these)
build groups from set types. Colours: SWU `#2f4f6f`, Gundam `#b0283c`, FaB `#7a5a2b`, Digimon
`#e07b1a`, Palworld `#2a9d8f`, Cyberpunk `#b03a7a`.

### Syncing

One daily job, **`.github/workflows/sync-tcgplayer-games.yml` at 21:45 UTC**
(`npm run download-cards -- --only swu,gundam,fab,digimon,palworld,cyberpunk`); each game also has a staff
portal Sync button (FaB and Digimon, ~110 sets each, may outrun the function limit — the CLI is the
reliable path). A sync refuses a partial download (fewer sets than `minGroups`, or >10% of sets
failing). New sets need no code change.

### Scanner

Gundam "GD01-118", Digimon "BT26-066" / starter "ST1-01", Palworld "EBP01-001" (an "…SP" version is
found by its base code) are read anywhere on the card; Flesh and Blood "WTR040" (either side of a
double-sided number); Star Wars: Unlimited needs the set code and number together ("LAW" +
"017/264"); Cyberpunk by name (its bare numbers are in every set). Versions sharing a code tie — the picture or the person picks. No picture-model
training on these games yet.

### Known TCGplayer data quirks (2026-11-10)

- Unreleased sets are listed before release with no prices (SWU Icons 2027 Edition, FaB Outbreak,
  Digimon Ignition of X); old FaB Blitz / Hero decks are thinly priced; Palworld's "(2nd Edition)"
  reprints were just listed and unpriced.
- A few market prices look high for the card (Gundam "Wing Gundam (LR+)" $9,999, "Char Aznable
  (C+)" $2,300) — TCGplayer's own market price, used as-is like every game.
