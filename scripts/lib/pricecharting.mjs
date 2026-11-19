// PriceCharting graded prices — the pure part (no network, no Firestore), shared by the daily job
// (scripts/pricecharting-sync.mjs), the app's pricing rule (lib/pricing.ts) and the tests
// (pricecharting.test.mjs). docs/PriceCharting.md has the story, the licence terms and the plan.
//
// Licence (2026-11-17, in writing from PriceCharting): fine on the Legendary plan until TCGHaven
// makes $1,000/month, PROVIDED every graded price shown cites PriceCharting with a link back to
// that card's page. Never show a graded price without that citation.
//
// Source: PriceCharting's daily price-list CSV (Legendary plan). Column names = the API's keys.
// The docs say CSV prices are "USD with two decimal places" without showing one, so parsePcPrice
// accepts "$1,234.56", "1234.56" and blanks. (API JSON prices are integer pennies — penniesToUsd.)

/** PriceCharting column → our short key. Only the 10s are split by grading company; Grade 1–9.5
 *  are sales from any grader (label them "Grade 9 sales", not "PSA 9"). */
export const GRADED_COLUMNS = {
  'condition-9-price': 'g1',
  'condition-10-price': 'g2',
  'condition-13-price': 'g3',
  'condition-14-price': 'g4',
  'condition-15-price': 'g5',
  'condition-16-price': 'g6',
  'cib-price': 'g7',               // Grade 7 / 7.5
  'new-price': 'g8',               // Grade 8 / 8.5
  'graded-price': 'g9',            // Grade 9
  'box-only-price': 'g95',         // Grade 9.5
  'manual-only-price': 'psa10',
  'bgs-10-price': 'bgs10',
  'condition-17-price': 'cgc10',
  'condition-18-price': 'sgc10',
  'condition-19-price': 'cgc10p',  // CGC 10 Pristine
  'condition-20-price': 'bgs10bl', // BGS 10 Black Label
  'condition-21-price': 'tag10',
  'condition-22-price': 'ace10',
}

/** How each key reads beside a price ("PSA 10 sales", "Grade 9 sales") */
export const GRADED_LABELS = {
  g1: 'Grade 1', g2: 'Grade 2', g3: 'Grade 3', g4: 'Grade 4', g5: 'Grade 5', g6: 'Grade 6',
  g7: 'Grade 7', g8: 'Grade 8', g9: 'Grade 9', g95: 'Grade 9.5',
  psa10: 'PSA 10', bgs10: 'BGS 10', cgc10: 'CGC 10', sgc10: 'SGC 10', cgc10p: 'CGC 10 Pristine',
  bgs10bl: 'BGS 10 Black Label', tag10: 'TAG 10', ace10: 'ACE 10',
}

/** "$1,234.56" / "1234.56" / "" → 1234.56, or 0 when blank or not a price */
export function parsePcPrice(v) {
  const s = String(v ?? '').replace(/[$,\s]/g, '')
  if (!s) return 0
  const n = Number(s)
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0
}

/** API JSON prices are integer pennies (1732 = $17.32) */
export function penniesToUsd(p) {
  const n = Number(p)
  return Number.isFinite(n) && n > 0 ? n / 100 : 0
}

/** CSV text → rows keyed by header name. Quote-aware: never split on newlines first (CLAUDE.md
 *  rule 28 — product names can hold commas, quotes and line breaks). */
export function parsePcCsv(text) {
  const rows = []
  let row = []
  let cur = ''
  let inQ = false
  const src = String(text ?? '').replace(/^﻿/, '')
  const endRow = () => { row.push(cur); cur = ''; if (row.some((v) => v !== '')) rows.push(row); row = [] }
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inQ) {
      if (ch === '"' && src[i + 1] === '"') { cur += '"'; i++ }
      else if (ch === '"') inQ = false
      else cur += ch
    } else if (ch === '"') inQ = true
    else if (ch === ',') { row.push(cur); cur = '' }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && src[i + 1] === '\n') i++; endRow() }
    else cur += ch
  }
  endRow()
  if (!rows.length) return []
  const header = rows[0].map((h) => h.trim().toLowerCase())
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])))
}

/** One CSV row → { tcgId, pcId, name, console, url, prices } — prices holds only graded keys
 *  with a real (> 0) price. null when the row has no TCGplayer id or no graded price at all. */
