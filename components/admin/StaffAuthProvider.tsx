'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import {
  type User,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  updatePassword,
  GoogleAuthProvider,
} from 'firebase/auth'
import { staffAuth, loadStaffMember, markPasswordChanged, type StaffMember } from '@/lib/firebase/staff'

// Sign-in state for the staff portal (/admin) — its own Firebase session (lib/firebase/staff.ts),
// independent of the collector app's AuthProvider. `member` is the signed-in account's staff
// record; null means signed in but not staff (no access).

interface StaffContextValue {
  user: User | null
  member: StaffMember | null
  loading: boolean
  signInWithEmail: (email: string, password: string) => Promise<void>
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
  changePassword: (newPassword: string) => Promise<void>
}

const StaffContext = createContext<StaffContextValue | null>(null)

export function StaffAuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [member, setMember] = useState<StaffMember | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    return onAuthStateChanged(staffAuth, async (u) => {
      setLoading(true)
      setUser(u)
      if (!u) {
        setMember(null)
        setLoading(false)
        return
      }
      try {
        setMember(await loadStaffMember(u.uid, u.email, u.displayName))
      } catch (err) {
        // Permission denied = not staff; anything else is logged but treated the same (no access).
        console.error('Failed to load staff record:', err)
        setMember(null)
      }
      setLoading(false)
    })
  }, [])

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    await signInWithEmailAndPassword(staffAuth, email.trim(), password)
  }, [])

  const signInWithGoogle = useCallback(async () => {
    await signInWithPopup(staffAuth, new GoogleAuthProvider())
  }, [])

  const signOut = useCallback(async () => {
    await firebaseSignOut(staffAuth)
  }, [])

  const changePassword = useCallback(async (newPassword: string) => {
    const u = staffAuth.currentUser
    if (!u) throw new Error('Not signed in')
    await updatePassword(u, newPassword)
    await markPasswordChanged(u.uid)
    setMember((m) => (m ? { ...m, mustChangePassword: false } : m))
  }, [])

  return (
    <StaffContext.Provider value={{ user, member, loading, signInWithEmail, signInWithGoogle, signOut, changePassword }}>
      {children}
    </StaffContext.Provider>
  )
}

export function useStaff(): StaffContextValue {
  const ctx = useContext(StaffContext)
  if (!ctx) throw new Error('useStaff must be used inside StaffAuthProvider')
  return ctx
}
