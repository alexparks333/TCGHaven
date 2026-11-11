# fingerprint_new.py <model.pt> <todo.json> <out.npz> — the twice-daily index update's AI step
# (scripts/scanner-index.mjs update). todo.json: [{"key": "catalog:id", "url": imageUrl}]. Downloads
# each picture, fingerprints it on the CPU, writes keys + int8 fingerprints. Pictures that fail to
# download are left out (tried again next run).
import io, re, sys, json, os, concurrent.futures as cf, urllib.request, numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from PIL import Image
from common import load_model, upright, tensor, fingerprints, to_int8

def src(u):
    u = re.sub(r'_(\d+w|in_\d+x\d+)\.jpg', '_in_400x400.jpg', u)
    u = u.replace('_hires.png', '.png')
    if 'cmsassets.rgpub.io' in u: u = u.split('?')[0] + '?w=400&fm=jpg&q=85'
    return u

def get(t):
    try:
        req = urllib.request.Request(src(t['url']), headers={'User-Agent': 'TCGHaven-scanner-index/1.0'})
        return t['key'], tensor(upright(Image.open(io.BytesIO(urllib.request.urlopen(req, timeout=30).read()))))
    except Exception as e:
        print('skip', t['key'], type(e).__name__, str(e)[:80], flush=True)
        return t['key'], None

model_path, todo_path, out = sys.argv[1:4]
todo = json.load(open(todo_path))
model = load_model(model_path)
keys, vecs = [], []
with cf.ThreadPoolExecutor(8) as ex:
    for i in range(0, len(todo), 64):
        got = [(k, t) for k, t in ex.map(get, todo[i:i + 64]) if t is not None]
        if got:
            keys += [k for k, _ in got]
            vecs.append(to_int8(fingerprints(model, [t for _, t in got])))
        print(f'{min(i + 64, len(todo))}/{len(todo)}', flush=True)
np.savez(out, keys=np.array(keys), vecs=np.concatenate(vecs) if vecs else np.zeros((0, 384), np.int8))
print('fingerprinted', len(keys), 'of', len(todo))
