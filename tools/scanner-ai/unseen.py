# unseen.py <ckpt.pt|small|base> <outdir> <catdir> : fingerprint the games added after training (full2/img), then
# phone-damaged shots of 150 random cards per game, ranked within the game and within everything.
# "Right" = the card, or a same-named card with (near) identical art (clean fingerprints >= 0.95 alike).
import os, sys, glob, json, random, time, io, numpy as np, torch
from PIL import Image, ImageFilter, ImageEnhance, ImageDraw
from transformers import AutoModel
from concurrent.futures import ThreadPoolExecutor
V = os.path.expanduser('~/Developer/tcghaven-vision')
src, out, CAT = sys.argv[1], sys.argv[2], sys.argv[3]; os.makedirs(out, exist_ok=True)
if src in ('small', 'base'): kind, state = src, None
else: ck = torch.load(src, map_location='cpu', weights_only=False); kind, state = ck['model'], ck['state']
m = AutoModel.from_pretrained(f'facebook/dinov2-{kind}', use_safetensors=True)
if state is not None: m.load_state_dict(state)
m = m.to('mps').eval()
MEAN = torch.tensor([0.485, 0.456, 0.406]).view(3, 1, 1); STD = torch.tensor([0.229, 0.224, 0.225]).view(3, 1, 1)
T = lambda im: (torch.from_numpy(np.asarray(im.convert('RGB').resize((224, 308), Image.BICUBIC)).copy()).permute(2, 0, 1).float() / 255 - MEAN) / STD
def emb(ts):
    with torch.no_grad(): return torch.nn.functional.normalize(m(pixel_values=torch.stack(ts).to('mps')).last_hidden_state[:, 0].float(), dim=1).cpu().numpy()
files = sorted(glob.glob(f'{V}/full2/img/*.jpg')); ids = [os.path.basename(f)[:-4].replace('__', ':', 1) for f in files]
if os.path.exists(f'{out}/index2.npy') and len(np.load(f'{out}/index2.npy')) == len(files): I2 = np.load(f'{out}/index2.npy').astype(np.float32)
else:
    I2 = np.zeros((len(files), m.config.hidden_size), np.float32); ex = ThreadPoolExecutor(8); t0 = time.time()
    for i in range(0, len(files), 128):
        I2[i:i + 128] = emb(list(ex.map(lambda f: T(Image.open(f)), files[i:i + 128])))
        if (i // 128) % 100 == 0: print(i, f'{(i + 128) / (time.time() - t0):.0f}/s', flush=True)
    np.save(f'{out}/index2.npy', I2.astype(np.float16)); open(f'{out}/ids2.txt', 'w').write('\n'.join(ids))
I1 = np.load(f'{out}/index.npy' if os.path.exists(f'{out}/index.npy') else f'{V}/full/index.npy').astype(np.float32)
names = {}
for g in ['yugioh', 'swu', 'gundam', 'fab', 'digimon', 'palworld', 'cyberpunk']:
    for c in json.load(open(f'{CAT}/{g}.json')): names[f'{g}:{c["id"]}'] = c['name']
game = np.array([i.split(':')[0] for i in ids]); nm = np.array([names.get(i, '') for i in ids])
src_p = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'pilot.py')).read(); exec(src_p[src_p.index('def phone('):src_p.index('files = sorted')])
rng = random.Random(11)
def rep(label, rs):
    r = np.array(rs); return f'{label:34s} n={len(r):3d}  #1 {np.mean(r == 1):4.0%}  top5 {np.mean(r <= 5):4.0%}  top20 {np.mean(r <= 20):4.0%}  top50 {np.mean(r <= 50):4.0%}'
tot = {'normal': [], 'harsh': []}
for g in ['yugioh', 'swu', 'gundam', 'fab', 'digimon', 'palworld', 'cyberpunk']:
    pool = [i for i in range(len(ids)) if game[i] == g]; qs = rng.sample(pool, min(150, len(pool)))
    for harsh in (False, True):
        Q = emb([T(phone(Image.open(files[k]), random.Random(k), harsh)) for k in qs])
        rg, ra = [], []
        for j, k in enumerate(qs):
            s2 = I2 @ Q[j]; s1 = I1 @ Q[j]
            right = (nm == nm[k]) & (I2 @ I2[k] >= 0.95); right[k] = True
            best = s2[right].max()
            rg.append(int((s2[(game == g) & ~right] > best).sum()) + 1)
            ra.append(int((s2[~right] > best).sum()) + int((s1 > best).sum()) + 1)
        lab = 'harsh' if harsh else 'normal'; tot[lab] += ra
        print(rep(f'{g} {lab}: within game', rg)); print(rep(f'{g} {lab}: among all 246k', ra), flush=True)
for lab, r in tot.items(): print(rep(f'ALL new games, {lab}, among all', r))
