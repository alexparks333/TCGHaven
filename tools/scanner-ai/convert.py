# convert_trained.py <ckpt.pt> <out.mlpackage> : trained DINOv2-small → Core ML (fp16), checked against PyTorch
import sys, glob, numpy as np, torch, coremltools as ct
from PIL import Image
from transformers import AutoModel
W, H = 224, 308
import os; V = os.path.expanduser('~/Developer/tcghaven-vision')
ck = torch.load(sys.argv[1], map_location='cpu', weights_only=False); assert ck['model'] == 'small'
def load():
    m = AutoModel.from_pretrained('facebook/dinov2-small', use_safetensors=True, attn_implementation='eager'); m.load_state_dict(ck['state']); return m.eval()
base, ref = load(), load()
with torch.no_grad():
    probe = base.embeddings.patch_embeddings(torch.zeros(1, 3, H, W))
    fixed = base.embeddings.interpolate_pos_encoding(torch.zeros(1, probe.shape[1] + 1, probe.shape[2]), H, W).detach().clone()
base.embeddings.interpolate_pos_encoding = lambda embeddings, height, width: fixed
class Fingerprint(torch.nn.Module):
    def __init__(s, m):
        super().__init__(); s.m = m
        s.register_buffer('mean', torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1)); s.register_buffer('std', torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1))
    def forward(s, x):
        return torch.nn.functional.normalize(s.m(pixel_values=(x / 255 - s.mean) / s.std).last_hidden_state[:, 0], dim=1)
net = Fingerprint(base).eval()
traced = torch.jit.trace(net, torch.zeros(1, 3, H, W), strict=False)
ml = ct.convert(traced, inputs=[ct.ImageType(name='image', shape=(1, 3, H, W), color_layout=ct.colorlayout.RGB)],
                outputs=[ct.TensorType(name='fingerprint')], minimum_deployment_target=ct.target.iOS16, compute_precision=ct.precision.FLOAT16)
ml.short_description = 'TCGHaven card fingerprint: DINOv2 ViT-S/14 (Apache-2.0, Meta), trained on TCGHaven catalog cards'
ml.save(sys.argv[2])
files = sorted(glob.glob(V + '/full/img/*.jpg'))[::4000] + sorted(glob.glob(V + '/pc/realscans/*.jpg'))[:10]
sims = []
for f in files:
    im = Image.open(f).convert('RGB').resize((W, H), Image.BICUBIC)
    x = torch.from_numpy(np.asarray(im).copy()).permute(2, 0, 1)[None].float()
    with torch.no_grad(): a = net(x).numpy()[0]
    b = np.array(ml.predict({'image': im})['fingerprint'])[0]
    sims.append(float(a @ (b / np.linalg.norm(b))))
print('agreement with PyTorch, min cosine:', round(min(sims), 5), 'mean', round(float(np.mean(sims)), 5), 'over', len(sims), 'pictures')
