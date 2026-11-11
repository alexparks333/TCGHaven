# tools/scanner-ai — the card scanner's picture AI (Python side)

Everything about the model, the index and how to retrain it: **`docs/scanner-ai.md`**. Training on
the Windows PC: `docs/training-ai.md`.

Data, models and images live outside the repo in `~/Developer/tcghaven-vision/` (never commit
them). Run these with that folder's venv, isolated: `~/Developer/tcghaven-vision/.venv/bin/python -I <script> …`.

| Script | Does |
|---|---|
| `common.py` | Load a model, prepare a picture the way the phone does, int8 packing (`SCALE` = `lib/scan/picture.ts` `INT8_SCALE`) |
| `embed_catalog.py <ckpt\|small> <outdir>` | Fingerprint the trained games' 169k images (`full/img`) |
| `score.py <ckpt> <outdir> <scratch>` | Real scans + the 180-card benchmark; `VARIANTS=1` also tries int8 / PCA |
| `unseen.py <ckpt> <outdir> <catdir>` | Fingerprint and score the games not in training (`full2/img`) |
| `calib.py` | Similarity margins on the real scans, for decide.ts's thresholds |
| `convert.py <ckpt> <out.mlpackage>` | → Core ML, checked against PyTorch |
| `pack.py <outdir> <index.npy> <ids.txt> …` | → the per-catalog files `npm run scanner-index -- publish` uploads |
| `fingerprint_new.py <ckpt> <todo.json> <out.npz>` | The CI updater's AI step (CPU) |
| `fetch_images.py <catdir> <outdir>` | Download catalog images at model size |
| `train_cuda.py` | The PC's training script (copy; runs in the kit folder on the PC) |
| `pilot.py` | Source of the fake phone damage (`phone()`) the tests use |
