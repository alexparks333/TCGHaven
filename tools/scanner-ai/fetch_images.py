# Images for the games added after training (Yu-Gi-Oh! + the TCGplayer games), shrunk to 224x308. Resumable.
import json, os, re, io, sys, concurrent.futures as cf, urllib.request
from PIL import Image
CAT, OUT = sys.argv[1], sys.argv[2]
def src(u): return re.sub(r'_(\d+w|in_\d+x\d+)\.jpg', '_in_400x400.jpg', u)
todo = []
for g in ['yugioh', 'swu', 'gundam', 'fab', 'digimon', 'palworld', 'cyberpunk']:
    todo += [(g, c['id'], c['imageUrl']) for c in json.load(open(f'{CAT}/{g}.json'))]
print('cards', len(todo), flush=True)
def get(t):
    g, i, u = t
    fn = f"{OUT}/{g}__{i.replace('/', '_')}.jpg"
    if os.path.exists(fn): return 'skip'
    try:
        req = urllib.request.Request(src(u), headers={'User-Agent': 'TCGHaven-scanner-index/1.0'})
        im = Image.open(io.BytesIO(urllib.request.urlopen(req, timeout=30).read())).convert('RGB')
        if im.width > im.height * 1.1: im = im.rotate(90, expand=True)   # landscape cards (leaders, bases) stood upright
        im.resize((224, 308), Image.BICUBIC).save(fn, 'JPEG', quality=90)
        return 'ok'
    except Exception as e:
        with open(f'{OUT}/../errors.log', 'a') as f: f.write(f"{g} {i} {type(e).__name__} {str(e)[:100]}\n")
        return 'fail'
counts = {'ok': 0, 'skip': 0, 'fail': 0}
with cf.ThreadPoolExecutor(8) as ex:
    for n, r in enumerate(ex.map(get, todo)):
        counts[r] += 1
        if n % 5000 == 0: print(n, counts, flush=True)
print('done', counts, flush=True)
