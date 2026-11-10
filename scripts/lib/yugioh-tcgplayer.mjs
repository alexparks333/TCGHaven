// Yu-Gi-Oh! catalog from TCGplayer (tcgcsv category 2) — pure: data in, catalog out, no network
// or Firestore. catalog-sync.mjs (planYugiohCatalog / downloadYugioh) fetches and writes;
// scripts/yugioh-source-report.mjs checks it; tests: `npm run test:yugioh-source`.
// Design and decisions: docs/games.md (Yu-Gi-Oh!) and docs/adding-a-game.md.
//
// One TCGplayer product = one catalog card, id `tcg-{productId}` — set once, never changes.
// A product's edition rows (1st Edition / Unlimited / Limited) are printings of that one card:
// `variantPrices` ("1st:normal" → price), the scheme Pokémon uses (pokemon-variants.mjs).
// Rarity versions sharing a printed number (MAMS-EN001 as Ultra Rare, Extended Art, Starlight
// Rare, GMR…) are separate products, so separate cards.
//
// Scope (owner, 2026-11-10): English TCG singles. Sealed products, Speed Duel and Rush Duel sets,
// and non-English prints (German etc.) are left out.

import { variantPrice, defaultEdition } from './pokemon-variants.mjs'

export const YUGIOH_CATEGORY = 2

// ── What's in ────────────────────────────────────────────────────────────────

/** Speed Duel and Rush Duel are separate game formats — not in this catalog (owner's scope) */
export function isExcludedGroup(groupName) {
  return /speed duel|rush duel/i.test(String(groupName ?? ''))
}

// Printed-number region codes for languages other than English ("SDK-DE001", "LOB-FR001")
const NON_ENGLISH_REGION = new Set(['DE', 'FR', 'IT', 'SP', 'PT', 'JP', 'KR', 'AE', 'TC', 'SC'])
const NON_ENGLISH_NAME = /\((German|French|Italian|Spanish|Portuguese|Japanese|Korean)\)/i

/** An English single: has a printed card number, isn't a foreign-language print */
export function isEnglishCard(product) {
  const number = String(product.number ?? '').trim()
  if (!number) return false                 // sealed: boxes, packs, displays, tins, accessories
  if (NON_ENGLISH_NAME.test(product.name)) return false
  const region = number.match(/^[A-Z0-9]+-([A-Z]{1,2})\d/)
  if (region && NON_ENGLISH_REGION.has(region[1])) return false
  return true
}

// ── Names ────────────────────────────────────────────────────────────────────

/**
 * TCGplayer's product name → the name printed on the card + the variant TCGplayer appended
 * in brackets: "Blue-Eyes White Dragon (Quarter Century Secret Rare)" → name "Blue-Eyes White
 * Dragon", variant "Quarter Century Secret Rare". Only trailing " (…)" groups are variants — a
 * bracket inside a name without a space before it stays part of the name.
 */
export function splitName(productName) {
  let name = String(productName ?? '').replace(/\s+/g, ' ').trim()
  const variants = []
  for (;;) {
    const m = name.match(/^(.*\S)\s+\(([^()]+)\)$/)
    if (!m) break
    variants.unshift(m[2].trim())
    name = m[1].trim()
  }
  return { name, variant: variants.join(' · ') }
}

/** A set code as a comparison key: upper-case, O → 0 in the digits ("LAVD-ENO09" → "LAVD-EN009" —
 *  TCGplayer occasionally types a letter O). Same rule as lib/scan/scanMatch.ts ygoKey(). */
export function ygoKey(code) {
  const m = String(code ?? '').toUpperCase().replace(/\s+/g, '').match(/^([A-Z0-9]+)-([A-Z]{0,2}?)([0-9O]+)([A-Z]?)$/)
  return m ? `${m[1]}-${m[2]}${m[3].replace(/O/g, '0')}${m[4]}` : String(code ?? '').toUpperCase()
}

/** "MAMS-EN001" → "MAMS"; "LOB-001" → "LOB" */
export function setCodeOf(number) {
  const m = String(number ?? '').match(/^([A-Z0-9]+)-/)
  return m ? m[1] : ''
}

