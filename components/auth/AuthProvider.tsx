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
import { doc, getDoc } from 'firebase/firestore'
import { auth, db, googleProvider } from '@/lib/firebase/config'
import { loadCards, loadCardChanges, loadSoldCards } from '@/lib/firebase/db'
import { readInventoryCache, writeInventoryCache, clearInventoryCache, INVENTORY_FULL_SYNC_EVERY_MS } from '@/lib/inventoryCache'
import type { Card } from '@/lib/types'
import { loadPurchases } from '@/lib/firebase/spending'
import { loadTrackedGames } from '@/lib/firebase/preferences'
import { startPreferencesSync } from '@/lib/preferencesSync'
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

// Price history isn't loaded per user anymore — it's shared and served by /api/price-history.
const DATA_STEPS = ['your cards', 'purchases', 'sold cards', 'your games'] as const

// The user's inventory: this device's saved copy plus only what changed since it was saved
// (lib/inventoryCache.ts + loadCardChanges), or a full read when there's no usable copy (new
// device, cleared browser, or the weekly safety refresh). If the change check fails (e.g. a
// flaky connection) the saved copy is shown rather than an empty inventory.
async function loadInventory(uid: string): Promise<{ cards: Card[]; cursor: number; fullSyncAt: number }> {
  const cached = await readInventoryCache(uid)
  if (cached && Date.now() - cached.fullSyncAt < INVENTORY_FULL_SYNC_EVERY_MS) {
    try {
      const { changed, deletedIds, cursor } = await loadCardChanges(uid, cached.cursor)
      const byId = new Map(cached.cards.map((c) => [c.id, c]))
      deletedIds.forEach((id) => byId.delete(id))
      changed.forEach((c) => byId.set(c.id, c))
      const cards = Array.from(byId.values())
      if (changed.length > 0 || deletedIds.length > 0) {
        await writeInventoryCache(uid, { cards, cursor, fullSyncAt: cached.fullSyncAt })
      }
      return { cards, cursor, fullSyncAt: cached.fullSyncAt }
    } catch (err) {
      console.error('Checking for inventory changes failed — showing this device\'s saved copy:', err)
      return { cards: cached.cards, cursor: cached.cursor, fullSyncAt: cached.fullSyncAt }
    }
  }
  const { cards, cursor } = await loadCards(uid)
  const fullSyncAt = Date.now()
  await writeInventoryCache(uid, { cards, cursor, fullSyncAt })
  return { cards, cursor, fullSyncAt }
}

// Rewrites the device's saved inventory (debounced) whenever the in-memory cards change. The
// cursor is left as-is: local writes are server-timestamped and simply come back as harmless
// no-op "changes" on the next open.
function startInventoryCacheSync(uid: string, cursor: number, fullSyncAt: number): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const unsub = useStore.subscribe((state, prev) => {
    if (state.cards === prev.cards) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { writeInventoryCache(uid, { cards: useStore.getState().cards, cursor, fullSyncAt }) }, 1000)
  })
  return () => { if (timer) clearTimeout(timer); unsub() }
}

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
  const { loadUserCards, loadUserSoldCards, loadPurchases: storePurchases, clearUserData, setTrackedGames } = useStore()

  useEffect(() => {
    // Tracks the uid the current in-flight load belongs to, so a load that
    // resolves after sign-out (or a user switch) can't repopulate the store
    let activeUid: string | null = null
    let stopCacheSync: (() => void) | null = null
    let stopPrefsSync: (() => void) | null = null

    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      if (firebaseUser) {
        activeUid = firebaseUser.uid
        // Filters follow the account across devices, live (lib/preferencesSync.ts).
        stopPrefsSync?.()
        stopPrefsSync = startPreferencesSync(firebaseUser.uid)
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
        // rejection meant loadUserCards/storePurchases never ran at all,
        // landing the user on a fully empty Inventory/Portfolio/Spending with only a
        // console.error to explain it (easy to mistake for real data loss).
        Promise.all([
          track('your cards', loadInventory(firebaseUser.uid).catch((err) => { console.error('Failed to load cards:', err); return null })),
          track('purchases', loadPurchases(firebaseUser.uid).catch((err) => { console.error('Failed to load purchases:', err); return [] as Awaited<ReturnType<typeof loadPurchases>> })),
          track('sold cards', loadSoldCards(firebaseUser.uid).catch((err) => { console.error('Failed to load sold cards:', err); return [] as Awaited<ReturnType<typeof loadSoldCards>> })),
          // undefined (read failed) leaves whatever the store already has alone, rather than
          // snapping a multi-game user back to the Riftbound-only default over a network blip.
          track('your games', loadTrackedGames(firebaseUser.uid).catch((err) => { console.error('Failed to load tracked games:', err); return undefined })),
        ]).then(([inventory, purchases, soldCards, trackedGames]) => {
          if (activeUid !== firebaseUser.uid) return // signed out mid-load
          if (trackedGames !== undefined) setTrackedGames(trackedGames ?? DEFAULT_TRACKED_GAMES)
          loadUserCards(inventory?.cards ?? [])
          // Keep this device's saved copy in step with every later change (add/edit/sell/delete)
          // so the next open only has to ask Firestore for changes made elsewhere.
          stopCacheSync?.()
          stopCacheSync = inventory ? startInventoryCacheSync(firebaseUser.uid, inventory.cursor, inventory.fullSyncAt) : null
          loadUserSoldCards(soldCards)
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
        stopCacheSync?.()
        stopCacheSync = null
        stopPrefsSync?.()
        stopPrefsSync = null
        clearInventoryCache()
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
    const { user: signedIn } = await signInWithEmailAndPassword(auth, email, password)
    // Employee logins made on the staff portal's Team page are staff-only — they have no
    // collection, so don't let one into the collector app. (The Owner's account is both.)
    const staff = await getDoc(doc(db, 'staff', signedIn.uid)).catch(() => null)
    if (staff?.exists() && staff.data().role === 'staff') {
      await firebaseSignOut(auth)
      throw new Error('This is a staff login. Sign in at tcghaven.org/admin instead.')
    }
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
