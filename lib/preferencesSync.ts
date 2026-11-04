import { onSnapshot } from 'firebase/firestore'
import { useStore } from './store'
import { preferencesDoc, parseFilterPrefs, parseTrackedGames, saveFilterPrefs, type FilterPrefs } from './firebase/preferences'

// Keeps Portfolio's settings — the Filters panel (value floor, game toggles, hidden groups), the
// time frame, the card sort and "include sold" — the same on every device signed in to an
// account, website and iPhone app alike: users/{uid}/settings/preferences `filters` is the source
// of truth. They change only when the user changes them; each device listens to the doc (a change
// on one shows up on the other within a second) and writes its own changes back. The tracked
// games on the same doc are followed live too. localStorage (lib/store.ts's persist) still holds
// a copy, only so a reload doesn't flash the defaults before Firestore answers.

const SAVE_DELAY_MS = 600 // the floor is a typed number — don't write on every keystroke

const FIELDS = ['calcFloor', 'activeGames', 'timeFrame', 'hiddenGroups', 'portfolioSort', 'includeSold'] as const

function currentFilters(): FilterPrefs {
  const s = useStore.getState()
  return {
    calcFloor: s.calcFloor, activeGames: s.activeGames, timeFrame: s.timeFrame,
    hiddenGroups: s.hiddenGroups, portfolioSort: s.portfolioSort, includeSold: s.includeSold,
  }
}

const keyOf = (f: FilterPrefs) =>
  JSON.stringify([f.calcFloor, [...f.activeGames].sort(), f.timeFrame, [...f.hiddenGroups].sort(), f.portfolioSort, f.includeSold])

const sameGames = (a: string[], b: string[]) => a.length === b.length && a.every((g) => b.includes(g))

export function startPreferencesSync(userId: string): () => void {
  // Filters as last agreed with Firestore; a store change that matches this is an echo of a
  // remote update being applied, not something to write back.
  let syncedKey: string | null = null
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let ready = false // don't write anything until the account's own filters have been read

  const unsubDoc = onSnapshot(preferencesDoc(userId), (snap) => {
    if (snap.metadata.hasPendingWrites) return // our own write coming back
    const data = snap.data()
    const tracked = parseTrackedGames(data?.trackedGames)
    if (tracked && !sameGames(tracked, useStore.getState().trackedGames)) useStore.getState().applyAccountTrackedGames(tracked)
    const remote = parseFilterPrefs(data?.filters)
    // A change made on this device that hasn't been written yet wins — it's about to be saved,
    // and applying the older remote copy now would undo what the user just did.
    if (remote && !saveTimer) {
      const merged = { ...currentFilters(), ...remote }
      syncedKey = keyOf(merged)
      if (keyOf(currentFilters()) !== syncedKey) useStore.setState(merged)
    }
    if (!ready) {
      ready = true
      // Account has never saved filters (or an older save lacks a field) — fill it from this device
      if (!remote || FIELDS.some((f) => !(f in remote))) { syncedKey = null; scheduleSave() }
    }
  }, (err) => console.error('Failed to sync filters:', err))

  function save() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
    const f = currentFilters()
    const key = keyOf(f)
    if (key === syncedKey) return
    syncedKey = key
    saveFilterPrefs(userId, f).catch((err) => console.error('Failed to save filters:', err))
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(save, SAVE_DELAY_MS)
  }

  // Leaving the page or switching away from the app mid-delay still saves the change
  const flush = () => { if (saveTimer) save() }
  const onVisibility = () => { if (document.visibilityState === 'hidden') flush() }
  window.addEventListener('pagehide', flush)
  document.addEventListener('visibilitychange', onVisibility)

  const unsubStore = useStore.subscribe((state, prev) => {
    if (!ready) return
    if (FIELDS.every((f) => state[f] === prev[f])) return
    if (keyOf(currentFilters()) === syncedKey) return
    // A click (game, group, time frame, sort…) saves at once, so it's out before the page can be
    // left; only typing in the floor box waits for a pause.
    const typingOnly = FIELDS.every((f) => f === 'calcFloor' || state[f] === prev[f])
    if (typingOnly) scheduleSave()
    else save()
  })

  return () => {
    unsubDoc()
    unsubStore()
    window.removeEventListener('pagehide', flush)
    document.removeEventListener('visibilitychange', onVisibility)
    if (saveTimer) clearTimeout(saveTimer)
  }
}
