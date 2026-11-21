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

  // A version PriceCharting files under a DIFFERENT TCGplayer id than the card's — Base Set's
  // "Charizard [1st Edition] #4" and "[Shadowless] #4" sit under TCGplayer's separate Base Set
  // (Shadowless) product (no plain row there → "ambiguous"), while "Alakazam [Shadowless] #1" is
  // alone under its own. Our catalog card only knows the main product, so these never matched: a
  // 1st Edition Charizard PSA 10 got no graded price (2026-11-19). Each such row is attached to
  // the card whose plain row has the same set, name and number on PriceCharting ("Charizard #4" in
  // "Pokemon Base Set") — only when exactly one plain row and one row of that version match.
  const keyOf = (g) => `${g.console}|${g.name.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()}`
  const plainByKey = new Map()
  for (const list of groups.values()) for (const g of list) {
    if (/\[[^\]]*\]/.test(g.name)) continue
    const k = keyOf(g)
    plainByKey.set(k, plainByKey.has(k) ? null : g)   // null = two plain rows: can't tell which
  }
  const attached = new Set()
  const orphans = new Map()   // `${baseTcgId}|${version}` → rows
  for (const [tcgId, list] of groups) {
    const own = byTcg.get(tcgId)
    for (const g of list) {
      const key = pcVariantOf(g.name)
      if (!GRADED_VARIANTS.includes(key)) continue
      if (own && own !== g && (own.variants?.[key]?.u === g.url)) continue   // already its own card's version
      const plain = plainByKey.get(keyOf(g))
      if (!plain || plain.tcgId === tcgId) continue
      const k = `${plain.tcgId}|${key}`
      if (!orphans.has(k)) orphans.set(k, [])
      orphans.get(k).push(g)
    }
  }
  for (const [k, rows] of orphans) {
    if (rows.length !== 1) continue
    const [baseId, key] = k.split('|')
    const card = byTcg.get(Number(baseId))
    if (!card || card.variants?.[key]) continue   // the card's own product already has this version
    byTcg.set(Number(baseId), { ...card, variants: { ...card.variants, [key]: { p: rows[0].prices, u: rows[0].url } } })
    attached.add(rows[0])
  }
  // An "ambiguous" id whose rows all found their card isn't a skip any more
  return { byTcg, ambiguous: ambiguous.filter((a) => !groups.get(a.tcgId).every((g) => attached.has(g))) }
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

// ── Graded links: PriceCharting cards that didn't link by TCGplayer id (2026-11-21) ───────────
// About 1 in 5 PriceCharting rows with graded sales carry no TCGplayer id (One Piece: half), so
// they never price a card. Matching them by set + name + number automatically was tried and
// measured: replaying the rows that DO have ids with the ids hidden on both sides, it still named
// the wrong card in Pokémon (4), Magic (14) and Riftbound (1) — our catalog has near-copies of some
// printings that name, set and number can't tell apart — and at that strictness it found only 5
// new cards. So: the clear matches are made automatically only in catalogs whose self-check passes
// (backupMatch below, the Owner's call 2026-11-21); every other row is listed with suggested cards
// (suggestLinks) on the staff portal's Graded links page (graded_review/{catalog}); and whatever
// staff set (graded_links/{catalog} → applyManualLinks) wins over any match.

const foldName = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim()

/** A collector number for comparing: before any "/", no set code, no leading zeros ("019/252" →
 *  "19", "OP01-001" → "1") */
export function normPcNumber(n) {
  let s = String(n ?? '').trim().toLowerCase().split('/')[0].trim()
  // A set code in front ("OP01-001" on PriceCharting, "001" on our One Piece card) — only ever
  // compared within one set, so the code adds nothing
  const coded = /^[a-z]+[0-9]*-([0-9]+[a-z]?)$/.exec(s)
  if (coded) s = coded[1]
  return s.replace(/^0+(?=[0-9])/, '')
}

/** "Ursula - Deceiver [Foil] #90" → { base: 'ursula deceiver', number: '90', variant: 'foil' };
 *  number '' when the name has none */
export function pcNameParts(productName) {
  const name = String(productName ?? '')
  // "… #90", or One Piece's bare code at the end ("Bartolomeo OP07-031")
  const m = /#\s*([A-Za-z0-9][A-Za-z0-9\-./]*)\s*$/.exec(name) ?? /\s([A-Z]{1,4}[0-9]{1,3}-[0-9]{2,3}[a-z]?)\s*$/.exec(name)
  const number = m ? normPcNumber(m[1]) : ''
  const base = foldName((m ? name.slice(0, m.index) : name).replace(/\[[^\]]*\]/g, ' '))
  return { base, number, variant: pcVariantOf(name) }
}

