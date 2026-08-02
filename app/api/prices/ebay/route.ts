import { NextRequest, NextResponse } from 'next/server'

const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token'
const INSIGHTS_URL = 'https://api.ebay.com/buy/marketplace_insights/v1_beta/item_sales/search'
const BROWSE_URL = 'https://api.ebay.com/buy/browse/v1/item_summary/search'

// Cache the OAuth token in module scope (valid for ~2 hours)
let _token: { value: string; expiresAt: number } | null = null

async function getToken(): Promise<string> {
  if (_token && Date.now() < _token.expiresAt) return _token.value

  const clientId = process.env.EBAY_CLIENT_ID
  const clientSecret = process.env.EBAY_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('EBAY_CLIENT_ID and EBAY_CLIENT_SECRET are not set in .env.local')
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: [
        'https://api.ebay.com/oauth/api_scope',
        'https://api.ebay.com/oauth/api_scope/buy.marketplace.insights',
      ].join(' '),
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`eBay token request failed: ${res.status} — ${text}`)
  }

  const json = await res.json()
  _token = { value: json.access_token, expiresAt: Date.now() + (json.expires_in - 120) * 1000 }
  return _token.value
}

// Build a TCG-specific search query for eBay
function buildQuery(cardName: string, game: string): string {
  const gameLabel: Record<string, string> = {
    pokemon: 'pokemon tcg',
    lorcana: 'lorcana',
    riftbound: 'riftbound',
  }
  // Strip foil/holo suffix that we add in our catalog
  const name = cardName.replace(/ ✦ (Holo|Foil)$/, '').trim()
  return `${name} ${gameLabel[game] ?? 'tcg'}`
}

interface EbayListing {
  title: string
  price: number
  soldDate?: string
  url?: string
  source: 'sold' | 'active'
}

interface EbayResult {
  avgPrice: number | null
  count: number
  source: 'sold_5_days' | 'active_listings'
  listings: EbayListing[]
}

async function fetchSoldListings(token: string, q: string): Promise<EbayResult | null> {
  const since = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d+Z$/, 'Z')
  const url = new URL(INSIGHTS_URL)
  url.searchParams.set('q', q)
  url.searchParams.set('filter', `lastSoldDate:[${since}]`)
  url.searchParams.set('limit', '50')

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
    },
  })

  if (res.status === 403 || res.status === 401) return null // No access — fall back to Browse
  if (!res.ok) return null

  const data = await res.json()
  const items: Array<{
    title?: string
    lastSoldPrice?: { value?: string }
    lastSoldDate?: string
    itemWebUrl?: string
  }> = data.itemSales ?? []

  const prices = items.map((i) => parseFloat(i.lastSoldPrice?.value ?? '0')).filter((p) => p > 0)
  if (prices.length === 0) return null

  return {
    avgPrice: Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 100) / 100,
    count: prices.length,
    source: 'sold_5_days',
    listings: items.slice(0, 5).map((i) => ({
      title: i.title ?? '',
      price: parseFloat(i.lastSoldPrice?.value ?? '0'),
      soldDate: i.lastSoldDate,
      url: i.itemWebUrl,
      source: 'sold' as const,
    })),
  }
}

async function fetchActiveListings(token: string, q: string): Promise<EbayResult> {
  const url = new URL(BROWSE_URL)
  url.searchParams.set('q', q)
  url.searchParams.set('filter', 'buyingOptions:{FIXED_PRICE},conditionIds:{3000|2500|2000|1500|1000}')
  url.searchParams.set('sort', 'price')
  url.searchParams.set('limit', '20')

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
    },
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`eBay Browse API error: ${res.status} — ${text}`)
  }

  const data = await res.json()
  const items: Array<{
    title?: string
    price?: { value?: string }
    itemWebUrl?: string
  }> = data.itemSummaries ?? []

  const prices = items.map((i) => parseFloat(i.price?.value ?? '0')).filter((p) => p > 0)

  // Drop obvious outliers: remove top/bottom 20% when we have enough data
  let trimmed = prices.sort((a, b) => a - b)
  if (trimmed.length >= 5) {
    const cut = Math.floor(trimmed.length * 0.2)
    trimmed = trimmed.slice(cut, trimmed.length - cut)
  }

  const avgPrice = trimmed.length > 0
    ? Math.round((trimmed.reduce((a, b) => a + b, 0) / trimmed.length) * 100) / 100
    : null

  return {
    avgPrice,
    count: prices.length,
    source: 'active_listings',
    listings: items.slice(0, 5).map((i) => ({
      title: i.title ?? '',
      price: parseFloat(i.price?.value ?? '0'),
      url: i.itemWebUrl,
      source: 'active' as const,
    })),
  }
}

export async function GET(req: NextRequest) {
  const cardName = req.nextUrl.searchParams.get('q') ?? ''
  const game = req.nextUrl.searchParams.get('game') ?? 'pokemon'

  if (!cardName) {
    return NextResponse.json({ error: 'q parameter required' }, { status: 400 })
  }

  const clientId = process.env.EBAY_CLIENT_ID
  const clientSecret = process.env.EBAY_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: 'eBay credentials not configured. Add EBAY_CLIENT_ID and EBAY_CLIENT_SECRET to .env.local' },
      { status: 503 }
    )
  }

  try {
    const token = await getToken()
    const q = buildQuery(cardName, game)

    // Try sold listings first, fall back to active listings
    const sold = await fetchSoldListings(token, q)
    if (sold) return NextResponse.json(sold)

    const active = await fetchActiveListings(token, q)
    return NextResponse.json(active)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
