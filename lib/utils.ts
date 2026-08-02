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

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Riftbound's catalog `number` field is always the bare digit ("92") — any alt-art letter
// suffix ("092a/166", printed on the physical card) only survives in `publicCode`. Recover it
// so a card is shown/stored as "92a", not a bare "92" indistinguishable from the base card.
// Signature's "*" suffix is intentionally dropped — the "(Signature)" name suffix already
// disambiguates it, and "*" isn't how collectors write the number.
export function riftboundDisplayNumber(number: string, publicCode?: string): string {
  const m = (publicCode ?? '').match(/-(\d+)([a-zA-Z]?)\*?\//)
  if (!m) return number
  return `${parseInt(m[1], 10)}${m[2]}`
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
