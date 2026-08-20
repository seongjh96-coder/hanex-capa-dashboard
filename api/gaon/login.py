import json
import os
import sys
from http.server import BaseHTTPRequestHandler
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from server import gaon_client as gaon  # noqa: E402


class handler(BaseHTTPRequestHandler):
    def _json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        try:
            length = min(int(self.headers.get("Content-Length", "0") or 0), 8192)
            data = json.loads(self.rfile.read(length) or b"{}")
            user_id = str(data.get("id") or "").strip()
            password = str(data.get("pw") or "")
            company = str(data.get("company") or os.environ.get("GAON_COMPANY", "100")).strip()
            if not user_id or not password:
                return self._json({"ok": False, "error": "사번과 비밀번호가 필요합니다."}, 400)
            gaon.Session().login(company, user_id, password)
            self._json({"ok": True, "userId": user_id, "company": company, "stateless": True})
        except json.JSONDecodeError:
            self._json({"ok": False, "error": "올바른 JSON 요청이 아닙니다."}, 400)
        except Exception as error:
            self._json({"ok": False, "error": str(error)}, 401)
