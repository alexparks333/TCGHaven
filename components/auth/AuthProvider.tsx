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
  deleteUser,
  getAdditionalUserInfo,
} from 'firebase/auth'
import { auth, googleProvider } from '@/lib/firebase/config'
import { loadCards, loadPriceHistory, loadSoldCards } from '@/lib/firebase/db'
import { loadPurchases } from '@/lib/firebase/spending'
import { loadTrackedGames } from '@/lib/firebase/preferences'
import { useStore, DEFAULT_TRACKED_GAMES } from '@/lib/store'

interface AuthContextValue {
  user: User | null
  loading: boolean
  dataLoading: boolean
  // Real progress of the post-sign-in data load: which of the parallel Firestore reads are
  // still outstanding. Drives the loading bar in AuthGuard's LogoLoader.
  dataProgress: DataLoadProgress
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, displayName: string) => Promise<void>
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
  verifyPasscode: (code: string) => Promise<boolean>
}

export interface DataLoadProgress {
  done: number
  total: number
  pending: string[] // human labels of the reads still in flight, in load order
}

const DATA_STEPS = ['your cards', 'price history', 'purchases', 'sold cards', 'your games'] as const

const AuthContext = createContext<AuthContextValue | null>(null)

// Set only after a successful /api/auth/verify-passcode call, for the lifetime of this browser
// tab — gates both the email/password signup form and the Google popup's new-account path
// (see signInWithGoogle below, which rolls back a freshly-created account if this isn't set).
const PASSCODE_VERIFIED_KEY = 'tcghaven_passcode_verified'

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [dataLoading, setDataLoading] = useState(false)
  const [dataProgress, setDataProgress] = useState<DataLoadProgress>({ done: 0, total: DATA_STEPS.length, pending: [...DATA_STEPS] })
  const { loadUserCards, loadUserSoldCards, loadUserPriceHistory, loadPurchases: storePurchases, clearUserData, setTrackedGames } = useStore()

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
        setDataProgress({ done: 0, total: DATA_STEPS.length, pending: [...DATA_STEPS] })
        // Marks one read finished (success or failure) — the bar only ever moves when a read
        // actually completes, never on a timer.
        const track = <T,>(step: typeof DATA_STEPS[number], p: Promise<T>): Promise<T> =>
          p.finally(() => {
            if (activeUid !== firebaseUser.uid) return
            setDataProgress((prev) => {
              const pending = prev.pending.filter((s) => s !== step)
              return { done: DATA_STEPS.length - pending.length, total: DATA_STEPS.length, pending }
            })
          })

        // Each read is isolated with its own .catch so one failing Firestore read (e.g. a
        // transient permission/network blip on just priceHistory) can't blank out the other
        // three — this used to be a single Promise.all with no per-call fallback, so any one
        // rejection meant loadUserCards/loadUserPriceHistory/storePurchases never ran at all,
        // landing the user on a fully empty Inventory/Portfolio/Spending with only a
        // console.error to explain it (easy to mistake for real data loss).
        Promise.all([
          track('your cards', loadCards(firebaseUser.uid).catch((err) => { console.error('Failed to load cards:', err); return [] as Awaited<ReturnType<typeof loadCards>> })),
          track('price history', loadPriceHistory(firebaseUser.uid).catch((err) => { console.error('Failed to load price history:', err); return [] as Awaited<ReturnType<typeof loadPriceHistory>> })),
          track('purchases', loadPurchases(firebaseUser.uid).catch((err) => { console.error('Failed to load purchases:', err); return [] as Awaited<ReturnType<typeof loadPurchases>> })),
          track('sold cards', loadSoldCards(firebaseUser.uid).catch((err) => { console.error('Failed to load sold cards:', err); return [] as Awaited<ReturnType<typeof loadSoldCards>> })),
          // undefined (read failed) leaves whatever the store already has alone, rather than
          // snapping a multi-game user back to the Riftbound-only default over a network blip.
          track('your games', loadTrackedGames(firebaseUser.uid).catch((err) => { console.error('Failed to load tracked games:', err); return undefined })),
        ]).then(([cards, priceHistory, purchases, soldCards, trackedGames]) => {
          if (activeUid !== firebaseUser.uid) return // signed out mid-load
          if (trackedGames !== undefined) setTrackedGames(trackedGames ?? DEFAULT_TRACKED_GAMES)
          loadUserCards(cards)
          loadUserSoldCards(soldCards)
          loadUserPriceHistory(priceHistory)
          storePurchases(purchases)
          setDataLoading(false)
        }).catch((err) => {
          // Only reachable now for something outside the four reads above (e.g. a synchronous
          // throw in one of the store setters) — each read's own rejection is already handled.
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

  const verifyPasscode = async (code: string): Promise<boolean> => {
    try {
      const res = await fetch('/api/auth/verify-passcode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      const data = await res.json().catch(() => ({}))
      if (data.ok) sessionStorage.setItem(PASSCODE_VERIFIED_KEY, '1')
      return !!data.ok
    } catch {
      return false
    }
  }

  const signUp = async (email: string, password: string, displayName: string) => {
    if (sessionStorage.getItem(PASSCODE_VERIFIED_KEY) !== '1') {
      throw new Error('Enter a valid invite code first.')
    }
    const cred = await createUserWithEmailAndPassword(auth, email, password)
    await updateProfile(cred.user, { displayName })
  }

  const signInWithGoogle = async () => {
    const result = await signInWithPopup(auth, googleProvider)
    const isNewUser = getAdditionalUserInfo(result)?.isNewUser ?? false
    if (isNewUser && sessionStorage.getItem(PASSCODE_VERIFIED_KEY) !== '1') {
      // Google's popup already created the account before we can intervene — since this wasn't
      // gated by a valid invite code, undo it immediately rather than leaving an ungated account.
      await deleteUser(result.user).catch(() => firebaseSignOut(auth))
      throw new Error('An invite code is required to create a new account — enter it on the signup page first.')
    }
  }

  const signOut = async () => {
    await firebaseSignOut(auth)
  }

  return (
    <AuthContext.Provider value={{ user, loading, dataLoading, dataProgress, signIn, signUp, signInWithGoogle, signOut, verifyPasscode }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
