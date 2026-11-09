'use client'

import { useEffect, useMemo, useState } from 'react'
import { collection, documentId, getDocs, limit, orderBy, query } from 'firebase/firestore'
import { Loader2, Plus, Pencil, Trash2, Lock, Crown, Receipt, TrendingUp, X, Check, CreditCard, Clock, MessageSquareWarning } from 'lucide-react'
import { cn } from '@/lib/utils'
import { staffDb } from '@/lib/firebase/staff'
import type { DailyStats } from '@/lib/stats/types'
import {
  APPLE_CUT, COST_CATEGORIES, addMonths, costIn, loadCosts, monthKey, monthLabel, saveCosts,
  type Cadence, type CostCategory, type CostItem,
} from '@/lib/finance'
import { DEFAULT_PREMIUM, loadPremiumConfig } from '@/lib/premium'
import { useStaff } from '../StaffAuthProvider'
import { StaffModal } from '../StaffModal'
import { Empty, Panel, RankBars, Tile, TimeBars, fmtInt, fmtMoney, fmtPct } from './charts'

// Staff portal → Finances (/admin/finances) — the Owner only (the menu hides it from everyone else
// and firestore.rules refuses everyone else's reads). Paying users today come from the Accounts
// titles; real revenue, how long people stay and why they cancel arrive with Haven Premium payments.
// The cost tracker is fully working: every bill the Owner adds, by month and by category.

// In COST_CATEGORIES order (the stacking order) — checked with the data-viz palette validator on
// the portal surface: every check passes, neighbours included.
const CATEGORY_COLORS: Record<CostCategory, string> = {
  Hosting: '#3d6db8', 'Database & storage': '#a87600', 'Apple & app stores': '#8a4fb0', 'Domain & email': '#16876a',
  'AI & tools': '#c94a2c', Marketing: '#0a80b8', Contractors: '#b0477e', Other: '#6f7d14',
}
const CADENCE_LABEL: Record<Cadence, string> = { monthly: 'Monthly', yearly: 'Yearly', once: 'One-off' }

