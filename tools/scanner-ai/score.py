# score.py <ckpt.pt|small|base> <index dir|full> : real scans + phone-damaged benchmark, ranked among all 169k
import os, sys, json, io, random, numpy as np, torch
from PIL import Image, ImageFilter, ImageEnhance, ImageDraw
from transformers import AutoModel
V = os.path.expanduser('~/Developer/tcghaven-vision'); S = sys.argv[3] if len(sys.argv) > 3 else None
src, ixd = sys.argv[1], sys.argv[2]
if src in ('small', 'base'): kind, state = src, None
else: ck = torch.load(src, map_location='cpu', weights_only=False); kind, state = ck['model'], ck['state']
m = AutoModel.from_pretrained(f'facebook/dinov2-{kind}', use_safetensors=True)
if state is not None: m.load_state_dict(state)
m.eval()
MEAN = torch.tensor([0.485, 0.456, 0.406]).view(3, 1, 1); STD = torch.tensor([0.229, 0.224, 0.225]).view(3, 1, 1)
def emb(ims):
    x = torch.stack([(torch.from_numpy(np.asarray(i.convert('RGB').resize((224, 308), Image.BICUBIC)).copy()).permute(2, 0, 1).float() / 255 - MEAN) / STD for i in ims])
    with torch.no_grad(): return torch.nn.functional.normalize(m(pixel_values=x).last_hidden_state[:, 0], dim=1).numpy()
idx = np.load(f'{V}/full/index.npy' if ixd == 'full' else f'{ixd}/index.npy').astype(np.float32)
ids = open(f'{V}/full/ids.txt').read().split('\n'); pos = {k: i for i, k in enumerate(ids)}
labels = np.load(f'{V}/full/labels.npy'); assert len(labels) == len(ids)
game = np.array([i.split(':')[0] for i in ids])
names = {}
for g in ['pokemon', 'pokemon-jp', 'onepiece', 'riftbound', 'lorcana', 'mtg']:
    for c in json.load(open(f'{V}/catalog/{g}.json')): names[f'{g}:{c["id"]}'] = c['name']
nm = np.array([names.get(i, '') for i in ids])
def rank(s, k, mask=None):
    same = labels == labels[k]
    best = s[same].max(); other = ~same if mask is None else (~same & mask)
    return int((s[other] > best).sum()) + 1, float(best), float(s[other].max()) if other.any() else -1.0
def rep(label, rs):
    r = np.array(rs); return f'{label:44s} n={len(r):3d}  #1 {np.mean(r == 1):4.0%}  top5 {np.mean(r <= 5):4.0%}  top20 {np.mean(r <= 20):4.0%}  top50 {np.mean(r <= 50):4.0%}'
# variants of the index: as is, int8, PCA-256/128 (fit on the index)
variants = {'float16': (idx, lambda q: q)}
if os.environ.get('VARIANTS'):
    q8 = np.clip(np.round(idx * 127 / 0.5), -127, 127).astype(np.int8).astype(np.float32)  # values sit in about ±0.5
    variants['int8'] = (q8, lambda q: q)
    mu = idx.mean(0); _, _, vt = np.linalg.svd(idx[::7] - mu, full_matrices=False)
    for d in (256, 128):
        P = vt[:d].T; red = (idx - mu) @ P; red /= np.linalg.norm(red, axis=1, keepdims=True)
        variants[f'pca{d}'] = (red, lambda q, P=P: ((q - mu) @ P) / np.linalg.norm((q - mu) @ P, axis=1, keepdims=True))
truth = json.load(open(f'{V}/pc/realscans/truth.json'))
qr = emb([Image.open(f'{V}/pc/realscans/{t["file"]}') for t in truth])
src_p = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'pilot.py')).read(); exec(src_p[src_p.index('def phone('):src_p.index('files = sorted')])
bench = json.load(open(f'{S}/real/list.json')) if S else []
bq = [(f"{c['g']}:{c['id']}", Image.open(f"{S}/real/{c['file']}")) for c in bench if f"{c['g']}:{c['id']}" in pos]
bn = emb([phone(im, random.Random(i)) for i, (_, im) in enumerate(bq)]) if bq else None
bh = emb([phone(im, random.Random(i), True) for i, (_, im) in enumerate(bq)]) if bq else None
for vn, (I, f) in variants.items():
    print(f'--- {src.split("/")[-1]}  index {vn}')
    sr = I @ f(qr).T
    all_, sg, sn, gaps, rights = [], [], [], [], []
    for j, t in enumerate(truth):
        k = pos[t['card']]; s = sr[:, j]
        r, b, w = rank(s, k); all_.append(r); rights.append(b); gaps.append(b - w)
        sg.append(rank(s, k, game == game[k])[0]); sn.append(rank(s, k, nm == nm[k])[0])
    print(rep('Real scans: picture alone, all 169k', all_)); print(rep('Real scans: within the right game', sg)); print(rep('Real scans: among cards of the same name', sn))
    print(f'   right-card similarity median {np.median(rights):.3f} p10 {np.percentile(rights, 10):.3f}; lead over best wrong median {np.median(gaps):+.3f}, wrong wins {int((np.array(gaps) < 0).sum())}')
    for lab, Q in (('normal', bn), ('harsh', bh)):
        if Q is None: continue
        sb = I @ f(Q).T; per = {}
        for j, (key, _) in enumerate(bq): per.setdefault(key.split(':')[0], []).append(rank(sb[:, j], pos[key])[0])
        print(rep(f'Benchmark 180, {lab} damage, all', sum(per.values(), [])))
        if lab == 'normal':
            for g, rs in per.items(): print('   ' + rep(g, rs))
