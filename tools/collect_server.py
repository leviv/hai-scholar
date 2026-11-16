#!/usr/bin/env python3
"""Local helper for tools/collect_texts.html: serves the repo and accepts POST /save/<id>
with extracted text JSON, writing it to OUT_DIR. Run from the repo root:
    python3 tools/collect_server.py ~/Desktop/hai-scholar-library/raw 8792
"""
import http.server
import json
import os
import re
import sys

OUT = os.path.expanduser(sys.argv[1] if len(sys.argv) > 1 else "../hai-scholar-library/raw")
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8792
os.makedirs(OUT, exist_ok=True)


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_POST(self):
        m = re.match(r"^/save/([A-Za-z0-9_-]+)$", self.path)
        if not m:
            self.send_response(404)
            self.end_headers()
            return
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        data = json.loads(body)
        with open(os.path.join(OUT, m.group(1) + ".json"), "w") as f:
            json.dump(data, f, ensure_ascii=False)
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"ok")


http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
