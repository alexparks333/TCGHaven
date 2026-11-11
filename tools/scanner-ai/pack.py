# pack.py <out dir> <index.npy> <ids.txt> [<index.npy> <ids.txt> …] — a full fingerprint index (from
# embed_catalog.py) split into the per-catalog files the server reads: index-{catalog}.bin (int8,
# n × 384, row-major) + index-{catalog}.json (the card ids, in row order). Upload with
# `npm run scanner-index -- publish <out dir>`.
import os, sys, json, numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import to_int8
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
by = {}
for ix, idf in zip(sys.argv[2::2], sys.argv[3::2]):
    vecs = to_int8(np.load(ix).astype(np.float32)); ids = open(idf).read().split('\n')
    assert len(ids) == len(vecs), (ix, len(ids), len(vecs))
    for k, v in zip(ids, vecs):
        cat, cid = k.split(':', 1)
        by.setdefault(cat, {})[cid] = v      # a later file wins (a newer fingerprint of the same card)
for cat, rows in sorted(by.items()):
    ids = list(rows)
    np.stack([rows[i] for i in ids]).astype(np.int8).tofile(f'{out}/index-{cat}.bin')
    json.dump(ids, open(f'{out}/index-{cat}.json', 'w'))
    print(cat, len(ids))
