import type { Game } from '../types'

export type ProductType = 'pack' | 'booster-box' | 'etb' | 'bundle' | 'case' | 'pre-rift'

export interface SpendingProduct {
  id: string
  game: Game
  setCode: string
  setName: string
  type: ProductType
  name: string
  price: number
  imageUrl: string
  packsIncluded: number
  releaseDate: string
}

export const PRODUCT_TYPE_LABELS: Record<ProductType, string> = {
  'pack': 'Pack',
  'booster-box': 'Booster Box',
  'etb': 'ETB',
  'bundle': 'Bundle',
  'case': 'Case',
  'pre-rift': 'Pre-Rift',
}

export const PRODUCT_TYPE_COLORS: Record<ProductType, string> = {
  'pack': '#6366f1',
  'booster-box': '#f59e0b',
  'etb': '#10b981',
  'bundle': '#8b5cf6',
  'case': '#ef4444',
  'pre-rift': '#06b6d4',
}

// ── Pokemon CDN helpers ────────────────────────────────────────────────────────
// Confirmed CDN: d1i787aglh9bmb.cloudfront.net
// Pattern: /assets/img/sv-expansions/{folder}/collections/en-us/{code}-{type}-en.png
// Main sets: folder = sv{zero-padded} (sv07, sv08, sv09…)
// Half sets: folder = sv{n}dot5, code = sv{n}pt5 (e.g. sv8dot5 / sv8pt5)
const P = 'https://d1i787aglh9bmb.cloudfront.net/assets/img/sv-expansions'
const pokePack = (f: string, c: string) => `${P}/${f}/collections/en-us/${c}-booster-sleeve-en.png`
const pokeBox  = (f: string, c: string) => `${P}/${f}/collections/en-us/${c}-booster-display-en.png`
const pokeEtb  = (f: string, c: string) => `${P}/${f}/collections/en-us/${c}-etb-en.png`

// ── Riftbound CDN (Riot Games Sanity) — confirmed ─────────────────────────────
const RIFTBOUND_IMGS: Record<string, string> = {
  OGN: 'https://cdn.sanity.io/images/dsfx7636/consumer_products_live/e026ee1a44bc86095f9afc5949c5fdb519b29c66-2560x2560.png',
  SFD: 'https://cdn.sanity.io/images/dsfx7636/consumer_products_live/22aabf7f3ab0081cf42f6b4ebc4af4c5c92437f9-2560x2560.png',
  UNL: 'https://cdn.sanity.io/images/dsfx7636/consumer_products_live/46c776a96cc14227a260d24489f10b4090cd2cd9-2560x2560.png',
  VEN: '', // Vendetta — CDN hash TBD; update once confirmed on Riot/Sanity
}

// ── Lorcana CDN helpers ───────────────────────────────────────────────────────
// Booster boxes: Best Buy CDN (pisces.bbystatic.com) with known product SKUs
// Booster packs: Ravensburger cloud CDN (ravensburger.cloud/cms/gallery)
const BB = 'https://pisces.bbystatic.com/image2/BestBuy_US/images/products'
const bbBox = (sku: string) => `${BB}/${sku}/${sku}_sd.jpg`
const rcPack = (n: number) => `https://ravensburger.cloud/cms/gallery/s${n}-booster-wraps.png`
const TROVE_IMG = 'https://ravensburger.cloud/cms/gallery/trove.png'