// ── Prices ───────────────────────────────────────────────────────────────────

/** TCGplayer price sub-type → printing key, or null. "Normal" is the sealed/no-edition row. */
export function printingKeyOf(subTypeName) {
  const s = String(subTypeName ?? '').trim().toLowerCase()
  if (s.startsWith('1st edition')) return '1st:normal'
  if (s.startsWith('unlimited')) return 'unlimited:normal'
  if (s.startsWith('limited')) return 'limited:normal'
  if (s === 'normal' || s === '') return 'unlimited:normal'
  return null
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

/** A product's price rows → { variantPrices, lowByKey } (market price per printing; rows without one
 *  skipped). A plain "Normal" row (no edition) never overrides a real edition row for the same key. */
export function pricesOf(rows) {
  const variantPrices = {}, lowByKey = {}, fromEdition = new Set()
  for (const r of rows) {
    const key = printingKeyOf(r.subTypeName)
    if (!key) continue
    const plain = !/^(1st edition|unlimited|limited)/i.test(String(r.subTypeName ?? '').trim())
    if (plain && fromEdition.has(key)) continue
    if (!plain) fromEdition.add(key)
    const market = Number(r.marketPrice) || 0
    if (market > 0) variantPrices[key] = round2(market)
    const low = Number(r.lowPrice) || 0
    if (low > 0) lowByKey[key] = round2(low)
  }
  return { variantPrices, lowByKey }
}

// ── Sets ─────────────────────────────────────────────────────────────────────

/**
 * Which Cardex group a set belongs to, from its name — TCGplayer has no set type for Yu-Gi-Oh!.
 * Checked in order: the first rule that matches wins.
 */
const SET_TYPE_RULES = [
  ['promo', /promo|prize|championship|tournament|winner'?s pack|thank you pack|\bots\b|hobby league|duelist league|sneak peek|participation|judge|magazine|video game|mattel|valuable book|redemption|world duel carnival|shonen jump|event pack/i],
  ['tin', /\btins?\b|mega-tin|mega pack/i],
  ['structure', /structure deck/i],
  ['starter', /starter|2-player|demo deck|deck: |decks:|\bdecks?\b(?! of)/i],
  ['special', /duelist pack|collection|legendary|battle pack|hidden arsenal|duel terminal|gold|premium|rarity|retro pack|turbo pack|astral pack|dark legends|maximum|anniversary|special edition|value box|box set|collector'?s box|movie pack|duel devastator|history|chronicles|savage strike|reprint/i],
]
export function setTypeOf(groupName) {
  for (const [type, re] of SET_TYPE_RULES) if (re.test(groupName)) return type
  return 'booster'
}

export const SET_TYPE_LABELS = {
  booster: 'Booster Sets',
  structure: 'Structure Decks',
  starter: 'Starter & Theme Decks',
  tin: 'Tins & Mega Packs',
  special: 'Collections & Special Sets',
  promo: 'Promos & Prizes',
}

// ── The catalog ──────────────────────────────────────────────────────────────

/** ProductsAndPrices.csv rows (one per product × price sub-type) → products with their rows */
export function productsFromRows(rows) {
  const byId = new Map()
  for (const r of rows) {
    const id = Number(r.productId)
    if (!id) continue
    if (!byId.has(id)) {
      byId.set(id, {
        productId: id,
        name: String(r.name ?? '').trim(),
        imageUrl: String(r.imageUrl ?? '').trim(),
        groupId: Number(r.groupId),
        number: String(r.extNumber ?? '').trim(),
        rarity: String(r.extRarity ?? '').trim(),
        cardType: String(r.extCardType ?? '').trim(),
        attribute: String(r.extAttribute ?? '').trim(),
        rows: [],
      })
    }
    byId.get(id).rows.push({ subTypeName: r.subTypeName, marketPrice: r.marketPrice, lowPrice: r.lowPrice })
  }
  return [...byId.values()]
}

/** One product → its catalog card (identity fields + prices) */
export function cardFromProduct(product, group) {
  const { name, variant } = splitName(product.name)
  const { variantPrices, lowByKey } = pricesOf(product.rows)
  const card = {
    id: `tcg-${product.productId}`,
    name,
    number: product.number,
    set: setCodeOf(product.number) || String(group.abbreviation ?? ''),
    setName: String(group.name ?? '').trim(),
    rarity: product.rarity,
    imageUrl: product.imageUrl,
    tcgProductId: product.productId,
    tcgGroupId: product.groupId,
  }
  if (variant) card.variant = variant
  if (product.cardType) card.cardType = product.cardType
  if (product.attribute) card.attribute = product.attribute
  Object.assign(card, priceFields(variantPrices, lowByKey))
  return card
}

/** variantPrices + the classic price fields every reader understands (the default printing's) */
export function priceFields(variantPrices, lowByKey = {}) {
  const out = { variantPrices }
  if (Object.keys(variantPrices).length === 0) return { ...out, marketPrice: 0, marketPriceFoil: 0, lowPriceNM: 0, lowPriceNMFoil: 0 }
  const edition = defaultEdition(variantPrices)
  const key = `${edition}:normal`
  return {
    ...out,
    marketPrice: round2(variantPrice(variantPrices, { edition, finish: 'normal' })),
    marketPriceFoil: 0,
    lowPriceNM: lowByKey[key] ?? 0,
    lowPriceNMFoil: 0,
  }
}

/**
 * Every English Yu-Gi-Oh! single on TCGplayer, as catalog cards.
 *
 * An existing card never changes what it shows — name, number, set, rarity, variant, photo stay
 * as collectors logged them; only its prices refresh. A printing TCGplayer has no price for
 * today keeps its last price (the "no price → keep the last" rule every game follows). The one
 * exception: a card saved before TCGplayer photographed it gets the photo once there is one.
 */
export function buildYugiohCatalog({ groups, productsByGroup, existing = new Map(), failedGroupIds = new Set() }) {
  const cards = []
  const sets = []
  const report = {
    groups: groups.length, excludedGroups: [], failedGroups: [...failedGroupIds],
    cardProducts: 0, sealed: 0, nonEnglish: 0, newCards: 0, existingCards: 0, unpriced: 0,
    unknownRarities: new Map(), keptPrices: 0,
  }
  for (const g of groups) {
    if (isExcludedGroup(g.name)) { report.excludedGroups.push(g.name); continue }
    if (failedGroupIds.has(g.groupId)) continue
    const products = productsByGroup.get(g.groupId) ?? []
    let inSet = 0
    for (const p of products) {
      if (!p.number) { report.sealed++; continue }
      if (!isEnglishCard(p)) { report.nonEnglish++; continue }
      report.cardProducts++
      const fresh = cardFromProduct(p, g)
      const old = existing.get(fresh.id)
      let card = fresh
      if (old) {
        report.existingCards++
        // Keep what the collector sees; refresh prices, keeping a printing's last price when
        // TCGplayer has none today
        const vp = { ...(old.variantPrices ?? {}) }
        for (const [k, v] of Object.entries(fresh.variantPrices)) vp[k] = v
        if (Object.keys(fresh.variantPrices).length < Object.keys(old.variantPrices ?? {}).length) report.keptPrices++
        card = { ...fresh, name: old.name, number: old.number, set: old.set, setName: old.setName, rarity: old.rarity,
          imageUrl: old.imageUrl || fresh.imageUrl, ...priceFields(vp) }
        if (old.variant !== undefined) card.variant = old.variant; else delete card.variant
        if (!card.lowPriceNM && old.lowPriceNM) card.lowPriceNM = old.lowPriceNM
      } else {
        report.newCards++
      }
      if (!card.marketPrice) report.unpriced++
      cards.push(card)
      inSet++
    }
    if (inSet > 0) {
      sets.push({
        id: `tcg-${g.groupId}`, code: String(g.abbreviation ?? ''), name: String(g.name ?? '').trim(),
        releaseDate: String(g.publishedOn ?? '').slice(0, 10), cardCount: inSet, setType: setTypeOf(g.name),
        tcgplayerGroupId: g.groupId,
      })
    }
  }
  sets.sort((a, b) => b.releaseDate.localeCompare(a.releaseDate) || a.name.localeCompare(b.name))
  return { cards, sets, report }
}
