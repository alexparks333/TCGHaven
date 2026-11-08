// One Piece catalog with TCGplayer as the primary source (2026-11-08).
//
// Before: cards came from apitcg's GitHub dataset (github.com/apitcg/one-piece-tcg-data) and each
// card was given a TCGplayer price + photo by POSITION — a code's apitcg versions (base, _p1, _p2…)
// against TCGplayer's products for that code in productId order. apitcg is far behind (3,048
// versions, no OP13+, against TCGplayer's ~7,100 products) and lists fewer versions per code, so
// the position pairing showed the wrong version's photo and price on ~1 in 9 cards (EB01-006_p3,
// the Treasure Cup Chopper, showed the $3,000 PRB-01 Manga) and thousands of TCGplayer versions
// (regional / tournament / event promos, reprints, SP…) weren't in the app at all.
//
// Now every catalog card IS one TCGplayer product (+ its finish, for the 20 sold as Normal and
// Foil), and the link is saved on the card (`tcgProductId`, `tcgSubType`) — set once, never
// re-guessed, so what a card is can't drift.
//
//   THE PROMISE: a card already in the catalog never changes what a collector sees — id, name,
//   set, number, rarity, photo. Collectors logged it by what it showed, so it keeps the product its
//   photo shows and only its price refreshes (from that product; no price right now = keep the last).
//
//   - Every TCGplayer product that isn't a card yet becomes one, id `tcg-{productId}`. In its own
//     product's group (a booster, starter deck, deck set) it joins that group's set automatically;
//     in TCGplayer's promo buckets ("One Piece Promotion Cards", "… Release Event Cards", "…
//     Pre-Release Cards" …) it goes through Needs Review, placed in the event its name says.
//   - apitcg names each version precisely — its `set.name` is the product or event it came from
//     ("Treasure Cup November-December", "-ONE PIECE CARD THE BEST- [PRB-01]") — so a NEW apitcg
//     version is linked to the product with the same description (`linkApitcgVersions()`), and only
//     added if that product isn't a card already.
//   - Secondary check (report only): existing apitcg versions whose description names a different
//     product than the one they show — the old pairing's mistakes, left for staff to look at.

// Pure functions only — catalog-sync.mjs's downloadOnePiece() fetches and writes;
// scripts/onepiece-source-report.mjs runs the same build read-only.

import { cleanJpName, jpImageUrl } from './pokemon-jp.mjs'

export const CARD_CODE = /^[A-Z0-9]+-\d+$/

const titleCase = (s) => s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase())

// apitcg's raw set name → { code, name }: "-ROMANCE DAWN- [OP01]" → { OP01, "Romance Dawn" }
// (kept exactly as the old sync named them — collectors' sets don't get renamed)
export function parseApitcgSetName(raw) {
  const s = String(raw ?? '')
  const bracketMatch = s.match(/\[([^\]]+)\]\s*$/)
  if (!bracketMatch) return { code: null, name: titleCase(s.trim()) }
  const code = bracketMatch[1].replace(/[\s-]/g, '').toUpperCase()
  const name = titleCase(s.replace(/\[[^\]]+\]\s*$/, '').replace(/^[-\s]+|[-\s]+$/g, '') || s)
  return { code, name }
}

// "Kid & Killer - EB01-003 (SP)" → "Kid & Killer (SP)"; "Blueno (017)" → "Blueno"
export function cleanOpName(name) {
  return cleanJpName(String(name ?? '')
    .replace(/\s+-\s+[A-Z0-9]+-\d+[a-z]?(?=\s|$|[([])/g, '')
    .replace(/\s*\(\d{3}\)/g, ''))
}
const qualifiers = (name) => [...String(name).matchAll(/[([]([^)\]]*)[)\]]/g)].map((m) => m[1].trim())
const hasQualifier = (name) => qualifiers(name).length > 0

