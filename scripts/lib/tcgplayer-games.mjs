// Catalogs built straight from TCGplayer (tcgcsv) for the games that have no other source:
// Star Wars: Unlimited, Gundam, Flesh and Blood, Digimon, Palworld. Pure — data in, catalog out,
// no network or Firestore. catalog-sync.mjs (planTcgplayerGame / downloadTcgplayerGame) fetches
// and writes; scripts/tcgplayer-games-report.mjs checks; tests: `npm run test:tcgplayer-games`.
// Design and decisions: docs/games.md ("TCGplayer-sourced games").
//
// The same shape as Yu-Gi-Oh! (yugioh-tcgplayer.mjs), with one settings block per game:
//  - One TCGplayer product = one catalog card, id `tcg-{productId}` — set once, never changes.
//    Versions TCGplayer sells as their own product (Hyperspace, parallels, alternate arts, prize
//    copies…) are their own cards; the bracketed version goes in `variant`.
//  - A product is a single if it has a printed number or a rarity (sealed product has neither).
//  - Prices: 'foil' games keep the classic pair — marketPrice (Normal) + marketPriceFoil (Foil /
//    Holofoil) — and use the Foil checkbox like Lorcana. Flesh and Blood ('printings') prices
//    every edition × finish in `variantPrices` ("1st:rainbow"), Pokémon's scheme.
//  - An existing card never changes what it shows; only prices refresh, and a price TCGplayer
//    doesn't have today keeps its last value.
//
// Scope (owner, 2026-11-10): English singles from each game's TCGplayer category.

import { variantPrice, defaultEdition } from './pokemon-variants.mjs'

// ── The games ────────────────────────────────────────────────────────────────

/**
 * category — tcgcsv category id. minGroups — refuse to sync if TCGplayer returns fewer (a partial
 * list). keepInName — a trailing "(…)" that is part of the printed name, not a version.
 * number — the printed number from TCGplayer's. extras — catalog field ← TCGplayer ext column.
 * setTypes — [type, regex] checked in order against the set name; else `fallbackType`.
 */
export const TCGPLAYER_GAMES = {
  swu: {
    label: 'Star Wars: Unlimited',
    category: 79,
    minGroups: 25,
    priceModel: 'foil',
    keepInName: null,
    number: (n) => n,
    extras: { aspect: 'Aspect', arena: 'Arena Type' },
    setTypes: [
      ['promo', /promo|judge|exclusive|championship|gift box|prize/i],
      ['starter', /intro battle|twin suns|starter/i],
    ],
    fallbackType: 'booster',
    setTypeLabels: { booster: 'Main Sets', starter: 'Starter & Intro Decks', promo: 'Promos & Events' },
  },
  gundam: {
    label: 'Gundam',
    category: 86,
    minGroups: 20,
    priceModel: 'foil',
    // Mobile suit forms are part of the name — "Full Armor Unicorn Gundam (Destroy Mode)". Only
    // rarity marks and where-it-came-from labels are versions.
    variantOnly: /\+|^(SP|EX|GQ|LR|R|U|C|Link Rare|Top|Finalist|Champion)$|^\d+$|^[A-Z]{1,4}\d*-\d{3}$|pack|collection|\bset\b|sleeves|event|championship|tournament|anniversary|promo|release|premium|resource|regional|participa|winner|accessory|serial|newtype challenge|mission \d|deck build box|fest\b|expo\b|top \d/i,
    number: (n) => n,
    extras: { color: 'Color' },
    setTypes: [
      ['promo', /promo|token/i],
      ['starter', /starter deck|deck build box/i],
      ['special', /edition beta/i],
    ],
    fallbackType: 'booster',
    setTypeLabels: { booster: 'Booster Sets', starter: 'Starter Decks', special: 'Edition Beta', promo: 'Promos & Tokens' },
  },
  fab: {
    label: 'Flesh and Blood',
    category: 62,
    minGroups: 80,
    priceModel: 'printings',
    // A card's pitch is part of its name — "Rising Energy (Red)" and "(Blue)" are different cards
    keepInName: /^(Red|Yellow|Blue)$/,
    number: (n) => n.replace(/\s*\/\/\s*/g, ' // '),
    extras: { cardClass: 'Class', pitch: 'Pitch Value' },
    setTypes: [
      ['promo', /promo|pre-?release/i],
      ['deck', /\bdeck\b|classic battles|round the table/i],
      ['special', /history pack|historic|gem pack|mastery pack|compendium|1st strike|silver age|smash palace|super slam/i],
    ],
    fallbackType: 'booster',
    setTypeLabels: { booster: 'Booster Sets', special: 'Special & Collector Sets', deck: 'Blitz, Armory & Hero Decks', promo: 'Promos' },
  },
  digimon: {
    label: 'Digimon',
    category: 63,
    minGroups: 80,
    priceModel: 'foil',
    // "(X Antibody)" is a Digimon's own name — "Omnimon (X Antibody)"
    keepInName: /^X Antibody$/i,
    // TCGplayer glues the rarity on: "BT26-066 C" → "BT26-066"
    number: (n) => n.split(/\s+/)[0],
    extras: { color: 'Color' },
    setTypes: [
      ['promo', /promotion|promo|pre-release|release event|celebration event|demo deck|revision pack/i],
      ['starter', /starter deck|premium deck set/i],
      ['special', /limited card pack|special limited|special booster|resurgence|classic collection|alternative being|advanced booster/i],
    ],
    fallbackType: 'booster',
    setTypeLabels: { booster: 'Booster Sets', special: 'Special Boosters & Packs', starter: 'Starter Decks', promo: 'Promos & Events' },
  },
  palworld: {
    label: 'Palworld',
    category: 91,
    minGroups: 6,
    priceModel: 'foil',
    keepInName: null,
    // Rarity tags are sometimes typed without a space: "Pengullet - Frequent Flyer(TSR)"
    tightBrackets: true,
    number: (n) => n,
    extras: { color: 'Color', element: 'Element' },
    setTypes: [
      ['promo', /promo|prototype|sleeve/i],
      ['starter', /^TD\d|trial deck/i],
    ],
    fallbackType: 'booster',
    setTypeLabels: { booster: 'Booster Packs', starter: 'Trial Decks', promo: 'Promos & Specials' },
  },
}

