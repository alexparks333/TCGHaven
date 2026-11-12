# User data (Firestore) & the Zustand store

Moved out of CLAUDE.md (2026-10-30) so it's read only when needed. Section numbers (§N) refer to
the original CLAUDE.md layout.

## Firestore / User Data

### Collections — the full picture

```
catalog/{game}/cards/{cardId}          — Shared catalog, admin-write-only (§4, §5)
catalog_snapshot/{game}/chunks/{n}     — Pre-sharded catalog snapshot for cheap cold reads (§4)
catalog_meta/{game}                    — { lastBulkSyncAt, brokenImageIds } — resync-vs-admin-edit
                                          bookkeeping + image-health tracking (§4, §16)
registry/main                          — Set registry, admin-write-only (§17)
sync_status/{game|"mtg-new-set-check"} — Last-run status per sync job, admin-write-only (§18)

users/{uid}/
  cards/{cardId}        — Card objects (this user's inventory)
  soldCards/{cardId}     — Sold-card records (see "Sold Cards" below) — same shape as Card plus
                            soldDate/soldPrice/soldAt
  priceHistory/{cardId} — Price history points per card
  purchases/{id}        — Legacy pack purchase records from the removed Spending page (§16) —
                            no longer read or written
  collections/{id}      — Personal Collections (§6) — { game, name, cards: [...], createdAt }
```