// Our set: its code when it has one (One Piece's OP07 holds cards under several set names — the
// booster, Judge Packs …), else its name
const cardSetKey = (catalog, c) => `${catalog}::${c.set || c.setCode || c.setName || ''}`
const rowTcgId = (row) => { const n = Number(String(row['tcg-id'] ?? '').trim()); return Number.isInteger(n) && n > 0 ? n : null }

/** Graded prices from a row whether or not it has a TCGplayer id (gradedFromRow needs one) */
export function rowGraded(row) {
  const prices = {}
  for (const [col, key] of Object.entries(GRADED_COLUMNS)) {
    const p = parsePcPrice(row[col])
    if (p > 0) prices[key] = p
  }
  if (!Object.keys(prices).length) return null
  const name = String(row['product-name'] ?? '').trim()
  const consoleName = String(row['console-name'] ?? '').trim()
  const pcId = String(row.id ?? '').trim()
  return { pcId, name, console: consoleName, url: pcIdUrl(pcId) ?? pcProductUrl(consoleName, name), prices }
}

/**
 * The Graded links list. rows: every PriceCharting row; catalogs: { catalogKey: cards[] };
 * priced: Set of "catalog:id" already priced; skip: Set of PriceCharting ids staff linked or
 * dismissed. → { [catalog]: items[] }, each item a PriceCharting card with graded prices that
 * prices nothing, plus our cards it could be: { pc, name, set, u, p, variant ('' or a GRADED_VARIANTS
 * key — "[Foil]" etc.), cards: [{ id, name, setName,
 * number, imageUrl, exact }] } — most valuable first, at most `max` per catalog.
 * Which of our sets a PriceCharting set is, is learned from its rows that do have ids (every one
 * pointing at the same set, at least 3). Candidates: that set's cards with the same number
 * (`exact` = the name matches too). Suggestions only — staff decide.
 */
export function suggestLinks(rows, catalogs, priced = new Set(), skip = new Set(), max = 400) {
  const byPid = new Map()
  for (const [catalog, cards] of Object.entries(catalogs)) for (const c of cards) {
    if (c?.hidden) continue
    const pid = productIdOf(c)
    if (pid == null) continue
    byPid.set(pid, byPid.has(pid) ? null : { catalog, card: c })
  }
  const votes = new Map()   // PriceCharting set → Map(our set → rows)
  for (const row of rows) {
    const t = rowTcgId(row)
    const hit = t ? byPid.get(t) : null
    if (!hit || pcVariantOf(row['product-name']) !== '') continue
    const con = String(row['console-name'] ?? '').trim()
    if (!votes.has(con)) votes.set(con, new Map())
    const k = cardSetKey(hit.catalog, hit.card)
    votes.get(con).set(k, (votes.get(con).get(k) ?? 0) + 1)
  }
  const setOf = new Map()
  for (const [con, v] of votes) {
    if (v.size !== 1) continue
    const [[k, n]] = [...v]
    if (n >= 3) setOf.set(con, k)
  }
  const bySetNumber = new Map()   // "setKey#number" → [{ catalog, card }]
  for (const [catalog, cards] of Object.entries(catalogs)) for (const c of cards) {
    if (c?.hidden) continue
    const k = `${cardSetKey(catalog, c)}#${normPcNumber(c.number)}`
    if (!bySetNumber.has(k)) bySetNumber.set(k, [])
    bySetNumber.get(k).push({ catalog, card: c })
  }

  const out = {}
  for (const row of rows) {
    const t = rowTcgId(row)
    if (t && byPid.get(t)) continue                  // links (or is ambiguous) by id — not ours to suggest
    const g = rowGraded(row)
    if (!g || skip.has(g.pcId)) continue
    const setKey = setOf.get(g.console)
    if (!setKey) continue
    const { base, number, variant } = pcNameParts(g.name)
    if (!number || variant === null || variant === 'holo') continue   // a rarity / art tag we can't place
    // A plain row is for a card with no graded price yet; a version row ("[Foil]") may also belong
    // to a card that's priced but doesn't have that version (applyManualLinks checks)
    const cands = (bySetNumber.get(`${setKey}#${number}`) ?? []).filter(({ catalog, card }) => variant !== '' || !priced.has(`${catalog}:${card.id}`))
    if (!cands.length || cands.length > 6) continue
    const catalog = cands[0].catalog
    ;(out[catalog] ??= []).push({
      pc: g.pcId, name: g.name, set: g.console, u: g.url, p: g.prices, variant,
      cards: cands.map(({ card }) => ({
        id: card.id, name: String(card.name ?? ''), setName: String(card.setName ?? ''), number: String(card.number ?? ''),
        imageUrl: String(card.imageUrl ?? ''), exact: foldName(card.name) === base,
      })).sort((a, b) => Number(b.exact) - Number(a.exact)),
    })
  }
  const worth = (i) => i.p.psa10 ?? i.p.g9 ?? Math.max(0, ...Object.values(i.p))
  for (const k of Object.keys(out)) out[k] = out[k].sort((a, b) => worth(b) - worth(a)).slice(0, max)
  return out
}

