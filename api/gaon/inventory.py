import json
import os
import re
import sys
from datetime import date
from http.server import BaseHTTPRequestHandler
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from server import gaon_client as gaon  # noqa: E402


DATE_RE = re.compile(r"^\d{8}$")
CODE_RE = re.compile(r"^[A-Za-z0-9_-]{1,30}$")


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
            length = min(int(self.headers.get("Content-Length", "0") or 0), 16384)
            data = json.loads(self.rfile.read(length) or b"{}")
            user_id = str(data.get("id") or os.environ.get("GAON_ID", "")).strip()
            password = str(data.get("pw") or os.environ.get("GAON_PW", ""))
            company = str(data.get("company") or os.environ.get("GAON_COMPANY", "100")).strip()
            warehouse = str(data.get("warehouse") or "").strip()
            market = str(data.get("market") or "").strip()
            date_to = str(data.get("date") or date.today().strftime("%Y%m%d")).strip()
            date_from = str(data.get("dateFrom") or date_to).strip()
            if not user_id or not password:
                return self._json({"ok": False, "needLogin": True, "error": "gaon 로그인이 필요합니다."}, 401)
            if not CODE_RE.fullmatch(warehouse):
                return self._json({"ok": False, "error": "올바른 WMS 창고코드를 입력하세요."}, 400)
            if market and not CODE_RE.fullmatch(market):
                return self._json({"ok": False, "error": "올바른 화주코드를 입력하세요."}, 400)
            if not DATE_RE.fullmatch(date_to) or not DATE_RE.fullmatch(date_from):
                return self._json({"ok": False, "error": "기준일자는 YYYYMMDD 형식이어야 합니다."}, 400)
            result = gaon.fetch_inventory(
                warehouse, market, date_from, date_to,
                company=company, user_id=user_id, user_pw=password,
            )
            inventory = result["inventory"]
            summary = result["summary"]
            self._json({
                "ok": True,
                "warehouse": warehouse,
                "market": market,
                "date": date_to,
                "rowCount": result["rowCount"],
                "cellCount": inventory["cellCount"],
                "totalPlt": inventory.get("totalPlt", 0),
                "inventory": inventory,
                "prefixes": summary["prefixes"],
                "byCustomer": summary["byCustomer"],
            })
        except Exception as error:
            message = str(error)
            need_login = "로그인" in message or "자격증명" in message
            self._json({"ok": False, "needLogin": need_login, "error": message}, 401 if need_login else 502)