export function gradedFromRow(row) {
  const tcgId = Number(String(row['tcg-id'] ?? '').trim())
  if (!Number.isInteger(tcgId) || tcgId <= 0) return null
  const prices = {}
  for (const [col, key] of Object.entries(GRADED_COLUMNS)) {
    const p = parsePcPrice(row[col])
    if (p > 0) prices[key] = p
  }
  if (!Object.keys(prices).length) return null
  const name = String(row['product-name'] ?? '').trim()
  const consoleName = String(row['console-name'] ?? '').trim()
  const pcId = String(row.id ?? '').trim()
  return { tcgId, pcId, name, console: consoleName, url: pcIdUrl(pcId) ?? pcProductUrl(consoleName, name), prices }
}

/** PriceCharting's card page by its product id — /game/{id} always redirects to the exact card
 *  page. The citation link. (A name-built address guesses PriceCharting's slug and, when it guesses
 *  wrong — "Scarlet & Violet 151", "[Master Ball]" — lands on a search page: seen 2026-11-19.) */
export function pcIdUrl(pcId) {
  const id = String(pcId ?? '').trim()
  return /^[0-9]+$/.test(id) ? `https://www.pricecharting.com/game/${id}` : null
}

/** A guess at PriceCharting's card page from its names, e.g. ("Pokemon Base Set", "Charizard #4") →
 *  https://www.pricecharting.com/game/pokemon-base-set/charizard-4. Only for a row without an id —
 *  pcIdUrl() is the reliable link. */
export function pcProductUrl(consoleName, productName) {
  const slug = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const c = slug(consoleName)
  const p = slug(productName)
  return c && p ? `https://www.pricecharting.com/game/${c}/${p}` : 'https://www.pricecharting.com'
}

/** All rows → Map tcgId → the one row to use. Several rows can share a TCGplayer id (a "[1st
 *  Edition]" or "[Reverse Holo]" listing beside the plain one): the plain-named row wins; with no
 *  single plain row the id is ambiguous and skipped (reported, never guessed). */
export function pickByTcgId(rows) {
  const groups = new Map()
  for (const row of rows) {
    const g = gradedFromRow(row)
    if (!g) continue
    if (!groups.has(g.tcgId)) groups.set(g.tcgId, [])
    groups.get(g.tcgId).push(g)
  }
  const byTcg = new Map()
  const ambiguous = []
  for (const [tcgId, list] of groups) {
    if (list.length === 1) { byTcg.set(tcgId, list[0]); continue }
    const plain = list.filter((g) => !/\[[^\]]*\]/.test(g.name))
    // No plain listing, but one "[Holo]" (Pokémon's holo / reverse holo pair) — the holo is the card
    const holo = plain.length ? [] : list.filter((g) => pcVariantOf(g.name) === 'holo')
    const base = plain.length === 1 ? plain[0] : holo.length === 1 ? holo[0] : null
    if (!base) { ambiguous.push({ tcgId, names: list.map((g) => g.name) }); continue }
    // The card's other versions PriceCharting lists under the same TCGplayer id — "[Foil]",
    // "[1st Edition]", "[Reverse Holo]" … — each with its own graded prices (gradedVariantKey picks)
    const variants = {}
    for (const key of GRADED_VARIANTS) {
      const rowsOf = list.filter((g) => g !== base && pcVariantOf(g.name) === key)
      if (rowsOf.length === 1) variants[key] = { p: rowsOf[0].prices, u: rowsOf[0].url }
    }
    byTcg.set(tcgId, Object.keys(variants).length ? { ...base, variants } : base)
  }
  return { byTcg, ambiguous }
}

// The versions of a card PriceCharting lists separately under one TCGplayer id, by their [tag]
export const GRADED_VARIANTS = ['foil', '1st', 'limited', 'shadowless', 'reverse']

/** A PriceCharting listing's version from its [tag]: '' = the plain listing, 'foil' / '1st' /
 *  'limited' / 'shadowless' / 'reverse' / 'holo', or null for anything else (a rarity or art
 *  version — "[Ultimate Rare]", "[Extended Art Foil]" — that can't be matched to our card) */
export function pcVariantOf(name) {
  const tags = [...String(name ?? '').matchAll(/\[([^\]]+)\]/g)].map((m) => m[1].trim().toLowerCase().replace(/\s+/g, ' '))
  if (!tags.length) return ''
  if (tags.length > 1) return null
  const t = tags[0]
  if (t === 'foil') return 'foil'
  if (t === '1st edition') return '1st'
  if (t === 'limited' || t === 'limited edition') return 'limited'
  if (t === 'shadowless') return 'shadowless'
  if (t === 'reverse holo') return 'reverse'
  if (t === 'holo') return 'holo'
  return null
}

