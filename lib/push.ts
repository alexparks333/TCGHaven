import { doc, getDoc, setDoc, updateDoc, deleteField, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase/config'
import { inApp } from './nativeApp'
import { toPushDevices, type PushDevices, type PushKind } from './pushRules'

// Push notifications in the app (iPhone + Android, @capacitor-firebase/messaging). Only the apps
// get them — a browser does nothing here. This device's FCM token is saved in push_devices/{uid}
// (keyed by a short hash of it); the server (lib/pushServer.ts) sends to it. Plugin code is only
// downloaded inside the app. docs/push-notifications.md

export type PushPermission = 'granted' | 'denied' | 'prompt' | 'unsupported'

// Resolves to the MODULE, never the plugin itself: a promise that resolves to a Capacitor plugin
// makes JS ask the plugin for .then(), and iOS answers "FirebaseMessaging.then() is not
// implemented on ios" (2026-11-20). Take the plugin out after the await: (await plugin()).FirebaseMessaging
const plugin = () => import('@capacitor-firebase/messaging')

async function keyOf(token: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(hash).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('')
}

async function platform(): Promise<string> {
  const { Capacitor } = await import('@capacitor/core')
  return Capacitor.getPlatform()
}

export async function pushPermission(): Promise<PushPermission> {
  if (!inApp()) return 'unsupported'
  try {
    const { receive } = await (await plugin()).FirebaseMessaging.checkPermissions()
    return receive === 'granted' ? 'granted' : receive === 'denied' ? 'denied' : 'prompt'
  } catch {
    return 'unsupported'
  }
}

async function saveToken(uid: string, token: string) {
  await setDoc(doc(db, 'push_devices', uid), {
    tokens: { [await keyOf(token)]: { token, platform: await platform(), at: Date.now() } },
    updatedAt: serverTimestamp(),
  }, { merge: true })
}

/** Asks the phone for permission (the system prompt, once) and registers this device.
 *  Returns the permission afterwards. */
export async function enablePush(uid: string): Promise<PushPermission> {
  if (!inApp()) return 'unsupported'
  const m = (await plugin()).FirebaseMessaging
  const { receive } = await m.requestPermissions()
  if (receive !== 'granted') return receive === 'denied' ? 'denied' : 'prompt'
  const { token } = await m.getToken()
  if (token) await saveToken(uid, token)
  return 'granted'
}

/** On each app start: when notifications are already allowed, keep this device's token current
 *  (tokens change now and then). Never shows a prompt. Returns a cleanup. */
export function keepPushToken(uid: string): () => void {
  if (!inApp()) return () => {}
  let stop = () => {}
  let live = true
  plugin().then(async ({ FirebaseMessaging: m }) => {
    if ((await m.checkPermissions()).receive !== 'granted' || !live) return
    const { token } = await m.getToken()
    if (token) await saveToken(uid, token)
    const h = await m.addListener('tokenReceived', (e) => { saveToken(uid, e.token).catch(() => {}) })
    if (live) stop = () => { h.remove() }
    else h.remove()
  }).catch(() => {})
  return () => { live = false; stop() }
}

/** Tapping a notification opens the page it's about (its data.link). Returns a cleanup. */
export function onPushTap(open: (link: string) => void): () => void {
  if (!inApp()) return () => {}
  let stop = () => {}
  let live = true
  plugin().then(async ({ FirebaseMessaging: m }) => {
    const h = await m.addListener('notificationActionPerformed', (e) => {
      const link = (e.notification?.data as { link?: unknown } | undefined)?.link
      if (typeof link === 'string' && link.startsWith('/')) open(link)
    })
    if (live) stop = () => { h.remove() }
    else h.remove()
  }).catch(() => {})
  return () => { live = false; stop() }
}

/** Signing out: this phone stops getting that account's notifications. */
export async function forgetThisDevice(uid: string): Promise<void> {
  if (!inApp()) return
  try {
    const m = (await plugin()).FirebaseMessaging
    if ((await m.checkPermissions()).receive !== 'granted') return
    const { token } = await m.getToken()
    if (token) await updateDoc(doc(db, 'push_devices', uid), { [`tokens.${await keyOf(token)}`]: deleteField() })
    await m.deleteToken()
  } catch { /* no doc or no plugin — nothing to forget */ }
}

export async function loadPushSettings(uid: string): Promise<PushDevices> {
  return toPushDevices((await getDoc(doc(db, 'push_devices', uid))).data())
}

export async function savePushPref(uid: string, kind: PushKind, on: boolean): Promise<void> {
  await setDoc(doc(db, 'push_devices', uid), { prefs: { [kind]: on }, updatedAt: serverTimestamp() }, { merge: true })
}
