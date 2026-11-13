# TCGHaven Card Scanner — Research, Design & Status

_Started 2026-11-08. Point the iPhone at cards and they go into your inventory: the exact
printing, fast enough to scan a stack._ The iPhone app it lives in: `"Status & plan" in ios-app.md`.

**Status (2026-11-08): v1 is built and tested on the Mac, but has not been run on a phone yet.**
The app builds, all checks pass, and the end-to-end test results are below. Next step: run it on
your iPhone ("Status & plan" in ios-app.md Day 1, steps 4–5), with the site changes deployed first; see "Trying it".

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
  + the picture AI's fingerprint of the card            ──▶  + picture search over every catalog card's photo
  (CardFingerprinter — docs/scanner-ai.md)                    (picture.ts): look-alikes + how alike each is
compare the scan's picture with each candidate's      ◀──  the candidates still in the running
  catalog photo (PictureMatcher)                       ──▶  decide.ts: text + picture → matched / pick / none
tray: ✓ added, ? pick one, ! not found               ◀──  the answer
"Add N" → back to the site                            ──▶  ScanReviewDialog: printing, condition, quantity, group →
                                                              saved through lib/firebase/db.ts like Add Card
```

- **The phone does what needs hardware.** Camera, Vision OCR, the picture AI and picture comparison
  run on the phone, in milliseconds. No photo leaves the phone. Only the text that was read and the
  AI's 384-number fingerprint are sent.
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
| Pokémon JP | "001/066" + set mark ("SV4K", "SM2+") or promo "388/SM-P" + the name in katakana | The katakana name is translated to English (`pokemonJaNames.ts`), then matched like an English name; then the picture |
| One Piece | "OP05-119", "P-001" | Reprints keep the original code (The Best, Pre-Release…); parallels tie on text and the picture decides |
| Lorcana | "143/204 • EN • 10" | Number + set number |
| Riftbound | "OGN • 048/298" | Metal / Judge / Nexus reprints print the original code; "★" picks Signature |
| Magic | "BLB • EN" + "0280" | Stamped promos (`pmh3` 222s) are offered as close seconds; old cards without a code go by name |
| Yu-Gi-Oh! | "MAMS-EN001" (under the art, right) + name on top | Code read anywhere, O as 0; rarity versions share a code and tie on text — the picture or the person picks; 1st / Unlimited / Limited offered as the Finish row |
| Gundam / Digimon / Palworld | "GD01-118" / "BT26-066", "ST1-01" / "EBP01-001" | Read anywhere; parallels and alternate arts tie on text — the picture or the person picks |
| Flesh and Blood | "WTR040" + name on top | Either side of a double-sided number; Rainbow / Cold Foil and 1st Edition offered as the Finish row |
| Star Wars: Unlimited | "LAW" + "017/264" | Set code and number together (a number alone is in every set) |

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

### First real-phone test with the picture AI (2026-11-10, owner's iPhone 17 Pro Max)

About 70 scans of mostly vintage Pokémon, plus Unowns and some trainers.
- Matched cards' AI similarity was 0.39–0.94, with a median of 0.76.
- The picture agreed with the number and name on every normal card.
- What went wrong, and what was fixed the same night:
  - **5 errors.** A fresh server waited 12–15 s to download the picture index, and the phone gives
    up at 12 s. Scans no longer wait for it (`scanner-ai.md`).
  - **Unown (Unseen Forces) wasn't found.** Its number is a letter, "B/28", which OCR read as
    "8/28". With 40+ Unowns, the picture's correct find was cut off the list. Same-name picture
    finds now get the name's score and are compared first, so the card is added.
- The owner's verdict: "working pretty nicely exactly how I want it".

## When a server isn't ready: "busy", never a guess (2026-11-13)

A server keeps each game's catalog in memory. On 2026-11-13, right after two deploys, some fresh
servers had failed to read the English Pokémon catalog and kept an empty one. Clearly read
Jigglypuff and Dark Vileplume scans came back as Japanese and Magic cards, depending on which server
answered. Three guards now:
- `lib/api/catalog.ts`: a failed or empty load is never kept (the next request loads again); a
  failed "changes since the snapshot" read keeps the snapshot and catches up on the next refresh.
- `lib/scan/server.ts` `loadCatalogsChecked`: before matching, each catalog must hold at least 80%
  of the cards in its picture index (the manifest's count — no numbers to maintain). Short → loaded
  again; still short → `ScannerUnavailable`, and the route answers **503 `{ error: 'busy' }`**.
- `lib/scan/scanner.ts`: a 503 is tried twice more, a moment apart; then the tray says "TCGHaven is
  busy — scan it again in a moment". A broken server never produces an answer.

## The real-scan check (every deploy)

`.github/workflows/checks.yml` starts the production build and runs **64 real iPhone scans**
through it (`npm run test:realscans -- <url>`, `scripts/scanner-realscans.mts`). Each scan is judged
exactly as the phone would (`decide.ts` `shortlist` → `decide` → `trayVerdict`, shared with
`scanner.ts`), searching all 12 games. The deploy is blocked when:
- any scan would be **added as the wrong card**;
- fewer than 38 are added right, or fewer than 48 have the right card first (2026-11-13: 40 and 50).

Text only (37 / 48 measured; limits 35 / 46) when the test file's fingerprints come from a different
model than the published one, e.g. right after a retrain. The test file
(`scripts/scanner-realscans.json`) holds each scan's OCR text, its AI fingerprint and the right card
— no photos. Rebuild it after publishing a new model, or after adding scans to
`~/Developer/tcghaven-vision/pc/realscans/truth.json`:

```bash
~/Developer/tcghaven-vision/.venv/bin/python -I tools/scanner-ai/realscans.py \
  <model.pt> <model version> ~/Developer/tcghaven-vision/pc/realscans/truth.json <phone debug scans dir> scripts/scanner-realscans.json