export const TCGPLAYER_GAME_IDS = Object.keys(TCGPLAYER_GAMES)

function cfgOf(game) {
  const cfg = TCGPLAYER_GAMES[game]
  if (!cfg) throw new Error(`Not a TCGplayer-sourced game: ${game}`)
  return cfg
}

// ── Names and numbers ────────────────────────────────────────────────────────

/**
 * TCGplayer's product name → printed name + version. Trailing " (…)" groups are versions unless
 * the game says that bracket is part of the name ("Rising Energy (Red)"). Whitespace collapsed
 * ("Grogu -  Yes. Yes. Yes." → "Grogu - Yes. Yes. Yes.").
 */
export function splitName(game, productName) {
  const cfg = cfgOf(game)
  let name = String(productName ?? '').replace(/\s+/g, ' ').trim()
  const variants = []
  for (;;) {
    const m = name.match(cfg.tightBrackets ? /^(.*\S)\s*\(([^()]+)\)$/ : /^(.*\S)\s+\(([^()]+)\)$/)
    if (!m) break
    const inner = m[2].trim()
    if (cfg.keepInName && cfg.keepInName.test(inner)) break
    if (cfg.variantOnly && !cfg.variantOnly.test(inner)) break
    variants.unshift(inner)
    name = m[1].trim()
  }
  return { name, variant: variants.join(' · ') }
}

/**
 * TCGplayer sometimes appends the card's number to its name — "Graphene Chelicera - GEM008",
 * "MetalTyrannomon - BT2-046". Dropped when it is the card's own number (a real subtitle —
 * "Han Solo - I Got a Really Good Feeling" — never matches one).
 */
export function dropNumberSuffix(name, number) {
  const m = String(name).match(/^(.*\S)\s+-\s+([A-Za-z0-9][A-Za-z0-9-]*)$/)
  if (!m || !number) return name
  const parts = String(number).toUpperCase().split(/\s*\/\/\s*|\s+/)
  return parts.includes(m[2].toUpperCase()) ? m[1] : name
}

/** The printed number as the game shows it (whitespace tidied) */
export function cleanNumber(game, raw) {
  const n = String(raw ?? '').replace(/\s+/g, ' ').trim()
  return n ? cfgOf(game).number(n) : ''
}

/**
 * A card's set code: TCGplayer's set abbreviation; for a set without one (newer Flesh and Blood
 * sets, a few promo sets), the code the number starts with ("GD01-118" → GD01, "SFC001" → SFC);
 * else the set's name.
 */
export function setCodeOf(group, number) {
  const abbr = String(group?.abbreviation ?? '').trim()
  if (abbr) return abbr
  const n = String(number ?? '').toUpperCase()
  const code = n.match(/^([A-Z0-9]+)-/)?.[1] ?? n.match(/^([A-Z]{2,5})\d/)?.[1]
  return code || String(group?.name ?? '').trim()
}

