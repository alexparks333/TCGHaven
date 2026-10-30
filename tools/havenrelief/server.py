#!/usr/bin/env python3
"""HavenRelief server — the staff portal's Relief Studio sends pin art here and gets the relief
kit back (see havenrelief.py for what's in it). Runs on the machine with the GPU:

    python server.py                       # http://127.0.0.1:7861, models load on the first request
    python server.py --warm                # load the models now, so the first pin is quick too

  GET  /health                -> { ok, device, version }
  POST /analyze?quality=high  body: the image file -> { meta, files: { "layers.png": base64, ... } }

Every analysis is kept in cache/ by the image's exact bytes + quality: the same art again is
answered instantly from disk — and it's saved before it's sent, so an analysis whose page was
closed half-way (the browser gives up on the request) still counts next time.

Only this computer can reach it (127.0.0.1). Pages allowed to call it: localhost:3000, plus any
origins in HAVENRELIEF_ORIGINS (comma-separated, e.g. the deployed site). A cloud GPU later runs
this same analysis behind a URL — the Studio only needs the address changed.
"""
import argparse
import base64
import hashlib
import io
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from PIL import Image

import havenrelief as hr

ORIGINS = {"http://localhost:3000", "http://127.0.0.1:3000"} | {
    o.strip().rstrip("/") for o in os.environ.get("HAVENRELIEF_ORIGINS", "").split(",") if o.strip()
}
MAX_UPLOAD = 40 * 1024 * 1024
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cache")
models = None
gpu = threading.Lock()  # one analysis at a time — the models share one GPU


class Handler(BaseHTTPRequestHandler):
    def cors(self):
        origin = self.headers.get("Origin", "")
        if origin in ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            # Chrome's Private Network Access: a page on the internet calling localhost asks first
            self.send_header("Access-Control-Allow-Private-Network", "true")

    def reply(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.end_headers()

    def do_GET(self):
        if urlparse(self.path).path == "/health":
            return self.reply(200, {"ok": True, "device": models.device, "version": hr.KIT_VERSION})
        self.reply(404, {"error": "not found"})

    def do_POST(self):
        url = urlparse(self.path)
        if url.path != "/analyze":
            return self.reply(404, {"error": "not found"})
        if self.headers.get("Origin") and self.headers.get("Origin") not in ORIGINS:
            return self.reply(403, {"error": "origin not allowed"})
        size = int(self.headers.get("Content-Length") or 0)
        if not 0 < size <= MAX_UPLOAD:
            return self.reply(413, {"error": "send the image as the body (max 40MB)"})
        quality = parse_qs(url.query).get("quality", ["normal"])[0]
        if quality not in hr.QUALITY:
            return self.reply(400, {"error": f"quality must be one of {list(hr.QUALITY)}"})
        data = self.rfile.read(size)
        cached = os.path.join(CACHE, f"{hashlib.sha256(data).hexdigest()}-{quality}-v{hr.KIT_VERSION}.json")
        if os.path.exists(cached):
            hr.log("same art as before: answered from the cache")
            with open(cached, encoding="utf-8") as f:
                return self.reply(200, json.load(f))
        try:
            src = Image.open(io.BytesIO(data))
            src.load()
        except Exception:
            return self.reply(400, {"error": "that isn't an image"})
        try:
            with gpu:
                if os.path.exists(cached):  # finished by another request while this one waited
                    with open(cached, encoding="utf-8") as f:
                        return self.reply(200, json.load(f))
                t0 = time.time()
                img, on_white, mask = hr.prepare(src)
                layers, detail, normals, pieces = hr.analyze(models, img, mask, quality)
                images, meta = hr.kit_images(on_white, mask, layers, detail, normals, pieces)
            files = {}
            for name, im in images.items():
                buf = io.BytesIO()
                hr.save_image(im, buf, name)
                files[name] = base64.b64encode(buf.getvalue()).decode()
            hr.log(f"analyzed in {time.time() - t0:.0f}s ({meta['pieces']} pieces)")
            body = {"meta": meta, "files": files}
            os.makedirs(CACHE, exist_ok=True)
            with open(cached + ".tmp", "w", encoding="utf-8") as f:
                json.dump(body, f)
            os.replace(cached + ".tmp", cached)
            self.reply(200, body)
        except Exception as e:  # report it to the Studio rather than dropping the connection
            hr.log(f"analysis failed: {e!r}")
            self.reply(500, {"error": f"analysis failed: {e}"})

    def log_message(self, fmt, *args):
        pass  # hr.log covers what matters


def main():
    global models
    ap = argparse.ArgumentParser(description="HavenRelief server for the staff portal's Relief Studio")
    ap.add_argument("--port", type=int, default=7861)
    ap.add_argument("--warm", action="store_true", help="load the models at start-up")
    args = ap.parse_args()
    models = hr.Models()
    if args.warm:
        hr.log("loading models…")
        img, _, mask = hr.prepare(Image.new("RGB", (64, 64), "white"))
        mask[16:48, 16:48] = True
        hr.analyze(models, img, mask, "fast")
    hr.log(f"ready on http://127.0.0.1:{args.port} ({models.device}); pages allowed: {', '.join(sorted(ORIGINS))}")
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
