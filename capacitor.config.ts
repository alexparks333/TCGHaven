import type { CapacitorConfig } from '@capacitor/cli'

// The TCGHaven iPhone app (Capacitor): a native shell that shows the live site, so a fix on Vercel
// reaches the app with no new build or review. Only native changes (this file, ios/, plugins)
// need a rebuild in Xcode. The plan and status: IOSAppDev.md; how it works: docs/ios-app.md.
const config: CapacitorConfig = {
  appId: 'com.alexhparks.tcghaven',
  appName: 'TCGHaven',
  // What's bundled inside the app: only the offline page (the app shows the live site below)
  webDir: 'ios-shell',
  backgroundColor: '#d9c6a0', // the site's parchment, behind the page while it loads
  appendUserAgent: 'TCGHavenApp', // lets the site's logs and analytics tell app visits apart
  server: {
    url: 'https://www.tcghaven.org',
    // Pages allowed inside the app; any other site opens in Safari. The Firebase host is the
    // sign-in handler (and the links in its emails).
    allowNavigation: ['tcghaven.org', 'www.tcghaven.org', 'tcghaven-85a34.firebaseapp.com'],
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
        packageOptions: { '@capacitor-firebase/authentication': { symlink: true } },
      },
    },
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 3000, // at most — the site hides it sooner, once it has drawn
      launchAutoHide: true, // so a site that never loads can't leave it up (lib/nativeApp.ts hideLaunchScreen)
      backgroundColor: '#d9c6a0',
    },
    FirebaseAuthentication: {
      // Native Google / Apple sheets only hand back a token; the site signs in to Firebase with it
      // (its web SDK owns the session), so the native Firebase SDK never signs in itself
      skipNativeAuth: true,
      providers: ['google.com', 'apple.com'],
    },
  },
}

export default config
