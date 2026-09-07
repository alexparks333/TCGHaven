# Magic: The Gathering Integration — Status

Added as TCGHaven's 5th game, following the exact same architecture as Pokémon/Lorcana/
Riftbound/One Piece (Firestore-backed shared catalog, `lib/api/catalog.ts`'s
`loadVisibleCatalog()`, admin-only writes via the Admin Catalog page). **The code is fully
wired and tested — search, Cardex, Inventory, Portfolio pricing, the Admin Catalog page, the
sync route, and the set registry all support `mtg` end to end.** The one thing deliberately
**not** done yet is running a real sync — see below.

## Why the sync is on hold

MTG's card data source is Scryfall (`api.scryfall.com`), a free public API. Its bulk "every
paper printing" dataset is **~99,000 cards** — roughly 5-7x the size of any other game already
in this app. The very first sync writes one Firestore document per card, i.e. **~99,000 writes
in a single run**. If this Firebase project is still on the **Spark (free) plan**, that alone
blows past the **20,000 writes/day** quota and would block every other write for the rest of the
day — including the other four games' own scheduled syncs.

So: everything is built, but nothing has pulled MTG data into Firestore yet, and nothing runs it
automatically. Specifically:

- **`app/api/cron/sync-prices/route.ts`** (the 4x/day scheduled price refresh) does **not**
  call MTG's sync. It only syncs Pokémon/Lorcana/Riftbound/One Piece. (While in there, this also
  fixed a pre-existing bug: One Piece had been silently missing from this cron's game list too —
  that's fixed and stays fixed regardless of when MTG gets turned on.)
- **`npm run download-cards`** (the CLI catalog downloader) also skips MTG by default. Pass
  `--include-mtg` to include it once you're ready:
  ```bash
  npm run download-cards -- --include-mtg
  ```
- **Admin Catalog → "Sync Card Data" → Magic: The Gathering** button *is* live — clicking it
  triggers a real, one-time sync right now. This is the one path left deliberately manual: it's a
  single deliberate click, not a recurring background process, so it can't surprise you with a
  quota-busting write burst you didn't ask for.

## How to turn it on for real

1. **Check your Firebase billing plan first.** Firestore console → Usage tab, or Project
   Settings → Usage and billing. If you're on Spark, either upgrade to Blaze (pay-as-you-go —
   after the first ~99k-write sync, ongoing syncs only write *changed* cards, so this is a
   one-time cost, not a recurring one) or just accept that the first sync will need to happen
   across a few days under the free quota (not currently automated — you'd need to run it
   yourself in batches, which the code doesn't support out of the box today).
2. **Run the first sync**, either:
   - Admin Catalog page → Sync Card Data → click "Magic: The Gathering", or
   - `npm run download-cards -- --include-mtg` (no Vercel function timeout to worry about,
     unlike the Admin Catalog button — see the maxDuration caveat below).
3. **Wire it into the 4x/day cron** so prices stay fresh automatically going forward — edit
   `app/api/cron/sync-prices/route.ts`:
   - Add `import { POST as syncMtg } from '../../sync/mtg/route'` at the top.
   - Add `syncMtg()` to the `Promise.allSettled([...])` array in `runSync()`.
   - Add `summarize('mtg', mtg)` to the `Promise.all([...])` call right after, and destructure
     `mtg` out of the `Promise.allSettled` result alongside the other four.
   - (Everything else — the cron route's auth, `maxDuration`, error handling — already works
     unchanged; MTG just needs to be added to those two arrays.)
4. **Make the default CLI run include it going forward**, if you want `npm run download-cards`
   (no flag) to always include MTG from now on — edit `scripts/download-card-catalog.mjs` and
   remove the `includeMtg ? ... : Promise.resolve(...)` conditional, calling `downloadMTG()`
   unconditionally like the other four games.

## Other things worth knowing

- **Vercel function timeout risk is real and larger than Pokémon's.** `app/api/sync/mtg/route.ts`
  sets `maxDuration = 300` (5 minutes), same as Pokémon's sync route, but MTG's bulk file is
  bigger. On a Vercel plan with a shorter function timeout, the Admin Catalog button may time out
  before finishing. Firestore writes already committed aren't lost (the sync batches as it goes),
  so a timeout just means "re-click it" or fall back to the CLI, which has no such limit.
- **Scryfall's bulk-data format is gzip-compressed JSONL, not a plain JSON array**, and the
  decompressed text is large enough to exceed V8's max string length — `downloadMTG()` in
  `scripts/lib/catalog-sync.mjs` streams it (gunzip → readline, one JSON object per line) rather
  than loading it all into memory as one string or array. If you ever touch this code, re-verify
  Scryfall's bulk-data listing shape first (`GET https://api.scryfall.com/bulk-data`) — it's
  changed format before and the fetch there is currently pinned to today's `jsonl_download_uri`
  field.
- **Scope decisions already made** (per your answers when this was built): the catalog tracks
  every individual printing (not one row per unique card), and digital-only/token/art-series/
  memorabilia sets are excluded — see `MTG_EXCLUDED_SET_TYPES` in both
  `scripts/lib/catalog-sync.mjs` and `lib/api/mtg.ts`.
- **Scryfall requires a `User-Agent` and `Accept` header on every request** or it returns a
  plain 400 — already handled everywhere this app calls Scryfall (`lib/api/mtg.ts`'s
  `SCRYFALL_HEADERS`, mirrored in `catalog-sync.mjs` and the Admin Catalog lookup route), but
  worth knowing if you add another Scryfall call somewhere.
- Full architecture writeup (schema, price fields, Cardex grouping, add-a-set guide) lives in
  `CLAUDE.md`'s Magic: The Gathering section, written the same way every other game's section is.
