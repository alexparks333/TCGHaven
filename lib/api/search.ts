import type { Game } from '../types'
import { searchPokemonCards, getPokemonSets, getPokemonCardMarketPrice } from './pokemon'
import { searchLorcanaCards, getLorcanaSets } from './lorcana'
import { searchRiftboundCards, getRiftboundSets } from './riftbound'
import { riftboundDisplayNumber, riftboundVariantFlags } from '../utils'

export interface CardSearchResult {
  id: string
  name: string
  set: string
  setName: string
  number: string
  imageUrl: string
  marketPrice: number
  marketPriceFoil: number
  lowPriceNM?: number
  lowPriceNMFoil?: number
  isFoil: boolean
  game: Game
  rarity?: string
}

export interface SetOption {
  code: string
  name: string
  releaseDate: string
  cardCount?: number
  symbolUrl?: string
  isCustom?: boolean
}

// ── Card Search ─────────────────────────────────────────────────────────────

export async function searchCards(game: Game, query: string): Promise<CardSearchResult[]> {
  if (!query || query.length < 2) return []

  if (game === 'pokemon') {
    const cards = await searchPokemonCards(query)
    const results: CardSearchResult[] = []
    for (const c of cards) {
      const normalPrice = getPokemonCardMarketPrice(c, false)
      const foilPrice = getPokemonCardMarketPrice(c, true)
      const lowNM     = c.tcgplayer?.prices?.normal?.low ?? 0
      const lowNMFoil = c.tcgplayer?.prices?.holofoil?.low ?? 0
      const base = {
        id: c.id,
        name: c.name,
        set: c.set.id,
        setName: c.set.name,
        number: c.number,
        imageUrl: c.images.small,
        game: 'pokemon' as Game,
        lowPriceNM: lowNM,
        lowPriceNMFoil: lowNMFoil,
      }
      results.push({ ...base, marketPrice: normalPrice, marketPriceFoil: foilPrice, isFoil: false })
      if (foilPrice > 0 && foilPrice !== normalPrice) {
        results.push({ ...base, name: `${c.name} ✦ Holo`, marketPrice: foilPrice, marketPriceFoil: foilPrice, lowPriceNM: lowNMFoil, lowPriceNMFoil: lowNMFoil, isFoil: true })
      }
    }
    return results
  }

  if (game === 'lorcana') {
    const cards = await searchLorcanaCards(query)
    // These rarities are always foil-only — no non-foil version exists
    const FOIL_ONLY_RARITIES = new Set(['Epic', 'Enchanted', 'Mythic', 'Special'])
    const results: CardSearchResult[] = []
    for (const c of cards) {
      const name = c.version ? `${c.name} - ${c.version}` : c.name
      const regularPrice = parseFloat(c.prices?.usd as unknown as string) || 0
      const foilPrice = parseFloat(c.prices?.usd_foil as unknown as string) || 0
      const isFoilOnly = FOIL_ONLY_RARITIES.has(c.rarity) || (regularPrice === 0 && foilPrice > 0)
      const base = {
        id: c.id,
        set: c.set?.code ?? '',
        setName: c.set?.name ?? '',
        number: c.collector_number,
        imageUrl: c.image_uris?.digital?.large ?? c.image_uris?.digital?.normal ?? c.image_uris?.digital?.small ?? '',
        game: 'lorcana' as Game,
        rarity: c.rarity || undefined,
      }
      if (isFoilOnly) {
        // Show one foil-only entry with rarity label so it's distinguishable from the regular version
        const rarityLabel = c.rarity ? ` · ${c.rarity}` : ' ✦ Foil'
        results.push({
          ...base,
          name: `${name}${rarityLabel}`,
          marketPrice: foilPrice,
          marketPriceFoil: foilPrice,
          isFoil: true,
        })
      } else {
        results.push({ ...base, name, marketPrice: regularPrice, marketPriceFoil: foilPrice, isFoil: false })
        if (foilPrice > 0 && foilPrice !== regularPrice) {
          results.push({ ...base, name: `${name} ✦ Foil`, marketPrice: foilPrice, marketPriceFoil: foilPrice, isFoil: true })
        }
      }
    }
    return results
  }

  if (game === 'riftbound') {
    const cards = await searchRiftboundCards(query)
    const results: CardSearchResult[] = []
    for (const c of cards) {
      const isLegend = c.cardType === 'Legend'
      const { isStar, isOvernumber, isAltArtShowcase } = riftboundVariantFlags(c.rarity, c.publicCode)
      const isSpecial = isAltArtShowcase || isStar

      // Build the display name suffix
      let suffix = ''
      if (isLegend && isStar) suffix = ' · Legend Overnumbered Signature'
      else if (isLegend && isOvernumber) suffix = ' · Legend Overnumbered'
      else if (isLegend) suffix = ' · Legend'
      else if (isStar) suffix = ' · Star'
      else if (isOvernumber) suffix = ' · Overnumbered'
      else if (isAltArtShowcase) suffix = ' · Showcase'

      const normalPrice = c.marketPrice ?? 0
      const foilPrice = c.marketPriceFoil ?? 0
      const lowNM = c.lowPriceNM ?? 0
      const lowNMFoil = c.lowPriceNMFoil ?? 0
      const base = {
        id: c.id,
        name: `${c.name}${suffix}`,
        set: c.setCode,
        setName: c.setName,
        number: riftboundDisplayNumber(c.number, c.publicCode),
        imageUrl: c.imageUrl ?? '',
        game: 'riftbound' as Game,
        lowPriceNM: lowNM,
        lowPriceNMFoil: lowNMFoil,
        rarity: c.rarity || undefined,
      }

      if (isSpecial) {
        // Alt-art Showcase / Star are foil-only — one entry
        results.push({ ...base, marketPrice: normalPrice, marketPriceFoil: normalPrice, isFoil: true })
      } else {
        // Regular cards (including Overnumbered, which prints like a normal card): show a
        // Normal entry, plus a separate Foil entry if it has a distinct price
        results.push({ ...base, marketPrice: normalPrice, marketPriceFoil: foilPrice, isFoil: false })
        if (foilPrice > 0 && foilPrice !== normalPrice) {
          results.push({
            ...base,
            name: `${c.name}${suffix} ✦ Foil`,
            marketPrice: foilPrice, marketPriceFoil: foilPrice,
            lowPriceNM: lowNMFoil, lowPriceNMFoil: lowNMFoil,
            isFoil: true,
          })
        }
      }
    }
    return results
  }

  return []
}

