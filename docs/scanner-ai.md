# The scanner's picture AI

_Written 2026-11-10, when the first trained model went live. Read this before touching the picture
model, the fingerprint index, `lib/scan/picture.ts`, the AI parts of `lib/scan/decide.ts`, or
`CardFingerprinter` in `CardScanner.swift`. How the scanner works overall is in `card-scanner.md`;
how to train a new model on the Windows PC is in `training-ai.md`._

## In one paragraph

The phone turns each scanned card into a **fingerprint**: 384 numbers from a trained AI model
(DINOv2-small, by Meta, Apache-2.0). Only those numbers are sent, never the photo. The server holds
the fingerprint of **every catalog card's photo** (~245,000) and finds the closest ones in ~50–170 ms.
Those look-alikes join the candidates the text found, and the AI's similarity helps decide between
them. The rule that **nothing is ever added wrong** still holds: the picture breaks ties and can
stop a doubtful add, but it never adds a card on its own.

## What it's worth (measured 2026-11-10, model `small-p7-20261110`)

"#1" = the right card is the picture search's first answer among **all** catalog cards.

| Test | Off-the-shelf model | **Trained (in use)** |
|---|---|---|
| 57 real iPhone scans (Pokémon, Riftbound, Lorcana) — #1 | 61% | **88%** |
| …top 5 | 86% | **93%** |
| …among cards of the same name, #1 (the text read the name) | 67% | **91%** (top 5: 100%) |
| 180 catalog cards with fake phone damage — #1 | 89% | **99%** |
| …harsh glare + blur | 80% | **99%** |
| **Games it was never trained on** (Yu-Gi-Oh!, SWU, Gundam, FaB, Digimon, Palworld, Cyberpunk), 1,050 fake phone shots — #1 | 81% | **96%** (top 5: 100%) |
| …harsh | 72% | **96%** |

- The training generalises. Games and sets added after training are recognised almost as well as
  the trained ones, so a new set works from the day it's fingerprinted, before any retraining.
- **Flesh and Blood is the weakest at #1 (77–80%; top 5 100%).** Its red, yellow and blue versions of a card share
  the art, and the printed text tells those apart.
- **These are honest numbers, with caveats.** The 57 real scans also chose which training pass to
  keep, so 88% is a little flattering (1 scan ≈ 1.75%). The fake damage is computer-made, but it's
  a different kind of damage than the training used.
