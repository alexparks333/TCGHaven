import crypto from 'node:crypto'
import { doc, getDoc, updateDoc, deleteField } from 'firebase/firestore'
import { db } from './firebase/config'
import { ensureAdminAuth } from './firebase/adminAuth'
import { toPushDevices, type PushKind } from './pushRules'

// Push notifications on the server: sends through Firebase Cloud Messaging (HTTP v1), which
// reaches both the iPhone app (via APNs) and the Android app. No firebase-admin: the access
// token comes from the service account's key, signed here (RS256) and swapped at Google for a
// short-lived token. FIREBASE_SERVICE_ACCOUNT = the service account JSON (Vercel env / .env.local —
// a secret: 1Password, never in chat or git). Unset = pushes quietly do nothing.
// docs/push-notifications.md

interface ServiceAccount { client_email: string; private_key: string; project_id: string }

function serviceAccount(): ServiceAccount | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT
  if (!raw) return null
  try {
    const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')
    const j = JSON.parse(text)
    return j.client_email && j.private_key && j.project_id ? j : null
  } catch {
    return null
  }
}

export const pushConfigured = () => serviceAccount() !== null

let tokenCache: { token: string; until: number } | null = null

async function accessToken(sa: ServiceAccount): Promise<string> {
  if (tokenCache && tokenCache.until > Date.now() + 60_000) return tokenCache.token
  const now = Math.floor(Date.now() / 1000)
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  })}`
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key).toString('base64url')
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
  })
  const data = await res.json()
  if (!res.ok || !data.access_token) throw new Error(`Google token: ${data.error_description ?? data.error ?? res.status}`)
  tokenCache = { token: data.access_token, until: Date.now() + (Number(data.expires_in) || 3600) * 1000 }
  return tokenCache.token
}

export interface PushMessage { title: string; body: string; link: string }

/** Sends to every device the person has turned notifications on for, if they want this kind.
 *  Devices FCM no longer knows (app deleted, token replaced) are dropped from their list.
 *  Returns how many devices it reached. */
export async function sendPush(uid: string, kind: PushKind, msg: PushMessage): Promise<number> {
  const sa = serviceAccount()
  if (!sa) return 0
  await ensureAdminAuth()
  const ref = doc(db, 'push_devices', uid)
  const devices = toPushDevices((await getDoc(ref)).data())
  if (!devices.prefs[kind]) return 0
  const entries = Object.entries(devices.tokens)
  if (entries.length === 0) return 0
  const token = await accessToken(sa)
  let reached = 0
  const dead: string[] = []
  await Promise.all(entries.map(async ([key, d]) => {
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          token: d.token,
          notification: { title: msg.title, body: msg.body },
          data: { link: msg.link, kind },
          apns: { payload: { aps: { sound: 'default' } } },
          android: { priority: 'high', notification: { sound: 'default', tag: kind } },
        },
      }),
    })
    if (res.ok) { reached++; return }
    const err = await res.json().catch(() => ({}))
    const code = err?.error?.details?.find?.((x: { errorCode?: string }) => x.errorCode)?.errorCode
    if (res.status === 404 || code === 'UNREGISTERED' || code === 'INVALID_ARGUMENT') dead.push(key)
    else console.error('FCM send failed:', res.status, err?.error?.message)
  }))
  if (dead.length) {
    await updateDoc(ref, Object.fromEntries(dead.map((k) => [`tokens.${k}`, deleteField()]))).catch(() => {})
  }
  return reached
}
