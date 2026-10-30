#!/usr/bin/env python3
"""HavenRelief — the AI half of TCG Haven's pin relief tool.

    python havenrelief.py path/to/art.png            # -> out/<name>/ : the relief kit + a default pin
    python havenrelief.py art.png --quality high     # more AI passes averaged: cleaner detail, slower
    python havenrelief.py art.png --levels 4         # the default pin stepped in 4 flat levels
    python server.py                                 # the same analysis for the staff portal (see server.py)

The AI runs once per picture and makes no styling choices: it saves a "relief kit" of raw results,
and the staff portal's Relief Studio turns that into a pin with live controls (depth, smooth or
stepped, detail, raising/lowering single pieces) — no AI re-run per tweak. Open models only,
licensed for commercial use:
  1. Cutout      the art's backdrop (white + its soft drop shadow) is removed from the border inward
  2. Layers      Depth Anything V2 Small (Apache-2.0): what's in front of what
  3. Detail      Marigold Normals v1.1 (Open-RAIL++): the surface direction of every pixel, also
                 integrated into fine height detail (the heavy maths, done here once)
  4. Pieces      Segment Anything ViT-B (Apache-2.0): the art's objects (figure, hair, gems, frame)

The kit (all 2048², 16-bit values split across two 8-bit channels since browsers only read 8-bit
PNGs: value = (R·256 + G) / 65535):
  art.webp     the colours, transparent around the pin                      -> "Pin art"
  layers.png   depth, 0..1 inside the cutout (0 outside)
  detail.png   fine detail, -1..1 stored as (d + 1) / 2
  normal.png   Marigold's normals, object space (x right, y up, z out)      -> "Normal map"
  pieces.png   object id per pixel, R + G·256 + B·65536 (0 = no object)
  kit.json     { version, size, pieces }
plus a pin made with default settings, for checking or uploading by hand:
  height.png   -> "Depth map"   and   clay.png / color.png previews

Runs on an NVIDIA GPU (about a minute), Apple Silicon (MPS) or CPU (slow: up to an hour).
"""
import argparse
import json
import os
import sys
import time

import numpy as np
from PIL import Image
from scipy import ndimage

MAX_SIDE = 2048
KIT_VERSION = 1
QUALITY = {"fast": (1, 2), "normal": (3, 4), "high": (6, 6)}  # Marigold (ensemble, steps)


def log(msg):
    print(f"[havenrelief] {msg}", flush=True)


def pick_device():
    import torch
    if torch.cuda.is_available():
        return "cuda", torch.float16
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps", torch.float32
    return "cpu", torch.float32


# ── Input ───────────────────────────────────────────────────────────────────────────────────

