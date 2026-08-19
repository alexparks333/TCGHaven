import { NextResponse } from 'next/server'
import { loadCatalog } from '@/lib/api/catalog'
import { getRiftboundRegistrySets } from '@/lib/api/registry'

export const dynamic = 'force-dynamic'

// Diagnostic tool for "is this card actually upstream and we're just skipping it?" — reads
// the two raw Riftbound sources (the official playriftbound.com gallery scrape, and the TCGCSV
// price feed) directly, bypassing every bit of matching/normalization logic
// download-card-catalog.mjs applies, then diffs each against what's actually in the local
// catalog for the set. This is deliberately independent of that matching logic — if a bug in
// tcgKey()/catalogKey() is silently dropping a card, this tool would still show it as present
// upstream even though the normal sync missed it.

interface RiftboundCatalogCard {
  id: string
  number: string
  publicCode?: string
  setName: string
  setCode?: string
}

const GALLERY_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
}
const TCGCSV_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer': 'https://tcgcsv.com/',
  'Accept': 'text/csv,*/*',
}

// Duplicated from download-card-catalog.mjs (same reasoning as lookup/route.ts: that script
// isn't safe to import from a route) — walks __NEXT_DATA__ to find the card array.
function findCardsInNextData(obj: unknown, depth = 0): Array<Record<string, unknown>> | null {
  if (depth > 10) return null
  if (Array.isArray(obj)) {
    if (obj.length > 5 && (obj[0] as Record<string, unknown>)?.cardImage) return obj as Array<Record<string, unknown>>
    for (const item of obj.slice(0, 10)) {
      const found = findCardsInNextData(item, depth + 1)
      if (found) return found
    }
  } else if (obj && typeof obj === 'object') {
    for (const val of Object.values(obj)) {
      const found = findCardsInNextData(val, depth + 1)
      if (found) return found
    }
  }
  return null
}

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

function normalizeNumber(raw: string): string | null {
  // Strip a leading "SETCODE-" (publicCode format, e.g. "OGN-007a") down to the same shape as
  // a bare TCGCSV extNumber ("007a/298") before parsing — both end up "007a" here.
  const withoutSetPrefix = raw.replace(/^[A-Z0-9]+-/, '')
  const base = withoutSetPrefix.split('/')[0].trim()
  const m = base.match(/^(\d+)([a-zA-Z*]?)$/)
  if (!m) return null
  return `${parseInt(m[1], 10)}${m[2].toLowerCase()}`
}

// Showcase/Overnumber/Signature variants share their base card's bare `number` field (the "a"/
// "*" suffix only ever shows up in publicCode — see the Riftbound Variants section in
// CLAUDE.md), but TCGCSV's extNumber always carries that suffix. So each local card can
// legitimately match TWO different normalized numbers: its own number, and whatever variant
// suffix its publicCode encodes.
function localMatchKeys(card: RiftboundCatalogCard): string[] {
  const keys = new Set<string>()
  const plain = normalizeNumber(card.number)
  if (plain) keys.add(plain)
  if (card.publicCode) {
    const fromPublicCode = normalizeNumber(card.publicCode)
    if (fromPublicCode) keys.add(fromPublicCode)
  }
  return Array.from(keys)
}

