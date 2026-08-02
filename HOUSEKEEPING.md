# HOUSEKEEPING — Efficiency & Tidiness Audit

Second-pass audit of every file in the app. Every change below was made, built
(`npm run build` passes with type checks + lint), and smoke-tested against the running
production server on port 3456.

---

## Bugs Fixed (correctness)

### 1. Pokémon price refresh was completely broken — `components/pages/PortfolioPage.tsx`
The Portfolio "Refresh Prices" button called `getPokemonCardPrice()` **directly from the
browser**. That fails two ways: `api.pokemontcg.io` blocks browser CORS (documented quirk
in CLAUDE.md), and the `POKEMON_TCG_API_KEY` env var is server-only, so even if CORS
allowed it the key was never sent. Result: Pokémon prices silently never updated while
Lorcana/Riftbound did.
**Fix:** created `app/api/prices/pokemon/route.ts` — a batch server-side proxy mirroring
the existing Lorcana route — and pointed the Portfolio at it. Verified live:
`POST /api/prices/pokemon {"cards":[{"id":"test1","apiId":"sv7-1","isFoil":false}]}` →
`{"test1":1.49}`.

### 2. Set autocomplete broken for Pokémon — `components/inventory/AddCardDialog.tsx`
The dialog called `getSetsForGame()` (from `lib/api/search.ts`) in the browser. That
module chain imports `fs` (webpack-shimmed to nothing client-side) and fetches
`api.pokemontcg.io` (CORS-blocked). Pokémon set lists came back empty; this is the same
class of bug as the dead cache-warming already removed from AuthProvider.
**Fix:** created `app/api/sets/route.ts` and the dialog now fetches
`/api/sets?game=...`. The import from `lib/api/search` is now type-only, so no server
code lands in the client bundle. Verified: pokemon → 173 sets, lorcana → 20 sets.

### 3. Portfolio auto-refresh fired before data loaded — `PortfolioPage.tsx`
The on-mount auto-refresh ran with an empty-deps `useEffect`. On a fresh page load,
Firestore data hasn't arrived yet, so it "refreshed" zero cards — but still stamped
`lastPriceRefresh`, burning the 5-minute cooldown on a no-op. **Fix:** the effect now
waits for `dataLoading === false` and `cards.length > 0` (via `useAuth()`), guarded by a
ref so it still only auto-runs once per visit.

### 4. Inventory price backfill had the same race — `InventoryPage.tsx`
The unpriced-card backfill effect depended only on `[user?.uid]`, so on a direct load of
`/inventory` it ran against an empty store and never retried after cards arrived.
**Fix:** gated on `dataLoading`, re-armed by `cards` changes, with a ref preventing
repeat runs once a backfill has actually executed. Also captured `uid` locally instead of
using `user!` inside the async closure.

### 5. Editing a card rewrote its creation date — `AddCardDialog.tsx`
`handleSubmit` always set `createdAt: now`, including on edits. Since `createdAt` drives
the Inventory sort and the date-filter "session" grouping, editing any card silently
moved it to today's session. **Fix:** `createdAt: editCard?.createdAt ?? now`.

### 6. Stale Firestore load could repopulate the store after sign-out — `AuthProvider.tsx`
If the user signed out (or switched accounts) while the login `Promise.all` load was
in flight, the resolved data was written into the store anyway — after `clearUserData()`.
**Fix:** the effect tracks the active uid and discards results that no longer match.

### 7. Out-of-order search responses — `AddCardDialog.tsx`, `CardexPage.tsx`
Both the debounced card search and the Cardex set fetch had no cancellation: a slow
response for an old query/set could overwrite the results of a newer one. **Fix:** both
effects now set a `stale` flag in their cleanup and ignore late responses. Both also now
check `res.ok` before parsing.

### 8. Render-time mutation of a module constant — `PackAnalysisPage.tsx`
`RiftboundView` called `sets.sort(...)` directly on the imported `RIFTBOUND_EV` array,
mutating shared module state during render. **Fix:** sorts a copy (`[...sets].sort`).
Also dropped the unnecessary `RIFTBOUND_EV as RBSet[]` cast — the types line up.

### 9. Empty API responses cached forever — `lib/api/pokemon.ts`, `lib/api/search.ts`
`getPokemonSets()` cached whatever it got, including `[]` from a transient failure, and
`search.ts`'s `setsCache` did the same — pinning an empty set list for the life of the
server process. **Fix:** both now only cache non-empty results.

### 10. Missing timeout on per-card price fetches — `lib/api/pokemon.ts`
`getPokemonCardPrice()` had no timeout, so one hung request could stall the whole batch
refresh. **Fix:** `AbortSignal.timeout(8000)`, matching the Lorcana route.

---

## Dead Code Removed

| Deleted | Why |
|---|---|
| `components/layout/Sidebar 2.tsx` | Finder-duplicate of an **older** Sidebar (still had a Dashboard nav entry). Never imported. |
| `components/layout/StoreHydration.tsx` | A component that renders `null`. Never imported. |
| `components/pages/DashboardPage.tsx` | Not reachable from any route — `app/page.tsx` loads PortfolioPage and `/portfolio` redirects to `/`. 111 lines of dead UI. |
| `app/api/debug-search/route.ts` | Debug endpoint; CLAUDE.md itself flagged it as removable. It also fetched a nonexistent GitHub repo for its riftbound branch. |
| `temp-init/` | Leftover scaffolding directory containing only a stray `node_modules` and `package-lock.json`. |
| `SHOWCASE_RARITIES` in `lib/api/riftbound.ts` | Defined, never read. |
| Unused imports | `Minus` in SpendingPage; `Chrome` in LoginPage and SignupPage. |

