#!/usr/bin/env python3
"""HavenRelief — turn flat pin art into a sculpted bas-relief pin for TCG Haven.

    python havenrelief.py path/to/art.png            # -> out/<name>/ (art, height, normal map, previews)
    python havenrelief.py art.png --quality high     # more AI passes averaged: cleaner detail, slower
    python havenrelief.py art.png --depth 0.07       # deeper relief (default 0.055 = matches the app)

What it does (all open models, licensed for commercial use, running locally — no per-pin fees):
  1. Cutout      the art's backdrop (white + its soft drop shadow) is removed from the border inward
  2. Layers      Depth Anything V2 Small (Apache-2.0) estimates what's in front of what
  3. Detail      Marigold Normals v1.1 (Open-RAIL++) estimates the surface direction of every pixel
  4. Relief      detail is integrated into height, riding on the depth layers, then compressed into
                 coin depth (bas-relief): big jumps flattened, fine detail kept
  5. Outputs     for the staff portal's badge editor (Badges -> edit badge):
                   art.webp      -> "Pin art"    (the colours; transparent around the pin)
                   height.png    -> "Depth map"  (white = high)
                   normal.png    -> "Normal map" (full-detail lighting, made for --depth)
                 plus clay.png / color.png previews and height16.png (full precision, for later use)

Runs on an NVIDIA GPU (fast: seconds), Apple Silicon (MPS) or CPU (slow: up to an hour).
"""
import argparse
import os
import sys
import time

import numpy as np
from PIL import Image
from scipy import ndimage

MAX_SIDE = 2048


def log(msg):
    print(f"[havenrelief] {msg}", flush=True)


def pick_device():
    import torch
    if torch.cuda.is_available():
        return "cuda", torch.float16
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps", torch.float32
    return "cpu", torch.float32


# ── 1. Cutout ───────────────────────────────────────────────────────────────────────────────

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


# ── 2. Depth (layers) ───────────────────────────────────────────────────────────────────────

def estimate_depth(img, device, dtype):
    import torch
    from transformers import AutoImageProcessor, AutoModelForDepthEstimation
    name = "depth-anything/Depth-Anything-V2-Small-hf"
    proc = AutoImageProcessor.from_pretrained(name)
    model = AutoModelForDepthEstimation.from_pretrained(name).to(device).eval()
    side = 1036 if device != "cpu" else 770  # multiples of 14 (the model's patch size)
    inp = proc(images=img, return_tensors="pt", size={"height": side, "width": side}, do_resize=True, keep_aspect_ratio=False)
    with torch.no_grad():
        d = model(pixel_values=inp["pixel_values"].to(device)).predicted_depth
    d = torch.nn.functional.interpolate(d[:, None].float(), size=img.size[::-1], mode="bicubic", align_corners=False)[0, 0]
    return d.cpu().numpy().astype(np.float32)


# ── 3. Normals (detail) ─────────────────────────────────────────────────────────────────────

def estimate_normals(img, device, dtype, ensemble, steps, tile):
    """Marigold normals at the art's native resolution. With room on the GPU it runs the whole
    image in one pass; otherwise overlapping tiles, feather-blended (no seams)."""
    import torch
    from diffusers import MarigoldNormalsPipeline
    pipe = MarigoldNormalsPipeline.from_pretrained(
        "prs-eth/marigold-normals-v1-1", variant="fp16" if dtype == torch.float16 else None, torch_dtype=dtype
    ).to(device)
    pipe.set_progress_bar_config(disable=True)
    W, H = img.size

    def run(im):
        out = pipe(im, num_inference_steps=steps, ensemble_size=ensemble, processing_resolution=im.size[0],
                   match_input_resolution=True, batch_size=1)
        return np.asarray(out.prediction[0], dtype=np.float32)

    if tile >= max(W, H):
        return run(img)
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
            n = run(img.crop((x, y, x + T, y + T)))
            acc[y:y + T, x:x + T] += n * win
            wsum[y:y + T, x:x + T] += win
            k += 1
            log(f"  normals tile {k}/{total} ({time.time() - t0:.0f}s)")
    n = acc / np.maximum(wsum, 1e-6)
    return n / np.linalg.norm(n, axis=-1, keepdims=True)


# ── 4. Relief ───────────────────────────────────────────────────────────────────────────────

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


def build_relief(mask, depth, normals, layer_weight=0.62, detail_weight=0.30):
    H, W = mask.shape
    inside = mask.astype(np.float32)

    def mblur(x, s):
        return ndimage.gaussian_filter(x * inside, s) / np.maximum(ndimage.gaussian_filter(inside, s), 1e-3)

    # layers: depth inside the cutout, normalised and gently compressed (tall stays tall)
    lo, hi = np.percentile(depth[mask], 2), np.percentile(depth[mask], 99.5)
    dn = np.clip((depth - lo) / max(hi - lo, 1e-6), 0, 1.2)
    layers = np.tanh(dn * 1.4) / np.tanh(1.4)

    # detail: slopes from normals (x right, y up, z out), big slopes compressed, integrated; the
    # broad drift integration leaves is removed (the depth layers provide the big shape)
    nz = np.clip(normals[..., 2], 0.3, 1)
    gx, gy = -normals[..., 0] / nz, normals[..., 1] / nz
    g = np.hypot(gx, gy)
    A = 1.2
    f = np.where(g > 1e-6, A * np.log1p(g / A) / np.maximum(g, 1e-6), 1)
    z = integrate(gx * f * inside, gy * f * inside)
    detail = z - mblur(z, W / 40)
    detail /= max(np.percentile(np.abs(detail[mask]), 99.5), 1e-6)

    h = layer_weight * layers + detail_weight * detail
    h = h - np.percentile(h[mask], 1)
    h = np.clip(h / max(np.percentile(h[mask], 99.8), 1e-6), 0, 1)
    # a low crisp rim at the outline, so the pin has a body
    dist = ndimage.distance_transform_edt(mask)
    h = (0.10 + 0.90 * h) * np.clip(dist / 3, 0, 1)
    h[~mask] = 0
    return h


