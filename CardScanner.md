# TCGHaven Card Scanner — Research, Design & Status

_Started 2026-11-08. Point the iPhone at cards and they go into your inventory: the exact
printing, fast enough to scan a stack._ The iPhone app it lives in: `IOSAppDev.md`.

**Status (2026-11-08): v1 is built and tested on the Mac, but has not been run on a phone yet.**
The app builds, all checks pass, and the end-to-end test results are below. Next step: run it on
your iPhone (IOSAppDev.md Day 1, steps 4–5), with the site changes deployed first; see "Trying it".

(There was never any "Card Vision" code in this repo or its history; this started fresh.)

---

## What "best in the world" has to mean

Every scanner gets the card **name** right. Reviews and comparisons (Nov 2026) show they all fail
in the same places:

- **Wrong printing of reprinted art.** TCGplayer's scanner matches mostly on the picture.
- **Finish, 1st Edition, stamped promos, languages:** these come back as the base card.
- **Glare, sleeves, bad light, and multi-card modes:** each one makes accuracy worse.
- **One card at a time:** confirm, then scan the next.

Vendor accuracy numbers are self-reported (best quoted ~94%) and none are measured on variants.
Our rule: **never silently add the wrong card**. A wrong card that lands in someone's collection
is far worse than one extra tap, so when the scanner isn't sure, it asks.

## How it works

```
iPhone (native, ios/App/App/CardScanner.swift)              Site (lib/scan/, deploys without an app update)
──────────────────────────────────────────────             ───────────────────────────────────────────────
camera, 4K, continuous close focus (+ auto zoom when
  the phone can't focus close — Apple's own advice)
find the card: Vision rectangle detection
wait until it's held still (4 frames)
flatten it: perspective correction → upright card
read its text: Vision OCR, English + Japanese
  (auto language); upside-down cards are turned round  ──▶  POST /api/cards/scan: text → catalog candidates
                                                              (scanMatch.ts: the printed number/code picks the
                                                              printing, the name confirms; all 6 catalogs)
compare the scan's picture with each candidate's      ◀──  the candidates still in the running
  catalog photo (PictureMatcher)                       ──▶  decide.ts: text + picture → matched / pick / none
tray: ✓ added, ? pick one, ! not found               ◀──  the answer
"Add N" → back to the site                            ──▶  ScanReviewDialog: printing, condition, quantity →
                                                              saved through lib/firebase/db.ts like Add Card
```

- **The phone does what needs hardware.** Camera, Vision OCR and picture comparison run on the
  phone, in milliseconds. No photo leaves the phone; only the text that was read is sent.
- **The site does the matching.** It knows the catalog. Improving the matching ships with a normal
  push, with no new app build or App Review.
- **Inventory is written only by the site** (`lib/firebase/db.ts`), exactly as Add Card writes it.
  The scanner never touches user data, and nothing is saved until the person taps "Add N cards" on
  the review screen.
- **Continuous scanning.** Once a card is read, the scanner waits for it to leave the frame, then
  reads the next one. The shutter button forces a read.

### What each game prints, and how it's matched (`lib/scan/scanMatch.ts`)

| Game | Read from the card | Notes |
|---|---|---|
| Pokémon EN | "025/198", "TG05/TG30", "SWSH123" + name | The set total checks the set; a regulation letter glued on ("F091") is handled |
| Pokémon JP | "001/066" + set mark ("SV4K", "SM2+") or promo "388/SM-P" | The catalog's names are English, so the number and set mark carry it, then the picture |
| One Piece | "OP05-119", "P-001" | Reprints keep the original code (The Best, Pre-Release…); parallels tie on text and the picture decides |
| Lorcana | "143/204 • EN • 10" | Number + set number |
| Riftbound | "OGN • 048/298" | Metal / Judge / Nexus reprints print the original code; "★" picks Signature |
| Magic | "BLB • EN" + "0280" | Stamped promos (`pmh3` 222s) are offered as close seconds; old cards without a code go by name |

Things the camera can't see aren't held against a card. A League stamp, "(Signature)" or
"[4th Place]" isn't printed as words, so stamped copies tie with the plain card on text. The
picture decides between them, or the person picks when the pictures look the same.

### Picture matching (`PictureMatcher` in CardScanner.swift)

**Apple's Vision feature prints were tested first and are too weak.** They picked the right One
Piece parallel only 81% of the time on simulated phone scans, with the runner-up a median 1.12×
further away. Because the scan is already flattened into the same frame as the catalog photo, both
are compared directly instead:

- Both are shrunk to a 40 × 56 grid.
- Each colour channel and the edge strength are compared tile by tile (4 × 4 tiles), with
  normalized correlation, so exposure and white balance don't matter.
- The worst quarter of tiles is dropped, which removes glare and fingers.
- A ±2-cell shift is allowed for imperfect framing.

| Simulated phone scans of look-alikes | Apple feature print | Ours |
|---|---|---|
| One Piece parallels (9 arts of OP05-119), normal | 81% | **100%** (runner-up median 3× further away) |
| One Piece parallels, harsh glare + blur | 74% | **87%** |
| Pokémon Charizard printings, normal | 81% | **92%** (misses = same-art reprints, which the number separates) |

Distances: about 0.13 for the right card normally and about 0.35 in harsh light, while a
different card's art is usually 0.3–0.5 further away. `decide.ts` uses these numbers.

### When it adds without asking (`lib/scan/decide.ts`)

All of these must hold:

