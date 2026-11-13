# TCGHaven card recognition — training on the RTX 4090 (see README.md). Teach DINOv2 (Apache-2.0) to recognise TCGHaven's catalog cards from phone photos.
# Each step: B distinct pictures, two simulated phone shots of each; the model learns that a card's
# two shots are the same and every other card in the batch is different (supervised contrastive /
# InfoNCE). Cards sharing identical art (full/labels.npy) are one picture.
import os, sys, glob, math, random, time, io, numpy as np, torch, torch.nn.functional as F
from PIL import Image, ImageFilter, ImageEnhance, ImageDraw, ImageOps
from torch.utils.data import Dataset, DataLoader
from transformers import AutoModel

W, H = 224, 308
MEAN = torch.tensor([0.485, 0.456, 0.406]).view(3, 1, 1); STD = torch.tensor([0.229, 0.224, 0.225]).view(3, 1, 1)
files = sorted(glob.glob(os.path.join('data', 'img', '*.jpg')))
labels = np.load(os.path.join('data', 'labels.npy'))
assert len(files) == len(labels)
# one representative file list per picture
by_label = {}
for i, l in enumerate(labels): by_label.setdefault(int(l), []).append(i)
pictures = list(range(int(labels.max()) + 1))

def foil_shine(img, r):
    """Foil lit up by the light (or seen through a hazy sleeve): the art box washes out into a smooth
    pink-white or rainbow sheen that hides its sparkle texture, and the whole card goes milky."""
    w, h = img.size
    a = np.asarray(img, dtype=np.float32).copy()
    x0, y0, x1, y1 = int(w * r.uniform(0.04, 0.1)), int(h * r.uniform(0.08, 0.13)), int(w * r.uniform(0.9, 0.96)), int(h * r.uniform(0.44, 0.5))
    bw, bh = x1 - x0, y1 - y0
    # the art: its fine sparkle smoothed away, then a sweeping band of sheen screened over it
    art = Image.fromarray(a[y0:y1, x0:x1].astype(np.uint8)).filter(ImageFilter.GaussianBlur(r.uniform(0.3, 1.0)))
    region = np.asarray(art, dtype=np.float32)
    ang, period, phase = r.uniform(0, math.pi), r.uniform(0.5, 1.6), r.uniform(0, 1)
    yy, xx = np.mgrid[0:bh, 0:bw].astype(np.float32)
    t = ((xx / bw) * math.cos(ang) + (yy / bh) * math.sin(ang)) / period + phase
    if r.random() < 0.6:   # the pink-white sheen seen on real scans
        base = np.array([r.uniform(230, 255), r.uniform(150, 215), r.uniform(185, 240)], np.float32)
        wash = base[None, None, :] * (0.7 + 0.3 * np.sin(2 * math.pi * t))[..., None]
    else:                  # a rainbow
        wash = np.stack([140 + 115 * np.sin(2 * math.pi * (t + o)) for o in (0, 1 / 3, 2 / 3)], -1)
    strength = np.clip(r.uniform(0.45, 0.9) * (0.65 + 0.35 * np.sin(2 * math.pi * t * r.uniform(0.3, 1.2) + r.uniform(0, 6))), 0, 1)[..., None]
    screened = 255 - (255 - region) * (255 - wash) / 255
    a[y0:y1, x0:x1] = region * (1 - strength) + screened * strength
    # the whole card milky: blacks lifted toward a pale tint, contrast down
    k = r.uniform(0.1, 0.4)
    tint = np.array([r.uniform(225, 255), r.uniform(215, 245), r.uniform(225, 255)], np.float32)
    a = a * (1 - k) + tint * k
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))

