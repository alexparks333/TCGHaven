// The TCGHaven iPhone app (mobile/ — a native shell around this site, built with Expo/EAS) and the
// site talking to each other. In the app the page has window.ReactNativeWebView (the bridge) and
// window.TCGHavenApp, and its user agent ends in "TCGHavenApp/<version>". In a browser every helper
// here quietly does nothing (or uses the browser's own version).
//
// Messages must match mobile/App.tsx's `Message` type.

type HapticKind = 'light' | 'medium' | 'heavy' | 'soft' | 'rigid' | 'selection' | 'success' | 'warning' | 'error'

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage: (data: string) => void }
    TCGHavenApp?: { platform: 'ios'; version: string }
  }
}

export function inApp(): boolean {
  return typeof window !== 'undefined' && !!window.ReactNativeWebView && !!window.TCGHavenApp
}

function send(msg: Record<string, unknown>) {
  try { window.ReactNativeWebView?.postMessage(JSON.stringify(msg)) } catch { /* the app went away */ }
}

/** A tap of the phone's haptics (app only) */
export function haptic(kind: HapticKind = 'light') {
  if (inApp()) send({ type: 'haptic', kind })
}

/** The share sheet: the app's native one, else the browser's, else copies the link.
 *  Returns false when nothing could be shared (or the person closed the sheet). */
export async function shareLink(url: string, title?: string): Promise<boolean> {
  if (inApp()) { send({ type: 'share', url, title }); return true }
  try {
    if (navigator.share) { await navigator.share({ url, title }); return true }
    await navigator.clipboard.writeText(url)
    return true
  } catch {
    return false
  }
}

/** Google sign-in in the app: Google's own iOS sheet (its web page is blocked inside apps), giving
 *  back a Google ID token to sign in to Firebase with. null = the person closed the sheet. */
export function nativeGoogleIdToken(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const onReply = (e: Event) => {
      const d = (e as CustomEvent).detail as { type?: string; idToken?: string; cancelled?: boolean; error?: string } | undefined
      if (d?.type !== 'googleSignIn') return
      window.removeEventListener('tcghaven-native', onReply)
      if (d.idToken) resolve(d.idToken)
      else if (d.cancelled) resolve(null)
      else reject(new Error(d.error || 'Google sign-in failed.'))
    }
    window.addEventListener('tcghaven-native', onReply)
    send({ type: 'googleSignIn' })
  })
}
