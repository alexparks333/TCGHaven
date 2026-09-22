import { NextResponse } from 'next/server'
import { getRiftboundRegistrySets } from '@/lib/api/registry'
import { verifyAdminRequest } from '@/lib/firebase/verifyAdminRequest'

export const dynamic = 'force-dynamic'

// Best-effort external lookup for a card the catalog is missing, using the same sources
// download-card-catalog.mjs already relies on. Always returns candidates for the admin to
// review and edit before saving — this route never writes anything.

const TCGCSV_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer': 'https://tcgcsv.com/',
  'Accept': 'text/csv,*/*',
}

interface LookupCandidate {
  name?: string
  imageUrl?: string
  marketPrice?: number
  marketPriceFoil?: number
  rarity?: string
  source: string
  note?: string
}

// Minimal CSV line parser — duplicated from download-card-catalog.mjs rather than imported,
// since that script runs mkdirSync at import time and isn't safe to import from a route.
function parseCSVLine(line: string): string[] {
  const fields: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++ }
      else inQ = !inQ
    } else if (ch === ',' && !inQ) {
      fields.push(cur); cur = ''
    } else {
      cur += ch
    }
  }
  fields.push(cur)
  return fields
}

// "21b/166" or "21b" or "21" -> { num: 21, suffix: 'b' } — mirrors tcgKey()'s number handling
// in download-card-catalog.mjs so admin-typed numbers match tcgcsv rows the same way.
function normalizeRiftboundNumber(raw: string): { num: number; suffix: string } | null {
  const base = raw.split('/')[0].trim()
  const m = base.match(/^(\d+)([a-zA-Z*]?)$/)
  if (!m) return null
  return { num: parseInt(m[1], 10), suffix: m[2].toLowerCase() }
}

async function lookupRiftbound(setCode: string, number: string): Promise<LookupCandidate[]> {
  const set = (await getRiftboundRegistrySets()).find((s) => s.setCode === setCode)
  if (!set) return [{ source: 'tcgcsv', note: `No registered Riftbound set with code "${setCode}" — check the registry (Admin Catalog "New Set")` }]
  if (typeof set.tcgcsvGroupId !== 'number') {
    return [{ source: 'tcgcsv', note: `"${set.setName}" has no known TCGPlayer group id yet — run a sync first, or set one manually in Settings.` }]
  }
  const normalized = normalizeRiftboundNumber(number)
  if (!normalized) return [{ source: 'tcgcsv', note: `Couldn't parse "${number}" as a card number` }]

  try {
    const res = await fetch(`https://tcgcsv.com/tcgplayer/89/${set.tcgcsvGroupId}/ProductsAndPrices.csv`, { headers: TCGCSV_HEADERS })
    if (!res.ok) return [{ source: 'tcgcsv', note: `tcgcsv request failed: ${res.status}` }]
    const lines = (await res.text()).split('\n')
    const candidates: LookupCandidate[] = []
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue
      const f = parseCSVLine(line)
      const name = f[1] ?? ''
      const imageUrl = f[3] ?? ''
      const marketPrice = parseFloat(f[12]) || 0
      const subType = f[14] ?? '' // 'Normal' or 'Foil'
      const extNumber = f[16] ?? ''
      if (!extNumber) continue
      // extNumber is formatted like "021/166" (zero-padded, slash-suffixed with set size) —
      // strip the "/166" the same way normalizeRiftboundNumber() does for the admin's input.
      const rowMatch = extNumber.split('/')[0].trim().match(/^(\d+)([a-zA-Z*]?)$/)
      if (!rowMatch) continue
      const rowNum = parseInt(rowMatch[1], 10)
      const rowSuffix = rowMatch[2].toLowerCase()
      if (rowNum !== normalized.num || rowSuffix !== normalized.suffix) continue
      candidates.push({
        name,
        imageUrl,
        marketPrice: subType !== 'Foil' ? marketPrice : undefined,
        marketPriceFoil: subType === 'Foil' ? marketPrice : undefined,
        source: 'tcgcsv',
      })
    }
    if (candidates.length === 0) {
      return [{ source: 'tcgcsv', note: `No TCGPlayer row found for ${setCode} #${number} in group ${set.tcgcsvGroupId}` }]
    }
    return candidates
  } catch (err) {
    return [{ source: 'tcgcsv', note: `Lookup failed: ${(err as Error).message}` }]
  }
}

