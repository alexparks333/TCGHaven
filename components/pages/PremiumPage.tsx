'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { authFetch } from '@/lib/firebase/authFetch'
import { useAuth } from '@/components/auth/AuthProvider'
import { usePremiumAccess } from '@/components/premium/PremiumProvider'

// /premium — Haven Premium's page: opens the Premium sheet, and is where Stripe Checkout sends
// people back (/premium?checkout={session id}): the purchase is confirmed with the server
// (POST /api/premium/refresh), which unlocks Premium straight away.
export default function PremiumPage() {
  const { user } = useAuth()
  const { openPremium, member } = usePremiumAccess()
  const [state, setState] = useState<'idle' | 'confirming' | 'done' | 'failed'>('idle')

  useEffect(() => {
    if (!user) return
    const checkout = new URLSearchParams(window.location.search).get('checkout')
    if (!checkout) { openPremium('general'); return }
    window.history.replaceState(null, '', '/premium')
    setState('confirming')
    authFetch('/api/premium/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ checkout }) })
      .then((r) => setState(r.ok ? 'done' : 'failed'))
      .catch(() => setState('failed'))
  }, [user, openPremium])

  return (
    <div className="max-w-xl mx-auto py-16 text-center">
      {state === 'confirming' && <p className="flex items-center justify-center gap-2 text-slate-400"><Loader2 size={16} className="animate-spin" />Confirming your purchase…</p>}
      {state === 'done' && (
        <>
          <h1 className="text-2xl font-bold text-ink">Welcome to Haven Premium</h1>
          <p className="mt-2 text-slate-400">{member ? 'Everything is unlocked.' : 'Unlocking now — this takes a moment.'}</p>
        </>
      )}
      {state === 'failed' && (
        <p className="text-slate-400">Your payment went through, but we couldn’t confirm it yet. It will unlock within a few minutes — refresh this page if it doesn’t.</p>
      )}
      {state === 'idle' && (
        <button onClick={() => openPremium('general')} className="btn-primary mx-auto">See Haven Premium</button>
      )}
    </div>
  )
}
