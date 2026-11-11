"""HavenRelief in the cloud — the same analysis as server.py, on a pay-per-second GPU at Modal
(docs/creators.md "The 3D maker's GPU"). Nothing runs (or bills) while nobody is making a pin.

    uv tool install modal && modal setup          # once: the Modal CLI + sign in (browser)
    modal secret create havenrelief HAVENRELIEF_SECRET=… HAVENRELIEF_ORIGINS=https://www.tcghaven.org,https://tcghaven.org
    modal deploy modal_app.py                     # from tools/havenrelief → prints the web address

The web address goes in Vercel as HAVENRELIEF_URL, the same secret as HAVENRELIEF_SECRET.

Speaks server.py's API, plus jobs, because Modal ends any web request at 150 s and an analysis
takes ~2½ min (more with a cold start):
  GET  /health                  -> { ok, device: "cloud", version }   (no GPU started)
  POST /analyze?quality=&alpha= -> the kit at once if this art was analysed before (the cache),
       POST /normals?quality=      otherwise 202 { job } — the GPU is started for it
  GET  /job/{job}               -> 202 { pending: true } until done, then the kit / { error }
The Relief Studio (lib/reliefStudio.ts serverFiles) polls a job every few seconds; the PC's
server.py never answers with a job, so the Studio works with both.

Every request needs the site's X-Relief-Ticket (HAVENRELIEF_SECRET must be set here — without it
the endpoint refuses everything, so a forgotten secret can't open the GPU to the world).
"""
import hashlib
import hmac
import io
import json
import os
import time
from pathlib import Path

import modal

GPU = "L40S"          # 48 GB: one pass for the normals (big_gpu), ~2½ min a pin. "L4" is cheaper an hour but ~2× slower
MAX_GPUS = 3          # the most pins analysed at once — the bill's ceiling (more wait in the queue)
IDLE_SECONDS = 60     # a GPU stays warm this long after a pin (billed), so a quick second try skips the cold start

here = Path(__file__).parent
app = modal.App("havenrelief")
store = modal.Volume.from_name("havenrelief-store", create_if_missing=True)  # model weights + finished analyses
STORE = "/store"
secret = modal.Secret.from_name("havenrelief")

gpu_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("torch==2.6.0", "torchvision==0.21.0", index_url="https://download.pytorch.org/whl/cu124")
    .pip_install_from_requirements(str(here / "requirements.txt"))
    .env({"HF_HOME": f"{STORE}/hf", "HF_HUB_DISABLE_PROGRESS_BARS": "1"})
    .add_local_file(str(here / "havenrelief.py"), "/root/havenrelief.py")
)
web_image = modal.Image.debian_slim(python_version="3.11").pip_install("fastapi[standard]==0.115.12")


def cache_path(digest, quality, use_alpha, just_normals, kit_version, rev):
    return f"{STORE}/cache/{digest}-{quality}{'' if use_alpha else '-noalpha'}{'-normals' if just_normals else ''}-v{kit_version}r{rev}.json"


# ── The GPU half ────────────────────────────────────────────────────────────────────────────

@app.cls(image=gpu_image, gpu=GPU, volumes={STORE: store}, timeout=20 * 60,
         max_containers=MAX_GPUS, scaledown_window=IDLE_SECONDS)
class Relief:
    @modal.enter()
    def load(self):
        import havenrelief as hr
        self.hr = hr
        self.models = hr.Models()

    @modal.method()
    def run(self, data: bytes, quality: str, use_alpha: bool, just_normals: bool) -> dict:
        import base64
        from PIL import Image
        hr = self.hr
        cached = cache_path(hashlib.sha256(data).hexdigest(), quality, use_alpha, just_normals, hr.KIT_VERSION, hr.ANALYSIS_REV)
        store.reload()
        if os.path.exists(cached):
            with open(cached, encoding="utf-8") as f:
                return json.load(f)
        try:
            src = Image.open(io.BytesIO(data))
            src.load()
        except Exception:
            return {"error": "that isn't an image"}
        t0 = time.time()
        img, on_white, mask = hr.prepare(src, use_alpha)
        if just_normals:
            images, meta = hr.renormal(self.models, img, mask, quality), {"version": hr.KIT_VERSION, "size": hr.MAX_SIDE}
        else:
            layers, detail, normals, pieces = hr.analyze(self.models, img, mask, quality)
            images, meta = hr.kit_images(on_white, mask, layers, detail, normals, pieces)
        files = {}
        for name, im in images.items():
            buf = io.BytesIO()
            hr.save_image(im, buf, name)
            files[name] = base64.b64encode(buf.getvalue()).decode()
        hr.log(f"{'normals' if just_normals else 'analyzed'} in {time.time() - t0:.0f}s")
        body = {"meta": meta, "files": files}
        os.makedirs(os.path.dirname(cached), exist_ok=True)
        with open(cached + ".tmp", "w", encoding="utf-8") as f:
            json.dump(body, f)
        os.replace(cached + ".tmp", cached)
        store.commit()  # the weights downloaded on a first run are kept too
        return body


