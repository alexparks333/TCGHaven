'use client'

import { AuthProvider } from '@/components/auth/AuthProvider'
import { Sidebar, MobileHeader } from './Sidebar'
import { FilterPanel } from './FilterPanel'
import { CardUnlockToast } from '@/components/CardUnlockToast'

export default function ClientWrapper({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <div className="flex h-screen overflow-hidden">
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
    </AuthProvider>
  )
}
