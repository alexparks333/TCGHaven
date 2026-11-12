import { NextResponse } from 'next/server'
import { CURRENCIES } from '@/lib/currency'

// Today's exchange rates from US dollars, for showing prices in a collector's own currency
// (lib/currency.ts). The European Central Bank's daily reference rates via Frankfurter (free, no
// key). Kept in memory for 6 hours and cached by Vercel's edge for the same, so the whole site asks
// the source a few times a day. GET → { date, rates: { CAD: 1.42, … } }

export const dynamic = 'force-dynamic'

const TTL = 6 * 3600 * 1000
let cached: { at: number; body: { date: string; rates: Record<string, number> } } | null = null

export async function GET() {
  if (!cached || Date.now() - cached.at > TTL) {
    try {
      const symbols = CURRENCIES.map((c) => c.code).filter((c) => c !== 'USD').join(',')
      const r = await fetch(`https://api.frankfurter.dev/v1/latest?base=USD&symbols=${symbols}`, { cache: 'no-store', signal: AbortSignal.timeout(8000) })
      if (!r.ok) throw new Error(`rates source replied ${r.status}`)
      const d = (await r.json()) as { date: string; rates: Record<string, number> }
      cached = { at: Date.now(), body: { date: d.date, rates: d.rates } }
    } catch (e) {
      // Older rates beat none; with none at all the site keeps showing US dollars
      if (!cached) return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 })
    }
  }
  return NextResponse.json(cached.body, { headers: { 'Cache-Control': 'public, s-maxage=21600, stale-while-revalidate=86400' } })
}