// How rare a version is among one code's products in its own set's group: the plain card, then
// Parallel / Alternate Art / Box Topper, then Manga, then SP / Gold / Treasure / Serial… — the
// order apitcg numbers a set's own versions (_p1, _p2, …) in
export function versionTier(name) {
  const q = qualifiers(name).join(' ')
  if (!q) return 0
  if (/\b(SP|Gold|Serial|Treasure|Pirate Foil|Wanted Poster|Super Alternate Art)\b/i.test(q)) return 3
  if (/Manga/i.test(q)) return 2
  return 1
}

// TCGplayer's buckets of odd cards — each card in them goes through Needs Review
export const PROMO_POOL = /promotion cards|release event cards|pre-?release cards|tournament cards|demo deck cards|revision pack cards|collection sets/i

/** A product's rows → one product, or null for sealed product / non-cards. */
export function productOf(rows) {
  const first = rows[0]
  const code = String(first.extNumber ?? '').trim()
  if (!CARD_CODE.test(code)) return null
  // One price per finish TCGplayer sells it in (almost always one; 20 products have Normal + Foil)
  const finishes = []
  for (const r of rows) {
    const sub = String(r.subTypeName ?? '').trim()
    if (finishes.some((f) => f.sub === sub)) continue
    const p = parseFloat(r.marketPrice) || parseFloat(r.midPrice) || parseFloat(r.lowPrice) || 0
    finishes.push({ sub, price: Math.round(p * 100) / 100 })
  }
  finishes.sort((x, y) => Number(/foil/i.test(x.sub)) - Number(/foil/i.test(y.sub)))
  return {
    productId: Number(first.productId),
    groupId: Number(first.groupId),
    code,
    rawName: String(first.name ?? ''),
    name: cleanOpName(first.name),
    rarity: String(first.extRarity ?? '').trim(),
    imageUrl: jpImageUrl(first),
    finishes,
    price: finishes[0]?.price ?? 0, // the product's own finish (Normal before Foil)
  }
}

/** The finish of `product` a card shows: the one saved on it, else the one priced closest to it. */
export function finishOf(product, card) {
  if (product.finishes.length < 2) return product.finishes[0]?.sub ?? ''
  if (card?.tcgSubType != null && product.finishes.some((f) => f.sub === card.tcgSubType)) return card.tcgSubType
  const want = Number(card?.marketPrice) || 0
  return [...product.finishes].sort((a, b) => Math.abs(a.price - want) - Math.abs(b.price - want))[0].sub
}

export function productsFromRows(rows) {
  const byId = new Map()
  for (const r of rows) {
    if (!r.productId) continue
    if (!byId.has(r.productId)) byId.set(r.productId, [])
    byId.get(r.productId).push(r)
  }
  return [...byId.values()].map(productOf).filter(Boolean)
}

/** The TCGplayer product a card's current photo shows (`…/product/544530_200w.jpg`), or null. */
export function productIdFromImage(url) {
  const m = String(url ?? '').match(/tcgplayer-cdn\.tcgplayer\.com\/product\/(\d+)_/)
  return m ? Number(m[1]) : null
}

// ── Describing a version ─────────────────────────────────────────────────────

const STOP = new Set(['one', 'piece', 'card', 'cards', 'the', 'set', 'of', 'and', 'edition', 'booster', 'deck', 'vol', 'a', 'in', 'included', 'game'])
const MONTHS = /(january|february|march|april|may|june|july|august|september|october|november|december)/
export function tokens(s) {
  const t = String(s ?? '').toLowerCase()
    .replace(/(\d{2})-(\d{2}) season/g, '20$1') // "25-26 Season 1" ↔ "2025 Vol.1"
    .replace(/\b(\d{2})-(\d{2})\b/g, '20$1')
  return new Set((t.match(/[a-z]+|\d+/g) ?? []).filter((w) => !STOP.has(w) && !(w.length === 1 && /[a-z]/.test(w))))
}
const overlap = (a, b) => { let n = 0; for (const x of a) if (b.has(x)) n++; return n }

