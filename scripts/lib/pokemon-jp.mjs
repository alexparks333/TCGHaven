// Japanese Pokémon catalog, built straight from TCGplayer's Japanese category (tcgcsv category 85
// — "Pokemon Japan", ~460 sets, ~28k singles). Unlike English (card data from pokemon-tcg-data,
// prices from TCGplayer), TCGplayer is the only source here, the same way Riftbound's
// TCGplayer-only sets are built: one catalog card per TCGplayer product.
//
// Pure functions only — catalog-sync.mjs's downloadPokemonJapanese() does the fetching/writing.

import { newPriceEntry, addPriceRow, legacyFields } from './pokemon-variants.mjs'

export const JP_CATEGORY = 85
export const JP_CATALOG = 'pokemon-jp'

// Sealed product / accessories. Only consulted for rows with neither a collector number nor a
// rarity: Japanese WotC-era singles (Expansion Pack, Jungle, Fossil, Neo, …) have no printed
// number at all, so "no number" alone can't mean "not a card".
const SEALED = /booster|\bbox\b|deck|\bpacks?\b|bundle|\btin\b|binder|sleeve|\bcase\b|\bkit\b|\bset\b|starter|premium|gift|display|playmat|\bcoin\b|marker|code card|\blot\b|card file|academy|card game classic|\bfile\b/i

export function isSingleRow(row) {
  if ((row.extNumber ?? '').trim()) return true
  if ((row.extRarity ?? '').trim()) return true
  return !SEALED.test(row.name ?? '')
}

// "Paras - 001/172" → "Paras"; "Electivire - 035/172 (Mirror Holofoil)" → "Electivire (Mirror
// Holofoil)". TCGplayer appends the collector number to some names to tell same-named cards
// apart; the catalog has its own number field.
export function cleanJpName(name) {
  return String(name ?? '')
    .replace(/\s+-\s+[^\s()]*\d[^\s()]*\/[^\s()]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// "001/172" → "001" (kept as printed, like the English catalog's numbers); promos like
// "SV-P 123" or "001/SV-P" keep their own form; no number → ''.
export function jpNumber(extNumber) {
  const raw = String(extNumber ?? '').trim()
  if (!raw) return ''
  const slash = raw.indexOf('/')
  return (slash > 0 ? raw.slice(0, slash) : raw).trim()
}

export function jpImageUrl(row) {
  if (String(row.imageCount ?? '').trim() === '0') return ''
  const url = String(row.imageUrl ?? '')
  return url ? url.replace(/_200w\.jpg$/, '_in_1000x1000.jpg') : ''
}

/** One catalog card from all of a product's rows (one row per printing TCGplayer prices). */
export function jpCard(group, rows) {
  const first = rows[0]
  const entry = newPriceEntry()
  for (const r of rows) addPriceRow(entry, r)
  const rarity = (first.extRarity ?? '').trim()
  return {
    id: `jp-${first.productId}`,
    name: cleanJpName(first.name),
    set: `jp-${group.groupId}`,
    setName: group.name,
    number: jpNumber(first.extNumber),
    rarity: rarity === 'None' ? '' : rarity,
    imageUrl: jpImageUrl(first),
    ...legacyFields(entry),
  }
}

// ── Sets: release date and era (the Japanese Cardex's groups) ──────────────

// Newest first. Japanese eras by release date — the same eras as the English Cardex's series.
const ERAS = [
  ['2025-08-01', 'Mega Evolution'],
  ['2022-12-01', 'Scarlet & Violet'],
  ['2019-11-29', 'Sword & Shield'],
  ['2016-12-01', 'Sun & Moon'],
  ['2013-12-01', 'XY'],
  ['2010-12-01', 'Black & White'],
  ['2009-07-01', 'LEGEND'],
  ['2006-09-01', 'Diamond & Pearl'],
  ['2003-01-01', 'ADV / PCG'],
  ['2001-12-01', 'e-Card'],
  ['1999-12-01', 'Neo'],
  ['0000-00-00', 'Original Era'],
]
export const JP_PROMO_ERA = 'Promos & Special'
const PROMO = /promo|promotional|unnumbered|vending|contest|fan club|hobby fair|corocoro|battle road|champion road|competition|world championships|how i became|information/i

/**
 * Release dates that TCGplayer uses as a placeholder: a date shared by many sets at once (it
 * stamps a batch of back-catalog promo groups with the day it added them). Those sets get no
 * release date and land in the promo group.
 */
export function placeholderDates(groups, minShared = 10) {
  const count = new Map()
  for (const g of groups) {
    const d = String(g.publishedOn ?? '').slice(0, 10)
    if (d) count.set(d, (count.get(d) ?? 0) + 1)
  }
  return new Set([...count].filter(([, n]) => n >= minShared).map(([d]) => d))
}

export function jpSetMeta(group, cardCount, placeholders) {
  const date = String(group.publishedOn ?? '').slice(0, 10)
  const known = date && !placeholders.has(date)
  const series = !known || PROMO.test(group.name) ? JP_PROMO_ERA : ERAS.find(([from]) => date >= from)[1]
  return {
    code: `jp-${group.groupId}`,
    name: group.name,
    releaseDate: known ? date : '',
    cardCount,
    series,
  }
}
