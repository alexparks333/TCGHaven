'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from './AuthProvider'
import { Sparkles } from 'lucide-react'

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && !user) router.replace('/login')
  }, [user, loading, router])

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <div className="w-12 h-12 rounded-2xl bg-violet-600 flex items-center justify-center animate-pulse">
          <Sparkles size={22} className="text-white" />
        </div>
        <p className="text-slate-500 text-sm">Loading your collection…</p>
      </div>
    )
  }

  if (!user) return null

  return <>{children}</>
}
