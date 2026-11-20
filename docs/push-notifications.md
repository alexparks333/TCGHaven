# Push notifications

Started 2026-11-19. **Friend requests and friend request accepted only**, in the iPhone and
Android apps (a browser gets none). Sent through Firebase Cloud Messaging (FCM), which reaches
iPhones through Apple's push service (APNs) and Android phones directly.

## How it works

1. **Turning them on** (the app only): the first time someone opens the app signed in, the phone
   asks "Allow notifications?" (`PushSetup`, ~2 s in, after the intro; once per phone —
   `haven:push-asked`). If that was skipped, Settings (the ⚙️ on your profile) → Notifications → Turn on, or the card on the
   Friends page (`PushPrompt`, "Not now" hides it on that phone), ask again. `lib/push.ts` `enablePush()` then saves this phone's FCM token to
   `push_devices/{uid}` → `tokens.{hash}` (`{ token, platform, at }`).
2. **Keeping it current:** on each app start, once signed in, `PushSetup` (in `ClientWrapper`)
   re-saves the token when notifications are already allowed — tokens change now and then. It
   never prompts.
3. **Sending:** `sendFriendRequest()` / `acceptFriendRequest()` (`lib/firebase/friends.ts`) call
   `POST /api/notify/friend { them, kind }` after their write, fire and forget. The route
   (`app/api/notify/friend/route.ts`) never takes the caller's word for it:
   - the `friendships` doc must say so (pending, from the caller, or accepted by the caller) and be
     under 10 minutes old;
   - one push per pair and kind an hour (`push_log`, the server's alone), so cancel-and-resend
     can't spam anyone;
   - the person's `prefs` must want that kind (Settings toggles; both on by default).
   `lib/pushServer.ts` `sendPush()` sends to each of their phones and drops tokens FCM says are gone.
   The kinds (Friend requests / Friend request accepted) are switches in that Notifications
   section (`components/push/PushSettings.tsx`) — on the website too, where they apply to every
   phone and a note says notifications come to the phone app.
4. **Tapping one** opens its page (`data.link`): a request → `/friends?tab=requests`; an accept →
   the friend's profile. `onPushTap()` in `PushSetup`.
5. **Signing out** removes this phone's token (`forgetThisDevice()`, in `AuthProvider.signOut`), so
   the next person on the phone doesn't get the last account's notifications. Deleting the account
   deletes `push_devices/{uid}`.

The server has no firebase-admin: it signs a short JWT with the service account's key (RS256,
`node:crypto`) and swaps it at Google for an access token (scope `firebase.messaging`), then calls
FCM's HTTP v1 API.

## Data and rules

| Doc | Who |
|---|---|
| `push_devices/{uid}` `{ tokens: { [hash]: { token, platform, at } }, prefs: { friendRequests, friendAccepts }, updatedAt }` | The person reads/writes their own; the sync bot reads it and drops dead tokens |
| `push_log/{pair}_{kind}_{recipient}` `{ at }` | Sync bot only |
| `friendships/{pair}` | + the sync bot can read (to check a request is real) |

## Settings that make it work (one-time)

| What | Where | Status |
|---|---|---|
| **APNs key** (.p8): Apple Developer → Keys → + → Apple Push Notifications service. Download it (only once!), keep it in 1Password. Upload it in Firebase console → Project settings → Cloud Messaging → Apple app, with its Key ID and your Team ID | Owner | To do |
| **`FIREBASE_SERVICE_ACCOUNT`**: a service account allowed to send FCM messages (Google Cloud console → IAM → Service accounts → create, role **Firebase Cloud Messaging API Admin**; Keys → Add key → JSON). The whole JSON file's text goes in Vercel's env (Production) and `.env.local` to test. A secret: 1Password, never chat or git. Unset = no pushes, nothing breaks | Owner | To do |
| **iPhone build**: on the Mac, `npx cap sync ios` (adds the messaging Swift package — it can't on Windows), then in Xcode check Signing & Capabilities shows **Push Notifications** and **Background Modes → Remote notifications** (already in `App.entitlements` / `Info.plist`), and build | Owner | To do |
| **Android**: synced (`npx cap sync android`); `google-services.json` is there. Optional later: a white-on-transparent notification icon (`com.google.firebase.messaging.default_notification_icon` in `AndroidManifest.xml`) — without it Android uses the app icon | — | Done |
| **Firestore rules** for `push_devices`, `push_log` and the bot reading `friendships` | Deploy with `--only firestore:rules` | |

## Adding another kind later

Add it to `PUSH_KINDS` (`lib/pushRules.ts` — it becomes a Settings toggle), send it with
`sendPush(uid, kind, { title, body, link })` from a server route that checks the event is real.
