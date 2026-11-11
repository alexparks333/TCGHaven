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
- **The card scanner** (step 2, first version built 2026-11-11) is in `android/app/src/main/java/com/alexhparks/tcghaven/`:
  - `CardScannerPlugin.kt` has the same plugin name, methods and events as the iPhone's, so
    `lib/scan/scanner.ts` drives both unchanged.
  - `ScannerDialog.kt` is the screen:
    - CameraX, with a card-shaped outline. The part inside it is the card, so there's no edge
      finding yet.
    - ML Kit reads the text inside the outline about 4 times a second. On capture it reads again
      in Latin plus Japanese.
    - It captures when the phone is still (gyroscope) and the text is new. The next capture waits
      for different text, or for an empty outline.
    - The tray, the card sheet (other matches, finish, condition, search, remove), and Add N / close.
  - `CardFingerprinter.kt` is the picture AI: the trained model as ONNX, run with ONNX Runtime and
    downloaded once per version (~83 MB, full precision: float16 hung ONNX Runtime and int8 drifted
    to 0.973). Publish it with `npm run scanner-index -- publish-android <onnx>` (made by
    `tools/scanner-ai/convert_onnx.py`). Each new model version needs it again.
  - There's no tile comparison on Android (`compare` returns nulls), so the AI's similarity decides.
- **The emulator:** `TCGHaven_Pixel` (Android 16, Google Play) uses the Mac's webcam as its back
  camera (`hw.camera.back=webcam0`). Start it with `$ANDROID_HOME/emulator/emulator -avd TCGHaven_Pixel`.
  - `adb shell am start -a android.intent.action.VIEW -d tcghaven://scan` opens the scanner the way
    the QR code does.
  - macOS has to allow the emulator to use the camera.

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
| 1 | App shell: shows the site, Google sign-in, QR links | Done 2026-11-11 (Firebase Android app registered, sign-in confirmed by the owner on the emulator) |
| 2 | Scanner, first version: CameraX, card outline, ML Kit text recognition (Latin + Japanese, on-device), picture AI (ONNX), the same plugin interface as iOS | Built 2026-11-11: opens from the app and from the QR link, the model downloads (7 s); scanning real cards not yet tested (the owner has no Android phone yet; the emulator's webcam is the test camera) |
| 3 | iPhone-level polish: tray, card sheet (Finish / Condition / Grading / search), steadiness, light, slabs | |
| 4 | (Optional) a scanner in the phone's browser, picture-only, for people with neither app | |
| 5 | Play Store: developer account ($25 one-time), store listing, privacy, release signing | |

## Notes

- Sign-in on Android uses Google's Credential Manager (the plugin's default). With
  `skipNativeAuth`, the site signs in to Firebase with the token, the same as on iOS
  (`AuthProvider.signInWithGoogle`). The login page has no Apple button, so there's no Apple
  sign-in to port.
- `ScanLinkPage` and the website's Scan dialog say "the TCGHaven app (iPhone or Android)".
- **Not on Android yet:** upside-down cards turned round, finding the card's edges, slab reading,
  debug scans kept on the phone, and the iPhone's zoom and focus tuning. These belong to step 3.
