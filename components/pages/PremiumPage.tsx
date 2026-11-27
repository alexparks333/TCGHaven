'use client'

import { useEffect, useState } from 'react'
import { Check, Loader2, Minus } from 'lucide-react'
import { authFetch } from '@/lib/firebase/authFetch'
import { useAuth } from '@/components/auth/AuthProvider'
import { usePremiumAccess } from '@/components/premium/PremiumProvider'
import { PremiumOffer } from '@/components/premium/PremiumSheet'
import { FREE_SCANS_PER_MONTH } from '@/lib/premiumRules'

// /premium — Haven Premium's page (2026-11-27): what's free and what Premium adds, side by side, then the
// plans and the buy button (PremiumOffer — the same as the Premium sheet's). Also where Stripe Checkout
// sends people back (/premium?checkout={session id}): the purchase is confirmed with the server
// (POST /api/premium/refresh), which unlocks Premium straight away.

const GOLD = '#b8862b'

/** What each plan gets — keep in step with docs/premium-business.md and the locks themselves */
const ROWS: Array<{ label: string; free: string | boolean; premium: string | boolean }> = [
  { label: 'Inventory, Cardex & search', free: true, premium: true },
  { label: 'Card prices — raw and graded (PSA, BGS, CGC…)', free: true, premium: true },
  { label: 'Friends, profiles & communities', free: true, premium: true },
  { label: 'Haven Badges — full colour & 3D pins', free: true, premium: true },
  { label: 'Card scans', free: `${FREE_SCANS_PER_MONTH} a month`, premium: 'Unlimited' },
  { label: 'Pins on your profile banner', free: '1', premium: '3' },
  { label: 'Pin Display spots', free: '4', premium: '8' },
  { label: 'Price history for every card', free: false, premium: true },
  { label: 'Portfolio over time, profit & analytics', free: 'Today’s value', premium: true },
  { label: 'Export your collection', free: false, premium: true },
  { label: 'The gold Premium tag', free: false, premium: true },
]

function Cell({ v, gold }: { v: string | boolean; gold?: boolean }) {
  if (v === true) return <Check size={17} className="mx-auto" style={{ color: gold ? GOLD : '#6f8a4c' }} />
  if (v === false) return <Minus size={15} className="mx-auto text-slate-600" />
  return <span className={gold ? 'font-semibold text-ink' : 'text-slate-400'}>{v}</span>
}

export default function PremiumPage() {
  const { user } = useAuth()
  const { member } = usePremiumAccess()
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

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="text-center pt-2 pb-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="" className="mx-auto mb-2 h-24 w-24 object-contain drop-shadow-md" />
        <h1 className="text-3xl font-bold text-ink">{member ? 'You have Haven Premium' : 'Haven Premium'}</h1>
        <p className="mt-1.5 text-slate-400">
          {member ? 'Thank you for supporting TCG Haven — everything below is yours.' : 'Everything TCG Haven can do, for the price of a booster pack a month.'}
        </p>
        {state === 'confirming' && <p className="mt-4 flex items-center justify-center gap-2 text-sm text-slate-400"><Loader2 size={15} className="animate-spin" />Confirming your purchase…</p>}
        {state === 'done' && <p className="mt-4 text-sm font-semibold text-emerald-700">{member ? 'Welcome to Haven Premium — everything is unlocked.' : 'Payment received — unlocking now, this takes a moment.'}</p>}
        {state === 'failed' && <p className="mt-4 text-sm text-slate-400">Your payment went through, but we couldn’t confirm it yet. It will unlock within a few minutes — refresh this page if it doesn’t.</p>}
      </div>

      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_20rem] items-start">
        {/* Free vs Premium */}
        <div className="card-glass p-0 overflow-hidden">
          <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem] sm:grid-cols-[minmax(0,1fr)_7rem_7rem] items-center px-4 sm:px-5 py-3 border-b border-slate-800 text-xs font-bold uppercase tracking-wider text-slate-500">
            <span>What you get</span>
            <span className="text-center">Free</span>
            <span className="text-center" style={{ color: GOLD }}>Premium</span>
          </div>
          <ul className="divide-y divide-slate-800">
            {ROWS.map((r) => (
              <li key={r.label} className="grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem] sm:grid-cols-[minmax(0,1fr)_7rem_7rem] items-center px-4 sm:px-5 py-3 text-sm">
                <span className="text-ink pr-3">{r.label}</span>
                <span className="text-center text-xs sm:text-sm"><Cell v={r.free} /></span>
                <span className="text-center text-xs sm:text-sm"><Cell v={r.premium} gold /></span>
              </li>
            ))}
          </ul>
        </div>

        {/* Plans and the buy button — or, with Premium, what you have and Manage subscription */}
        <div className="card-glass p-5 md:sticky md:top-6">
          <h2 className="text-sm font-bold text-ink mb-3">{member ? 'Your Premium' : 'Choose your plan'}</h2>
          {user ? <PremiumOffer /> : (
            <a href="/login?next=/premium" className="btn-primary w-full justify-center">Sign in to get Premium</a>
          )}
        </div>
      </div>
    </div>
  )
}