/** A confirmed link's slot on the card: '' = the card itself, or a version ('foil', '1st' …). A
 *  version row goes in as that version — unless the card staff picked is itself that version (a
 *  separate "… (Foil)" card): then it's the card's own price. */
export function linkSlot(variant, cardName) {
  if (!variant) return ''
  return variant === 'foil' && /\bfoil\b/i.test(String(cardName ?? '')) ? '' : variant
}

/** Applies what staff set (graded_links/{catalog}) to the day's entries — staff always win:
 *  - `links`: card id → { slot: PriceCharting id }, slot '_' = the card itself (REPLACES whatever
 *    matched — by TCGplayer id or by set + name + number: how a wrong link is redirected), or a
 *    version ('foil' …) added or replaced beside it;
 *  - `blocked`: card id → true — no graded prices at all (a wrong link removed).
 *  Each PriceCharting row's graded prices are today's; a row gone from the list or without graded
 *  sales adds nothing. Entries staff set carry via: 'staff'. → new entries, by id. */
export function applyManualLinks(entries, rows, links, blocked) {
  const byPc = new Map()
  for (const row of rows) { const id = String(row.id ?? '').trim(); if (id) byPc.set(id, row) }
  const out = new Map(entries.map((e) => [e.id, e]))
  for (const [cardId, slots] of Object.entries(links ?? {})) {
    const own = slots?._ ? rowGraded(byPc.get(String(slots._)) ?? {}) : null
    if (own) {
      const have = out.get(cardId)
      out.set(cardId, { id: cardId, pc: own.pcId, u: own.url, p: own.prices, ...(have?.v && { v: have.v }), via: 'staff' })
    }
    for (const [slot, pc] of Object.entries(slots ?? {})) {
      if (!GRADED_VARIANTS.includes(slot)) continue
      const g = pc ? rowGraded(byPc.get(String(pc)) ?? {}) : null
      if (!g) continue
      const base = out.get(cardId) ?? { id: cardId, pc: g.pcId, u: g.url, p: {}, via: 'staff' }
      out.set(cardId, { ...base, v: { ...base.v, [slot]: { p: g.prices, u: g.url } } })
    }
  }
  for (const [cardId, on] of Object.entries(blocked ?? {})) if (on) out.delete(cardId)
  return [...out.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

// ── Automatic backup matching (2026-11-21, the Owner's call) ────────────────────────────────────
// The same set + name + number match as suggestLinks, but applied without asking — only where it's
// unambiguous (one PriceCharting row, one of our cards, a card PriceCharting doesn't list under its
// own TCGplayer id, not already priced) and only for catalogs whose daily self-check (validateBackup)
// is nearly perfect (BACKUP_MAX_WRONG). Measured 2026-11-21 replaying rows that do have ids: Pokémon
// 7 wrong of 11,530, Japanese 3 of 11,829, Lorcana 0 of 372, Gundam 0 of 53 — on; Magic 137 of
// 3,245 and Riftbound 2 of 76 — off (suggestions only). Entries made this way carry via: 'match',
// are listed on the Graded links page to check, and staff can unlink or relink any of them.

/** The largest share of wrong answers in the self-check that still lets a catalog use it */
export const BACKUP_MAX_WRONG = 0.001

/** rows, catalogs, priced ("catalog:id" set) → [{ catalog, id, pc, u, p }]. hiddenPids: product ids
 *  to treat as unknown (validateBackup) */
export function backupMatch(rows, catalogs, priced = new Set(), hiddenPids = new Set()) {
  const pidOf = (c) => { const p = productIdOf(c); return p != null && hiddenPids.has(p) ? null : p }
  const byPid = new Map()
  for (const [catalog, cards] of Object.entries(catalogs)) for (const c of cards) {
    if (c?.hidden) continue
    const pid = pidOf(c)
    if (pid == null) continue
    byPid.set(pid, byPid.has(pid) ? null : { catalog, card: c })
  }
  const pidsOnPc = new Set()
  for (const row of rows) { const t = rowTcgId(row); if (t && !hiddenPids.has(t)) pidsOnPc.add(t) }
  const votes = new Map()
  for (const row of rows) {
    const t = rowTcgId(row)
    const hit = t ? byPid.get(t) : null
    if (!hit || pcVariantOf(row['product-name']) !== '') continue
    const con = String(row['console-name'] ?? '').trim()
    if (!votes.has(con)) votes.set(con, new Map())
    const k = cardSetKey(hit.catalog, hit.card)
    votes.get(con).set(k, (votes.get(con).get(k) ?? 0) + 1)
  }
  const setOf = new Map()
  for (const [con, v] of votes) {
    if (v.size !== 1) continue
    const [[k, n]] = [...v]
    if (n >= 3) setOf.set(con, k)
  }
  const ours = new Map()
  for (const [catalog, cards] of Object.entries(catalogs)) for (const c of cards) {
    if (c?.hidden) continue
    const k = `${cardSetKey(catalog, c)}#${normPcNumber(c.number)}#${foldName(c.name)}`
    if (!ours.has(k)) ours.set(k, [])
    ours.get(k).push({ catalog, card: c })
  }
  const pcPlain = new Map()
  for (const row of rows) {
    const { base, number, variant } = pcNameParts(row['product-name'])
    if (variant !== '' || !number) continue
    const k = `${String(row['console-name'] ?? '').trim()}#${number}#${base}`
    pcPlain.set(k, (pcPlain.get(k) ?? 0) + 1)
  }
  const found = new Map()
  for (const row of rows) {
    const t = rowTcgId(row)
    if (t && !hiddenPids.has(t)) continue
    const g = rowGraded(row)
    if (!g) continue
    const { base, number, variant } = pcNameParts(g.name)
    if (variant !== '' || !number || !base) continue
    const setKey = setOf.get(g.console)
    if (!setKey) continue
    if (pcPlain.get(`${g.console}#${number}#${base}`) !== 1) continue
    const cands = ours.get(`${setKey}#${number}#${base}`) ?? []
    if (cands.length !== 1) continue
    const { catalog, card } = cands[0]
    const key = `${catalog}:${card.id}`
    if (priced.has(key)) continue
    const pid = pidOf(card)
    if (pid != null && pidsOnPc.has(pid)) continue   // PriceCharting lists this card under its own id — this row is something else
    found.set(key, found.has(key) ? null : { catalog, id: card.id, pc: g.pcId, u: g.url, p: g.prices })
  }
  return [...found.values()].filter(Boolean)
}

/**
 * The daily self-check: rows that DO carry a TCGplayer id, replayed with the id hidden (a fifth at a
 * time, whole products together) and compared with what the id says → { catalog: { right, wrong,
 * examples } }. Backup matching is used only where wrong / (right + wrong) ≤ BACKUP_MAX_WRONG.
 */
export function validateBackup(rows, catalogs) {
  const byPid = new Map()
  for (const [catalog, cards] of Object.entries(catalogs)) for (const c of cards) {
    if (c?.hidden) continue
    const pid = productIdOf(c)
    if (pid == null) continue
    byPid.set(pid, byPid.has(pid) ? null : `${catalog}:${c.id}`)
  }
  const out = {}
  for (const catalog of Object.keys(catalogs)) out[catalog] = { right: 0, wrong: 0, examples: [] }
  const FOLDS = 5
  for (let f = 0; f < FOLDS; f++) {
    const truth = new Map()
    const hiddenPids = new Set()
    for (const row of rows) {
      const t = rowTcgId(row)
      if (!t || t % FOLDS !== f) continue
      hiddenPids.add(t)
      const k = byPid.get(t)
      if (k && pcVariantOf(row['product-name']) === '') truth.set(String(row.id ?? '').trim(), k)
    }
    for (const l of backupMatch(rows, catalogs, new Set(), hiddenPids)) {
      const want = truth.get(l.pc)
      if (!want) continue
      const got = `${l.catalog}:${l.id}`
      const o = out[l.catalog]
      if (got === want) o.right++
      else { o.wrong++; if (o.examples.length < 5) o.examples.push(`PriceCharting ${l.pc} → ${got}, but its TCGplayer id says ${want}`) }
    }
  }
  return out
}

/** Which catalogs may use backup matching today, from the self-check */
export function backupAllowed(check) {
  return new Set(Object.entries(check).filter(([, o]) => o.right >= 20 && o.wrong / (o.right + o.wrong) <= BACKUP_MAX_WRONG).map(([k]) => k))
}
