# The Android app

_Started 2026-11-11. The owner needs TCGHaven on Android as well as iPhone. Read `ios-app.md`
first: Android is built the same way, and most of what it says applies here too._

## How it works

- **The same Capacitor shell as the iPhone app.** The Android project is in `android/`, next to
  `ios/`. It shows the live site (`capacitor.config.ts` `server.url`), so every website change
  reaches both apps with one push.
- **Same plugins:** sign-in (`@capacitor-firebase/authentication`, Google only:
  `rgcfaIncludeGoogle = true` in `android/variables.gradle`), app links, haptics, share, splash
  screen, status bar.
- **Package name** `com.alexhparks.tcghaven`, the same as the iOS bundle id.
- **Links:** `tcghaven://scan` opens the app's scanner (an intent filter in
  `AndroidManifest.xml`), like iOS's URL scheme.
- **The card scanner needs a native Android version** (step 2 below). Until then, Android has
  everything except the camera scanner.

## Building on the Mac

There's no Android Studio. Everything is installed in the user folder: Java 21 (Temurin) in
`~/.local/jdk21`, and the Android SDK in `~/Library/Android/sdk` (cmdline-tools, platform-tools,
platform 36, build-tools 36). Set these in each shell:

```bash
export JAVA_HOME=~/.local/jdk21/Contents/Home ANDROID_HOME=~/Library/Android/sdk
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
npx cap sync android                          # after a plugin or capacitor.config.ts change
cd android && ./gradlew assembleDebug         # → app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

**The phone over Wi-Fi.** On the phone: Settings → About phone → tap Build number 7 times, then
Developer options → Wireless debugging → Pair device with pairing code. On the Mac, run
`adb pair <ip:port> <code>` once, then `adb connect <ip:port>`. `adb devices` lists the phone.

**Sign-in needs Firebase to know the app.** The Firebase console needs an Android app with this
package name and the signing key's SHA-1 and SHA-256, and its `google-services.json` must be in
`android/app/`. The test-build key is `~/.android/debug.keystore`. A Play Store release adds Play
App Signing's key, from Play Console → App integrity.

## Plan

| Step | What | Status |
|---|---|---|
| 1 | App shell: shows the site, Google sign-in, QR links | Built 2026-11-11; needs `google-services.json` and a phone to test |
| 2 | Scanner, first version: CameraX, card outline, ML Kit text recognition (Latin + Japanese, on-device), picture AI (the same model as ONNX, ONNX Runtime), the same plugin interface as iOS (`CardScanner`: open / compare / update / searchResults / prepareModel, `cardScanned` events), so `lib/scan/scanner.ts` works unchanged | Next |
| 3 | iPhone-level polish: tray, card sheet (Finish / Condition / Grading / search), steadiness, light, slabs | |
| 4 | (Optional) a scanner in the phone's browser, picture-only, for people with neither app | |
| 5 | Play Store: developer account ($25 one-time), store listing, privacy, release signing | |

## Notes

- Sign-in on Android uses Google's Credential Manager (the plugin's default). With
  `skipNativeAuth`, the site signs in to Firebase with the token, the same as on iOS
  (`AuthProvider.signInWithGoogle`). The login page has no Apple button, so there's no Apple
  sign-in to port.
- `ScanLinkPage` and the website's Scan dialog still say "iPhone app". Change them to "the
  TCGHaven app" once the Android scanner exists.