```

The phone debug scans dir is a copy of the app's `Documents/scans` (`xcrun devicectl device copy
from … --source Documents/scans`). Raise the limits in `scanner-realscans.mts` as the scanner
improves. If Firestore or Storage is down the check fails too; re-run it, or use Vercel's Force
Promote in an emergency.

## The card sheet and the review screen

- **Card sheet** (tap a card in the tray → View Card), top to bottom:
  - the catalog photo or your scan;
  - Finish (every printing, with its price);
  - **Condition** (NM / LP / MP / HP; NM by default; hidden for slabs);
  - other matches;
  - grading;
  - search.
  The picks go back to the site with the card.
- **Review screen** (`ScanReviewDialog`):
  - **"Add these cards to group"** at the top puts the whole batch in one group, using the same
    chips as Add Card;
  - then each card's printing, condition and quantity. A card scanned twice in the same condition
    becomes one row with quantity 2.
  - "Add N" saves the batch so the **last card scanned is the newest**: it sits on top of the
    Inventory (newest first), just like adding the cards one by one. The owner asked for this on
    2026-11-13; before that, the first card scanned was on top.
- **Screen stays awake** while the scanner is open: on the iPhone `isIdleTimerDisabled` is on from
  `viewDidAppear` to `viewWillDisappear`; on Android `FLAG_KEEP_SCREEN_ON` is set on the scanner
  dialog. Normal auto-lock comes back when the scanner closes.

## Graded slabs: the cert number (2026-11-11)

Both phones read a slab label's **barcode / QR code**:
- iPhone: Vision `VNDetectBarcodesRequest`, on slab-shaped captures;
- Android: ML Kit barcode scanning.

They send it as `barcodes` with the scan. The site's `readSlabLabel` prefers it over the printed
digits.

`sanitizeCert` (in `scanMatch.ts`, tested by `test:scan`) cleans either source:
- OCR look-alikes become digits (O/Q/D → 0, I/l → 1, S → 5, B → 8, Z → 2);
- "Cert #", spaces and dashes go;
- a lookup link like psacard.com/cert/… or cgccards.com/certlookup/… gives its number;
- TAG's leading letter is kept;
- the result must be 7–10 digits.

The review screen shows an editable **Slab ID** on every graded row, filled in from the scan, and
saves it as the card's `certNumber`.

## Scanning from the website (2026-11-11)

The website's Inventory → **Scan** button (in the app it opens the camera) shows a QR code
(`ScanFromPhoneDialog`):

1. The code is always `https://www.tcghaven.org/scan`, because the app shows the live site.
2. The iPhone's Camera opens that page (`ScanLinkPage`):
   - in Safari, it hands over to the app with `tcghaven://scan`, the app's URL scheme in
     `ios/App/App/Info.plist`, and has a button for when iOS asks first;
   - inside the app, it goes straight on;
   - on a computer, it explains what to do.