def normal_map(h, depth):
    """Tangent-space normal map (+y up) of the relief at the height the app builds it (`depth`,
    as a fraction of the pin's width — must match RELIEF_DEPTH in components/badges/pinRelief.ts)."""
    W = h.shape[1]
    dzdx = np.gradient(h, axis=1) * depth * W
    dzdr = np.gradient(h, axis=0) * depth * W
    n = np.dstack([-dzdx, dzdr, np.ones_like(h)])
    return n / np.linalg.norm(n, axis=-1, keepdims=True)


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


# ── Main ────────────────────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description="HavenRelief: pin art -> bas-relief pin files for TCG Haven")
    ap.add_argument("art", help="pin art (PNG/JPEG/WebP), straight-on, on a plain white or transparent background")
    ap.add_argument("--out", default="out", help="output folder (a subfolder per art file)")
    ap.add_argument("--quality", choices=["fast", "normal", "high"], default="normal",
                    help="fast = 1 AI pass; normal = 3 averaged; high = 6 averaged, more steps")
    ap.add_argument("--depth", type=float, default=0.055, help="relief height as a fraction of pin width (app default 0.055)")
    ap.add_argument("--tile", type=int, default=0, help="force tiles of this size for the detail AI (0 = auto)")
    args = ap.parse_args()

    import torch
    device, dtype = pick_device()
    ensemble, steps = {"fast": (1, 2), "normal": (3, 4), "high": (6, 6)}[args.quality]
    if device == "cpu":
        ensemble, steps = 1, 2
        log("no GPU found — running on CPU (this can take up to an hour)")
    tile = args.tile or (MAX_SIDE if device == "cuda" and torch.cuda.get_device_properties(0).total_memory > 20e9 else 768)

    name = os.path.splitext(os.path.basename(args.art))[0]
    out = os.path.join(args.out, name)
    os.makedirs(out, exist_ok=True)
    t0 = time.time()
    log(f"{args.art} on {device} — quality {args.quality} (ensemble {ensemble}, steps {steps}, tile {tile})")

    src = Image.open(args.art)
    has_alpha = src.mode in ("RGBA", "LA") or (src.mode == "P" and "transparency" in src.info)
    rgba = src.convert("RGBA")
    if max(rgba.size) != MAX_SIDE or rgba.size[0] != rgba.size[1]:
        side = MAX_SIDE
        canvas = Image.new("RGBA", (side, side), (255, 255, 255, 0 if has_alpha else 255))
        rgba.thumbnail((side, side), Image.LANCZOS)
        canvas.paste(rgba, ((side - rgba.size[0]) // 2, (side - rgba.size[1]) // 2), rgba)
        rgba = canvas
    arr = np.asarray(rgba).astype(np.float32) / 255
    rgb = arr[..., :3]
    # the AI models see the art on white
    on_white = rgb * arr[..., 3:4] + (1 - arr[..., 3:4])
    img = Image.fromarray((on_white * 255).astype(np.uint8))

    log("1/5 cutout")
    mask = (arr[..., 3] > 0.5) if has_alpha else cutout(on_white)
    if has_alpha:
        mask = ndimage.binary_erosion(mask, iterations=1)

    log("2/5 depth (Depth Anything V2 Small)")
    depth = estimate_depth(img, device, dtype)

    log("3/5 detail (Marigold Normals)")
    normals = estimate_normals(img, device, dtype, ensemble, steps, tile)

    log("4/5 relief")
    h = build_relief(mask, depth, normals)
    n = normal_map(h, args.depth)

    log("5/5 writing files")
    alpha = (ndimage.gaussian_filter(mask.astype(np.float32), 0.8) * 255).astype(np.uint8)
    Image.fromarray(np.dstack([(on_white * 255).astype(np.uint8), alpha]), "RGBA").save(os.path.join(out, "art.webp"), "WEBP", quality=92, method=6)
    Image.fromarray((h * 255).round().astype(np.uint8)).save(os.path.join(out, "height.png"))
    Image.fromarray((h * 65535).round().astype(np.uint16)).save(os.path.join(out, "height16.png"))
    Image.fromarray(((n * 0.5 + 0.5) * 255).round().astype(np.uint8)).save(os.path.join(out, "normal.png"))
    clay, col = previews(on_white, mask, n)
    clay.save(os.path.join(out, "clay.png"))
    col.save(os.path.join(out, "color.png"))
    log(f"done in {time.time() - t0:.0f}s -> {out}")
    log("upload in the staff portal: art.webp = Pin art, height.png = Depth map, normal.png = Normal map")


if __name__ == "__main__":
    sys.exit(main())
