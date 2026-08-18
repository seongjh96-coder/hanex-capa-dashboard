import json
import os
from http.server import BaseHTTPRequestHandler


def _provider():
    graph = all(os.environ.get(key, "").strip() for key in (
        "MS_TENANT_ID", "MS_CLIENT_ID", "MS_CLIENT_SECRET", "MAIL_SENDER"
    ))
    gmail = all(os.environ.get(key, "").strip() for key in (
        "GMAIL_USER", "GMAIL_APP_PASSWORD"
    ))
    if graph:
        return "graph", os.environ.get("MAIL_SENDER", "").strip()
    if gmail:
        return "gmail", os.environ.get("GMAIL_USER", "").strip()
    return "", ""


class handler(BaseHTTPRequestHandler):
    def _json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        mode, sender = _provider()
        password_ready = bool(os.environ.get("MAIL_SEND_PASSWORD", ""))
        self._json({
            "ok": True,
            "configured": bool(mode and password_ready),
            "mode": mode or "unconfigured",
            "sender": sender,
            "requiresPassword": True,
            "missing": [] if mode and password_ready else [
                "메일 계정 환경변수" if not mode else "MAIL_SEND_PASSWORD"
            ],
        })