def phone_shot(img, r):
    """A catalog image made to look like the scanner's flattened capture of the real card."""
    img = img.convert('RGB')
    # imperfect flattening: a margin of background or a little cut off, a slight skew
    bg = tuple(int(r.uniform(20, 230)) for _ in range(3))
    pad = int(r.uniform(0, 0.08) * W)
    canvas = Image.new('RGB', (W + 2 * pad, H + 2 * pad), bg)
    canvas.paste(img, (pad, pad))
    w2, h2 = canvas.size
    cut = lambda: r.uniform(-0.04, 0.06)
    box = (w2 * max(0, cut()), h2 * max(0, cut()), w2 * (1 - max(0, cut())), h2 * (1 - max(0, cut())))
    img = canvas.crop(box)
    if r.random() < 0.7:
        d = 0.06 * min(img.size)
        q = [(r.uniform(-d, d), r.uniform(-d, d)) for _ in range(4)]
        w, h = img.size
        img = img.transform((w, h), Image.QUAD, (q[0][0], q[0][1], q[1][0], h + q[1][1], w + q[2][0], h + q[2][1], w + q[3][0], q[3][1]), resample=Image.BICUBIC, fillcolor=bg)
    img = img.rotate(r.uniform(-3, 3), resample=Image.BICUBIC, fillcolor=bg).resize((W, H), Image.BICUBIC)
    # light, colour, focus
    img = ImageEnhance.Brightness(img).enhance(r.uniform(0.55, 1.4))
    img = ImageEnhance.Contrast(img).enhance(r.uniform(0.65, 1.3))
    img = ImageEnhance.Color(img).enhance(r.uniform(0.6, 1.35))
    if r.random() < 0.8:
        rr, gg, bb = img.split(); k = r.uniform(0.85, 1.18)
        img = Image.merge('RGB', (rr.point(lambda v: min(255, int(v * k))), gg, bb.point(lambda v: min(255, int(v / k)))))
    if r.random() < 0.7: img = img.filter(ImageFilter.GaussianBlur(r.uniform(0.2, 1.8)))
    # holo foil catching the light (2026-11-13: a real Unown B scan whose dark-red holo art lit up as a
    # milky pink/rainbow sheen fell from #1 to ~#3,000 — the model had never seen foil shine)
    if r.random() < 0.3: img = foil_shine(img, r)
    # glare: one or two soft hotspots, or a sleeve's band of sheen
    for _ in range(r.choice([0, 1, 1, 2])):
        gl = Image.new('L', (W, H), 0); d = ImageDraw.Draw(gl)
        if r.random() < 0.6:
            cx, cy, rad = r.uniform(0, W), r.uniform(0, H), r.uniform(25, 110)
            for s in range(10, 0, -1): d.ellipse((cx - rad * s / 10, cy - rad * s / 10, cx + rad * s / 10, cy + rad * s / 10), fill=int(r.uniform(0.35, 0.85) * 255 * (1 - s / 10) ** 0.8))
        else:
            x = r.uniform(-W, W); wband = r.uniform(15, 60)
            d.polygon([(x, 0), (x + wband, 0), (x + wband + H * 0.5, H), (x + H * 0.5, H)], fill=int(r.uniform(60, 150)))
            gl = gl.filter(ImageFilter.GaussianBlur(8))
        img = Image.composite(Image.new('RGB', (W, H), (255, 255, 255)), img, gl)
    # a thumb or the edge of something over part of the card
    if r.random() < 0.15:
        d = ImageDraw.Draw(img); cx, cy = r.choice([0, W]), r.uniform(0, H)
        d.ellipse((cx - 40, cy - 55, cx + 40, cy + 55), fill=tuple(int(r.uniform(120, 220)) for _ in range(3)))
    # noise + phone JPEG
    if r.random() < 0.5:
        a = np.asarray(img, dtype=np.float32); a += np.random.default_rng(r.randint(0, 1 << 30)).normal(0, r.uniform(2, 7), a.shape)
        img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    buf = io.BytesIO(); img.save(buf, 'JPEG', quality=int(r.uniform(45, 90))); buf.seek(0)
    return Image.open(buf).convert('RGB')

def tensor(img):
    return (torch.from_numpy(np.asarray(img).copy()).permute(2, 0, 1).float() / 255 - MEAN) / STD

neighbors = np.load(os.path.join('data', 'neighbors.npy'))   # picture label → its closest look-alike pictures

class Pairs(Dataset):
    def __len__(self): return len(pictures)
    def __getitem__(self, k):
        r = random.Random()
        members = by_label[k]
        a = Image.open(files[r.choice(members)]); b = Image.open(files[r.choice(members)])
        return tensor(phone_shot(a, r)), tensor(phone_shot(b, r)), k