Also: the `.next` build directory had been polluted by the same Finder-duplication event
(`BUILD_ID 2`, `pages 2`, …) and its `server/app` directory was missing — the previous
build output was corrupted. Deleted `.next` and `tsconfig.tsbuildinfo` and rebuilt clean.

---

## Duplication Consolidated

### 11. One catalog loader + one search scorer — new `lib/api/catalog.ts`
`pokemon.ts`, `lorcana.ts`, and `riftbound.ts` each had a private copy of the same
`readFileSync`-and-cache loader and the same `scoreMatch()` tokenizer (~30 lines × 3).
The Riftbound prices route (`app/api/prices/riftbound/route.ts`) had a **fourth** copy of
the loader — meaning the riftbound catalog JSON was held in server memory twice.
**Fix:** shared `loadCatalog<T>(filename)` (one cached copy per file, shared by every
consumer) and `scoreMatch(name, query, tags?)` (tags parameter covers Riftbound's
champion-tag matching; Lorcana keeps its small version-subtitle bonus as a local
wrapper). Behavior verified identical via live search queries, including the
`leblanc → "LeBlanc, Everywhere at Once"` tag case.

### 12. Three copy-pasted refresh blocks → one helper — `PortfolioPage.tsx`
`refreshPrices` had ~60 lines of near-identical fetch/parse/save logic per game. Now a
single `refreshGame(game)` driven by a `PRICE_ROUTES` table (all three games go through
their server proxies). Failures in one game no longer depend on inline `.catch(() => {})`
chains, and non-OK responses are skipped explicitly.

### 13. Shared Firebase auth error mapper — new `lib/auth-errors.ts`
LoginPage and SignupPage each had a private `getFriendlyError()` with 6 identical cases.
Merged into one `friendlyAuthError()` covering both flows (codes don't collide).

### 14. Duplicate Lorcana name split — `lib/api/lorcana.ts`
The search result mapping called `c.name.includes(' - ')` / `split(' - ')` four times per
card across two chained `.map()`s. Now a single map with one `split`.

---

## Performance

### 15. `Intl.NumberFormat` constructed per call — `lib/utils.ts`
`formatCurrency` built a new `Intl.NumberFormat` on every invocation — and it's called
for every currency cell in every table row on every render. Now a single module-level
formatter. (This is one of the more expensive built-ins to construct.)

### 16. O(cards × history) → O(cards + history) — `PortfolioPage.tsx`
The `enriched` memo did `priceHistory.find(...)` per card (twice on the entry path).
Now builds a `Map` once per recompute. Also simplified `priceAtCutoff` to track the best
timestamp instead of re-parsing `best.date` on every comparison.

### 17. Redundant Firestore read on every Spending visit — `SpendingPage.tsx`
The page re-fetched all purchases from Firestore on every mount, duplicating the load
AuthProvider already performs at login (CLAUDE.md quirk #13 documents that AuthProvider
owns this load). Removed the effect and its imports.

### 18. Unmemoized full-collection scan — `FilterPanel.tsx`
`totalHidden` filtered the entire card list on every render of the (always-mounted)
filter panel. Wrapped in `useMemo` keyed on `[cards, calcFloor]`.

---

## TypeScript / Code Quality

### 19. Typed the Cardex route catalog — `app/api/cardex/route.ts`
Replaced `Record<string, unknown>[]` and six `as string` casts with a proper
`CatalogCard` interface. Added radix to `parseInt`. Same JSON output (verified live:
Shimmering Skies → 222 cards, sorted).

### 20. Removed a no-op ternary — `AddCardDialog.tsx`
`useState<MarketSource>(existingMarket > 0 ? 'catalog' : 'catalog')` → `'catalog'`.

### 21. Loading states that couldn't reset — `AddCardDialog.tsx`
The sets fetch had no `.catch`, so a failure left `setsLoading` stuck at `true`
("Loading sets…" forever in the placeholder). Both the sets and search effects now use
`.catch(...).finally(...)` so their spinners always resolve.

---

## Documentation

### 22. `CLAUDE.md` brought back in sync
- File map: removed deleted `debug-search` route and `DashboardPage.tsx`; added
  `api/sets`, `api/prices/pokemon|lorcana|riftbound`, `lib/api/catalog.ts`,
  `lib/auth-errors.ts`.
- Quirk #10 (`diagnosFirestore`) marked resolved — the function no longer exists.
- Quirk #11 updated to describe the shared `loadCatalog()` cache.

---

## Verification

- `npm run build` — clean (compile, types, lint).
- Production server restarted on port 3456 from the fresh build.
- Live smoke tests: `/` (200), card search for all three games (incl. Riftbound tag
  search), `/api/sets` for all three games, `/api/cardex`, `/api/pack-analysis/lorcana`,
  and `/api/prices/pokemon` with a real card (`sv7-1` → $1.49).

## Not Changed (deliberately)

- `app/api/cardex` and `app/api/pack-analysis/lorcana` still read their catalog JSON
  fresh per request (`force-dynamic`) — that freshness is intentional per CLAUDE.md.
- The Zustand `persist` middleware only partializes filter prefs (`calcFloor`,
  `activeGames`, `timeFrame`); collection data stays memory-only as designed.
- `RIFTBOUND_KNOWN` / Cardex groups don't yet list Vendetta/Radiance — those sets aren't
  in the catalog until they release and `download-cards` is re-run.
