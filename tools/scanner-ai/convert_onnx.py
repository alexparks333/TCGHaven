# convert_onnx.py <ckpt.pt> <out.onnx> — the trained model for the Android app (ONNX Runtime):
# input "image" float32 [1, 3, 308, 224] RGB 0–255 (normalised inside), output "fingerprint"
# [1, 384], unit length. Full precision (~87 MB): float16 (onnxconverter) made ONNX Runtime hang on
# load, and dynamic int8 (~23 MB) drifted to 0.973 cosine — too far for decide.ts's thresholds.
# Checked against PyTorch like convert.py.
import os, sys, glob, numpy as np, torch
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from PIL import Image
from common import load_model, W, H
import onnxruntime as ort

V = os.path.expanduser('~/Developer/tcghaven-vision')
src, out = sys.argv[1], sys.argv[2]
m = load_model(src)
m.config._attn_implementation = 'eager'
with torch.no_grad():
    probe = m.embeddings.patch_embeddings(torch.zeros(1, 3, H, W))
    fixed = m.embeddings.interpolate_pos_encoding(torch.zeros(1, probe.shape[1] + 1, probe.shape[2]), H, W).detach().clone()
m.embeddings.interpolate_pos_encoding = lambda embeddings, height, width: fixed

class Fingerprint(torch.nn.Module):
    def __init__(s, m):
        super().__init__(); s.m = m
        s.register_buffer('mean', torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1))
        s.register_buffer('std', torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1))
    def forward(s, x):
        return torch.nn.functional.normalize(s.m(pixel_values=(x / 255 - s.mean) / s.std).last_hidden_state[:, 0], dim=1)

net = Fingerprint(m).eval()
torch.onnx.export(net, (torch.zeros(1, 3, H, W),), out, input_names=['image'], output_names=['fingerprint'], opset_version=17, dynamo=False)
sess = ort.InferenceSession(out, providers=['CPUExecutionProvider'])
files = sorted(glob.glob(V + '/full/img/*.jpg'))[::6000] + sorted(glob.glob(V + '/pc/realscans/*.jpg'))[:10]
sims = []
for f in files:
    a_img = np.asarray(Image.open(f).convert('RGB').resize((W, H), Image.BICUBIC)).astype(np.float32).transpose(2, 0, 1)[None]
    with torch.no_grad(): a = net(torch.from_numpy(a_img)).numpy()[0]
    b = sess.run(['fingerprint'], {'image': a_img})[0][0]
    sims.append(float(a @ (b / np.linalg.norm(b))))
print(f'{out}: {os.path.getsize(out) / 1048576:.1f} MB; agreement with PyTorch min cosine {min(sims):.5f}, mean {np.mean(sims):.5f} over {len(sims)} pictures')
