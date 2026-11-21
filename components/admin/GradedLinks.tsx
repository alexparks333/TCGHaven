'use client'

import { useEffect, useMemo, useState } from 'react'
import { deleteField, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { Check, ExternalLink, Link2, Loader2, Search, Undo2, X } from 'lucide-react'
import { cn, formatCurrency } from '@/lib/utils'
import { staffDb } from '@/lib/firebase/staff'
import { cardImage } from '@/lib/cardImage'
import { linkSlot } from '@/scripts/lib/pricecharting.mjs'
import { PriceChartingLink } from './PriceChartingLink'

// The staff portal's Graded links page. PriceCharting lists some cards with graded (PSA / BGS …)
// sales but no TCGplayer id, so they can't be matched to our catalog by id (1 in 5 rows; One Piece
// half). The clear ones are matched by set + name + number in games whose daily self-check passes
// (scripts/lib/pricecharting.mjs backupMatch) — listed under "Matched automatically" to check; the
// rest are listed with the cards they could be (graded_review/{catalog}) for a person to pick. Saved
// to graded_links/{catalog}; the next daily run applies it. docs/PriceCharting.md.

const CATALOGS: Array<[string, string]> = [
  ['pokemon', 'Pokémon'], ['pokemon-jp', 'Pokémon (Japanese)'], ['lorcana', 'Lorcana'], ['onepiece', 'One Piece'],
  ['mtg', 'Magic'], ['yugioh', 'Yu-Gi-Oh!'], ['riftbound', 'Riftbound'], ['swu', 'Star Wars'], ['gundam', 'Gundam'],
  ['fab', 'Flesh and Blood'], ['digimon', 'Digimon'], ['palworld', 'Palworld'], ['cyberpunk', 'Cyberpunk'],
]

interface Candidate { id: string; name: string; setName: string; number: string; imageUrl: string; exact: boolean }
interface Item { pc: string; name: string; set: string; u: string; p: Record<string, number>; variant: string; cards: Candidate[] }
type Links = Record<string, Record<string, string>>   // card id → { slot ('_' = the card) → PriceCharting id }
// A card matched by set + name + number with no TCGplayer id (pricecharting.mjs backupMatch) — to check
interface Auto { id: string; name: string; setName: string; number: string; imageUrl: string; pc: string; pcName: string; u: string; psa10: number | null }
type Check = { right: number; wrong: number; examples?: string[] } | null

const VERSION_LABEL: Record<string, string> = { foil: 'Foil', '1st': '1st Edition', limited: 'Limited Edition', shadowless: 'Shadowless', reverse: 'Reverse Holo' }
const PRICE_ROWS: Array<[string, string]> = [['psa10', 'PSA 10'], ['bgs10', 'BGS 10'], ['cgc10', 'CGC 10'], ['g9', 'Grade 9'], ['g8', 'Grade 8']]

export function GradedLinks() {
  const [catalog, setCatalog] = useState('lorcana')
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [items, setItems] = useState<Item[] | null>(null)
  const [links, setLinks] = useState<Links>({})
  const [ignored, setIgnored] = useState<Record<string, boolean>>({})
  const [asOf, setAsOf] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [onlyExact, setOnlyExact] = useState(false)
  const [tab, setTab] = useState<'link' | 'auto'>('link')
  const [auto, setAuto] = useState<Auto[]>([])
  const [check, setCheck] = useState<Check>(null)

  // How many to review in each game (the tab counts)
  useEffect(() => {
    Promise.all(CATALOGS.map(([k]) => getDoc(doc(staffDb, 'graded_review', k)).then((d) => [k, Number(d.data()?.count ?? 0)] as const).catch(() => [k, 0] as const)))
      .then((r) => setCounts(Object.fromEntries(r)))
  }, [])

  useEffect(() => {
    let live = true
    setItems(null); setError(null)
    Promise.all([getDoc(doc(staffDb, 'graded_review', catalog)), getDoc(doc(staffDb, 'graded_links', catalog))])
      .then(([r, l]) => {
        if (!live) return
        const d = r.data()
        setItems(d?.items ? (JSON.parse(d.items) as Item[]) : [])
        setAuto(d?.auto ? (JSON.parse(d.auto) as Auto[]) : [])
        setCheck((d?.check ?? null) as Check)
        setAsOf(d?.asOf?.toDate?.() ?? null)
        setLinks((l.data()?.links ?? {}) as Links)
        setIgnored((l.data()?.ignored ?? {}) as Record<string, boolean>)
      })
      .catch((e) => { console.error(e); if (live) { setError('Couldn’t load the list.'); setItems([]) } })
    return () => { live = false }
  }, [catalog])

  // Where each PriceCharting row was linked today (before the next run takes it off the list)
  const linkedTo = useMemo(() => {
    const m = new Map<string, { cardId: string; slot: string }>()
    for (const [cardId, slots] of Object.entries(links)) for (const [slot, pc] of Object.entries(slots ?? {})) if (pc) m.set(pc, { cardId, slot })
    return m
  }, [links])

  const shown = useMemo(() => {
    const f = q.trim().toLowerCase()
    return (items ?? []).filter((i) =>
      (!onlyExact || i.cards.some((c) => c.exact)) &&
      (!f || i.name.toLowerCase().includes(f) || i.set.toLowerCase().includes(f) || i.cards.some((c) => c.name.toLowerCase().includes(f))))
  }, [items, q, onlyExact])

  const ref = () => doc(staffDb, 'graded_links', catalog)

  async function link(item: Item, card: Candidate) {
    const slot = linkSlot(item.variant, card.name) || '_'
    setBusy(item.pc)
    try {
      await setDoc(ref(), { links: { [card.id]: { [slot]: item.pc } }, updatedAt: serverTimestamp() }, { merge: true })
      setLinks((l) => ({ ...l, [card.id]: { ...l[card.id], [slot]: item.pc } }))
    } catch (e) { console.error(e); setError('Couldn’t save that link.') } finally { setBusy(null) }
  }

  async function unlink(item: Item) {
    const at = linkedTo.get(item.pc)
    if (!at) return
    setBusy(item.pc)
    try {
      await setDoc(ref(), { links: { [at.cardId]: { [at.slot]: deleteField() } }, updatedAt: serverTimestamp() }, { merge: true })
      setLinks((l) => { const s = { ...l[at.cardId] }; delete s[at.slot]; return { ...l, [at.cardId]: s } })
    } catch (e) { console.error(e); setError('Couldn’t undo that link.') } finally { setBusy(null) }
  }

  async function dismiss(item: Item, on: boolean) {
    setBusy(item.pc)
    try {
      await setDoc(ref(), { ignored: { [item.pc]: on ? true : deleteField() }, updatedAt: serverTimestamp() }, { merge: true })
      setIgnored((g) => { const n = { ...g }; if (on) n[item.pc] = true; else delete n[item.pc]; return n })
    } catch (e) { console.error(e); setError('Couldn’t save that.') } finally { setBusy(null) }
  }

  const pill = (on: boolean) => cn('text-xs font-medium px-3 py-1 rounded-full transition-colors whitespace-nowrap', on ? 'bg-slate-800 text-ink' : 'text-slate-500 hover:text-ink')

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-ink">Graded links</h1>
        <p className="text-slate-400 text-sm mt-0.5 max-w-3xl">
          PriceCharting cards with graded sales that don’t carry a TCGplayer id. Clear ones are matched automatically by set, name and number
          (in games whose daily self-check passes); the rest wait here for you to pick the card. Changes take effect after the next PriceCharting run (daily, 10:30 UTC).
          {asOf && <> List from {asOf.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.</>}
        </p>
      </div>

      <div className="flex items-center gap-1 flex-wrap rounded-2xl border border-slate-700 p-1 mb-4">
        {CATALOGS.map(([k, label]) => (
          <button key={k} onClick={() => setCatalog(k)} className={pill(catalog === k)}>
            {label}{counts[k] ? <span className="ml-1 text-slate-500">{counts[k]}</span> : null}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3 flex-wrap mb-4">
        <div className="flex items-center rounded-full border border-slate-700 p-0.5">
          <button onClick={() => setTab('link')} className={pill(tab === 'link')}>To link{items ? ` ${items.length}` : ''}</button>
          <button onClick={() => setTab('auto')} className={pill(tab === 'auto')}>Matched automatically {auto.length}</button>
        </div>
        {check && (check.right + check.wrong > 0) && (
          <span className="text-xs text-slate-500" title="Each day the job replays PriceCharting cards that DO have a TCGplayer id with the id hidden, and checks the set + name + number match against it. Automatic matching runs only when at most 0.1% are wrong.">
            Today’s self-check: {check.right.toLocaleString()} right, {check.wrong} wrong — automatic matching {check.right >= 20 && check.wrong / (check.right + check.wrong) <= 0.001 ? 'on' : 'off'}
          </span>
        )}
      </div>

      {tab === 'auto' ? (
        <div>
          <p className="text-sm text-slate-400 mb-3 max-w-3xl">Cards PriceCharting lists without a TCGplayer id, matched to ours by set, name and number. Check them now and then — open PriceCharting, and if it’s the wrong card, remove it or paste the right link.</p>
          {auto.length === 0 ? (
            <div className="card-glass py-14 text-center text-sm text-slate-500">None in this game.</div>
          ) : (
            <div className="space-y-3">
              {auto.map((a) => (
                <div key={a.id} className="card-glass p-3 flex gap-3">
                  {a.imageUrl ? <img src={cardImage(a.imageUrl, 'thumb') ?? a.imageUrl} alt="" className="w-16 aspect-[5/7] object-contain rounded-md bg-slate-900 shrink-0" loading="lazy" /> : <div className="w-16 aspect-[5/7] rounded-md bg-slate-900 shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-ink">{a.name} <span className="font-normal text-slate-500">· {a.setName} · #{a.number}</span></div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      → <a href={a.u} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-ink">{a.pcName || `PriceCharting #${a.pc}`} <ExternalLink size={10} className="inline" /></a>
                      {a.psa10 ? <> · PSA 10 {formatCurrency(a.psa10)}</> : null}
                    </div>
                    <div className="mt-2"><PriceChartingLink catalog={catalog} cardId={a.id} compact /></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (<>
      <div className="flex items-center gap-3 flex-wrap mb-4">
        <label className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 w-full sm:w-72">
          <Search size={14} className="text-slate-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a card or set" className="bg-transparent text-sm text-ink placeholder-slate-500 focus:outline-none w-full" />
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
          <input type="checkbox" checked={onlyExact} onChange={(e) => setOnlyExact(e.target.checked)} />
          Only where a card’s name matches
        </label>
        {items && <span className="text-xs text-slate-500">{shown.length} of {items.length}</span>}
      </div>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
      {items === null ? (
        <div className="py-16 flex justify-center"><Loader2 className="animate-spin text-slate-500" /></div>
      ) : shown.length === 0 ? (
        <div className="card-glass py-14 text-center text-sm text-slate-500">Nothing to link here{items.length ? ' with these filters' : ''}.</div>
      ) : (
        <div className="space-y-3">
          {shown.map((item) => {
            const at = linkedTo.get(item.pc)
            const isIgnored = !!ignored[item.pc]
            return (
              <div key={item.pc} className={cn('card-glass p-4', (at || isIgnored) && 'opacity-70')}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="text-[0.6875rem] font-semibold uppercase tracking-wider text-slate-500">PriceCharting · {item.set}</div>
                    <div className="text-sm font-semibold text-ink mt-0.5 flex items-center gap-2 flex-wrap">
                      {item.name}
                      {item.variant && <span className="text-[0.625rem] font-bold uppercase tracking-wide px-1.5 py-px rounded-full bg-amber-500/15 text-amber-700">{VERSION_LABEL[item.variant] ?? item.variant} version</span>}
                    </div>
                    <div className="text-xs text-slate-500 mt-1 flex items-center gap-x-3 gap-y-1 flex-wrap">
                      {PRICE_ROWS.filter(([k]) => item.p[k]).map(([k, l]) => <span key={k}>{l} <span className="text-ink font-medium">{formatCurrency(item.p[k])}</span></span>)}
                      <a href={item.u} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-ink">PriceCharting <ExternalLink size={11} /></a>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {at ? (
                      <button disabled={busy === item.pc} onClick={() => unlink(item)} className="btn-secondary"><Undo2 size={14} />Undo link</button>
                    ) : (
                      <button disabled={busy === item.pc} onClick={() => dismiss(item, !isIgnored)} className="btn-secondary">
                        {isIgnored ? <><Undo2 size={14} />Bring back</> : <><X size={14} />None of these</>}
                      </button>
                    )}
                  </div>
                </div>

                {at ? (
                  <p className="mt-3 text-xs font-semibold text-emerald-700 flex items-center gap-1.5">
                    <Check size={13} /> Linked to {item.cards.find((c) => c.id === at.cardId)?.name ?? at.cardId}
                    {at.slot !== '_' && ` as its ${VERSION_LABEL[at.slot] ?? at.slot} version`} — graded prices from the next run
                  </p>
                ) : isIgnored ? (
                  <p className="mt-3 text-xs text-slate-500">Dismissed — not suggested again.</p>
                ) : (
                  <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                    {item.cards.map((card) => {
                      const slot = linkSlot(item.variant, card.name)
                      return (
                        <div key={card.id} className={cn('rounded-xl border p-2 flex flex-col', card.exact ? 'border-emerald-600/40 bg-emerald-600/5' : 'border-slate-800')}>
                          {card.imageUrl
                            ? <img src={cardImage(card.imageUrl, 'thumb') ?? card.imageUrl} alt="" className="w-full aspect-[5/7] object-contain rounded-md bg-slate-900" loading="lazy" />
                            : <div className="w-full aspect-[5/7] rounded-md bg-slate-900" />}
                          <div className="mt-1.5 text-xs font-semibold text-ink leading-tight line-clamp-2" title={card.name}>{card.name}</div>
                          <div className="text-[0.6875rem] text-slate-500 leading-tight mt-0.5 line-clamp-2">{card.setName} · #{card.number}</div>
                          {card.exact && <div className="text-[0.625rem] font-semibold text-emerald-700 mt-0.5">Name matches</div>}
                          <button disabled={busy === item.pc} onClick={() => link(item, card)} className="btn-secondary mt-2 text-xs justify-center">
                            <Link2 size={13} />{slot ? `Link as ${VERSION_LABEL[slot] ?? slot}` : 'Link'}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      </>)}
    </div>
  )
}
