# HavenRelief

Turns flat pin art into a sculpted bas-relief pin for TCG Haven: open models only (commercially
licensed), running on your own machine. No per-pin fees.

- **Layers:** Depth Anything V2 Small (Apache-2.0).
- **Detail:** Marigold Normals v1.1 (Open-RAIL++).
- **Pieces:** Segment Anything ViT-B (Apache-2.0).

The AI makes a **relief kit** (raw results, no styling choices); the staff portal's **Relief
Studio** turns it into a pin with live controls. Run the server for the Studio:

```powershell
.venv\Scripts\python server.py          # http://127.0.0.1:7861 — the Studio analyzes through it
```

Every analysis is cached in `cache/` by the image's bytes, so the same art again is instant.

## Speed

| Machine | One pin (2048px) |
|---|---|
| NVIDIA RTX 4090 | about 10–30 s (about 1 min at `--quality high`) |
| Apple Silicon | a few minutes |
| CPU only (e.g. the Intel MacBook) | up to about an hour |

The first run also downloads the models once (about 5 GB).

## Setup: Windows + NVIDIA

1. Install **Python 3.11** from python.org. Tick "Add python.exe to PATH".
2. Install **Git**, or copy this `tools/havenrelief` folder over.
3. In PowerShell, inside `tools\havenrelief`:

```powershell
py -3.11 -m venv .venv
.venv\Scripts\activate
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu124
pip install -r requirements.txt
python -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0))"
```

The last line should print `True NVIDIA GeForce RTX 4090`.

## Setup: Linux + NVIDIA

```bash
python3.11 -m venv .venv && source .venv/bin/activate
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu124
pip install -r requirements.txt
```

## Make a pin

```bash
python havenrelief.py "C:\path\to\jinx.png"
python havenrelief.py jinx.png --quality high
```

- **`--quality high`** averages more AI passes, for cleaner detail.

Output goes to `out/<art name>/`:

| File | What it is | Where it goes |
|---|---|---|
| `art.webp` | the colours, transparent around the pin | badge editor → **Pin art** |
| `height.png` | relief height (white = high) | badge editor → **Depth map** |
| `normal.png` | full-detail lighting for the relief | badge editor → **Normal map** |
| `clay.png`, `color.png` | previews, to judge it before uploading | none |
| `layers.png`, `detail.png`, `pieces.png`, `kit.json` | the kit the Relief Studio works from | uploaded by the Studio |

Then in the staff portal: **Badges → edit the badge**.
1. Upload the three files.
2. Remove any 3D model; a model takes priority over the relief.
3. Save.

## Art tips (consistent input → consistent pins)

- **Framing:** straight-on, the whole pin in frame.
- **Background:** plain white or transparent.
- **Lighting:** even and soft, with no strong cast shadows or perspective.
- **Size:** square, 2048×2048 is best. Other sizes are fitted onto a 2048 square.

## Keep in sync with the app

- **Relief height** is set by the app alone (`RELIEF_DEPTH` in `components/badges/pinRelief.ts`). The normal map is Marigold's raw object-space normals, so it fits any height.
- **Height map orientation:** white = high, black = the pin's base. Outside the cutout it's 0.