// How well a TCGplayer product matches an apitcg version's description (its set name): the share
// of the description's words found in the product's qualifiers + group name
function describeScore(apiSetName, product, groupName) {
  const want = tokens(apiSetName)
  if (!want.size) return 0
  const have = tokens(`${qualifiers(product.rawName).join(' ')} ${groupName}`)
  let score = overlap(want, have) / want.size
  // A month or a year the description names but the product contradicts is a different event
  const m1 = String(apiSetName).toLowerCase().match(MONTHS)
  if (m1 && /(january|february|march|april|may|june|july|august|september|october|november|december)/.test([...have].join(' ')) && !have.has(m1[1])) score -= 0.5
  return score
}

/**
 * Which TCGplayer product each apitcg version is. Pure.
 * @param versions  apitcg cards of ONE code (base `code`, then `code_p1`, `code_r1`, …)
 * @param products  that code's TCGplayer products not already taken
 * @returns Map apitcg id → productId (only confident links)
 */
export function linkApitcgVersions(versions, products, groupNameOf, { linkedBase = null } = {}) {
  const out = new Map()
  const free = new Map(products.map((p) => [p.productId, p]))
  const take = (id, p) => { out.set(id, p.productId); free.delete(p.productId) }
  const core = (v) => parseApitcgSetName(v.set?.name).name.toLowerCase()
  const code = versions[0]?.code ?? linkedBase?.version.code
  // `linkedBase`: { version, groupId } when the base card is already linked (an earlier sync)
  const base = linkedBase?.version ?? versions.find((v) => v.id === code)
  const homeSet = base ? core(base) : null

  // The base card: a plain product, from the group that best matches its set (promo codes `P-…`
  // have no home booster — they're matched by description below like any version)
  let homeGroup = linkedBase?.groupId ?? null
  if (base && !linkedBase && !/^P-/.test(code)) {
    const plain = [...free.values()].filter((p) => !hasQualifier(p.name))
    const pick = plain.sort((a, b) =>
      describeScore(base.set?.name, b, groupNameOf(b.groupId)) - describeScore(base.set?.name, a, groupNameOf(a.groupId)) || a.productId - b.productId)[0]
    if (pick) { take(base.id, pick); homeGroup = pick.groupId }
  }

  // Versions described as some other product or event: the best-described product, if clearly best
  const rest = versions.filter((v) => !out.has(v.id) && v.id !== base?.id)
  const sameSet = rest.filter((v) => homeSet && core(v) === homeSet)
  const described = [...rest.filter((v) => !sameSet.includes(v)), ...(base && !linkedBase && !out.has(base.id) ? [base] : [])]
  for (const v of described) {
    const scored = [...free.values()].map((p) => ({ p, s: describeScore(v.set?.name, p, groupNameOf(p.groupId)) })).sort((a, b) => b.s - a.s || a.p.productId - b.p.productId)
    const [best, second] = scored
    if (best && best.s >= 0.5 && (!second || best.s > second.s)) take(v.id, best.p)
  }

  // The set's own versions (Parallel / Alternate Art, Manga, SP…), in apitcg's order, against the
  // home group's other products in rarity order
  if (homeGroup != null && sameSet.length) {
    const num = (v) => parseInt(String(v.id).split(/_[pr]/)[1] ?? '0', 10)
    const ordered = sameSet.sort((a, b) => num(a) - num(b))
    const pool = [...free.values()].filter((p) => p.groupId === homeGroup && hasQualifier(p.name))
      .sort((a, b) => versionTier(a.name) - versionTier(b.name) || a.productId - b.productId)
    ordered.forEach((v, i) => { if (pool[i]) take(v.id, pool[i]) })
  }
  return out
}

// ── Set names for cards built from TCGplayer ────────────────────────────────

// "ST-29: Starter Deck 29 Egghead" → "Egghead", "Extra Booster: Memorial Collection" → "Memorial
// Collection" — the way apitcg names the same products — keeping TCGplayer's own casing
export function groupSetName(groupName) {
  return String(groupName)
    .replace(/^ST-\d+:\s*(Starter Deck \d+|Ultra Deck)\s*/i, '')
    .replace(/^Extra Booster:\s*/i, '')
    .trim() || String(groupName)
}

