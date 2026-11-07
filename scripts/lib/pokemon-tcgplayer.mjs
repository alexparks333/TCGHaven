// English Pokémon catalog with TCGplayer as the primary source (2026-11-06).
//
// Before: cards came only from pokemon-tcg-data (GitHub) and TCGplayer only priced them. GitHub is
// days behind on new sets (Delta Reign: on TCGplayer on release day, not on GitHub) and never has
// whole kinds of cards: Prismatic Evolutions' Poké Ball / Master Ball patterns (GitHub 180 cards,
// TCGplayer 347), Prize Pack, Jumbo, League, Blister and Deck exclusives… ~28k TCGplayer singles
// against GitHub's ~20.5k.
//
// Now: TCGplayer decides which cards exist; GitHub is the secondary source we check against.
//
//   THE RULE: a catalog card's id never changes once it exists. Inventory links to the catalog by
//   `apiId` = catalog id, so as long as ids are stable no collection can break.
//
//   - A TCGplayer product that IS a card GitHub has (same set, same number, the plain product)
//     is linked to that card and keeps its GitHub id (`sv7-1`). GitHub's name / image / rarity stay
//     — they're cleaner, and they're what every existing collection already shows.
//   - Any other TCGplayer product becomes its own card, id `tcg-{productId}`:
//       · in a set GitHub has  → a variant GitHub lacks (Poké Ball Pattern, Black Dot Error, …),
//                                 placed in that set (its `set` is the GitHub set id)
//       · in a numbered set GitHub doesn't have yet (Delta Reign) → a new set `tcg-{groupId}`,
//                                 added automatically — full sets are never reviewed
//       · in any other group (promos, Prize Pack, Jumbo, …) → a set for that group, and each card
//                                 goes through Needs Review (it can't be placed by number)
//   - Once a set is built from TCGplayer it stays TCGplayer's ("claimed", recorded on its set-list
//     entry as `tcgplayerGroupId`). When GitHub catches up, GitHub's copy is only compared against,
//     never added — no duplicate set, no id handover.
//   - GitHub cards TCGplayer doesn't list are still kept (and nothing is ever deleted —
//     syncToFirestore() never drops a card).
//
// Pure functions only — catalog-sync.mjs's downloadPokemon() does the fetching and writing, and
// scripts/pokemon-source-report.mjs runs the same build as a read-only report.

import { normSetName, levenshtein } from './text-norm.mjs'
import { fallbackPokemonSetId } from './pokemon-groups.mjs'
import { EDITION_GROUPS, newPriceEntry, addPriceRow, legacyFields, classifySubtype, variantKey } from './pokemon-variants.mjs'
import { cleanJpName, jpImageUrl, placeholderDates, JP_PROMO_ERA } from './pokemon-jp.mjs'

// "001/195" → "1", "TG01/TG30" → "TG1" — the key a TCGplayer number and a GitHub number share.
export function normCardNum(n) {
  const base = String(n ?? '').split('/')[0].trim()
  return base.replace(/^([A-Za-z]*)0*(\d+)([a-z]?)$/, (_, alpha, digits, suffix) =>
    alpha.toUpperCase() + parseInt(digits, 10) + suffix
  ) || base
}

// The number as the catalog shows it, in GitHub's style: "011/084" → "11", "TG01/TG30" → "TG01",
// "SVP 123" → "SVP 123".
export function catalogNumber(extNumber) {
  const raw = String(extNumber ?? '').split('/')[0].trim()
  return /^\d+$/.test(raw) ? String(parseInt(raw, 10)) : raw
}

// GitHub cards get catalog id `${setId}-${number}`, but a few sets reuse a number for different
// cards (Celebrations Classic Collection #15 is four; 30th Celebration Classic Collection #106 three,
// #11 two; and GitHub numbers Black Bolt's Antique Cover Fossil 60 instead of 80). Before 2026-11-06
// those all landed on ONE catalog card, so only one of them existed in the app. Now the card the
// catalog already shows under that id keeps it (collectors who own it stay linked to the same card)
// and the others use GitHub's own id (`cel25c-15_A1`, `me55c-106p`, `zsv10pt5-80`).
// `cards` carry `_ghId` (GitHub's id); `existingNameById` = catalog id → the name it shows now.
export function resolveIdCollisions(cards, existingNameById = new Map()) {
  const byId = new Map()
  for (const c of cards) {
    if (!byId.has(c.id)) byId.set(c.id, [])
    byId.get(c.id).push(c)
  }
  const moved = []
  for (const [id, list] of byId) {
    if (list.length < 2) continue
    const keeper = list.find((c) => c.name === existingNameById.get(id)) ?? list.find((c) => c._ghId === id) ?? list[list.length - 1]
    for (const c of list) {
      if (c === keeper) continue
      // GitHub's own id, unless that IS the shared id (30th Celebration's Metagross is `me55c-11` on
      // GitHub, but the catalog has shown Genesect-EX there) — then a stable id from its name
      const to = c._ghId && c._ghId !== id ? c._ghId : `${id}_${String(c.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`
      moved.push({ from: id, to, name: c.name })
      c.id = to
    }
  }
  for (const c of cards) delete c._ghId
  return moved
}

