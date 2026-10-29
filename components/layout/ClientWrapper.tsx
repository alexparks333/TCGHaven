'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { originalImage } from '@/lib/cardImage'
import { AuthProvider } from '@/components/auth/AuthProvider'
import { Sidebar, MobileHeader } from './Sidebar'
import { FilterPanel } from './FilterPanel'
import { CardUnlockToast } from '@/components/CardUnlockToast'
import { PriceAutoUpdater } from '@/components/PriceAutoUpdater'
import { FriendsProvider } from '@/components/friends/FriendsProvider'
import { FriendsDialog } from '@/components/friends/FriendsDialog'
import { FriendRequestToast } from '@/components/friends/FriendRequestToast'
import { DevPanel } from '@/components/dev/DevPanel'

export default function ClientWrapper({ children }: { children: React.ReactNode }) {
  // A resized card image from the image proxy (lib/cardImage.ts) that fails to load falls back to
  // the original — one listener for every <img> in the app (error events don't bubble; capture does)
  useEffect(() => {
    const onError = (e: Event) => {
      const img = e.target as HTMLImageElement
      if (img?.tagName !== 'IMG') return
      const original = originalImage(img.currentSrc || img.src)
      if (original) img.src = original
    }
    window.addEventListener('error', onError, true)
    return () => window.removeEventListener('error', onError, true)
  }, [])
  // The staff portal (/admin) has its own sign-in and layout (app/admin/layout.tsx) — none of the
  // collector app's shell, session or background price loading applies there.
  const pathname = usePathname()
  if (pathname?.startsWith('/admin')) return <>{children}</>
  // The Badges pin book fills the whole window, so that page drops the usual content-width cap.
  const fullWidth = pathname === '/badges'
  return (
    <AuthProvider>
      <FriendsProvider>
        {/* 100dvh = the height actually visible right now (h-screen's 100vh is taller on iPhone — see
            the html/body note in globals.css). */}
        <div className="flex h-dvh overflow-hidden">
          <Sidebar />
          <div className="flex-1 flex flex-col overflow-hidden">
            <MobileHeader />
            <FilterPanel />
            {/* Vertical-only scrolling: overflow-x-hidden so nothing (a dragged card, a tooltip, a wide
                row) can widen the page into sideways-scrollable empty space on a phone. Deliberately
                not touch-action: pan-y — that can't be re-enabled by a child, and would break the
                Admin catalog table's own intentional sideways scroll. */}
            <main className="flex-1 overflow-y-auto overflow-x-hidden overscroll-x-none">
              {/* Bottom padding on phones clears the fixed bottom nav (plus the iPhone home bar) */}
              <div className={`${fullWidth ? '' : 'max-w-7xl '}mx-auto w-full px-4 sm:px-6 lg:px-8 pt-5 md:pt-8 pb-[calc(env(safe-area-inset-bottom)+88px)] md:pb-8`}>
                {children}
              </div>
            </main>
          </div>
        </div>
        <CardUnlockToast />
        <PriceAutoUpdater />
        <FriendsDialog />
        <FriendRequestToast />
        {/* Local dev server only — compiled out of production builds (NODE_ENV is fixed at build time) */}
        {process.env.NODE_ENV === 'development' && <DevPanel />}
      </FriendsProvider>
    </AuthProvider>
  )
}
