'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { originalImage, isCardImageUrl, NO_CARD_IMAGE } from '@/lib/cardImage'
import { AuthProvider } from '@/components/auth/AuthProvider'
import { BanGate } from '@/components/auth/BanGate'
import { Sidebar, MobileHeader } from './Sidebar'
import { FilterPanel } from './FilterPanel'
import { CardUnlockToast } from '@/components/CardUnlockToast'
import { PriceAutoUpdater } from '@/components/PriceAutoUpdater'
import { UsageTracker } from '@/components/UsageTracker'
import { FriendsProvider } from '@/components/friends/FriendsProvider'
import { FriendsDialog } from '@/components/friends/FriendsDialog'
import { FriendRequestToast } from '@/components/friends/FriendRequestToast'
import { DevPanel } from '@/components/dev/DevPanel'
import { hideLaunchScreen, onScanLink } from '@/lib/nativeApp'

export default function ClientWrapper({ children }: { children: React.ReactNode }) {
  // The iPhone app's launch screen comes down once the site has drawn (no-op in a browser)
  useEffect(() => { hideLaunchScreen() }, [])
  // The app opened from the website's "Scan with your phone" QR code: straight to the scanner
  const router = useRouter()
  useEffect(() => onScanLink(() => router.push('/inventory?scan=1')), [router])
  // A resized card image from the image proxy (lib/cardImage.ts) that fails to load falls back to
  // the original, and a card image that can't load at all shows "No Image" instead of a broken
  // icon — one listener for every <img> in the app (error events don't bubble; capture does)
  useEffect(() => {
    const onError = (e: Event) => {
      const img = e.target as HTMLImageElement
      if (img?.tagName !== 'IMG') return
      const src = img.currentSrc || img.src
      const original = originalImage(src)
      if (original) img.src = original
      else if (isCardImageUrl(src)) { img.removeAttribute('srcset'); img.src = NO_CARD_IMAGE }
    }
    window.addEventListener('error', onError, true)
    return () => window.removeEventListener('error', onError, true)
  }, [])
  // The staff portal (/admin) has its own sign-in and layout (app/admin/layout.tsx) — none of the
  // collector app's shell, session or background price loading applies there.
  const pathname = usePathname()
  if (pathname?.startsWith('/admin')) return <>{children}</>
  // The privacy policy is public and stands alone (linked from the App Store listing)
  if (pathname === '/privacy') return <>{children}</>
  // The Badges pin book fills the whole window, so that page drops the usual content-width cap.
  const fullWidth = pathname === '/badges'
  return (
    <AuthProvider>
      <BanGate>
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
        <UsageTracker />
        <FriendsDialog />
        <FriendRequestToast />
        {/* Local dev server only — compiled out of production builds (NODE_ENV is fixed at build time) */}
        {process.env.NODE_ENV === 'development' && <DevPanel />}
      </FriendsProvider>
      </BanGate>
    </AuthProvider>
  )
}