const MAX_ROWS = 200

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const game = searchParams.get('game')
  const setCode = searchParams.get('setCode')

  if (game !== 'riftbound') {
    return NextResponse.json({ error: 'Raw source diffing currently only supports game=riftbound' }, { status: 400 })
  }
  if (!setCode) {
    return NextResponse.json({ error: 'setCode is required' }, { status: 400 })
  }

  const registrySet = (await getRiftboundRegistrySets()).find((s) => s.setCode === setCode)
  if (!registrySet) {
    return NextResponse.json({ error: `No registered Riftbound set with code "${setCode}"` }, { status: 404 })
  }

  const [localCards, galleryResult, tcgcsvResult] = await Promise.all([
    loadCatalog<RiftboundCatalogCard>('riftbound').then((all) => all.filter((c) => c.setName === registrySet.setName)),
    fetchGallery(setCode),
    registrySet.tcgcsvGroupId != null ? fetchTcgcsv(registrySet.tcgcsvGroupId) : Promise.resolve({ rows: [] as Array<{ name: string; number: string }>, error: null }),
  ])

  const localIds = new Set(localCards.map((c) => c.id))
  const localNumbers = new Set(localCards.flatMap((c) => localMatchKeys(c)))

  const missingFromCatalog = galleryResult.cards
    .filter((c) => !localIds.has(c.id as string))
    .slice(0, MAX_ROWS)
    .map((c) => ({
      id: c.id, name: c.name, number: c.number, publicCode: c.publicCode, rarity: c.rarity, imageUrl: c.imageUrl,
    }))

  const seenTcgcsvNumbers = new Set<string>()
  const unmatchedTcgcsvRows: Array<{ name: string; number: string }> = []
  for (const row of tcgcsvResult.rows) {
    const norm = normalizeNumber(row.number)
    if (!norm || seenTcgcsvNumbers.has(norm)) continue
    seenTcgcsvNumbers.add(norm)
    if (!localNumbers.has(norm)) unmatchedTcgcsvRows.push(row)
    if (unmatchedTcgcsvRows.length >= MAX_ROWS) break
  }

  return NextResponse.json({
    setName: registrySet.setName,
    localCardCount: localCards.length,
    gallery: {
      totalFound: galleryResult.cards.length,
      missingFromCatalog,
      truncated: galleryResult.cards.filter((c) => !localIds.has(c.id as string)).length > MAX_ROWS,
      error: galleryResult.error,
    },
    tcgcsv: {
      groupId: registrySet.tcgcsvGroupId,
      unmatchedRows: unmatchedTcgcsvRows,
      truncated: unmatchedTcgcsvRows.length >= MAX_ROWS,
      error: tcgcsvResult.error,
    },
  })
}

async function fetchGallery(setCode: string): Promise<{ cards: Array<Record<string, unknown>>; error: string | null }> {
  try {
    // no-store: this is a live diagnostic tool (we always want the current upstream state, never
    // a cached snapshot), and it also silences a harmless "item too big to cache" log line —
    // Next.js's fetch data cache tries to cache this ~4.4MB HTML page and gives up over its 2MB cap.
    const res = await fetch('https://playriftbound.com/en-us/card-gallery/', { headers: GALLERY_HEADERS, cache: 'no-store' })
    if (!res.ok) return { cards: [], error: `Gallery fetch failed: ${res.status}` }
    const html = await res.text()
    const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
    if (!match) return { cards: [], error: '__NEXT_DATA__ not found in gallery page' }
    const nextData = JSON.parse(match[1])
    const items = findCardsInNextData(nextData)
    if (!items) return { cards: [], error: 'Card array not found in __NEXT_DATA__' }

    const cards = items
      .filter((c) => c?.name && (c.cardImage as Record<string, unknown>)?.url)
      .filter((c) => (c.set as Record<string, unknown>)?.value && ((c.set as Record<string, { id?: string }>).value as { id?: string })?.id === setCode)
      .map((c) => {
        const set = c.set as { value?: { id?: string; label?: string } }
        const cardImage = c.cardImage as { url?: string }
        const rarity = c.rarity as { value?: { label?: string } } | undefined
        return {
          id: c.id,
          name: c.name,
          number: String(c.collectorNumber ?? ''),
          publicCode: c.publicCode ?? '',
          rarity: rarity?.value?.label ?? '',
          imageUrl: cardImage?.url ?? '',
          setCode: set.value?.id ?? '',
        }
      })
    return { cards, error: null }
  } catch (err) {
    return { cards: [], error: (err as Error).message }
  }
}

async function fetchTcgcsv(groupId: number): Promise<{ rows: Array<{ name: string; number: string }>; error: string | null }> {
  try {
    const res = await fetch(`https://tcgcsv.com/tcgplayer/89/${groupId}/ProductsAndPrices.csv`, { headers: TCGCSV_HEADERS, cache: 'no-store' })
    if (!res.ok) return { rows: [], error: `tcgcsv request failed: ${res.status}` }
    const lines = (await res.text()).split('\n')
    const rows: Array<{ name: string; number: string }> = []
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue
      const f = parseCSVLine(line)
      const name = f[1] ?? ''
      const extNumber = f[16] ?? ''
      if (!extNumber || !name) continue
      // Runes (R01-R06[a|b]) aren't collector numbers this tool diffs against — the local
      // catalog stores them under a synthetic id, not a plain number, so skip them here.
      if (/^R\d/.test(extNumber)) continue
      rows.push({ name, number: extNumber })
    }
    return { rows, error: null }
  } catch (err) {
    return { rows: [], error: (err as Error).message }
  }
}
