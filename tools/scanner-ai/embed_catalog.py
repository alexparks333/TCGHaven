# embed_catalog.py <ckpt.pt | small | base> <outdir> : fingerprint every full/img catalog image (same files/order as full/ids.txt)
import os, sys, glob, time, numpy as np, torch
from PIL import Image
from transformers import AutoModel
V = os.path.expanduser('~/Developer/tcghaven-vision')
src, out = sys.argv[1], sys.argv[2]; os.makedirs(out, exist_ok=True)
if src in ('small', 'base'): kind, state = src, None
else:
    ck = torch.load(src, map_location='cpu', weights_only=False); kind, state = ck['model'], ck['state']
dev = 'mps'
m = AutoModel.from_pretrained(f'facebook/dinov2-{kind}', use_safetensors=True)
if state is not None: print(m.load_state_dict(state, strict=True))
m = m.to(dev).eval()
MEAN = torch.tensor([0.485, 0.456, 0.406]).view(3, 1, 1); STD = torch.tensor([0.229, 0.224, 0.225]).view(3, 1, 1)
files = sorted(glob.glob(f'{V}/full/img/*.jpg'))
ids = [os.path.basename(f)[:-4].replace('__', ':', 1) for f in files]
assert ids == open(f'{V}/full/ids.txt').read().split('\n')
dim = m.config.hidden_size
res = np.zeros((len(files), dim), dtype=np.float16)
from concurrent.futures import ThreadPoolExecutor
def load(f):
    try: im = Image.open(f).convert('RGB').resize((224, 308), Image.BICUBIC)
    except Exception: im = Image.new('RGB', (224, 308))
    return (torch.from_numpy(np.asarray(im).copy()).permute(2, 0, 1).float() / 255 - MEAN) / STD
ex = ThreadPoolExecutor(8); t0 = time.time(); B = 128
nxt = ex.map(load, files[0:B])
with torch.no_grad():
    for i in range(0, len(files), B):
        batch = torch.stack(list(nxt))
        if i + B < len(files): nxt = ex.map(load, files[i + B:i + 2 * B])
        h = m(pixel_values=batch.to(dev)).last_hidden_state[:, 0]
        res[i:i + len(batch)] = torch.nn.functional.normalize(h.float(), dim=1).cpu().numpy().astype(np.float16)
        if (i // B) % 100 == 0: print(i, f'{(i + len(batch)) / (time.time() - t0):.0f}/s', flush=True)
np.save(f'{out}/index.npy', res); print('done', len(ids), f'{time.time() - t0:.0f}s', flush=True)