export const SPENDING_CATALOG: SpendingProduct[] = [

  // ── POKEMON: Scarlet & Violet ─────────────────────────────────────────────
  // All SV sets newest first. Booster boxes = 36 packs unless noted.
  // Confirmed CloudFront CDN for sv07+, same pattern inferred for older sets.

  // Pitch Black (2026) - set me5 — non-SV set, no CloudFront CDN image available
  { id: 'poke-me5-pack', game: 'pokemon', setCode: 'me5', setName: 'Pitch Black', type: 'pack',        name: 'Booster Pack',     price: 4.99,   packsIncluded: 1,  releaseDate: '2026-07-01', imageUrl: '' },
  { id: 'poke-me5-etb',  game: 'pokemon', setCode: 'me5', setName: 'Pitch Black', type: 'etb',         name: 'Elite Trainer Box', price: 54.99, packsIncluded: 9,  releaseDate: '2026-07-01', imageUrl: '' },
  { id: 'poke-me5-box',  game: 'pokemon', setCode: 'me5', setName: 'Pitch Black', type: 'booster-box', name: 'Booster Box',       price: 143.99, packsIncluded: 36, releaseDate: '2026-07-01', imageUrl: '' },

  // Black Bolt (Jul 18, 2025) - set sv10pt5 / folder sv10dot5
  { id: 'poke-svblk-pack',  game: 'pokemon', setCode: 'svblk', setName: 'Black Bolt',  type: 'pack',        name: 'Booster Pack',     price: 4.99, packsIncluded: 1,  releaseDate: '2025-07-18', imageUrl: pokePack('sv10dot5', 'svblk') },
  { id: 'poke-svblk-etb',   game: 'pokemon', setCode: 'svblk', setName: 'Black Bolt',  type: 'etb',         name: 'Elite Trainer Box', price: 54.99, packsIncluded: 9, releaseDate: '2025-07-18', imageUrl: pokeEtb('sv10dot5', 'svblk') },
  { id: 'poke-svblk-box',   game: 'pokemon', setCode: 'svblk', setName: 'Black Bolt',  type: 'booster-box', name: 'Booster Box',       price: 143.99, packsIncluded: 36, releaseDate: '2025-07-18', imageUrl: pokeBox('sv10dot5', 'svblk') },

  // White Flare (Jul 18, 2025) - set sv10pt5 companion set
  { id: 'poke-svwf-pack',   game: 'pokemon', setCode: 'svwf',  setName: 'White Flare', type: 'pack',        name: 'Booster Pack',     price: 4.99, packsIncluded: 1,  releaseDate: '2025-07-18', imageUrl: pokePack('sv10dot5', 'svwf') },
  { id: 'poke-svwf-etb',    game: 'pokemon', setCode: 'svwf',  setName: 'White Flare', type: 'etb',         name: 'Elite Trainer Box', price: 54.99, packsIncluded: 9, releaseDate: '2025-07-18', imageUrl: pokeEtb('sv10dot5', 'svwf') },
  { id: 'poke-svwf-box',    game: 'pokemon', setCode: 'svwf',  setName: 'White Flare', type: 'booster-box', name: 'Booster Box',       price: 143.99, packsIncluded: 36, releaseDate: '2025-07-18', imageUrl: pokeBox('sv10dot5', 'svwf') },

  // Destined Rivals (May 30, 2025) - sv9pt5 / sv9dot5
  { id: 'poke-sv9pt5-pack', game: 'pokemon', setCode: 'sv9pt5', setName: 'Destined Rivals', type: 'pack',        name: 'Booster Pack',     price: 4.99, packsIncluded: 1,  releaseDate: '2025-05-30', imageUrl: pokePack('sv9dot5', 'sv9pt5') },
  { id: 'poke-sv9pt5-etb',  game: 'pokemon', setCode: 'sv9pt5', setName: 'Destined Rivals', type: 'etb',         name: 'Elite Trainer Box', price: 54.99, packsIncluded: 9, releaseDate: '2025-05-30', imageUrl: pokeEtb('sv9dot5', 'sv9pt5') },
  { id: 'poke-sv9pt5-box',  game: 'pokemon', setCode: 'sv9pt5', setName: 'Destined Rivals', type: 'booster-box', name: 'Booster Box',       price: 143.99, packsIncluded: 36, releaseDate: '2025-05-30', imageUrl: pokeBox('sv9dot5', 'sv9pt5') },

  // Journey Together (Mar 28, 2025) - sv09 ✓ CONFIRMED CDN
  { id: 'poke-sv09-pack', game: 'pokemon', setCode: 'sv9', setName: 'Journey Together', type: 'pack',        name: 'Booster Pack',         price: 4.99, packsIncluded: 1,   releaseDate: '2025-03-28', imageUrl: `${P}/sv09/collections/en-us/sv09-sleeved-boosters-en.png` },
  { id: 'poke-sv09-etb',  game: 'pokemon', setCode: 'sv9', setName: 'Journey Together', type: 'etb',         name: 'Elite Trainer Box',     price: 54.99, packsIncluded: 9,  releaseDate: '2025-03-28', imageUrl: pokeEtb('sv09', 'sv09') },
  { id: 'poke-sv09-box',  game: 'pokemon', setCode: 'sv9', setName: 'Journey Together', type: 'booster-box', name: 'Booster Box',           price: 143.99, packsIncluded: 36, releaseDate: '2025-03-28', imageUrl: pokeBox('sv09', 'sv09') },
  { id: 'poke-sv09-case', game: 'pokemon', setCode: 'sv9', setName: 'Journey Together', type: 'case',        name: 'Booster Case (6 Boxes)', price: 863.94, packsIncluded: 216, releaseDate: '2025-03-28', imageUrl: pokeBox('sv09', 'sv09') },

  // Prismatic Evolutions (Jan 17, 2025) - sv8pt5/sv8dot5 ✓ CONFIRMED CDN
  // No standard booster box — sold as Booster Bundle (6 packs) instead
  { id: 'poke-sv8pt5-pack',   game: 'pokemon', setCode: 'sv8pt5', setName: 'Prismatic Evolutions', type: 'pack',   name: 'Booster Pack',    price: 4.99, packsIncluded: 1, releaseDate: '2025-01-17', imageUrl: `${P}/sv8dot5/collections/en-us/sv8pt5-booster-bundle-en.png` },
  { id: 'poke-sv8pt5-etb',    game: 'pokemon', setCode: 'sv8pt5', setName: 'Prismatic Evolutions', type: 'etb',    name: 'Elite Trainer Box', price: 54.99, packsIncluded: 9, releaseDate: '2025-01-17', imageUrl: `${P}/sv8dot5/collections/en-us/sv8pt5-etb-en.png` },
  { id: 'poke-sv8pt5-bundle', game: 'pokemon', setCode: 'sv8pt5', setName: 'Prismatic Evolutions', type: 'bundle', name: 'Booster Bundle',  price: 24.99, packsIncluded: 6, releaseDate: '2025-01-17', imageUrl: `${P}/sv8dot5/collections/en-us/sv8pt5-booster-bundle-en.png` },

  // Surging Sparks (Nov 8, 2024) - sv08 ✓ CONFIRMED CDN
  { id: 'poke-sv08-pack', game: 'pokemon', setCode: 'sv8', setName: 'Surging Sparks', type: 'pack',        name: 'Booster Pack',         price: 4.99, packsIncluded: 1,   releaseDate: '2024-11-08', imageUrl: pokePack('sv08', 'sv08') },
  { id: 'poke-sv08-etb',  game: 'pokemon', setCode: 'sv8', setName: 'Surging Sparks', type: 'etb',         name: 'Elite Trainer Box',     price: 54.99, packsIncluded: 9,  releaseDate: '2024-11-08', imageUrl: pokeEtb('sv08', 'sv08') },
  { id: 'poke-sv08-box',  game: 'pokemon', setCode: 'sv8', setName: 'Surging Sparks', type: 'booster-box', name: 'Booster Box',           price: 143.99, packsIncluded: 36, releaseDate: '2024-11-08', imageUrl: pokeBox('sv08', 'sv08') },
  { id: 'poke-sv08-case', game: 'pokemon', setCode: 'sv8', setName: 'Surging Sparks', type: 'case',        name: 'Booster Case (6 Boxes)', price: 863.94, packsIncluded: 216, releaseDate: '2024-11-08', imageUrl: pokeBox('sv08', 'sv08') },

  // Stellar Crown (Sep 13, 2024) - sv07 ✓ CONFIRMED CDN
  { id: 'poke-sv07-pack', game: 'pokemon', setCode: 'sv7', setName: 'Stellar Crown', type: 'pack',        name: 'Booster Pack',         price: 4.99, packsIncluded: 1,   releaseDate: '2024-09-13', imageUrl: pokePack('sv07', 'sv07') },
  { id: 'poke-sv07-etb',  game: 'pokemon', setCode: 'sv7', setName: 'Stellar Crown', type: 'etb',         name: 'Elite Trainer Box',     price: 54.99, packsIncluded: 9,  releaseDate: '2024-09-13', imageUrl: pokeEtb('sv07', 'sv07') },
  { id: 'poke-sv07-box',  game: 'pokemon', setCode: 'sv7', setName: 'Stellar Crown', type: 'booster-box', name: 'Booster Box',           price: 143.99, packsIncluded: 36, releaseDate: '2024-09-13', imageUrl: pokeBox('sv07', 'sv07') },
  { id: 'poke-sv07-case', game: 'pokemon', setCode: 'sv7', setName: 'Stellar Crown', type: 'case',        name: 'Booster Case (6 Boxes)', price: 863.94, packsIncluded: 216, releaseDate: '2024-09-13', imageUrl: pokeBox('sv07', 'sv07') },

  // Shrouded Fable (Aug 2, 2024) - sv6pt5 / sv6dot5 — mini set, 18 packs/box
  { id: 'poke-sv6pt5-pack', game: 'pokemon', setCode: 'sv6pt5', setName: 'Shrouded Fable', type: 'pack',        name: 'Booster Pack',    price: 4.99, packsIncluded: 1,  releaseDate: '2024-08-02', imageUrl: pokePack('sv6dot5', 'sv6pt5') },
  { id: 'poke-sv6pt5-etb',  game: 'pokemon', setCode: 'sv6pt5', setName: 'Shrouded Fable', type: 'etb',         name: 'Elite Trainer Box', price: 49.99, packsIncluded: 8, releaseDate: '2024-08-02', imageUrl: pokeEtb('sv6dot5', 'sv6pt5') },
  { id: 'poke-sv6pt5-box',  game: 'pokemon', setCode: 'sv6pt5', setName: 'Shrouded Fable', type: 'booster-box', name: 'Mini Booster Box', price: 71.99, packsIncluded: 18, releaseDate: '2024-08-02', imageUrl: pokeBox('sv6dot5', 'sv6pt5') },

  // Twilight Masquerade (May 24, 2024) - sv06
  { id: 'poke-sv06-pack', game: 'pokemon', setCode: 'sv6', setName: 'Twilight Masquerade', type: 'pack',        name: 'Booster Pack',         price: 4.99, packsIncluded: 1,   releaseDate: '2024-05-24', imageUrl: pokePack('sv06', 'sv06') },
  { id: 'poke-sv06-etb',  game: 'pokemon', setCode: 'sv6', setName: 'Twilight Masquerade', type: 'etb',         name: 'Elite Trainer Box',     price: 54.99, packsIncluded: 9,  releaseDate: '2024-05-24', imageUrl: pokeEtb('sv06', 'sv06') },
  { id: 'poke-sv06-box',  game: 'pokemon', setCode: 'sv6', setName: 'Twilight Masquerade', type: 'booster-box', name: 'Booster Box',           price: 143.99, packsIncluded: 36, releaseDate: '2024-05-24', imageUrl: pokeBox('sv06', 'sv06') },
  { id: 'poke-sv06-case', game: 'pokemon', setCode: 'sv6', setName: 'Twilight Masquerade', type: 'case',        name: 'Booster Case (6 Boxes)', price: 863.94, packsIncluded: 216, releaseDate: '2024-05-24', imageUrl: pokeBox('sv06', 'sv06') },

  // Temporal Forces (Mar 22, 2024) - sv05
  { id: 'poke-sv05-pack', game: 'pokemon', setCode: 'sv5', setName: 'Temporal Forces', type: 'pack',        name: 'Booster Pack',         price: 4.99, packsIncluded: 1,   releaseDate: '2024-03-22', imageUrl: pokePack('sv05', 'sv05') },
  { id: 'poke-sv05-etb',  game: 'pokemon', setCode: 'sv5', setName: 'Temporal Forces', type: 'etb',         name: 'Elite Trainer Box',     price: 54.99, packsIncluded: 9,  releaseDate: '2024-03-22', imageUrl: pokeEtb('sv05', 'sv05') },
  { id: 'poke-sv05-box',  game: 'pokemon', setCode: 'sv5', setName: 'Temporal Forces', type: 'booster-box', name: 'Booster Box',           price: 143.99, packsIncluded: 36, releaseDate: '2024-03-22', imageUrl: pokeBox('sv05', 'sv05') },
  { id: 'poke-sv05-case', game: 'pokemon', setCode: 'sv5', setName: 'Temporal Forces', type: 'case',        name: 'Booster Case (6 Boxes)', price: 863.94, packsIncluded: 216, releaseDate: '2024-03-22', imageUrl: pokeBox('sv05', 'sv05') },

  // Paldean Fates (Jan 26, 2024) - sv4pt5 / sv4dot5 — special all-holo, 16 packs/box
  { id: 'poke-sv4pt5-pack', game: 'pokemon', setCode: 'sv4pt5', setName: 'Paldean Fates', type: 'pack',        name: 'Booster Pack',    price: 4.99, packsIncluded: 1,  releaseDate: '2024-01-26', imageUrl: pokePack('sv4dot5', 'sv4pt5') },
  { id: 'poke-sv4pt5-etb',  game: 'pokemon', setCode: 'sv4pt5', setName: 'Paldean Fates', type: 'etb',         name: 'Elite Trainer Box', price: 54.99, packsIncluded: 9, releaseDate: '2024-01-26', imageUrl: pokeEtb('sv4dot5', 'sv4pt5') },
  { id: 'poke-sv4pt5-box',  game: 'pokemon', setCode: 'sv4pt5', setName: 'Paldean Fates', type: 'booster-box', name: 'Booster Box',      price: 79.99, packsIncluded: 16, releaseDate: '2024-01-26', imageUrl: pokeBox('sv4dot5', 'sv4pt5') },

  // Paradox Rift (Nov 3, 2023) - sv04
  { id: 'poke-sv04-pack', game: 'pokemon', setCode: 'sv4', setName: 'Paradox Rift', type: 'pack',        name: 'Booster Pack',         price: 4.99, packsIncluded: 1,   releaseDate: '2023-11-03', imageUrl: pokePack('sv04', 'sv04') },
  { id: 'poke-sv04-etb',  game: 'pokemon', setCode: 'sv4', setName: 'Paradox Rift', type: 'etb',         name: 'Elite Trainer Box',     price: 54.99, packsIncluded: 9,  releaseDate: '2023-11-03', imageUrl: pokeEtb('sv04', 'sv04') },
  { id: 'poke-sv04-box',  game: 'pokemon', setCode: 'sv4', setName: 'Paradox Rift', type: 'booster-box', name: 'Booster Box',           price: 143.99, packsIncluded: 36, releaseDate: '2023-11-03', imageUrl: pokeBox('sv04', 'sv04') },
  { id: 'poke-sv04-case', game: 'pokemon', setCode: 'sv4', setName: 'Paradox Rift', type: 'case',        name: 'Booster Case (6 Boxes)', price: 863.94, packsIncluded: 216, releaseDate: '2023-11-03', imageUrl: pokeBox('sv04', 'sv04') },

  // Pokémon 151 (Sep 22, 2023) - sv3pt5 — mini set, 16 packs/box
  { id: 'poke-sv3pt5-pack', game: 'pokemon', setCode: 'sv3pt5', setName: 'Pokémon 151', type: 'pack',        name: 'Booster Pack',    price: 4.99, packsIncluded: 1,  releaseDate: '2023-09-22', imageUrl: pokePack('sv3dot5', 'sv3pt5') },
  { id: 'poke-sv3pt5-etb',  game: 'pokemon', setCode: 'sv3pt5', setName: 'Pokémon 151', type: 'etb',         name: 'Elite Trainer Box', price: 54.99, packsIncluded: 9, releaseDate: '2023-09-22', imageUrl: pokeEtb('sv3dot5', 'sv3pt5') },
  { id: 'poke-sv3pt5-box',  game: 'pokemon', setCode: 'sv3pt5', setName: 'Pokémon 151', type: 'booster-box', name: 'Booster Box',      price: 79.99, packsIncluded: 16, releaseDate: '2023-09-22', imageUrl: pokeBox('sv3dot5', 'sv3pt5') },

  // Obsidian Flames (Aug 11, 2023) - sv03
  { id: 'poke-sv03-pack', game: 'pokemon', setCode: 'sv3', setName: 'Obsidian Flames', type: 'pack',        name: 'Booster Pack',         price: 4.99, packsIncluded: 1,   releaseDate: '2023-08-11', imageUrl: pokePack('sv03', 'sv03') },
  { id: 'poke-sv03-etb',  game: 'pokemon', setCode: 'sv3', setName: 'Obsidian Flames', type: 'etb',         name: 'Elite Trainer Box',     price: 54.99, packsIncluded: 9,  releaseDate: '2023-08-11', imageUrl: pokeEtb('sv03', 'sv03') },
  { id: 'poke-sv03-box',  game: 'pokemon', setCode: 'sv3', setName: 'Obsidian Flames', type: 'booster-box', name: 'Booster Box',           price: 143.99, packsIncluded: 36, releaseDate: '2023-08-11', imageUrl: pokeBox('sv03', 'sv03') },
  { id: 'poke-sv03-case', game: 'pokemon', setCode: 'sv3', setName: 'Obsidian Flames', type: 'case',        name: 'Booster Case (6 Boxes)', price: 863.94, packsIncluded: 216, releaseDate: '2023-08-11', imageUrl: pokeBox('sv03', 'sv03') },

  // Paldea Evolved (Jun 9, 2023) - sv02
  { id: 'poke-sv02-pack', game: 'pokemon', setCode: 'sv2', setName: 'Paldea Evolved', type: 'pack',        name: 'Booster Pack',         price: 4.99, packsIncluded: 1,   releaseDate: '2023-06-09', imageUrl: pokePack('sv02', 'sv02') },
  { id: 'poke-sv02-etb',  game: 'pokemon', setCode: 'sv2', setName: 'Paldea Evolved', type: 'etb',         name: 'Elite Trainer Box',     price: 54.99, packsIncluded: 9,  releaseDate: '2023-06-09', imageUrl: pokeEtb('sv02', 'sv02') },
  { id: 'poke-sv02-box',  game: 'pokemon', setCode: 'sv2', setName: 'Paldea Evolved', type: 'booster-box', name: 'Booster Box',           price: 143.99, packsIncluded: 36, releaseDate: '2023-06-09', imageUrl: pokeBox('sv02', 'sv02') },
  { id: 'poke-sv02-case', game: 'pokemon', setCode: 'sv2', setName: 'Paldea Evolved', type: 'case',        name: 'Booster Case (6 Boxes)', price: 863.94, packsIncluded: 216, releaseDate: '2023-06-09', imageUrl: pokeBox('sv02', 'sv02') },

  // Scarlet & Violet Base (Mar 31, 2023) - sv01
  { id: 'poke-sv01-pack', game: 'pokemon', setCode: 'sv1', setName: 'Scarlet & Violet', type: 'pack',        name: 'Booster Pack',         price: 4.99, packsIncluded: 1,   releaseDate: '2023-03-31', imageUrl: pokePack('sv01', 'sv01') },
  { id: 'poke-sv01-etb',  game: 'pokemon', setCode: 'sv1', setName: 'Scarlet & Violet', type: 'etb',         name: 'Elite Trainer Box',     price: 54.99, packsIncluded: 9,  releaseDate: '2023-03-31', imageUrl: pokeEtb('sv01', 'sv01') },
  { id: 'poke-sv01-box',  game: 'pokemon', setCode: 'sv1', setName: 'Scarlet & Violet', type: 'booster-box', name: 'Booster Box',           price: 143.99, packsIncluded: 36, releaseDate: '2023-03-31', imageUrl: pokeBox('sv01', 'sv01') },
  { id: 'poke-sv01-case', game: 'pokemon', setCode: 'sv1', setName: 'Scarlet & Violet', type: 'case',        name: 'Booster Case (6 Boxes)', price: 863.94, packsIncluded: 216, releaseDate: '2023-03-31', imageUrl: pokeBox('sv01', 'sv01') },


  // ── LORCANA ───────────────────────────────────────────────────────────────────
  // All mainline sets — 24 packs per booster box, 12 cards per pack
  // Box images: Best Buy CDN with confirmed SKUs; pack images: Ravensburger cloud (s{n} pattern)

  // Attack of the Vine! (Jul 24, 2026) — set 13
  { id: 'lorcana-aov-pack',  game: 'lorcana', setCode: 'AOV', setName: 'Attack of the Vine!', type: 'pack',        name: 'Booster Pack',      price: 5.99, packsIncluded: 1,  releaseDate: '2026-07-24', imageUrl: rcPack(13) },
  { id: 'lorcana-aov-trove', game: 'lorcana', setCode: 'AOV', setName: 'Attack of the Vine!', type: 'etb',         name: "Illumineer's Trove", price: 39.99, packsIncluded: 8, releaseDate: '2026-07-24', imageUrl: TROVE_IMG },
  { id: 'lorcana-aov-box',   game: 'lorcana', setCode: 'AOV', setName: 'Attack of the Vine!', type: 'booster-box', name: 'Booster Box',        price: 143.76, packsIncluded: 24, releaseDate: '2026-07-24', imageUrl: rcPack(13) },

  // Wilds Unknown (May 15, 2026) — set 12
  { id: 'lorcana-wiu-pack',  game: 'lorcana', setCode: 'WIU', setName: 'Wilds Unknown',      type: 'pack',        name: 'Booster Pack',      price: 5.99, packsIncluded: 1,  releaseDate: '2026-05-15', imageUrl: rcPack(12) },
  { id: 'lorcana-wiu-trove', game: 'lorcana', setCode: 'WIU', setName: 'Wilds Unknown',      type: 'etb',         name: "Illumineer's Trove", price: 39.99, packsIncluded: 8, releaseDate: '2026-05-15', imageUrl: TROVE_IMG },
  { id: 'lorcana-wiu-box',   game: 'lorcana', setCode: 'WIU', setName: 'Wilds Unknown',      type: 'booster-box', name: 'Booster Box',        price: 143.76, packsIncluded: 24, releaseDate: '2026-05-15', imageUrl: rcPack(12) },

  // Winterspell (Feb 13, 2026) — set 11, SKU: 6667311
  { id: 'lorcana-wsp-pack',  game: 'lorcana', setCode: 'WSP', setName: 'Winterspell',        type: 'pack',        name: 'Booster Pack',      price: 5.99, packsIncluded: 1,  releaseDate: '2026-02-13', imageUrl: rcPack(11) },
  { id: 'lorcana-wsp-trove', game: 'lorcana', setCode: 'WSP', setName: 'Winterspell',        type: 'etb',         name: "Illumineer's Trove", price: 39.99, packsIncluded: 8, releaseDate: '2026-02-13', imageUrl: TROVE_IMG },
  { id: 'lorcana-wsp-box',   game: 'lorcana', setCode: 'WSP', setName: 'Winterspell',        type: 'booster-box', name: 'Booster Box',        price: 143.76, packsIncluded: 24, releaseDate: '2026-02-13', imageUrl: bbBox('6667311') },

  // Whispers in the Well (Nov 7, 2025) — set 10
  { id: 'lorcana-wiw-pack',  game: 'lorcana', setCode: 'WIW', setName: 'Whispers in the Well', type: 'pack',        name: 'Booster Pack',      price: 5.99, packsIncluded: 1,  releaseDate: '2025-11-07', imageUrl: rcPack(10) },
  { id: 'lorcana-wiw-trove', game: 'lorcana', setCode: 'WIW', setName: 'Whispers in the Well', type: 'etb',         name: "Illumineer's Trove", price: 39.99, packsIncluded: 8, releaseDate: '2025-11-07', imageUrl: TROVE_IMG },
  { id: 'lorcana-wiw-box',   game: 'lorcana', setCode: 'WIW', setName: 'Whispers in the Well', type: 'booster-box', name: 'Booster Box',        price: 143.76, packsIncluded: 24, releaseDate: '2025-11-07', imageUrl: rcPack(10) },

  // Fabled (Aug 29, 2025) — set 9, SKU: 6636708
  { id: 'lorcana-fab-pack',  game: 'lorcana', setCode: 'FAB', setName: 'Fabled',             type: 'pack',        name: 'Booster Pack',      price: 5.99, packsIncluded: 1,  releaseDate: '2025-08-29', imageUrl: rcPack(9) },
  { id: 'lorcana-fab-trove', game: 'lorcana', setCode: 'FAB', setName: 'Fabled',             type: 'etb',         name: "Illumineer's Trove", price: 39.99, packsIncluded: 8, releaseDate: '2025-08-29', imageUrl: TROVE_IMG },
  { id: 'lorcana-fab-box',   game: 'lorcana', setCode: 'FAB', setName: 'Fabled',             type: 'booster-box', name: 'Booster Box',        price: 143.76, packsIncluded: 24, releaseDate: '2025-08-29', imageUrl: bbBox('6636708') },

  // Reign of Jafar (May 30, 2025) — set 8, SKU: 6626489
  { id: 'lorcana-roj-pack',  game: 'lorcana', setCode: 'ROJ', setName: 'Reign of Jafar',    type: 'pack',        name: 'Booster Pack',      price: 5.99, packsIncluded: 1,  releaseDate: '2025-05-30', imageUrl: rcPack(8) },
  { id: 'lorcana-roj-trove', game: 'lorcana', setCode: 'ROJ', setName: 'Reign of Jafar',    type: 'etb',         name: "Illumineer's Trove", price: 39.99, packsIncluded: 8, releaseDate: '2025-05-30', imageUrl: TROVE_IMG },
  { id: 'lorcana-roj-box',   game: 'lorcana', setCode: 'ROJ', setName: 'Reign of Jafar',    type: 'booster-box', name: 'Booster Box',        price: 143.76, packsIncluded: 24, releaseDate: '2025-05-30', imageUrl: bbBox('6626489') },

  // Archazia's Island (Mar 7, 2025) — set 7, SKU: 6612230
  { id: 'lorcana-arc-pack',  game: 'lorcana', setCode: 'ARC', setName: "Archazia's Island", type: 'pack',        name: 'Booster Pack',      price: 5.99, packsIncluded: 1,  releaseDate: '2025-03-07', imageUrl: rcPack(7) },
  { id: 'lorcana-arc-trove', game: 'lorcana', setCode: 'ARC', setName: "Archazia's Island", type: 'etb',         name: "Illumineer's Trove", price: 39.99, packsIncluded: 8, releaseDate: '2025-03-07', imageUrl: TROVE_IMG },
  { id: 'lorcana-arc-box',   game: 'lorcana', setCode: 'ARC', setName: "Archazia's Island", type: 'booster-box', name: 'Booster Box',        price: 143.76, packsIncluded: 24, releaseDate: '2025-03-07', imageUrl: bbBox('6612230') },

  // Azurite Sea (Nov 14, 2024) — set 6, SKU: 6599866
  { id: 'lorcana-azs-pack',  game: 'lorcana', setCode: 'AZS', setName: 'Azurite Sea',       type: 'pack',        name: 'Booster Pack',      price: 5.99, packsIncluded: 1,  releaseDate: '2024-11-14', imageUrl: rcPack(6) },
  { id: 'lorcana-azs-trove', game: 'lorcana', setCode: 'AZS', setName: 'Azurite Sea',       type: 'etb',         name: "Illumineer's Trove", price: 39.99, packsIncluded: 8, releaseDate: '2024-11-14', imageUrl: TROVE_IMG },
  { id: 'lorcana-azs-box',   game: 'lorcana', setCode: 'AZS', setName: 'Azurite Sea',       type: 'booster-box', name: 'Booster Box',        price: 143.76, packsIncluded: 24, releaseDate: '2024-11-14', imageUrl: bbBox('6599866') },

  // Shimmering Skies (Aug 9, 2024) — set 5, SKU: 6587251
  { id: 'lorcana-ssk-pack',  game: 'lorcana', setCode: 'SSK', setName: 'Shimmering Skies',  type: 'pack',        name: 'Booster Pack',      price: 5.99, packsIncluded: 1,  releaseDate: '2024-08-09', imageUrl: rcPack(5) },
  { id: 'lorcana-ssk-trove', game: 'lorcana', setCode: 'SSK', setName: 'Shimmering Skies',  type: 'etb',         name: "Illumineer's Trove", price: 39.99, packsIncluded: 8, releaseDate: '2024-08-09', imageUrl: TROVE_IMG },
  { id: 'lorcana-ssk-box',   game: 'lorcana', setCode: 'SSK', setName: 'Shimmering Skies',  type: 'booster-box', name: 'Booster Box',        price: 143.76, packsIncluded: 24, releaseDate: '2024-08-09', imageUrl: bbBox('6587251') },

  // Ursula's Return (May 17, 2024) — set 4, SKU: 6579676
  { id: 'lorcana-urs-pack',  game: 'lorcana', setCode: 'URS', setName: "Ursula's Return",   type: 'pack',        name: 'Booster Pack',      price: 5.99, packsIncluded: 1,  releaseDate: '2024-05-17', imageUrl: rcPack(4) },
  { id: 'lorcana-urs-trove', game: 'lorcana', setCode: 'URS', setName: "Ursula's Return",   type: 'etb',         name: "Illumineer's Trove", price: 39.99, packsIncluded: 8, releaseDate: '2024-05-17', imageUrl: TROVE_IMG },
  { id: 'lorcana-urs-box',   game: 'lorcana', setCode: 'URS', setName: "Ursula's Return",   type: 'booster-box', name: 'Booster Box',        price: 143.76, packsIncluded: 24, releaseDate: '2024-05-17', imageUrl: bbBox('6579676') },

  // Into the Inklands (Feb 23, 2024) — set 3, SKU: 6571706
  { id: 'lorcana-iti-pack',  game: 'lorcana', setCode: 'ITI', setName: 'Into the Inklands', type: 'pack',        name: 'Booster Pack',      price: 5.99, packsIncluded: 1,  releaseDate: '2024-02-23', imageUrl: rcPack(3) },
  { id: 'lorcana-iti-trove', game: 'lorcana', setCode: 'ITI', setName: 'Into the Inklands', type: 'etb',         name: "Illumineer's Trove", price: 39.99, packsIncluded: 8, releaseDate: '2024-02-23', imageUrl: TROVE_IMG },
  { id: 'lorcana-iti-box',   game: 'lorcana', setCode: 'ITI', setName: 'Into the Inklands', type: 'booster-box', name: 'Booster Box',        price: 143.76, packsIncluded: 24, releaseDate: '2024-02-23', imageUrl: bbBox('6571706') },

  // Rise of the Floodborn (Nov 17, 2023) — set 2
  { id: 'lorcana-rof-pack',  game: 'lorcana', setCode: 'ROF', setName: 'Rise of the Floodborn', type: 'pack',        name: 'Booster Pack',      price: 5.99, packsIncluded: 1,  releaseDate: '2023-11-17', imageUrl: rcPack(2) },
  { id: 'lorcana-rof-trove', game: 'lorcana', setCode: 'ROF', setName: 'Rise of the Floodborn', type: 'etb',         name: "Illumineer's Trove", price: 39.99, packsIncluded: 8, releaseDate: '2023-11-17', imageUrl: TROVE_IMG },
  { id: 'lorcana-rof-box',   game: 'lorcana', setCode: 'ROF', setName: 'Rise of the Floodborn', type: 'booster-box', name: 'Booster Box',        price: 143.76, packsIncluded: 24, releaseDate: '2023-11-17', imageUrl: rcPack(2) },

  // The First Chapter (Aug 18, 2023) — set 1
  { id: 'lorcana-tfc-pack',  game: 'lorcana', setCode: 'TFC', setName: 'The First Chapter',     type: 'pack',        name: 'Booster Pack',      price: 5.99, packsIncluded: 1,  releaseDate: '2023-08-18', imageUrl: rcPack(1) },
  { id: 'lorcana-tfc-trove', game: 'lorcana', setCode: 'TFC', setName: 'The First Chapter',     type: 'etb',         name: "Illumineer's Trove", price: 39.99, packsIncluded: 8, releaseDate: '2023-08-18', imageUrl: TROVE_IMG },
  { id: 'lorcana-tfc-box',   game: 'lorcana', setCode: 'TFC', setName: 'The First Chapter',     type: 'booster-box', name: 'Booster Box',        price: 143.76, packsIncluded: 24, releaseDate: '2023-08-18', imageUrl: `https://ravensburger.cloud/cms/gallery/s1-booster-wraps-carousel.png` },


  // ── RIFTBOUND ─────────────────────────────────────────────────────────────────
  // 14 cards per pack, 24 packs per booster display. Prices: $4.99/pack, $89.99/box.
  // All images confirmed from Riot Games / Sanity CDN.

  // Vendetta (Jul 31, 2026)
  { id: 'riftbound-ven-prerift', game: 'riftbound', setCode: 'VEN', setName: 'Vendetta',   type: 'pre-rift',    name: 'Pre-Rift Bundle', price: 35.00, packsIncluded: 6, releaseDate: '2026-07-31', imageUrl: RIFTBOUND_IMGS.VEN },
  { id: 'riftbound-ven-pack',    game: 'riftbound', setCode: 'VEN', setName: 'Vendetta',   type: 'pack',        name: 'Booster Pack',    price: 4.99,  packsIncluded: 1,  releaseDate: '2026-07-31', imageUrl: RIFTBOUND_IMGS.VEN },
  { id: 'riftbound-ven-box',     game: 'riftbound', setCode: 'VEN', setName: 'Vendetta',   type: 'booster-box', name: 'Booster Box',     price: 89.99, packsIncluded: 24, releaseDate: '2026-07-31', imageUrl: RIFTBOUND_IMGS.VEN },

  // Unleashed (May 8, 2026)
  { id: 'riftbound-unl-prerift', game: 'riftbound', setCode: 'UNL', setName: 'Unleashed',    type: 'pre-rift',    name: 'Pre-Rift Bundle', price: 35.00, packsIncluded: 6, releaseDate: '2026-05-08', imageUrl: RIFTBOUND_IMGS.UNL },
  { id: 'riftbound-unl-pack',    game: 'riftbound', setCode: 'UNL', setName: 'Unleashed',    type: 'pack',        name: 'Booster Pack',    price: 4.99,  packsIncluded: 1,  releaseDate: '2026-05-08', imageUrl: RIFTBOUND_IMGS.UNL },
  { id: 'riftbound-unl-box',     game: 'riftbound', setCode: 'UNL', setName: 'Unleashed',    type: 'booster-box', name: 'Booster Box',     price: 89.99, packsIncluded: 24, releaseDate: '2026-05-08', imageUrl: RIFTBOUND_IMGS.UNL },

  // Spiritforged (Feb 13, 2026)
  { id: 'riftbound-sfd-prerift', game: 'riftbound', setCode: 'SFD', setName: 'Spiritforged', type: 'pre-rift',    name: 'Pre-Rift Bundle', price: 35.00, packsIncluded: 6, releaseDate: '2026-02-13', imageUrl: RIFTBOUND_IMGS.SFD },
  { id: 'riftbound-sfd-pack',    game: 'riftbound', setCode: 'SFD', setName: 'Spiritforged', type: 'pack',        name: 'Booster Pack',    price: 4.99,  packsIncluded: 1,  releaseDate: '2026-02-13', imageUrl: RIFTBOUND_IMGS.SFD },
  { id: 'riftbound-sfd-box',     game: 'riftbound', setCode: 'SFD', setName: 'Spiritforged', type: 'booster-box', name: 'Booster Box',     price: 89.99, packsIncluded: 24, releaseDate: '2026-02-13', imageUrl: RIFTBOUND_IMGS.SFD },

  // Origins (Oct 31, 2025)
  { id: 'riftbound-ogn-prerift', game: 'riftbound', setCode: 'OGN', setName: 'Origins',      type: 'pre-rift',    name: 'Pre-Rift Bundle', price: 35.00, packsIncluded: 6, releaseDate: '2025-10-31', imageUrl: RIFTBOUND_IMGS.OGN },
  { id: 'riftbound-ogn-pack',    game: 'riftbound', setCode: 'OGN', setName: 'Origins',      type: 'pack',        name: 'Booster Pack',    price: 4.99,  packsIncluded: 1,  releaseDate: '2025-10-31', imageUrl: RIFTBOUND_IMGS.OGN },
  { id: 'riftbound-ogn-box',     game: 'riftbound', setCode: 'OGN', setName: 'Origins',      type: 'booster-box', name: 'Booster Box',     price: 89.99, packsIncluded: 24, releaseDate: '2025-10-31', imageUrl: RIFTBOUND_IMGS.OGN },
]