def prepare(src):
    """The art fitted onto a 2048 square: (the art over white as the models see it, its RGB as
    floats, the pin's mask)."""
    has_alpha = src.mode in ("RGBA", "LA") or (src.mode == "P" and "transparency" in src.info)
    rgba = src.convert("RGBA")
    if max(rgba.size) != MAX_SIDE or rgba.size[0] != rgba.size[1]:
        canvas = Image.new("RGBA", (MAX_SIDE, MAX_SIDE), (255, 255, 255, 0 if has_alpha else 255))
        rgba.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
        canvas.paste(rgba, ((MAX_SIDE - rgba.size[0]) // 2, (MAX_SIDE - rgba.size[1]) // 2), rgba)
        rgba = canvas
    arr = np.asarray(rgba).astype(np.float32) / 255
    on_white = arr[..., :3] * arr[..., 3:4] + (1 - arr[..., 3:4])
    if has_alpha:
        mask = ndimage.binary_erosion(arr[..., 3] > 0.5, iterations=1)
    else:
        mask = cutout(on_white)
    return Image.fromarray((on_white * 255).astype(np.uint8)), on_white, mask


def cutout(a):
    """Mask of the pin: everything except the backdrop connected to the border. The backdrop is
    near-white or its grey drop shadow (low saturation, fairly light). Art that already has
    transparency uses its alpha instead."""
    mx, mn = a.max(-1), a.min(-1)
    lab, _ = ndimage.label(((mx - mn) < 0.10) & (mx > 0.45))
    border = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    mask = ~np.isin(lab, border[border > 0])
    mask = ndimage.binary_fill_holes(ndimage.binary_opening(mask, iterations=3))
    return ndimage.binary_erosion(mask, iterations=2)


# ── The models (each loaded once, on first use — server.py keeps them between requests) ────

class Models:
    def __init__(self):
        import torch
        self.device, self.dtype = pick_device()
        self.big_gpu = self.device == "cuda" and torch.cuda.get_device_properties(0).total_memory > 20e9
        self._depth = self._normals = self._sam = None

    def depth(self, img):
        import torch
        from transformers import AutoImageProcessor, AutoModelForDepthEstimation
        if self._depth is None:
            name = "depth-anything/Depth-Anything-V2-Small-hf"
            self._depth = (AutoImageProcessor.from_pretrained(name),
                           AutoModelForDepthEstimation.from_pretrained(name).to(self.device).eval())
        proc, model = self._depth
        side = 1036 if self.device != "cpu" else 770  # multiples of 14 (the model's patch size)
        inp = proc(images=img, return_tensors="pt", size={"height": side, "width": side}, do_resize=True, keep_aspect_ratio=False)
        with torch.no_grad():
            d = model(pixel_values=inp["pixel_values"].to(self.device)).predicted_depth
        d = torch.nn.functional.interpolate(d[:, None].float(), size=img.size[::-1], mode="bicubic", align_corners=False)[0, 0]
        return d.cpu().numpy().astype(np.float32)

    def normals(self, img, quality="normal", tile=0):
        """Marigold normals at the art's native resolution. With room on the GPU it runs the whole
        image in one pass; otherwise overlapping tiles, feather-blended (no seams)."""
        import torch
        from diffusers import MarigoldNormalsPipeline
        if self._normals is None:
            self._normals = MarigoldNormalsPipeline.from_pretrained(
                "prs-eth/marigold-normals-v1-1", variant="fp16" if self.dtype == torch.float16 else None, torch_dtype=self.dtype
            ).to(self.device)
            self._normals.set_progress_bar_config(disable=True)
        pipe = self._normals
        ensemble, steps = QUALITY[quality] if self.device != "cpu" else (1, 2)
        tile = tile or (MAX_SIDE if self.big_gpu else 768)
        W, H = img.size

        def run(im):
            out = pipe(im, num_inference_steps=steps, ensemble_size=ensemble, processing_resolution=im.size[0],
                       match_input_resolution=True, batch_size=1)
            return np.asarray(out.prediction[0], dtype=np.float32)

        if tile >= max(W, H):
            n = run(img)
        else:
            T, OV = tile, tile // 5
            acc = np.zeros((H, W, 3), np.float32)
            wsum = np.zeros((H, W, 1), np.float32)
            xs = list(range(0, W - T, T - OV)) + [W - T]
            ys = list(range(0, H - T, T - OV)) + [H - T]
            ramp = np.minimum(1, np.minimum(np.arange(T) + 1, T - np.arange(T)) / OV).astype(np.float32)
            win = (ramp[None, :] * ramp[:, None])[..., None]
            k, total, t0 = 0, len(xs) * len(ys), time.time()
            for y in ys:
                for x in xs:
                    acc[y:y + T, x:x + T] += run(img.crop((x, y, x + T, y + T))) * win
                    wsum[y:y + T, x:x + T] += win
                    k += 1
                    log(f"  normals tile {k}/{total} ({time.time() - t0:.0f}s)")
            n = acc / np.maximum(wsum, 1e-6)
        return n / np.linalg.norm(n, axis=-1, keepdims=True)

    def pieces(self, img, mask):
        """Segment Anything (ViT-B, Apache-2.0) cuts the art into its objects — the figure, hair,
        face, frame, each gem. Masks are painted largest first, so smaller objects sit on top of
        the ones they're part of. A mask covering most of the picture is the backdrop and is
        skipped. Gaps no mask covers stay 0 (the Studio levels them by depth, pixel by pixel — a gap
        is often the frame and the backdrop behind it joined together; filling them from the
        nearest object carved them into straight-edged wedges); only specks join their nearest
        object."""
        import torch
        from transformers import pipeline
        if self._sam is None:
            self._sam = pipeline("mask-generation", model="facebook/sam-vit-base",
                                 device=0 if self.device == "cuda" else self.device, torch_dtype=torch.float32)
        masks = self._sam(img, points_per_batch=64, points_per_crop=64, pred_iou_thresh=0.8, stability_score_thresh=0.85)["masks"]
        masks = [np.asarray(m, bool) & mask for m in masks]
        masks = [m for m in masks if m.sum() < 0.5 * mask.sum()]
        seg = np.zeros(mask.shape, np.int32)
        for i, m in enumerate(sorted(masks, key=lambda m: -m.sum()), 1):
            seg[m] = i
        gaps, n = ndimage.label(mask & (seg == 0))
        if n:
            area = ndimage.sum(np.ones(mask.shape), gaps, np.arange(1, n + 1))
            speck = np.zeros(n + 1, bool)
            speck[1:] = area < mask.sum() * 0.0005
            if speck.any():
                _, (iy, ix) = ndimage.distance_transform_edt(seg == 0, return_indices=True)
                seg = np.where(speck[gaps], seg[iy, ix], seg)
        # renumber 1..n with no holes
        ids = np.unique(seg[seg > 0])
        remap = np.zeros(seg.max() + 1, np.int32)
        remap[ids] = np.arange(1, len(ids) + 1)
        return remap[seg]


# ── Analysis: picture -> kit ────────────────────────────────────────────────────────────────

def integrate(gx, gy):
    """Least-squares surface from slopes (Poisson, FFT on a mirror-padded domain)."""
    H, W = gx.shape
    px = np.pad(gx, ((0, H), (0, W)))
    py = np.pad(gy, ((0, H), (0, W)))
    px[:, W:] = -px[:, W - 1::-1]
    px[H:, :] = px[H - 1::-1, :]
    py[H:, :] = -py[H - 1::-1, :]
    py[:, W:] = py[:, W - 1::-1]
    HH, WW = px.shape
    WX, WY = np.meshgrid(np.fft.fftfreq(WW) * 2 * np.pi, np.fft.fftfreq(HH) * 2 * np.pi)
    den = WX ** 2 + WY ** 2
    den[0, 0] = 1
    Z = (-1j * WX * np.fft.fft2(px) - 1j * WY * np.fft.fft2(py)) / den
    Z[0, 0] = 0
    return np.real(np.fft.ifft2(Z))[:H, :W]


def free_gpu():
    """Hand back the GPU memory a step held on to. With three models resident (server.py keeps them
    between requests) the card filled to its last GB, and Windows then quietly spills into system
    RAM — the same analysis took 150s instead of 60."""
    import torch
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


def analyze(models, img, mask, quality="normal"):
    """Everything the AI contributes, as plain arrays: layers (depth 0..1), detail (-1..1),
    normals (unit, object space) and pieces (object ids)."""
    t0 = time.time()
    log("depth (Depth Anything V2 Small)")
    depth = models.depth(img)
    free_gpu()
    lo, hi = depth[mask].min(), depth[mask].max()
    layers = np.clip((depth - lo) / max(hi - lo, 1e-6), 0, 1)
    layers[~mask] = 0

    log(f"detail (Marigold Normals) [{time.time() - t0:.0f}s]")
    normals = models.normals(img, quality)
    free_gpu()
    # Fine detail: the normals' slopes integrated into height. Integrating predicted normals always
    # leaves a broad drift (a false tilt across the pin), so it's removed — the layers give the big
    # shape instead.
    inside = mask.astype(np.float32)
    nz = np.clip(normals[..., 2], 0.3, 1)
    z = integrate(-normals[..., 0] / nz * inside, normals[..., 1] / nz * inside)
    s = MAX_SIDE / 40
    drift = ndimage.gaussian_filter(z * inside, s) / np.maximum(ndimage.gaussian_filter(inside, s), 1e-3)
    detail = z - drift
    detail /= max(np.abs(detail[mask]).max(), 1e-6)
    detail[~mask] = 0

    log(f"pieces (Segment Anything) [{time.time() - t0:.0f}s]")
    pieces = models.pieces(img, mask)
    free_gpu()
    log(f"AI done [{time.time() - t0:.0f}s]")
    normals = normals.copy()
    normals[~mask] = (0, 0, 1)
    return layers, detail, normals, pieces


def pack16(v):
    """0..1 floats -> an RGB PNG image carrying 16 bits: R = high byte, G = low byte."""
    q = np.round(np.clip(v, 0, 1) * 65535).astype(np.uint32)
    return Image.fromarray(np.dstack([q >> 8, q & 255, np.zeros_like(q)]).astype(np.uint8), "RGB")


def kit_images(on_white, mask, layers, detail, normals, pieces):
    """The kit's files as PIL images (name -> image), plus its kit.json."""
    alpha = (ndimage.gaussian_filter(mask.astype(np.float32), 0.8) * 255).astype(np.uint8)
    p = pieces.astype(np.uint32)
    images = {
        "art.webp": Image.fromarray(np.dstack([(on_white * 255).astype(np.uint8), alpha]), "RGBA"),
        "layers.png": pack16(layers),
        "detail.png": pack16((detail + 1) / 2),
        "normal.png": Image.fromarray(((normals * 0.5 + 0.5) * 255).round().astype(np.uint8), "RGB"),
        "pieces.png": Image.fromarray(np.dstack([p & 255, (p >> 8) & 255, (p >> 16) & 255]).astype(np.uint8), "RGB"),
    }
    meta = {"version": KIT_VERSION, "size": MAX_SIDE, "pieces": int(pieces.max())}
    return images, meta


def save_image(im, path_or_file, name):
    if name.endswith(".webp"):
        im.save(path_or_file, "WEBP", quality=92, method=6)
    else:
        im.save(path_or_file, "PNG", optimize=False, compress_level=6)


# ── A pin from the kit with fixed settings (the Studio does this live, in the browser) ──────

def compose(mask, layers, detail, pieces, levels=0, detail_amount=0.3, step_detail=0.12):
    """Height 0..1. Smooth: layers + detail. Stepped (levels >= 2): every piece flat at one of N
    evenly spaced heights (its median depth, snapped to the nearest level from area-weighted 1-D
    k-means), gaps between pieces levelled pixel by pixel, a little detail on top. Mirrors
    components/badges/reliefStudio.ts — keep the two in step."""
    if levels >= 2:
        d = ndimage.gaussian_filter(layers, 2)
        ids = np.unique(pieces[pieces > 0])
        med = np.array(ndimage.median(d, pieces, ids))
        wts = np.array(ndimage.sum(np.ones_like(d), pieces, ids))
        c = np.quantile(med, (np.arange(levels) + 0.5) / levels)
        for _ in range(50):
            k = np.abs(med[:, None] - c[None, :]).argmin(1)
            c = np.array([np.average(med[k == j], weights=wts[k == j]) if (k == j).any() else c[j] for j in range(levels)])
        rank = np.empty(levels, int)
        rank[np.argsort(c)] = np.arange(levels)
        height = np.zeros(pieces.max() + 1, np.float32)
        height[ids] = rank[np.abs(med[:, None] - c[None, :]).argmin(1)] / (levels - 1)
        h = height[pieces]
        gap = mask & (pieces == 0)
        if gap.any():
            px = rank[np.abs(ndimage.gaussian_filter(layers, 4)[..., None] - c).argmin(-1)]
            px = ndimage.median_filter(np.where(gap, px, -1), size=9)
            h = np.where(gap, np.maximum(px, 0) / (levels - 1), h)
        h = (1 - step_detail) * ndimage.gaussian_filter(h.astype(np.float32), 1) + step_detail * detail
    else:
        h = 0.62 * layers + detail_amount * detail
    h = (h - h[mask].min()) / max(h[mask].max() - h[mask].min(), 1e-6)
    h[~mask] = 0
    return h


def previews(a, mask, n):
    L = np.array([-0.55, 0.6, 0.58])
    L /= np.linalg.norm(L)
    dif = np.clip((n * L).sum(-1), 0, 1)
    Hv = L + [0, 0, 1]
    Hv /= np.linalg.norm(Hv)
    spec = np.clip((n * Hv).sum(-1), 0, 1) ** 60
    clay = np.where(mask, 0.16 + 0.78 * dif + 0.3 * spec, 0.10)
    col = np.where(mask[..., None], a * (0.25 + 0.9 * dif)[..., None] + 0.35 * spec[..., None], 0.10)
    u8 = lambda x: (np.clip(x, 0, 1) * 255).astype(np.uint8)
    return Image.fromarray(u8(clay)), Image.fromarray(u8(col))


# ── Command line ────────────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description="HavenRelief: pin art -> relief kit (+ a default pin) for TCG Haven")
    ap.add_argument("art", help="pin art (PNG/JPEG/WebP), straight-on, on a plain white or transparent background")
    ap.add_argument("--out", default="out", help="output folder (a subfolder per art file)")
    ap.add_argument("--quality", choices=list(QUALITY), default="normal",
                    help="fast = 1 AI pass; normal = 3 averaged; high = 6 averaged, more steps")
    ap.add_argument("--levels", type=int, default=0,
                    help="the default pin stepped in N flat, evenly spaced levels (e.g. 4); 0 = smooth")
    ap.add_argument("--reuse", action="store_true", help="reuse this art's saved kit instead of re-running the AI")
    args = ap.parse_args()

    name = os.path.splitext(os.path.basename(args.art))[0]
    out = os.path.join(args.out, name)
    os.makedirs(out, exist_ok=True)
    t0 = time.time()
    img, on_white, mask = prepare(Image.open(args.art))
    raw = os.path.join(out, "raw.npz")
    if args.reuse and os.path.exists(raw):
        log("reusing the saved analysis")
        r = np.load(raw)
        layers, detail, normals, pieces = r["layers"], r["detail"], r["normals"], r["pieces"]
    else:
        models = Models()
        log(f"{args.art} on {models.device}, quality {args.quality}")
        layers, detail, normals, pieces = analyze(models, img, mask, args.quality)
        np.savez_compressed(raw, layers=layers, detail=detail, normals=normals.astype(np.float32), pieces=pieces)

    images, meta = kit_images(on_white, mask, layers, detail, normals, pieces)
    for fname, im in images.items():
        save_image(im, os.path.join(out, fname), fname)
    with open(os.path.join(out, "kit.json"), "w") as f:
        json.dump(meta, f)

    h = compose(mask, layers, detail, pieces, levels=args.levels)
    Image.fromarray((h * 255).round().astype(np.uint8)).save(os.path.join(out, "height.png"))
    clay, col = previews(on_white, mask, normals)
    clay.save(os.path.join(out, "clay.png"))
    col.save(os.path.join(out, "color.png"))
    log(f"done in {time.time() - t0:.0f}s -> {out} ({meta['pieces']} pieces)")
    log("the Relief Studio (staff portal) takes it from here; or upload by hand: art.webp = Pin art, height.png = Depth map, normal.png = Normal map")


if __name__ == "__main__":
    sys.exit(main())
