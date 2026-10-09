'use client'

import { usePathname } from 'next/navigation'
import { AuthProvider } from '@/components/auth/AuthProvider'
import { Sidebar, MobileHeader } from './Sidebar'
import { FilterPanel } from './FilterPanel'
import { CardUnlockToast } from '@/components/CardUnlockToast'
import { PriceAutoUpdater } from '@/components/PriceAutoUpdater'

export default function ClientWrapper({ children }: { children: React.ReactNode }) {
  // The staff portal (/admin) has its own sign-in and layout (app/admin/layout.tsx) — none of the
  // collector app's shell, session or background price loading applies there.
  if (usePathname()?.startsWith('/admin')) return <>{children}</>
  return (
    <AuthProvider>
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
            <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 pt-5 md:pt-8 pb-[calc(env(safe-area-inset-bottom)+88px)] md:pb-8">
              {children}
            </div>
          </main>
        </div>
      </div>
      <CardUnlockToast />
      <PriceAutoUpdater />
    </AuthProvider>
  )
}
