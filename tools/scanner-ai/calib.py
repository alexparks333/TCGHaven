import os, json, numpy as np, torch
from PIL import Image
from transformers import AutoModel
V = os.path.expanduser('~/Developer/tcghaven-vision')
ck = torch.load(f'{V}/trained/card-dinov2-small.pass7.pt', map_location='cpu', weights_only=False)
m = AutoModel.from_pretrained('facebook/dinov2-small', use_safetensors=True); m.load_state_dict(ck['state']); m.eval()
MEAN = torch.tensor([0.485, 0.456, 0.406]).view(3, 1, 1); STD = torch.tensor([0.229, 0.224, 0.225]).view(3, 1, 1)
def emb(im):
    x = ((torch.from_numpy(np.asarray(im.convert('RGB').resize((224, 308), Image.BICUBIC)).copy()).permute(2, 0, 1).float() / 255 - MEAN) / STD)[None]
    with torch.no_grad(): return torch.nn.functional.normalize(m(pixel_values=x).last_hidden_state[:, 0], dim=1).numpy()[0]
I = np.load(f'{V}/trained/small-pass7/index.npy').astype(np.float32); ids = open(f'{V}/full/ids.txt').read().split('\n')
labels = np.load(f'{V}/full/labels.npy'); pos = {k: i for i, k in enumerate(ids)}
names = {}
for g in ['pokemon', 'pokemon-jp', 'onepiece', 'riftbound', 'lorcana', 'mtg']:
    for c in json.load(open(f'{V}/catalog/{g}.json')): names[f'{g}:{c["id"]}'] = c['name']
nm = np.array([names.get(i, '') for i in ids])
rows = []
for t in json.load(open(f'{V}/pc/realscans/truth.json')):
    q = emb(Image.open(f'{V}/pc/realscans/{t["file"]}')); s = I @ q; k = pos[t['card']]
    same = labels == labels[k]; r = s[same].max(); o = np.argsort(-np.where(same, -9, s))[0]
    sn = np.where(~same & (nm == nm[k]), s, -9).max()
    rows.append((r, s[o], sn, t['title'], names.get(ids[o]), s.max()))
rows.sort(key=lambda x: x[0] - x[1])
print(' right  bestWrong  lead  sameNameWrong  title -> wrong')
for r, w, sn, t, wn, top in rows: print(f'{r:.3f}  {w:.3f}  {r - w:+.3f}  {sn:.3f}  {t[:28]:28s} -> {str(wn)[:28]}')
