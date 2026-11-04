# The iPhone app (Capacitor)

Started 2026-11-04. **Status, plan and next steps: `IOSAppDev.md` at the repo root.** This file is
how it works.

A native iPhone shell around the live site, made with **Capacitor 8** (Swift Package Manager, no
CocoaPods) and built in **Xcode**. (An Expo version was tried first the same day and dropped — the
owner prefers plain Xcode; Expo isn't needed for a web app.)

- Bundle ID `com.alexhparks.tcghaven` · display name **TCGHaven**
- Firebase iOS app `1:339578847949:ios:bbf0ebbb617abb3c015f84` (its config is
  `ios/App/App/GoogleService-Info.plist` — public identifiers, not secrets)

## Files

| File | What |
|---|---|
| `capacitor.config.ts` | The app's settings: loads `https://www.tcghaven.org` (`server.url`), which hosts stay inside the app (`allowNavigation`), launch screen, plugins |
| `ios/` | The Xcode project Capacitor generated — open **`ios/App/App.xcodeproj`** (Swift packages, no CocoaPods workspace). Ours to edit: `Info.plist`, `AppDelegate.swift` / `SceneDelegate.swift`, `Assets.xcassets` (icon, splash). Generated (git-ignored): `App/App/public`, `App/App/capacitor.config.json` |
| `ios-shell/` | The only web files bundled in the app: `offline.html` (shown when the site can't be reached — `server.errorPath`) and an `index.html` that just redirects to the site |
| `lib/nativeApp.ts` | The site's side of the bridge: `inApp()`, `haptic()`, `shareLink()`, `hideLaunchScreen()`, `nativeGoogleIdToken()`, `nativeAppleCredential()` |

## How it works

- The app shows the **live site**. A fix pushed to main reaches the app as soon as Vercel deploys it
  — no new build, no App Review. **Only native changes need a new build:** `capacitor.config.ts`,
  `ios/`, adding/updating a Capacitor plugin.
- Capacitor injects its bridge into the page, so `lib/nativeApp.ts` calls the plugins straight from
  the site. Plugin code is loaded with dynamic `import()` only when `inApp()` — browsers never
  download it. `Capacitor.isNativePlatform()` is the test.
- **Links:** hosts in `allowNavigation` stay in the app (tcghaven.org, www.tcghaven.org, the
  Firebase sign-in host); every other site opens in Safari (Capacitor's default).
- The site handles the notch/home bar itself (`viewportFit: 'cover'` + `env(safe-area-inset-*)`),
  so `ios.contentInset` is `never`.
- **Launch screen:** auto-hides after at most 3 s; the site hides it sooner once it has drawn
  (`hideLaunchScreen()` in `ClientWrapper`).
- **Sign-in:** Google blocks its web popup inside apps, so in the app `signInWithGoogle()`
  (AuthProvider) and the delete-account re-check (`confirmIdentity`) use
  `@capacitor-firebase/authentication`'s native Google sheet with `skipNativeAuth: true` — the
  plugin only returns the ID token and the site signs in to Firebase with it
  (`signInWithCredential`), so the session lives in the Firebase web SDK exactly as on the website.
  Closing the sheet throws `auth/popup-closed-by-user`, like closing the web popup.
  Sign in with Apple works the same way (`nativeAppleCredential()` → `OAuthProvider('apple.com')
  .credential({ idToken, rawNonce })`) — wired on the native side, not yet on the site (needs the
  Apple portal + Firebase setup in `IOSAppDev.md`).
- Google's URL scheme (the iOS client's `REVERSED_CLIENT_ID`) is in `Info.plist` →
  `CFBundleURLTypes`; the Google SDK refuses to start without it.
- **SPM settings** (`experimental.ios.spm` in `capacitor.config.ts`, from the plugin's README):
  the auth plugin is symlinked (avoids a package-name clash) and only its `Google` trait is on — the
  Facebook SDK is not linked.
- **Haptics so far:** a selection tick per phone pin-book page turn / chapter jump, a light tap when
  a pin opens in 3D.

## Commands

```bash
npx cap sync ios        # after changing capacitor.config.ts or adding/updating a plugin
npx cap open ios        # opens the project in Xcode
```

The web app's `tsconfig.json` excludes `ios/`; `.vercelignore` keeps it out of Vercel uploads.

## Gotchas

- Capacitor's docs call `server.url` "not intended for production". Many store apps ship this way;
  Apple's objection is to apps that are only a website (rule 4.2) — native sign-in, haptics, share
  and push are what make TCGHaven more than that. Keep adding real native value.
- The Capacitor 8 template is scene-based: incoming URLs arrive in `SceneDelegate`
  (forwarded by `SceneDelegateProxy`), not the AppDelegate method older plugin docs show.
- The delete-account confirmation email link opens in Safari, not the app, so from the app it
  fails the same-device check until universal links are set up (`IOSAppDev.md`).
