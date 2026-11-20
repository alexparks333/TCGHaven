import { addDoc, collection, doc, getDocs, limit, orderBy, query, serverTimestamp, updateDoc, type Firestore, type Timestamp } from 'firebase/firestore'
import type { Game } from './types'

// Support: what collectors send from /support (components/pages/SupportPage.tsx) — a card missing
// from the catalog, or a question / bug report — saved to `support_requests/{id}` and read by staff
// in the staff portal's Support tab (components/admin/SupportInbox.tsx). Signed-in accounts only
// (firestore.rules: create your own, staff read and update); a signed-out visitor is pointed at the
// support email instead. docs/support.md.

export const SUPPORT_EMAIL = 'support@tcghaven.org'

export type SupportKind = 'missing-card' | 'general'
export type SupportTopic = 'account' | 'bug' | 'billing' | 'other'
export type SupportStatus = 'open' | 'done'

export const SUPPORT_TOPICS: { id: SupportTopic; label: string; hint: string }[] = [
  { id: 'account', label: 'Account status', hint: 'Signing in, your profile, a ban or a block, deleting your account' },
  { id: 'bug', label: 'Bug report', hint: 'Something not working or looking wrong' },
  { id: 'billing', label: 'Billing & Premium', hint: 'Haven Premium, payments, a promo code' },
  { id: 'other', label: 'Something else', hint: 'Anything that isn’t above' },
]

// Lengths the rules enforce too (firestore.rules support_requests) — keep the two in step
export const SUPPORT_LIMITS = { short: 120, message: 4000 } as const

export interface SupportRequest {
  id: string
  kind: SupportKind
  status: SupportStatus
  uid: string
  email: string          // where to answer (the account's email, editable)
  name: string           // the account's display name, for staff
  // missing card
  game?: Game
  setName?: string
  cardName?: string
  number?: string
  // general
  topic?: SupportTopic
  message: string        // the details (a missing card's note may be empty)
  platform: 'app' | 'web'
  page?: string          // where it was sent from (a Cardex/Add Card search link), for context
  createdAt?: Timestamp
}

export type NewSupportRequest = Omit<SupportRequest, 'id' | 'status' | 'createdAt'>

const clip = (s: string | undefined, n: number) => (s ?? '').trim().slice(0, n)

/** Send a report (the collector's own account: `req.uid` must be theirs). Fields are trimmed to the
 *  rules' limits; empty optional fields are left out (Firestore rejects undefined). */
export async function sendSupportRequest(db: Firestore, req: NewSupportRequest): Promise<void> {
  const data: Record<string, unknown> = {
    kind: req.kind,
    status: 'open',
    uid: req.uid,
    email: clip(req.email, SUPPORT_LIMITS.short),
    name: clip(req.name, SUPPORT_LIMITS.short),
    message: clip(req.message, SUPPORT_LIMITS.message),
    platform: req.platform,
    createdAt: serverTimestamp(),
  }
  for (const k of ['setName', 'cardName', 'number', 'page'] as const) {
    const v = clip(req[k], SUPPORT_LIMITS.short)
    if (v) data[k] = v
  }
  if (req.kind === 'missing-card' && req.game) data.game = req.game
  if (req.kind === 'general' && req.topic) data.topic = req.topic
  await addDoc(collection(db, 'support_requests'), data)
}

/** Staff: the newest reports first */
export async function loadSupportRequests(db: Firestore, max = 300): Promise<SupportRequest[]> {
  const snap = await getDocs(query(collection(db, 'support_requests'), orderBy('createdAt', 'desc'), limit(max)))
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<SupportRequest, 'id'>) }))
}

/** Staff: mark a report done (or open again) */
export async function setSupportStatus(db: Firestore, id: string, status: SupportStatus): Promise<void> {
  await updateDoc(doc(db, 'support_requests', id), { status })
}