class LookAlikeBatches(torch.utils.data.Sampler):
    """Batches of look-alikes: a few seed pictures, each with 3 of its closest other pictures — so
    the model has to learn what tells similar cards apart, not just Pokémon from Magic."""
    def __init__(self, n, batch): self.n, self.batch = n, batch
    def __len__(self): return self.n // self.batch
    def __iter__(self):
        order = np.random.permutation(self.n)
        for s in range(0, len(order) - self.batch, self.batch // 4):
            batch, seen = [], set()
            for seed in order[s:s + self.batch // 4]:
                for k in [seed, *np.random.choice(neighbors[seed][:6], 3, replace=False)]:
                    if k not in seen and len(batch) < self.batch: batch.append(int(k)); seen.add(int(k))
            while len(batch) < self.batch:
                k = int(np.random.randint(self.n))
                if k not in seen: batch.append(k); seen.add(k)
            yield batch
            if s // (self.batch // 4) >= self.n // self.batch: return


def score_real(model, dev, size):
    """How often the right card comes first / in the top 5 / top 50 among all 169k catalog cards,
    on real iPhone scans (realscans/) — the number that matters."""
    import json
    truth = json.load(open(os.path.join('realscans', 'truth.json')))
    ids = open(os.path.join('data', 'ids.txt')).read().split('\n')
    model.eval()
    with torch.no_grad(), torch.autocast('cuda', dtype=torch.bfloat16):
        index = []
        for i in range(0, len(files), 512):
            x = torch.stack([tensor(Image.open(f).convert('RGB').resize((W, H))) for f in files[i:i + 512]]).to(dev)
            index.append(F.normalize(model(pixel_values=x).last_hidden_state[:, 0].float(), dim=1))
        index = torch.cat(index)
        ranks = []
        for t in truth:
            q = tensor(Image.open(os.path.join('realscans', t['file'])).convert('RGB').resize((W, H)))[None].to(dev)
            z = F.normalize(model(pixel_values=q).last_hidden_state[:, 0].float(), dim=1)
            s = (index @ z[0])
            # every card sharing the right card's picture counts (labels.npy)
            right = int(ids.index(t['card']))
            same = torch.from_numpy(labels == labels[right]).to(dev)
            best_right = s[same].max()
            ranks.append(int((s[~same] > best_right).sum().item()) + 1)
    model.train()
    r = np.array(ranks)
    return f'real scans: #1 {np.mean(r == 1):.0%}  top5 {np.mean(r <= 5):.0%}  top50 {np.mean(r <= 50):.0%}  (n={len(r)})'

if __name__ == '__main__':
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', default='small', choices=['small', 'base'])
    ap.add_argument('--epochs', type=int, default=12)
    ap.add_argument('--batch', type=int, default=256)
    ap.add_argument('--workers', type=int, default=min(32, os.cpu_count() or 8))
    ap.add_argument('--lr', type=float, default=4e-5)
    ap.add_argument('--train-blocks', type=int, default=8, help='how many of the last transformer blocks learn')
    # Added on the PC (2026-11-09): stop after any pass and carry on later. The maths is unchanged.
    ap.add_argument('--resume', action='store_true', help='carry on from out/resume-<model>.pt (or, with --start-pass, from out/card-dinov2-<model>.pt)')
    ap.add_argument('--start-pass', type=int, default=None, help='with --resume and no resume checkpoint: the pass to start at (the saved model has finished the passes before it)')
    ap.add_argument('--stop-after', type=int, default=None, help='stop after this pass (for a session with limited time)')
    ap.add_argument('--grad-checkpoint', action='store_true', help='recompute activations in the backward pass: same results, much less GPU memory (use when other apps hold VRAM)')
    ap.add_argument('--prefetch', type=int, default=4, help='batches each worker keeps ready (memory only; 2 keeps 32 workers inside Windows memory limits)')
    a = ap.parse_args()
    dev = 'cuda'
    torch.backends.cuda.matmul.allow_tf32 = True
    name = f'facebook/dinov2-{a.model}'
    model = AutoModel.from_pretrained(name, use_safetensors=True).to(dev)
    if a.grad_checkpoint: model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={'use_reentrant': False})
    for p in model.parameters(): p.requires_grad = False
    for blk in model.encoder.layer[-a.train_blocks:]:
        for p in blk.parameters(): p.requires_grad = True
    for p in model.layernorm.parameters(): p.requires_grad = True
    params = [p for p in model.parameters() if p.requires_grad]
    opt = torch.optim.AdamW(params, lr=a.lr, weight_decay=0.05)
    B = a.batch
    per_epoch = len(pictures) // B
    steps = per_epoch * a.epochs
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=a.lr, total_steps=steps, pct_start=0.03)
    loader = DataLoader(Pairs(), batch_sampler=LookAlikeBatches(len(pictures), B), num_workers=a.workers,
                        persistent_workers=True, prefetch_factor=a.prefetch, pin_memory=True)
    os.makedirs('out', exist_ok=True)
    resume_path = os.path.join('out', f'resume-{a.model}.pt')
    first = 1
    if a.resume:
        if os.path.exists(resume_path) and a.start_pass is None:
            ck = torch.load(resume_path, map_location='cpu', weights_only=False)
            if (ck['epochs'], ck['batch'], ck['lr']) != (a.epochs, B, a.lr):
                sys.exit(f"resume checkpoint was made with --epochs {ck['epochs']} --batch {ck['batch']} --lr {ck['lr']}; use the same")
            model.load_state_dict(ck['state']); opt.load_state_dict(ck['opt']); sched.load_state_dict(ck['sched'])
            first = ck['epoch'] + 1
            print(f'resuming after pass {ck["epoch"]} (full checkpoint)', flush=True)
        else:
            if a.start_pass is None: sys.exit('no out/resume checkpoint — pass --start-pass N (the saved model has finished passes 1..N-1)')
            saved = torch.load(os.path.join('out', f'card-dinov2-{a.model}.pt'), map_location='cpu', weights_only=False)
            model.load_state_dict(saved['state'])
            first = a.start_pass
            import warnings
            with warnings.catch_warnings():
                warnings.simplefilter('ignore')
                for _ in range((first - 1) * per_epoch): sched.step()   # same learning-rate schedule as one unbroken run
            print(f'resuming at pass {first} from the saved model (optimizer averages start fresh this once)', flush=True)
    print(f'{name}: {len(pictures)} pictures, {a.epochs} passes × {per_epoch} steps, batch {B}, {a.workers} workers', flush=True)
    if first == 1: print('before training —', score_real(model, dev, a.model), flush=True)
    temp, step, t0 = 0.05, (first - 1) * per_epoch, time.time()
    step0 = step
    model.train()
    for epoch in range(first, a.epochs + 1):
        for xa, xb, _ in loader:
            # join on the GPU (PC change 2026-11-10): same tensor, but no 0.8 GB unpinned CPU copy per step
            x = torch.cat([xa.to(dev, non_blocking=True), xb.to(dev, non_blocking=True)])
            with torch.autocast('cuda', dtype=torch.bfloat16):
                z = model(pixel_values=x).last_hidden_state[:, 0]
            z = F.normalize(z.float(), dim=1)
            za, zb = z[:B], z[B:]
            logits = za @ zb.T / temp
            target = torch.arange(B, device=dev)
            loss = (F.cross_entropy(logits, target) + F.cross_entropy(logits.T, target)) / 2
            opt.zero_grad(set_to_none=True); loss.backward(); opt.step(); sched.step(); step += 1
            if step % 50 == 0:
                acc = (logits.argmax(1) == target).float().mean().item()
                left = (time.time() - t0) / (step - step0) * (steps - step) / 60
                print(f'pass {epoch}/{a.epochs} step {step}/{steps} loss {loss.item():.3f} look-alike acc {acc:.2f} ~{left:.0f} min left', flush=True)
            if step >= epoch * per_epoch: break
        path = os.path.join('out', f'card-dinov2-{a.model}.pt')
        torch.save({'model': a.model, 'state': {k: v.cpu() for k, v in model.state_dict().items()}}, path)
        import shutil; shutil.copyfile(path, path.replace('.pt', f'.pass{epoch}.pt'))   # keep every pass (same format)
        torch.save({'epoch': epoch, 'epochs': a.epochs, 'batch': B, 'lr': a.lr, 'state': model.state_dict(),
                    'opt': opt.state_dict(), 'sched': sched.state_dict()}, resume_path + '.tmp')
        os.replace(resume_path + '.tmp', resume_path)
        print(f'— after pass {epoch}: {score_real(model, dev, a.model)} — saved {path}', flush=True)
        if a.stop_after and epoch >= a.stop_after:
            print(f'stopped after pass {epoch} — carry on with: --resume', flush=True); os._exit(0)
    print('done', f'{(time.time() - t0) / 60:.0f} min', flush=True)
