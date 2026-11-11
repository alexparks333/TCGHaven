// Where to get the TCGHaven app. Fill these in when each store listing goes live — until then the
// site says "coming soon" instead of linking to a store page that doesn't exist yet.
//   App Store: the app's link from App Store Connect → the app → App Information ("View on App Store")
//   Google Play: https://play.google.com/store/apps/details?id=com.alexhparks.tcghaven once published
export const APP_STORE_URL: string | null = null
export const PLAY_STORE_URL: string | null = null

export const ANDROID_PACKAGE = 'com.alexhparks.tcghaven'

export type PhoneKind = 'iphone' | 'android' | null

/** Which kind of phone this browser is on (iPads count as iPhone — same App Store) */
export function phoneKind(): PhoneKind {
  if (typeof navigator === 'undefined') return null
  const ua = navigator.userAgent
  if (/Android/i.test(ua)) return 'android'
  if (/iPhone|iPod|iPad/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua))) return 'iphone'
  return null
}
