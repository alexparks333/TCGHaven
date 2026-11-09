'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Lock, Crown, Loader2, Save, Plus, Trash2, Copy, Check, Ticket, Tag, History, Shuffle, Power, Info, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { staffDb } from '@/lib/firebase/staff'
import {
  CODE_PATTERN, createPromoCode, deletePromoCode, listPromoCodes, makeCode, normalizeCode, promoStatus,
  savePrices, setPromoActive, watchPremiumConfig, yearlySaving,
  type PremiumConfig, type PromoCode, type PromoStatus,
} from '@/lib/premium'
import { APPLE_CUT } from '@/lib/finance'
import { useStaff } from '../StaffAuthProvider'
import { Panel, fmtInt, fmtMoney, fmtPct } from './charts'

// Staff portal → Haven Premium (/admin/premium) — the Owner only (menu + firestore.rules). The
// subscription's prices (with a log of every change) and promo codes for free months of Premium.
// Redeeming codes and Permanent Premium come with Premium itself (lib/premium.ts).

const MONTH_CHOICES = [1, 3, 6, 12]
const STATUS_STYLE: Record<PromoStatus, string> = {
  active: 'bg-emerald-600/15 text-emerald-700',
  off: 'bg-slate-800 text-slate-500',
  expired: 'bg-amber-200/60 text-amber-700',
  'used up': 'bg-violet-600/15 text-violet-700',
}
const fmtDay = (ms: number) => (ms ? new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—')

export function PremiumPage() {
  const { member } = useStaff()
  if (member?.role !== 'owner') {
    return <div className="card-glass p-6 text-sm text-slate-400 flex items-center gap-2"><Lock size={15} />Haven Premium settings are only for the Owner.</div>
  }
  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
          Haven Premium <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-700 inline-flex items-center gap-1"><Crown size={10} />Owner only</span>
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">What Premium costs, and promo codes for free months.</p>
      </div>
      <div className="flex flex-col gap-6">
        <Pricing by={member.name || member.email} />
        <PromoCodes by={member.name || member.email} />
      </div>
    </div>
  )
}

// ── Pricing ─────────────────────────────────────────────────────────────────────────────────

