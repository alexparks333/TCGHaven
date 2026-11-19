'use client'

import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { useAuth } from '@/components/auth/AuthProvider'
import { usePremium, type PremiumAccess } from '@/lib/premiumAccess'
import { PremiumSheet } from './PremiumSheet'

// Haven Premium for the whole collector app: who has it (usePremiumAccess) and the Premium sheet,
// opened where someone runs into a Premium feature (openPremium('scan-limit') etc.) —
// docs/premium-business.md "Decided 2026-11-19".

export type PremiumReason = 'general' | 'scan-limit' | 'graded' | 'badge-full' | 'portfolio-time' | 'pin-display' | 'export'

interface Ctx extends PremiumAccess { openPremium: (reason?: PremiumReason) => void }

const PremiumContext = createContext<Ctx | null>(null)

export function PremiumProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const access = usePremium(user?.uid)
  const [reason, setReason] = useState<PremiumReason | null>(null)
  const openPremium = useCallback((r: PremiumReason = 'general') => setReason(r), [])
  const value = useMemo(() => ({ ...access, openPremium }), [access, openPremium])
  return (
    <PremiumContext.Provider value={value}>
      {children}
      {reason && <PremiumSheet reason={reason} onClose={() => setReason(null)} />}
    </PremiumContext.Provider>
  )
}

const NONE: Ctx = { loaded: false, gatesOn: false, member: false, unlocked: true, entitlement: null, openPremium: () => {} }

/** Haven Premium for the signed-in collector. Outside the provider (the staff portal, public
 *  pages) nothing is locked. */
export function usePremiumAccess(): Ctx {
  return useContext(PremiumContext) ?? NONE
}