/** Which Cardex group a set belongs to, from its name */
export function setTypeOf(game, groupName) {
  const cfg = cfgOf(game)
  for (const [type, re] of cfg.setTypes) if (re.test(String(groupName ?? ''))) return type
  return cfg.fallbackType
}

// ── Prices ───────────────────────────────────────────────────────────────────

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

/** Flesh and Blood price sub-type → printing key ("1st Edition Rainbow Foil" → "1st:rainbow") */
export function printingKeyOf(subTypeName) {
  const s = String(subTypeName ?? '').trim().toLowerCase()
  if (!s) return null
  const edition = s.startsWith('1st edition') ? '1st' : 'unlimited'
  const finish = s.includes('cold foil') ? 'cold' : s.includes('rainbow foil') ? 'rainbow' : s.includes('foil') ? 'rainbow' : 'normal'
  return `${edition}:${finish}`
}

/** 'foil' games: Normal → regular, any foil sub-type → foil */
export function isFoilSubtype(subTypeName) {
  return /foil|holo/i.test(String(subTypeName ?? ''))
}

/** A product's price rows → its price fields (what every reader of the catalog understands) */
export function priceFieldsOf(game, rows) {
  const cfg = cfgOf(game)
  if (cfg.priceModel === 'printings') {
    const variantPrices = {}, lowByKey = {}
    for (const r of rows) {
      const key = printingKeyOf(r.subTypeName)
      if (!key) continue
      const market = Number(r.marketPrice) || 0
      if (market > 0) variantPrices[key] = round2(market)
      const low = Number(r.lowPrice) || 0
      if (low > 0) lowByKey[key] = round2(low)
    }
    return printingFields(variantPrices, lowByKey)
  }
  const out = { marketPrice: 0, marketPriceFoil: 0, lowPriceNM: 0, lowPriceNMFoil: 0 }
  for (const r of rows) {
    const foil = isFoilSubtype(r.subTypeName)
    const market = round2(r.marketPrice), low = round2(r.lowPrice)
    if (market > 0) out[foil ? 'marketPriceFoil' : 'marketPrice'] = market
    if (low > 0) out[foil ? 'lowPriceNMFoil' : 'lowPriceNM'] = low
  }
  return out
}

/** variantPrices + the classic fields for the default printing (Flesh and Blood) */
export function printingFields(variantPrices, lowByKey = {}) {
  if (Object.keys(variantPrices).length === 0) {
    return { variantPrices, marketPrice: 0, marketPriceFoil: 0, lowPriceNM: 0, lowPriceNMFoil: 0 }
  }
  const edition = defaultEdition(variantPrices)
  const foilKey = ['rainbow', 'cold'].map((f) => `${edition}:${f}`).find((k) => variantPrices[k] > 0)
  return {
    variantPrices,
    marketPrice: round2(variantPrice(variantPrices, { edition, finish: 'normal' }) || variantPrice(variantPrices, { edition })),
    marketPriceFoil: foilKey ? variantPrices[foilKey] : 0,
    lowPriceNM: lowByKey[`${edition}:normal`] ?? 0,
    lowPriceNMFoil: foilKey ? (lowByKey[foilKey] ?? 0) : 0,
  }
}

// ── The catalog ──────────────────────────────────────────────────────────────

/**
 * ProductsAndPrices.csv rows (one per product × price sub-type) → products with their rows.
 * Every ext* column is kept (`ext.Number`, `ext.Rarity`, `ext["Arena Type"]`…) — the CSV header
 * drops spaces ("extArenaType"), so they're matched loosely in cardFromProduct.
 */
export function productsFromRows(rows) {
  const byId = new Map()
  for (const r of rows) {
    const id = Number(r.productId)
    if (!id) continue
    if (!byId.has(id)) {
      const ext = {}
      for (const [k, v] of Object.entries(r)) {
        if (k.startsWith('ext') && k !== 'extDescription' && String(v ?? '').trim()) ext[k.slice(3)] = String(v).trim()
      }
      byId.set(id, {
        productId: id,
        name: String(r.name ?? '').trim(),
        imageUrl: String(r.imageUrl ?? '').trim(),
        imageCount: r.imageCount === undefined || r.imageCount === '' ? null : Number(r.imageCount),
        groupId: Number(r.groupId),
        ext,
        rows: [],
      })
    }
    byId.get(id).rows.push({ subTypeName: r.subTypeName, marketPrice: r.marketPrice, lowPrice: r.lowPrice })
  }
  return [...byId.values()]
}

const extKey = (label) => String(label).replace(/[^A-Za-z0-9]/g, '').toLowerCase()
function extOf(product, label) {
  const want = extKey(label)
  for (const [k, v] of Object.entries(product.ext ?? {})) if (extKey(k) === want) return v
  return ''
}

