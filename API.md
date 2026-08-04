# TCGHaven — API & Data Reference

How card catalogs are downloaded and how prices are fetched for each game.

---

## Card Catalog (Search & Display)

All card names, images, set info, and collector numbers are **pre-downloaded as static JSON** and
stored in `public/data/`. The download script fetches everything at build time — no external API
calls happen during a user search.

```
public/data/
  pokemon-cards.json      ~20,000+ cards
  lorcana-cards.json      ~2,700+ cards
  riftbound-cards.json    ~950+ cards
```

To refresh catalogs:
```bash
npm run download-cards
npm run build
PORT=3456 npm run start
```

---

## Pokémon

### Catalog Download

**Source:** `github.com/PokemonTCG/pokemon-tcg-data` (official SDK data repo)

- Set list: `https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master/sets/en.json`
- Card files: `https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master/cards/en/{setId}.json`
- No API key required for the GitHub raw CDN. No rate limiting.
- Script downloads all set files in parallel and merges them.

### Catalog Schema

```json
{
  "id": "sv7-1",
  "name": "Pikachu",
  "set": "sv7",
  "setName": "Stellar Crown",
  "number": "1",
  "imageUrl": "https://images.pokemontcg.io/sv7/1_hires.png"
}
```

Pokémon catalog cards do **not** include prices — prices are fetched live on demand.

### Live Price Fetch (Portfolio Refresh)

**Source:** `https://api.pokemontcg.io/v2/cards/{id}`

**When:** On Portfolio page load and on "Refresh Prices" click.

**API Key:** Set `POKEMON_TCG_API_KEY` in `.env.local` for higher rate limits
(5,000/day with key vs 250/day without). Key is server-only — never NEXT_PUBLIC_.

**Flow:**
```
PortfolioPage → refreshPrices()
  → getPokemonCardPrice(apiId, isFoil)   [lib/api/pokemon.ts]
  → fetch api.pokemontcg.io/v2/cards/{id}  (server-side, avoids CORS)
  → reads tcgplayer.prices.holofoil / normal market prices
  → updates card.currentPrice in Firestore + Zustand
  → appends price history point (arrayUnion, atomic)
```

**Foil logic:**
- `isFoil=true` → `holofoil.market` → `reverseHolofoil.market`
- `isFoil=false` → `normal.market` → `holofoil.market`

---

## Lorcana

### Catalog Download

**Source:** `https://api.lorcast.com/v0` (community-maintained)

Two-phase download (both required):

**Phase 1 — text searches** (catches all common/uncommon/rare/SR/legendary cards):
```
GET /v0/cards/search?q=a&page_size=500
GET /v0/cards/search?q=e&page_size=500
... (vowels: a, e, i, o, u, y, th)
```

**Phase 2 — rarity searches** (REQUIRED — Enchanted, Epic, and Iconic cards do NOT appear in text searches):
```
GET /v0/cards/search?q=rarity:enchanted&page_size=500
GET /v0/cards/search?q=rarity:epic&page_size=500
GET /v0/cards/search?q=rarity:iconic&page_size=500
GET /v0/cards/search?q=rarity:mythic&page_size=500
GET /v0/cards/search?q=rarity:special&page_size=500
```

A `seen` Map deduplicates by card ID across both phases.

### Catalog Schema

```json
{
  "id": "5-100",
  "name": "Mickey Mouse - Bob Cratchit",
  "set": "SSK",
  "setName": "Shimmering Skies",
  "number": "100",
  "rarity": "Super_rare",
  "imageUrl": "https://cards.lorcast.io/...",
  "marketPrice": 12.50,
  "marketPriceFoil": 45.00
}
```

**Name format:** `"{name} - {version}"` combined. Split on ` - ` to get the two parts.

**Images:** AVIF format from `cards.lorcast.io`. Requires Safari 16+, Chrome 85+, Firefox 93+.

**Prices:** Embedded at download time. `marketPrice` = non-foil, `marketPriceFoil` = foil/cold foil.
Enchanted/Epic cards have `marketPrice: 0` (foil-only) — their price is in `marketPriceFoil`.

### Live Price Fetch (Portfolio Refresh)

**Route:** `POST /api/prices/lorcana`  
**Source:** `https://api.lorcast.com/v0/cards/{apiId}`

**Request body:**
```json
{
  "cards": [
    { "id": "firestore-doc-id", "apiId": "5-100", "isFoil": false }
  ]
}
```

**Response:**
```json
{ "firestore-doc-id": 12.50 }
```

**Flow:**
```
PortfolioPage → refreshPrices()
  → POST /api/prices/lorcana  (server-side proxy, avoids CORS)
  → fetch lorcast /v0/cards/{apiId} for each lorcana card (parallel)
  → reads prices.usd / prices.usd_foil
  → returns { [firestoreId]: price }
  → updates Firestore + Zustand + price history
```

### Set List

Sets are fetched live from `https://api.lorcast.com/v0/sets`.
`LORCANA_SETS_FALLBACK` in `lib/api/lorcana.ts` is the offline fallback.

---

## Riftbound

### Catalog Download

