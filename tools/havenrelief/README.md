# HavenRelief

Turns flat pin art into a sculpted bas-relief pin for TCG Haven: open models only (commercially
licensed), running on your own machine. No per-pin fees.

- **Layers:** Depth Anything V2 Small (Apache-2.0).
- **Detail:** Marigold Normals v1.1 (Open-RAIL++).

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
pip install torch --index-url https://download.pytorch.org/whl/cu124
pip install -r requirements.txt
python -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0))"
```

The last line should print `True NVIDIA GeForce RTX 4090`.

## Setup: Linux + NVIDIA

```bash
python3.11 -m venv .venv && source .venv/bin/activate
pip install torch --index-url https://download.pytorch.org/whl/cu124
pip install -r requirements.txt
```

## Make a pin

```bash
python havenrelief.py "C:\path\to\jinx.png"
python havenrelief.py jinx.png --quality high
python havenrelief.py jinx.png --depth 0.07
```

- **`--quality high`** averages more AI passes, for cleaner detail.
- **`--depth 0.07`** makes the relief deeper.

Output goes to `out/<art name>/`:

| File | What it is | Where it goes |
|---|---|---|
| `art.webp` | the colours, transparent around the pin | badge editor → **Pin art** |
| `height.png` | relief height (white = high) | badge editor → **Depth map** |
| `normal.png` | full-detail lighting for the relief | badge editor → **Normal map** |
| `clay.png`, `color.png` | previews, to judge it before uploading | none |
| `height16.png` | full-precision height, for later use | none |

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

- **Relief height:** `--depth` (default 0.055) must match `RELIEF_DEPTH` in `components/badges/pinRelief.ts`. The normal map is baked for that height.
- **Height map orientation:** white = high, black = the pin's base. Outside the cutout it's 0.