/** A single (not sealed product): has a printed number or a rarity */
export function isSingle(product) {
  return !!(extOf(product, 'Number') || extOf(product, 'Rarity'))
}

/** One product → its catalog card (identity fields + prices) */
export function cardFromProduct(game, product, group) {
  const cfg = cfgOf(game)
  const number = cleanNumber(game, extOf(product, 'Number'))
  const split = splitName(game, product.name)
  const name = dropNumberSuffix(split.name, number || extOf(product, 'Number'))
  const variant = split.variant
  const card = {
    id: `tcg-${product.productId}`,
    name,
    number,
    set: setCodeOf(group, number),
    setName: String(group.name ?? '').trim(),
    rarity: extOf(product, 'Rarity'),
    // No photo yet (imageCount 0): stored empty so the site shows its No Image card, and the
    // first sync after TCGplayer photographs it fills it in
    imageUrl: product.imageCount === 0 ? '' : product.imageUrl,
    tcgProductId: product.productId,
    tcgGroupId: product.groupId,
  }
  if (variant) card.variant = variant
  const cardType = extOf(product, 'CardType')
  if (cardType) card.cardType = cardType
  for (const [field, label] of Object.entries(cfg.extras ?? {})) {
    const v = extOf(product, label)
    if (v) card[field] = v
  }
  Object.assign(card, priceFieldsOf(game, product.rows))
  return card
}

/** Today's price fields laid over an existing card's, keeping a price TCGplayer has none for today */
export function mergePrices(game, old, fresh) {
  const cfg = cfgOf(game)
  if (cfg.priceModel === 'printings') {
    const vp = { ...(old.variantPrices ?? {}) }
    for (const [k, v] of Object.entries(fresh.variantPrices ?? {})) vp[k] = v
    const out = printingFields(vp)
    out.lowPriceNM = fresh.lowPriceNM || old.lowPriceNM || 0
    out.lowPriceNMFoil = fresh.lowPriceNMFoil || old.lowPriceNMFoil || 0
    return out
  }
  return {
    marketPrice: fresh.marketPrice || old.marketPrice || 0,
    marketPriceFoil: fresh.marketPriceFoil || old.marketPriceFoil || 0,
    lowPriceNM: fresh.lowPriceNM || old.lowPriceNM || 0,
    lowPriceNMFoil: fresh.lowPriceNMFoil || old.lowPriceNMFoil || 0,
  }
}

/**
 * Every single in the game's TCGplayer category, as catalog cards, plus its set list.
 * An existing card keeps name / number / set / rarity / version / photo exactly as collectors
 * logged them (a card saved without a photo gets one once TCGplayer has it); only prices refresh.
 */
export function buildTcgplayerCatalog(game, { groups, productsByGroup, existing = new Map(), failedGroupIds = new Set() }) {
  cfgOf(game)
  const cards = []
  const sets = []
  const report = { groups: groups.length, failedGroups: [...failedGroupIds], sealed: 0, newCards: 0, existingCards: 0, unpriced: 0, noPhoto: 0 }
  for (const g of groups) {
    if (failedGroupIds.has(g.groupId)) continue
    let inSet = 0
    for (const p of productsByGroup.get(g.groupId) ?? []) {
      if (!isSingle(p)) { report.sealed++; continue }
      const fresh = cardFromProduct(game, p, g)
      const old = existing.get(fresh.id)
      let card = fresh
      if (old) {
        report.existingCards++
        card = { ...fresh, name: old.name, number: old.number, set: old.set, setName: old.setName, rarity: old.rarity,
          imageUrl: old.imageUrl || fresh.imageUrl, ...mergePrices(game, old, fresh) }
        if (old.variant !== undefined) card.variant = old.variant; else delete card.variant
      } else {
        report.newCards++
      }
      if (!card.marketPrice && !card.marketPriceFoil) report.unpriced++
      if (!card.imageUrl) report.noPhoto++
      cards.push(card)
      inSet++
    }
    if (inSet > 0) {
      sets.push({
        id: `tcg-${g.groupId}`, code: String(g.abbreviation ?? ''), name: String(g.name ?? '').trim(),
        releaseDate: String(g.publishedOn ?? '').slice(0, 10), cardCount: inSet, setType: setTypeOf(game, g.name),
        tcgplayerGroupId: g.groupId,
      })
    }
  }
  sets.sort((a, b) => b.releaseDate.localeCompare(a.releaseDate) || a.name.localeCompare(b.name))
  return { cards, sets, report }
}
