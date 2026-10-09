import { onSnapshot } from 'firebase/firestore'
import { useStore } from './store'
import { preferencesDoc, parseFilterPrefs, saveFilterPrefs, type FilterPrefs } from './firebase/preferences'

// Keeps the Filters panel's settings (value floor, Portfolio game toggles, time frame, hidden
// groups) the same on every device signed in to an account: users/{uid}/settings/preferences
// `filters` is the source of truth, and each device both listens to it (a change on the website
// shows up on the phone within a second, and vice versa) and writes its own changes back.
// localStorage (lib/store.ts's persist) still holds a copy, only so a reload doesn't flash the
// defaults before Firestore answers.

const SAVE_DELAY_MS = 600 // the floor is a typed number — don't write on every keystroke

function currentFilters(): FilterPrefs {
  const s = useStore.getState()
  return { calcFloor: s.calcFloor, activeGames: s.activeGames, timeFrame: s.timeFrame, hiddenGroups: s.hiddenGroups }
}

const keyOf = (f: FilterPrefs) =>
  JSON.stringify([f.calcFloor, [...f.activeGames].sort(), f.timeFrame, [...f.hiddenGroups].sort()])

export function startPreferencesSync(userId: string): () => void {
  // Filters as last agreed with Firestore; a store change that matches this is an echo of a
  // remote update being applied, not something to write back.
  let syncedKey: string | null = null
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let ready = false // don't write anything until the account's own filters have been read

  const unsubDoc = onSnapshot(preferencesDoc(userId), (snap) => {
    if (snap.metadata.hasPendingWrites) return // our own write coming back
    const remote = parseFilterPrefs(snap.data()?.filters)
    if (remote) {
      const merged = { ...currentFilters(), ...remote }
      syncedKey = keyOf(merged)
      if (keyOf(currentFilters()) !== syncedKey) useStore.setState(merged)
    } else if (!ready) {
      // Account has never saved filters — this device's become the account's.
      syncedKey = null
    }
    if (!ready) {
      ready = true
      if (!remote) scheduleSave()
    }
  }, (err) => console.error('Failed to sync filters:', err))

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      const f = currentFilters()
      const key = keyOf(f)
      if (key === syncedKey) return
      syncedKey = key
      saveFilterPrefs(userId, f).catch((err) => console.error('Failed to save filters:', err))
    }, SAVE_DELAY_MS)
  }

  const unsubStore = useStore.subscribe((state, prev) => {
    if (!ready) return
    if (
      state.calcFloor === prev.calcFloor &&
      state.activeGames === prev.activeGames &&
      state.timeFrame === prev.timeFrame &&
      state.hiddenGroups === prev.hiddenGroups
    ) return
    if (keyOf(currentFilters()) === syncedKey) return
    scheduleSave()
  })

  return () => {
    unsubDoc()
    unsubStore()
    if (saveTimer) clearTimeout(saveTimer)
  }
}
