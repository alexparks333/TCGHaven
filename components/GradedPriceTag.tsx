'use client'

import { ExternalLink } from 'lucide-react'
import { useStore } from '@/lib/store'
import { GRADED_LABELS } from '@/scripts/lib/pricecharting.mjs'
import type { Card } from '@/lib/types'

// Where a slab's value comes from, beside its price (docs/PriceCharting.md):
//  - priced from PriceCharting → "PSA 10 · PriceCharting ↗", linking to the card's page there.
//    That link is the citation PriceCharting's licence requires beside every graded price — never
//    show a graded price without this tag.
//  - graded but no sales for its grade → "Raw est.": valued at TCGplayer's ungraded price.
// Shows nothing for ungraded cards, cards with no catalog match, or while graded pricing is off.

type SlabCard = Pick<Card, 'id' | 'apiId' | 'gradingCompany' | 'grade' | 'gradeTier'>

export const slabName = (c: SlabCard) =>
  `${c.gradingCompany}${c.gradeTier === 'black' ? ' Black Label' : c.gradeTier === 'pristine' && c.gradingCompany?.toUpperCase() !== 'BGS' ? ' Pristine' : ''}${c.grade ? ` ${c.grade}` : ''}`

/** A graded card's price source, or null when there's nothing to say */
export function useGradedSource(card: SlabCard) {
  const source = useStore((s) => s.gradedSources[card.id])
  const on = useStore((s) => s.gradedOn)
  if (!on || !card.gradingCompany || !card.apiId) return null
  if (!source) return { kind: 'raw' as const, slab: slabName(card) }
  const label = (GRADED_LABELS as Record<string, string>)[source.key] ?? 'Graded'
  return { kind: 'graded' as const, slab: slabName(card), label, url: source.url }
}

const stop = (e: React.MouseEvent) => e.stopPropagation() // rows open the card / eBay on click

/** Compact chip for list rows (Inventory, Portfolio) */
export function GradedPriceTag({ card, className = '' }: { card: SlabCard; className?: string }) {
  const s = useGradedSource(card)
  if (!s) return null
  if (s.kind === 'raw') {
    return (
      <span
        title={`No ${s.slab} sales on PriceCharting yet, so this is TCGplayer's ungraded price — a graded copy is usually worth more.`}
        className={`inline-flex items-center text-[0.625rem] font-semibold px-1.5 py-0.5 rounded border border-dashed border-slate-500/50 text-slate-500 whitespace-nowrap ${className}`}
      >
        Raw est.
      </span>
    )
  }
  return (
    <a
      href={s.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={stop}
      title={`PriceCharting's ${s.label} price — from recent sales, estimated where there are few. Opens this card on PriceCharting.`}
      className={`inline-flex items-center gap-1 text-[0.625rem] font-semibold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700 border border-amber-500/30 hover:bg-amber-500/20 whitespace-nowrap transition-colors ${className}`}
    >
      {s.label} · PriceCharting <ExternalLink size={10} aria-hidden />
    </a>
  )
}

/** A sentence for the card's own page, under its value */
export function GradedPriceNote({ card }: { card: SlabCard }) {
  const s = useGradedSource(card)
  if (!s) return null
  if (s.kind === 'raw') {
    return (
      <span className="text-xs text-slate-500">
        Raw est. — no {s.slab} sales on PriceCharting yet, so this is TCGplayer&apos;s ungraded price.
      </span>
    )
  }
  return (
    <span className="text-xs text-slate-500">
      {s.label} price from{' '}
      <a href={s.url} target="_blank" rel="noopener noreferrer" onClick={stop} className="inline-flex items-center gap-0.5 font-semibold text-amber-700 hover:underline">
        PriceCharting <ExternalLink size={11} aria-hidden />
      </a>
    </span>
  )
}

/** The graded key (psa10, g9 …) → how it reads ("PSA 10", "Grade 9") */
export const gradedLabel = (key: string) => (GRADED_LABELS as Record<string, string>)[key] ?? 'Graded'

/** The credit line under a graded price anywhere a source is passed in directly (the zoom view):
 *  "PSA 10 · PriceCharting ↗" */
export function PriceChartingCredit({ label, url, className = '' }: { label: string; url: string; className?: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={stop}
      title={`PriceCharting's ${label} price — from recent sales, estimated where there are few. Opens this card on PriceCharting.`}
      className={`inline-flex items-center gap-1 text-[0.6875rem] font-semibold text-amber-700 hover:underline ${className}`}
    >
      {label} · PriceCharting <ExternalLink size={11} aria-hidden />
    </a>
  )
}

/** True when this card's value is PriceCharting's graded price (its history is ungraded) */
export function useIsGradedPriced(card: SlabCard): boolean {
  return useGradedSource(card)?.kind === 'graded'
}
