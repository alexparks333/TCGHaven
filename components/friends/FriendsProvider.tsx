'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '@/components/auth/AuthProvider'
import { useStore } from '@/lib/store'
import { loadBadges, computeBadges, saveBadges, sameBadges, type SharedBadges } from '@/lib/firebase/badges'
import { useBadgeCatalog } from '@/lib/badgeCatalog'
import {
  ensureProfile, getProfile, watchFriendships, otherUid, DEFAULT_PRIVACY, toPinDisplay, readSharedCardexRaw, writeSharedCardex, toSharedCards,
  type Friendship, type Profile,
} from '@/lib/firebase/friends'

export type FriendsTab = 'friends' | 'requests' | 'add'

export interface FriendEntry {
  uid: string
  profile: Profile | null // null while loading
  friendship: Friendship
}

interface FriendsContextValue {
  me: Profile | null
  setMe: (p: Profile) => void
  friends: FriendEntry[]   // accepted, A–Z
  incoming: FriendEntry[]  // requests waiting on me, newest first
  outgoing: FriendEntry[]  // requests I sent, newest first
  byUid: Map<string, Friendship>
  ready: boolean
  myBadges: SharedBadges | null  // your Haven Badges, kept in step with your collection
  // The Friends popup (FriendsDialog) — the quick list; /friends is the full page
  open: boolean
  tab: FriendsTab
  focusUid: string | null
  openFriends: (tab?: FriendsTab, focusUid?: string) => void
  closeFriends: () => void
  setTab: (t: FriendsTab) => void
  cacheProfile: (p: Profile) => void
}

const FriendsContext = createContext<FriendsContextValue | null>(null)