/** Which of a card's PriceCharting listings prices this copy: '' = the plain one, a GRADED_VARIANTS
 *  key, or null = the version this copy is has no listing → no graded price (the raw price, "Raw
 *  est."). A 1st Edition / Shadowless / Limited / Reverse Holo copy needs its own listing (they're
 *  worth very different amounts); a foil copy uses the "[Foil]" one when there is one, else the
 *  plain listing (a foil-only product, or one PriceCharting doesn't split). */
export function gradedVariantKey({ isFoil, edition, finish } = {}, variants = {}) {
  const v = variants ?? {}
  if (edition === '1st' || edition === 'shadowless' || edition === 'limited') return v[edition] ? edition : null
  if (finish === 'reverse') return v.reverse ? 'reverse' : null
  if (isFoil && v.foil) return 'foil'
  return ''
}

/** A catalog card's TCGplayer product id: `tcgProductId`; else built into the id (`tcg-123`,
 *  Japanese Pokémon `jp-123`); else read from a TCGplayer image link
 *  (tcgplayer-cdn.tcgplayer.com/product/670598_in_1000x1000.jpg — most Riftbound cards, like One
 *  Piece's productIdFromImage). null when none of those (Pokémon EN, Magic, most Lorcana —
 *  docs/PriceCharting.md). */
export function productIdOf(card) {
  const n = Number(card?.tcgProductId)
  if (Number.isInteger(n) && n > 0) return n
  const m = /^(?:tcg|jp)-(\d+)$/.exec(String(card?.id ?? ''))
  if (m) return Number(m[1])
  const img = /tcgplayer-cdn\.tcgplayer\.com\/product\/(\d+)_/.exec(String(card?.imageUrl ?? ''))
  return img ? Number(img[1]) : null
}

/** Catalog cards × picked rows → entries { id, pc, u, p } for every card with graded prices.
 *  A product id shared by several catalog cards is skipped (can't tell which one it is). */
export function matchCatalog(cards, byTcg) {
  const cardsByPid = new Map()
  for (const c of cards) {
    if (c?.hidden) continue
    const pid = productIdOf(c)
    if (pid == null) continue
    if (!cardsByPid.has(pid)) cardsByPid.set(pid, [])
    cardsByPid.get(pid).push(c.id)
  }
  const entries = []
  let withProductId = 0
  let sharedProductIds = 0
  for (const [pid, ids] of cardsByPid) {
    withProductId += ids.length
    const g = byTcg.get(pid)
    if (!g) continue
    if (ids.length > 1) { sharedProductIds++; continue }
    entries.push({ id: ids[0], pc: g.pcId, u: g.url, p: g.prices, ...(g.variants && { v: g.variants }) })
  }
  entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return { entries, withProductId, sharedProductIds }
}

/** Which graded key prices this slab. null = no PriceCharting column for it (Authentic, a grader
 *  without its own 10 column such as HGA / CSG / Other, or no grade) — the app falls back to the
 *  raw price and says so. */
export function gradedPriceKey(company, grade, tier) {
  const n = parseFloat(String(grade ?? '').trim())
  if (!Number.isFinite(n) || n < 1) return null
  const c = String(company ?? '').trim().toUpperCase()
  if (n >= 10) {
    if (c === 'PSA') return 'psa10'
    if (c === 'BGS') return tier === 'black' ? 'bgs10bl' : 'bgs10'
    if (c === 'CGC') return tier === 'pristine' ? 'cgc10p' : 'cgc10'
    if (c === 'SGC') return 'sgc10'
    if (c === 'TAG') return 'tag10'
    if (c === 'ACE') return 'ace10'
    return null
  }
  if (!c) return null
  if (n >= 9.5) return 'g95'
  if (n >= 9) return 'g9'
  if (n >= 8) return 'g8'
  if (n >= 7) return 'g7'
  return `g${Math.floor(n)}`
}

/** The graded price for this slab from a card's graded block, or 0 when there isn't one */
export function gradedPriceFor(prices, { company, grade, tier } = {}) {
  if (!prices) return 0
  const key = gradedPriceKey(company, grade, tier)
  const p = key ? Number(prices[key]) : 0
  return Number.isFinite(p) && p > 0 ? p : 0
}
