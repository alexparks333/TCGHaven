import type { ExpoConfig } from 'expo/config'

// The TCGHaven iPhone app: a native shell around the live site (App.tsx), built in the cloud by
// EAS (eas.json) — no Xcode needed on this Mac. Web fixes reach the app as soon as they're on
// Vercel; only changes to this folder need a new build.

// Set per build profile in eas.json
const SITE_URL = process.env.TCGHAVEN_SITE_URL ?? 'https://www.tcghaven.org'
// Lets Safari's Web Inspector attach to the app's web view (test builds only, never the store build)
const INSPECTABLE = process.env.TCGHAVEN_INSPECTABLE === '1'

const config: ExpoConfig = {
  name: 'TCGHaven',
  slug: 'tcghaven',
  version: '1.0.0',
  orientation: 'default', // the pin book lays a whole spread out when the phone is turned sideways
  icon: './assets/icon.png',
  userInterfaceStyle: 'light', // the site has one (parchment) look
  backgroundColor: '#d9c6a0',
  ios: {
    bundleIdentifier: 'com.alexhparks.tcghaven',
    supportsTablet: true,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  plugins: [
    // Google's iOS sign-in returns to the app through this URL scheme (the iOS client's reversed ID)
    ['@react-native-google-signin/google-signin', { iosUrlScheme: 'com.googleusercontent.apps.339578847949-pb2ev535hahiv13jb95qrnp4s797b8re' }],
    [
      'expo-splash-screen',
      {
        backgroundColor: '#d9c6a0',
        image: './assets/splash-icon.png',
        imageWidth: 160,
        resizeMode: 'contain',
      },
    ],
  ],
  extra: {
    siteUrl: SITE_URL,
    inspectable: INSPECTABLE,
  },
  owner: 'alexhparks',
}

export default config
