# Haven Premium — the business side

Plain-English notes on how Premium money works and the setup it needs outside the code. The code
side is in `docs/insights.md` (Statistics, Finances, the Haven Premium page) and
`docs/community-and-badges.md` (account titles).

## The plan (2026-11-09)

- **Haven Premium** — monthly **$3.99**, yearly **$35.99** ($3.00 a month, 25% cheaper than paying
  monthly). Set on the staff portal's **Haven Premium** page (`premium/config`); every change is logged.
- **What it unlocks** (still being decided): the current idea is Free = Inventory + Cardex; Premium =
  Friends, Portfolio, Badges. Suggested instead (keeps the app spreading and people coming back):
  keep **Friends** and **earning Badges** free, a **basic Portfolio** free (value + today's change), and
  make Premium the depth — Portfolio P&L history and time windows, Analytics, price history, Pin
  Display / the badges' 3D looks, unlimited scans, following creators.
- **Free Premium:** Creators and Staff get it free; **Permanent Premium** (for people the Owner picks,
  never removed unless the Owner removes it) and **promo codes** (1, 3, 6, 12… free months) are planned.
  When Premium is removed or someone stops paying, it lasts to the end of the month they paid for.

## Where the money goes — who takes a cut

| Bought… | Who takes a cut | You keep from $3.99 / mo | from $35.99 / yr |
|---|---|---|---|
| In the **iPhone app** (Apple in-app purchase) | Apple — **15%** with the Small Business Program (30% without it) | **$3.39** | **$30.59** |
| On the **website** (Stripe, when built) | Stripe — about **2.9% + 30¢** per payment (US cards) | ≈ $3.57 | ≈ $34.65 |

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