# ── The web half (CPU only, cheap; starts the GPU just for real work) ─────────────────────────

@app.function(image=web_image, secrets=[secret], volumes={STORE: store}, max_containers=4, scaledown_window=120)
@modal.concurrent(max_inputs=50)
@modal.asgi_app()
def web():
    from fastapi import FastAPI, Request
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import JSONResponse

    KIT_VERSION, ANALYSIS_REV, QUALITY = 1, 3, ("fast", "normal", "high")  # keep in step with havenrelief.py
    SECRET = os.environ.get("HAVENRELIEF_SECRET", "")
    ORIGINS = [o.strip().rstrip("/") for o in os.environ.get("HAVENRELIEF_ORIGINS", "").split(",") if o.strip()]
    MAX_UPLOAD = 40 * 1024 * 1024

    api = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    api.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_methods=["GET", "POST", "OPTIONS"],
                       allow_headers=["Content-Type", "X-Relief-Ticket"])

    def ticket_ok(ticket):
        if not SECRET:
            return False  # never open: the secret is what keeps the bill to TCG Haven's creators
        try:
            uid, expires, sig = ticket.split(".")
            good = hmac.new(SECRET.encode(), f"{uid}.{expires}".encode(), hashlib.sha256).hexdigest()
            return hmac.compare_digest(good, sig) and int(expires) > time.time()
        except Exception:
            return False

    def refused(request: Request):
        origin = request.headers.get("origin")
        if origin and origin not in ORIGINS:
            return JSONResponse({"error": "origin not allowed"}, 403)
        if not ticket_ok(request.headers.get("x-relief-ticket", "")):
            return JSONResponse({"error": "the 3D maker needs a ticket from TCG Haven — reopen the Creator Studio"}, 401)
        return None

    @api.get("/health")
    async def health():
        return {"ok": True, "device": "cloud", "version": KIT_VERSION}

    async def start(request: Request, just_normals: bool):
        if (no := refused(request)):
            return no
        quality = request.query_params.get("quality", "normal")
        if quality not in QUALITY:
            return JSONResponse({"error": f"quality must be one of {list(QUALITY)}"}, 400)
        use_alpha = request.query_params.get("alpha", "1") != "0"
        data = await request.body()
        if not 0 < len(data) <= MAX_UPLOAD:
            return JSONResponse({"error": "send the image as the body (max 40MB)"}, 413)
        cached = cache_path(hashlib.sha256(data).hexdigest(), quality, use_alpha, just_normals, KIT_VERSION, ANALYSIS_REV)
        try:
            await store.reload.aio()  # see analyses finished by other containers
        except Exception:
            pass
        if os.path.exists(cached):  # the same art as before: free, no GPU
            with open(cached, encoding="utf-8") as f:
                return json.load(f)
        call = await Relief().run.spawn.aio(data, quality, use_alpha, just_normals)
        return JSONResponse({"job": call.object_id}, 202)

    @api.post("/analyze")
    async def analyze(request: Request):
        return await start(request, False)

    @api.post("/normals")
    async def normals(request: Request):
        return await start(request, True)

    @api.get("/job/{job}")
    async def job(job: str, request: Request):
        if (no := refused(request)):
            return no
        try:
            body = await modal.FunctionCall.from_id(job).get.aio(timeout=25)  # waits a little: fewer polls
        except TimeoutError:
            return JSONResponse({"pending": True}, 202)
        except Exception as e:
            return JSONResponse({"error": f"analysis failed: {e}"}, 500)
        return JSONResponse(body, 400 if "error" in body else 200)

    return api
