'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { adminFetch } from '@/lib/firebase/authFetch'
import { cn, formatCurrency } from '@/lib/utils'

// Needs Review's PriceCharting tags: does a card get graded (PSA / BGS …) prices? Linked by its
// TCGplayer id, linked by staff on the Graded links page, or not on PriceCharting yet (then a slab
// of it shows "Raw est."). app/api/admin/graded-status, docs/PriceCharting.md.

export type GradedStatus = { by: 'id' | 'match' | 'staff'; pc: string; url: string; psa10: number | null; versions: string[] } | null

/** Each card's status, by catalog card id (undefined while loading or when it couldn't be read) */
export function useGradedStatus(catalog: string, ids: string[]): Map<string, GradedStatus> {
  const [status, setStatus] = useState<Map<string, GradedStatus>>(new Map())
  const key = ids.join(',')
  useEffect(() => {
    if (!ids.length) return
    let live = true
    const chunks: string[][] = []
    for (let i = 0; i < ids.length; i += 400) chunks.push(ids.slice(i, i + 400))
    Promise.all(chunks.map((c) => adminFetch(`/api/admin/graded-status?catalog=${catalog}&ids=${encodeURIComponent(c.join(','))}`)
      .then((r) => (r.ok ? r.json() : { status: {} }))
      .catch(() => ({ status: {} }))))
      .then((parts) => {
        if (!live) return
        const m = new Map<string, GradedStatus>()
        for (const p of parts) for (const [id, s] of Object.entries(p.status ?? {})) m.set(id, s as GradedStatus)
        setStatus(m)
      })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, key])
  return status
}

const BY = { id: ' (matched by TCGplayer id)', match: ' (matched by set, name and number)', staff: ' (linked by staff)' } as const

/** The small tag on a card tile; `full` = the card viewer's longer line */
export function GradedTag({ status, full }: { status: GradedStatus | undefined; full?: boolean }) {
  if (status === undefined) return null
  if (!status) {
    return (
      <span className={cn('inline-flex items-center rounded-full bg-slate-500/10 text-slate-500 font-semibold', full ? 'text-xs px-2.5 py-1' : 'text-[0.625rem] px-1.5 py-px')}
        title="PriceCharting has no graded sales linked to this card yet — a slab of it is valued at its raw price (Raw est.). If PriceCharting lists it without a TCGplayer id, it shows up on Graded links.">
        {full ? 'No graded prices yet — not on PriceCharting, or not linked' : 'No graded'}
        {full && <Link href="/admin/graded" className="ml-1.5 underline">Graded links</Link>}
      </span>
    )
  }
  const extra = status.versions.length ? ` + ${status.versions.map((v) => (v === '1st' ? '1st Ed.' : v[0].toUpperCase() + v.slice(1))).join(', ')}` : ''
  return (
    <a href={status.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
      className={cn('inline-flex items-center rounded-full bg-emerald-600/15 text-emerald-700 font-semibold hover:underline', full ? 'text-xs px-2.5 py-1' : 'text-[0.625rem] px-1.5 py-px')}
      title={`Graded prices from PriceCharting${BY[status.by]}${extra}`}>
      {full
        ? `Graded prices linked${status.psa10 ? ` · PSA 10 ${formatCurrency(status.psa10)}` : ''}${extra}${status.by === 'id' ? '' : ` ·${BY[status.by].replace(/[()]/g, '')}`}`
        : `Graded${status.psa10 ? ` ${formatCurrency(status.psa10)}` : ''}`}
    </a>
  )
}
