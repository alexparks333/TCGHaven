# Card catalog, staff portal & syncing

Moved out of CLAUDE.md (2026-10-30) so it's read only when needed. Section numbers (§N) refer to
the original CLAUDE.md layout.

## How Card Data Works (The Big Picture)

There are **two completely separate data concerns**:

### 1. Card Catalog (Search & Display) — shared, admin-owned, Firestore-backed

As of the "Migrate card catalog to Firestore as shared source of truth" migration, this is
**no longer static JSON files**. All card names, images, set names, prices, and collector
numbers live in **Firestore**, under `catalog/{game}/cards/{cardId}` — one document per card,
readable by anyone, writable only by the admin account (see `firestore.rules`). This is what
makes it a genuinely *shared* catalog: every user's copy of the app reads the same live data,
and an admin edit (hide a card, fix a name, add a missing card, register a whole new set)
applies to everyone immediately, no rebuild/redeploy required. See
[§4](#card-catalog-system--deep-dive-firestore-backed) for the caching mechanics and
[§5](#admin-catalog-page--architecture-caching--diagnostics) for the admin-facing page that
edits it.

When Alex (or the admin) types in the AddCardDialog search box, the app hits a Next.js server
route (`/api/cards/search`) which searches this Firestore-backed catalog (via an in-memory
cache, not a live Firestore read per keystroke) and returns matches. No external card-database
API call happens during a normal search.

`npm run download-cards` (`scripts/download-card-catalog.mjs`) is what keeps this catalog in
sync with the five upstream sources (Pokémon TCG data, lorcast, the Riftbound gallery/TCGCSV,
apitcg's One Piece dataset, Scryfall) — it scrapes fresh data and **writes it into Firestore**,
never clobbering an admin edit made since the last sync (see
[§4](#card-catalog-system--deep-dive-firestore-backed)). It's for picking up new upstream
cards/sets, not a prerequisite for the catalog to work at all. **MTG is the one exception** —
its first sync is deliberately not yet run; see [§11](#magic-the-gathering--data-source-schema-add-a-set-guide)
and "MTG Integration.md" at the repo root.

### 2. User Collection (Inventory)
When Alex adds a card, the card data is written to **Firestore** under
`users/{uid}/cards/{cardId}`. The Zustand store is updated immediately (optimistic UI),
and the Firestore write happens in the background. On next login, Firestore is read and
Zustand is populated.

The catalog and the user collection are connected only by the `apiId` field — the catalog's
unique card ID that gets stored on the Card object when a card is selected from search results.

---

---

## Card Catalog System — Deep Dive (Firestore-backed)

### Firestore collections

```
catalog/{game}/cards/{cardId}          — one doc per card, full schema (see per-game sections
                                          below). `hidden: boolean` controls visibility;
                                          `updatedAt` (serverTimestamp) drives both admin-edit-
                                          wins-over-resync logic and the delta-sync below.
catalog_snapshot/{game}/chunks/{0,1,…} — pre-sharded full-catalog snapshot, ~1500 cards/chunk
                                          (Firestore's 1MiB/doc limit), JSON-stringified in a
                                          `cards` field. What a cold app instance reads instead
                                          of scanning every card doc individually.
catalog_meta/{game}                    — { lastBulkSyncAt, brokenImageIds } — lastBulkSyncAt lets
                                          download-card-catalog.mjs know whether an admin edit
                                          happened since its last run, so it never clobbers one;
                                          brokenImageIds is the image-health check's own bookkeeping
                                          (§16) — card ids whose imageUrl doesn't actually resolve,
                                          re-verified every sync.
```

`game` is `pokemon` | `lorcana` | `riftbound`. Reads are public (`allow read: if true`);
writes require the admin UID (see `firestore.rules`).

### How reads work — `lib/api/catalog.ts`

`loadCatalog<T>(game)` is the shared entry point every real consumer goes through
(`lib/api/pokemon.ts`, `lorcana.ts`, `riftbound.ts` all call it under the hood via
`loadVisibleCatalog`, which is the same thing minus `hidden` cards). It keeps one **in-memory
cache per game, per Node.js server process** — the same "lives for the process lifetime" shape
the old static-JSON cache had, just fed from Firestore instead of a file:

1. **Cold cache** (first call, or after `invalidateCatalogCache()`): reads the full catalog from
   `catalog_snapshot/{game}/chunks/*` — cheap, a handful of doc reads instead of thousands.
2. **Warm cache, < 2 minutes old** (`STALE_MS`): served straight from memory, zero Firestore
   reads.
3. **Warm cache, ≥ 2 minutes old**: runs `pullDeltas()` — a single query for
   `catalog/{game}/cards where updatedAt > lastSyncAt` — and merges just the changed docs into
   the in-memory Map. This is why every catalog write (hide, edit, add, and the download
   script's own upserts) **must** stamp `updatedAt: serverTimestamp()` — a write that skips it
   is invisible to this delta mechanism forever, only fixable by a full cache invalidation.

**Compressed snapshot (2026-10-26) — `scripts/lib/snapshot-codec.mjs`.** A cold load used to
download the plain snapshot: 8.7MB/14 docs for Pokémon (12.9MB for Japanese), ~2–3s before the
first search on every new server instance. Every snapshot writer (`syncToFirestore()`,
`regenerateSnapshot()`) now also writes `catalog_snapshot/{game}_gz/chunks/{n}` = `{ gz: Bytes,
asOf, chunk, of }` — gzipped, without `updatedAt` (Pokémon: 0.92MB in 4 docs). `loadCatalog()`
reads that first (only when all chunks are from one write), then pulls cards with `updatedAt >
asOf`, so a snapshot that's behind still yields the current catalog; it falls back to the plain
format, which is still written for older deployments. Concurrent cold loads share one download
(`_loading`), and a warm-but-stale cache pulls deltas in the background (stale-while-revalidate)
instead of making a request wait. Add Card calls `GET /api/cards/search?warm=1` as it opens so a
cold instance loads the catalog + search index while the user types.
`scripts/backfill-compressed-snapshots.mjs` builds the compressed copies from the plain ones
(one-off; any sync also writes them). Tests: `npm run test:snapshot`.

**Pokémon set list:** `downloadPokemon()` saves the set list (same data as api.pokemontcg.io's
`/sets` — built from the same GitHub repo) to `catalog_meta/pokemon.sets`; `getPokemonSets()` reads
that first and only calls the live API if it's missing. That API failed 2 of 3 calls while this was
diagnosed, and its retry loop made a cold "Loading sets…" take ~9s.

`regenerateSnapshot(game)` rewrites `catalog_snapshot/{game}/chunks/*` from the current
`catalog/{game}/cards` collection and calls `invalidateCatalogCache(game)` — called after every
Admin Catalog write so a fresh app instance (or a stale one past the 2-minute window) sees the
change without a full resync.

### The cache-invalidation gotcha (client vs. server module instances)

**This bit is easy to get wrong and did in fact ship wrong once.** `regenerateSnapshot()` is
only ever called from Admin Catalog's client-side code (`AdminCatalogPage.tsx`, a `'use client'`
component) — meaning it executes in the **browser's** JS bundle, which has its own separate copy
of `lib/api/catalog.ts` (and therefore its own separate `_cache` module variable) from the copy
running in the Next.js **server** process that `/api/admin/catalog`, `/api/cards/search`,
`/api/cardex`, etc. actually read through. Calling `invalidateCatalogCache()` from the browser
only clears the browser's own unused copy — the server's cache, which is what matters, never
hears about it, and silently keeps serving pre-edit data until its own 2-minute staleness timer
happens to expire (and even then, only for cards whose write stamped `updatedAt`).

The fix (already applied): `regenerateSnapshot()` additionally does
`fetch('/api/admin/catalog/invalidate', { method: 'POST', body: { game } })` whenever
`typeof window !== 'undefined'` — a tiny server route (`app/api/admin/catalog/invalidate/route.ts`)
that calls `invalidateCatalogCache(game)` **in the server's own process**, which is what
actually needs to happen. If you ever add a new way to write to the catalog from client code,
route it through `regenerateSnapshot()` (or replicate this invalidate-fetch) rather than
inventing a new write path — otherwise the same silent-staleness bug reappears.

The exact same class of bug exists for `getSetsForGame()`'s `setsCache` in `lib/api/search.ts`
(a separate, never-expiring cache of the set picker's contents) — see
[§5](#admin-catalog-page--architecture-caching--diagnostics)'s New Set section for how that one
gets invalidated (it's simpler, because that write path is server-side already).

---

---

## Admin Catalog Page — Architecture, Caching & Diagnostics

`/admin` (`components/pages/AdminCatalogPage.tsx`) is the UI for the shared, Firestore-backed
catalog described in [§4](#card-catalog-system--deep-dive-firestore-backed). It is **the**
source of truth every user's search, inventory-add, and Cardex read from — not a personal
per-user thing (see [§6](#personal-collections-vs-the-admin-catalog) for the feature that
actually is per-user and easy to confuse this with). Gated by `isAdmin` (`user.uid ===
NEXT_PUBLIC_ADMIN_UID`, enforced for real by `firestore.rules`, not just hidden in the UI) —
anyone can browse the table read-only; only the admin sees the write controls.

### What it does

- **Hide / Unhide** (`toggleHideCard`) — flips `hidden` on a card's Firestore doc. Reversible,
  never deletes data. Hidden cards stay visible in this table (greyed out, "hidden" badge) but
  disappear from `loadVisibleCatalog()` — search, Cardex, everywhere else.
- **Edit** (`saveCardEdit`) — patches a card's fields, then **cascades** `number`/`name`/
  `imageUrl` (never price) to any inventory entries across all users whose `apiId` matches, via
  `editCardInFirestore`. Auto-applies with no confirm gate — [[feedback_catalog_source_of_truth]]:
  the Admin Catalog is meant to be trusted as ground truth, so an edit here should just take
  effect everywhere, not require per-user approval.
- **Add Missing Card** (`AddCardForm`) — manually add a card the scrapers missed (or a fully
  custom one) to the currently-selected set. Supports an "Auto-fetch price & image" lookup
  (`POST /api/admin/catalog/lookup`) that does an *exact* number-match query against TCGCSV/
  lorcast/pokemontcg.io — this is a convenience prefill, not the diagnostic tool (see Raw Source
  Check below for why an exact-match lookup isn't enough to answer "is this card upstream at
  all?"). Accepts an optional `prefill` prop so other tools (Raw Source Check) can hand it a
  ready-made candidate.
- **New Set** (`NewSetForm`, `POST /api/set-registry`) — registers a brand new set in
  the registry (Firestore `registry/main`), Lorcana or Riftbound only (Pokémon's set list comes live from
  `api.pokemontcg.io`, a different mechanism entirely — see [§7](#pokemon--data-source-schema-add-a-set-guide)).
  Two real use cases: (a) a real upstream set the sync hasn't auto-detected/matched yet, or (b)
  a fully custom/curated set that will never come from any scraper. Either way it's created with
  `tcgcsvGroupId`/`lorcastId` left `null` and `source: "manual"`, so a future sync never mistakes
  it for something it should be overwriting or re-scraping — cards get added to it one at a time
  via "Add Missing Card" afterward. Requires picking an existing `cardexGroup` label from that
  game's `groupOrder` (see [§14](#cardex-feature--how-sets-register)) so the new set actually
  shows up in the Cardex set picker once it has cards.
  - **Cache gotcha, same shape as the one in §4:** `getSetsForGame()` (`lib/api/search.ts`)
    caches the set picker's contents in a module-level `setsCache` that, unlike the catalog
    cache, **never expires on its own** — "only cache non-empty results so a transient API
    failure doesn't stick" means once populated it's permanent until server restart. The `POST
    /api/set-registry` route calls `invalidateSetsCache(game)` directly after writing — this one
    doesn't need the client-fetch dance §4 describes, because set creation is *already* a
    server-side round trip (unlike `regenerateSnapshot()`, which runs client-side).
  - Lorcana has its own extra wrinkle: `getLorcanaSets()` normally prefers the **live** lorcast
    `/sets` API over the registry, so a manually-created Lorcana set (which lorcast has never
    heard of) would never surface even with the registry correctly updated. Fixed by always
    merging in any `source: "manual"` registry sets that the live/fallback list doesn't already
    contain.
- **Check Raw Source** (`RawSourceCheckPanel`, `GET /api/admin/catalog/raw-source`) — Riftbound
  only, for now. Answers "is a card actually upstream and we're just silently skipping it?" by
  fetching the **raw** TCGCSV CSV and the **raw** official gallery (`playriftbound.com`)
  `__NEXT_DATA__` blob directly, then diffing each against the local catalog — deliberately
  independent of `download-card-catalog.mjs`'s own `tcgKey()`/`catalogKey()` matching logic, so
  a bug in that matching wouldn't hide the gap from this tool the way it hid it from the sync.
  Two independent diffs are shown:
  - **Gallery vs. local catalog**, matched by Riot's own card `id` (the catalog stores the
    gallery's `id` verbatim for gallery-sourced cards) — anything in the gallery with no
    matching local `id` is a card the scrape flow is missing entirely.
  - **TCGCSV rows vs. local catalog**, matched by collector number — **must** compare against
    both a card's bare `number` *and* the number+suffix embedded in its `publicCode`,
    not `number` alone. Alt Art/Overnumbered/Signature variants share their base card's bare
    `number` (the `a`/`*` suffix only ever lives in `publicCode` — see
    [§9](#riftbound--data-source-schema-add-a-set-guide)'s variant table), while TCGCSV's
    `extNumber` column always carries that suffix (e.g. `"007a/298"`). Matching only against
    `number` produces a wall of false-positive "unmatched" Alt Art rows — this was caught and
    fixed the same session this tool was built; if you touch this matching logic again, test it
    against a set with Alt Art cards (e.g. Origins) before trusting the output.
  - Each finding has an "Add" button that opens Add Missing Card prefilled from the raw source
    entry (name/number/rarity/image — price is left for the admin to fill in, since the exact
    row that matched isn't surfaced through this button, only through the separate TCGCSV-only
    diff list).
  - Real example this tool caught on first use: Vendetta's TCGCSV feed has a priced
    "Zed - Master of Shadows (Signature)" row that doesn't exist under any name in the local
    catalog at all — a genuinely missing card the normal sync silently skipped.

- **Categories** (`components/admin/CatalogCategories.tsx`, `POST /api/set-registry/categories`
  — add / rename / delete (empty only) / reorder / assign) — Lorcana & Riftbound's Cardex
  categories = registry `groupOrder` + each set's `cardexGroup`. The set picker is grouped by them
  (Pokémon's by `series`), the set info bar has a Category select, and the Categories panel
  manages them. A rename updates every set in it. Riftbound's "Special" also holds the Cardex's
  inventory-only bucket (`buildGroups()` joins a group of that label), so renaming it splits them.
- **Whole-catalog Search** (`GET /api/admin/catalog/search?game=&q=`) — the search box at the top
  of `CatalogBrowser` that finds a card across every set for the active game at once (unlike the
  set-scoped table below it), capped at `MAX_RESULTS = 300` with a `truncated` flag the UI can
  check. Uses the same matching as every other search (`searchCatalog()` in
  `lib/api/cardSearch.ts`, see [§12](#card-search-flow)) minus its "fewer words" fallback, and a
  collector number in the query narrows to that number instead of just ranking it first — no
  writes.

### Key files

- `components/pages/AdminCatalogPage.tsx` — the whole page: `SyncPanel` (§17), `CatalogBrowser`,
  `CardTable`, `AddCardForm`, `EditCardForm`, `NewSetForm`, `RawSourceCheckPanel`, `ImageUploadField`.
- `app/api/admin/catalog/route.ts` — `GET`, read-only listing (includes hidden cards, unlike
  every other catalog consumer — the admin table needs to show and un-hide them). No auth check
  of its own — browsing is harmless, this route never writes.
- `app/api/admin/catalog/search/route.ts` — the whole-catalog search above. Also unauthenticated
  (read-only), capped at 300 results.
- `app/api/admin/catalog/lookup/route.ts` — exact-match external price/image lookup, used by
  "Auto-fetch price & image" in Add Missing Card. Never writes anything, but does proxy live
  requests to TCGCSV/lorcast/pokemontcg.io/Scryfall on the caller's behalf, so it's admin-gated
  (`verifyAdminRequest()`, see below) to avoid becoming a free abuse vector against those quotas.
- `app/api/admin/catalog/invalidate/route.ts` — `POST { game }`, drops the **server's** catalog
  cache for a game. See the cache-invalidation gotcha in [§4](#card-catalog-system--deep-dive-firestore-backed).
- `app/api/admin/catalog/raw-source/route.ts` — the Raw Source Check diff, Riftbound-only today.
- `app/api/set-registry/route.ts` — `GET` full registry (public, no auth); `PUT` a structured
  patch to one existing set entry (Settings "Needs Review" editor, itself gated behind `isAdmin`
  — see below); `POST` registers a brand new set entry (New Set form); `DELETE` removes one,
  restricted server-side to `source: "manual"` sets only (official/auto-detected sets would just
  reappear on the next sync). All four only ever touch the registry (Firestore `registry/main`),
  never TypeScript source.
- `lib/api/catalog.ts` — `loadCatalog`/`loadVisibleCatalog`/`regenerateSnapshot`/
  `invalidateCatalogCache`, plus `sortCatalogCards`. Search ranking itself lives in
  `lib/api/cardSearch.ts` ([§12](#card-search-flow)).
- `lib/firebase/config.ts` — exports `ADMIN_UID` (from `NEXT_PUBLIC_ADMIN_UID`), used by both
  this page's `isAdmin` check and (independently, for real enforcement) `firestore.rules`.
- `lib/firebase/verifyAdminRequest.ts` / `lib/firebase/authFetch.ts` — the server-side check and
  client-side fetch wrapper behind every admin-only write route's real auth gate (see the next
  paragraph). Any route that writes shared/admin data — not just this page's own routes, but also
  the 5 `sync/{game}` routes (§17) — goes through these.

### Staff portal — `/admin` is its own app with its own sign-in

`/admin` is a separate **staff portal**, not a page of the collector app: `ClientWrapper.tsx` skips
the collector shell/session for `/admin/*`, and `app/admin/layout.tsx` renders `StaffPortal`
(`components/admin/`) — its own dark sidebar (Catalog `/admin`, Sync `/admin/sync`, Needs Review
`/admin/review`, Team `/admin/team`), sign-in screen, and gates.

- **Separate session.** `lib/firebase/staff.ts` runs a second Firebase app instance (`'staff'`)
  with its own `staffAuth`/`staffDb`/`staffStorage`, so a staff login never touches the collector
  session (Alex can be signed in to both in one browser). Every portal write goes through
  `staffDb`/`staffStorage` (AdminCatalogPage imports them as `db`/`storage`;
  `regenerateSnapshot(game, staffDb)`), and `adminFetch()` sends the **staff** session's token.
- **Who's staff:** `staff/{uid}` docs `{ name, email, role: 'owner'|'staff', mustChangePassword }`.
  The Owner is `NEXT_PUBLIC_ADMIN_UID`, also hardcoded in `firestore.rules`/`storage.rules` as the
  root of trust (never lockable-out; their record is created on first portal sign-in). Only the
  Owner adds/removes staff (Team page). Adding someone creates a Firebase email/password login with
  a temporary password on a throwaway app instance (so the Owner's session is untouched); the
  employee must choose their own on first sign-in. Removing the `staff` doc revokes access
  everywhere at once. Employee staff logins are refused by the collector app's email sign-in.
- **Enforcement:** `firestore.rules` `isAdmin()` = Owner uid, the sync bot uid, or `isStaff()`
  (`exists(staff/{uid})`); `storage.rules` uses `firestore.exists()` for the same check.
  `verifyAdminRequest()` checks the caller's staff record via Firestore's REST API using the
  caller's own ID token (rules allow reading your own staff doc) — Owner uid always passes.
- Admin Catalog edits no longer cascade name/number/image into the editor's own inventory (the
  portal has no inventory), so the Inventory "catalog correction" banner is gone too. The collector
  app has no admin or sync UI at all anymore. There's no Settings page either (2026-10-27): Settings
  is a panel behind the ⚙️ on your profile banner (`components/friends/SettingsDialog.tsx` — name,
  email, @username, Sign out); `/settings` redirects to `/profile?settings=1`, which opens it. The
  old Riftbound "scan & fix numbers/foil/rarity" repair tool was removed with it.

### Auth model — `isAdmin` is UX, but every write route now checks the caller too

`isAdmin` (`user.uid === NEXT_PUBLIC_ADMIN_UID`) gates which controls the UI shows, and
`firestore.rules` is the real enforcement for any write this page makes with the client Firestore
SDK directly (hide/edit/add card, image upload) — this part was always correctly gated. What
wasn't, until a later audit pass caught it: every write that instead goes through a **Next.js API
route** (`set-registry`'s PUT/POST/DELETE, `admin/catalog/invalidate`, `admin/catalog/lookup`,
and all 5 `sync/{game}` routes in §17) used to have no check of *who* was calling it — the route
itself signs in as the admin bot account (`ensureAdminAuth()`/`ensureSignedIn()`) purely so the
Firestore *write* is allowed, which is a completely different thing from verifying the *request*
came from the admin. Any anonymous caller who found one of these URLs could already trigger it.

**The fix:** every one of those routes' handlers now starts with
`const unauthorized = await verifyAdminRequest(request); if (unauthorized) return unauthorized`.
`verifyAdminRequest()` reads the caller's Firebase ID token from an `Authorization: Bearer <token>`
header and checks it against Firebase's Identity Toolkit REST API (`accounts:lookup`), rejecting
anyone whose uid isn't `ADMIN_UID` — no `firebase-admin` SDK/service account needed, matching this
codebase's existing "lightweight REST calls over a heavier server SDK" pattern
(`adminAuth.ts`). Every client-side call site that writes through one of these routes
(`AdminCatalogPage.tsx`, `SettingsPage.tsx`'s Needs Review editor, `regenerateSnapshot()` in
`catalog.ts`) uses `adminFetch()` instead of a plain `fetch()` to attach that token automatically.
Settings' "Needs Review" card is also now gated behind `isAdmin` itself — it used to be reachable
(and would attempt to write) for any signed-in user, not just the admin, even though the write
would previously have silently succeeded regardless.

---

---

## Personal Collections (vs. the Admin Catalog)

`components/pages/PersonalCollectionsView.tsx` (a tab inside `/cardex`, backed by
`lib/firebase/collections.ts`) is **easy to confuse with the Admin Catalog and is a
fundamentally different feature** — worth stating plainly since a past conversation conflated
them before landing on the right design:

| | Admin Catalog (§5) | Personal Collections |
|---|---|---|
| Scope | Shared — every user reads the same data | Private — `users/{uid}/collections/{id}`, one user's own |
| Who can write | Admin only (`isAdmin`, enforced by `firestore.rules`) | Any signed-in user, their own collections only |
| What it holds | Real catalog card **documents** (name, image, price, `hidden`, etc.) | A named list of **references** to existing catalog card ids — no new card data, just curation |
| Can it add a brand-new, never-cataloged card? | Yes — that's the whole point of "Add Missing Card" / "New Set" | No — `AddCardToCollectionModal` only searches the existing catalog via `/api/cards/search` |
| Purpose | Be the ground truth the rest of the app (search, Cardex, inventory) reads from | Let a user build their own themed want-list/grouping ("Fury Runes", an alt-art wishlist, a champion's cards across every set) and track completion against their own inventory, Cardex-style |

If a request is "I want to track a themed group of cards I already own or want" → Personal
Collections. If a request is "the catalog is missing/wrong about a real card, or I want a whole
new *set* other users would see too" → Admin Catalog (§5).

**Currently limited to Lorcana and Riftbound only** — `PersonalCollection['game']` is typed
`Extract<Game, 'lorcana' | 'riftbound'>`, and the game picker/create form hardcode the same two.
Pokémon/One Piece/MTG were all added to the rest of the app after this feature was built and
never got a Personal Collections equivalent; there's no technical blocker to adding the other
three games, just work not yet done.

**Foil-aware identity:** a `PersonalCollectionCard` carries its own `isFoil` field, because
Riftbound search can return two rows sharing the same catalog `id` (a non-foil and a foil
listing, when a card is priced both ways) — every place a collection card needs a stable identity
(the "already added" dedup check in the Add Card modal, drag-to-reorder, removal) keys on a
composite `${id}::${isFoil ? 'foil' : 'normal'}` (`cardKey()` in `PersonalCollectionsView.tsx`),
not the bare catalog id, so adding one variant doesn't collapse onto — or permanently block
re-adding — the other.

---

---

## Automated Sync — Admin Catalog

`/admin` has a **"Sync Card Data"** panel (admin-gated, same as the rest of the page) with one
button per game — Pokémon, Lorcana, Riftbound, One Piece, Magic: The Gathering. Each is a plain, synchronous `POST` to its own API
route that runs the download/diff/registry-update logic directly against Firestore and returns a
JSON result when done; there's no build, no server restart, and no local file writes, so this
works identically whether you're on `npm run dev`, `npm run start`, or the deployed Vercel app.
This used to live on the Settings page as a single button that also ran `next build` and
kill-and-restarted whatever was on port 3000 — that model predated the Firestore migration (it
was a leftover from when the catalog was baked into the build) and couldn't work at all once
Vercel hosting was added: a Vercel function has a read-only filesystem and no persistent process
to restart, so the old `/api/sync` route just threw on every call once the site was hosted there.
The manual per-game instructions elsewhere in this doc remain accurate as a fallback and as an
explanation of what each sync does under the hood.

### What it does, per game

1. **Download** — calls the matching function in `scripts/lib/catalog-sync.mjs` (the same module
   `npm run download-cards` uses) to re-scrape that one game's catalog and sync it into Firestore.
2. **Diff** (Lorcana/Riftbound only) — compares the fresh catalog's distinct `setName` values
   against the registry (`registry/main` in Firestore) to find genuinely new sets.
3. **Riftbound group matching** — for any new (or previously unmatched) Riftbound set, fetches
   `https://tcgcsv.com/tcgplayer/89/groups` and fuzzy-matches the set name against it using
   `scripts/lib/text-norm.mjs`'s `matchSetName()` (exact match, or prefix-stripped/substring
   match, or a high-confidence Levenshtein fallback). Only confident matches are accepted —
   anything uncertain is left unmatched for manual review instead of guessing. If a match is
   found, the game re-downloads once more so that set's prices get merged in.
4. **Registry update** — appends new sets with conservative defaults (`needsReview: true`,
   Lorcana `cardexGroup: "Special Sets"`, Riftbound `cardexGroup: "Main Sets"`) and saves the
   updated registry back to Firestore.

Pokémon has no registry involvement at all (steps 2–4 don't apply) — its set list comes live from
`api.pokemontcg.io`, so syncing it is just the download/Firestore-sync step. It's also by far the
slowest of the three (170+ sets, 20k+ cards, a full existing-catalog read to diff against) — it
can take several minutes and may exceed a Vercel function's time limit depending on your plan;
`npm run download-cards` locally has no such limit and remains the reliable way to sync Pokémon.

**One Piece** does steps 1–2 (download + diff) but skips step 3 entirely — there's no group
matching to do, since `downloadOnePiece()` prices every card by exact code match against *every*
tcgcsv group up front, not by knowing which group belongs to which set (see
[§10](#one-piece--data-source-schema-add-a-set-guide)). `app/api/sync/onepiece/route.ts` just
backfills the registry with `{ setName, code, releaseDate: null, cardCount, source:
'auto-detected' }` for any newly-discovered `setName` — no `needsReview` flag, nothing for
Settings' "Needs Review" editor to ever show for this game (same as Pokémon).

**MTG** has no registry involvement at all either, exactly like Pokémon (its set list comes live
from `api.scryfall.com/sets`) — but it's by far the biggest sync here (~99,000 cards vs.
Pokémon's ~20k), and unlike every other game, it isn't wired into the automatic 4x/day cron at
all yet (see [§18](#cron-driven-price-sync)). Clicking this button IS still the one live way to
sync it — a deliberate one-off admin action rather than a recurring background one — but read
"MTG Integration.md" at the repo root before clicking it for the first time: that first click
writes ~99,000 Firestore documents in one run, which can exceed a Firebase Spark (free) plan's
daily write quota.

### New-Rarity Detection & Image Health Check

Every sync (all 5 games, regardless of whether that game has a registry) also does two more
things, surfaced in the Sync panel's result and persisted in `sync_status/{game}` so they're
visible even from the "last known status" view, not just right after clicking Sync:

- **New rarity detection** (`findNewRarities()`, `lib/api/syncHealth.ts`) — diffs the sync's
  distinct `rarity` values against `CARDEX_RARITY_ORDER` (`lib/api/catalog.ts`). The Cardex's
  per-game rarity toggle ([§14](#cardex-feature--how-sets-register)) already derives its button
  list dynamically, so a brand-new rarity value works as a toggle immediately with zero code
  changes — this check exists purely to tell the admin "hey, go add a color/label for it" rather
  than leaving it a flat-gray, un-relabeled pill forever. This is exactly the kind of gap that
  already bit One Piece's `TR`/`P`/`PR` and Pokémon's RGB Mew cards before anyone happened to
  notice by eye — now a sync itself says so.
- **Image health check** — `syncToFirestore()` (`scripts/lib/catalog-sync.mjs`) HEAD-checks every
  card's `imageUrl` and tracks ids whose image doesn't actually resolve in
  `catalog_meta/{game}.brokenImageIds`. The real bug that motivated this: Riftbound's Vendetta Alt
  Rune cards synced with a completely well-formed `tcgplayer-cdn.tcgplayer.com` URL that 403'd
  (TCGPlayer hadn't uploaded that specific product's photo yet) — nothing about the synced *data*
  looked wrong, only an actual HTTP check catches it. To keep this cheap, the **ongoing per-sync
  check only re-verifies two bounded sets**: cards that are brand-new this run, and cards already
  in `brokenImageIds` from a previous run — never the whole catalog on every sync. A previously-
  broken card whose photo TCGPlayer/the source has since uploaded gets detected and dropped from
  the list automatically, reported as `newlyFixedImages`; a newly-broken one is `newlyBrokenImages`.
  Because the ongoing check is bounded to new + already-flagged cards, it has **nothing to catch
  for a card that was already broken before this feature shipped** — that's what
  `npm run check-images -- <game>|all` (`scripts/check-image-health.mjs`) is for: a full one-time
  (or occasional re-run) scan of every card in a game's catalog, seeding `brokenImageIds` with a
  real baseline. Run once per game when this feature is new, or any time you suspect a broader
  problem than the ongoing check would catch; the ongoing per-sync check keeps it current after
  that with no further manual scans needed. `SyncStatus` (`lib/api/syncStatus.ts`) carries
  `newRarities`/`totalBrokenImages`/`newlyBrokenImages`/`newlyFixedImages` alongside the existing
  `newSets`/`setCount` — like `newSets`, these are only meaningful on a successful run;
  `recordSyncStatus()` merges rather than replaces (see quirk #25), so a failed run's write
  leaves an earlier run's counts sitting in the doc, which is why the Sync panel only ever
  displays them next to `last.ok`.
- **Pokémon and MTG's `newSets`** — both lack a registry to diff against (their set lists come
  live from `api.pokemontcg.io`/`api.scryfall.com`), so unlike Lorcana/Riftbound/One Piece they
  never had a "new sets found" signal at all before this. `syncToFirestore()` now computes this
  generically for every game (pre-sync vs. post-sync distinct `setName`s, no extra Firestore read
  — it already has the pre-sync collection in memory for its own admin-edit-wins diffing) and
  returns it as `newSetNames`; Pokémon/MTG's `sync.ts` wire this straight into their `newSets`
  response field, while Lorcana/Riftbound/One Piece keep using their own registry-based `newNames`
  (the one that actually drives registering the set, not just reporting it) since that's a
  materially different, more authoritative signal for those three.

### Key files

- **Firestore `registry/main`** — the single source of truth this whole feature reads/writes
  (formerly `data/set-registry.json`, migrated because a Vercel serverless function can't durably
  write to a git-tracked file). Replaced the hardcoded `LORCANA_GROUPS`/`RIFTBOUND_GROUPS`/
  `LORCANA_KNOWN`/`RIFTBOUND_KNOWN` (`CardexPage.tsx`), `BOOSTER_SETS` (the since-removed Pack Analysis route),
  `RIFTBOUND_SETS` (`lib/api/riftbound.ts`), and `LORCANA_SETS_FALLBACK` (`lib/api/lorcana.ts`).
- `lib/api/registry.ts` — `loadSetRegistry`/`saveSetRegistry`/`invalidateRegistryCache` plus the
  per-game `getXRegistrySets` readers, all async now (a Firestore read
  isn't free the way a local fs read was) with a short in-process staleness cache, mirroring
  `lib/api/catalog.ts`'s shape just without the chunked-snapshot machinery (this doc is tiny).
- `scripts/lib/catalog-sync.mjs` — the actual per-game scraping + Firestore-sync logic
  (`downloadPokemon`/`downloadLorcana`/`downloadRiftbound`/`downloadOnePiece`/`downloadMTG`/
  `syncToFirestore`/`ensureSignedIn`), shared verbatim by `scripts/download-card-catalog.mjs`
  (the CLI entry point, which skips `downloadMTG` unless run with `--include-mtg` — see "MTG
  Integration.md") and `app/api/sync/{pokemon,lorcana,riftbound,onepiece,mtg}/route.ts`.
  Deliberately plain ESM, not TypeScript, so a bare `node` process can still run it directly — it
  does its own Firebase init/sign-in rather than importing `lib/firebase/config.ts` (same
  "duplicated on purpose across the runtime boundary" reasoning as
  `app/api/admin/catalog/lookup/route.ts`'s CSV parser).
- `lib/firebase/adminAuth.ts` — `ensureAdminAuth()`, a small helper the plain `set-registry`
  route (writes that don't need the scraping module) signs in with before writing; the sync
  routes instead call `catalog-sync.mjs`'s own `ensureSignedIn()`, which authenticates the same
  underlying Firebase Auth singleton (both resolve to the same app instance within one process —
  see that file's header comment) so either path leaves the process equally signed in.
- `app/api/sync/{pokemon,lorcana,riftbound,onepiece,mtg}/route.ts` — one route per game, `export
  const maxDuration` set generously (see Vercel's function-timeout docs for what your plan
  allows). Each returns `{ ok, setCount, newSets?, groupMatches? }` directly — no polling, no
  status file.
- `app/api/set-registry/route.ts` — `GET` returns the full registry; `PUT` does a structured
  patch of one set entry (used by the "Needs Review" editor, still on the Settings page); `POST`
  registers a brand new set (Admin Catalog "New Set"). All three read/write the Firestore doc via
  `lib/api/registry.ts`, never touch TypeScript source.

### Guardrails

- The Riftbound group-matching threshold is deliberately conservative (≥90% similarity with a
  confidence margin over the next-best candidate) — an unmatched set is left for manual review
  rather than risking a silently-wrong price feed.
- A confident name match that nonetheless yields zero priced cards after the repricing pass gets
  flagged `needsReview` anyway, as a second safety net against a coincidentally-plausible but wrong
  group ID.
- `syncToFirestore()`'s existing admin-edit-wins-over-resync protection (see [§4](#card-catalog-system--deep-dive-firestore-backed))
  is the only safety net now — there's no more pre-sync backup snapshot (`data/backups/<runId>/`
  doesn't exist anymore; it only made sense next to a local-file registry and local catalog JSON,
  both gone). Nothing is ever deleted by a sync, same as before, just no separate backup copy.

---

---

## Cron-Driven Price Sync

Before this, live price fetches happened on-demand, per user, every time anyone hit "Refresh
Prices" on Portfolio, plus a 30-minute auto-refresh that fired on every Portfolio page load. For
Riftbound that meant re-downloading and re-parsing every set's full `ProductsAndPrices.csv` live
on every single one of those calls (the single biggest external-API cost in the app, scaling with
every set ever added); for Lorcana it meant a live `api.lorcast.com` request per unique card (no
bulk endpoint exists), 8-way concurrency, making it the slowest game to refresh by far.

**The redesign:** live price fetches now happen in exactly one place — a scheduled sync, 4x/day
(intended as roughly 6am/12pm/6pm/12am) — instead of on every user's every page visit/click.

- **`app/api/cron/sync-prices/route.ts`** — `GET`/`POST`, protected by a shared secret
  (`CRON_SECRET` env var, checked against an `x-cron-secret` header or a `?secret=` query param —
  the query-param form exists because some free external schedulers can't set custom headers).
  Calls `runPokemonSync`/`runLorcanaSync`/`runRiftboundSync`/`runOnePieceSync` — plain functions
  exported from a sibling `sync.ts` module next to each game's `route.ts` (e.g.
  `app/api/sync/pokemon/sync.ts`), imported and invoked directly in-process (not over HTTP, no
  arguments) via `Promise.allSettled`, so one game failing/timing out doesn't block the others.
  The logic lives in `sync.ts` rather than being exported from `route.ts` itself for a build-level
  reason: Next.js's route-file export validator only allows a fixed allowlist of names
  (`GET`/`POST`/`dynamic`/`maxDuration`/...) from a `route.ts`, so a route.ts can't also export an
  arbitrary function the cron route could import — see [Firestore / User Data](#firestore--user-data)'s
  admin-auth paragraph for why this split exists at all (route.ts's own `POST` is now the
  auth-checked HTTP entry point; `sync.ts`'s function is the unauthenticated internal one the
  already-CRON_SECRET-checked cron route calls). `maxDuration = 300`, same headroom as the
  standalone Pokémon sync route, for the same reason (170+ sets, 20k+ cards).
- **MTG's full catalog sync is deliberately NOT included here.** Its first sync alone writes
  ~99,000 Firestore documents — far more than this cron route's other four games combined — which
  risks exceeding a Firebase Spark (free) plan's daily write quota in one automatic run. It only
  syncs via a manual Admin Catalog button click today. What *does* run automatically is
  `checkForNewMtgSets()` (`lib/api/mtg.ts`) — a read-only, zero-catalog-write check that fetches
  Scryfall's live set list and diffs it against a baseline stored in `sync_status/mtg-new-set-check`,
  so a new MTG set doesn't sit unnoticed between manual syncs, without the write-quota risk of a
  real sync. Both this check's own baseline write and `recordSyncStatus()`'s status write
  (`lib/api/syncStatus.ts`) target that same document — they use disjoint field sets and both pass
  `{ merge: true }`, which matters: an earlier version of this feature used a plain (non-merged)
  `setDoc` in both places, so each write silently wiped the other's fields and the check
  permanently reported zero new sets on every run after the first, with no error anywhere to
  surface it. `checkForNewMtgSets()` also explicitly calls `ensureAdminAuth()` itself now rather
  than relying on one of the other games' `ensureSignedIn()` calls happening to win the race
  inside the same `Promise.allSettled` — see [§11](#magic-the-gathering--data-source-schema-add-a-set-guide)
  and "MTG Integration.md" at the repo root for how to wire the real sync in once the write-quota
  concern is resolved.
- **Not a Vercel Cron job** — deliberately, so this works on Vercel plans that don't support
  sub-daily cron schedules. It's triggered by **`.github/workflows/sync-prices.yml`**, a scheduled
  GitHub Actions workflow checked into this repo (4x/day, `x-cron-secret` header sourced from a
  `CRON_SECRET` repository secret) — visible/runnable/auditable from the repo's Actions tab,
  including a manual "Run workflow" button for on-demand triggers. **Needs a one-time setup**
  before it actually fires: the workflow file has a placeholder Vercel URL that must be edited to
  your real deployment, and a `CRON_SECRET` GitHub repository secret matching the one in your
  Vercel project's env vars — see the comment block at the top of that file. (An external
  scheduler like cron-job.org would work exactly as well if you'd rather not use GitHub Actions —
  the route itself doesn't care who calls it, only that the secret matches.)
- **Portfolio's "Refresh Prices" button** (`components/pages/PortfolioPage.tsx`) no longer
  triggers any live external fetch, and the 30-minute auto-refresh-on-page-load is gone entirely
  — refresh only ever happens on an explicit click (or a price-mode toggle, which reuses the same
  function). It reads prices for just the apiIds already in Alex's own inventory from the catalog
  (`app/api/prices/{pokemon,lorcana,riftbound,onepiece,mtg}/route.ts`, all now plain in-memory
  `loadCatalog()` lookups, no network calls) and writes them into `currentPrice` + `priceHistory` exactly as
  before — this part (record a history point on every refresh) didn't change, see
  `applyPriceUpdatesBatch` in [Firestore / User Data](#firestore--user-data) below. Practically:
  price *history* granularity is now driven by how often Alex clicks Refresh, not a fixed timer —
  the catalog's own price data updates 4x/day regardless of whether anyone visits Portfolio at all.
- **Previously-known gap, now fixed:** `app/api/sync/{pokemon,lorcana,riftbound,onepiece,mtg}/route.ts`
  used to have no request-level auth check of their own — they only signed *themselves* in as the
  Firestore admin account internally, so anyone who knew the URL could POST to them directly and
  trigger a full resync (for MTG, that meant anyone who knew the URL could trigger the
  ~99,000-write sync this doc keeps warning about, entirely outside the deliberate manual-only
  gate described above). Every one of these routes' `POST` handlers now calls
  `verifyAdminRequest()` before doing anything — see [Firestore / User Data](#firestore--user-data)'s
  admin-auth paragraph for the mechanism. The cron route's own in-process calls (via each game's
  `sync.ts`) are unaffected, since they never go through `route.ts`'s `POST` at all. The same fix
  was applied to `/api/set-registry` (all three of PUT/POST/DELETE) and
  `/api/admin/catalog/invalidate`/`lookup`, which had the identical gap and weren't even
  documented as sharing it — see [§5](#admin-catalog-page--architecture-caching--diagnostics).

---
