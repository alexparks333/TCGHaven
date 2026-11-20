// Push notifications — the shapes shared by the app (lib/push.ts) and the server (lib/pushServer.ts).
// One doc per person, push_devices/{uid}: the devices they turned notifications on for (keyed by
// a short hash of the FCM token) and which kinds they want. docs/push-notifications.md

export type PushKind = 'friendRequests' | 'friendAccepts'

export const PUSH_KINDS: Array<{ kind: PushKind; label: string; hint: string }> = [
  { kind: 'friendRequests', label: 'Friend requests', hint: 'When someone sends you a friend request' },
  { kind: 'friendAccepts', label: 'Friend request accepted', hint: 'When someone accepts your friend request' },
]

export interface PushDevice { token: string; platform: string; at: number }
export interface PushDevices { tokens: Record<string, PushDevice>; prefs: Record<PushKind, boolean> }

export function toPushDevices(d: Record<string, unknown> | undefined): PushDevices {
  const tokens: Record<string, PushDevice> = {}
  const raw = (d?.tokens ?? {}) as Record<string, Partial<PushDevice>>
  for (const [k, v] of Object.entries(raw)) {
    if (v && typeof v.token === 'string' && v.token) tokens[k] = { token: v.token, platform: String(v.platform ?? ''), at: Number(v.at) || 0 }
  }
  const prefs = (d?.prefs ?? {}) as Partial<Record<PushKind, boolean>>
  return { tokens, prefs: { friendRequests: prefs.friendRequests !== false, friendAccepts: prefs.friendAccepts !== false } }
}
