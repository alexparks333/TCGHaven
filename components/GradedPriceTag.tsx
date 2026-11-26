'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { ExternalLink } from 'lucide-react'
import { useStore } from '@/lib/store'
import { GRADED_LABELS } from '@/scripts/lib/pricecharting.mjs'
import type { Card } from '@/lib/types'

// Where a slab's value comes from, beside its price (docs/PriceCharting.md):
//  - priced from PriceCharting → "PSA 10 · PriceCharting ↗", linking to the card's page there.
//    That link is the citation PriceCharting's licence requires beside every graded price — never
//    show a graded price without this tag.
//  - graded but no sales for its grade → "Raw est.": valued at TCGplayer's ungraded price.
//  - a card priced from PriceCharting's UNGRADED price (a stagnant card nothing else prices —
//    scripts/lib/stagnant.mjs) → "Ungraded · PriceCharting ↗" on its raw copies (and on a slab
//    valued at that raw price): the same licence, the same citation (useUngradedUrl).
// Shows nothing for other ungraded cards, cards with no catalog match, or while graded pricing is off.

type SlabCard = Pick<Card, 'id' | 'apiId' | 'gradingCompany' | 'grade' | 'gradeTier'> & Partial<Pick<Card, 'game' | 'language'>>

// ── PriceCharting's ungraded price: which catalog cards have one (app/api/prices/ungraded) ──────
// The price routes answer with numbers only, so the link is asked for separately: once per catalog
// card per session, every tag on the page batched into one request.
const ungraded = new Map<string, string | null>()   // "game:language:apiId" → PriceCharting page (null = none)
const asked = new Set<string>()
let queue: Array<{ id: string; apiId: string; game: string; language?: string }> = []
let timer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()
const ungradedKey = (c: SlabCard) => (c.apiId && c.game ? `${c.game}:${c.language ?? ''}:${c.apiId}` : '')

async function flushUngraded() {
  timer = null
  const batch = queue
  queue = []
  for (let i = 0; i < batch.length; i += 500) {
    const part = batch.slice(i, i + 500)
    try {
      const res = await fetch('/api/prices/ungraded', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cards: part }) })
      if (!res.ok) throw new Error(String(res.status))
      const urls = (await res.json()) as Record<string, string>
      for (const c of part) ungraded.set(c.id, urls[c.id] ?? null)
    } catch {
      for (const c of part) asked.delete(c.id)   // asked again on the next render that wants it
    }
  }
  listeners.forEach((l) => l())
}

function subscribeUngraded(l: () => void) {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

/** The PriceCharting page when this copy's raw price is PriceCharting's ungraded price, else null */
export function useUngradedUrl(card: SlabCard): string | null {
  const key = ungradedKey(card)
  const url = useSyncExternalStore(subscribeUngraded, () => (key ? ungraded.get(key) ?? null : null), () => null)
  useEffect(() => {
    if (!key || asked.has(key)) return
    asked.add(key)
    queue.push({ id: key, apiId: card.apiId!, game: card.game!, ...(card.language && { language: card.language }) })
    if (!timer) timer = setTimeout(flushUngraded, 50)
  }, [key, card.apiId, card.game, card.language])
  return url
}

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
  const ungradedUrl = useUngradedUrl(card)
  // Valued at the raw price, and that price is PriceCharting's ungraded one → cite it
  if (s?.kind !== 'graded' && ungradedUrl) {
    return (
      <a
        href={ungradedUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={stop}
        title={`${s?.kind === 'raw' ? `No ${s.slab} sales on PriceCharting yet, so this is ` : ''}PriceCharting's ungraded price — nothing else prices this card. Opens this card on PriceCharting.`}
        className={`inline-flex items-center gap-1 text-[0.625rem] font-semibold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700 border border-amber-500/30 hover:bg-amber-500/20 whitespace-nowrap transition-colors ${className}`}
      >
        Ungraded · PriceCharting <ExternalLink size={10} aria-hidden />
      </a>
    )
  }
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
  const ungradedUrl = useUngradedUrl(card)
  if (s?.kind !== 'graded' && ungradedUrl) {
    return (
      <span className="text-xs text-slate-500">
        {s?.kind === 'raw' ? `Raw est. — no ${s.slab} sales yet; ungraded` : 'Ungraded'} price from{' '}
        <a href={ungradedUrl} target="_blank" rel="noopener noreferrer" onClick={stop} className="inline-flex items-center gap-0.5 font-semibold text-amber-700 hover:underline">
          PriceCharting <ExternalLink size={11} aria-hidden />
        </a>
      </span>
    )
  }
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