export function FriendsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const [me, setMe] = useState<Profile | null>(null)
  const [list, setList] = useState<Friendship[]>([])
  const [ready, setReady] = useState(false)
  const [profiles, setProfiles] = useState<Map<string, Profile>>(new Map())
  const requested = useRef(new Set<string>())
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<FriendsTab>('friends')
  const [focusUid, setFocusUid] = useState<string | null>(null)

  useEffect(() => {
    setMe(null); setList([]); setReady(false); setProfiles(new Map()); requested.current = new Set()
    if (!user) { setOpen(false); return }
    let cancelled = false
    ensureProfile(user).then((p) => { if (!cancelled) setMe(p) }).catch((e) => console.error('Profile setup failed:', e))
    const stop = watchFriendships(user.uid, (l) => { if (!cancelled) { setList(l); setReady(true) } }, (e) => {
      console.error('Friends listener failed:', e)
      if (!cancelled) setReady(true)
    })
    return () => { cancelled = true; stop() }
  }, [user])

  const cacheProfile = useCallback((p: Profile) => {
    requested.current.add(p.uid)
    setProfiles((prev) => (prev.get(p.uid) === p ? prev : new Map(prev).set(p.uid, p)))
  }, [])

  // Fetch each new person's profile once per session.
  useEffect(() => {
    if (!user) return
    for (const f of list) {
      const uid = otherUid(f, user.uid)
      if (requested.current.has(uid)) continue
      requested.current.add(uid)
      getProfile(uid).then((p) => {
        setProfiles((prev) => new Map(prev).set(uid, p ?? { uid, username: '', displayName: 'Collector', photoURL: '', bio: '', privacy: DEFAULT_PRIVACY, pinDisplay: toPinDisplay([]) }))
      }).catch(() => requested.current.delete(uid))
    }
  }, [list, user])

  // Keeps the shared copy of this user's Cardex (shared_cardex/{uid}) in step with their
  // inventory — only while they share it. Waits for the inventory to finish loading, skips writes
  // when nothing changed, and debounces bursts of edits.
  const { dataLoading } = useAuth()
  const cards = useStore((s) => s.cards)
  const sharing = !!me?.privacy.cardex
  const lastShared = useRef<string | null | undefined>(undefined)
  useEffect(() => { lastShared.current = undefined }, [user, sharing])
  useEffect(() => {
    if (!user || !sharing || dataLoading) return
    let cancelled = false
    const t = setTimeout(async () => {
      try {
        // Most valuable first, so a profile's showcase opens on their best cards (order only — no prices).
        const json = JSON.stringify(toSharedCards([...cards].sort((x, y) => (y.currentPrice ?? 0) - (x.currentPrice ?? 0))))
        if (lastShared.current === undefined) lastShared.current = await readSharedCardexRaw(user.uid)
        if (cancelled || json === lastShared.current) return
        await writeSharedCardex(user.uid, json)
        lastShared.current = json
      } catch (e) {
        console.error('Sharing your Cardex failed:', e)
      }
    }, 1500)
    return () => { cancelled = true; clearTimeout(t) }
  }, [user, sharing, cards, dataLoading])

  // Haven Badges (lib/badges.ts): recomputed whenever the collection changes; anything newly earned
  // is saved to shared_badges/{uid} (earned badges are kept for good). Skips writes when unchanged.
  const { catalog: badgeCatalog, loaded: badgeCatalogLoaded } = useBadgeCatalog()
  const [myBadges, setMyBadgesState] = useState<SharedBadges | null>(null)
  const savedBadges = useRef<SharedBadges | null>(null)
  // The last badges are kept on this device, so the pin books (and their progress) show at once
  // on the next visit instead of waiting for the collection and a Firestore read.
  const badgesKey = user ? `tcghaven-my-badges-${user.uid}` : null
  // The badges showing, tagged with whose they are: state set a moment ago isn't readable yet, and
  // right after switching accounts the old account's badges must not seed the new one's
  const shown = useRef<{ key: string | null; badges: SharedBadges | null }>({ key: null, badges: null })
  const setMyBadges = useCallback((b: SharedBadges) => {
    shown.current = { key: badgesKey, badges: b }
    setMyBadgesState(b)
    try { if (badgesKey) localStorage.setItem(badgesKey, JSON.stringify(b)) } catch { /* full or blocked — fine */ }
  }, [badgesKey])
  useEffect(() => {
    savedBadges.current = null
    let stored: SharedBadges | null = null
    try { stored = badgesKey ? JSON.parse(localStorage.getItem(badgesKey) ?? 'null') : null } catch { /* corrupt — recomputed below */ }
    if (!(stored?.earned && stored?.progress)) stored = null
    shown.current = { key: badgesKey, badges: stored }
    setMyBadgesState(stored)
  }, [badgesKey])
  useEffect(() => {
    if (!user || dataLoading || !badgeCatalogLoaded) return
    let cancelled = false
    // Progress straight from the collection, now (badges earned before join it once loaded)
    setMyBadges(computeBadges(cards, savedBadges.current ?? { earned: (shown.current.key === badgesKey && shown.current.badges?.earned) || {}, progress: {} }, badgeCatalog))
    const t = setTimeout(async () => {
      try {
        if (!savedBadges.current) {
          const prev = await loadBadges(user.uid)
          savedBadges.current = prev === 'private' ? { earned: {}, progress: {} } : prev
        }
        const next = computeBadges(cards, savedBadges.current, badgeCatalog)
        if (cancelled) return
        setMyBadges(next)
        if (!sameBadges(next, savedBadges.current)) {
          await saveBadges(user.uid, next)
          savedBadges.current = next
        }
      } catch (e) {
        console.error('Updating your badges failed:', e)
      }
    }, 800)
    return () => { cancelled = true; clearTimeout(t) }
  }, [user, cards, dataLoading, badgeCatalog, badgeCatalogLoaded, setMyBadges, badgesKey])

  const value = useMemo<FriendsContextValue>(() => {
    const uid = user?.uid ?? ''
    const entry = (f: Friendship): FriendEntry => ({ uid: otherUid(f, uid), profile: profiles.get(otherUid(f, uid)) ?? null, friendship: f })
    const newest = (a: FriendEntry, b: FriendEntry) => b.friendship.createdAt - a.friendship.createdAt
    const name = (e: FriendEntry) => (e.profile?.displayName ?? '').toLowerCase()
    return {
      me, setMe,
      friends: list.filter((f) => f.status === 'accepted').map(entry).sort((a, b) => name(a).localeCompare(name(b))),
      incoming: list.filter((f) => f.status === 'pending' && f.addressee === uid).map(entry).sort(newest),
      outgoing: list.filter((f) => f.status === 'pending' && f.requester === uid).map(entry).sort(newest),
      byUid: new Map(list.map((f) => [otherUid(f, uid), f])),
      ready,
      myBadges,
      open, tab, focusUid,
      openFriends: (t, focus) => { if (t) setTab(t); setFocusUid(focus ?? null); setOpen(true) },
      closeFriends: () => setOpen(false),
      setTab,
      cacheProfile,
    }
  }, [user, me, list, profiles, ready, myBadges, open, tab, focusUid, cacheProfile])

  return <FriendsContext.Provider value={value}>{children}</FriendsContext.Provider>
}

export function useFriends() {
  const ctx = useContext(FriendsContext)
  if (!ctx) throw new Error('useFriends must be used inside FriendsProvider')
  return ctx
}
