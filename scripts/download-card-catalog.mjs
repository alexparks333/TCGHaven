/**
 * Downloads all card catalogs (name, image, set, number) and syncs them into Firestore —
 * the shared, admin-only-writable catalog every copy of the app reads from (see
 * lib/api/catalog.ts and firestore.rules). Run once: npm run download-cards
 * Re-run whenever new sets release.
 *
 * Requires ADMIN_EMAIL/ADMIN_PASSWORD + the NEXT_PUBLIC_FIREBASE_* vars in .env.local — this
 * script parses that file itself (see loadEnvLocal() below) rather than relying on Node's
 * built-in `--env-file` flag. Signs in as the admin account (same as a real browser session)
 * rather than using a service-account key, so this script satisfies the exact same Firestore
 * security rules as the Admin Catalog page.
 *
 * The actual per-game scraping/sync logic lives in scripts/lib/catalog-sync.mjs, shared with
 * the Admin Catalog "Sync Card Data" Next.js API routes (app/api/sync/[game]/route.ts) — this
 * file is just the CLI entry point.
 *
 * MTG is deliberately NOT included in the default run below — its first sync alone writes
 * ~99,000 Firestore documents (far more than any other game here), which can blow through a
 * Firebase Spark (free) plan's 20k writes/day quota in one shot. Pass --include-mtg once you've
 * confirmed your plan/quota can take it (or just use Admin Catalog -> "Sync Card Data" -> Magic:
 * The Gathering for a one-off, no-code-change way to do the same thing). See "MTG Integration.md"
 * at the repo root for the full writeup.
 */

import fs from 'node:fs'

// ── .env.local loading ──────────────────────────────────────────────────────────────────────
// Deliberately NOT using Node's `--env-file` flag (as this script used to, via package.json's
// "download-cards" script) — it does not unescape a backslash-escaped `$` the way Next.js's own
// env loader (dotenv-expand) does. ADMIN_PASSWORD contains a `$`, escaped as `\$` in .env.local
// specifically so Next.js's loader (used by every other admin sign-in path — the Admin Catalog
// page, the sync API routes) reads it correctly; `node --env-file` instead left the literal
// backslash IN the value, sending Firebase a wrong (18-char, not 17-char) password and failing
// every sign-in with `auth/invalid-credential`. This was a real, previously-undiscovered bug —
// caught while diagnosing why Riftbound prices looked stale (the CLI fallback for manually
// re-syncing had been silently broken). Parsing the file here and unescaping `\$` ourselves
// matches what Next.js actually does, so this script's sign-in behaves identically to the web
// Admin Catalog page's. If a future secret contains `` ` `` or a bare `#`, the same class of
// mismatch is possible — see CLAUDE.md quirk #23.
function loadEnvLocal() {
  const path = new URL('../.env.local', import.meta.url)
  if (!fs.existsSync(path)) return
  const raw = fs.readFileSync(path, 'utf8')
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!m) continue
    const [, key, rawValue] = m
    if (process.env[key] !== undefined) continue // real env/shell vars win over the file
    process.env[key] = rawValue.replace(/\\\$/g, '$')
  }
}
loadEnvLocal()

// Imported dynamically, AFTER env vars are loaded above — scripts/lib/catalog-sync.mjs reads
// process.env.NEXT_PUBLIC_FIREBASE_* at module-load time (initializeApp() runs at import time),
// so a static top-level `import` here would run before loadEnvLocal() ever executed.
const { ensureSignedIn, downloadPokemon, downloadLorcana, downloadRiftbound, downloadOnePiece, downloadMTG } =
  await import('./lib/catalog-sync.mjs')

const includeMtg = process.argv.includes('--include-mtg')

console.log('📦 Downloading card catalogs...')
if (!includeMtg) console.log('   (skipping MTG — pass --include-mtg to include it; see "MTG Integration.md")')
await ensureSignedIn()
const [pokemon, lorcana, riftbound, onepiece, mtg] = await Promise.all([
  downloadPokemon(), downloadLorcana(), downloadRiftbound(), downloadOnePiece(),
  includeMtg ? downloadMTG() : Promise.resolve({ setNames: [] }),
])

console.log(`\n✅ Done. ${pokemon.setNames.length} Pokemon sets, ${lorcana.setNames.length} Lorcana sets, ${riftbound.setNames.length} Riftbound sets, ${onepiece.setNames.length} One Piece sets${includeMtg ? `, ${mtg.setNames.length} MTG sets` : ' (MTG skipped)'}.`)
