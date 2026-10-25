// Last-resort matching of a TCGplayer (tcgcsv) Pokémon group to a pokemon-tcg-data set id, for
// groups downloadPokemon()'s exact-name and abbreviation strategies miss. TCGplayer names older
// sets differently ("XY - Flashfire", "EX Emerald", "SV01: Scarlet & Violet Base Set"), and
// before this ~60 whole sets — XY, HGSS, EX era, Scarlet & Violet base, 151, every Black Star
// promo set — never got a TCGplayer price at all. Only ever consulted for groups that matched
// nothing else, so it can't change an existing match.

import { normSetName } from './text-norm.mjs'

// Normalized TCGplayer group name → set id, for names no rule below can bridge.
const ALIASES = {
  'base set': 'base1',
  'wotc promo': 'basep',
  'expedition': 'ecard1',
  'nintendo promos': 'np',
  'diamond and pearl promos': 'dpp',
  'hgss promos': 'hsp',
  'heartgold soulsilver': 'hgss1',
  'unleashed': 'hgss2',
  'undaunted': 'hgss3',
  'triumphant': 'hgss4',
  'rumble': 'ru1',
  'black and white promos': 'bwp',
  'xy promos': 'xyp',
  'generations radiant collection': 'g1',
  'swsh sword and shield promo cards': 'swshp',
  'sword and shield promo cards': 'swshp',
  'sv scarlet and violet 151': 'sv3pt5',
  'scarlet and violet 151': 'sv3pt5',
  'mcdonald s 25th anniversary promos': 'mcd21',
}

export function fallbackPokemonSetId(groupName, nameToSetId, setIds) {
  const name = String(groupName ?? '')
  const alias = ALIASES[normSetName(name)]
  if (alias && setIds.has(alias)) return alias

  // "McDonald's Promos 2014" → mcd14
  const mcd = name.match(/^McDonald's Promos (\d{4})$/i)
  if (mcd) {
    const id = `mcd${mcd[1].slice(2)}`
    return setIds.has(id) ? id : null
  }

  const candidates = [
    name.replace(/^(XY|SM|SWSH|SV|BW|DP|HGSS)\s*-\s*/i, ''), // "XY - Flashfire", "SM - Celestial Storm"
    name.replace(/^EX\s+/i, ''),                             // "EX Emerald"
    name.replace(/^[A-Z0-9]+:\s*/i, '').replace(/\s+Base Set$/i, ''), // "SV01: Scarlet & Violet Base Set", "XY Base Set"
  ]
  for (const c of candidates) {
    if (c === name || !c.trim()) continue
    const id = nameToSetId.get(normSetName(c))
    if (id) return id
  }
  return null
}
