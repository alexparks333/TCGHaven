'use client'

import { Crown } from 'lucide-react'
import { usePremiumAccess, type PremiumReason } from './PremiumProvider'

// Shown in place of a Haven Premium feature for a free account: what it is, and the way in.
export function PremiumLock({ reason, title, sub, className = '' }: { reason: PremiumReason; title: string; sub: string; className?: string }) {
  const { openPremium } = usePremiumAccess()
  return (
    <div className={`flex flex-col items-center justify-center text-center px-6 py-8 ${className}`}>
      <div className="mb-2.5 flex h-10 w-10 items-center justify-center rounded-full shadow" style={{ background: 'radial-gradient(circle at 35% 30%, #f3d58a, #b8862b 70%)' }}>
        <Crown size={18} className="text-white" />
      </div>
      <div className="text-sm font-semibold text-ink">{title}</div>
      <p className="mt-1 max-w-xs text-xs text-slate-500">{sub}</p>
      <button
        onClick={() => openPremium(reason)}
        className="mt-3 rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm"
        style={{ background: 'linear-gradient(180deg, #c99a3e, #b8862b)' }}
      >
        Get Haven Premium
      </button>
    </div>
  )
}
