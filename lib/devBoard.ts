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

// Fake members for the Members column, the same way (Dev panel → Community → Members)
export const DEV_MEMBER_EVENT = 'tcghaven-dev-member'
export const DEV_MEMBER_CLEAR_EVENT = 'tcghaven-dev-member-clear'
export interface DevMember { key: string; name: string; at: number; badges: number /* 0–1: share of the book's badges */; cards: number }
export function sendDevMember(name?: string) {
  const e: DevMember = { ...fakeEarner(name), badges: Math.random(), cards: Math.floor(Math.random() * 40) }
  window.dispatchEvent(new CustomEvent<DevMember>(DEV_MEMBER_EVENT, { detail: e }))
}
export function clearDevMembers() { window.dispatchEvent(new Event(DEV_MEMBER_CLEAR_EVENT)) }
