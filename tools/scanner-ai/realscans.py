# realscans.py <model.pt> <model-version> <truth.json> <phone-scans-dir> <out.json>
#
# Builds the real-scan check's test file (scripts/scanner-realscans.json, run on every deploy by
# scripts/scanner-realscans.mts — docs/card-scanner.md "The real-scan check"). For each real phone
# scan in truth.json ([{file, card, title}], the photos beside it): the text the phone read (the
# debug scan's ocr.json "merged" lines, from <phone-scans-dir>/<scan id>/) and the picture AI's
# fingerprint of the photo, made with <model.pt> — the model the published index was made with
# (<model-version>, e.g. small-p7-20261110). No photos go in the file.
#
# Run again after publishing a retrained model (the check falls back to text only, and says so,
# while the file's model differs from the published one), and after adding scans to truth.json.
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from PIL import Image
from common import load_model, upright, tensor, fingerprints

model_path, version, truth_path, scans_dir, out = sys.argv[1:6]
truth = json.load(open(truth_path))
photos = os.path.dirname(os.path.abspath(truth_path))
model = load_model(model_path)
scans = []
for t in truth:
    sid = t['file'].rsplit('.', 1)[0]
    ocr = os.path.join(scans_dir, sid, 'ocr.json')
    if not os.path.exists(ocr):
        print('no text for', sid, '— skipped'); continue
    lines = [{k: (round(l[k], 4) if isinstance(l[k], float) else l[k]) for k in ('text', 'x', 'y', 'w', 'h') if k in l}
             for l in json.load(open(ocr)).get('merged', [])]
    fp = fingerprints(model, [tensor(upright(Image.open(os.path.join(photos, t['file']))))])[0]
    scans.append({'id': sid, 'card': t['card'], 'title': t['title'], 'lines': lines,
                  'fingerprint': [round(float(v), 4) for v in fp]})
json.dump({'model': version, 'scans': scans}, open(out, 'w'), separators=(',', ':'))
print('wrote', len(scans), 'scans to', out)