function Pricing({ by }: { by: string }) {
  const [config, setConfig] = useState<PremiumConfig | null>(null)
  const [monthly, setMonthly] = useState('')
  const [yearly, setYearly] = useState('')
  const [yearlyOn, setYearlyOn] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  // Fill the boxes on first load; later updates only refresh the history and "current" figures
  const filled = useRef(false)
  useEffect(() => watchPremiumConfig(staffDb, (c) => {
    if (!filled.current) { filled.current = true; setMonthly(c.monthly.toFixed(2)); setYearly(c.yearly.toFixed(2)); setYearlyOn(c.yearlyOn) }
    setConfig(c)
  }), [])

  const m = parseFloat(monthly), y = parseFloat(yearly)
  const valid = m > 0 && m < 1000 && (!yearlyOn || (y > 0 && y < 10000))
  const changed = !!config && valid && (Math.abs(m - config.monthly) > 0.001 || Math.abs(y - config.yearly) > 0.001 || yearlyOn !== config.yearlyOn)
  const saving_ = yearlySaving({ monthly: m || 0, yearly: y || 0 })

  async function save() {
    if (!valid) return setError('Enter a price above $0.')
    if (!confirm(`Change Haven Premium to ${fmtMoney(m)}/month${yearlyOn ? ` and ${fmtMoney(y)}/year` : ' (no yearly plan)'}?\n\nRemember to set the same prices for the subscription in App Store Connect — Apple charges iPhone users whatever is set there.`)) return
    setSaving(true); setError('')
    try {
      await savePrices(staffDb, { monthly: Math.round(m * 100) / 100, yearly: Math.round(y * 100) / 100, yearlyOn }, by)
      setSaved(true); setTimeout(() => setSaved(false), 2500)
    } catch (e) { setError(`Couldn’t save: ${(e as Error).message}`) } finally { setSaving(false) }
  }

  return (
    <Panel title="Pricing" sub="What Haven Premium costs. Changes apply to new subscriptions; people already subscribed keep their price until it renews.">
      {!config ? (
        <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-slate-500" /></div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <div className="grid grid-cols-2 gap-3">
              <PriceBox label="Monthly" value={monthly} onChange={setMonthly} suffix="/ month" />
              <PriceBox label="Yearly" value={yearly} onChange={setYearly} suffix="/ year" disabled={!yearlyOn} />
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm text-slate-300 cursor-pointer select-none">
              <input type="checkbox" checked={yearlyOn} onChange={(e) => setYearlyOn(e.target.checked)} className="accent-violet-600 w-4 h-4" />
              Offer a yearly plan
            </label>
            <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-xs text-slate-400 space-y-1.5">
              {m > 0 && <div>Monthly: you keep <b className="text-ink">{fmtMoney(m * (1 - APPLE_CUT))}</b> after Apple’s {fmtPct(APPLE_CUT, 0)} on iPhone ({fmtMoney(m * 12)} a year).</div>}
              {yearlyOn && y > 0 && (
                <div>Yearly: {fmtMoney(y / 12)} a month — <b className="text-ink">{fmtPct(saving_, 0)} cheaper</b> than paying monthly; you keep {fmtMoney(y * (1 - APPLE_CUT))}.</div>
              )}
            </div>
            <div className="mt-4 flex items-center gap-2">
              {error && <span className="text-xs text-red-600 mr-auto">{error}</span>}
              <button onClick={save} disabled={!changed || saving} className="ml-auto btn-primary disabled:opacity-50">
                {saving ? <Loader2 size={15} className="animate-spin" /> : saved ? <Check size={15} /> : <Save size={15} />}
                {saved ? 'Saved' : 'Save prices'}
              </button>
            </div>
            <p className="mt-3 flex items-start gap-1.5 text-[11px] text-slate-500">
              <Info size={12} className="shrink-0 mt-0.5" />
              These are the website’s prices and what the app shows. Apple charges iPhone subscribers the price set in App Store Connect, from Apple’s fixed price points ($3.99, $4.99…) — set it to match there.
            </p>
          </div>
          <div>
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2"><History size={13} />Price changes</div>
            {config.history.length === 0 ? (
              <div className="text-xs text-slate-500">No changes yet — Premium is at its starting price of {fmtMoney(config.monthly)}/month.</div>
            ) : (
              <ul className="flex flex-col gap-2 max-h-56 overflow-y-auto">
                {config.history.map((h) => (
                  <li key={h.at} className="text-xs text-slate-400">
                    <span className="text-slate-500">{fmtDay(h.at)}</span> · <b className="text-ink">{fmtMoney(h.monthly)}/mo</b>
                    {h.yearlyOn ? <> · {fmtMoney(h.yearly)}/yr</> : <> · no yearly plan</>} <span className="text-slate-500">by {h.by}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Panel>
  )
}

function PriceBox({ label, value, onChange, suffix, disabled }: { label: string; value: string; onChange: (v: string) => void; suffix: string; disabled?: boolean }) {
  return (
    <label className={cn(disabled && 'opacity-50')}>
      <span className="field-label">{label}</span>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm pointer-events-none">$</span>
        <input type="number" min={0} step={0.01} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="input-field !pl-7 !pr-16 !text-lg !font-bold tabular-nums" />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500 pointer-events-none">{suffix}</span>
      </div>
    </label>
  )
}

// ── Promo codes ─────────────────────────────────────────────────────────────────────────────

type Filter = 'all' | PromoStatus

function PromoCodes({ by }: { by: string }) {
  const [codes, setCodes] = useState<PromoCode[] | null>(null)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [copied, setCopied] = useState<string | null>(null)

  const load = useCallback(() => { listPromoCodes(staffDb).then(setCodes).catch((e) => setError(`Couldn’t load codes: ${(e as Error).message}`)) }, [])
  useEffect(load, [load])

  const shown = useMemo(() => {
    const q = search.trim().toUpperCase()
    return (codes ?? []).filter((c) => (filter === 'all' || promoStatus(c) === filter) && (!q || c.code.includes(q) || c.note.toUpperCase().includes(q)))
  }, [codes, filter, search])
  const counts = useMemo(() => {
    const n: Record<Filter, number> = { all: 0, active: 0, off: 0, expired: 0, 'used up': 0 }
    for (const c of codes ?? []) { n.all += 1; n[promoStatus(c)] += 1 }
    return n
  }, [codes])

  async function copy(code: string) {
    await navigator.clipboard.writeText(code).catch(() => {})
    setCopied(code); setTimeout(() => setCopied(null), 1500)
  }
  async function toggle(c: PromoCode) {
    setCodes((l) => l?.map((x) => (x.code === c.code ? { ...x, active: !c.active } : x)) ?? l)
    try { await setPromoActive(staffDb, c.code, !c.active) } catch (e) { setError(`Couldn’t change ${c.code}: ${(e as Error).message}`); load() }
  }
  async function remove(c: PromoCode) {
    if (!confirm(`Delete the code ${c.code}?${c.uses ? `\n\nIt’s been used ${c.uses} time${c.uses === 1 ? '' : 's'} — people who already redeemed it keep their free months. Switching it off instead keeps it in this list.` : ''}`)) return
    try { await deletePromoCode(staffDb, c.code); setCodes((l) => l?.filter((x) => x.code !== c.code) ?? l) } catch (e) { setError(`Couldn’t delete ${c.code}: ${(e as Error).message}`) }
  }

  return (
    <div className="flex flex-col gap-4">
      <NewPromo by={by} existing={codes ?? []} onCreated={load} />

      <Panel title="Promo codes" sub="Each code gives free months of Haven Premium. Redeeming them in the app comes with Premium itself.">
        {error && <div className="mb-3 text-xs text-red-600 flex items-center gap-2">{error}<button onClick={() => setError('')} className="ml-auto"><X size={13} /></button></div>}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {(['all', 'active', 'off', 'expired', 'used up'] as Filter[]).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={cn('px-3 py-1 rounded-xl border text-xs font-semibold capitalize transition-colors', filter === f ? 'bg-slate-800 border-slate-600 text-ink' : 'border-slate-800 text-slate-400 hover:text-ink')}>
              {f} <span className="text-slate-500 ml-1">{counts[f]}</span>
            </button>
          ))}
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a code or note" className="input-field !w-auto !py-1.5 !text-xs ml-auto" />
        </div>
        {!codes ? (
          <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-slate-500" /></div>
        ) : shown.length === 0 ? (
          <div className="text-sm text-slate-500 py-8 text-center">{codes.length ? 'No codes match.' : 'No promo codes yet — make one above.'}</div>
        ) : (
          <div className="-mx-4 md:-mx-5">
            <div className="hidden md:grid grid-cols-[minmax(0,1.6fr)_90px_120px_120px_90px_110px] gap-3 px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 border-y border-slate-800">
              <span>Code</span><span>Gives</span><span>Used</span><span>Expires</span><span>Status</span><span />
            </div>
            {shown.map((c) => {
              const status = promoStatus(c)
              return (
                <div key={c.code} className={cn('grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1.6fr)_90px_120px_120px_90px_110px] items-center gap-x-3 gap-y-1 px-5 py-3 border-b border-slate-800/60 last:border-0', status !== 'active' && 'opacity-70')}>
                  <div className="min-w-0">
                    <button onClick={() => copy(c.code)} className="font-mono text-sm font-bold text-ink hover:text-violet-700 inline-flex items-center gap-1.5" title="Copy">
                      {c.code}{copied === c.code ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} className="opacity-50" />}
                    </button>
                    <div className="text-[11px] text-slate-500 truncate">{c.note || `Made ${fmtDay(c.createdAt)}${c.createdBy ? ` by ${c.createdBy}` : ''}`}</div>
                  </div>
                  <div className="hidden md:block text-sm text-ink font-semibold">{c.months} {c.months === 1 ? 'month' : 'months'}</div>
                  <div className="hidden md:block text-xs text-slate-400 tabular-nums">{fmtInt(c.uses)}{c.maxUses !== null ? ` / ${fmtInt(c.maxUses)}` : ' · no limit'}</div>
                  <div className="hidden md:block text-xs text-slate-400">{c.expires ? fmtDay(Date.parse(`${c.expires}T00:00:00`)) : 'Never'}</div>
                  <div className="hidden md:block"><span className={cn('text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full', STATUS_STYLE[status])}>{status}</span></div>
                  <div className="flex items-center justify-end gap-1">
                    <span className={cn('md:hidden text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full mr-1', STATUS_STYLE[status])}>{c.months}mo · {status}</span>
                    <button onClick={() => toggle(c)} title={c.active ? 'Switch off' : 'Switch on'} className={cn('p-1.5 rounded-lg hover:bg-slate-800', c.active ? 'text-emerald-700' : 'text-slate-500')}><Power size={14} /></button>
                    <button onClick={() => remove(c)} title="Delete" className="p-1.5 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-100/30"><Trash2 size={14} /></button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Panel>
    </div>
  )
}

function NewPromo({ by, existing, onCreated }: { by: string; existing: PromoCode[]; onCreated: () => void }) {
  const [code, setCode] = useState(() => makeCode())
  const [months, setMonths] = useState(3)
  const [custom, setCustom] = useState('')
  const [limitOn, setLimitOn] = useState(false)
  const [maxUses, setMaxUses] = useState('100')
  const [expires, setExpires] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [made, setMade] = useState<string | null>(null)

  const finalMonths = custom ? parseInt(custom, 10) : months
  const normalized = normalizeCode(code)

  async function create() {
    setError(''); setMade(null)
    if (!CODE_PATTERN.test(normalized)) return setError('Codes are 4–24 letters, numbers or dashes.')
    if (existing.some((c) => c.code === normalized)) return setError('That code already exists.')
    if (!(finalMonths >= 1 && finalMonths <= 36)) return setError('Free months must be between 1 and 36.')
    const max = limitOn ? parseInt(maxUses, 10) : null
    if (limitOn && !(max! >= 1)) return setError('Set how many times it can be used.')
    setBusy(true)
    try {
      await createPromoCode(staffDb, { code: normalized, months: finalMonths, maxUses: max, expires: expires || null, active: true, note: note.trim(), createdBy: by })
      setMade(normalized)
      setCode(makeCode()); setNote(''); setCustom('')
      onCreated()
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <Panel title="New promo code" right={<Ticket size={16} className="text-slate-500" />}>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <label>
            <span className="field-label">Code</span>
            <div className="flex gap-2">
              <input value={code} onChange={(e) => setCode(e.target.value)} className="input-field font-mono font-bold uppercase tracking-wide" maxLength={24} />
              <button onClick={() => setCode(makeCode())} title="Make a random code" className="btn-secondary !px-3"><Shuffle size={15} /></button>
            </div>
            <span className="text-[11px] text-slate-500 mt-1 block">Random is safest for one-off gifts; a word like <span className="font-mono">LAUNCH3</span> works for something you share publicly.</span>
          </label>
          <div>
            <span className="field-label">Free months of Premium</span>
            <div className="flex flex-wrap gap-2">
              {MONTH_CHOICES.map((n) => (
                <button key={n} onClick={() => { setMonths(n); setCustom('') }} className={cn('px-3.5 py-1.5 rounded-xl border text-sm font-semibold transition-colors', !custom && months === n ? 'bg-violet-600 border-violet-500 text-white' : 'border-slate-800 text-slate-400 hover:text-ink')}>
                  {n} {n === 1 ? 'month' : 'months'}
                </button>
              ))}
              <input type="number" min={1} max={36} value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Other" className="input-field !w-24 !py-1.5" />
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={limitOn} onChange={(e) => setLimitOn(e.target.checked)} className="accent-violet-600" />Limit uses
              </label>
              <input type="number" min={1} value={maxUses} disabled={!limitOn} onChange={(e) => setMaxUses(e.target.value)} className={cn('input-field', !limitOn && 'opacity-50')} />
            </div>
            <label>
              <span className="field-label">Last day to use it (optional)</span>
              <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} className="input-field" />
            </label>
          </div>
          <label>
            <span className="field-label">Note (only you see this)</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. YouTube giveaway, Nov 2026" className="input-field" />
          </label>
          <div className="flex items-center gap-2 mt-auto">
            {error && <span className="text-xs text-red-600 mr-auto">{error}</span>}
            {made && !error && <span className="text-xs text-emerald-700 mr-auto inline-flex items-center gap-1"><Check size={13} />Made <span className="font-mono font-bold">{made}</span></span>}
            <button onClick={create} disabled={busy} className="ml-auto btn-primary disabled:opacity-60">
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
              Make code · {Number.isFinite(finalMonths) ? finalMonths : '?'} {finalMonths === 1 ? 'month' : 'months'}
            </button>
          </div>
        </div>
      </div>
      <p className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-500"><Tag size={12} />Switching a code off stops new redemptions but keeps it (and how often it was used) in the list. Deleting removes it.</p>
    </Panel>
  )
}
