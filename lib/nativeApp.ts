// The TCGHaven iPhone app (Capacitor — capacitor.config.ts, ios/) and the site talking to each
// other. The app shows this live site; Capacitor injects its native bridge into the page, so the
// plugins below work straight from here. In a browser every helper quietly does nothing (or uses
// the browser's own version), and the plugin code is only downloaded inside the app.
// Plan and status: docs/ios-app.md ("Status & plan"); how it works: docs/ios-app.md.

import { Capacitor } from '@capacitor/core'

type HapticKind = 'light' | 'medium' | 'heavy' | 'selection' | 'success' | 'warning' | 'error'

export function inApp(): boolean {
  return typeof window !== 'undefined' && Capacitor.isNativePlatform()
}

/** A tap of the phone's haptics (app only) */
export function haptic(kind: HapticKind = 'light') {
  if (!inApp()) return
  import('@capacitor/haptics').then(async ({ Haptics, ImpactStyle, NotificationType }) => {
    if (kind === 'selection') {
      await Haptics.selectionStart(); await Haptics.selectionChanged(); await Haptics.selectionEnd()
    } else if (kind === 'success' || kind === 'warning' || kind === 'error') {
      await Haptics.notification({ type: { success: NotificationType.Success, warning: NotificationType.Warning, error: NotificationType.Error }[kind] })
    } else {
      await Haptics.impact({ style: { light: ImpactStyle.Light, medium: ImpactStyle.Medium, heavy: ImpactStyle.Heavy }[kind] })
    }
  }).catch(() => { /* no haptics — fine */ })
}

/** The share sheet: the app's native one, else the browser's, else copies the link.
 *  Returns false when nothing could be shared (or the person closed the sheet). */
export async function shareLink(url: string, title?: string): Promise<boolean> {
  try {
    if (inApp()) {
      const { Share } = await import('@capacitor/share')
      await Share.share({ url, title })
      return true
    }
    if (navigator.share) { await navigator.share({ url, title }); return true }
    await navigator.clipboard.writeText(url)
    return true
  } catch {
    return false
  }
}

/** The launch screen stays up (at most a few seconds — capacitor.config.ts) until the site has drawn */
export function hideLaunchScreen() {
  if (!inApp()) return
  import('@capacitor/splash-screen').then(({ SplashScreen }) => SplashScreen.hide({ fadeOutDuration: 250 })).catch(() => {})
}

// Closing a native sign-in sheet rejects with a message like "The user canceled the sign-in flow."
const cancelled = (e: unknown) => /cancel/i.test(e instanceof Error ? e.message : String(e))

/** Google sign-in in the app: Google's own iOS sheet (its web popup is blocked inside apps). The
 *  plugin only hands back the Google ID token (skipNativeAuth) — the site signs in to Firebase with
 *  it, so its session lives in the web SDK like everywhere else. null = the person closed it. */
export async function nativeGoogleIdToken(): Promise<string | null> {
  const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication')
  try {
    const res = await FirebaseAuthentication.signInWithGoogle()
    const token = res.credential?.idToken
    if (!token) throw new Error('Google didn’t return a sign-in token.')
    return token
  } catch (e) {
    if (cancelled(e)) return null
    throw e
  }
}

/** Sign in with Apple in the app (Apple's own sheet): the token and its nonce, for the site to
 *  sign in to Firebase with (OAuthProvider('apple.com').credential({ idToken, rawNonce })). */
export async function nativeAppleCredential(): Promise<{ idToken: string; rawNonce: string } | null> {
  const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication')
  try {
    const res = await FirebaseAuthentication.signInWithApple()
    const idToken = res.credential?.idToken, rawNonce = res.credential?.nonce
    if (!idToken || !rawNonce) throw new Error('Apple didn’t return a sign-in token.')
    return { idToken, rawNonce }
  } catch (e) {
    if (cancelled(e)) return null
    throw e
  }
}