// ── Sets ────────────────────────────────────────────────────────────────────

const setsCache: Partial<Record<Game, SetOption[]>> = {}

export async function getSetsForGame(game: Game): Promise<SetOption[]> {
  if (setsCache[game]) return setsCache[game]!

  let sets: SetOption[] = []

  if (game === 'pokemon') {
    const raw = await getPokemonSets()
    sets = raw
      .map((s) => ({
        code: s.id,
        name: s.name,
        releaseDate: s.releaseDate,
        cardCount: s.total,
        symbolUrl: s.images?.symbol,
        isCustom: s.source === 'manual',
      }))
      .reverse() // newest first
  }

  if (game === 'lorcana') {
    const raw = await getLorcanaSets()
    sets = raw
      .map((s) => ({
        code: s.code,
        name: s.name,
        releaseDate: s.released_at ?? '',
        cardCount: s.card_count,
        isCustom: s.source === 'manual',
      }))
      .reverse()
  }

  if (game === 'riftbound') {
    sets = (await getRiftboundSets()).map((s) => ({
      code: s.code,
      name: s.name,
      releaseDate: s.releaseDate,
      cardCount: s.cardCount,
      isCustom: s.source === 'manual',
    })).reverse()
  }

  // Only cache non-empty results so a transient API failure doesn't stick
  if (sets.length > 0) setsCache[game] = sets
  return sets
}

/** Drops the cached set list for a game (or all games) — called after registering a new set
 * in the registry so it shows up without waiting for server restart. */
export function invalidateSetsCache(game?: Game) {
  if (game) delete setsCache[game]
  else for (const g of Object.keys(setsCache) as Game[]) delete setsCache[g]
}