**Card data source:** `playriftbound.com/en-us/card-gallery/` (official Riot Games site)
- Page is a Next.js SSR app with all card data in `<script id="__NEXT_DATA__">` JSON
- Script fetches the HTML and parses the JSON blob — no official API needed
- Automatically includes all sets and variants

**Price data source:** `tcgcsv.com/tcgplayer/89/{groupId}/ProductsAndPrices.csv`
- TCGPlayer category 89 = Riftbound
- Each set has a numeric group ID (hardcoded in download script)

### TCGCSV Group IDs

| Set Code | Set Name       | Group ID |
|----------|---------------|---------|
| OGN      | Origins        | 24344   |
| SFD      | Spiritforged   | 24519   |
| UNL      | Unleashed      | 24560   |
| OGS      | Proving Grounds| 24439   |
| VEN      | Vendetta       | TBD     |
| RAD      | Radiance       | TBD     |

Find new group IDs at: `https://tcgcsv.com/tcgplayer/89/`

### Catalog Schema

```json
{
  "id": "origins-001-regular",
  "name": "Ahri - Alluring",
  "number": "1",
  "publicCode": "OGN-001/298",
  "setCode": "OGN",
  "setName": "Origins",
  "rarity": "Common",
  "cardType": "Unit",
  "tags": ["Ahri"],
  "imageUrl": "https://cmsassets.rgpub.io/...",
  "marketPrice": 1.25,
  "marketPriceFoil": 0
}
```

**Variant types:**

| Variant   | Rarity    | id suffix  | publicCode example |
|-----------|-----------|------------|--------------------|
| Base      | Common/Uncommon/Rare/Epic | `-regular` | `OGN-001/298` |
| Showcase (same #) | Showcase | `-altart-` | `OGN-007a/298` |
| Showcase (overnumber) | Showcase | `-showcase-` | `OGN-227/221` |
| Signature | Star      | `-star-`   | `OGN-227*/221` |

Showcase/Star cards have no non-foil listing — `marketPrice` holds the foil price.

### Price Matching (catalogKey system)

Prices from TCGCSV are matched to catalog cards using a key system:

```
"OGN:7:regular"   → base Ahri card
"OGN:7:altart"    → Showcase (same number, "a" suffix)
"OGN:227:over"    → Showcase (overnumber)
"OGN:227:star"    → Signature
```

This prevents collector-number collisions between variant types.

### Live Price Fetch (Portfolio Refresh)

**Route:** `POST /api/prices/riftbound`  
**Source:** `tcgcsv.com/tcgplayer/89/{groupId}/ProductsAndPrices.csv`

**Request body:**
```json
{
  "cards": [
    { "id": "firestore-doc-id", "apiId": "origins-001-regular", "setCode": "OGN", "isFoil": false }
  ]
}
```

**Response:**
```json
{ "firestore-doc-id": 1.25 }
```

**Flow:**
```
PortfolioPage → refreshPrices()
  → POST /api/prices/riftbound  (server-side proxy)
  → load riftbound-cards.json catalog to look up full card data by apiId
  → determine which TCGCSV groups are needed (by setCode)
  → fetch CSV for each set in parallel
  → parse CSV, build price map keyed by catalogKey()
  → match each requested card to its price entry
  → returns { [firestoreId]: price }
  → updates Firestore + Zustand + price history
```

---

## Card Search Flow

```
User types in AddCardDialog search box
  → debounced 350ms
  → GET /api/cards/search?game={game}&q={query}   [server-side]
  → searchCards(game, query)   [lib/api/search.ts]
  → reads static JSON catalog via readFileSync (cached in module memory)
  → scoreMatch() ranks results by word-prefix matching
  → returns top 20 results as JSON
  → dropdown shows name, image, set, price
```

**Why server-side?** Pokémon TCG API blocks browser CORS. All three games go through
`/api/cards/search` to avoid CORS entirely.

**scoreMatch algorithm:** Splits name and query into word tokens. Each query word must
match the START of at least one name token (no mid-word matches). Scores: exact=30, prefix=15,
first-word bonus=10.

---

## Price History

Every time a card price is updated (portfolio refresh OR new card added), a price history
point is appended to Firestore using `arrayUnion` (atomic, no race conditions):

```
users/{uid}/priceHistory/{cardId}
  → { cardId: "...", points: [{ date: "ISO", price: 12.50 }, ...] }
```

Price history is used for the 1D / 7D / 30D P&L windows in Portfolio.

---

## Refresh Cadence

| Trigger | Behavior |
|---------|----------|
| Portfolio page load | Auto-refresh, max once every 5 minutes |
| "Refresh Prices" button | Always refreshes, no cooldown |
| New card added | Writes first price history point using catalog price |
| Inventory page load | Backfills `currentPrice` for cards missing it (parallel) |
| `npm run download-cards` | Re-downloads all catalogs; requires rebuild to take effect |

---

## Environment Variables

| Variable | Purpose | Required |
|----------|---------|---------|
| `POKEMON_TCG_API_KEY` | Server-only. Raises rate limit to 5,000/day (vs 250 without) | No |
| `NEXT_PUBLIC_FIREBASE_*` | Firebase project config (client-safe) | Yes |

**Note:** `POKEMON_TCG_API_KEY` must NOT have the `NEXT_PUBLIC_` prefix — it is server-only
and the prefix would embed the key in the client bundle.