- **The base model was dropped (owner's decision, 2026-11-10).** It was about as accurate
  (86% / 96%), but it's ~170 MB, about 4× slower per scan, and slower to retrain. Use small.

## How it fits together

```
iPhone (CardScanner.swift)                         Site
──────────────────────────                         ────
scanner opens ─────────────────────────────────▶  GET /api/cards/scan?model=1 → { version, files }
CardFingerprinter.prepare: download the                 (from catalog/scanner/manifest.json)
  .mlpackage once per version (~41 MB), compile,
  keep in Application Support (not backed up)
card read: flatten → OCR → fingerprint
  (224×308, squashed; a landscape card also
  turned each way) ────────────────────────────▶  POST /api/cards/scan { lines, games, fingerprints }
                                                     server.ts: text candidates (scanMatch.ts)
                                                     + picture.ts: the closest catalog photos
                                                       (≥ 0.42 alike, top 8) + each candidate's
                                                       similarity → ScanMatch.picture
tile comparison of the candidates (as before) ◀──  scanner.ts → decide.ts (text + tiles + AI)
tray: ✓ added / ? pick one                     ◀──  the answer
```

- **Storage** (`catalog/scanner/`, public read, staff write — storage.rules' `catalog/{game}/{fileName}`):
  - `manifest.json` lists the model version, its Core ML files, the weights, and each catalog's
    count + `rev`.
  - `index-{catalog}.bin` holds int8 fingerprints (`n × 384`, value × 384) and
    `index-{catalog}.json` the card ids in row order, for the 13 catalogs (Pokémon EN and JP
    separate).
  - `model-{version}-*` are the Core ML package's three files, and `model-{version}.pt` the
    PyTorch weights (for the index updater). Those are immutable; the index files are overwritten
    in place.
- **Server** (`lib/scan/picture.ts`): loads a catalog's index on first use, keeps it in memory, and
  re-checks the manifest every 30 min. Brute force: 245k × 384 int8 dot products ≈ 165 ms for every
  game, ~50 ms for three. It refuses a half-written update (size check) and keeps the old copy.
  Cards hidden since they were fingerprinted are dropped (they're not in the visible catalog).
- **A scan never waits for the index to download.** A fresh server needs 5–15 s to fetch every
  game's fingerprints (~96 MB), and the phone gives up after 12 s: on 2026-11-10, 3 of 5 scans
  errored. A scan now uses whatever is loaded (text only if nothing is) and starts the rest
  loading. The scanner's warm-up call is the one that waits. When the AI has compared every
  candidate, the phone's tile comparison (thumbnail downloads) is skipped.
- **A name shared by many printings** brings in only 24 of them (40+ Unowns). A picture find with
  that same printed name gets the name's text score (`why: 'name + picture'`), and picture finds
  are compared first, so they can't be pushed out. A real Unown B ("B/28" read as "8/28") was
  found this way: 0.62–0.67 alike, 0.2 ahead of the rest.
- **Unown letters** (2026-11-13): Unseen Forces' Unowns print "B/28". The AI can't tell them apart (the
  holo shine on camera: the owner's Unown B scored 0.18 against its own photo), so the number does it:
  `scanMatch.ts` reads a letter numerator ("B/28", or a look-alike digit "8/28") as the letter, only for
  cards whose catalog number is a letter. The earlier "0.62–0.67" figure for Unown B didn't hold up.
- **Phone model start-up** (2026-11-13): iOS prepares a Core ML model for the Neural Engine on first
  load and again after every app install/update (slow). A scan's fingerprint asked for then used to
  wait on the camera thread, so the scanner seemed stuck. `CardFingerprinter` now loads a GPU copy
  first (warmed before any scan uses it), then swaps in the Neural Engine copy once it has answered.
  Both times are logged ("ready on the GPU in … ms", "Neural Engine ready in … ms").
- **Phone** (`CardFingerprinter`): no model in the app bundle. The site names the version and the
  phone downloads it, so **a retrained model reaches phones with no app update**. Until it's ready
  (first open, offline), scans go without a fingerprint and work as before.
- **New cards** (`.github/workflows/scanner-index.yml`, 10:30 + 22:30 UTC, after the syncs):
  `npm run scanner-index -- update` fingerprints every visible catalog card with a photo that isn't
  in the index yet, on the CPU (~3,000 max a run), and uploads the catalogs that changed. Cards
  whose photo link is broken stay missing and are tried again each run (~1,850 Yu-Gi-Oh!
  products have no TCGplayer photo; text matching still finds them).
- `npm run scanner-index -- status` shows what's published and how many catalog cards are missing.

## How the picture is used in the decision (`lib/scan/decide.ts`)

Similarity = cosine of the two fingerprints. On the 57 real scans:

- The right card scored 0.35–0.89 (median 0.63).
- **Whenever another card outscored the right one, it was ahead by at most 0.13.** Same-name
  printings (Paras, Grimer reprints) were ahead by at most 0.10.

The rules follow from that (constants at the top of decide.ts; `npm run test:scan` covers each):

| Rule | Threshold |
|---|---|
| The AI is used for the picture side | when every card still in the running (text within 20 of the best) has a similarity — otherwise the old tile comparison decides, e.g. for a card too new to be fingerprinted |
| Picture points (like the tiles') | up to 25, falling to 0 at 0.12 below the best; fully trusted once the best is ≥ 0.55 |
| The picture alone breaks a text tie | only with a **0.12+** lead over every other candidate |
| The picture stops a text answer being added | another card is **0.15+** more alike and ≥ 0.6 (a slab's label is exempt) |
| The text's answer must look like the scan | ≥ 0.45, unless the text is decisive (≥ 90, 15 ahead) |
| Found by a shared name only (many printings) | added only when ≥ 0.6 alike and 0.15+ ahead of every other candidate |
| Found by the picture only | **always asked** ("pick one"); shown in the tray from 0.55, offered from 0.45 |

Raising any threshold is safe; lowering one needs new real-scan evidence (`tools/scanner-ai/calib.py`).

## Japanese cards

The picture doesn't care what language the text is in. A Japanese card's art is compared with the
Japanese catalog's own photos (27,630 Pokémon JP cards are indexed), so Japanese is as easy as
English for the picture: the fake-damage test scored 100% on Pokémon JP.

The text side now reads Japanese names too. `lib/scan/pokemonJaNames.ts` maps every Pokémon's
katakana name to English (1,025; regenerate with `node scripts/gen-pokemon-ja-names.mjs` when a
new generation comes out). So "リザードンex" along the top is read as "Charizard ex" and matched
like an English card:

- the longest name wins, so ミュウツー is Mewtwo, not Mew;
- the regional and Mega prefixes are read too (アローラ = Alolan, ガラル = Galarian, ヒスイ =
  Hisuian, パルデア = Paldean, メガ = Mega);
- "〜から進化" (evolves from) is skipped;
- half-width katakana works.

Japanese **trainer and energy** names aren't translated; the number, set mark and picture carry those.

## After a training run (Mac side — do this in order)

The PC sends back `.pt` checkpoints (training-ai.md step 5). Keep everything outside the repo in
`~/Developer/tcghaven-vision/`; **never commit models, indexes or images.** The scripts are in
`tools/scanner-ai/`; run them with the vision venv: `~/Developer/tcghaven-vision/.venv/bin/python -I …`.

1. **Score each candidate pass**, small only:
   - `embed_catalog.py <pass.pt> <outdir>` fingerprints the trained games' 169k images
     (`full/img`, ~20 min at ~136/s on the M6).
   - `score.py <pass.pt> <outdir> <scratch>` gives the real scans plus the 180-card benchmark.
   - `unseen.py <pass.pt> <outdir> <catdir>` scores the games the run didn't train on.
   - **Pick the pass from these, not from the PC's last pass:** the first run peaked at pass 6–7
     and over-fitted by pass 12.
2. **Convert:** `convert.py <pass.pt> <out>/CardFingerprint.mlpackage`. The check line must say
   min cosine ≥ 0.999 (it was 0.99984).
3. **Fingerprint the newer games** if the run didn't include them (`full2/img`, via `unseen.py`'s
   index2). Then **pack**: `pack.py <packed> <index.npy> <ids.txt> [<index2.npy> <ids2.txt>]`.
4. **Publish model and index together**:
   `npm run scanner-index -- publish <packed> --model <mlpackage> --weights <pass.pt> --version small-pN-YYYYMMDD`.
   The index must come from the same model as the Core ML file. Phones pick up the new version the
   next time the scanner opens.
5. **Re-check the thresholds** with `calib.py` (right-card similarity, lead over the best wrong).
   A new model can shift the scale.
6. Note the new scores here and in training-ai.md.

The first run's files: `~/Developer/tcghaven-vision/trained/`
- `card-dinov2-small.pass7.pt` is in use; pass 6 is kept too.
- `small-pass7/` holds the indexes, `coreml/` the Core ML file, and `eval/` that day's scripts and
  outputs.

## For the next training run

- **Add the newer games.** The first run trained only on Pokémon EN/JP, One Piece, Lorcana,
  Riftbound and Magic. The other 75,770 card images are already at `~/Developer/tcghaven-vision/full2/img/`.
- **Use Windows-safe file names.** Map ids to files with `ids.txt`, never by sort order: `?` in
  `pokemon:ex10-?` broke the PC's unzip.
- **Stop at about 7 passes** (`--epochs 7`). Use `--workers 24 --prefetch 2 --grad-checkpoint` on
  the PC (training-ai.md).
- **Get more real scans.** This is the most valuable step. A few hundred, including foils, sleeves,
  toploaders, Japanese cards and the newer games, would make choosing a pass firmer.
  - Test builds keep every scan on the phone (`card-scanner.md` "Debug scans").
  - Each scan's `result.json` now records the AI similarity in each option's `detail`.

## Files

| File | What |
|---|---|
| `lib/scan/picture.ts` | Loads the index from Storage, picture search, similarity, the model's download info |
| `lib/scan/server.ts` | Adds picture finds and similarities to the scan candidates |
| `lib/scan/decide.ts` | The AI rules (top of the file) |
| `lib/scan/scanner.ts` | Asks the phone to prepare the model, and forwards the fingerprints |
| `lib/scan/pokemonJaNames.ts` | Japanese → English Pokémon names (generated) |
| `app/api/cards/scan/route.ts` | `?model=1`, and `fingerprints` on POST |
| `ios/App/App/CardScanner.swift` | `CardFingerprinter` (download, compile, fingerprint), `prepareModel` |
| `scripts/scanner-index.mjs` | `status` / `publish` / `update` |
| `.github/workflows/scanner-index.yml` | The twice-daily update |
| `tools/scanner-ai/` | The Python side: common.py, embed_catalog, score, unseen, calib, convert, pack, fingerprint_new, fetch_images, train_cuda (the PC's copy), pilot (the fake phone damage) |