/** Catalog ids several GitHub cards would share (see resolveIdCollisions). */
export function collidingIds(cards) {
  const seen = new Set()
  const dupes = new Set()
  for (const c of cards) (seen.has(c.id) ? dupes : seen).add(c.id)
  return [...dupes]
}

// ── Which TCGplayer group is which GitHub set ────────────────────────────────
// Moved here unchanged from downloadPokemon() (it decided which group priced which set; it now
// also decides which products are GitHub's cards). Returns groupId → { setId, editionOpts? }.
export function matchGroupsToSets(groups, ghSets) {
  const nameToSetId = new Map()
  for (const s of ghSets) nameToSetId.set(normSetName(s.name), s.id)
  const setIdSet = new Set(ghSets.map((s) => s.id))
  const out = new Map()
  for (const g of groups) {
    const special = EDITION_GROUPS[g.name]
    if (special) {
      if (setIdSet.has(special.setId)) out.set(g.groupId, { setId: special.setId, editionOpts: { unlimitedIs: special.unlimitedIs } })
      continue
    }
    // Strategy 1: strip set-code prefix like "SWSH12: " / "SV07: " / "SV: "
    const stripped = g.name.replace(/^[A-Z0-9]+:\s*/i, '').trim()
    const stripped2 = stripped.replace(/\s+(Trainer Gallery|Shiny Vault|Galarian Gallery|Radiant Collection|Classic Collection)$/i, '').trim()
    let setId = null
    for (const v of [stripped, stripped2, g.name]) {
      const id = nameToSetId.get(normSetName(v))
      if (id) { setId = id; break }
    }
    // Strategy 2: abbreviation ("SWSH01" → "swsh1")
    if (!setId && g.abbreviation) {
      const abbrev = g.abbreviation.toLowerCase().replace(/^([a-z]+)0*([1-9]\d*)$/, '$1$2')
      if (setIdSet.has(abbrev)) setId = abbrev
    }
    // Strategy 3: TCGplayer's older naming — pokemon-groups.mjs
    if (!setId) setId = fallbackPokemonSetId(g.name, nameToSetId, setIdSet)
    if (setId) out.set(g.groupId, { setId })
  }
  return out
}

// ── TCGplayer rows → products ────────────────────────────────────────────────

