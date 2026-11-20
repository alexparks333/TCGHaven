import type { CapacitorConfig } from '@capacitor/cli'

// The TCGHaven iPhone app (Capacitor): a native shell that shows the live site, so a fix on Vercel
// reaches the app with no new build or review. Only native changes (this file, ios/, plugins)
// need a rebuild in Xcode. The plan and status: docs/ios-app.md ("Status & plan"); how it works: docs/ios-app.md.
// Dev mode (npm run ios:dev): CAP_DEV_URL=http://<this Mac's Wi-Fi IP>:3000 at `cap sync` time makes
// the phone load the Mac's dev server instead of the live site, so a code change shows on the phone
// in seconds with no push. Baked into the generated ios/App/App/capacitor.config.json (git-ignored)
// until the next plain `npx cap sync ios` (npm run ios:live) — run that before any TestFlight /
// App Store build.
const devUrl = process.env.CAP_DEV_URL
const devHost = devUrl ? new URL(devUrl).host.split(':')[0] : null

const config: CapacitorConfig = {
  appId: 'com.alexhparks.tcghaven',
  appName: 'TCGHaven',
  // What's bundled inside the app: only the offline page (the app shows the live site below)
  webDir: 'ios-shell',
  backgroundColor: '#d9c6a0', // the site's parchment, behind the page while it loads
  appendUserAgent: 'TCGHavenApp', // lets the site's logs and analytics tell app visits apart
  server: {
    url: devUrl || 'https://www.tcghaven.org',
    ...(devUrl ? { cleartext: true } : {}),
    // Pages allowed inside the app; any other site opens in Safari. The Firebase host is the
    // sign-in handler (and the links in its emails).
    allowNavigation: ['tcghaven.org', 'www.tcghaven.org', 'tcghaven-85a34.firebaseapp.com', ...(devHost ? [devHost] : [])],
    errorPath: 'offline.html',
  },
  ios: {
    contentInset: 'never', // the site handles the notch and home bar itself (viewportFit: cover)
    allowsLinkPreview: false,
    // Test builds let Safari's Web Inspector attach (true by default for debug builds); never
    // the App Store build
    webContentsDebuggingEnabled: false,
  },
  experimental: {
    ios: {
      spm: {
        // From the Firebase sign-in plugin's instructions: avoid a Swift package name clash, and
        // link only Google's sign-in SDK (not Facebook's — never used, and it collects data)
        swiftToolsVersion: '6.1',
        packageTraits: { '@capacitor-firebase/authentication': ['Google'] },
        packageOptions: {
          '@capacitor-firebase/authentication': { symlink: true },
          '@capacitor-firebase/messaging': { symlink: true }, // the same clash, from its instructions
        },
      },
    },
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 3000, // at most — the site hides it sooner, once it has drawn
      launchAutoHide: true, // so a site that never loads can't leave it up (lib/nativeApp.ts hideLaunchScreen)
      backgroundColor: '#d9c6a0',
    },
    // Push notifications (lib/push.ts): shown even while the app is open
    FirebaseMessaging: { presentationOptions: ['alert', 'badge', 'sound'] },
    FirebaseAuthentication: {
      // Native Google / Apple sheets only hand back a token; the site signs in to Firebase with it
      // (its web SDK owns the session), so the native Firebase SDK never signs in itself
      skipNativeAuth: true,
      providers: ['google.com', 'apple.com'],
    },
  },
}

export default config
