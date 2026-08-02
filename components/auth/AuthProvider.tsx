'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import {
  User,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  updateProfile,
} from 'firebase/auth'
import { auth, googleProvider } from '@/lib/firebase/config'
import { loadCards, loadPriceHistory, loadSoldCards } from '@/lib/firebase/db'
import { loadPurchases } from '@/lib/firebase/spending'
import { useStore } from '@/lib/store'

interface AuthContextValue {
  user: User | null
  loading: boolean
  dataLoading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, displayName: string) => Promise<void>
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [dataLoading, setDataLoading] = useState(false)
  const { loadUserCards, loadUserSoldCards, loadUserPriceHistory, loadPurchases: storePurchases, clearUserData } = useStore()

  useEffect(() => {
    // Tracks the uid the current in-flight load belongs to, so a load that
    // resolves after sign-out (or a user switch) can't repopulate the store
    let activeUid: string | null = null

    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      if (firebaseUser) {
        activeUid = firebaseUser.uid
        setUser(firebaseUser)
        setLoading(false)
        setDataLoading(true)

        // Critical: load user's own data — isolated so API failures can't break this
        Promise.all([
          loadCards(firebaseUser.uid),
          loadPriceHistory(firebaseUser.uid),
          loadPurchases(firebaseUser.uid),
          loadSoldCards(firebaseUser.uid).catch(() => [] as Awaited<ReturnType<typeof loadSoldCards>>),
        ]).then(([cards, priceHistory, purchases, soldCards]) => {
          if (activeUid !== firebaseUser.uid) return // signed out mid-load
          loadUserCards(cards)
          loadUserSoldCards(soldCards)
          loadUserPriceHistory(priceHistory)
          storePurchases(purchases)
          setDataLoading(false)
        }).catch((err) => {
          console.error('Failed to load collection from Firestore:', err)
          if (activeUid === firebaseUser.uid) setDataLoading(false)
        })
      } else {
        activeUid = null
        setUser(null)
        clearUserData()
        setLoading(false)
        setDataLoading(false)
      }
    })
    return unsub
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const signIn = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password)
  }

  const signUp = async (email: string, password: string, displayName: string) => {
    const cred = await createUserWithEmailAndPassword(auth, email, password)
    await updateProfile(cred.user, { displayName })
  }

  const signInWithGoogle = async () => {
    await signInWithPopup(auth, googleProvider)
  }

  const signOut = async () => {
    await firebaseSignOut(auth)
  }

  return (
    <AuthContext.Provider value={{ user, loading, dataLoading, signIn, signUp, signInWithGoogle, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
