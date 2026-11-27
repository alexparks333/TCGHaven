'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Award, Check, Download, LineChart, Loader2, ScanLine, Sparkles, Tag, X } from 'lucide-react'
import { useAuth } from '@/components/auth/AuthProvider'
import { db } from '@/lib/firebase/config'
import { loadPremiumConfig, yearlySaving, DEFAULT_PREMIUM, type PremiumConfig } from '@/lib/premium'
import { FREE_SCANS_PER_MONTH } from '@/lib/premiumRules'
import { buyPremium, canBuyHere, manageSubscription, restorePremium, type Plan } from '@/lib/premiumPurchase'
import { inApp } from '@/lib/nativeApp'
import { authFetch } from '@/lib/firebase/authFetch'
import { usePremiumAccess, type PremiumReason } from './PremiumProvider'

// The Haven Premium sheet: what it unlocks, the two plans, and the buy / restore / manage buttons.
// Opened with usePremiumAccess().openPremium(reason) — the headline speaks to what they just tried.

const GOLD = '#b8862b'

const HEADLINES: Record<PremiumReason, { title: string; sub: string }> = {
  general: { title: 'Haven Premium', sub: 'Everything TCG Haven can do, for the price of a booster pack a month.' },
  'scan-limit': { title: 'Keep scanning', sub: `You’ve used this month’s ${FREE_SCANS_PER_MONTH} free scans. Premium scans as many cards as you can lay down.` },
  graded: { title: 'See how prices have moved', sub: 'Every card’s price history, by day — and your slabs’ graded history too.' },
  'badge-full': { title: 'Show off more of your pins', sub: 'Badges are free for everyone — Premium shows up to 3 pins on your profile banner.' },
  'portfolio-time': { title: 'Watch your collection grow', sub: 'Your collection’s value over time, profit and loss, and analytics.' },
  'pin-display': { title: 'Show 3 pins on your banner', sub: 'Free profiles show one pin on their banner. Premium shows up to three.' },
  export: { title: 'Take your collection anywhere', sub: 'Export your whole collection as a spreadsheet.' },
}

const FEATURES: Array<{ icon: typeof ScanLine; label: string; reason: PremiumReason }> = [
  { icon: ScanLine, label: 'Unlimited card scans', reason: 'scan-limit' },
  { icon: Award, label: 'Price history for every card', reason: 'graded' },
  { icon: Sparkles, label: 'Up to 3 banner pins and 8 Pin Display spots (1 and 4 free)', reason: 'pin-display' },
  { icon: LineChart, label: 'Portfolio over time, profit & analytics', reason: 'portfolio-time' },
  { icon: Download, label: 'Export your collection', reason: 'export' },
  { icon: Tag, label: 'The gold Premium tag next to your name', reason: 'general' },
]

const money = (n: number) => `$${n.toFixed(2)}`

