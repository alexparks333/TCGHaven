'use client'

import { useEffect, useState } from 'react'
import { Check, Loader2, Minus, Crown, BookOpen, ScanLine, Sparkles, LineChart, Users } from 'lucide-react'
import { authFetch } from '@/lib/firebase/authFetch'
import { useAuth } from '@/components/auth/AuthProvider'
import { usePremiumAccess } from '@/components/premium/PremiumProvider'
import { PremiumOffer } from '@/components/premium/PremiumSheet'
import { FREE_SCANS_PER_MONTH } from '@/lib/premiumRules'
import { useAccountRole, titleLabel } from '@/lib/accountRoles'

// /premium — Haven Premium's page (2026-11-27). Top: your current tier, and what to do next. Centre:
// what's free and what Premium adds, in sections. Bottom: the plans and the buy button (PremiumOffer —
// the same as the Premium sheet's). Also where Stripe Checkout sends people back
// (/premium?checkout={session id}): the purchase is confirmed with the server (POST /api/premium/refresh).

const GOLD = '#b8862b'
const GOLD_WASH = 'rgba(184,134,43,0.08)'

type Value = string | boolean
/** What each plan gets — keep in step with docs/premium-business.md and the locks themselves */
const SECTIONS: Array<{ title: string; icon: typeof Crown; rows: Array<{ label: string; free: Value; premium: Value }> }> = [
  {
    title: 'Collect & price', icon: BookOpen, rows: [
      { label: 'Inventory, Cardex & search', free: true, premium: true },
      { label: 'Card prices — raw and graded (PSA, BGS, CGC…)', free: true, premium: true },
    ],
  },
  {
    title: 'Scanning', icon: ScanLine, rows: [
      { label: 'Card scans', free: `${FREE_SCANS_PER_MONTH} a month`, premium: 'Unlimited' },
    ],
  },
  {
    title: 'Show off', icon: Sparkles, rows: [
      { label: 'Haven Badges — full colour & 3D pins', free: true, premium: true },
      { label: 'Pins on your profile banner', free: '1', premium: '3' },
      { label: 'Pin Display spots', free: '4', premium: '8' },
      { label: 'The gold Premium tag by your name', free: false, premium: true },
    ],
  },
  {
    title: 'Track your collection', icon: LineChart, rows: [
      { label: 'Price history for every card', free: false, premium: true },
      { label: 'Portfolio over time, profit & analytics', free: 'Today’s value', premium: true },
      { label: 'Export your collection', free: false, premium: true },
    ],
  },
  {
    title: 'Friends & community', icon: Users, rows: [
      { label: 'Friends, profiles & communities', free: true, premium: true },
    ],
  },
]

const GRID = 'grid grid-cols-[minmax(0,1fr)_5rem_6rem] sm:grid-cols-[minmax(0,1fr)_7.5rem_8.5rem] items-center'

function Cell({ v, premium }: { v: Value; premium?: boolean }) {
  if (v === true) return <Check size={18} strokeWidth={2.5} className="mx-auto" style={{ color: premium ? GOLD : '#6f8a4c' }} />
  if (v === false) return <Minus size={16} className="mx-auto text-slate-600" />
  return <span className={premium ? 'font-bold text-ink' : 'text-slate-400'}>{v}</span>
}