// A promo's event, from its name: "Spandine (Online Regional Champion Card Set 2025 Vol.1)" →
// "Online Regional Champion Card Set 2025 Vol.1"; a version label (Parallel, Alternate Art…) isn't one
const VERSION_LABEL = /^(parallel|alternate art|manga|sp|gold|reprint|box topper|pirate foil|super alternate art|textured foil|jolly roger foil|winner|serial)$/i
export function promoEvent(product) {
  // Round brackets name the event; square ones a placing ("[Winner]", "[Finalist]")
  const round = [...String(product.rawName).matchAll(/\(([^)]*)\)/g)].map((m) => m[1].trim())
  return round.filter((q) => !VERSION_LABEL.test(q) && !/^\d+$/.test(q)).pop() ?? null
}

// ── The whole build ─────────────────────────────────────────────────────────

/**
 * @param apiCards        apitcg cards, deduped by id, in file order
 * @param groups          TCGplayer groups (category 68)
 * @param productsByGroup groupId → productsFromRows(that group's CSV)
 * @param existing        Map catalog id → the card as it is now (setName, imageUrl, tcgProductId…)
 * @param failedGroupIds  groups whose CSV failed: their products' cards are left as they are
 */
export function buildOnePieceCatalog({ apiCards, groups, productsByGroup, existing = new Map(), failedGroupIds = new Set() }) {
  const report = {
    linkedApitcg: 0, linkedByPhoto: 0, newCards: 0, reviewCards: 0,
    apitcgAlreadyCards: [], lostProducts: [], mismatches: [],
  }
  const groupById = new Map(groups.map((g) => [g.groupId, g]))
  const groupNameOf = (id) => groupById.get(id)?.name ?? ''
  const products = new Map()
  const byCode = new Map()
  for (const list of productsByGroup.values()) {
    for (const p of list) {
      products.set(p.productId, p)
      if (!byCode.has(p.code)) byCode.set(p.code, [])
      byCode.get(p.code).push(p)
    }
  }
  const apiById = new Map(apiCards.map((c) => [c.id, c]))
  const link = new Map()     // catalog id → productId
  const finishById = new Map() // catalog id → the finish it shows (products sold in two)
  const claimed = new Map()  // `${productId}:${finish}` → catalog ids
  const keyOf = (pid, sub) => `${pid}:${sub ?? ''}`
  const isClaimed = (pid) => [...(products.get(pid)?.finishes ?? [{ sub: '' }])].some((f) => claimed.has(keyOf(pid, f.sub)))
  const claim = (id, productId, sub = products.get(productId)?.finishes[0]?.sub ?? '') => {
    link.set(id, productId)
    finishById.set(id, sub)
    const k = keyOf(productId, sub)
    if (!claimed.has(k)) claimed.set(k, [])
    claimed.get(k).push(id)
  }

  // 1. Every card already in the catalog keeps the product it shows — collectors logged it by that
  // photo, name and set, so none of it changes. The link saved by an earlier sync, else the
  // product its current photo shows. (A few existing cards share one product — duplicates the old
  // position pairing made; both stay, both priced by that product.)
  for (const [id, c] of existing) {
    const pid = Number(c.tcgProductId) || productIdFromImage(c.imageUrl)
    if (pid) claim(id, pid, products.has(pid) ? finishOf(products.get(pid), c) : (c.tcgSubType ?? ''))
  }
  report.linkedByPhoto = link.size

  // 2. apitcg versions that aren't cards yet: the product their description names, if it isn't a
  // card already (then apitcg is just catching up on a version the catalog has)
  const apiByCode = new Map()
  for (const c of apiCards) {
    if (!apiByCode.has(c.code)) apiByCode.set(c.code, [])
    apiByCode.get(c.code).push(c)
  }
  for (const [code, versions] of apiByCode) {
    const fresh = versions.filter((v) => !existing.has(v.id))
    if (!fresh.length) continue
    const free = (byCode.get(code) ?? []).filter((p) => !isClaimed(p.productId))
    const baseVersion = versions.find((v) => v.id === code)
    const linkedBase = baseVersion && link.has(code) && products.has(link.get(code))
      ? { version: baseVersion, groupId: products.get(link.get(code)).groupId } : null
    const found = linkApitcgVersions(fresh, free, groupNameOf, { linkedBase })
    for (const v of fresh) {
      const pid = found.get(v.id)
      if (pid && !isClaimed(pid)) claim(v.id, pid)
      else report.apitcgAlreadyCards.push({ id: v.id, set: v.set?.name })
    }
  }
  report.linkedApitcg = [...link.keys()].filter((id) => apiById.has(id)).length

  // 3. Secondary check (report only — nothing changes): apitcg versions whose description names a
  // different product than the one the card shows. The old position pairing gave these the wrong
  // version's photo and price; which version a collector holds can't be told from here.
  for (const [code, versions] of apiByCode) {
    const inCatalog = versions.filter((v) => existing.has(v.id))
    if (!inCatalog.length) continue
    const described = linkApitcgVersions(versions, byCode.get(code) ?? [], groupNameOf)
    for (const v of inCatalog) {
      const want = described.get(v.id)
      const has = link.get(v.id)
      if (want && has && want !== has) {
        report.mismatches.push({
          id: v.id, set: v.set?.name,
          shows: { productId: has, name: products.get(has)?.rawName, group: groupNameOf(products.get(has)?.groupId), price: products.get(has)?.price },
          described: { productId: want, name: products.get(want)?.rawName, group: groupNameOf(products.get(want)?.groupId), price: products.get(want)?.price },
        })
      }
    }
  }

  // ── Set names for NEW cards: the name the catalog's cards from the same TCGplayer group already
  // carry (so new cards join their set), else the group's own name, cleaned; never a broken name
  const BROKEN_SET = /^(p|op-\d+|st-\d+:.*|)$/i
  const knownByLower = new Map()
  for (const c of existing.values()) if (c.setName && !BROKEN_SET.test(c.setName)) knownByLower.set(c.setName.toLowerCase(), c.setName)
  const known = (name) => knownByLower.get(String(name).toLowerCase()) ?? name
  const votes = new Map()
  for (const [id, pid] of link) {
    const ex = existing.get(id)
    const g = products.get(pid)?.groupId
    if (!ex?.setName || g == null || BROKEN_SET.test(ex.setName) || PROMO_POOL.test(groupNameOf(g))) continue
    if (!votes.has(g)) votes.set(g, new Map())
    votes.get(g).set(ex.setName, (votes.get(g).get(ex.setName) ?? 0) + 1)
  }
  const setNameOfGroup = new Map()
  for (const g of groups) {
    const v = [...(votes.get(g.groupId) ?? new Map())].sort((a, b) => b[1] - a[1])
    const total = v.reduce((n, [, k]) => n + k, 0)
    setNameOfGroup.set(g.groupId, v[0] && v[0][1] >= total * 0.6 ? v[0][0] : known(groupSetName(g.name)))
  }
  // A promo's set: the event its name says, matched to a set the catalog already has when the
  // words agree ("(Treasure Cup 2024)" → that Treasure Cup), else the event itself
  const knownTokens = [...knownByLower.values()].map((n) => [n, tokens(n)])
  const setOfProduct = (p) => {
    const gName = groupNameOf(p.groupId)
    if (!/promotion cards/i.test(gName)) return setNameOfGroup.get(p.groupId)
    const event = promoEvent(p)
    if (!event) return known(groupSetName(gName))
    const t = tokens(event)
    let best = null
    for (const [n, nt] of knownTokens) {
      const sc = overlap(t, nt) / Math.max(t.size, nt.size, 1)
      if (sc >= 0.75 && (!best || sc > best.s)) best = { n, s: sc }
    }
    return best?.n ?? known(event)
  }
  // A set's product code (the Cardex's Main Sets key): apitcg's bracket, or for a TCGplayer group
  // that's one numbered product, the code prefix nearly all its cards share
  const setCodes = new Map()
  for (const c of apiCards) { const s = parseApitcgSetName(c.set?.name); if (s.name && !setCodes.has(s.name)) setCodes.set(s.name, s.code) }
  for (const g of groups) {
    const name = setNameOfGroup.get(g.groupId)
    if (setCodes.has(name) || PROMO_POOL.test(g.name)) continue
    const prefixes = new Map()
    const list = productsByGroup.get(g.groupId) ?? []
    for (const p of list) { const pre = p.code.split('-')[0]; prefixes.set(pre, (prefixes.get(pre) ?? 0) + 1) }
    const [top] = [...prefixes].sort((a, b) => b[1] - a[1])
    setCodes.set(name, top && top[1] >= list.length * 0.8 && top[0] !== 'P' ? top[0] : null)
  }

  // ── Cards
  const cards = []
  const placements = []
  const priced = (pid) => products.has(pid) && !failedGroupIds.has(products.get(pid).groupId)
  // Existing cards: only the price (from the product they show) and the saved link change. apitcg's
  // own text is refreshed as the old sync did (same values — it's how they were named).
  for (const [id, ex] of existing) {
    const pid = link.get(id)
    const c = apiById.get(id)
    const card = { id }
    if (c) {
      const { code } = parseApitcgSetName(c.set?.name)
      const num = c.code.match(/-(\d+)$/)?.[1]
      if (num) Object.assign(card, { name: c.name, set: code ?? c.code.split('-')[0], setName: parseApitcgSetName(c.set?.name).name, number: num, rarity: c.rarity ?? '' })
    }
    if (pid && priced(pid)) {
      const sub = finishById.get(id)
      const price = products.get(pid).finishes.find((f) => f.sub === sub)?.price ?? 0
      Object.assign(card, { tcgProductId: pid, tcgSubType: sub })
      // No TCGplayer price right now (sold out, new listing): the card keeps its last price
      if (price > 0) card.marketPrice = price
    } else if (pid && !products.has(pid)) report.lostProducts.push({ id, productId: pid })
    if (Object.keys(card).length > 1) cards.push(card)
  }
  // New apitcg versions
  for (const c of apiCards) {
    if (existing.has(c.id) || !link.has(c.id)) continue
    const p = products.get(link.get(c.id))
    const { code, name: setName } = parseApitcgSetName(c.set?.name)
    cards.push({
      id: c.id, name: c.name, set: code ?? c.code.split('-')[0], setName, number: c.code.match(/-(\d+)$/)[1], rarity: c.rarity ?? '',
      imageUrl: p.imageUrl, marketPrice: p.price, tcgProductId: p.productId, tcgSubType: finishById.get(c.id),
    })
    report.newCards++
  }
  // Every TCGplayer product that isn't a card yet
  // (a product sold in two finishes is two cards: `tcg-{id}` is its first finish, `tcg-{id}-foil` …)
  for (const p of products.values()) {
    if (failedGroupIds.has(p.groupId)) continue
    p.finishes.forEach((f, i) => {
      if (claimed.has(keyOf(p.productId, f.sub))) return
      const second = i > 0 || (p.finishes.length > 1 && claimed.has(keyOf(p.productId, p.finishes[0].sub)))
      const id = second ? `tcg-${p.productId}-${(f.sub || 'other').toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : `tcg-${p.productId}`
      const card = {
        id, name: second ? `${p.name} (${f.sub})` : p.name, set: p.code.split('-')[0], setName: setOfProduct(p),
        number: p.code.match(/-(\d+)$/)[1], rarity: p.rarity, imageUrl: p.imageUrl, marketPrice: f.price,
        tcgProductId: p.productId, tcgSubType: f.sub,
      }
      claim(id, p.productId, f.sub)
      report.newCards++
      if (PROMO_POOL.test(groupNameOf(p.groupId))) { card._review = true; card._groupId = p.groupId; placements.push(p); report.reviewCards++ }
      cards.push(card)
    })
  }

  // Same card text-set naming the registry keys on (setName → code; null = no product code)
  const setCodesBySetName = {}
  for (const c of cards) if (!(c.setName in setCodesBySetName)) setCodesBySetName[c.setName] = setCodes.get(c.setName) ?? null
  return { cards, placements, setCodesBySetName, report }
}
