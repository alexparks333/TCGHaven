'use client'

import { Ban, LogOut } from 'lucide-react'
import { useAuth } from './AuthProvider'
import { useAccountRole } from '@/lib/accountRoles'

// A banned account (staff portal → Accounts) sees only this, everywhere in the app. firestore.rules
// refuses their writes too, so this is the message, not the lock. Unbanning brings them straight
// back (the record is watched live).
export function BanGate({ children }: { children: React.ReactNode }) {
  const { user, signOut } = useAuth()
  const { record } = useAccountRole(user?.uid)
  if (!record.banned) return <>{children}</>
  return (
    <div className="min-h-dvh flex items-center justify-center p-6 bg-slate-950" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 24px)' }}>
      <div className="card-glass max-w-sm w-full p-6 text-center">
        <span className="mx-auto w-12 h-12 rounded-2xl bg-red-100/60 text-red-600 flex items-center justify-center mb-3"><Ban size={24} /></span>
        <h1 className="text-lg font-bold text-ink">This account has been banned</h1>
        <p className="text-sm text-slate-400 mt-2">You can’t use TCGHaven with this account. If you think this is a mistake, contact TCG Haven support.</p>
        <button onClick={() => signOut()} className="btn-secondary mx-auto mt-5"><LogOut size={15} />Sign out</button>
      </div>
    </div>
  )
}