export function FinancesPage() {
  const { member } = useStaff()
  const [stats, setStats] = useState<DailyStats | null | undefined>(undefined)
  const [costs, setCosts] = useState<CostItem[] | null>(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<CostItem | null>(null)
  const [spread, setSpread] = useState(true)
  const [price, setPrice] = useState(DEFAULT_PREMIUM.monthly)

  useEffect(() => {
    if (member?.role !== 'owner') return
    getDocs(query(collection(staffDb, 'stats_daily'), orderBy(documentId(), 'desc'), limit(1)))
      .then((s) => setStats((s.docs[0]?.data() as DailyStats) ?? null)).catch(() => setStats(null))
    loadPremiumConfig(staffDb).then((c) => setPrice(c.monthly))
    loadCosts().then(setCosts).catch((e) => setError(`Couldn’t load costs: ${(e as Error).message}`))
  }, [member?.role])

  const thisMonth = monthKey()
  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => addMonths(thisMonth, i - 11)), [thisMonth])
  const monthTotal = (m: string) => (costs ?? []).reduce((s, c) => s + costIn(c, m, spread), 0)
  const ytd = months.filter((m) => m.slice(0, 4) === thisMonth.slice(0, 4)).reduce((s, m) => s + monthTotal(m), 0)
  const lastMonth = monthTotal(addMonths(thisMonth, -1))

  if (member?.role !== 'owner') {
    return <div className="card-glass p-6 text-sm text-slate-400 flex items-center gap-2"><Lock size={15} />Finances are only for the Owner.</div>
  }

  const paid = stats?.roles?.premium ?? 0
  const freePremium = (stats?.roles?.creator ?? 0) + (stats?.roles?.staff ?? 0)
  const accounts = stats?.accounts?.total ?? 0
  const grossMonthly = paid * price
  const netMonthly = grossMonthly * (1 - APPLE_CUT)
  const costNow = monthTotal(thisMonth)

  async function persist(next: CostItem[]) {
    const before = costs
    setCosts(next)
    try { await saveCosts(next) } catch (e) { setCosts(before); setError(`Couldn’t save: ${(e as Error).message}`) }
  }

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold text-ink flex items-center gap-2">Finances <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-700 inline-flex items-center gap-1"><Crown size={10} />Owner only</span></h1>
          <p className="text-sm text-slate-500 mt-0.5">Haven Premium is {fmtMoney(price)} a month (set on the Haven Premium page). Revenue numbers here are estimates until payments are connected.</p>
        </div>
      </div>
      {error && <div className="mb-4 rounded-xl border border-red-600/40 bg-red-100/20 px-3 py-2 text-sm text-red-600">{error}</div>}

      {/* Revenue */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Tile label="Paying users" value={stats === undefined ? '…' : fmtPct(accounts ? paid / accounts : 0)} sub={`${fmtInt(paid)} Premium of ${fmtInt(accounts)} accounts`} />
        <Tile label="Monthly revenue (est.)" value={fmtMoney(netMonthly)} sub={`${fmtMoney(grossMonthly)} before Apple’s ${fmtPct(APPLE_CUT, 0)}`} />
        <Tile label="Costs this month" value={costs ? fmtMoney(costNow) : '…'} sub={`${fmtMoney(lastMonth)} last month`} />
        <Tile
          label="Profit this month (est.)"
          value={costs ? fmtMoney(netMonthly - costNow) : '…'}
          sub={freePremium ? `${fmtInt(freePremium)} Creators & Staff get Premium free` : 'Revenue (est.) minus costs'}
          delta={costs ? { text: netMonthly - costNow >= 0 ? 'In profit' : 'Costs more than it earns', good: netMonthly - costNow >= 0 } : undefined}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-3 mb-6">
        {[
          { icon: CreditCard, title: 'Subscriptions & revenue by month', text: 'Real charges, refunds and renewals — from Apple and Stripe once Haven Premium payments are built.' },
          { icon: Clock, title: 'How long people stay subscribed', text: 'Average months subscribed and how many renew each month — from the payment records.' },
          { icon: MessageSquareWarning, title: 'Why people cancel', text: 'A short reason asked when someone cancels, counted here — built with the cancel flow.' },
        ].map(({ icon: Icon, title, text }) => (
          <div key={title} className="card-glass p-4 border-dashed">
            <div className="flex items-center gap-2 text-sm font-bold text-ink"><Icon size={15} className="text-slate-500" />{title}</div>
            <p className="text-xs text-slate-500 mt-1.5">{text}</p>
            <span className="inline-block mt-2 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-800 text-slate-500">Connects with payments</span>
          </div>
        ))}
      </div>

      {/* Costs */}
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <h2 className="text-lg font-bold text-ink flex items-center gap-2"><Receipt size={18} />Costs</h2>
        <label className="flex items-center gap-2 text-xs text-slate-500 cursor-pointer select-none" title="Off: a yearly bill counts in full in the month it's charged (what leaves the bank)">
          <input type="checkbox" checked={spread} onChange={(e) => setSpread(e.target.checked)} className="accent-violet-600" />
          Spread yearly bills across 12 months
        </label>
        <button
          onClick={() => setEditing({ id: '', name: '', category: 'Hosting', amount: 0, cadence: 'monthly', start: thisMonth })}
          className="ml-auto btn-primary"
        >
          <Plus size={15} />Add a cost
        </button>
      </div>

      {!costs ? (
        <div className="flex justify-center py-12"><Loader2 size={22} className="animate-spin text-slate-500" /></div>
      ) : costs.length === 0 ? (
        <Empty>No costs yet. Add each bill — Vercel, Firebase, the Apple Developer Program, your domain, AI tools — and this tracks them every month.</Empty>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Tile label={`This month · ${monthLabel(thisMonth, true)}`} value={fmtMoney(costNow)} delta={lastMonth ? { text: `${costNow >= lastMonth ? '+' : ''}${fmtMoney(costNow - lastMonth)} vs last month`, good: costNow <= lastMonth } : undefined} />
            <Tile label={`So far in ${thisMonth.slice(0, 4)}`} value={fmtMoney(ytd)} />
            <Tile label="Average month (12 mo)" value={fmtMoney(months.reduce((s, m) => s + monthTotal(m), 0) / 12)} />
            <Tile label="Per account this month" value={accounts ? fmtMoney(costNow / accounts) : '—'} sub="What each account costs to run" />
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Panel title="Costs by month" sub={spread ? 'Yearly bills spread over 12 months' : 'Yearly bills in the month they’re charged'}>
              <TimeBars
                data={months.map((m) => {
                  const row: Record<string, unknown> = { label: monthLabel(m) }
                  for (const cat of COST_CATEGORIES) row[cat] = Math.round(costs.filter((c) => c.category === cat).reduce((s, c) => s + costIn(c, m, spread), 0) * 100) / 100
                  return row
                })}
                series={COST_CATEGORIES.filter((cat) => costs.some((c) => c.category === cat)).map((cat) => ({ key: cat, name: cat, color: CATEGORY_COLORS[cat] }))}
                format={(n) => `$${fmtInt(n)}`}
              />
            </Panel>
            <Panel title="Where the money goes" sub={`${monthLabel(thisMonth, true)}`}>
              <RankBars
                items={COST_CATEGORIES.map((cat) => ({ cat, n: costs.filter((c) => c.category === cat).reduce((s, c) => s + costIn(c, thisMonth, spread), 0) }))
                  .filter((x) => x.n > 0).sort((a, b) => b.n - a.n)
                  .map(({ cat, n }) => ({ key: cat, label: cat, value: n, color: CATEGORY_COLORS[cat] }))}
                format={(n) => `${fmtMoney(n)} · ${costNow ? fmtPct(n / costNow, 0) : '0%'}`}
                empty="Nothing charged this month."
              />
            </Panel>
          </div>

          <div className="card-glass overflow-hidden">
            <div className="hidden md:grid grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_110px_100px_150px_70px] gap-3 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-800">
              <span>Cost</span><span>Category</span><span>Amount</span><span>How often</span><span>Running</span><span />
            </div>
            {[...costs].sort((a, b) => Number(!!a.end && a.end < thisMonth) - Number(!!b.end && b.end < thisMonth) || b.amount - a.amount).map((c) => {
              const stopped = !!c.end && c.end < thisMonth
              return (
                <div key={c.id} className={cn('grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_110px_100px_150px_70px] items-center gap-x-3 gap-y-1 px-4 py-3 border-b border-slate-800/60 last:border-0', stopped && 'opacity-55')}>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-ink truncate">{c.name}</div>
                    {c.note && <div className="text-[11px] text-slate-500 truncate">{c.note}</div>}
                  </div>
                  <div className="hidden md:flex items-center gap-1.5 text-xs text-slate-400"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: CATEGORY_COLORS[c.category] }} />{c.category}</div>
                  <div className="hidden md:block text-sm font-semibold text-ink tabular-nums">{fmtMoney(c.amount)}</div>
                  <div className="hidden md:block text-xs text-slate-400">{CADENCE_LABEL[c.cadence]}</div>
                  <div className="hidden md:block text-xs text-slate-400">{c.cadence === 'once' ? monthLabel(c.start, true) : `${monthLabel(c.start)} → ${c.end ? monthLabel(c.end) : 'now'}`}</div>
                  <div className="flex items-center justify-end gap-1">
                    <span className="md:hidden text-sm font-semibold text-ink mr-1">{fmtMoney(c.amount)}<span className="text-[10px] text-slate-500 font-normal"> {c.cadence === 'once' ? 'once' : c.cadence === 'yearly' ? '/yr' : '/mo'}</span></span>
                    <button onClick={() => setEditing(c)} className="p-1.5 rounded-lg text-slate-500 hover:text-ink hover:bg-slate-800" aria-label={`Edit ${c.name}`}><Pencil size={14} /></button>
                    <button
                      onClick={() => { if (confirm(`Delete “${c.name}”? It leaves every month's totals, past ones too. (To stop a cost but keep its history, edit it and set a last month.)`)) persist(costs.filter((x) => x.id !== c.id)) }}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-100/30" aria-label={`Delete ${c.name}`}
                    ><Trash2 size={14} /></button>
                  </div>
                </div>
              )
            })}
          </div>
          <p className="text-[11px] text-slate-500 flex items-center gap-1.5"><TrendingUp size={12} />Firebase and Vercel bills change with use — update their amount each month, or add each month’s bill as a one-off.</p>
        </div>
      )}

      {editing && (
        <CostEditor
          item={editing}
          onClose={() => setEditing(null)}
          onSave={(item) => {
            const list = costs ?? []
            const next = item.id && list.some((x) => x.id === item.id)
              ? list.map((x) => (x.id === item.id ? item : x))
              : [...list, { ...item, id: crypto.randomUUID() }]
            persist(next)
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

function CostEditor({ item, onClose, onSave }: { item: CostItem; onClose: () => void; onSave: (c: CostItem) => void }) {
  const [c, setC] = useState(item)
  const [amount, setAmount] = useState(item.amount ? String(item.amount) : '')
  const [error, setError] = useState('')
  const patch = (p: Partial<CostItem>) => setC((x) => ({ ...x, ...p }))

  function save() {
    const n = parseFloat(amount)
    if (!c.name.trim()) return setError('Give the cost a name.')
    if (!(n > 0)) return setError('Enter what it costs.')
    if (c.end && c.end < c.start) return setError('The last month can’t be before the first.')
    onSave({ ...c, name: c.name.trim(), amount: Math.round(n * 100) / 100, note: c.note?.trim() || undefined, end: c.cadence === 'once' ? undefined : c.end || undefined })
  }

  return (
    <StaffModal onClose={onClose} className="max-w-lg">
      <div className="p-5 md:p-6">
        <div className="flex items-center mb-4">
          <h2 className="text-lg font-bold text-ink">{item.id ? 'Edit cost' : 'Add a cost'}</h2>
          <button onClick={onClose} className="ml-auto p-1.5 rounded-lg text-slate-500 hover:text-ink hover:bg-slate-800"><X size={16} /></button>
        </div>
        <div className="grid gap-3">
          <label><span className="field-label">Name</span><input autoFocus className="input-field" value={c.name} onChange={(e) => patch({ name: e.target.value })} placeholder="e.g. Vercel Pro" /></label>
          <div className="grid grid-cols-2 gap-3">
            <label><span className="field-label">Amount (USD)</span><input className="input-field" type="number" min={0} step={0.01} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="20.00" /></label>
            <label><span className="field-label">How often</span>
              <select className="input-field" value={c.cadence} onChange={(e) => patch({ cadence: e.target.value as Cadence })}>
                <option value="monthly">Every month</option><option value="yearly">Once a year</option><option value="once">One-off</option>
              </select>
            </label>
          </div>
          <label><span className="field-label">Category</span>
            <select className="input-field" value={c.category} onChange={(e) => patch({ category: e.target.value as CostCategory })}>
              {COST_CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label><span className="field-label">{c.cadence === 'once' ? 'Month' : c.cadence === 'yearly' ? 'First charged (renews this month)' : 'First month'}</span><input className="input-field" type="month" value={c.start} onChange={(e) => patch({ start: e.target.value })} /></label>
            {c.cadence !== 'once' && (
              <label><span className="field-label">Last month (if it stopped)</span><input className="input-field" type="month" value={c.end ?? ''} onChange={(e) => patch({ end: e.target.value || undefined })} /></label>
            )}
          </div>
          <label><span className="field-label">Note (optional)</span><input className="input-field" value={c.note ?? ''} onChange={(e) => patch({ note: e.target.value })} placeholder="e.g. Blaze plan, billed on the 3rd" /></label>
        </div>
        <div className="flex items-center gap-2 justify-end mt-5">
          {error && <span className="text-xs text-red-600 mr-auto">{error}</span>}
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={save} className="btn-primary"><Check size={15} />Save</button>
        </div>
      </div>
    </StaffModal>
  )
}
