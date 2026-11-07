# Key quirks & gotchas (the full write-ups)

Moved out of CLAUDE.md (2026-10-30) so it's read only when needed. Section numbers (§N) refer to
the original CLAUDE.md layout.

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

### 7. (Removed) Pack Analysis
This quirk described the Pack Analysis routes, which were removed along with the whole feature
(see [§15](#pack-analysis--removed)). Numbering kept so other references to later quirks stay valid.

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

### 13. (Removed) Portfolio "+ packs" toggle
This quirk described the "+ packs" Total Invested toggle, removed along with the Spending page
(see [§16](#spending--removed)). Numbering kept so other references to later quirks stay valid.

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

### 19. Prices live only in the shared catalog; inventory is cached per device
**Prices (2026-10-08 overhaul, TCGplayer/Collectr model).** A price belongs to the card, not the
user. Nothing is ever written onto a user's cards: `components/PriceAutoUpdater.tsx` (mounted in
`ClientWrapper.tsx`, read-only) fetches live prices for the user's cards from
`app/api/prices/{game}/route.ts` (in-memory catalog lookups, zero Firestore reads) and lays them
over each card in memory (`store.applyLivePrices` / `withLivePrice` — cards without an `apiId` keep their own
stored price). It also loads each card's price at the
start of each Portfolio window (`store.priceBaselines`) and the update status. There is no manual
refresh button; Portfolio shows "Prices updated {time}" or a red "Price update failed" warning
(`lib/api/priceStatus.ts`: `catalog_meta.lastBulkSyncAt` + `sync_status`, overdue after 9h).

**No per-user prices (2026-10-26).** Add Card used to offer TCG Market Price / eBay / Manual 🔒 for
each card; that's gone — every card's price comes from the shared catalog. Old cards with
`priceLocked` are now priced from the catalog like any other (the flag is ignored and cleared on
edit); only cards with no catalog match (no `apiId`) keep their own stored price.

**One pricing rule:** `lib/pricing.ts` `catalogPrice()` (foil choice, Riftbound foil-only variants,
always TCGplayer market price — there's no price-mode toggle; the catalog's `lowPriceNM*` fields are
lowest listings in any condition, damaged included, and are never used) is used by the five price routes, the Cardex (client-side from the raw fields
`/api/cardex` returns), Personalized Collections and the history API — so they can't disagree.

**Shared price history.** Every successful sync writes that day's prices once, for everyone, to
`price_history/{game}/months/{setKey}__{YYYY-MM}` (`scripts/lib/price-history.mjs`; written by
`syncToFirestore()`, non-fatal). `/api/price-history` (signed-in users) computes answers on the
server — the browser never downloads raw history:
- `baselines` (Portfolio windows, on every app open) reads the **daily closes** —
  `price_history/{game}/days/{YYYY-MM-DD}__{n}`, every card's price for that day in one gzipped
  file per game, plus `price_history/{game}/firsts/{n}` (each card's first price), both also written
  by each sync. Four past days per game instead of 13 months of every owned set (2026-11-01: that
  pattern re-downloaded every set's months every 15 minutes per server instance, growing each
  month — at scale the biggest bill in the app, and a memory crash). Don't move baselines back
  onto month docs. `scripts/backfill-daily-prices.mjs` rebuilds both from the month docs.
- `series` (card detail chart) and `portfolio` (Analytics daily totals) read month docs, cached per
  doc: past months/days are kept for good, the current one re-read only after a new sync
  (`sync_status/{game}.lastGoodAt`, checked ≤ every 5 min). The month cache is an LRU with a byte
  budget — keep it bounded. No timer-based refresh: history only changes when a sync lands.

The "Prices updated" check every open app makes every 15 minutes reads only `sync_status/{game}`
(`lastGoodAt`, stamped by `syncToFirestore()`), never `catalog_meta` (~180KB for Pokémon: set list
and broken-image ids) except as a fallback before that stamp exists. The old per-user
`users/{uid}/priceHistory` is no longer read or written; Settings' admin "Import old price
history" copied it into the shared history (gap-fill only, never overwrites synced data).

**Inventory cache + change sync.** Every card write goes through `lib/firebase/db.ts`
(`saveCard`/`editCard`/`removeCard(s)`), which stamps `updatedAt: serverTimestamp()`; deletes also
write a tombstone at `users/{uid}/deletedCards/{cardId}` (`saveCard` clears it, for Sold → restore).
`AuthProvider.tsx`'s `loadInventory()` keeps an IndexedDB copy per device (`lib/inventoryCache.ts`)
and on open asks only for cards with `updatedAt` / tombstones with `deletedAt` newer than the
cached cursor (`loadCardChanges`) — ~2 reads on a quiet day instead of one per card. Full reload
when there's no copy, the copy's format changed (`INVENTORY_CACHE_FORMAT`), or it's >7 days old;
if the change check fails the saved copy is shown. Signing out clears the cache. **Never write to
`users/{uid}/cards` except through those db.ts functions**, or other devices' caches won't see it.

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

### 28. Never split a tcgcsv CSV on newlines — and read its columns by name
TCGplayer's rules text (`extCardText`) contains line breaks inside quoted fields. Every tcgcsv
parse used to split the file on `'\n'` first, which cut those rows apart and shifted their later
columns; for Pokémon (where card text comes *before* `extNumber`/prices) that silently dropped
~40% of all prices — most of Crown Zenith and its Galarian Gallery, Scarlet & Violet base, etc.
Every parse now goes through a whole-file parser (`parseCSVText`/`parseCsv` in
`catalog-sync.mjs`, `lib/csv.ts` for API routes) and looks columns up by header name, since the
column order differs between games and groups. Also: send tcgcsv an honest `User-Agent`
(`TCGHaven/1.0 …`) — it blocks disguised browser User-Agents with a 401 ("Please identify your
application").

Parsing correctly surfaced reprint rows One Piece's price pairing had never seen, so that pairing
changed too (`pairingRows()` in `downloadOnePiece()`): apitcg lists cards in several files
(`general.json` repeats all of EB-01), so files are processed in name order and each id kept once
(download-finish order used to flip hundreds of prices between syncs); variants pair in `_pN`
order with the base card's best plain row, the card's own set group before reprints elsewhere, and
Parallel/Alt Art → Manga → SP/Gold within it (TCGplayer sometimes creates the Manga product before
the Alt Art — OP05-119). Synthesized (TCGplayer-only) codes keep their original row order so their
ids never shift.

### 29. Catalog map fields: write with `update()`, compare with `stableStringify()`
`variantPrices` is a map field — the first one in the catalog. `syncToFirestore()` used to write
changed fields with `set(…, { merge: true })`, which deep-merges maps: a printing TCGplayer
stopped pricing would linger in the Firestore doc while the snapshot (built from the sync's own
in-memory copy) dropped it. Existing docs are now written with `update()` (replaces each written
field whole); only new docs use `set`. And Firestore hands map keys back in its own order, so the
"did this field change?" check compared `JSON.stringify` output that differed only in key order —
the second Japanese sync rewrote 1,378 unchanged cards before this was caught. The comparison now
uses `stableStringify()` (sorted keys). A repeat sync with no price changes writes nothing.

### 30. A page.tsx must wrap its lazy component, never `export default` it directly
Every page is `dynamic(() => import('@/components/pages/X'), { ssr: false })`. Exporting that
loadable directly (`export default Page`) hands it Next's page props, including `searchParams` —
and forwarding them counts as reading them, so Next renders that page on the server for **every**
request instead of serving a pre-built copy. On Vercel that meant each click into Portfolio,
Inventory or Sold waited ~0.5–1s for a server render before the page even switched, while Settings
and Cardex (already wrapped) were instant. Always `export default function Page() { return
<PageContent /> }`, and check `next build`'s route table: content pages should be ○ (static). Pages
with an id in the path (`/portfolio/[cardId]`, `/u/[username]`, …) are necessarily ƒ; `app/loading.tsx`
gives those an instant loading state. Related: Inventory draws its rows 50 at a time as you scroll
(`renderLimit`) — drawing all 900+ at once blocked the page for ~0.4s on every visit.
`npm run dev` runs with a 4GB heap (`NODE_OPTIONS=--max-old-space-size=4096`): with every game's
catalog cached in one process, the default ~2GB made Next restart the dev server ("approaching the
used memory threshold") several times a session.

### 31. Old inventory cards saved thumbnail-size images — `sharpImageUrl()` upgrades them on load
Cards added before Pokémon search went catalog-first saved pokemontcg.io's small image
(`…/swsh4/12.png`, 245px); old Lorcana cards saved lorcast's `/digital/small/`. Both looked blurry
at card size (20 of 47 Pokémon cards in one real inventory). `sharpImageUrl()` (`lib/utils.ts`)
rewrites them to the full-size copy (`…/12_hires.png`, `/digital/large/` — verified to exist for
every affected card) as cards enter the store (`withLivePrice`, sold-card loaders), so every page
gets the sharp image with no Firestore writes. Anything that saves a card image should save the
large one (`images.large ?? images.small`).


### 32. Card images are served at the size they're shown — `lib/cardImage.ts`
Card originals are 0.2–0.8MB (Riftbound 744×1039 PNG ≈ 780KB, Pokémon hi-res ≈ 845KB); a phone
opening one Cardex set downloaded ~60MB (2026-10-29 diagnostic). Every `<img>` of a card goes through
`cardImage(url, 'thumb' | 'grid' | 'full')`: thumb ≈200px (list rows), grid ≈400px (tiles — sharp at
3×), full = the clear original-size copy (the Cardex zoom view only). Riftbound: Sanity's own
`?w=&fm=webp` (779KB → 30KB at 400px); Pokémon: the free wsrv.nl proxy (845KB → 45KB), with a global
`<img>` error listener in ClientWrapper falling back to the original if it fails; Lorcana/Scryfall/
TCGplayer: each CDN's own sizes. New card image sites must use it. Also from that diagnostic:
public GET routes (`/api/sets`, `/api/set-registry`, `/api/cardex`, `/api/cards/search`) send
`s-maxage` + `stale-while-revalidate` so Vercel's CDN answers them; `verifyAdminRequest.ts` checks ID
tokens locally against Google's signing certs (REST lookup only as fallback); PriceAutoUpdater shows
the prices/baselines saved on the device (`tcghaven-prices:{uid}`) instantly and refreshes in the
background; the Cardex only fetches set lists for tracked games; the QR tools load on demand.
Cardex follow-ups: sets are cached per session and the other sets in the open group are prefetched
(`fetchCardexSet`/`cardexCache`), the loader's bar shows from the first moment; a tap opens the zoom
view at once (double-tap-to-add is now a quick second tap landing on the zoom view —
`ZoomCardData.onDoubleTap`), the full-size image is preloaded on press, and `ZoomImage` lays it
exactly over the tile's copy and fades it in (no snap or shift).

### 33. Several staff (and the syncs) share a few big docs — save a change, never a copy

`registry/main`, `badge_catalog/main` and `registry/textKeys` are each one doc that many people
and processes write. The old pattern — read the doc, edit it, `setDoc` it back — let whoever saved
last silently undo everything saved in between: two staff in Needs Review, one in Categories while
a Riftbound sync ran (the sync wrote back the copy it read minutes earlier), two badge editors. A
test with 8 saves at once kept 1 of 8 the old way, 8 of 8 with transactions (2026-11-04).

Now: **registry** — only `updateSetRegistry(change)` (lib/api/registry.ts) writes it: a Firestore
transaction that runs `change` on the latest copy and re-runs it if anyone wrote meanwhile (so
`change` must be pure — fetch first); throw `RegistryRejection` to refuse. The sync engine's own
placement saves use `savePlacementsOnLatest()` (catalog-sync.mjs), which applies only that run's
additions. **Badges / Text Keys** — `saveBadgeCatalog(db, base, next)` / `saveTextKeys(db, base,
keys)` replay just this person's edit onto the latest list (`rebaseList()` in lib/rebase.ts,
tested by `npm run test:rebase`); the badge and book editors also merge field-by-field
(`mergeEdit()`) and ask before overwriting a field someone else changed while the form was open.
Card edits were already safe — `updateDoc` with only the changed fields.

### 34. Pokémon (English): TCGplayer decides which cards exist — and a card's id never changes

Since 2026-11-06 the English catalog is built from TCGplayer (primary) with GitHub's
pokemon-tcg-data as the secondary check (`scripts/lib/pokemon-tcgplayer.mjs`, games.md Pokémon).
Cards GitHub has keep GitHub's id; everything else is `tcg-{productId}`, and a set built from
TCGplayer (`tcg-{groupId}`) stays TCGplayer's when GitHub catches up. Never "switch" a card to the
other source's id — inventory links by id. Linking needs the same *card*, not just the same number:
number-only linking had priced ordinary promos by their [Staff] copies (Charizard SM158 $1,250 vs
$121.95) and Wizards promo Pikachu #1 by a Clefable. Before changing the matching, run
`npm run pokemon-source-report` (read-only) and compare. Pokémon's Needs Review is in
`registry/pokemon-review`, not registry/main (doc size).
