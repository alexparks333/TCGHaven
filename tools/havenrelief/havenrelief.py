#!/usr/bin/env python3
"""HavenRelief — the AI half of TCG Haven's pin relief tool.

    python havenrelief.py path/to/art.png            # -> out/<name>/ : the relief kit + a default pin
    python havenrelief.py art.png --quality high     # more AI passes averaged: cleaner detail, slower
    python havenrelief.py art.png --levels 0         # the default pin smooth instead of in 8 levels
    python server.py                                 # the same analysis for the staff portal (see server.py)

The AI runs once per picture and makes no styling choices: it saves a "relief kit" of raw results,
and the staff portal's Relief Studio turns that into a pin with live controls (depth, smooth or
stepped, detail, raising/lowering single pieces) — no AI re-run per tweak. Open models only,
licensed for commercial use:
  1. Cutout      the art's backdrop (white + its soft drop shadow) is removed from the border inward
  2. Pieces      Segment Anything 2.1 Large (Apache-2.0), whole picture + overlapping crops: every
                 letter, gem and figure part; what it leaves is split by colour (scikit-image)
  3. Layers      Marigold Depth v1.1 (Open-RAIL++) at 768 and 1536, combined piece by piece
  4. Detail      Marigold Normals v1.1 (Open-RAIL++): the surface direction of every pixel, also
                 integrated into fine height detail (the heavy maths, done here once)

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
ANALYSIS_REV = 3  # in the server's cache key: bumped when the analysis itself changes (2: Marigold in 768 tiles; 3: SAM 2.1 + Marigold Depth)
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

def prepare(src, use_alpha=True):
    """The art fitted onto a 2048 square: (the art over white as the models see it, its RGB as
    floats, the pin's mask). use_alpha=False ignores the art's transparency: it's laid on white and
    only the backdrop around the pin is cut out, as for any picture on white."""
    rgba = src.convert("RGBA")
    # An alpha channel only counts when it's used: a fully opaque RGBA picture on white is cut out
    # like any other picture on white
    has_alpha = use_alpha and np.asarray(rgba)[..., 3].min() < 128
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
    transparency uses its alpha instead — its holes included: anything transparent inside the pin
    is cut right through it."""
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

    def depth(self, img, quality="normal"):
        """Marigold Depth v1.1 (Open-RAIL++, like the normals) at two sizes: 768, the size it was
        trained at, gets the big layering right (what's in front of what, the plate flat); 1536
        picks up the fine raised parts (numbers, small figures). Returns (coarse, fine) nearness,
        each unscaled (white = near). Replaced Depth Anything V2 Small, which saw every pin tilted
        (the bottom nearer) and barely saw raised lettering."""
        import torch
        from diffusers import MarigoldDepthPipeline
        if self._depth is None:
            self._depth = MarigoldDepthPipeline.from_pretrained(
                "prs-eth/marigold-depth-v1-1", variant="fp16" if self.dtype == torch.float16 else None, dtype=self.dtype
            ).to(self.device)
            self._depth.set_progress_bar_config(disable=True)
        ensemble, steps = QUALITY[quality] if self.device != "cpu" else (1, 2)
        out = []
        for res in (768, 1536 if self.device != "cpu" else 1024):
            p = self._depth(img, num_inference_steps=steps, ensemble_size=ensemble, processing_resolution=res,
                            match_input_resolution=True, batch_size=1).prediction[0]
            p = np.asarray(p, np.float32)
            out.append(1 - (p[..., 0] if p.ndim == 3 else p))  # Marigold: 0 = near → flip to white = near
        return out

    def normals(self, img, quality="normal", tile=0):
        """Marigold normals at the art's native resolution. With room on the GPU it runs the whole
        image in one pass; otherwise overlapping tiles, feather-blended (no seams)."""
        import torch
        from diffusers import MarigoldNormalsPipeline
        if self._normals is None:
            self._normals = MarigoldNormalsPipeline.from_pretrained(
                "prs-eth/marigold-normals-v1-1", variant="fp16" if self.dtype == torch.float16 else None, dtype=self.dtype
            ).to(self.device)
            self._normals.set_progress_bar_config(disable=True)
        pipe = self._normals
        ensemble, steps = QUALITY[quality] if self.device != "cpu" else (1, 2)
        # Marigold sees 768 px at a time, the size it was trained at: run on the whole 2048 picture
        # in one pass it came out nearly flat, and partly back to front (left/right swapped)
        tile = tile or 768
        W, H = img.size

        def run(im, res=None):
            out = pipe(im, num_inference_steps=steps, ensemble_size=ensemble, processing_resolution=res or im.size[0],
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
            # Each tile guesses its own overall tilt, which showed as seams: the broad shape comes
            # from one pass over the whole picture (at 768), the fine detail from the tiles
            whole = run(img, tile)
            s = W / 24
            for c in range(3):
                n[..., c] = ndimage.gaussian_filter(whole[..., c], s) + n[..., c] - ndimage.gaussian_filter(n[..., c], s)
        return n / np.linalg.norm(n, axis=-1, keepdims=True)

    def pieces(self, img, mask):
        """Segment Anything 2.1 Large (Apache-2.0) cuts the art into its parts — each letter, gem,
        star, character and frame ornament. It runs on the whole picture and again on 2×2 and 3×3
        overlapping crops, so small parts get the model's full 1024 px; duplicates are dropped.
        Masks are painted largest first, so smaller parts sit on top of the ones they belong to.
        What no mask covers (often a plain plate or backdrop) is split where the art's colour
        changes — not by depth, which carved plates into diagonal wedges — and every piece ends
        up one connected area, specks merged into a neighbour. Every pixel of the pin gets a piece."""
        masks = self._sam_masks(img, mask)
        seg = np.zeros(mask.shape, np.int32)
        for i, (box, m) in enumerate(sorted(masks, key=lambda t: -t[1].sum()), 1):
            x, y = box
            seg[y:y + m.shape[0], x:x + m.shape[1]][m] = i
        seg[~mask] = 0
        seg = fill_gaps(seg, mask, np.asarray(img, np.float32) / 255)
        return tidy_pieces(seg, mask)

    def _sam_masks(self, img, mask, crops=((1, 48), (2, 32), (3, 24)), overlap=0.25, iou_th=0.78, stab_th=0.88):
        """[(crop origin (x, y), bool mask in that crop)] from SAM 2.1's automatic point grid."""
        import torch
        import torch.nn.functional as F
        from transformers import Sam2Model, Sam2Processor
        if self._sam is None:
            name = "facebook/sam2.1-hiera-large"
            self._sam = (Sam2Processor.from_pretrained(name), Sam2Model.from_pretrained(name, torch_dtype=torch.float32).to(self.device).eval())
        proc, model = self._sam
        W, H = img.size
        found = []  # (origin, crop mask, score)
        t0 = time.time()
        for n, pps in crops:
            cw = W if n == 1 else int(W / (n - (n - 1) * overlap))
            ch = H if n == 1 else int(H / (n - (n - 1) * overlap))
            for y in ([0] if n == 1 else np.linspace(0, H - ch, n).astype(int)):
                for x in ([0] if n == 1 else np.linspace(0, W - cw, n).astype(int)):
                    inside = mask[y:y + ch, x:x + cw]
                    if inside.sum() < 100:
                        continue
                    crop = img.crop((x, y, x + cw, y + ch))
                    g = (np.arange(pps) + 0.5) / pps
                    pts = np.array([(gx * cw, gy * ch) for gy in g for gx in g])
                    pts = pts[inside[pts[:, 1].astype(int).clip(0, ch - 1), pts[:, 0].astype(int).clip(0, cw - 1)]]
                    with torch.no_grad():
                        emb = model.get_image_embeddings(proc(images=crop, return_tensors="pt")["pixel_values"].to(self.device))
                        for i in range(0, len(pts), 64):
                            b = pts[i:i + 64]
                            ip = proc(images=crop, input_points=[[[list(p)] for p in b]], input_labels=[[[1] for _ in b]], return_tensors="pt").to(self.device)
                            o = model(image_embeddings=emb, input_points=ip["input_points"], input_labels=ip["input_labels"], multimask_output=True)
                            lg = o.pred_masks[0].reshape(-1, 1, *o.pred_masks.shape[-2:]).float()
                            up = F.interpolate(lg, size=(ch, cw), mode="bilinear", align_corners=False)[:, 0]
                            stab = (up > 1).flatten(1).sum(1).float() / (up > -1).flatten(1).sum(1).float().clamp(min=1)
                            score = o.iou_scores[0].reshape(-1)
                            for k in torch.nonzero((score > iou_th) & (stab > stab_th))[:, 0].tolist():
                                m = (up[k] > 0).cpu().numpy() & inside
                                if m.sum() <= 32:
                                    continue
                                # a crop's mask running into the crop's edge (not the picture's) is cut off
                                if n > 1 and ((x > 0 and m[:, 0].any()) or (x + cw < W and m[:, -1].any())
                                              or (y > 0 and m[0].any()) or (y + ch < H and m[-1].any())):
                                    continue
                                found.append(((int(x), int(y)), m, float(score[k]) * float(stab[k])))
            log(f"  pieces: crops {n}x{n}, {len(found)} masks ({time.time() - t0:.0f}s)")
        # the backdrop (a mask over most of the pin) isn't a piece
        total = mask.sum()
        found = [f for f in found if f[1].sum() < 0.5 * total]
        return [(o, m) for o, m, _ in dedupe_masks(found, mask.shape, self.device)]


# ── Pieces: masks -> one piece id per pixel ─────────────────────────────────────────────────

def dedupe_masks(found, shape, device="cpu", iou_max=0.8, step=8):
    """Best first, dropping any mask that overlaps an already-kept one by IoU > iou_max (compared
    on an 8× smaller grid, all pairs at once)."""
    import torch
    if not found:
        return []
    found = sorted(found, key=lambda f: -f[2])
    H, W = shape
    small = np.zeros((len(found), (H + step - 1) // step, (W + step - 1) // step), np.float16)
    for i, ((x, y), m, _) in enumerate(found):
        full = np.zeros(shape, bool)
        full[y:y + m.shape[0], x:x + m.shape[1]] = m
        small[i] = full[::step, ::step]
    dev = device if device == "cuda" else "cpu"
    M = torch.from_numpy(small.reshape(len(found), -1)).to(dev, torch.float16 if dev == "cuda" else torch.float32)
    inter = (M @ M.T).float().cpu().numpy()
    area = np.diag(inter)
    iou = inter / np.maximum(area[:, None] + area[None, :] - inter, 1)
    keep = []
    for i in range(len(found)):
        if not keep or iou[i, keep].max() <= iou_max:
            keep.append(i)
    return [found[i] for i in keep]


def fill_gaps(seg, mask, rgb, min_frac=0.0004):
    """Areas no mask covers become pieces of their own, split where the art's colour changes
    (Felzenszwalb's graph segmentation, scikit-image), each connected part its own piece."""
    from skimage.segmentation import felzenszwalb
    gap = mask & (seg == 0)
    if not gap.any():
        return seg
    ys, xs = np.nonzero(gap)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    fz = felzenszwalb(rgb[y0:y1, x0:x1], scale=400, sigma=1.0, min_size=int(mask.sum() * min_frac)) + 1
    region = np.zeros(seg.shape, np.int64)
    region[y0:y1, x0:x1] = fz
    region[~gap] = 0
    lab, n = ndimage.label(region > 0)
    # a connected run of gap can still span two colour regions: split it by region too
    key = lab.astype(np.int64) * (fz.max() + 1) + region
    _, inv = np.unique(key[gap], return_inverse=True)
    out = seg.copy()
    out[gap] = seg.max() + 1 + inv.reshape(-1)
    return out


def tidy_pieces(seg, mask, min_frac=0.0003):
    """Every piece one connected area of a sensible size: fragments (a big mask's leftovers
    between the parts painted over it, slivers along borders) become pieces of their own if
    they're big enough, otherwise join the piece next to them. Numbered 1..n."""
    min_area = mask.sum() * min_frac
    out = np.zeros_like(seg)
    nxt = seg.max()
    for p, sl in enumerate(ndimage.find_objects(seg), 1):
        if sl is None:
            continue
        lab, n = ndimage.label(seg[sl] == p)
        sizes = ndimage.sum(np.ones(lab.shape), lab, np.arange(1, n + 1))
        biggest = int(np.argmax(sizes)) + 1
        view = out[sl]
        for i in range(1, n + 1):
            if sizes[i - 1] < min_area:
                continue
            if i == biggest:
                view[lab == i] = p
            else:
                nxt += 1
                view[lab == i] = nxt
    hole = mask & (out == 0)
    if hole.any():
        _, (iy, ix) = ndimage.distance_transform_edt(out == 0, return_indices=True)
        out = np.where(hole, out[iy, ix], out)
    out[~mask] = 0
    ids = np.unique(out[out > 0])
    remap = np.zeros(out.max() + 1, np.int32)
    remap[ids] = np.arange(1, len(ids) + 1)
    return remap[out]


def fuse_depth(coarse, fine, pieces, mask, weight=0.5):
    """One depth map from Marigold's two passes: the fine pass's shape, with each piece moved
    (by `weight` of the difference) to the height the coarse pass gives it. The coarse pass layers
    the pin better (a plate stays flat); the fine one sees small raised parts better — at full
    weight, small pieces it saw raised (Pikachu on the 151 pin) sank back. 0..1 inside the pin."""
    A = np.c_[fine[mask], np.ones(mask.sum())]
    a, b = np.linalg.lstsq(A, coarse[mask], rcond=None)[0]
    fine = a * fine + b
    P = pieces.max() + 1
    off = np.zeros(P, np.float32)
    off[1:] = ndimage.median(coarse - fine, pieces, np.arange(1, P))
    d = fine + weight * ndimage.gaussian_filter(off[pieces], 1.5)
    lo, hi = np.percentile(d[mask], [0.5, 99.5])
    d = np.clip((d - lo) / max(hi - lo, 1e-6), 0, 1)
    d[~mask] = 0
    return d.astype(np.float32)


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
    log("pieces (Segment Anything 2.1)")
    pieces = models.pieces(img, mask)
    free_gpu()

    log(f"layers (Marigold Depth) [{time.time() - t0:.0f}s]")
    coarse, fine = models.depth(img, quality)
    free_gpu()
    layers = fuse_depth(coarse, fine, pieces, mask)

    log(f"detail (Marigold Normals) [{time.time() - t0:.0f}s]")
    normals = models.normals(img, quality)
    free_gpu()
    detail = fine_detail(normals, mask)
    log(f"AI done [{time.time() - t0:.0f}s] ({pieces.max()} pieces)")
    normals = normals.copy()
    normals[~mask] = (0, 0, 1)
    return layers, detail, normals, pieces


def fine_detail(normals, mask):
    """Fine detail (-1..1): the normals' slopes integrated into height. Integrating predicted normals
    always leaves a broad drift (a false tilt across the pin), so it's removed — the layers give the
    big shape instead."""
    inside = mask.astype(np.float32)
    nz = np.clip(normals[..., 2], 0.3, 1)
    z = integrate(-normals[..., 0] / nz * inside, normals[..., 1] / nz * inside)
    s = MAX_SIDE / 40
    drift = ndimage.gaussian_filter(z * inside, s) / np.maximum(ndimage.gaussian_filter(inside, s), 1e-3)
    detail = z - drift
    detail /= max(np.abs(detail[mask]).max(), 1e-6)
    detail[~mask] = 0
    return detail


def renormal(models, img, mask, quality="high"):
    """Just the normals again, and the fine detail made from them (the Studio's "Recalculate
    Normals"): the kit's normal.png and detail.png, as images — its pieces and layers stay."""
    normals = models.normals(img, quality)
    free_gpu()
    detail = fine_detail(normals, mask)
    normals = normals.copy()
    normals[~mask] = (0, 0, 1)
    return {
        "normal.png": Image.fromarray(((normals * 0.5 + 0.5) * 255).round().astype(np.uint8), "RGB"),
        "detail.png": pack16((detail + 1) / 2),
    }


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

def piece_heights(layers, detail, pieces, mask):
    """Each piece's height for stepping (index = piece id), from the height change across its own
    borders — not its depth over the whole pin, where any tilt in the depth (the bottom of the pin
    looking nearer) pushed whole regions up a level. Along every border, the depth and the fine
    detail just inside each piece are compared; all borders are solved together (least squares),
    with a weak pull toward each piece's median depth. The detail half sees raised lettering the
    depth model misses. The heights are then spread by rank so every level gets used, instead of
    one tall group taking the top level and the rest crowding the bottom one.
    Mirrors pieceHeights() in lib/reliefLevels.ts — keep the two in step."""
    size = pieces.shape[0]
    B = max(2, round(12 * size / 2048))
    P = pieces.max() + 1
    keys, dl, dd = [], [], []
    for dy, dx in ((0, 1), (1, 0)):
        H, W = pieces.shape
        a = pieces[:H - dy, :W - dx]
        b = pieces[dy:, dx:]
        ys, xs = np.nonzero((a != b) & (a > 0) & (b > 0))
        pa, pb = pieces[ys, xs], pieces[ys + dy, xs + dx]
        sides = []
        for v in (layers, detail):
            sa = np.zeros(len(ys)); na = np.zeros(len(ys)); sb = np.zeros(len(ys)); nb = np.zeros(len(ys))
            for t in range(2, B + 1, 2):
                ya, xa = ys - dy * t, xs - dx * t
                ok = (ya >= 0) & (xa >= 0)
                ok[ok] &= pieces[ya[ok], xa[ok]] == pa[ok]
                sa[ok] += v[ya[ok], xa[ok]]; na[ok] += 1
                yb, xb = ys + dy * (t + 1), xs + dx * (t + 1)
                ok = (yb < H) & (xb < W)
                ok[ok] &= pieces[yb[ok], xb[ok]] == pb[ok]
                sb[ok] += v[yb[ok], xb[ok]]; nb[ok] += 1
            good = (na > 0) & (nb > 0)
            sides.append((np.where(good, sa / np.maximum(na, 1) - sb / np.maximum(nb, 1), 0), good))
        good = sides[0][1] & sides[1][1]
        flip = np.where(pa < pb, 1, -1)
        keys.append((np.minimum(pa, pb).astype(np.int64) * P + np.maximum(pa, pb))[good])
        dl.append((sides[0][0] * flip)[good]); dd.append((sides[1][0] * flip)[good])
    keys, dl, dd = np.concatenate(keys), np.concatenate(dl), np.concatenate(dd)
    o = np.argsort(keys, kind="stable")
    keys, dl, dd = keys[o], dl[o], dd[o]
    uk, start, count = np.unique(keys, return_index=True, return_counts=True)
    edges = []
    for k, s, n in zip(uk, start, count):
        if n >= 4:
            edges.append((k // P, k % P, float(np.median(dl[s:s + n])), float(np.median(dd[s:s + n])), int(n)))
    area = ndimage.sum(np.ones(pieces.shape), pieces, np.arange(P))
    med = np.zeros(P)
    ids = np.arange(1, P)[area[1:] > 0]
    med[ids] = ndimage.median(layers, pieces, ids)
    if edges:
        e = np.array(edges)
        den = (e[:, 4] * e[:, 3] ** 2).sum()
        k = (e[:, 4] * e[:, 2] * e[:, 3]).sum() / den if den > 0 else 0
        s = 0.5 * e[:, 2] + 0.5 * k * e[:, 3]
        a, b, n = e[:, 0].astype(int), e[:, 1].astype(int), e[:, 4]
    else:
        a = b = np.zeros(0, int); s = n = np.zeros(0)
    lam = np.where(area > 0, 2 * area / max(area[1:].sum(), 1), 0)
    rhs = lam * med
    np.add.at(rhs, a, n * s)
    np.add.at(rhs, b, -n * s)

    def A(h):
        out = lam * h
        d = n * (h[a] - h[b])
        np.add.at(out, a, d)
        np.add.at(out, b, -d)
        return out

    h = med.copy()  # conjugate gradient, from the medians
    r = rhs - A(h)
    p = r.copy()
    rr = r @ r
    for _ in range(1000):
        if rr < 1e-20:
            break
        Ap = A(p)
        alpha = rr / max(p @ Ap, 1e-30)
        h += alpha * p
        r -= alpha * Ap
        rr2 = r @ r
        p = r + (rr2 / rr) * p
        rr = rr2
    out = np.zeros(P)
    if len(ids):
        hv = h[ids]
        o = np.argsort(hv, kind="stable")
        cw = np.cumsum(area[ids][o]) - area[ids][o] / 2
        pct = np.empty(len(ids))
        pct[o] = cw / max(area[ids].sum(), 1)
        out[ids] = 0.5 * pct + 0.5 * (hv - hv.min()) / max(np.ptp(hv), 1e-9)
    return out


def compose(mask, layers, detail, pieces, levels=8, detail_amount=1.0, flat=0.0, soften=0.06):
    """Height 0..1. Stepped (levels >= 2): every piece at one of N evenly spaced heights (its
    piece_heights() value, snapped to the nearest level from area-weighted 1-D k-means), with the
    sculpted detail riding on top. Smooth (levels < 2): layers + detail. Mirrors compose() in
    lib/reliefStudio.ts at the Studio's default settings — keep the two in step."""
    if levels >= 2:
        hp = piece_heights(layers, detail, pieces, mask)
        ids = np.unique(pieces[pieces > 0])
        med = hp[ids]
        wts = np.array(ndimage.sum(np.ones_like(layers), pieces, ids))
        c = np.quantile(med, (np.arange(levels) + 0.5) / levels)
        for _ in range(50):
            k = np.abs(med[:, None] - c[None, :]).argmin(1)
            c = np.array([np.average(med[k == j], weights=wts[k == j]) if (k == j).any() else c[j] for j in range(levels)])
        rank = np.empty(levels, int)
        rank[np.argsort(c)] = np.arange(levels)
        height = np.zeros(pieces.max() + 1, np.float32)
        height[ids] = rank[np.abs(med[:, None] - c[None, :]).argmin(1)] / (levels - 1)
        sd = detail_amount * 0.3
        h = (1 - sd) * height[pieces] + sd * detail
        # Flatten, then soften only the steps (each piece's average); the detail rides on top
        P = pieces.max() + 1
        cnt = np.maximum(ndimage.sum(np.ones_like(h), pieces, np.arange(P)), 1)
        if flat > 0:
            h = h * (1 - flat) + (ndimage.sum(h, pieces, np.arange(P)) / cnt)[pieces] * flat
        steps = (ndimage.sum(h, pieces, np.arange(P)) / cnt)[pieces]
        h = ndimage.gaussian_filter(steps, max(0.5, soften * 16)) + (h - steps)
    else:
        h = 0.62 * layers + detail_amount * 0.6 * detail
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
    ap.add_argument("--no-alpha", action="store_true", help="ignore the art's transparency: cut out only the white around it")
    ap.add_argument("--quality", choices=list(QUALITY), default="normal",
                    help="fast = 1 AI pass; normal = 3 averaged; high = 6 averaged, more steps")
    ap.add_argument("--levels", type=int, default=8,
                    help="the default pin stepped in N evenly spaced levels (2-8, as the Studio starts: 8); 0 = smooth")
    ap.add_argument("--reuse", action="store_true", help="reuse this art's saved kit instead of re-running the AI")
    args = ap.parse_args()

    name = os.path.splitext(os.path.basename(args.art))[0]
    out = os.path.join(args.out, name)
    os.makedirs(out, exist_ok=True)
    t0 = time.time()
    img, on_white, mask = prepare(Image.open(args.art), not args.no_alpha)
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
