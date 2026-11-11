# The iPhone app (Capacitor)

Started 2026-11-04. The first half is how it works; **[Status & plan](#status--plan)** (below) is where it stands and what's next.

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
| `ios/App/App/CardScanner.swift` | The card scanner (our own local plugin, `CardScanner`): camera, card finding/flattening, OCR, picture comparison, the tray. Registered by `TCGBridgeViewController` (created in `SceneDelegate`). Site side: `lib/scan/`. Plan, design and test results: `card-scanner.md` |

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
  Apple portal + Firebase setup in `"Status & plan" below`).
- Google's URL scheme (the iOS client's `REVERSED_CLIENT_ID`) is in `Info.plist` →
  `CFBundleURLTypes`; the Google SDK refuses to start without it.
- **SPM settings** (`experimental.ios.spm` in `capacitor.config.ts`, from the plugin's README):
  the auth plugin is symlinked (avoids a package-name clash) and only its `Google` trait is on — the
  Facebook SDK is not linked.
- **Haptics so far:** a selection tick per phone pin-book page turn / chapter jump, a light tap when
  a pin opens in 3D.

- **Local plugins:** our own native code (the card scanner) is a Capacitor plugin compiled into the
  app target, registered in `TCGBridgeViewController.capacitorDidLoad()` — not an npm package, so
  `npx cap sync` doesn't touch it. A new Swift file must be added to the Xcode project
  (`project.pbxproj`: file reference, group, Sources phase) — the project doesn't auto-include files.
- **Camera:** `NSCameraUsageDescription` in `Info.plist` is the text of the permission prompt.

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
  fails the same-device check until universal links are set up (`"Status & plan" below`).

---

## Status & plan

_Last updated 2026-11-04. Pick up here when the new MacBook arrives (~2026-11-06)._

---

### The plan in one paragraph

TCGHaven goes in the App Store as a **Capacitor** app: a native iPhone shell (built in **Xcode**)
that shows the live site, `https://www.tcghaven.org`. Fixes pushed to main reach the app as soon as
Vercel deploys them; only native changes need a new build and App Review. What makes it a real app
rather than a website in a box (Apple rule 4.2): **native Google + Apple sign-in, haptics, the iOS
share sheet and push notifications** — and the **card scanner** (native camera + Vision + an on-device picture AI; `card-scanner.md`, `scanner-ai.md`). It's been running on the owner's iPhone since 2026-11-09; test builds install over Wi-Fi (`card-scanner.md` "Trying it"). No Expo — it
was tried and dropped on 2026-11-04 (not needed for a web app).

---

### ✅ Done (2026-11-04)

**App Store requirements on the website** (all live on www.tcghaven.org)
- **Delete account** (Apple rule 5.1.1) — Settings ⚙️ → Delete account. Two factors: an emailed
  confirmation link (same device, within an hour) **and** the password / Google sign-in again.
  The Owner account can't be deleted from the app. Firestore rules deployed. Firebase
  "Email link (passwordless sign-in)" switched on.
- **Privacy policy** — `/privacy` (public), contact **support@tcghaven.org**, linked from Settings.

**The iPhone project** (in this repo, ready for Xcode — nothing has been built yet)
- Capacitor 8 + Swift Package Manager: `capacitor.config.ts`, `ios/`, `ios-shell/` (offline page).
- App ID **`com.alexhparks.tcghaven`**, name **TCGHaven**, icon (the door artwork) and a parchment
  launch screen with the door logo.
- Plugins: haptics, share, app, splash screen, status bar, and `@capacitor-firebase/authentication`
  for native Google + Apple sign-in (Google SDK only — the Facebook SDK is left out).
- Firebase: an iOS app is registered in project `tcghaven-85a34`; its `GoogleService-Info.plist` is
  in the Xcode project, and Google's URL scheme is in `Info.plist`.
- Export compliance answered in `Info.plist` (standard HTTPS only — no form on every upload).

**The site's side of the app** (`lib/nativeApp.ts` — does nothing in a normal browser)
- Native Google sign-in in the app (login, sign-up, and the delete-account re-check).
- Haptics: a tick per page turn in the phone pin book, a tap when a pin opens in 3D.
- The launch screen comes down as soon as the site has drawn.
- Share sheet and Sign in with Apple helpers are written, not wired to buttons yet.

**Automatic checks before deploying** (live): every push to main runs `.github/workflows/checks.yml`
(typecheck, lint, tests, production build); Vercel's Deployment Checks keep a new version off
www.tcghaven.org until it passes. GitHub CLI (`gh`) is set up on this Mac — install and
`gh auth login` on the new one.

**Phone pin book fixes** (live): smooth page turns, pins no longer swapping mid-turn — still to be
confirmed on a real iPhone.

---

### ▶️ Day 1 on the new MacBook (in this order)

_2026-11-08: steps 1–2 done on the new Mac (Xcode 27.2; `xcodebuild -runFirstLaunch` was also needed). The app builds for the simulator. Signing team set and Sign in with Apple added (step 3 done). Next: steps 4–5 (Developer Mode, ▶︎ Run). The card scanner is built — see `card-scanner.md` "Trying it"._

1. **Install Xcode** from the Mac App Store (free, ~15 GB+). Open it once, accept the license, and
   let it install the **iOS** platform (Xcode → Settings → Components).
2. **Get the project:** `git clone` (or pull) TCGHaven into `~/Developer/TCGHaven`, then copy
   **`.env.local`** over from this Mac (it's not in git), then:
   ```bash
   cd ~/Developer/TCGHaven
   npm install
   npx cap sync ios
   npx cap open ios
   ```
3. **In Xcode** (target **App** → **Signing & Capabilities**):
   - **Team:** pick your Apple Developer team. Leave "Automatically manage signing" on.
   - **+ Capability → Sign in with Apple.**
4. **On the iPhone:** Settings → Privacy & Security → **Developer Mode** → on (it restarts), and
   Settings → Apps → Safari → Advanced → **Web Inspector** → on.
5. **Plug the iPhone in**, choose it at the top of Xcode, press **▶︎ Run**. TCGHaven installs and
   opens on the phone.
6. **Then tell Claude** — it'll test on the real phone (Safari's Develop menu can inspect the app in
   debug builds): the pin book turn, sign-in, haptics, links, offline page, rotating the phone.

---

### 📋 Still to do, after Day 1

| # | What | Who | Notes |
|---|---|---|---|
| 1 | **Test on the real iPhone** — pin book smoothness, everything in step 6 | Claude, with your phone | Fix whatever shows up |
| 2 | **Sign in with Apple** (required by Apple rule 4.8 because Google sign-in is offered) | You: Apple Developer portal + Firebase console (Claude walks you through it). Claude: buttons on login/sign-up/Settings, the delete-account re-check | Native app needs only the capability + Apple enabled in Firebase. The **website** also needs a Services ID + key (`.p8` → Firebase console and 1Password, never chat). Apple also requires **revoking the Apple token when an account is deleted** — add to `deleteAccount` |
| 3 | **Universal links** — tcghaven.org links open the app | Claude; you look up your **Team ID** (developer.apple.com → Membership) | Serve `/.well-known/apple-app-site-association`, add the Associated Domains capability (`applinks:www.tcghaven.org`, `applinks:tcghaven.org`), handle opened links with `@capacitor/app`. **Needed before submission:** the delete-account email link must open in the app, or App Review can't finish deleting an account |
| 4 | **Push notifications** — friend requests, a badge tier unlocked, big price moves | You: APNs key in the Apple portal → Firebase Cloud Messaging. Claude: the rest | Needs a server-side sender (a Vercel route with a Firebase service account — a new secret, set in Vercel, never in chat) and per-device tokens in Firestore (+ rules). Design together first |
| 5 | **Share sheet buttons** — your profile, Pin Display, friend QR | Claude | `shareLink()` is ready |
| 6 | **More haptics** — badge unlocks, tier changes, toasts | Claude | `haptic()` is ready |
| 7 | **Test account deletion end-to-end** | You + Claude | With a **new throwaway account** (e.g. `alexhparks+tcgtest@gmail.com`) — **never your real account** |
| 8 | **Full-size app icon** | You | The door artwork at **1024 × 1024 or bigger** — the current icon is the 512 px one scaled up and looks slightly soft |
| 9 | **App Store Connect listing** | You (Claude drafts the text) | App record (name, bundle ID `com.alexhparks.tcghaven`), description, keywords, category, age rating, privacy answers (email, name, collection data, user ID; no tracking, no ads), support URL, privacy URL `https://www.tcghaven.org/privacy`, screenshots |
| 10 | **Demo account for App Review** | You | Sign-up is invite-only, so reviewers need a ready-made account (entered in App Store Connect) |
| 11 | **TestFlight → submit for review** | You (Xcode → Product → Archive → Distribute) | |

### ❓ Decisions to make

- **iPad?** The project currently allows iPad too. Keeping it means iPad screenshots for the listing
  and review on an iPad. iPhone-only for v1 is simpler (Xcode → General → Supported Destinations).
- **Push notifications:** which events notify, and can people turn each one off?
- **Store category:** Entertainment, Lifestyle or Reference?

### ⚠️ Risks to know about

- **Apple rule 4.2 (minimum functionality):** apps that are only a website get rejected. Native
  sign-in, haptics, share and push are our answer — keep the native features real.
- Capacitor's docs call loading a live URL (`server.url`) "not intended for production". Plenty of
  store apps ship this way; the practical risk is the same rule-4.2 point above.
- **Invite-only sign-up** is allowed, but App Review needs a demo account (step 10).

### Cleanup (optional)

- The Expo project **`tcghaven`** on expo.dev (from the dropped Expo attempt) isn't used — delete it
  there if you like. The Firebase iOS app registration **is** used — keep it.
