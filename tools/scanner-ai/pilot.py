# Picture-index pilot: can a pretrained DINOv2 (Apache-2.0) find the exact card from a phone scan
# among thousands of look-alikes? Index = catalog images; queries = simulated phone scans + real ones.
import os, sys, glob, random, io, json, math
import numpy as np, torch
from PIL import Image, ImageFilter, ImageEnhance, ImageDraw
torch.set_grad_enabled(False)
dev = 'mps' if torch.backends.mps.is_available() else 'cpu'
from transformers import AutoModel
# DINOv2 ViT-S/14 (Apache-2.0) — weights only, as safetensors, through the transformers library
model = AutoModel.from_pretrained('facebook/dinov2-small', use_safetensors=True).to(dev).eval()
W, H = 224, 308   # card shape, multiples of the 14-px patch
MEAN = torch.tensor([0.485, 0.456, 0.406]).view(3, 1, 1); STD = torch.tensor([0.229, 0.224, 0.225]).view(3, 1, 1)

def prep(img):
    img = img.convert('RGB').resize((W, H), Image.BICUBIC)
    t = torch.from_numpy(np.asarray(img).copy()).permute(2, 0, 1).float() / 255
    return (t - MEAN) / STD

def embed(imgs, mode):
    out = []
    for i in range(0, len(imgs), 64):
        x = torch.stack([prep(im) for im in imgs[i:i + 64]]).to(dev)
        h = model(pixel_values=x).last_hidden_state   # layer-normed tokens: [CLS, patches…]
        cls, pt = h[:, 0], h[:, 1:]
        gem = pt.clamp(min=1e-6).pow(3).mean(1).pow(1 / 3)
        v = {'cls': cls, 'mean': pt.mean(1), 'cls+gem': torch.cat([cls, gem], 1)}[mode]
        out.append(torch.nn.functional.normalize(v, dim=1).cpu())
    return torch.cat(out)

def phone(img, rnd, harsh=False):
    img = img.convert('RGB'); w, h = img.size
    # imperfect flattening: edges a few % off, a slight turn
    c = [rnd.uniform(-0.03, 0.04) * w for _ in range(4)]
    img = img.crop((c[0], c[1] * h / w, w - c[2], h - c[3] * h / w)).rotate(rnd.uniform(-2, 2), resample=Image.BICUBIC, expand=False, fillcolor=(40, 40, 40))
    img = img.resize((700, 980))
    img = img.filter(ImageFilter.GaussianBlur(rnd.uniform(0.3, 2.5 if harsh else 1.4)))
    img = ImageEnhance.Brightness(img).enhance(rnd.uniform(0.6, 1.35)); img = ImageEnhance.Contrast(img).enhance(rnd.uniform(0.7, 1.2))
    r, g, b = img.split(); k = rnd.uniform(0.85, 1.15)
    img = Image.merge('RGB', (r.point(lambda v: min(255, v * k)), g, b.point(lambda v: min(255, v / k))))
    # glare
    gl = Image.new('L', img.size, 0); d = ImageDraw.Draw(gl)
    cx, cy, rad = rnd.uniform(0.2, 0.8) * 700, rnd.uniform(0.2, 0.8) * 980, rnd.uniform(80, 260 if harsh else 160)
    for s in range(12, 0, -1): d.ellipse((cx - rad * s / 12, cy - rad * s / 12, cx + rad * s / 12, cy + rad * s / 12), fill=int((0.85 if harsh else 0.55) * 255 * (1 - s / 12) ** 0.7))
    img = Image.composite(Image.new('RGB', img.size, (255, 255, 255)), img, gl)
    buf = io.BytesIO(); img.save(buf, 'JPEG', quality=60); return Image.open(buf)

files = sorted(glob.glob('pilot/img/*.jpg'))
names = [os.path.basename(f)[:-4] for f in files]
images = [Image.open(f) for f in files]
print('index', len(files), 'cards on', dev)
rnd = random.Random(7)
qi = rnd.sample(range(len(files)), 400)
real = [('phone Mew VMAX (swsh11tg-TG30)', 'pokemon__swsh11tg-TG30', Image.open(p)) for p in glob.glob(sys.argv[1] + '/scans/*/card.jpg')] if len(sys.argv) > 1 else []
for mode in ['cls', 'mean', 'cls+gem']:
    idx = embed(images, mode)
    for harsh in [False, True]:
        q = embed([phone(images[i], random.Random(i), harsh) for i in qi], mode)
        sims = q @ idx.T
        top = sims.topk(10, dim=1).indices
        t1 = sum(int(top[j, 0]) == qi[j] for j in range(len(qi))); t5 = sum(qi[j] in top[j, :5].tolist() for j in range(len(qi))); t10 = sum(qi[j] in top[j].tolist() for j in range(len(qi)))
        print(f'{mode:8s} {"harsh " if harsh else "normal"}  top1 {t1/len(qi):.1%}  top5 {t5/len(qi):.1%}  top10 {t10/len(qi):.1%}')
    for label, truth, im in real:
        s = embed([im], mode) @ idx.T
        order = s[0].argsort(descending=True).tolist()
        rank = next((r for r, i in enumerate(order) if names[i] == truth), None)
        print(f'   {label}: right card ranked #{rank + 1 if rank is not None else "missing"}; top3 {[names[i] for i in order[:3]]}')
