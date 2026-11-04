import { useCallback, useRef, useState } from 'react'
import { Linking, Pressable, Share, StyleSheet, Text, View } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import * as SplashScreen from 'expo-splash-screen'
import * as Haptics from 'expo-haptics'
import Constants from 'expo-constants'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'
import { GoogleSignin, isSuccessResponse, isErrorWithCode, statusCodes } from '@react-native-google-signin/google-signin'
import type { ShouldStartLoadRequest, WebViewOpenWindowEvent } from 'react-native-webview/lib/WebViewTypes'

// The library types its props as `props & P` with P = undefined, which TypeScript 6 reads as never
type Web = WebView<object>

// The whole app is the live site in a full-screen web view (the site handles the notch and home
// bar itself — viewportFit: cover + env(safe-area-inset-*)). The site talks to the app through
// window.ReactNativeWebView.postMessage — see lib/nativeApp.ts in the web app for the other side.

SplashScreen.preventAutoHideAsync()
SplashScreen.setOptions({ fade: true, duration: 300 })

const SITE_URL: string = Constants.expoConfig?.extra?.siteUrl ?? 'https://www.tcghaven.org'
const INSPECTABLE = !!Constants.expoConfig?.extra?.inspectable
const APP_VERSION = Constants.expoConfig?.version ?? '1.0.0'
// Pages that stay inside the app; any other site opens in Safari. The Firebase host is the
// sign-in handler (and the email links it sends).
const APP_HOSTS = new Set([new URL(SITE_URL).host, 'tcghaven.org', 'www.tcghaven.org', 'tcghaven-85a34.firebaseapp.com'])
const PARCHMENT = '#d9c6a0'

// Google blocks its sign-in page inside apps' web views, so the app signs in with Google's own iOS
// sheet and hands the site the ID token (it signs in to Firebase with it — lib/nativeApp.ts).
// Client IDs (public, not secrets): the iOS one Firebase made for this app, and the project's web
// one, which the ID token is issued to so Firebase accepts it.
GoogleSignin.configure({
  iosClientId: '339578847949-pb2ev535hahiv13jb95qrnp4s797b8re.apps.googleusercontent.com',
  webClientId: '339578847949-m0vq6ep0b6239rhho9g4i8pbojr12r0r.apps.googleusercontent.com',
})

type Message =
  | { type: 'haptic'; kind: HapticKind }
  | { type: 'share'; url?: string; message?: string; title?: string }
  | { type: 'googleSignIn' }
type HapticKind = 'light' | 'medium' | 'heavy' | 'soft' | 'rigid' | 'selection' | 'success' | 'warning' | 'error'

function haptic(kind: HapticKind) {
  if (kind === 'selection') return Haptics.selectionAsync()
  if (kind === 'success' || kind === 'warning' || kind === 'error') {
    return Haptics.notificationAsync({ success: Haptics.NotificationFeedbackType.Success, warning: Haptics.NotificationFeedbackType.Warning, error: Haptics.NotificationFeedbackType.Error }[kind])
  }
  const style = { light: Haptics.ImpactFeedbackStyle.Light, medium: Haptics.ImpactFeedbackStyle.Medium, heavy: Haptics.ImpactFeedbackStyle.Heavy, soft: Haptics.ImpactFeedbackStyle.Soft, rigid: Haptics.ImpactFeedbackStyle.Rigid }[kind]
  return style ? Haptics.impactAsync(style) : undefined
}

