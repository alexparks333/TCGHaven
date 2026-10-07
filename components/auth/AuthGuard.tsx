'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from './AuthProvider'
import { LogoLoader } from '@/components/LogoLoader'

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading, dataLoading, dataProgress } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && !user) router.replace('/login')
  }, [user, loading, router])

  // Held until the user's cards/prices/purchases have actually arrived from Firestore, not just
  // until sign-in resolves — otherwise every page briefly renders an empty store (Portfolio at
  // $0, Inventory at 0 cards), which looks exactly like lost data.
  if (loading) return <LogoLoader fullScreen />
  if (user && dataLoading) {
    return (
      <LogoLoader
        fullScreen
        label={dataProgress.pending.length > 0 ? `Loading ${dataProgress.pending[0]}…` : 'Loading your collection…'}
        progress={{ done: dataProgress.done, total: dataProgress.total }}
      />
    )
  }

  if (!user) return null

  return <>{children}</>
}
