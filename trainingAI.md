# Training the card scanner's AI on the Windows PC (RTX 4090)

_Written 2026-11-09 on the Mac. For the owner, and for Claude on the Windows PC: follow these steps in
order. The scanner's design and results so far are in `CardScanner.md`._

## What this is

The card scanner recognises a card from the text on it **and** from its picture. The picture part
is an AI model (**DINOv2**, by Meta, **Apache-2.0 — free for commercial use**) that turns a photo of
a card into a fingerprint and finds the closest of all ~169,000 catalog cards.

Used off the shelf, it finds the right card first only ~62% of the time on real iPhone scans (the
right card is in its top 50 ~96% of the time). This training teaches it our cards specifically:
every catalog card shown as fake phone shots (glare, sleeve sheen, tilt, blur, colour casts, a
thumb), in batches of **look-alike cards**, so it learns what tells similar cards apart. The
4090 + Threadripper do this ~5–10× faster than the Mac.

**Claude on the PC:** run the commands below for the owner, watch the output, and fix problems
(paths, Python, CUDA, out-of-memory). Do **not** change the training maths in `train_cuda.py`
without saying so — the Mac side expects its output format. Never commit the kit, the images or
the trained model to git (they're large, and the kit lives outside the repo).

---

## Step 1 — Get the training kit onto the PC

The kit is **one file, `tcghaven-vision.zip` (4.7 GB)**, made on the Mac and saved to the Mac's
Desktop. It is **not** in git.

1. Copy it from the Mac to the PC — USB drive, or Google Drive / OneDrive / iCloud for Windows.
2. Unzip it. Inside is a folder `tcghaven-vision-kit`. Move/rename it so it is exactly:

   ```
   C:\tcghaven-vision\
   ```

3. Check it contains:

   | | |
   |---|---|
   | `README.md` | the same steps, short |
   | `train_cuda.py` | the training |
   | `requirements.txt` | Python packages |
   | `data\img\` | 169,113 catalog card images, 224 × 308 |
   | `data\ids.txt` | which card each image is (`game:id`) |
   | `data\labels.npy` | cards sharing identical artwork share a label (136,328 distinct pictures) |
   | `data\neighbors.npy` | each picture's closest look-alikes — training batches are built from these |
   | `realscans\` | 57 real iPhone scans + `truth.json` (their right card) — the score after every pass |

> If the zip is missing, ask the owner to make it again on the Mac ("rebuild the training kit
> zip from `~/Developer/tcghaven-vision`"). Don't try to rebuild it on the PC: the images come
> from the catalog sync and take hours to download politely.

## Step 2 — One-time setup (PowerShell)

Needs **Python 3.12** from python.org (tick **"Add python.exe to PATH"** in the installer).
HavenRelief on this PC uses its own `.venv`; this one is separate.

```powershell
cd C:\tcghaven-vision
py -3.12 -m venv .venv
.venv\Scripts\python -m pip install --upgrade pip
.venv\Scripts\python -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu124
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -c "import torch; print(torch.cuda.get_device_name(0))"
```

The last line must print **`NVIDIA GeForce RTX 4090`**. If it prints an error or says CUDA isn't
available, the CUDA build of PyTorch didn't install — re-run the `torch` line (the `cu124` index
matches the NVIDIA driver HavenRelief already uses here).

The first run downloads the DINOv2 weights (~90 MB, weights only — `safetensors`) from Hugging
Face automatically.

## Step 3 — Train the phone model

```powershell
cd C:\tcghaven-vision
.venv\Scripts\python train_cuda.py --model small --epochs 12
```

What you'll see:

1. `before training — real scans: #1 …%  top5 …%  top50 …%` — the starting score on the 57 real
   iPhone scans (the right card ranked among all 169k).
2. A progress line every 50 steps: pass, step, loss, `look-alike acc`, **minutes left**.
3. After **every pass**: the new real-scan score, and the model saved to
   `out\card-dinov2-small.pt` (overwritten each pass — stopping early keeps the latest).

Expected: roughly **10–20 minutes per pass**, so **2–4 hours** for 12. Leave it running; the PC can
be used lightly meanwhile. **Write down the score line after each pass** — it shows whether more
passes still help (if it stops improving for 2–3 passes, more won't help much).

If something goes wrong:

| Problem | Fix |
|---|---|
| `CUDA out of memory` | lower the batch: `--batch 192`, then `--batch 128` |
| GPU use (Task Manager → Performance → GPU) well under ~90% | the CPU is the bottleneck: `--workers 48` |
| Errors about workers / `spawn` on Windows | try `--workers 8` to see if it's worker-related, then raise again |
| It crashes partway | re-run the same command — it starts over, but `out\` keeps the last saved pass |

## Step 4 — (Optional) the bigger, sharper model

After the small one finishes — overnight is ideal:

```powershell
.venv\Scripts\python train_cuda.py --model base --epochs 12 --batch 192
```

Sharper recognition, but ~170 MB in the iPhone app (vs 41 MB) and a little slower per scan. Saved
to `out\card-dinov2-base.pt`. The Mac side will compare both scores and decide which goes in the app.

## Step 5 — Bring the model back to the Mac

Copy these to the Mac (same way the zip came over):

```
C:\tcghaven-vision\out\card-dinov2-small.pt
C:\tcghaven-vision\out\card-dinov2-base.pt      (if trained)
```

…plus the **score lines** from the end of each run. Then tell Claude on the Mac:

> "The trained scanner model is at `<where you put it>`. Re-fingerprint the catalog with it, check
> the real-scan score, convert it for the iPhone and put it in the scanner."

On the Mac, Claude will: re-fingerprint the 169k catalog with the trained model (`embed_all.py`),
re-run the real-scan score, convert it to Core ML (`convert.py` — the untrained version converted
to 41 MB, agreement 0.9997 with the original), put the model in the app and the fingerprint index
on the server, add picture search to the matching (alongside the number, name and picture checks),
and add fingerprinting of new cards to the twice-daily catalog sync.

---

## Where things live on the Mac (for reference)

`~/Developer/tcghaven-vision/` — outside the TCGHaven repo, never committed:

| | |
|---|---|
| `full/img/` | the 169k catalog images |
| `full/index.npy`, `full/ids.txt` | fingerprints of every card (untrained model) |
| `full/labels.npy`, `full/neighbors.npy` | identical-art groups, look-alikes |
| `train.py` | the Mac (Apple-GPU) version of the training |
| `pc/` | the kit that became `tcghaven-vision.zip` |
| `convert.py` | → Core ML for the iPhone |
| `fulleval.py`, `realpic.py` | the accuracy tests |