export function PremiumSheet({ reason, onClose }: { reason: PremiumReason; onClose: () => void }) {
  const { member } = usePremiumAccess()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const head = member ? { title: 'You have Haven Premium', sub: 'Thank you for supporting TCG Haven.' } : HEADLINES[reason]

  return (
    <div className="fixed inset-0 z-[70] flex items-end md:items-center justify-center md:p-4" role="dialog" aria-modal="true" aria-label={head.title}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="add-card-panel relative w-full md:max-w-[28rem] max-h-[92dvh] overflow-y-auto bg-slate-900 border border-slate-800 rounded-t-3xl md:rounded-2xl shadow-xl">
        <div className="relative px-6 pt-7 pb-5 text-center" style={{ background: 'linear-gradient(180deg, rgba(184,134,43,0.16), rgba(184,134,43,0))' }}>
          <button onClick={onClose} aria-label="Close" className="absolute right-3 top-3 p-2 rounded-full text-slate-500 hover:text-ink hover:bg-slate-800/60"><X size={18} /></button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" className="mx-auto mb-2 h-20 w-20 object-contain drop-shadow-md" />
          <h2 className="text-xl font-bold text-ink">{head.title}</h2>
          <p className="mt-1 text-sm text-slate-400">{head.sub}</p>
        </div>

        <div className="px-6 pb-6">
          <ul className="flex flex-col gap-2.5 mb-5">
            {FEATURES.map(({ icon: Icon, label, reason: r }) => (
              <li key={label} className="flex items-center gap-3 text-sm text-ink">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ background: r === reason && !member ? GOLD : 'rgba(184,134,43,0.14)', color: r === reason && !member ? '#fff' : GOLD }}>
                  <Icon size={15} />
                </span>
                <span className={r === reason && !member ? 'font-semibold' : ''}>{label}</span>
              </li>
            ))}
          </ul>
          <PremiumOffer onBought={onClose} />
          {/* the full page: free vs Premium side by side (components/pages/PremiumPage.tsx) — a real button
              when you already have it (2026-11-27), a small link under the buy button when you don't */}
          {member ? (
            <Link href="/premium" onClick={onClose}
              className="mt-3 w-full flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-ink border border-slate-800 bg-slate-950/60 hover:border-[#b8862b]/60 transition-colors">
              <Check size={16} style={{ color: GOLD }} />You own Premium · Go to the Premium page
            </Link>
          ) : (
            <Link href="/premium" onClick={onClose} className="mt-3 block text-center text-xs font-medium text-slate-500 hover:text-ink underline underline-offset-2">
              See everything Premium includes
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}

/** The plans and the buy / restore / manage buttons, a promo code (website) and the small print — the same
 *  in the Premium sheet and on the Premium page. `onBought`: called after a purchase in the app.
 *  `plan`: chosen outside (the Premium page's Monthly / Yearly switch) — then its own plan cards aren't shown. */
export function PremiumOffer({ onBought, plan: chosen }: { onBought?: () => void; plan?: Plan }) {
  const { user } = useAuth()
  const { member, entitlement } = usePremiumAccess()
  const [config, setConfig] = useState<PremiumConfig>(DEFAULT_PREMIUM)
  const [ownPlan, setPlan] = useState<Plan>('yearly')
  const plan = chosen ?? ownPlan
  const [busy, setBusy] = useState<'buy' | 'restore' | 'manage' | null>(null)
  const [error, setError] = useState('')
  const app = inApp()

  useEffect(() => { loadPremiumConfig(db).then((c) => { setConfig(c); if (!c.yearlyOn) setPlan('monthly') }) }, [])
  const saving = yearlySaving(config)

  async function run(kind: 'buy' | 'restore' | 'manage') {
    if (!user) return
    setBusy(kind); setError('')
    const r = kind === 'buy' ? await buyPremium(user.uid, plan)
      : kind === 'restore' ? await restorePremium(user.uid)
      : await manageSubscription(entitlement?.source ?? null)
    setBusy(null)
    if (!r.ok && !r.cancelled) setError(r.error ?? 'Something went wrong.')
    if (r.ok && kind !== 'manage' && app) onBought?.()
  }

  return (
    <>
          {member ? (
            <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-400">
              {entitlement?.active && entitlement.expiresAt ? (
                <p>{entitlement.willRenew ? 'Renews' : 'Ends'} on <b className="text-ink">{new Date(entitlement.expiresAt).toLocaleDateString()}</b>{entitlement.trial ? ' (free trial)' : ''}.</p>
              ) : entitlement?.source === 'permanent' ? <p>Yours for good.</p> : <p>Included with your account.</p>}
              {entitlement?.active && (entitlement.source === 'stripe' || entitlement.source === 'apple' || entitlement.source === 'google') && (
                <button onClick={() => run('manage')} disabled={!!busy} className="btn-secondary mt-3 w-full justify-center">
                  {busy === 'manage' && <Loader2 size={15} className="animate-spin" />}Manage subscription
                </button>
              )}
            </div>
          ) : (
            <>
              {!chosen && <div className={`grid gap-2.5 ${config.yearlyOn ? 'grid-cols-2' : 'grid-cols-1'}`}>
                {config.yearlyOn && (
                  <PlanCard selected={plan === 'yearly'} onClick={() => setPlan('yearly')} label="Yearly" price={`${money(config.yearly)}/yr`}
                    note={`${money(config.yearly / 12)} a month`} badge={saving >= 0.05 ? `Save ${Math.round(saving * 100)}%` : undefined} />
                )}
                <PlanCard selected={plan === 'monthly'} onClick={() => setPlan('monthly')} label="Monthly" price={`${money(config.monthly)}/mo`} note="Cancel anytime" />
              </div>}
              <button
                onClick={() => run('buy')}
                disabled={!!busy || !canBuyHere()}
                className={`${chosen ? '' : 'mt-4 '}w-full flex items-center justify-center gap-2 rounded-xl py-3 font-semibold text-white shadow-md transition-transform active:scale-[0.99] disabled:opacity-60`}
                style={{ background: GOLD }}
              >
                {busy === 'buy' ? <Loader2 size={17} className="animate-spin" /> : <Check size={17} />}
                Get Haven Premium
              </button>
              {!canBuyHere() && <p className="mt-2 text-center text-xs text-slate-500">Premium can’t be bought in this version of the app yet.</p>}
              {app && (
                <button onClick={() => run('restore')} disabled={!!busy} className="mt-2 w-full py-2 text-xs font-medium text-slate-500 hover:text-ink">
                  {busy === 'restore' ? 'Restoring…' : 'Restore purchases'}
                </button>
              )}
            </>
          )}

          {error && <p className="mt-3 text-center text-xs text-red-600">{error}</p>}

          {/* Promo codes: website only — Apple doesn't allow unlocking features with our own codes in the app (3.1.1) */}
          {!member && !app && <PromoBox />}

          {!member && (
            <p className="mt-4 text-center text-[0.6875rem] leading-relaxed text-slate-500">
              Renews automatically until you cancel{app ? ' in your store account settings' : ''}. Cancel anytime and keep Premium to the end of the period you paid for.{' '}
              <a href="/privacy" className="underline">Privacy</a>
              {' · '}
              <a href="https://www.apple.com/legal/internet-services/itunes/dev/stdeula/" target="_blank" rel="noreferrer" className="underline">Terms of Use</a>
            </p>
          )}
    </>
  )
}

function PlanCard({ selected, onClick, label, price, note, badge }: { selected: boolean; onClick: () => void; label: string; price: string; note: string; badge?: string }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={selected}
      className="relative rounded-2xl border-2 px-3 py-3 text-left transition-colors"
      style={{ borderColor: selected ? GOLD : 'rgba(120,90,50,0.18)', background: selected ? 'rgba(184,134,43,0.08)' : 'transparent' }}
    >
      {badge && <span className="absolute -top-2.5 right-3 rounded-full px-2 py-0.5 text-[0.625rem] font-bold text-white" style={{ background: GOLD }}>{badge}</span>}
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-0.5 text-lg font-bold text-ink tabular-nums">{price}</div>
      <div className="text-xs text-slate-500">{note}</div>
    </button>
  )
}

