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
          <main className="flex-1 overflow-y-auto">
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