`game` throughout is `pokemon` | `lorcana` | `riftbound` | `onepiece` | `mtg`. The `catalog*`,
`registry`, and `sync_status` collections are public read / admin write; everything under
`users/{uid}/**` is readable/writable only by that same uid — see `firestore.rules` for the
actual enforcement. The app-level `isAdmin`/`ADMIN_UID` check is UX only for direct Firestore
writes (client SDK calls are still really gated by `firestore.rules`), but for the several
Next.js API routes that write admin-only data server-side (`set-registry`, `admin/catalog/
invalidate`, `admin/catalog/lookup`, `sync/{game}`), there previously was no real caller check at
all — any request reaching the route succeeded, regardless of who sent it, because the route
signed *itself* in as the admin bot account rather than verifying who was asking. This is now
closed: every one of those routes calls `verifyAdminRequest()` (`lib/firebase/
verifyAdminRequest.ts`), which checks the caller's own Firebase ID token (sent as `Authorization:
Bearer <token>`, attached client-side via `lib/firebase/authFetch.ts`'s `adminFetch()`) against
Firebase's Identity Toolkit REST API and rejects anyone whose uid isn't `ADMIN_UID`. The 5
`sync/{game}` routes each split their real logic into a sibling `sync.ts` module (`runPokemonSync`
etc.) precisely so the cron route can still call it in-process post-CRON_SECRET-check without a
second, redundant verification — see [§18](#cron-driven-price-sync).

### Card Object (stored in Firestore)

```typescript
{
  id: string           // Firestore document ID (generated client-side)
  game: 'pokemon' | 'lorcana' | 'riftbound' | 'onepiece' | 'mtg'
  name: string         // Card name (Lorcana includes version: "Mickey - Bob Cratchit")
  set: string          // Human-readable set name (e.g. "Shimmering Skies")
  setCode: string      // Short set code (e.g. "5" for Lorcana, "OGN" for Riftbound)
  number: string       // Collector number as string
  condition: Condition // mint | near_mint | lightly_played | moderately_played | heavily_played
  quantity: number
  purchasePrice: number
  purchaseDate: string  // ISO date string
  isFoil: boolean
  imageUrl?: string    // Cached from catalog at add time
  apiId?: string       // Catalog card ID — CRITICAL for variant matching in Cardex
  currentPrice?: number
  priceUpdatedAt?: string
  createdAt?: string
  priceAtEntry?: number   // market price snapshotted when the card was first added — baseline
                          // for Portfolio's "Since Entry" P&L timeframe
  gradingCompany?: string // e.g. "PSA", "CGC", "BGS", "SGC" — see cardIdentityKey() below; "Graded cards" below
  grade?: string          // e.g. "10", "9.5", "Authentic"
  group?: string          // user-defined group label (e.g. "Alex & Brother's Cards") — drives
                          // Portfolio's hidden-groups filter feature
  priceLocked?: boolean   // retired — the old "Manual 🔒" price; ignored, cleared when the card is edited
  rarity?: string         // from the catalog at add time; Pokemon catalog cards don't carry one
  nexus?: boolean         // Riftbound only — user-flagged Nexus Night promo-foil variant
  edition?: 'unlimited' | 'shadowless' | '1st'   // Pokémon printing — §7 Editions & Finishes
  finish?: 'normal' | 'holofoil' | 'reverse'
  language?: 'en' | 'ja'  // Pokémon only — 'ja' = from the Japanese catalog (§7)
}
```

`lib/utils.ts`'s `cardIdentityKey(card)` is what Inventory groups multiple lots of the "same"
card under — it includes `apiId`/`game`/`isFoil` and, critically, `gradingCompany`+`grade`, so a
raw copy and a graded copy of the same print are never merged into one row with a shared cost
basis (they weren't originally — this was a real bug fixed during a later audit pass).

### Sold Cards

A card sold out of Inventory moves to `users/{uid}/soldCards/{cardId}` (`SoldPage.tsx`,
`/sold` route) rather than being deleted — `SoldCard` (`lib/types.ts`) is a `Card` plus
`soldDate`/`soldPrice`/`soldAt`, so P&L on a sale is still computable later. `lib/firebase/db.ts`
exports `loadSoldCards`/`saveSoldCard`/`deleteSoldCard`; a sold card can be restored back into
active inventory (calls the same `addCard` path AddCardDialog uses, deliberately *not* treated
as a "new card unlock" — see the CardUnlockToast note under [§20](#zustand-store)).

### Invite-Gated Signup

New account creation is gated by a single shared passcode, not open signup — `app/signup/
page.tsx` calls `verifyPasscode()` (`AuthProvider.tsx`), which posts to `POST /api/auth/
verify-passcode`. That route compares the submitted code against `SIGNUP_PASSCODE` (a
server-only env var, never `NEXT_PUBLIC_`) and returns only `{ ok: boolean }` — the real code
never reaches the client. `signInWithGoogle()`'s Google-OAuth signup path enforces the same gate
by deleting the freshly-created Firebase Auth account if the passcode step failed (falling back
to a plain sign-out if the delete itself throws for a reason other than requiring a recent
login).

### Deleting an account (2026-11-04)

Settings (⚙️ on your profile) → **Delete account** — required by the App Store for any app with
sign-up. **Two factors** (screens in `components/account/DeleteAccount.tsx`): Settings only emails a
confirmation link (`sendDeleteEmail` — Firebase's email-link sign-in, which must stay enabled in the
Firebase console); the link opens `/confirm-delete`, which checks it (`checkDeleteLink`: sent to this
account's inbox, asked for on this device within the hour) and then needs the password / Google
sign-in again. `lib/firebase/deleteAccount.ts` runs it as the user (there's no admin SDK), in this
order: sign in again (`confirmIdentity` — nothing is deleted if that fails), then profile + usernames +
shared copies in one all-or-nothing batch, then friendships, then every `users/{uid}` folder
(`USER_FOLDERS` — **add any new per-user folder there**), then the Auth user, then this device's
uid-keyed localStorage. `firestore.rules` lets an owner delete their own `profiles/{uid}` and
`shared_badges/{uid}` for this. The Owner account (`ADMIN_UID`) can't be deleted from the app.
Old `invite_codes` can't be listed and are left (they point at a uid that's gone). The public
privacy policy is `app/privacy/page.tsx` (no app shell — ClientWrapper); keep it true to the code.

### Key Firestore Rules

- Firestore rejects `undefined` values entirely. `db.ts` has a `clean()` function that
  strips undefined before any write.
- Always use `|| ''` fallbacks for optional string fields (not `?? undefined`).
- ID generation: `newCardRef(userId)` creates a Firestore doc reference client-side using
  `doc(collection(...))` — zero network cost, unique ID guaranteed.

### Optimistic UI Pattern

1. Card is saved to Zustand immediately (instant UI update)
2. `saveCard(userId, cardId, card)` writes to Firestore asynchronously in background
3. On page refresh, `loadCards(userId)` re-fetches from Firestore and re-populates Zustand

---

---

## Graded cards

A copy is graded when `gradingCompany` is set. Its fields: `grade` ("10", "8.5", "Authentic"),
`certNumber` (the slab's cert number — the "Slab ID"; a string, leading zeros kept), `gradeTier`
(which label a 10 carries: BGS `pristine` / `black` = Black Label; CGC, SGC, TAG `pristine`) and
`subgrades` (BGS only: centering / corners / edges / surface). An edit sends a removed grade, cert,
tier or subgrades as cleared (an edit merges into the saved card).

The rules — each grader's grades, the words printed beside them, the 10s' labels, cert formats and
verify links — are `lib/grading.ts` (researched 2026-11-10 from the graders' pages and hobby
references). Facts that drove it: PSA gives half grades only up to 8.5 (no 9.5) and has no premium
labels; BGS 9.5 and 10 are gold, a Black Label is a 10 with four 10 subgrades, the rest silver;
CGC / SGC / TAG have Gem Mint 10 and Pristine 10 (gold label); TAG has no 9.5; SGC's label is black.
Cert lookups: PSA `psacard.com/cert/{n}`, CGC `cgccards.com/certlookup/{n}/`, TAG
`my.taggrading.com/card/{cert}`; BGS and SGC are lookup forms.

`components/SlabCase.tsx` draws every slab (Add Card's card view, the Cardex zoom view and grid
tiles, profile tiles) like the grader's real one — PSA's red-framed white label, Beckett's tier
colours with subgrades, CGC's silver label and black grade box, SGC's black "tuxedo", TAG's text
printed in the clear case with a QR code — with the cert number where each prints it. The scanner
reads company, grade and cert off a slab's label and saves the cert too.

## Zustand Store

`lib/store.ts` — mostly in-memory (cards/priceHistory/purchases/soldCards are never persisted,
always re-loaded from Firestore on login), but wrapped in Zustand's `persist` middleware with a
`localStorage` backing (`createJSONStorage(() => localStorage)`, key `"tcghaven-filters"`) for a
small, deliberately-scoped slice of display/filter preferences via `partialize`:
`calcFloor`, `activeGames`, `trackedGames`, `timeFrame`, `hiddenGroups`, `portfolioSort`,
`includeSold`, `lastPriceRefresh`. None of this is inventory data — it's UI state that's reasonable to survive a
refresh/relaunch without waiting on Firestore.

**Portfolio settings follow the account, live** — website and iPhone app alike, and they only
change when the user changes them. The Filters panel (`calcFloor`, `activeGames`, `hiddenGroups`)
plus Portfolio's own P&L window (`timeFrame`), card sort (`portfolioSort`) and "include sold"
toggle (`includeSold`) are stored on `users/{uid}/settings/preferences` (`filters` field, next to
`trackedGames`). `lib/preferencesSync.ts`'s `startPreferencesSync()` (started by `AuthProvider.tsx`
on sign-in) listens to that doc with `onSnapshot` (tracked games included) and writes local
changes back — clicks at once, the typed floor after a 600 ms pause, any pending save flushed on
`pagehide` / app backgrounded. A pending local change is never overwritten by an older remote
copy. localStorage is only the first-paint copy. An account that has never saved filters (or an
older save missing a field) gets filled in from the first signed-in device.

- **Loading the account's tracked games must use `applyAccountTrackedGames()`**, never
  `setTrackedGames()` — the latter (Inventory's "+") also switches the new game on in the Portfolio
  filter, which at sign-in on a fresh device (localStorage = Riftbound only) switched every
  filtered-out game back on and saved that to the account (fixed 2026-11-04).

### State Shape (abridged — see `lib/store.ts` for the full shape)

```typescript
{
  cards: Card[]              // all user's cards, loaded from Firestore on login
  soldCards: SoldCard[]      // see "Sold Cards" in §19
  priceHistory: PriceHistory[]
  activeGame: Game           // selected game filter
  lastPriceRefresh: string | null
  cardUnlocks: Array<{ id: string; card: Card }>  // queue for CardUnlockToast, below

  // Actions (non-exhaustive)
  loadUserCards(cards)
  loadUserSoldCards(cards)
  loadUserPriceHistory(history)
  addCard(card)
  updateCard(cardId, updates)
  removeCard(cardId)
  updateCardPrice(cardId, price)
  addPriceHistoryPoint(cardId, price, date)   // dedupes to one point per calendar day
  applyPriceUpdates(updates)                   // batched form of the above two, O(n) not O(n²)
  setLastPriceRefresh(date)
  pushCardUnlock(card) / dismissCardUnlock(id)
  clearUserData()            // called on sign out — clears cards/priceHistory/soldCards
                              // but NOT the persisted filter/display prefs above
}
```

### "Card Unlocked" celebration

`components/CardUnlockToast.tsx`, mounted once globally in `ClientWrapper.tsx`. When
`AddCardDialog` adds a card, `isFirstCopyOfCard()` (`lib/utils.ts`) checks — against the
in-memory inventory snapshot from *before* the add, so no race with the optimistic update —
whether this is the very first copy of that exact print the user has ever owned (same
apiId-then-set+number identity rules the Cardex uses; deliberately checked against inventory
alone, not the catalog, so it fires for a manually-typed card in an unregistered set too). If so,
`pushCardUnlock()` queues a celebration toast; the component renders only the front of that
queue so a burst of adds during a big unboxing session shows one celebration at a time. Restoring
a card from Sold (§19) reuses the same `addCard` path but is deliberately not treated as a new
unlock. Clicking the toast deep-links to that card's Cardex set.

### Data Loading on Login

`AuthProvider.tsx` runs a `Promise.all` on sign-in, with all four reads isolated by their own
`.catch`:
```typescript
Promise.all([
  loadCards(firebaseUser.uid).catch((err) => { console.error(...); return [] }),
  loadPriceHistory(firebaseUser.uid).catch((err) => { console.error(...); return [] }),
  loadSoldCards(firebaseUser.uid).catch((err) => { console.error(...); return [] }),
])
```
`dataLoading` is set `false` once this resolves (which it now always does, since none of the four
can reject anymore) or in the outer `.catch` for anything outside those four reads (this used to
leave `dataLoading` `true` forever on failure — fixed earlier). This used to be a plain
`Promise.all` with only `loadSoldCards` individually isolated — if any of the other three
(`loadCards`/`loadPriceHistory`/`loadPurchases`) rejected, **none** of the four store-population
calls ran at all, landing the user on a fully empty Inventory/Portfolio/Spending with only a
`console.error`, indistinguishable from real data loss. Each read failing now independently falls
back to `[]` and logs its own specific error, so one flaky read no longer blanks the other three.

---

## Display currency (2026-11-11)

- **What's stored:** every amount stays in **US dollars**: catalog prices, purchase and sale
  prices, history. Settings → **Prices → Currency** only changes what's *shown*.
- **Where the choice lives:** `users/{uid}/settings/preferences.currency`, followed live by
  `lib/preferencesSync.ts`. It's also kept in the store (persisted) and in localStorage, so the
  first paint is already converted.
- **How it converts:** `formatCurrency()` (`lib/utils.ts`) multiplies by today's rate from
  `/api/fx`. That's the ECB reference rates via Frankfurter, cached 6 h on the server and at the
  edge. `lib/currency.ts` holds the list and the current choice. A currency whose rate isn't
  known yet shows USD, never a guess.
- **Redrawing:** changing the currency remounts the app shell (`ClientWrapper`
  `useCurrencyRedraw`), because `formatCurrency` is a plain function.
- **Typed amounts are in the chosen currency too:** How Much Paid, Sale Price and the Filters
  value floor. They're converted to USD on save with `toUSD()` and shown back with `toDisplay()`
  (`lib/currency.ts`), so a CAD collector never sees or types USD.
- **Staff portal:** always USD. Use `formatUSD()` there, and anywhere that must not convert.
