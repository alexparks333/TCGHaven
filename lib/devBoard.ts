// Dev only (the Dev panel's Community tab → Badge Achievements boards on this device): fake earners
// that slide onto every board on the page, so the board and its animation can be tried without anyone
// really earning a badge. Nothing is saved — a reload clears them.

export const DEV_EARNER_EVENT = 'tcghaven-dev-earner'
export const DEV_EARNER_CLEAR_EVENT = 'tcghaven-dev-earner-clear'

export interface DevEarner { key: string; name: string; at: number; badge?: string /* else a random one from the book */ }

const NAMES = ['Riley Hart', 'Sam Okafor', 'Jordan Vale', 'Casey Lin', 'Morgan Reyes', 'Taylor Brooks', 'Avery Kim', 'Quinn Patel', 'Drew Moss', 'Jamie Cole', 'Rowan Price', 'Skyler Shaw']

export function fakeEarner(name?: string): DevEarner {
  return { key: 'dev-' + Math.random().toString(36).slice(2, 9), name: name?.trim() || NAMES[Math.floor(Math.random() * NAMES.length)], at: Date.now() }
}

export function sendDevEarner(e: DevEarner = fakeEarner()) {
  window.dispatchEvent(new CustomEvent<DevEarner>(DEV_EARNER_EVENT, { detail: e }))
}
export function clearDevEarners() { window.dispatchEvent(new Event(DEV_EARNER_CLEAR_EVENT)) }