async function lookupLorcana(setCode: string, number: string, name?: string): Promise<LookupCandidate[]> {
  if (!name) return [{ source: 'lorcast', note: 'Provide a card name to search lorcast by — no verified set+number-only query exists.' }]
  try {
    const res = await fetch(`https://api.lorcast.com/v0/cards/search?q=${encodeURIComponent(name)}&page_size=50`)
    if (!res.ok) return [{ source: 'lorcast', note: `lorcast request failed: ${res.status}` }]
    const data = await res.json()
    const results = data.results ?? data ?? []
    const matches = results.filter((c: Record<string, unknown>) => {
      const set = c.set as { code?: string } | undefined
      return String(c.collector_number) === number && (!setCode || set?.code === setCode)
    })
    if (matches.length === 0) return [{ source: 'lorcast', note: `No lorcast match for "${name}" #${number} in set ${setCode || '(any)'}` }]
    return matches.map((c: Record<string, unknown>) => {
      const prices = c.prices as { usd?: number; usd_foil?: number } | undefined
      const images = c.image_uris as { digital?: { small?: string; normal?: string; large?: string } } | undefined
      return {
        name: c.version ? `${c.name} - ${c.version}` : (c.name as string),
        imageUrl: images?.digital?.large ?? images?.digital?.normal ?? images?.digital?.small,
        marketPrice: prices?.usd,
        marketPriceFoil: prices?.usd_foil,
        rarity: c.rarity as string | undefined,
        source: 'lorcast',
      }
    })
  } catch (err) {
    return [{ source: 'lorcast', note: `Lookup failed: ${(err as Error).message}` }]
  }
}

async function lookupPokemon(apiId?: string): Promise<LookupCandidate[]> {
  if (!apiId) {
    return [{ source: 'pokemontcg', note: 'Pokemon lookup needs the official card id (e.g. "sv7-1") — the GitHub dataset is essentially complete, so a missing card usually means you already know its real id.' }]
  }
  try {
    const headers: Record<string, string> = process.env.POKEMON_TCG_API_KEY ? { 'X-Api-Key': process.env.POKEMON_TCG_API_KEY } : {}
    const res = await fetch(`https://api.pokemontcg.io/v2/cards/${apiId}`, { headers, signal: AbortSignal.timeout(8000) })
    if (!res.ok) return [{ source: 'pokemontcg', note: `No card found for id "${apiId}" (${res.status})` }]
    const data = await res.json()
    const card = data.data
    if (!card) return [{ source: 'pokemontcg', note: `No card found for id "${apiId}"` }]
    const prices = card.tcgplayer?.prices
    return [{
      name: card.name,
      imageUrl: card.images?.large ?? card.images?.small,
      marketPrice: prices?.normal?.market ?? prices?.holofoil?.market,
      marketPriceFoil: prices?.holofoil?.market ?? prices?.reverseHolofoil?.market,
      source: 'pokemontcg',
    }]
  } catch (err) {
    return [{ source: 'pokemontcg', note: `Lookup failed: ${(err as Error).message}` }]
  }
}

