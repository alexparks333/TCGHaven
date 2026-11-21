'use client'

import { useEffect, useState } from 'react'
import { deleteField, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { ExternalLink, Loader2 } from 'lucide-react'
import { staffDb } from '@/lib/firebase/staff'
import { GradedTag, useGradedStatus } from './GradedTag'

// A card's PriceCharting link (where its graded prices come from), changeable by staff — in the
// Admin Catalog's Edit card popup and on the Graded links page. Saved to graded_links/{catalog}:
// `links[cardId]._` = the PriceCharting product to use instead (redirects a wrong link), or
// `blocked[cardId]` = no graded prices at all. The daily PriceCharting job applies it (staff
// always win over matching by TCGplayer id or by set + name + number). docs/PriceCharting.md.

/** "6910", "https://www.pricecharting.com/game/6910" → "6910"; anything else → null */
export function pcIdFrom(input: string): string | null {
  const s = input.trim()
  if (/^[0-9]{1,12}$/.test(s)) return s
  const m = /pricecharting\.com\/game\/([0-9]{1,12})(?:[/?#]|$)/i.exec(s)
  return m ? m[1] : null
}

export function PriceChartingLink({ catalog, cardId, compact }: { catalog: string; cardId: string; compact?: boolean }) {
  const status = useGradedStatus(catalog, [cardId]).get(cardId)
  const [override, setOverride] = useState<{ pc: string | null; blocked: boolean } | null>(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const ref = doc(staffDb, 'graded_links', catalog)

  useEffect(() => {
    getDoc(ref).then((d) => {
      const data = d.data() ?? {}
      setOverride({ pc: data.links?.[cardId]?._ ?? null, blocked: !!data.blocked?.[cardId] })
    }).catch(() => setOverride({ pc: null, blocked: false }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, cardId])

  async function write(patch: Record<string, unknown>, next: { pc: string | null; blocked: boolean }, note: string) {
    setBusy(true); setMsg(null)
    try {
      await setDoc(ref, { ...patch, updatedAt: serverTimestamp() }, { merge: true })
      setOverride(next); setInput(''); setMsg(note)
    } catch (e) {
      console.error(e); setMsg('Couldn’t save — try again.')
    } finally { setBusy(false) }
  }

  const save = () => {
    const pc = pcIdFrom(input)
    if (!pc) { setMsg('Paste the card’s PriceCharting link (pricecharting.com/game/123…) or its id.'); return }
    void write({ links: { [cardId]: { _: pc } }, blocked: { [cardId]: deleteField() } }, { pc, blocked: false }, 'Saved — graded prices from this link after the next daily run (10:30 UTC).')
  }
  const remove = () => write({ links: { [cardId]: { _: deleteField() } }, blocked: { [cardId]: true } }, { pc: null, blocked: true }, 'Removed — no graded prices for this card from the next daily run.')
  const automatic = () => write({ links: { [cardId]: { _: deleteField() } }, blocked: { [cardId]: deleteField() } }, { pc: null, blocked: false }, 'Back to automatic from the next daily run.')

  return (
    <div className={compact ? '' : 'rounded-xl border border-slate-800 p-3'}>
      {!compact && <div className="text-xs font-semibold text-slate-400 mb-1.5">PriceCharting (graded prices)</div>}
      <div className="flex items-center gap-2 flex-wrap">
        {status === undefined ? <Loader2 size={12} className="animate-spin text-slate-500" /> : <GradedTag status={status} full />}
      </div>
      {override && (override.pc || override.blocked) && (
        <p className="text-[0.6875rem] text-amber-700 mt-1.5">
          {override.blocked ? 'Set by staff: no graded prices for this card.' : <>Set by staff: uses PriceCharting <a className="underline" href={`https://www.pricecharting.com/game/${override.pc}`} target="_blank" rel="noreferrer">#{override.pc} <ExternalLink size={10} className="inline" /></a>.</>}
        </p>
      )}
      <div className="flex items-center gap-2 mt-2 flex-wrap">
        <input
          value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save() } }}
          placeholder="Change: paste a pricecharting.com/game/… link or id"
          className="flex-1 min-w-[14rem] bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-ink placeholder-slate-500 focus:outline-none focus:border-slate-600"
        />
        <button type="button" disabled={busy || !input.trim()} onClick={save} className="text-xs font-medium px-3 py-1.5 rounded-lg bg-slate-800 text-ink disabled:opacity-50">Use this link</button>
        {status && !override?.blocked && <button type="button" disabled={busy} onClick={remove} className="text-xs font-medium px-3 py-1.5 rounded-lg text-red-700 hover:bg-red-500/10 disabled:opacity-50">Wrong — remove</button>}
        {override && (override.pc || override.blocked) && <button type="button" disabled={busy} onClick={automatic} className="text-xs font-medium px-3 py-1.5 rounded-lg text-slate-400 hover:text-ink disabled:opacity-50">Back to automatic</button>}
      </div>
      {msg && <p className="text-[0.6875rem] text-slate-500 mt-1.5">{msg}</p>}
    </div>
  )
}