3. The app, opened by the link (`lib/nativeApp.ts` `onScanLink`, mounted in `ClientWrapper`), goes
   to `/inventory?scan=1`, which starts the scanner once the collection has loaded. Being launched
   by the link counts once per launch, so a page reload doesn't open the scanner again.
4. The cards are saved on the phone as usual, to the same account. While the dialog is open, the
   website asks for inventory changes every 4 s (`loadCardChanges`), merges them in, and shows the
   cards arriving. No reload is needed.

The link scheme needs app build 2026-11-11 or later; an older app ignores the link.

## Trying it

The app shows the live site, so the site half (route, Scan button, review screen) must be
**deployed** before the phone can use it. Push to main → Checks → Vercel.

1. Run the app from Xcode on the iPhone (the scanner is native code, so this needs the new build).
   The owner's iPhone is paired, so Claude can install over Wi-Fi with no cable: build with
   `xcodebuild -project ios/App/App.xcodeproj -scheme App -destination 'id=<UDID>' build`, then
   `xcrun devicectl device install app --device <UDID> <App.app>`. `xcrun devicectl list devices`
   shows the UDID.
   - **Debug scans:** copy them off the phone with `xcrun devicectl device copy from --device
     <UDID> --domain-type appDataContainer --domain-identifier com.alexhparks.tcghaven --source
     Documents/scans --destination <dir>`. Each scan has card.jpg, ocr.json and result.json.
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
| ~~3~~ | **Done 2026-11-10** — the picture AI (DINOv2-small trained on the 4090) searches every catalog card by picture; Japanese names are translated. See `scanner-ai.md` | Finds the card even when no text is readable; separates look-alikes |
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
| `scripts/scanner-realscans.mts` + `.json` | The real-scan check run on every deploy (`npm run test:realscans`) |
| `tools/scanner-ai/realscans.py` | Builds the real-scan check's test file |
| `lib/scan/decide.ts` | Text + picture (tiles, and the AI's similarity) → matched / pick / none |
| `lib/scan/picture.ts` | The picture AI's search over every catalog card (`scanner-ai.md`) |
| `lib/scan/pokemonJaNames.ts` | Japanese → English Pokémon names, for Japanese cards (generated) |
| `lib/scan/server.ts`, `app/api/cards/scan/route.ts` | The matching endpoint (public, read-only catalog) |
| `lib/scan/scanner.ts` | The site ↔ native-scanner conversation |
| `components/inventory/ScanReviewDialog.tsx` | Review + save (mirrors AddCardDialog's save — keep in step) |
| `components/inventory/ScanFromPhoneDialog.tsx` | The website's Scan button: the QR code, and the cards arriving from the phone |
| `app/scan/page.tsx` → `components/pages/ScanLinkPage.tsx` | Where the QR code points: opens the app's scanner (`tcghaven://scan`) |
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