function PromoBox() {
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  async function redeem() {
    setBusy(true); setMsg(null)
    try {
      const res = await authFetch('/api/premium/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })
      const data = await res.json().catch(() => ({}))
      setMsg(res.ok ? { ok: true, text: `Premium until ${new Date(data.until).toLocaleDateString()}. Enjoy!` } : { ok: false, text: data.error ?? 'Couldn’t redeem the code.' })
    } catch { setMsg({ ok: false, text: 'Couldn’t reach TCG Haven — check your connection.' }) }
    setBusy(false)
  }
  if (!open) return <button onClick={() => setOpen(true)} className="mt-3 w-full text-xs font-medium text-slate-500 hover:text-ink">Have a code?</button>
  return (
    <div className="mt-3">
      <div className="flex gap-2">
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === 'Enter' && code.trim()) redeem() }}
          placeholder="HAVEN-XXXX-XXXX" className="input-field !py-2 font-mono tracking-wider" autoFocus aria-label="Promo code" />
        <button onClick={redeem} disabled={busy || !code.trim()} className="btn-secondary shrink-0 disabled:opacity-50">{busy ? <Loader2 size={15} className="animate-spin" /> : 'Redeem'}</button>
      </div>
      {msg && <p className={`mt-1.5 text-xs ${msg.ok ? 'text-emerald-700' : 'text-red-600'}`}>{msg.text}</p>}
    </div>
  )
}
