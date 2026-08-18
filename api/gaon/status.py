import json
import os
from http.server import BaseHTTPRequestHandler


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        payload = {
            "ok": True,
            "loggedIn": False,
            "stateless": True,
            "hasEnvCredentials": bool(os.environ.get("GAON_ID") and os.environ.get("GAON_PW")),
            "base": os.environ.get("GAON_BASE", "https://gaon.hanex.co.kr"),
            "service": "Wms.Inventory.P000000430_stock02_S",
        }
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
