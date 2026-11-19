# Haven Premium — the business side

Plain-English notes on how Premium money works and the setup it needs outside the code. The code
side is in `docs/insights.md` (Statistics, Finances, the Haven Premium page) and
`docs/community-and-badges.md` (account titles).

## The plan (2026-11-09)

- **Haven Premium** — monthly **$3.99**, yearly **$34.99** ($2.92 a month, 27% cheaper than paying
  monthly). Set on the staff portal's **Haven Premium** page (`premium/config`); every change is logged.
- **What it unlocks** (still being decided): the current idea is Free = Inventory + Cardex; Premium =
  Friends, Portfolio, Badges. Suggested instead (keeps the app spreading and people coming back):
  keep **Friends** and **earning Badges** free, a **basic Portfolio** free (value + today's change), and
  make Premium the depth — Portfolio P&L history and time windows, Analytics, price history, Pin
  Display / the badges' 3D looks, unlimited scans, following creators.
- **Free Premium:** Creators and Staff get it free; **Permanent Premium** (for people the Owner picks,
  never removed unless the Owner removes it) and **promo codes** (1, 3, 6, 12… free months) are planned.
  When Premium is removed or someone stops paying, it lasts to the end of the month they paid for.

## Decided 2026-11-19 — what Premium unlocks and how it's paid for

- **Name:** stays **Haven Premium** everywhere.
- **Free:** Inventory, Cardex, search, raw prices, Friends, profiles, joining Creator communities,
  earning badges (Grayscale look), basic portfolio value, **10 scans a month**.
- **Premium:** unlimited scans; graded prices (PriceCharting) + price history; badges' Full look,
  3D pins, Pin Display, banner pins; Portfolio over time / P&L / Analytics; CSV export. Suggested:
  a 7-day free trial and a "founding member" price lock.
- **Payments:** RevenueCat ties it together. iPhone = Apple in-app purchase, Android = Google Play
  Billing, website = Stripe Checkout + Stripe's billing portal. RevenueCat's webhook tells our
  server, which keeps the live state in Firestore.
- **Go live only after the LLC, its EIN and a business bank account exist.** Build and test first
  with Stripe test mode and Apple's sandbox.

### How it's built (2026-11-19)

**The launch switch.** `premium/launch { gatesOn }`, turned on and off from the staff portal's
Haven Premium page → **Launch**. While it's off, nothing is locked for anyone. Turn it on only
once Premium can be bought on the website and in the apps. The env var `PREMIUM_GATES=off` forces
everything open on a server (CI's real-scan check uses it, and it doubles as an emergency switch).

**Who has Premium.**
- The record is `entitlements/{uid}`: `{ active, source: apple|google|stripe|promo|permanent, plan,
  expiresAt, willRenew, trial, stripeCustomerId?, redeemed[] }`.
- Only the sync bot writes it (firestore.rules); each account can read its own.
- An account has Premium if it has the Premium / Creator / Staff title, or an active record.
  Cancelling keeps Premium to `expiresAt`.
- In the app: `lib/premiumAccess.ts` `usePremium`, read through `usePremiumAccess()` from
  `components/premium/PremiumProvider.tsx`. On the server: `lib/premiumServer.ts` `callerAccess`.
- Shared rules: `lib/premiumRules.ts`.

**What's locked (the server enforces each one):**
- **Scans:** `/api/cards/scan` gives free accounts 10 a month. Each `scanId` counts once, in
  `scan_usage/{uid}`; after that the route answers 402. The phone shows a note, and the Inventory
  page opens the Premium sheet.
- **Graded prices:** `gradedAllowed(req)` in `lib/api/gradedPrices.ts`. A free account's slabs are
  priced as raw cards, and the reply carries `gradedLocked: true`.
- **Price history and the portfolio over time:** `/api/price-history` answers 402 for `series` and
  `portfolio`. Today's change (`baselines`) stays free. The app shows a `PremiumLock` on Portfolio →
  Over time, on Analytics, and on a card's Price History.
- **Not locked yet:** the badges' Full look, 3D pins, Pin Display, banner pins and CSV export.
  - Open question: a friend's profile has to know whether *its owner* has Premium. Entitlements
    are private, so that needs a public "has Premium" flag the server writes.

**Buying (`lib/premiumPurchase.ts`, the sheet in `components/premium/PremiumSheet.tsx`, the page
`/premium`):**
- **Website:**
  - `POST /api/premium/checkout` opens a Stripe Checkout subscription (`client_reference_id` and
    `app_user_id` = uid).
  - Stripe sends people back to `/premium?checkout=…`. `POST /api/premium/refresh` then checks the
    session belongs to them, saves the Stripe customer, hands the purchase to RevenueCat
    (`/v1/receipts`, `X-Platform: stripe`) and re-reads RevenueCat.
  - `POST /api/premium/portal` opens Stripe's billing portal.
- **Apps:**
  - `@revenuecat/purchases-capacitor` 14.1.0 (pinned). Its user id is the Firebase uid; the app buys
    the current offering's `monthly` / `annual` package.
  - Restore purchases is in the sheet. Manage subscription opens the Apple / Google subscriptions page.
- **RevenueCat's webhook:** `POST /api/premium/webhook`, with an Authorization header that must equal
  `REVENUECAT_WEBHOOK_AUTH`. Each event is kept in `premium_events/{id}` for Finances, then the
  account is re-read from RevenueCat (`syncEntitlement`). A promo or Permanent Premium that outlasts
  the paid period is kept.
- **Promo codes:** `POST /api/premium/redeem`, website only (Apple guideline 3.1.1 bans unlocking
  features with our own codes in the app). Each code is **Starter** or **Gift**, chosen when it's made on
  the Haven Premium page and changeable there (codes made before types existed count as Starter):
  - any code works **once per person**;
  - **one starter code per person, ever** — after any starter code, no other starter code works;
  - gift codes: a person can use many *different* ones.

  "A person" = their account and their email address: `promo_redemptions/u_{uid}` and
  `e_{sha256(email)}` (`{ codes[], starter }`, server-written, kept for good), so a new account on the
  same email doesn't start over. The months stack on any promo time left; refused while a renewing
  subscription is active or with Permanent Premium. Separate from these: Stripe's own promotion
  codes (discounts at checkout, made in Stripe) are allowed on the checkout page.

**Finances** (`lib/premiumRevenue.ts`). After the first real (non-sandbox) event, the page switches
from estimates to actual numbers:
- revenue kept by month, after the store's cut or Stripe's fee (RevenueCat's
  `takehome_percentage`);
- subscribers by store;
- new subscribers, trials, trials that paid, cancellations and refunds.

**To do before launch (the Owner):**
1. Form the LLC, get its EIN and open a business bank account.
2. Create a Stripe account in test mode. Make the product with a monthly and a yearly price, and
   switch on the billing portal.
3. Create a RevenueCat project:
   - add the iOS app, the Android app and Stripe;
   - create the entitlement `premium` and an offering with `monthly` and `annual` packages;
   - add a webhook pointing at `https://www.tcghaven.org/api/premium/webhook`, with a long random
     Authorization value.
4. Create the subscription products in App Store Connect and the Play Console, and join Apple's
   Small Business Program (below).
5. Add these env vars to `.env.local` and Vercel. Keep the values in 1Password; never commit or
   print them:
   - `STRIPE_SECRET_KEY`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_YEARLY`, optional `STRIPE_TRIAL_DAYS`;
   - `REVENUECAT_SECRET_KEY`, `REVENUECAT_STRIPE_KEY`, `REVENUECAT_WEBHOOK_AUTH`, optional
     `REVENUECAT_ENTITLEMENT`;
   - `NEXT_PUBLIC_REVENUECAT_IOS_KEY`, `NEXT_PUBLIC_REVENUECAT_ANDROID_KEY`.
6. On the Mac, run `npx cap sync` and rebuild the apps (the RevenueCat plugin is native).
7. Deploy `firestore.rules`.
8. Test every path with sandbox purchases, then turn the launch switch on.

## Where the money goes — who takes a cut

| Bought… | Who takes a cut | You keep from $3.99 / mo | from $34.99 / yr |
|---|---|---|---|
| In the **iPhone app** (Apple in-app purchase) | Apple — **15%** with the Small Business Program (30% without it) | **$3.39** | **$29.74** |
| On the **website** (Stripe) | Stripe — about **2.9% + 30¢** per payment (US cards) | ≈ $3.57 | ≈ $33.68 |

- Apple only takes a cut of purchases made **inside the iPhone app**. Apple requires digital
  subscriptions sold in an iPhone app to go through Apple's in-app purchase.
- Even at Apple's standard rate, a subscriber who has paid for **more than a year** is charged at 15%.
- The Haven Premium page's "you keep" lines assume Apple's 15% (the Small Business Program rate).
  "($47.88 a year)" there is just $3.99 × 12 — what a monthly subscriber pays in a year, before any cut.
- Apple charges iPhone subscribers the price set **in App Store Connect** (from Apple's fixed price
  points), not the Haven Premium page's price. When you change the price on the page, change it in
  App Store Connect too.
- Apple has rules about pointing iPhone users to buy on the website instead; in the US a 2025 court
  ruling loosened them. Check Apple's current App Review Guidelines before relying on it.

## Apple's App Store Small Business Program — how to join (15% instead of 30%)

It isn't automatic. Do it **before Premium goes on sale** — the lower rate starts with Apple's next
payment cycle after you're approved, not the day you apply.

**Before you enroll**
1. You must be the **Account Holder** of the Apple Developer account (whoever set it up and pays the
   $99 a year).
2. Sign in to [App Store Connect](https://appstoreconnect.apple.com) → **Business** (older accounts:
   **Agreements, Tax, and Banking**):
   - accept the **Paid Apps** agreement (it must show **Active**),
   - add the **bank account** Apple pays into,
   - fill in the **tax forms** (US: W-9 — the LLC's details if there is one, otherwise your own).
   This is needed to sell subscriptions at all; Apple can take a day or so to make it Active.

**Enroll**
3. Open [developer.apple.com/app-store/small-business-program](https://developer.apple.com/app-store/small-business-program/)
   → **Enroll now**.
4. Sign in with the Apple Developer account — Apple fills in your name, email and Team ID.
5. **Associated accounts:** list any other developer accounts you control or that belong to the same
   business (Team ID + Account Holder email for each); none if TCGHaven is the only one. The $1M limit
   counts them all together.
6. Submit. Apple emails that it's under review, then again when approved.

**The rules:** for developers earning **under $1 million a year** from the App Store (a new app
qualifies straight away). Going over $1M in a year moves you to the standard 30% for the rest of that
year. Apple's forms change now and then — if a screen looks different, follow what it shows.

Sources: [Apple — Small Business Program](https://developer.apple.com/app-store/small-business-program/) ·
[Apple Developer News](https://developer.apple.com/news/?id=6lyxewwp) ·
[RevenueCat guide](https://www.revenuecat.com/blog/growth/enroll-app-store-small-business-program/)

## Automatic costs in Finances (planned)

- **Vercel:** on the free Hobby plan — nothing to pull. On Pro, its billing API
  (`GET /v1/billing/charges`, daily cost per service) + an access token would feed Finances.
- **Firebase (paid, Blaze):** Google has no simple "current bill" API. The standard way is the
  **Cloud Billing export to BigQuery**, then the nightly totals job reads the daily cost with a
  read-only service account and adds it to Finances as an automatic "Firebase" cost.
  **Step 1 (Owner, in the browser):** [console.cloud.google.com/billing](https://console.cloud.google.com/billing)
  → the billing account → **Billing export** → **Standard usage cost** → **Edit settings** → project
  **tcghaven-85a34** → **Create new dataset** `billing_export` (location **US**) → Save. Google takes a
  few days to fill in the history and can run up to a day behind.
  **Step 2:** a read-only service account for that dataset (BigQuery Data Viewer + Job User), its key
  added to `.env.local` and Vercel — then wire it in.
