'use client'

import { AuthProvider } from '@/components/auth/AuthProvider'
import { Sidebar } from './Sidebar'
import { FilterPanel } from './FilterPanel'

export default function ClientWrapper({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          <FilterPanel />
          <main className="flex-1 overflow-y-auto">
            <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
              {children}
            </div>
          </main>
        </div>
      </div>
    </AuthProvider>
  )
}
