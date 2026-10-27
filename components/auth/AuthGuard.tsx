'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from './AuthProvider'
import { LogoLoader } from '@/components/LogoLoader'

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading, dataLoading, dataProgress } = useAuth()
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    // Come back here after signing in (e.g. a friend's invite link) — the home page needs no hint.
    if (!loading && !user) router.replace(pathname && pathname !== '/' ? `/login?next=${encodeURIComponent(pathname)}` : '/login')
  }, [user, loading, router, pathname])

  // Held until the user's cards/sold cards/games have actually arrived from Firestore, not just
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
