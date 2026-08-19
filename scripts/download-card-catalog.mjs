/**
 * Downloads all card catalogs (name, image, set, number) and syncs them into Firestore —
 * the shared, admin-only-writable catalog every copy of the app reads from (see
 * lib/api/catalog.ts and firestore.rules). Run once: npm run download-cards
 * Re-run whenever new sets release.
 *
 * Requires ADMIN_EMAIL/ADMIN_PASSWORD + the NEXT_PUBLIC_FIREBASE_* vars in .env.local — run
 * via `npm run download-cards`, which passes --env-file=.env.local. Signs in as the admin
 * account (same as a real browser session) rather than using a service-account key, so this
 * script satisfies the exact same Firestore security rules as the Admin Catalog page.
 *
 * The actual per-game scraping/sync logic lives in scripts/lib/catalog-sync.mjs, shared with
 * the Admin Catalog "Sync Card Data" Next.js API routes (app/api/sync/[game]/route.ts) — this
 * file is just the CLI entry point.
 */

import { ensureSignedIn, downloadPokemon, downloadLorcana, downloadRiftbound } from './lib/catalog-sync.mjs'

console.log('📦 Downloading card catalogs...')
await ensureSignedIn()
const [pokemon, lorcana, riftbound] =
  await Promise.all([downloadPokemon(), downloadLorcana(), downloadRiftbound()])

console.log(`\n✅ Done. ${pokemon.setNames.length} Pokemon sets, ${lorcana.setNames.length} Lorcana sets, ${riftbound.setNames.length} Riftbound sets.`)
