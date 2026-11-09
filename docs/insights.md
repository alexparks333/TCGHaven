# Staff portal Insights: Statistics & Finances (2026-11-09)

Under a line in the staff portal's left bar ("Insights"): **Statistics** (all staff) and **Finances**
(Owner only — hidden from the menu and refused by `firestore.rules` for everyone else). A third tab
is planned.

## How the numbers are made — cheap by design

Reading every account's cards to count them would be ~20M reads a day at 50,000 accounts
(~$300–400/month). Instead:

1. **Each account's own app** (`components/UsageTracker.tsx`, mounted in `ClientWrapper`) writes two
   small docs (`lib/usage.ts`):
   - `usage_days/{day}_{uid}` — that day's seconds in use, sessions (app opens / returns after 30 min
     away), seconds + visits per part of the app (`sectionOf()`), app vs web seconds. Increments only,
     saved every 2 minutes and when the page hides. Time counts only while visible AND touched in the
     last 2 minutes.
   - `user_stats/{uid}` — counts worked out on the device: cards per game, graded per company,
     Japanese, foil, unique rows, sold, friends, badges earned, first day (sign-in metadata), last day,
     platform. Saved when it changes, at most every 30 minutes, only after the collection has loaded.
   **No card names, prices or what was paid** ever leave the device for this.
2. **The totals job** (`lib/stats/aggregate.ts` `runStats()`, server, signed in as the sync bot) runs
   twice a day — the `sync-prices` workflow's second step calls `/api/cron/stats` (CRON_SECRET) — and
   on Statistics → "Refresh now" (`/api/admin/stats`, staff). Each run: finishes yesterday's activity
   (marked `final`), writes today's full snapshot to `stats_daily/{day}` (types in `lib/stats/types.ts`),
   and deletes `usage_days` older than 90 days.
3. **The pages** read only `stats_daily` (~90 docs a visit).

**Privacy:** `usage_days` and `user_stats` are readable ONLY by the sync bot (`isBot()` in the rules) —
staff, the Owner included, see daily totals, never one account. Banned accounts can't write them.
Deleting an account deletes its `user_stats` and the last 92 days of `usage_days` (by id —
`lib/firebase/deleteAccount.ts`). The privacy policy (`app/privacy/page.tsx`, "Usage statistics")
describes exactly this — keep it true if what's collected changes. The App Store privacy label
needs **Usage Data → Product Interaction** (linked to the account, not used for tracking).

Days are UTC. Accounts are counted from the first time they open the app after this shipped, so
early numbers undercount.

### Cost at 50,000 accounts (≈10,000 active a day, multi-region prices)

| What | Per month | ≈ |
|---|---|---|
| Activity saves (~6 per active account a day) | ~1.8M writes | $3.25 |
| Account summaries | ~0.6M writes | $1.10 |
| Totals job (twice a day: every summary + that day's activity) | ~3.3M reads | $2.00 |
| Deleting 90-day-old activity | ~0.3M deletes | $0.06 |
| Opening the pages | a few thousand reads | < $0.05 |
| **Total** | | **≈ $6–7** |

The totals job reads one doc per account per run, so it scales linearly; at ~150k+ accounts move it
off Vercel's 5-minute function limit (a GitHub Actions job like `sync-mtg.yml`).

## Statistics (`components/admin/insights/StatisticsPage.tsx`)

Two areas (switch at the top) and a 7 / 30 / 90-day range.
- **Card Statistics:** total cards (+ growth), average per account and per collector, median, % graded;
  cards added per day by game (stacked — the day-over-day change in each game's total, net of removals);
  most cards added by game; most-used catalogs; accounts collecting each game; graded slabs by company;
  collection sizes; games per account; Japanese / foil shares; accounts with cards; cards sold; total
  over time.
- **Application Statistics:** daily / weekly / monthly active, time per active user, visits per day (the
  closest thing to logins), most-used parts of the app (% of active accounts) and where time is spent,
  signed up vs active vs inactive (30+ days), iPhone app vs website, coming back (D1 / D7 / D30
  retention), average friends and % with a friend, badges, Portfolio use, sign-ups per day.

Charts: `components/admin/insights/charts.tsx` (recharts + plain HTML bars). Game colours there
(`GAME_CHART`) and the cost categories' colours (FinancesPage) were checked with the data-viz
palette validator on the portal surface `#efe4cc` — `GAME_COLORS` itself reads too grey for charts.

## Finances (`components/admin/insights/FinancesPage.tsx`, `lib/finance.ts`)

- **Haven Premium** is `PREMIUM_PRICE` ($3.99/month). Paying users today = Premium titles in Accounts
  (Creators and Staff get it free, counted separately); revenue is an estimate (× price, minus
  `APPLE_CUT` 15% — the Small Business Program rate).
- **Not built yet** (shown as "Connects with payments"): real revenue by month, how long people stay
  subscribed, why they cancel — they come from Apple in-app purchase (required on iPhone) and Stripe
  (web) when Premium payments are built.
- **Cost tracker** (working): `finance/costs` = `{ items: CostItem[] }` — name, category, amount,
  monthly / yearly / one-off, first and last month, note. Totals by month (yearly bills spread over 12
  months, or in the month charged), by category, year to date, per account, and estimated profit.