- The text clearly wins (final score ≥ 70, at least 10 ahead of the runner-up).
- The picture confirms it (distance ≤ 0.35 when pictures were compared).
- The match came from a printed number or code, or from a name that belongs to only one card.

Anything else becomes "pick one" in the tray and an amber row on the review screen.

## Test results (2026-11-08)

### Text matcher

**Over 9,000 real catalog cards, using the text each card prints:** the right card is in the
top-scoring group 99.4–100% of the time for every game. Matching takes about 20 ms per scan. The
script is in the session scratchpad; `npm run test:scan` holds the fixed cases.

### Full pipeline

**180 real card images** (30 per game, random), with Apple's real OCR (same settings as the
app) plus phone-like damage: blur, exposure, white balance, a glare spot, JPEG, framing a few
percent off.

| Game | Added, right | **Added, wrong** | Asked, right one first | Asked, right one listed | Asked, not listed | Nothing |
|---|---|---|---|---|---|---|
| Pokémon EN | 24 | **0** | 4 | 1 | 1 | 0 |
| Pokémon JP | 20 | **0** | 0 | 0 | 5 | 5 |
| One Piece | 15 | **0** | 13 | 1 | 0 | 1 |
| Magic | 18 | **0** | 8 | 3 | 1 | 0 |
| Lorcana | 28 | **0** | 1 | 1 | 0 | 0 |
| Riftbound | 24 | **0** | 2 | 4 | 0 | 0 |
| **All** | **129 (72%)** | **0** | 28 | 13 | 7 | 6 |

**The right card was added or offered for 170 of 180 (94%), and none were added wrong.** The first
version of this test added 10 wrong. Each of those fixes is in `test:scan`.

Most "asked" cases are One Piece parallels and Magic reprints, which really do look alike, and
stamped copies. **Japanese is the weakest:** old cards without numbers, and same-number cards
across hundreds of sets. Phase 3 fixes this.

## Trying it

The app shows the live site, so the site half (route, Scan button, review screen) must be
**deployed** before the phone can use it. Push to main → Checks → Vercel.

1. Run the app from Xcode on the iPhone (the scanner is native code, so this needs the new build).
2. Inventory → **Scan** (shown only in the app) → allow the camera.
3. Hold a card flat, fill most of the screen, and keep it still. Then the next card.
4. Tap **Add N** → check the review screen → **Add N cards**.

What to look for on a real phone:

- Does the card outline lock quickly?
- Do the small numbers read? If not, try the light button.
- How fast is it per card?
- Do sleeves and toploaders work?
- Are there any wrong adds? There must be none.

## What's next

| Phase | What | Why |
|---|---|---|
| **2** | Real-phone tuning | Stillness and timing thresholds, focus and zoom on your iPhone model, sleeve glare, low light |
| **3** | A picture index of the whole catalog, on the phone (a model trained on the 4090; commercial-use licence, DINOv2 or SigLIP 2 — Apache-2.0) | Finds the card even when no text is readable. The big fix for Japanese and old cards |
| **4** | Finish detection (holo / reverse holo) from how the foil changes between frames | Today the review screen's finish picker does it; no scanner does this well |
| **5** | Binder pages (9 at once), graded slabs (PSA/BGS/CGC cert number), opt-in learning from corrections | |

Decisions still yours: opt-in "help improve the scanner" uploads of corrected scans (would need a
privacy-policy line), and whether scanning ever comes to the website (recommended: no, the browser
camera can't do this well).

## Files

| File | What |
|---|---|
| `ios/App/App/CardScanner.swift` | The native scanner + the `CardScanner` plugin + `TCGBridgeViewController` (registers it) |
| `ios/App/App/SceneDelegate.swift` | Uses `TCGBridgeViewController` |
| `ios/App/App/Info.plist` | `NSCameraUsageDescription` (the permission prompt) |
| `lib/scan/scanMatch.ts` | OCR → candidates. Pure, tested by `npm run test:scan` (`scanMatch.test.mts`) |
| `lib/scan/decide.ts` | Text + picture → matched / pick / none |
| `lib/scan/server.ts`, `app/api/cards/scan/route.ts` | The matching endpoint (public, read-only catalog) |
| `lib/scan/scanner.ts` | The site ↔ native-scanner conversation |
| `components/inventory/ScanReviewDialog.tsx` | Review + save (mirrors AddCardDialog's save — keep in step) |
| `components/pages/InventoryPage.tsx` | The **Scan** button (only `inApp()`) |

## Sources

- [Rare Candy: best Pokémon scanner apps](https://rarecandy.com/blog/best-pokemon-card-scanner-apps)
- [CardPriceIQ: 7 best scanner apps](https://cardpriceiq.com/news/best-card-scanner-apps-2026)
- [PokeScope: 8 apps compared](https://pokescope.app/blog/best-pokemon-card-scanner-apps-2026/)
- [Eyevo comparison](https://eyevotcg.com/blog/best-pokemon-card-scanner-apps-2026/)
- [Ludex user reviews](https://appshunter.io/ios/app/1616691213/reviews/2)
- [TCGplayer scanner wrong-set issues](https://pregradecards.com/blog/tcgplayer-app-scanner-not-working-fixes-2026)
- [Google: on-device product recognition](https://research.google/blog/on-device-supermarket-product-recognition/)
- [PokVault: on-device card search](https://didierrlopes.github.io/pokemon-card-scanner-paper)
- [CLIP with Core ML](https://blog.jacobstechtavern.com/p/offline-ai-clip)
