'use client'

import { useEffect, useState } from 'react'
import { Check, Loader2, Minus, Crown } from 'lucide-react'
import { authFetch } from '@/lib/firebase/authFetch'
import { useAuth } from '@/components/auth/AuthProvider'
import { usePremiumAccess } from '@/components/premium/PremiumProvider'
import { PremiumOffer } from '@/components/premium/PremiumSheet'
import { FREE_SCANS_PER_MONTH } from '@/lib/premiumRules'
import { useAccountRole, titleLabel } from '@/lib/accountRoles'

// /premium — Haven Premium's page (2026-11-27): your current tier, then the two plans side by side —
// Free on the left, Premium on the right — each with its price and button, then its checklist (Free's
// shows what Premium adds as grey dashes, so the two compare at a glance). Premium's buy / manage part is
// PremiumOffer, the same as the Premium sheet's. Also where Stripe Checkout sends people back
// (/premium?checkout={session id}): the purchase is confirmed with the server (POST /api/premium/refresh).

const GOLD = '#b8862b'

/** Keep in step with docs/premium-business.md and the locks themselves */
const FREE_LIST: Array<{ label: string; on: boolean }> = [
  { label: 'Inventory, Cardex & search', on: true },
  { label: 'Card prices — raw and graded (PSA, BGS, CGC…)', on: true },
  { label: 'Friends, profiles & communities', on: true },
  { label: 'Haven Badges — full colour & 3D pins', on: true },
  { label: `${FREE_SCANS_PER_MONTH} card scans a month`, on: true },
  { label: '1 banner pin · 4 Pin Display spots', on: true },
  { label: 'Your collection’s value today', on: true },
  { label: 'Price history', on: false },
  { label: 'Portfolio over time, profit & analytics', on: false },
  { label: 'Export your collection', on: false },
  { label: 'The gold Premium tag', on: false },
]
const PREMIUM_LIST: Array<{ strong: string; rest?: string }> = [
  { strong: 'Unlimited card scans' },
  { strong: '3 banner pins', rest: ' · 8 Pin Display spots' },
  { strong: 'Price history', rest: ' for every card' },
  { strong: 'Portfolio over time', rest: ', profit & analytics' },
  { strong: 'Export', rest: ' your collection' },
  { strong: 'The gold Premium tag', rest: ' by your name' },
]

function Tick({ on, gold }: { on: boolean; gold?: boolean }) {
  return on
    ? <Check size={17} strokeWidth={2.5} className="shrink-0 mt-[2px]" style={{ color: gold ? GOLD : '#6f8a4c' }} />
    : <Minus size={16} className="shrink-0 mt-[3px] text-slate-600" />
}

function YourPlan() {
  return <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-0.5 text-[0.6875rem] font-bold uppercase tracking-wider text-white" style={{ background: GOLD }}>Your plan</span>
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
  const how = member ? (paidWay ?? `Included with your ${titleLabel(role)} account`) : 'Collecting is free — upgrade whenever you want more.'
  const onFree = loaded && !member
  const onPremium = loaded && member

  return (
    <div className="max-w-4xl mx-auto pb-10">
      {/* ── Your current tier ── */}
      <section className="card-glass px-5 py-4 mb-10 flex flex-col sm:flex-row items-center gap-3 sm:gap-4 text-center sm:text-left">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="" className="h-12 w-12 object-contain drop-shadow-md shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-slate-500">Your current tier</div>
          <div className="mt-0.5 flex items-center justify-center sm:justify-start gap-2 flex-wrap">
            {!loaded ? <Loader2 size={16} className="animate-spin text-slate-500" /> : member ? (
              <span className="inline-flex items-center gap-1.5 text-lg font-bold text-ink"><Crown size={17} style={{ color: GOLD }} />Haven Premium</span>
            ) : <span className="text-lg font-bold text-ink">Free</span>}
            <span className="text-sm text-slate-400">· {how}</span>
          </div>
          {state === 'confirming' && <p className="mt-1.5 flex items-center justify-center sm:justify-start gap-2 text-sm text-slate-400"><Loader2 size={14} className="animate-spin" />Confirming your purchase…</p>}
          {state === 'done' && <p className="mt-1.5 text-sm font-semibold text-emerald-700">{member ? 'Welcome to Haven Premium — everything is unlocked.' : 'Payment received — unlocking now, this takes a moment.'}</p>}
          {state === 'failed' && <p className="mt-1.5 text-sm text-slate-400">Your payment went through, but we couldn’t confirm it yet. It will unlock within a few minutes — refresh this page if it doesn’t.</p>}
        </div>
      </section>

      {/* ── The two plans, side by side ── */}
      <div className="grid gap-6 md:grid-cols-2 items-stretch">
        {/* Free */}
        <section className="relative card-glass p-6 sm:p-7 flex flex-col" style={onFree ? { borderColor: GOLD } : undefined}>
          {onFree && <YourPlan />}
          <h2 className="text-3xl font-bold text-ink pinbook-serif">Free</h2>
          <p className="mt-1 text-slate-400">Collect, price and show off</p>
          <div className="mt-5 text-3xl font-bold text-ink tabular-nums">$0</div>
          <p className="text-sm text-slate-500">Free for everyone, forever</p>
          <div className="mt-6 min-h-[3rem]">
            {onFree
              ? <div className="w-full rounded-xl py-3 text-center text-sm font-semibold text-slate-400 border border-slate-800 bg-slate-950/40">Your current plan</div>
              : !user ? <a href="/signup" className="btn-secondary w-full justify-center">Sign up free</a> : null}
          </div>
          <div className="my-6 border-t border-slate-800" />
          <ul className="flex flex-col gap-3">
            {FREE_LIST.map((f) => (
              <li key={f.label} className={`flex items-start gap-2.5 text-sm ${f.on ? 'text-ink' : 'text-slate-500'}`}>
                <Tick on={f.on} />{f.label}
              </li>
            ))}
          </ul>
        </section>

        {/* Premium */}
        <section className="relative card-glass p-6 sm:p-7 flex flex-col" style={{ borderColor: onPremium ? GOLD : 'rgba(184,134,43,0.45)', background: 'rgba(184,134,43,0.05)' }}>
          {onPremium && <YourPlan />}
          <h2 className="text-3xl font-bold text-ink pinbook-serif flex items-center gap-2"><Crown size={24} style={{ color: GOLD }} />Premium</h2>
          <p className="mt-1 text-slate-400">For collectors going further</p>
          {/* prices, the plan choice and the buy / manage buttons — the same as the Premium sheet's */}
          <div className="mt-5">
            {user ? <PremiumOffer /> : <a href="/login?next=/premium" className="btn-primary w-full justify-center">Sign in to get Premium</a>}
          </div>
          <div className="my-6 border-t border-slate-800" />
          <p className="text-sm font-bold text-ink mb-3">Everything in Free, plus:</p>
          <ul className="flex flex-col gap-3">
            {PREMIUM_LIST.map((f) => (
              <li key={f.strong} className="flex items-start gap-2.5 text-sm text-ink">
                <Tick on gold /><span><b>{f.strong}</b>{f.rest}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
