# Shared by the scanner AI tools: load a fingerprint model, prepare a picture the way the phone does.
# The fingerprint = DINOv2's CLS token, L2-normalised (384 numbers for small). Input 224 × 308 RGB,
# ImageNet mean/std, squashed to that size (never cropped). Docs: docs/scanner-ai.md.
import numpy as np, torch
from PIL import Image
from transformers import AutoModel

W, H = 224, 308
MEAN = torch.tensor([0.485, 0.456, 0.406]).view(3, 1, 1)
STD = torch.tensor([0.229, 0.224, 0.225]).view(3, 1, 1)
# Fingerprints are stored as int8: value × SCALE (they stay within ±0.33, so nothing is clipped in
# practice). Must match lib/scan/picture.ts INT8_SCALE.
SCALE = 384


def load_model(src, device='cpu'):
    """'small' / 'base' (untrained) or a trained .pt from train_cuda.py ({'model', 'state'})"""
    if src in ('small', 'base'):
        kind, state = src, None
    else:
        ck = torch.load(src, map_location='cpu', weights_only=False)
        kind, state = ck['model'], ck['state']
    m = AutoModel.from_pretrained(f'facebook/dinov2-{kind}', use_safetensors=True)
    if state is not None:
        m.load_state_dict(state, strict=True)
    return m.to(device).eval()


def upright(img):
    """Catalog photos of landscape cards (Star Wars: Unlimited leaders and bases, Magic battles…)
    stood upright, turned counter-clockwise. The phone sends every turn of a landscape scan."""
    img = img.convert('RGB')
    return img.rotate(90, expand=True) if img.width > img.height * 1.1 else img


def tensor(img):
    a = np.asarray(img.convert('RGB').resize((W, H), Image.BICUBIC)).copy()
    return (torch.from_numpy(a).permute(2, 0, 1).float() / 255 - MEAN) / STD


def fingerprints(model, tensors, device='cpu'):
    with torch.no_grad():
        h = model(pixel_values=torch.stack(tensors).to(device)).last_hidden_state[:, 0].float()
        return torch.nn.functional.normalize(h, dim=1).cpu().numpy()


def to_int8(f):
    return np.clip(np.round(np.asarray(f, np.float32) * SCALE), -127, 127).astype(np.int8)