// TCGplayer appends the collector number to many names: "Masquerain - 003/103", "Basic Grass Energy
// - 001", "Shiinotic - SM10 (Prerelease) [Staff]", "Alolan Sandshrew - 19a/145". The catalog has its
// own number field — "Shiinotic (Prerelease) [Staff]".
// "Pikachu (1)" / "Drowzee (74a)" — a number in brackets is the same thing.
export function cleanEnName(name) {
  return cleanJpName(String(name ?? '')
    .replace(/\s+-\s+[A-Za-z]{0,5}\d+[a-z]?(?:\/[A-Za-z]{0,5}\d+)?(?=\s|$|[([])/g, '')
    .replace(/\s*\(\d+[a-z]?\)/g, ''))
}

// Not cards: digital code cards, and rows TCGplayer gives no rarity ("None") and no number.
const NOT_A_CARD_RARITY = new Set(['code card'])

/** A product's rows (one per printing TCGplayer prices) → one product, or null if it isn't a card. */
export function productOf(rows) {
  const first = rows[0]
  const extNumber = String(first.extNumber ?? '').trim()
  const extRarity = String(first.extRarity ?? '').trim()
  if (NOT_A_CARD_RARITY.has(extRarity.toLowerCase())) return null
  if (/^code card\b/i.test(first.name ?? '')) return null
  // Sealed product has neither; a card has at least one. "None" with no number is an accessory.
  if (!extNumber && (!extRarity || extRarity === 'None')) return null
  return {
    productId: Number(first.productId),
    groupId: Number(first.groupId),
    name: cleanEnName(first.name),
    rawName: String(first.name ?? ''),
    extNumber,
    numKey: extNumber ? normCardNum(extNumber) : '',
    extRarity,
    imageUrl: jpImageUrl(first),
    rows,
  }
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

// TCGplayer's rarity names → the GitHub taxonomy the Cardex's rarity order and filters use
// (CARDEX_RARITY_ORDER in lib/api/catalog.ts). Only TCGplayer-built cards use these — a linked card
// keeps GitHub's own rarity. Anything not listed passes through (it sorts after the known ones).
const RARITY_TO_GITHUB = {
  'holo rare': 'Rare Holo',
  'secret rare': 'Rare Secret',
  'shiny holo rare': 'Rare Shiny',
  'rainbow rare': 'Rare Rainbow',
  'prism rare': 'Rare Prism Star',
  'rare ace': 'Rare ACE',
  'unconfirmed': '',
  'none': '',
}
export function githubRarity(extRarity) {
  const r = String(extRarity ?? '').trim()
  const mapped = RARITY_TO_GITHUB[r.toLowerCase()]
  return mapped !== undefined ? mapped : r
}

// ── Sets built from TCGplayer ───────────────────────────────────────────────

// Groups that are never one numbered set, whatever their numbers look like.
const ODD_GROUP = /promo|prize pack|jumbo|championship|league|exclusive|miscellaneous|blister|deck|battle academy|trick or trade|mcdonald|burger king|collection promos|first partner|pikachu world|professor program|alternate art|staff|prerelease|kids wb|best of game|pop series|world|trainer kit|kit\b/i

/**
 * Whether an unmatched group is a whole numbered set (added automatically, like Delta Reign) — as
 * opposed to a promo / special group whose cards go through Needs Review. A set prints its cards as
 * "NNN/TTT" with one total for (nearly) all of them; promo groups use "SVP 001"-style numbers or mix
 * reprints from many sets.
 */
export function isNumberedSet(group, products) {
  if (ODD_GROUP.test(group.name)) return false
  const numbered = products.filter((p) => /^\d+\/\d+$/.test(p.extNumber))
  if (numbered.length < 20 || numbered.length < products.length * 0.9) return false
  const totals = new Map()
  for (const p of numbered) {
    const t = p.extNumber.split('/')[1]
    totals.set(t, (totals.get(t) ?? 0) + 1)
  }
  const top = Math.max(...totals.values())
  return top >= numbered.length * 0.9
}

/** "ME06: Delta Reign" → "Delta Reign" (TCGplayer's set-code prefix off). */
export function tcgSetName(groupName, takenNames) {
  const stripped = String(groupName).replace(/^[A-Z0-9]+:\s*/i, '').trim()
  const name = stripped || groupName
  return takenNames.has(normSetName(name)) ? groupName : name
}

// The Cardex groups Pokémon sets by `series`. TCGplayer's set-code prefix says the era.
const SERIES_BY_PREFIX = [
  [/^ME\d*:/i, 'Mega Evolution'],
  [/^SV\d*:/i, 'Scarlet & Violet'],
  [/^SWSH\d*:/i, 'Sword & Shield'],
  [/^SM\d*\b/i, 'Sun & Moon'],
  [/^XY\b/i, 'XY'],
  [/^(BW|Black and White)\b/i, 'Black & White'],
]
// The same group the Japanese Cardex puts its promo sets in (last, after the eras — CardexPage.tsx)
export const TCG_SPECIAL_SERIES = JP_PROMO_ERA
export function tcgSeries(group, numberedSet, ghSets, releaseDate) {
  for (const [re, series] of SERIES_BY_PREFIX) if (re.test(group.name)) return series
  if (!numberedSet || !releaseDate) return TCG_SPECIAL_SERIES
  // A numbered set with no prefix: the era of the newest GitHub set released on or before it
  const before = ghSets
    .filter((s) => s.series && s.series !== 'Other' && (s.releaseDate ?? '') <= releaseDate)
    .sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? ''))
  return before[0]?.series ?? TCG_SPECIAL_SERIES
}

// Common / Uncommon / everything rarer — the one level both sites' rarity names agree on.
// Promos and blanks have no tier.
export function rarityTier(rarity) {
  const r = String(rarity ?? '').trim().toLowerCase()
  if (!r || r === 'promo' || r === 'none' || r === 'unconfirmed') return ''
  if (r === 'common') return 'common'
  if (r === 'uncommon') return 'uncommon'
  return 'rare'
}

/** One catalog card built from a TCGplayer product. */
export function tcgCard(product, set) {
  const entry = newPriceEntry()
  for (const r of product.rows) addPriceRow(entry, r)
  return {
    id: `tcg-${product.productId}`,
    name: product.name,
    set: set.id,
    setName: set.name,
    number: catalogNumber(product.extNumber),
    rarity: githubRarity(product.extRarity),
    imageUrl: product.imageUrl,
    ...legacyFields(entry),
  }
}

// A group no name rule matched, matched by what's in it instead: if most of its numbered products
// are cards of one GitHub set (same number, same name), it IS that set. This is what keeps a set
// from being built twice when names drift (GitHub renames a set, TCGplayer renames a group) — the
// alternative would be a whole duplicate set of `tcg-` cards. Claimed groups are left alone.
export function matchGroupsByContent(groups, ghCards, productsByGroup, matches, claimed, report) {
  const matchedSets = new Set([...matches.values()].map((m) => m.setId))
  const bySetKey = new Map() // "num|name" → set ids
  for (const c of ghCards) {
    const k = `${normCardNum(c.number)}|${nameKey(c.name)}`
    if (!bySetKey.has(k)) bySetKey.set(k, [])
    bySetKey.get(k).push(c.set)
  }
  for (const g of groups) {
    if (matches.has(g.groupId) || claimed.has(g.groupId)) continue
    const numbered = (productsByGroup.get(g.groupId) ?? []).filter((p) => p.numKey)
    if (numbered.length < 5) continue
    const votes = new Map()
    for (const p of numbered) {
      for (const setId of new Set(bySetKey.get(`${p.numKey}|${nameKey(p.name)}`) ?? [])) votes.set(setId, (votes.get(setId) ?? 0) + 1)
    }
    const [best, second] = [...votes].sort((a, b) => b[1] - a[1])
    if (!best || best[1] < numbered.length * 0.6 || (second && second[1] > best[1] * 0.5)) continue
    // A set some other group already prices is a reprint group (Prize Pack…), not that set
    if (matchedSets.has(best[0])) continue
    matches.set(g.groupId, { setId: best[0] })
    report?.contentMatched.push({ group: g.name, setId: best[0], matched: best[1], of: numbered.length })
  }
}

// ── The whole build ─────────────────────────────────────────────────────────

// A card name without its qualifiers, for comparing: "Pikachu (Poke Ball Pattern)" → "pikachu",
// "Pikachu δ" → "pikachu", "Mewtwo-EX" → "mewtwo ex"
const nameKey = (s) => normSetName(String(s ?? '').replace(/\s*[([][^)\]]*[)\]]/g, ''))
const hasQualifier = (name) => /[([]/.test(name)

// Energy-type words as TCGplayer abbreviates them ("Bubbly W Energy", "Unit Energy FDY", "Fairy
// Charm L"). The first word is left alone ("Fairy Charm …" is a card name, not a type).
const TYPE_LETTER = { grass: 'G', fire: 'R', water: 'W', lightning: 'L', psychic: 'P', fighting: 'F', darkness: 'D', metal: 'M', fairy: 'Y', dragon: 'N', colorless: 'C' }
function abbreviateTypes(name) {
  const [first, ...rest] = String(name).split(' ')
  const tail = rest.join(' ').replace(/(Grass|Fire|Water|Lightning|Psychic|Fighting|Darkness|Metal|Fairy|Dragon|Colorless)/g, (w) => TYPE_LETTER[w.toLowerCase()])
  return [first, tail.replace(/\b([A-Z])\s(?=[A-Z]\b)/g, '$1')].filter(Boolean).join(' ')
}
// The ways one card's name can be written: as is, types abbreviated, "δ"/"Delta" dropped, and the
// English inside brackets (GitHub's "ナッシー[Exeggutor]")
function nameForms(name) {
  const raw = String(name ?? '')
  // GitHub's symbols as TCGplayer spells them: "Umbreon ★" / "Umbreon Star", "Nidoran ♀" / "Nidoran F"
  const spelled = raw.replace(/★/g, ' Star').replace(/♀/g, ' F').replace(/♂/g, ' M').replace(/δ/g, ' Delta ').replace(/\s+/g, ' ').trim()
  const forms = [nameKey(raw), nameKey(spelled), nameKey(abbreviateTypes(raw)), nameKey(raw.replace(/^(delta|δ)\s+/i, ''))]
  for (const m of raw.matchAll(/\[([^\]]+)\]/g)) forms.push(normSetName(m[1]))
  return [...new Set(forms.filter(Boolean))]
}
const formsAgree = (a, b) => a === b || a.startsWith(`${b} `) || b.startsWith(`${a} `) || a.endsWith(` ${b}`) || b.endsWith(` ${a}`)
  || 1 - levenshtein(a, b) / Math.max(a.length, b.length) >= 0.8

// Whether a TCGplayer product's name and a GitHub card's name are the same card. Tolerant of the
// sites' spelling habits ("Charizard ★" / "Charizard Star", "Nidoran♀" / "Nidoran F", "Bubbly Water
// Energy" / "Bubbly W Energy", "Pikachu" / "Pikachu ex" at the same number), never of a different
// Pokémon (Ivysaur / Pikachu δ, Escavalier / Antique Cover Fossil).
export function namesAgree(tcgName, ghName) {
  const a = nameForms(tcgName)
  const b = nameForms(ghName)
  return a.some((x) => b.some((y) => formsAgree(x, y)))
}

// Which of a card's products is the card itself: the exact name, then the fewest qualifiers
// ("Pikachu" over "Pikachu (Misprint)"; "Gengar (Prerelease)" over "Gengar (Prerelease) [Staff]"),
// then one TCGplayer prices (pickBase falls back to the lowest productId).
// A special copy of a card is never the card itself, however its price looks — Tropical Tidal Wave's
// Participation copy is unpriced while its [Staff] copy is $6,499.
const SPECIAL_COPY = /\b(staff|winner|finalist|semi-?finalist|quarter-?finalist|top \d+|champion|misprint|error|stamped|judge|\d(st|nd|rd|th) place)\b/i
const qualifierCount = (name) => (String(name).match(/[([]/g) ?? []).length
const isPriced = (p) => p.rows.some((r) => (parseFloat(r.marketPrice) || parseFloat(r.midPrice)) > 0)
const baseScore = (p, gh) => (normSetName(p.name) === normSetName(gh.name) ? 100 : 0) + (nameKey(p.name) === nameKey(gh.name) ? 50 : 0)
  - (SPECIAL_COPY.test(p.name) ? 40 : 0) - qualifierCount(p.name) * 10 + (isPriced(p) ? 1 : 0)

/**
 * Builds the English catalog from both sources.
 *
 * @param ghSets        pokemon-tcg-data sets/en.json
 * @param ghCards       catalog cards already built from GitHub (ids `${setId}-${number}`, $0 prices)
 * @param groups        TCGplayer groups (category 3)
 * @param productsByGroup groupId → productsFromRows(that group's CSV)
 * @param previousSets  the set list saved last sync (catalog_meta/pokemon.sets) — which sets are
 *                      claimed, and which GitHub sets collectors already use (every listed one)
 * @param unavailableSetIds GitHub sets whose card file failed to download this run. Their TCGplayer
 *                      products are skipped entirely — built as new cards they'd duplicate the
 *                      real ones (and those real cards just keep their current data this sync).
 * @param failedGroupIds TCGplayer groups whose CSV failed to download. The GitHub sets they price
 *                      are left out of this run (so their cards keep today's prices instead of $0).
 */
export function buildPokemonCatalog({ ghSets, ghCards, groups, productsByGroup, previousSets = [], unavailableSetIds = new Set(), failedGroupIds = new Set() }) {
  const report = {
    linked: 0, variants: [], newSets: [], oddGroups: [], githubOnly: [], editionOnly: [],
    duplicateListings: [], unnumberedInSets: [], shadowedGithubSets: [], differences: [],
    claimedCaughtUp: [], contentMatched: [], skippedGroups: [], linkedElsewhere: [], numberOnlyRejected: [],
  }
  const groupById = new Map(groups.map((g) => [g.groupId, g]))

  // Claimed groups: sets built from TCGplayer on an earlier sync stay TCGplayer's.
  const claimed = new Map(previousSets.filter((s) => s.tcgplayerGroupId != null).map((s) => [Number(s.tcgplayerGroupId), s]))
  const listedBefore = new Set(previousSets.filter((s) => s.tcgplayerGroupId == null).map((s) => s.id))
  const matches = matchGroupsToSets(groups, ghSets)
  matchGroupsByContent(groups, ghCards, productsByGroup, matches, claimed, report)

  // A GitHub set that matches a claimed group is GitHub catching up on a set we built first. Leave
  // it out (its cards would duplicate ours) — unless it was already listed before (collectors may
  // own its cards), which can't happen for a set claimed while GitHub lacked it; never hide those.
  const shadowed = new Set()
  for (const [groupId, m] of [...matches]) {
    if (!claimed.has(groupId)) continue
    const inUse = listedBefore.has(m.setId)
    report.claimedCaughtUp.push({ group: groupById.get(groupId)?.name, githubSet: m.setId, kept: inUse ? 'GitHub (already listed before)' : 'TCGplayer' })
    if (inUse) { claimed.delete(groupId); continue }
    shadowed.add(m.setId)
    matches.delete(groupId)
  }
  // Groups for a GitHub set we couldn't download this run: skip them whole (see unavailableSetIds)
  for (const [groupId, m] of [...matches]) {
    if (unavailableSetIds.has(m.setId)) { matches.delete(groupId); report.skippedGroups.push({ groupId, group: groupById.get(groupId)?.name, reason: `GitHub ${m.setId} unavailable` }) }
  }
  const unavailableGroups = new Set(report.skippedGroups.map((x) => x.groupId))
  const stalePriceSets = new Set([...matches].filter(([groupId]) => failedGroupIds.has(groupId)).map(([, m]) => m.setId))
  const ghSetById = new Map(ghSets.filter((s) => !shadowed.has(s.id)).map((s) => [s.id, s]))
  // set:number → GitHub cards (usually one; Classic Collection sets reuse a number — cel25c #15 is
  // four cards — see resolveIdCollisions)
  const ghByKey = new Map()
  for (const c of ghCards) {
    if (shadowed.has(c.set)) continue
    const k = `${c.set}:${normCardNum(c.number)}`
    if (!ghByKey.has(k)) ghByKey.set(k, [])
    ghByKey.get(k).push(c)
  }

  // ── Pass 1: link GitHub's cards to TCGplayer products. A link is what lets a TCGplayer product
  // NOT become a new card, so it must be the same card — the number alone isn't enough (Nintendo
  // Black Star Promos' "Ivysaur 35/100 (Prerelease)" shares #35 with GitHub's Pikachu δ, and the SV
  // Black Star Promos are numbered differently on the two sites past #100).
  const linkOf = new Map()       // GitHub card id → { product, how }
  const priceEntryById = new Map() // GitHub card id → price entry
  const usedProducts = new Set()
  const link = (gh, product, how, editionOpts) => {
    if (!priceEntryById.has(gh.id)) priceEntryById.set(gh.id, newPriceEntry())
    for (const r of product.rows) addPriceRow(priceEntryById.get(gh.id), r, editionOpts ?? {})
    usedProducts.add(product.productId)
    if (!editionOpts && !linkOf.has(gh.id)) linkOf.set(gh.id, { product, how })
  }
  const pickBase = (gh, list) => list
    .filter((p) => !usedProducts.has(p.productId) && namesAgree(p.name, gh.name))
    .sort((a, b) => baseScore(b, gh) - baseScore(a, gh) || a.productId - b.productId)[0]

  // A) Same set, same number, same name — groups matched to the GitHub set
  const candidates = new Map() // ghKey → [{ product, editionOpts }]
  for (const [groupId, m] of matches) {
    for (const p of productsByGroup.get(groupId) ?? []) {
      if (!p.numKey) continue
      const key = `${m.setId}:${p.numKey}`
      if (!ghByKey.has(key)) continue
      if (!candidates.has(key)) candidates.set(key, [])
      candidates.get(key).push({ product: p, editionOpts: m.editionOpts })
    }
  }
  for (const [key, list] of candidates) for (const gh of ghByKey.get(key)) {
    // Edition groups (Base Set (Shadowless)) only ever price the card — never its identity
    const base = pickBase(gh, list.filter((x) => !x.editionOpts).map((x) => x.product))
    if (!base) {
      report.numberOnlyRejected.push({ card: gh.id, github: gh.name, tcgplayer: list.map((x) => x.product.name) })
      continue
    }
    link(gh, base, 'number')
    const variants = []
    for (const x of list) {
      if (x.product === base || usedProducts.has(x.product.productId) || !namesAgree(x.product.name, gh.name)) continue
      if (x.editionOpts) { link(gh, x.product, 'edition', x.editionOpts); continue }
      // The same card listed twice (no qualifier, same name — e.g. in two groups mapped to one set)
      if (!hasQualifier(x.product.name) && nameKey(x.product.name) === nameKey(gh.name)) {
        link(gh, x.product, 'duplicate')
        report.duplicateListings.push({ card: gh.id, name: gh.name, product: x.product.productId, group: groupById.get(x.product.groupId)?.name })
      } else variants.push(x.product)
    }
    // A finish the card itself isn't sold in at all keeps its variant's price, as before this
    // rewrite: Black Bolt has no plain reverse holo — its Poké Ball / Master Ball patterns are the
    // reverse holos, and collectors who chose "Reverse Holo" on the card have been priced by them.
    // A finish the card IS sold in (even unpriced — Tropical Tidal Wave's Participation copy) never
    // takes a stamped / Staff copy's price. Each variant is also its own card (pass 2).
    const covered = new Set(base.rows.map((r) => { const v = classifySubtype(r.subTypeName); return variantKey(v.edition, v.finish) }))
    // The first variant (lowest product id — TCGplayer's Poké Ball before Master Ball) to price a
    // finish fills it; later ones don't overwrite it.
    for (const v of variants.sort((a, b) => a.productId - b.productId)) {
      const filled = new Set()
      for (const r of v.rows) {
        const c = classifySubtype(r.subTypeName)
        const key = variantKey(c.edition, c.finish)
        if (c.weak || covered.has(key)) continue
        addPriceRow(priceEntryById.get(gh.id), r)
        if (priceEntryById.get(gh.id).market[key] > 0) filled.add(key)
      }
      for (const k of filled) covered.add(k)
    }
  }

  // B) Same set, same name, different number — only where the name is unique on both sides
  // (the Black Star promo numbering drift above)
  const setsOfMatchedGroups = new Map() // setId → groupIds
  for (const [groupId, m] of matches) {
    if (m.editionOpts) continue
    if (!setsOfMatchedGroups.has(m.setId)) setsOfMatchedGroups.set(m.setId, [])
    setsOfMatchedGroups.get(m.setId).push(groupId)
  }
  for (const [setId, groupIds] of setsOfMatchedGroups) {
    const ghLeft = ghCards.filter((c) => c.set === setId && !linkOf.has(c.id))
    if (!ghLeft.length) continue
    const products = groupIds.flatMap((id) => productsByGroup.get(id) ?? []).filter((p) => !usedProducts.has(p.productId) && !hasQualifier(p.name))
    const count = (list, key) => list.reduce((m, x) => m.set(key(x), (m.get(key(x)) ?? 0) + 1), new Map())
    const ghNames = count(ghCards.filter((c) => c.set === setId), (c) => nameKey(c.name))
    const prodNames = count(products, (p) => nameKey(p.name))
    for (const gh of ghLeft) {
      const k = nameKey(gh.name)
      if (ghNames.get(k) !== 1 || prodNames.get(k) !== 1) continue
      const product = products.find((p) => nameKey(p.name) === k)
      if (!usedProducts.has(product.productId)) link(gh, product, 'name')
    }
  }

  // C) Any group, same number and same name — a GitHub card TCGplayer files elsewhere (Best of Game
  // in "Best of Promos", Guardians Rising 19a in "Alternate Art Promos", the EX Trainer Kits, the
  // Futsal Pikachu in "Miscellaneous Cards & Products"). Only when exactly one GitHub card fits.
  const unlinkedByNumName = new Map()
  for (const c of ghCards) {
    if (shadowed.has(c.set) || linkOf.has(c.id)) continue
    const k = `${normCardNum(c.number)}|${nameKey(c.name)}`
    unlinkedByNumName.set(k, unlinkedByNumName.has(k) ? null : c) // null = ambiguous
  }
  const editionGroups = new Set([...matches].filter(([, m]) => m.editionOpts).map(([id]) => id))
  const byGh = new Map()
  for (const g of groups) {
    if (editionGroups.has(g.groupId) || unavailableGroups.has(g.groupId)) continue
    for (const p of productsByGroup.get(g.groupId) ?? []) {
      if (usedProducts.has(p.productId) || !p.numKey) continue
      const gh = unlinkedByNumName.get(`${p.numKey}|${nameKey(p.name)}`)
      if (!gh) continue
      if (!byGh.has(gh.id)) byGh.set(gh.id, { gh, list: [] })
      byGh.get(gh.id).list.push(p)
    }
  }
  for (const { gh, list } of byGh.values()) {
    const base = pickBase(gh, list)
    if (base) { link(gh, base, 'elsewhere'); report.linkedElsewhere.push({ card: gh.id, name: gh.name, group: groupById.get(base.groupId)?.name, product: base.productId }) }
  }
  report.linked = linkOf.size

  // ── Pass 2: every other product becomes its own card.
  const cards = []
  const setList = []
  const placements = [] // products for Needs Review: { product, setId }
  const takenNames = new Set([...ghSetById.values()].map((s) => normSetName(s.name)))
  const placeholders = placeholderDates(groups)

  for (const g of groups) {
    const products = (productsByGroup.get(g.groupId) ?? []).filter((p) => !usedProducts.has(p.productId))
    const m = matches.get(g.groupId)
    if (m) {
      const set = ghSetById.get(m.setId)
      if (m.editionOpts) { // its plain cards priced the base set above; anything else is noted, not added
        for (const p of products) report.editionOnly.push({ group: g.name, product: p.productId, name: p.rawName })
        continue
      }
      for (const p of products) {
        if (!p.numKey) {
          // A card in a GitHub set with no number at all — can't be placed by number, so review it
          placements.push({ product: p, setId: set.id })
          cards.push({ ...tcgCard(p, { id: set.id, name: set.name }), _review: true })
          report.unnumberedInSets.push({ set: set.name, name: p.rawName, product: p.productId })
          continue
        }
        cards.push(tcgCard(p, { id: set.id, name: set.name }))
        report.variants.push({ set: set.name, setId: set.id, number: p.extNumber, name: p.rawName, product: p.productId, github: ghByKey.get(`${m.setId}:${p.numKey}`)?.[0]?.name ?? null })
      }
      continue
    }
    if (!products.length || unavailableGroups.has(g.groupId)) continue

    // Not a GitHub set: a set built from TCGplayer
    const previous = claimed.get(g.groupId)
    const numbered = previous ? previous.kind !== 'special' : isNumberedSet(g, products)
    const date = String(g.publishedOn ?? '').slice(0, 10)
    const releaseDate = previous?.releaseDate || ((numbered || !placeholders.has(date)) && date ? date.replace(/-/g, '/') : '')
    const name = previous?.name ?? tcgSetName(g.name, takenNames)
    takenNames.add(normSetName(name))
    const set = {
      id: `tcg-${g.groupId}`,
      name,
      series: previous?.series ?? tcgSeries(g, numbered, ghSets, releaseDate),
      releaseDate,
      total: products.length,
      images: { symbol: '', logo: '' },
      source: 'tcgplayer',
      tcgplayerGroupId: g.groupId,
      kind: numbered ? 'set' : 'special',
    }
    setList.push(set)
    for (const p of products) {
      const card = tcgCard(p, set)
      if (numbered && p.numKey) cards.push(card)
      else { cards.push({ ...card, _review: true }); placements.push({ product: p, setId: set.id }) }
    }
    if (numbered) report.newSets.push({ id: set.id, name, cards: products.length, releaseDate, series: set.series, claimedBefore: !!previous })
    else report.oddGroups.push({ id: set.id, name, cards: products.length, series: set.series })
  }

  // ── GitHub's cards, priced by their linked products
  const ghOut = []
  for (const c of ghCards) {
    if (shadowed.has(c.set) || stalePriceSets.has(c.set)) continue
    const entry = priceEntryById.get(c.id)
    if (entry) ghOut.push({ ...c, ...legacyFields(entry) })
    else { ghOut.push(c); report.githubOnly.push({ id: c.id, name: c.name, set: c.setName }) }
  }

  // ── Secondary check: where GitHub and TCGplayer disagree about a linked card
  for (const c of ghCards) {
    const l = linkOf.get(c.id)
    if (!l) continue
    const p = l.product
    const diffs = []
    if (l.how !== 'number') diffs.push({ field: 'number', github: c.number, tcgplayer: p.extNumber, group: groupById.get(p.groupId)?.name })
    if (!namesAgree(p.name, c.name)) diffs.push({ field: 'name', github: c.name, tcgplayer: p.name })
    // TCGplayer's rarities are coarser ("Ultra Rare" = GitHub's Rare Holo EX / V / VMAX / GX …), so
    // only a different tier counts as a disagreement
    const t1 = rarityTier(c.rarity), t2 = rarityTier(p.extRarity)
    if (t1 && t2 && t1 !== t2) diffs.push({ field: 'rarity', github: c.rarity, tcgplayer: p.extRarity })
    if (diffs.length) report.differences.push({ id: c.id, product: p.productId, diffs })
  }

  // Sets the app lists: GitHub's (minus any shadowed) + the TCGplayer-built ones
  const ghSetList = ghSets.filter((s) => !shadowed.has(s.id)).map((s) => ({
    id: s.id, name: s.name, series: s.series ?? '', releaseDate: s.releaseDate ?? '', total: s.total ?? 0,
    images: { symbol: s.images?.symbol ?? '', logo: s.images?.logo ?? '' },
  }))
  // A claimed set TCGplayer no longer lists keeps its entry (its cards stay in the catalog)
  for (const prev of claimed.values()) {
    if (!setList.some((s) => s.id === prev.id)) setList.push(prev)
  }
  // Oldest first, like the API's orderBy; undated (promo groups) first, so they read last newest-first
  const allSets = [...ghSetList, ...setList].sort((a, b) => (a.releaseDate || '').localeCompare(b.releaseDate || ''))

  report.shadowedGithubSets = [...shadowed]
  report.stalePriceSets = [...stalePriceSets]
  return { cards: [...ghOut, ...cards], sets: allSets, placements, report }
}
