import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Constructing Intl.NumberFormat is expensive — build it once, reuse everywhere
const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

export function formatCurrency(value: number): string {
  return USD.format(value)
}

export function formatPercent(value: number): string {
  const sign = value >= 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}%`
}

// Returns today (or any Date) as a LOCAL-calendar "YYYY-MM-DD" string. Never use
// `new Date().toISOString().slice(0, 10)` for this — that reads the UTC day, which is a
// different calendar date than "today" for anyone not in UTC once the UTC day has rolled
// over but the local one hasn't (e.g. evenings in US timezones show tomorrow's date).
export function localDateString(date: Date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function formatDate(iso: string): string {
  // Bare "YYYY-MM-DD" strings (what purchaseDate always is) get parsed by `new Date(iso)` as
  // UTC midnight per spec — formatting that back in a local timezone west of UTC then displays
  // the PREVIOUS day. Build the Date from local y/m/d parts instead so the displayed date always
  // matches what was actually picked, regardless of the viewer's timezone.
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Riftbound's catalog `number` field is always the bare digit ("92") — any alt-art letter
// suffix ("092a/166", printed on the physical card) only survives in `publicCode`. Recover it
// so a card is shown/stored as "92a", not a bare "92" indistinguishable from the base card.
// Signature's "*" suffix is intentionally dropped — the "(Signature)" name suffix already
// disambiguates it, and "*" isn't how collectors write the number.
export function riftboundDisplayNumber(number: string, publicCode?: string): string {
  // "SP" subset cards (e.g. Vendetta's foil-only Special printings) have their real collector
  // code only in publicCode too ("VEN-SP6/006") — the bare `number` field is just "6", which
  // collides with an unrelated plain-numbered card sharing that digit. Must be checked before
  // the digit-suffix regex below, since "SP6" doesn't start with a digit and would otherwise
  // silently fall through to the bare, ambiguous number.
  const spMatch = (publicCode ?? '').match(/-(SP\d+)\//i)
  if (spMatch) return spMatch[1].toUpperCase()
  const m = (publicCode ?? '').match(/-(\d+)([a-zA-Z]?)\*?\//)
  if (!m) return number
  return `${parseInt(m[1], 10)}${m[2]}`
}

/**
 * Classifies a Riftbound card's variant type from its catalog `rarity` + `publicCode`.
 * "Showcase" rarity covers two structurally different prints: a genuine same-number alt-art
 * (foil-only) and an "Overnumbered" chase variant (collector number exceeds the set's total
 * card count, e.g. "189/166") — which prints as a regular card, not foil-only. Both get
 * flattened to the same `rarity: 'Showcase'` value on the catalog card, so the two are told
 * apart here by comparing the card's own number against the set-size denominator in
 * publicCode — the same signal the download script uses to assign that rarity in the first
 * place. Shared by lib/api/search.ts (new-card display) and the Settings repair tool
 * (fixing already-owned cards), so both agree on what "correct" looks like.
 */
export function riftboundVariantFlags(rarity: string | undefined, publicCode?: string) {
  const isStar = rarity === 'Star'
  const pubNums = (publicCode ?? '').match(/-(\d+)[a-zA-Z]?\*?\/(\d+)/)
  const isOvernumber = !!pubNums && parseInt(pubNums[1], 10) > parseInt(pubNums[2], 10)
  const isAltArtShowcase = rarity === 'Showcase' && !isOvernumber
  return { isStar, isOvernumber, isAltArtShowcase }
}

/**
 * Whether a Riftbound card variant is inherently foil-only (Star signatures, same-number
 * alt-art Showcase) or inherently NOT foil (Overnumbered — only ever has one, non-foil-labeled
 * price point). Returns null for regular cards, where foil-or-not is a genuine purchasing
 * choice this can't second-guess — callers should leave `isFoil` alone in that case.
 */
export function riftboundInherentFoil(rarity: string | undefined, publicCode?: string): boolean | null {
  const { isStar, isOvernumber, isAltArtShowcase } = riftboundVariantFlags(rarity, publicCode)
  if (isStar || isAltArtShowcase) return true
  if (isOvernumber) return false
  return null
}

// Build an eBay sold-listings search URL for a card.
// Format: "{name} {number} {gradingCompany} {grade}" (graded)
//      or "{name} {number} {setName}"               (raw)
export function openEbaySearch(card: { name: string; number: string; set: string; game: string; gradingCompany?: string; grade?: string; isFoil?: boolean }) {
  const parts: string[] = [card.name]
  if (card.number && card.number !== 'N/A') parts.push(card.number)
  if (card.gradingCompany) {
    parts.push(card.gradingCompany)
    if (card.grade) parts.push(card.grade)
  } else {
    if (card.set && card.set !== 'N/A') parts.push(card.set)
    if (card.isFoil) parts.push('Holo')
  }
  const query = parts.join(' ')
  const url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_Sold=1&LH_Complete=1`
  window.open(url, '_blank', 'noopener,noreferrer')
}
