# The iPhone app (`mobile/`)

Started 2026-11-04. A native iPhone shell around the live site, made with **Expo (SDK 58)** and
built in the cloud by **EAS** — no Xcode needed on the Mac (same workflow as AuctionHous). Expo
account: `alexhparks`. Bundle ID `com.alexhparks.tcghaven`. Firebase iOS app
`1:339578847949:ios:bbf0ebbb617abb3c015f84`.

## How it works

- `mobile/App.tsx` is one full-screen `WebView` of `https://www.tcghaven.org` (`TCGHAVEN_SITE_URL`
  overrides it). The site handles the notch/home bar itself (`viewportFit: 'cover'` + safe-area
  insets). **Web changes reach the app as soon as Vercel deploys them; only changes inside
  `mobile/` need a new build.**
- Pages on tcghaven.org (and the Firebase sign-in host) stay in the app; any other site, `mailto:`
  and `target=_blank` links open in Safari.
- No rubber-banding, link previews or back-swipe (the back-swipe fought the pin book's swipes).
  If iOS kills the web view in the background it reloads; offline shows a "Can't reach TCGHaven"
  screen with Try again.
- **The bridge** — the site's side is `lib/nativeApp.ts` (`inApp()`, `haptic()`, `shareLink()`,
  `nativeGoogleIdToken()`); the app's side is `App.tsx`'s `Message` type — keep the two in step.
  The app adds `TCGHavenApp/<version>` to the user agent and sets `window.TCGHavenApp`.
- **Google sign-in**: Google blocks its web popup inside apps, so in the app `signInWithGoogle()`
  (AuthProvider) and the delete-account re-check use Google's native iOS sheet
  (`@react-native-google-signin/google-signin`) and sign in to Firebase with the ID token
  (`signInWithCredential`). Closing the sheet throws `auth/popup-closed-by-user`, like the popup.
- Haptics so far: a tick per phone pin-book page turn, a soft tap when a pin opens in 3D.

## Building (from `mobile/`)

- `npx eas-cli build -p ios --profile preview` — a test build for registered iPhones (its web
  view is inspectable from Safari's Develop menu). First run asks for the Apple Developer login.
- `npx eas-cli device:create` — registers an iPhone for test builds (open the link on the phone).
- `npx eas-cli build -p ios --profile production` then `npx eas-cli submit -p ios` — App Store.
- Typecheck with `npx tsc --noEmit` and `npx expo-doctor` inside `mobile/`. The web app's
  `tsconfig.json` excludes `mobile/`, and `.vercelignore` keeps it out of Vercel uploads.
- `ios/` and `android/` are generated at build time and git-ignored — never edit them.
- Expo changes between SDKs: read `mobile/AGENTS.md` and the versioned docs before touching Expo
  APIs. `WebView<object>` in App.tsx works round the library typing its props `props & undefined`.

## Still to do

Sign in with Apple (App Store rule 4.8), push notifications, wiring the share sheet into the
profile / Pin Display / friend QR, a full-size (1024 px) original of the app icon (the current
one is the 512 px PWA icon scaled up), App Store listing. The delete-account email link opens in
Safari, not the app, so from the app it fails the same-device check — needs universal links.