export default function App() {
  const web = useRef<Web>(null)
  const [failed, setFailed] = useState(false)

  const onMessage = useCallback((e: WebViewMessageEvent) => {
    let msg: Message
    try { msg = JSON.parse(e.nativeEvent.data) } catch { return }
    if (msg.type === 'haptic') haptic(msg.kind)?.catch(() => {})
    if (msg.type === 'share') Share.share({ url: msg.url, message: msg.message ?? msg.url ?? '', title: msg.title }).catch(() => {})
    if (msg.type === 'googleSignIn') googleSignIn().then((reply) => toSite({ type: 'googleSignIn', ...reply }))
  }, [])

  // A reply to the site: a 'tcghaven-native' event on its window
  const toSite = (detail: Record<string, unknown>) => {
    web.current?.injectJavaScript(`window.dispatchEvent(new CustomEvent('tcghaven-native', { detail: ${JSON.stringify(detail)} })); true;`)
  }

  // Only the main page's own navigation is checked: the sign-in handler and the site's frames load as usual
  const onShouldStart = useCallback((req: ShouldStartLoadRequest) => {
    if (!req.isTopFrame) return true
    let url: URL
    try { url = new URL(req.url) } catch { return true }
    if (url.protocol === 'about:' || url.protocol === 'blob:' || url.protocol === 'data:') return true
    if ((url.protocol === 'https:' || url.protocol === 'http:') && APP_HOSTS.has(url.host)) return true
    Linking.openURL(req.url).catch(() => {}) // other sites, mailto:, tel: …
    return false
  }, [])

  const retry = () => { setFailed(false); web.current?.reload() }

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <WebView<object>
        ref={web}
        source={{ uri: SITE_URL }}
        style={styles.web}
        // How the site knows it's in the app (lib/nativeApp.ts)
        applicationNameForUserAgent={`TCGHavenApp/${APP_VERSION}`}
        injectedJavaScriptBeforeContentLoaded={`window.TCGHavenApp = { platform: 'ios', version: ${JSON.stringify(APP_VERSION)} }; true;`}
        onMessage={onMessage}
        onShouldStartLoadWithRequest={onShouldStart}
        // target=_blank links and window.open: out to Safari
        onOpenWindow={(e: WebViewOpenWindowEvent) => { Linking.openURL(e.nativeEvent.targetUrl).catch(() => {}) }}
        setSupportMultipleWindows={false}
        // Feels like an app, not a browser: no rubber-banding of the whole page, no link previews,
        // no back-swipe (it fought the pin book's page swipes)
        bounces={false}
        allowsLinkPreview={false}
        allowsBackForwardNavigationGestures={false}
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
        allowsInlineMediaPlayback
        sharedCookiesEnabled
        webviewDebuggingEnabled={INSPECTABLE}
        onLoadEnd={() => { SplashScreen.hideAsync().catch(() => {}) }}
        onError={() => { setFailed(true); SplashScreen.hideAsync().catch(() => {}) }}
        // iOS can stop a web view in the background to free memory; reopening showed a blank page
        onContentProcessDidTerminate={() => web.current?.reload()}
      />
      {failed && (
        <View style={styles.offline}>
          <Text style={styles.title}>Can’t reach TCGHaven</Text>
          <Text style={styles.body}>Check your connection, then try again.</Text>
          <Pressable onPress={retry} style={({ pressed }) => [styles.button, pressed && { opacity: 0.7 }]}>
            <Text style={styles.buttonText}>Try again</Text>
          </Pressable>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: PARCHMENT },
  web: { flex: 1, backgroundColor: PARCHMENT },
  offline: { ...StyleSheet.absoluteFill, backgroundColor: PARCHMENT, alignItems: 'center', justifyContent: 'center', padding: 32 },
  title: { fontSize: 20, fontWeight: '700', color: '#2a2118', marginBottom: 8 },
  body: { fontSize: 15, color: '#5b4c3a', textAlign: 'center', marginBottom: 20 },
  button: { backgroundColor: '#2a2118', paddingHorizontal: 22, paddingVertical: 12, borderRadius: 14 },
  buttonText: { color: '#f1d58f', fontSize: 15, fontWeight: '700' },
})

// Google's sheet, every time (signing out of the last one first, so you can pick another account)
async function googleSignIn(): Promise<{ idToken?: string; cancelled?: boolean; error?: string }> {
  try {
    await GoogleSignin.signOut().catch(() => {})
    const res = await GoogleSignin.signIn()
    if (!isSuccessResponse(res)) return { cancelled: true }
    return res.data.idToken ? { idToken: res.data.idToken } : { error: 'Google didn’t return a sign-in token.' }
  } catch (e) {
    if (isErrorWithCode(e) && (e.code === statusCodes.SIGN_IN_CANCELLED || e.code === statusCodes.IN_PROGRESS)) return { cancelled: true }
    return { error: e instanceof Error ? e.message : 'Google sign-in failed.' }
  }
}