// One Piece needs no registered tcgcsvGroupId the way Riftbound does — tcgcsv's `abbreviation`
// field on each group already matches a set code directly (e.g. "OP01", "ST-31" for group name
// "Starter Deck 31: RED Monkey.D.Luffy"), so this just finds the group live each call rather
// than reading anything from the registry. See catalog-sync.mjs's downloadOnePiece() header
// comment for why One Piece's price-matching needs no per-set bootstrap at all.
async function lookupOnePiece(setCode: string, number: string): Promise<LookupCandidate[]> {
  if (!setCode) return [{ source: 'tcgcsv', note: 'One Piece lookup needs a set code (e.g. "OP01") to find the right TCGPlayer group.' }]
  const targetNum = parseInt(number, 10)
  if (isNaN(targetNum)) return [{ source: 'tcgcsv', note: `Couldn't parse "${number}" as a card number` }]

  try {
    const groupsRes = await fetch('https://tcgcsv.com/tcgplayer/68/groups', { headers: TCGCSV_HEADERS })
    if (!groupsRes.ok) return [{ source: 'tcgcsv', note: `tcgcsv groups request failed: ${groupsRes.status}` }]
    const groupsData = await groupsRes.json()
    const groups = (groupsData.results ?? []) as Array<{ groupId: number; abbreviation?: string }>
    const normTarget = setCode.replace(/[\s-]/g, '').toUpperCase()
    const group = groups.find((g) => (g.abbreviation ?? '').replace(/[\s-]/g, '').toUpperCase() === normTarget)
    if (!group) return [{ source: 'tcgcsv', note: `No TCGPlayer group found for set code "${setCode}"` }]

    const res = await fetch(`https://tcgcsv.com/tcgplayer/68/${group.groupId}/ProductsAndPrices.csv`, { headers: TCGCSV_HEADERS })
    if (!res.ok) return [{ source: 'tcgcsv', note: `tcgcsv request failed: ${res.status}` }]
    const lines = (await res.text()).split('\n')
    const candidates: LookupCandidate[] = []
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue
      const f = parseCSVLine(line)
      const name = f[1] ?? ''
      const imageUrl = f[3] ?? ''
      const marketPrice = parseFloat(f[12]) || 0
      const rarity = f[15] ?? ''
      const extNumber = f[16] ?? ''
      if (!extNumber) continue
      // extNumber is the full card code (e.g. "OP01-024") — pull just the numeric suffix so an
      // admin-typed "24" matches the zero-padded "024" the same way normNum() does elsewhere.
      const numMatch = extNumber.match(/-(\d+)$/)
      if (!numMatch || parseInt(numMatch[1], 10) !== targetNum) continue
      candidates.push({ name, imageUrl, marketPrice: marketPrice || undefined, rarity: rarity || undefined, source: 'tcgcsv' })
    }
    if (candidates.length === 0) {
      return [{ source: 'tcgcsv', note: `No TCGPlayer row found for ${setCode} #${number} in group ${group.groupId}` }]
    }
    return candidates
  } catch (err) {
    return [{ source: 'tcgcsv', note: `Lookup failed: ${(err as Error).message}` }]
  }
}

// Scryfall's own exact set+collector-number endpoint does exactly what this route needs in one
// call — no group-ID bootstrap, no fuzzy set matching, no CSV parsing at all (unlike every other
// game's lookup here). Collector numbers can carry letter suffixes (e.g. "150a") which Scryfall's
// endpoint accepts verbatim, so no normalization is needed the way Riftbound/One Piece need.
async function lookupMtg(setCode: string, number: string): Promise<LookupCandidate[]> {
  if (!setCode) return [{ source: 'scryfall', note: 'MTG lookup needs a Scryfall set code (e.g. "khm").' }]
  try {
    // Scryfall rejects any request missing BOTH a User-Agent and an Accept header with a plain 400.
    const res = await fetch(`https://api.scryfall.com/cards/${encodeURIComponent(setCode.toLowerCase())}/${encodeURIComponent(number)}`, {
      headers: { 'User-Agent': 'TCGHaven/1.0', Accept: 'application/json' },
    })
    if (res.status === 404) return [{ source: 'scryfall', note: `No Scryfall card found for ${setCode} #${number}` }]
    if (!res.ok) return [{ source: 'scryfall', note: `Scryfall request failed: ${res.status}` }]
    const c = await res.json()
    const imageUrl = c.image_uris?.normal ?? c.image_uris?.large ?? c.card_faces?.[0]?.image_uris?.normal ?? c.card_faces?.[0]?.image_uris?.large
    return [{
      name: c.name,
      imageUrl,
      marketPrice: parseFloat(c.prices?.usd) || undefined,
      marketPriceFoil: parseFloat(c.prices?.usd_foil) || parseFloat(c.prices?.usd_etched) || undefined,
      rarity: c.rarity,
      source: 'scryfall',
    }]
  } catch (err) {
    return [{ source: 'scryfall', note: `Lookup failed: ${(err as Error).message}` }]
  }
}

export async function POST(request: Request) {
  const unauthorized = await verifyAdminRequest(request)
  if (unauthorized) return unauthorized

  const body = await request.json().catch(() => null)
  const game = body?.game as 'pokemon' | 'lorcana' | 'riftbound' | 'onepiece' | 'mtg' | undefined
  const setCode = (body?.setCode ?? '') as string
  const number = (body?.number ?? '') as string
  const name = body?.name as string | undefined
  const apiId = body?.apiId as string | undefined

  if (!game || !number) {
    return NextResponse.json({ error: 'Expected { game, setCode, number, name?, apiId? }' }, { status: 400 })
  }

  const candidates =
    game === 'riftbound' ? await lookupRiftbound(setCode, number) :
    game === 'lorcana' ? await lookupLorcana(setCode, number, name) :
    game === 'onepiece' ? await lookupOnePiece(setCode, number) :
    game === 'mtg' ? await lookupMtg(setCode, number) :
    await lookupPokemon(apiId)

  return NextResponse.json({ candidates })
}