export default function PremiumPage() {
  const { user } = useAuth()
  const { member, entitlement, loaded } = usePremiumAccess()
  const role = useAccountRole(user?.uid).record
  const [state, setState] = useState<'idle' | 'confirming' | 'done' | 'failed'>('idle')

  // Back from Stripe Checkout: confirm the purchase
  useEffect(() => {
    if (!user) return
    const checkout = new URLSearchParams(window.location.search).get('checkout')
    if (!checkout) return
    window.history.replaceState(null, '', '/premium')
    setState('confirming')
    authFetch('/api/premium/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ checkout }) })
      .then((r) => setState(r.ok ? 'done' : 'failed'))
      .catch(() => setState('failed'))
  }, [user])

  // How you have it: a subscription, a code, or your title (Creator / Staff / Owner)
  const paidWay = entitlement?.active
    ? entitlement.source === 'permanent' ? 'Yours for good'
      : entitlement.expiresAt ? `${entitlement.willRenew ? 'Renews' : 'Ends'} ${new Date(entitlement.expiresAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}${entitlement.trial ? ' · free trial' : ''}`
      : 'Active'
    : null
  const how = member ? (paidWay ?? `Included with your ${titleLabel(role)} account`) : 'Everything you need to collect, free — upgrade when you want more.'

  return (
    <div className="max-w-3xl mx-auto pb-10">
      {/* ── Your current tier ── */}
      <section className="card-glass p-5 sm:p-6 mb-8 flex flex-col sm:flex-row sm:items-center gap-4"
        style={member ? { borderColor: 'rgba(184,134,43,0.45)' } : undefined}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="" className="h-16 w-16 object-contain drop-shadow-md shrink-0 mx-auto sm:mx-0" />
        <div className="min-w-0 flex-1 text-center sm:text-left">
          <div className="text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-slate-500">Your current tier</div>
          <div className="mt-1 flex items-center justify-center sm:justify-start gap-2">
            {loaded ? (
              member ? (
                <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-bold text-[#4a3412]" style={{ background: 'rgba(184,134,43,0.18)', border: '1px solid rgba(184,134,43,0.5)' }}>
                  <Crown size={15} style={{ color: GOLD }} />Haven Premium
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full px-3 py-1 text-sm font-bold text-ink border border-slate-700 bg-slate-950/60">Free</span>
              )
            ) : <Loader2 size={16} className="animate-spin text-slate-500" />}
          </div>
          <p className="mt-1.5 text-sm text-slate-400">{how}</p>
          {state === 'confirming' && <p className="mt-2 flex items-center justify-center sm:justify-start gap-2 text-sm text-slate-400"><Loader2 size={14} className="animate-spin" />Confirming your purchase…</p>}
          {state === 'done' && <p className="mt-2 text-sm font-semibold text-emerald-700">{member ? 'Welcome to Haven Premium — everything is unlocked.' : 'Payment received — unlocking now, this takes a moment.'}</p>}
          {state === 'failed' && <p className="mt-2 text-sm text-slate-400">Your payment went through, but we couldn’t confirm it yet. It will unlock within a few minutes — refresh this page if it doesn’t.</p>}
        </div>
        {!member && loaded && (
          <a href="#plans" className="shrink-0 inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold text-white" style={{ background: GOLD }}>
            <Crown size={15} />Get Premium
          </a>
        )}
      </section>

      {/* ── What you get — the centrepiece ── */}
      <div className="text-center mb-5">
        <h1 className="text-2xl sm:text-3xl font-bold text-ink">What you get</h1>
        <p className="mt-1 text-sm text-slate-400">Collecting is free. Premium is for going further.</p>
      </div>

      {/* column heads, once, over every section */}
      <div className={`${GRID} px-4 sm:px-5 mb-2 text-[0.6875rem] font-bold uppercase tracking-[0.14em]`}>
        <span />
        <span className="text-center text-slate-500">Free</span>
        <span className="text-center flex items-center justify-center gap-1" style={{ color: GOLD }}><Crown size={12} />Premium</span>
      </div>

      <div className="flex flex-col gap-4">
        {SECTIONS.map(({ title, icon: Icon, rows }) => (
          <section key={title} className="card-glass p-0 overflow-hidden">
            <div className="flex items-center gap-2 px-4 sm:px-5 py-2.5 border-b border-slate-800 bg-slate-950/40">
              <Icon size={15} style={{ color: GOLD }} />
              <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">{title}</h2>
            </div>
            <ul className="divide-y divide-slate-800">
              {rows.map((r) => (
                <li key={r.label} className={`${GRID} text-sm`}>
                  <span className="px-4 sm:px-5 py-3.5 text-ink">{r.label}</span>
                  <span className="py-3.5 text-center text-xs sm:text-sm"><Cell v={r.free} /></span>
                  {/* the Premium column, washed gold top to bottom */}
                  <span className="self-stretch flex items-center justify-center py-3.5 text-xs sm:text-sm" style={{ background: GOLD_WASH }}><Cell v={r.premium} premium /></span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {/* ── Plans / your subscription ── */}
      <section id="plans" className="mt-10 scroll-mt-6">
        <div className="text-center mb-4">
          <h2 className="text-xl font-bold text-ink">{member ? 'Your Premium' : 'Choose your plan'}</h2>
          {!member && <p className="mt-1 text-sm text-slate-400">For the price of a booster pack a month. Cancel anytime.</p>}
        </div>
        <div className="card-glass p-5 sm:p-6 max-w-md mx-auto">
          {user ? <PremiumOffer /> : (
            <a href="/login?next=/premium" className="btn-primary w-full justify-center">Sign in to get Premium</a>
          )}
        </div>
      </section>
    </div>
  )
}
