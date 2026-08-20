r"""capa_dash 로컬 서버 + gaon 재고 연동 중계.

실행:
  set GAON_ID=사번
  set GAON_PW=비밀번호
  py server\serve.py            (기본 포트 5180)

- 정적 파일(index.html 등)은 이 서버가 그대로 제공 → 앱과 API가 같은 출처라 CORS 문제 없음
- 재고 API:  GET /api/gaon/inventory?warehouse=0000200&market=2151&date=20260730
- 상태 확인:  GET /api/gaon/status
자격증명은 이 서버 프로세스의 환경변수에만 있고, 브라우저로 나가지 않는다.
"""

import hmac
import hashlib
import http.cookies
import json
import os
import base64
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import threading
import traceback
from datetime import date
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse, parse_qs, unquote, urlencode, quote
from urllib.request import Request, urlopen

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "server"))
import gaon_client as gaon  # noqa: E402
import store  # noqa: E402

PORT = int(os.environ.get("PORT", "5180"))
# 혼자 쓸 때는 localhost만, 동료와 함께 쓸 때는 0.0.0.0 으로 열어 외부 접속을 받는다
HOST = os.environ.get("HOST", "127.0.0.1")
# 공통 암호 — 설정하면 접속 시 1회 입력해야 API를 쓸 수 있다. 비우면 잠금 없음
APP_PASSWORD = os.environ.get("APP_PASSWORD", "")
# 공유 저장소는 기본 꺼짐. 여럿이 같이 쓸 때만 SHARE=1 로 켠다.
# (꺼져 있으면 앱은 지금까지처럼 브라우저 저장만 쓰고, 서버가 화면을 덮어쓰지 않는다)
SHARE_ENABLED = os.environ.get("SHARE", "").strip().lower() not in ("", "0", "false", "no")
COOKIE = "hxsid"
MS_TENANT_ID = os.environ.get("MS_TENANT_ID", "").strip()
MS_CLIENT_ID = os.environ.get("MS_CLIENT_ID", "").strip()
MS_CLIENT_SECRET = os.environ.get("MS_CLIENT_SECRET", "")
MAIL_SENDER = os.environ.get("MAIL_SENDER", "").strip()
OUTLOOK_DESKTOP_SEND = os.environ.get("OUTLOOK_DESKTOP_SEND", "").strip().lower() not in ("0", "false", "no")
FLOORPLAN_DIR = os.path.join(store.DATA_DIR, "floorplans")
HISTORY_PATH = os.path.join(store.DATA_DIR, "capa-history.json")
_history_lock = threading.RLock()

# 로그인 세션은 이 프로세스 메모리에만 둔다 (비밀번호는 저장하지 않는다)
SESSION = gaon.Session()

# 공통 암호 통과한 브라우저 토큰 (프로세스 메모리, 재시작하면 모두 재로그인)
_tokens = set()
_tokens_lock = threading.Lock()


def _issue_token():
    t = secrets.token_urlsafe(24)
    with _tokens_lock:
        _tokens.add(t)
    return t


def _valid_token(t):
    with _tokens_lock:
        return bool(t) and t in _tokens


def _ensure_session():
    """환경변수에 자격증명이 있으면 자동 로그인(없으면 앱에서 로그인)."""
    if SESSION.alive:
        return True
    uid, pw = os.environ.get("GAON_ID"), os.environ.get("GAON_PW")
    if uid and pw:
        SESSION.login(os.environ.get("GAON_COMPANY", "100"), uid, pw)
        return True
    return False


def _save_floorplan_asset(center, floor, data_url):
    match = re.fullmatch(r"data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)", str(data_url or ""))
    if not match:
        raise ValueError("지원하지 않는 도면 이미지 형식입니다")
    raw = base64.b64decode(match.group(2), validate=True)
    if not raw or len(raw) > 12 * 1024 * 1024:
        raise ValueError("도면 이미지는 12MB 이하로 등록해 주세요")
    extension = {"jpeg": "jpg", "png": "png", "webp": "webp"}[match.group(1)]
    digest = hashlib.sha256(f"{center}\0{floor}".encode("utf-8")).hexdigest()[:24]
    filename = f"floorplan-{digest}.{extension}"
    os.makedirs(FLOORPLAN_DIR, exist_ok=True)
    for old_extension in ("jpg", "png", "webp"):
        old_path = os.path.join(FLOORPLAN_DIR, f"floorplan-{digest}.{old_extension}")
        if old_path != os.path.join(FLOORPLAN_DIR, filename):
            try:
                os.unlink(old_path)
            except FileNotFoundError:
                pass
    target = os.path.join(FLOORPLAN_DIR, filename)
    fd, temporary = tempfile.mkstemp(dir=FLOORPLAN_DIR, prefix=".floorplan-", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as output:
            output.write(raw)
        os.replace(temporary, target)
    except Exception:
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise
    version = int(os.path.getmtime(target))
    return filename, len(raw), f"/api/floorplan/file/{filename}?v={version}"


def _load_capa_history():
    with _history_lock:
        try:
            with open(HISTORY_PATH, "r", encoding="utf-8") as source:
                data = json.load(source)
            snapshots = data.get("snapshots") if isinstance(data, dict) else []
            return snapshots if isinstance(snapshots, list) else []
        except FileNotFoundError:
            return []
        except Exception as error:
            print(f"  ! CAPA 누적 이력을 읽지 못했습니다: {error}")
            return []


def _write_capa_history(snapshots):
    os.makedirs(store.DATA_DIR, exist_ok=True)
    fd, temporary = tempfile.mkstemp(dir=store.DATA_DIR, prefix=".capa-history-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as output:
            json.dump({"version": 1, "snapshots": snapshots}, output, ensure_ascii=False, separators=(",", ":"))
        os.replace(temporary, HISTORY_PATH)
    except Exception:
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise


def _save_capa_snapshot(snapshot):
    if not isinstance(snapshot, dict):
        raise ValueError("CAPA 저장 데이터 형식이 올바르지 않습니다")
    business_date = str(snapshot.get("businessDate") or "")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", business_date):
        raise ValueError("CAPA 저장 기준일자가 올바르지 않습니다")
    if not isinstance(snapshot.get("centers"), list) or not isinstance(snapshot.get("totals"), dict):
        raise ValueError("센터별 CAPA 합계가 필요합니다")
    with _history_lock:
        snapshots = _load_capa_history()
        snapshots = [item for item in snapshots if item.get("businessDate") != business_date]
        snapshots.append(snapshot)
        snapshots.sort(key=lambda item: str(item.get("capturedAt") or ""))
        snapshots = snapshots[-2000:]
        _write_capa_history(snapshots)
        return snapshots


def _delete_capa_snapshot(snapshot_id):
    with _history_lock:
        snapshots = [item for item in _load_capa_history() if str(item.get("id")) != snapshot_id]
        _write_capa_history(snapshots)
        return snapshots


def _mail_configured():
    return all((MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MAIL_SENDER))


def _outlook_desktop_available():
    return os.name == "nt" and OUTLOOK_DESKTOP_SEND and HOST in ("127.0.0.1", "localhost")


def _diagnose_outlook_desktop():
    script = r"""
$ErrorActionPreference = 'Stop'
$outlook = New-Object -ComObject Outlook.Application
$mail = $outlook.CreateItem(0)
$version = [string]$outlook.Version
[void][Runtime.InteropServices.Marshal]::ReleaseComObject($mail)
[void][Runtime.InteropServices.Marshal]::ReleaseComObject($outlook)
Write-Output $version
"""
    encoded = base64.b64encode(script.encode("utf-16le")).decode("ascii")
    result = subprocess.run(
        ["powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
        capture_output=True, text=True, timeout=15, check=False,
    )
    if result.returncode:
        detail = (result.stderr or result.stdout or "Outlook 연결 실패").strip()
        raise RuntimeError(detail[-1200:])
    return (result.stdout or "").strip()


def _graph_request(url, data, headers=None):
    req = Request(url, data=data, headers=headers or {}, method="POST")
    try:
        with urlopen(req, timeout=30) as res:
            raw = res.read()
            return res.status, json.loads(raw.decode("utf-8")) if raw else {}
    except HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        try:
            detail = json.loads(raw).get("error", {})
            message = detail.get("message") or raw
        except Exception:
            message = raw
        raise RuntimeError(f"Microsoft Graph HTTP {e.code}: {message}") from e
    except URLError as e:
        raise RuntimeError(f"Microsoft Graph 연결 실패: {e.reason}") from e


def _attachment_document(html):
    return f'<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>센터 CAPA 대시보드</title></head><body style="margin:0;padding:24px;background:#eef3f8">{html}</body></html>'


def _safe_attachment_name(name):
    name = str(name or "센터_CAPA_대시보드.html").strip()
    name = "".join(c for c in name if c not in '\\/:*?"<>|\r\n')[:120]
    return name if name.lower().endswith(".html") else f"{name}.html"


def _extract_inline_images(html):
    images = []
    pattern = re.compile(r'src="data:image/png;base64,([A-Za-z0-9+/=]+)"')

    def replace(match):
        cid = f"capa-chart-{len(images) + 1}@hanex"
        images.append({"cid": cid, "data": base64.b64decode(match.group(1))})
        return f'src="cid:{cid}"'

    return pattern.sub(replace, html), images


def _send_outlook_mail(recipients, subject, html, attachment_name, attachment_html=None):
    if not _mail_configured():
        raise RuntimeError("Outlook 발송 환경변수가 설정되지 않았습니다")
    token_url = f"https://login.microsoftonline.com/{quote(MS_TENANT_ID)}/oauth2/v2.0/token"
    token_body = urlencode({
        "client_id": MS_CLIENT_ID,
        "client_secret": MS_CLIENT_SECRET,
        "scope": "https://graph.microsoft.com/.default",
        "grant_type": "client_credentials",
    }).encode("utf-8")
    _, token_data = _graph_request(token_url, token_body, {"Content-Type": "application/x-www-form-urlencoded"})
    token = token_data.get("access_token")
    if not token:
        raise RuntimeError("Microsoft Graph 액세스 토큰을 받지 못했습니다")
    body_html, inline_images = _extract_inline_images(html)
    attachments = [{
        "@odata.type": "#microsoft.graph.fileAttachment",
        "name": attachment_name,
        "contentType": "text/html; charset=utf-8",
        "contentBytes": base64.b64encode(_attachment_document(attachment_html or html).encode("utf-8")).decode("ascii"),
    }]
    attachments.extend({
        "@odata.type": "#microsoft.graph.fileAttachment",
        "name": f"capa-chart-{index}.png",
        "contentType": "image/png",
        "contentId": image["cid"],
        "isInline": True,
        "contentBytes": base64.b64encode(image["data"]).decode("ascii"),
    } for index, image in enumerate(inline_images, 1))
    payload = {
        "message": {
            "subject": subject,
            "body": {"contentType": "HTML", "content": body_html},
            "toRecipients": [{"emailAddress": {"address": address}} for address in recipients],
            "attachments": attachments,
        },
        "saveToSentItems": True,
    }
    send_url = f"https://graph.microsoft.com/v1.0/users/{quote(MAIL_SENDER)}/sendMail"
    status, _ = _graph_request(send_url, json.dumps(payload, ensure_ascii=False).encode("utf-8"), {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json; charset=utf-8",
    })
    return status


def _send_outlook_desktop(recipients, subject, html, attachment_name, attachment_html=None):
    if not _outlook_desktop_available():
        raise RuntimeError("Outlook 데스크톱 직접 발송을 사용할 수 없습니다")
    payload_path = None
    attachment_path = None
    attachment_dir = None
    try:
        attachment_dir = tempfile.mkdtemp(prefix="capa_mail_")
        attachment_path = os.path.join(attachment_dir, attachment_name)
        with open(attachment_path, "w", encoding="utf-8") as attachment:
            attachment.write(_attachment_document(attachment_html or html))
        body_html, inline_images = _extract_inline_images(html)
        inline_files = []
        for index, image in enumerate(inline_images, 1):
            image_path = os.path.join(attachment_dir, f"capa-chart-{index}.png")
            with open(image_path, "wb") as image_file:
                image_file.write(image["data"])
            inline_files.append({"path": image_path, "cid": image["cid"]})
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".json", delete=False) as f:
            json.dump({"to": recipients, "subject": subject, "html": body_html, "attachmentPath": attachment_path, "inlineImages": inline_files}, f, ensure_ascii=False)
            payload_path = f.name
        safe_path = payload_path.replace("'", "''")
        script = rf"""
$ErrorActionPreference = 'Stop'
$data = Get-Content -Raw -Encoding UTF8 -LiteralPath '{safe_path}' | ConvertFrom-Json
$outlook = New-Object -ComObject Outlook.Application
$mail = $outlook.CreateItem(0)
$mail.To = ($data.to -join ';')
$mail.Subject = [string]$data.subject
$mail.HTMLBody = [string]$data.html
$null = $mail.Attachments.Add([string]$data.attachmentPath)
foreach ($image in $data.inlineImages) {{
  $inline = $mail.Attachments.Add([string]$image.path)
  $inline.PropertyAccessor.SetProperty('http://schemas.microsoft.com/mapi/proptag/0x3712001F', [string]$image.cid)
  $inline.PropertyAccessor.SetProperty('http://schemas.microsoft.com/mapi/proptag/0x7FFE000B', $true)
}}
$mail.Send()
"""
        encoded = base64.b64encode(script.encode("utf-16le")).decode("ascii")
        result = subprocess.run(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
            capture_output=True, text=True, timeout=45, check=False,
        )
        if result.returncode:
            detail = (result.stderr or result.stdout or "Outlook 전송 실패").strip()
            raise RuntimeError(detail[-1000:])
        return 200
    finally:
        if payload_path:
            try:
                os.unlink(payload_path)
            except OSError:
                pass
        if attachment_dir:
            shutil.rmtree(attachment_dir, ignore_errors=True)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, fmt, *args):  # 조용한 로그
        sys.stderr.write("%s - %s\n" % (self.log_date_time_string(), fmt % args))

    def _json(self, obj, status=200, cookie=None):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(body)

    def _body(self, limit=32 * 1024 * 1024):
        n = int(self.headers.get("Content-Length") or 0)
        if n > limit:
            raise ValueError("요청 본문이 너무 큽니다")
        return json.loads(self.rfile.read(n) or b"{}")

    def _authed(self):
        """공통 암호를 안 걸었으면 항상 통과, 걸었으면 쿠키 토큰을 확인한다."""
        if not APP_PASSWORD:
            return True
        raw = self.headers.get("Cookie") or ""
        try:
            jar = http.cookies.SimpleCookie(raw)
        except http.cookies.CookieError:
            return False
        m = jar.get(COOKIE)
        return _valid_token(m.value if m else "")

    def _who(self):
        # 한글 이름은 인코딩되어 오므로 되돌린다
        raw = (self.headers.get("X-Editor") or "").strip()
        try:
            return unquote(raw)[:40]
        except Exception:
            return raw[:40]

    def _guard(self):
        """API 접근 차단. 막았으면 True 를 돌려준다."""
        if self._authed():
            return False
        self._json({"ok": False, "needPassword": True, "error": "접속 암호가 필요합니다."}, 401)
        return True

    def do_GET(self):
        u = urlparse(self.path)
        # ── 접속 암호 ────────────────────────────────────────────────────
        if u.path == "/api/auth/status":
            return self._json({
                "ok": True, "needPassword": bool(APP_PASSWORD),
                "authed": self._authed(), "share": SHARE_ENABLED,
            })
        if u.path == "/api/auth/logout":
            raw = self.headers.get("Cookie") or ""
            try:
                m = http.cookies.SimpleCookie(raw).get(COOKIE)
                if m:
                    with _tokens_lock:
                        _tokens.discard(m.value)
            except http.cookies.CookieError:
                pass
            return self._json({"ok": True}, cookie=f"{COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax")

        if u.path.startswith("/api/floorplan/file/"):
            if self._guard():
                return
            filename = unquote(u.path.rsplit("/", 1)[-1])
            if not re.fullmatch(r"floorplan-[a-f0-9]{24}\.(jpg|png|webp)", filename):
                return self.send_error(404)
            path = os.path.join(FLOORPLAN_DIR, filename)
            try:
                with open(path, "rb") as source:
                    body = source.read()
            except FileNotFoundError:
                return self.send_error(404)
            content_type = "image/jpeg" if filename.endswith(".jpg") else "image/png" if filename.endswith(".png") else "image/webp"
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "private, max-age=86400")
            self.end_headers()
            self.wfile.write(body)
            return

        # ── 공유 저장소 ──────────────────────────────────────────────────
        if u.path.startswith("/api/store") and not SHARE_ENABLED:
            return self._json({"ok": False, "shareOff": True, "error": "공유 저장소가 꺼져 있습니다 (SHARE=1 로 실행)"}, 404)
        if u.path == "/api/store":
            if self._guard():
                return
            return self._json({"ok": True, **store.snapshot()})
        if u.path == "/api/store/revs":
            if self._guard():
                return
            return self._json({"ok": True, "revs": store.revs()})
        if u.path == "/api/store/stats":
            if self._guard():
                return
            return self._json({"ok": True, **store.stats()})

        if u.path.startswith("/api/") and self._guard():
            return
        if u.path == "/api/gaon/status":
            return self._json(
                {
                    "ok": True,
                    "loggedIn": SESSION.alive,
                    "userId": SESSION.user_id if SESSION.alive else "",
                    "hasEnvCredentials": bool(os.environ.get("GAON_ID") and os.environ.get("GAON_PW")),
                    "base": gaon.BASE,
                    "service": "Wms.Inventory.P000000430_stock02_S",
                }
            )
        if u.path == "/api/mail/status":
            mode = "graph" if _mail_configured() else "outlook-desktop" if _outlook_desktop_available() else ""
            return self._json({"ok": True, "configured": bool(mode), "mode": mode, "sender": MAIL_SENDER if mode == "graph" else "현재 Outlook 계정" if mode else ""})
        if u.path == "/api/mail/diagnose":
            try:
                version = _diagnose_outlook_desktop()
                return self._json({"ok": True, "mode": "outlook-desktop", "version": version})
            except Exception as e:
                return self._json({"ok": False, "error": str(e)}, 503)
        if u.path == "/api/history":
            return self._json({"ok": True, "snapshots": _load_capa_history()})
        if u.path == "/api/gaon/logout":
            SESSION.opener = None
            SESSION.user_id = ""
            return self._json({"ok": True})
        if u.path == "/api/gaon/inventory":
            q = parse_qs(u.query)
            wh = (q.get("warehouse") or [""])[0].strip()
            mk = (q.get("market") or [""])[0].strip()
            today = date.today().strftime("%Y%m%d")
            d_to = (q.get("date") or [today])[0].strip()
            d_fr = (q.get("dateFrom") or [d_to])[0].strip()
            if not wh:
                return self._json({"ok": False, "error": "warehouse(센터코드)가 필요합니다."}, 400)
            try:
                if not _ensure_session():
                    return self._json({"ok": False, "needLogin": True, "error": "gaon 로그인이 필요합니다."}, 401)
                res = SESSION.inventory(wh, mk, d_fr, d_to)
                return self._json(
                    {
                        "ok": True,
                        "warehouse": wh,
                        "market": mk,
                        "date": d_to,
                        "rowCount": res["rowCount"],
                        "cellCount": res["inventory"]["cellCount"],
                        "totalPlt": res["inventory"].get("totalPlt", 0),
                        "inventory": res["inventory"],
                        "prefixes": res["summary"]["prefixes"],
                        "byCustomer": res["summary"]["byCustomer"],
                    }
                )
            except Exception as e:
                traceback.print_exc()
                need = "로그인" in str(e)
                return self._json({"ok": False, "needLogin": need, "error": str(e)}, 401 if need else 502)
        return super().do_GET()

    def do_PUT(self):
        u = urlparse(self.path)
        if u.path.startswith("/api/store") and not SHARE_ENABLED:
            return self._json({"ok": False, "shareOff": True, "error": "공유 저장소가 꺼져 있습니다 (SHARE=1 로 실행)"}, 404)
        if u.path == "/api/store":
            if self._guard():
                return
            try:
                body = self._body()
                res = store.apply(body.get("changes") or [], by=self._who() or str(body.get("by") or ""))
                return self._json({"ok": True, **res})
            except Exception as e:
                traceback.print_exc()
                return self._json({"ok": False, "error": str(e)}, 400)
        self.send_error(404)

    def do_POST(self):
        u = urlparse(self.path)
        if u.path == "/api/auth/login":
            try:
                pw = str(self._body(limit=4096).get("pw") or "")
            except Exception:
                pw = ""
            if not APP_PASSWORD:
                return self._json({"ok": True, "needPassword": False})
            if not pw or not hmac.compare_digest(pw, APP_PASSWORD):
                return self._json({"ok": False, "error": "암호가 맞지 않습니다."}, 401)
            tok = _issue_token()
            return self._json({"ok": True}, cookie=f"{COOKIE}={tok}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800")

        if u.path.startswith("/api/") and self._guard():
            return

        if u.path == "/api/floorplan/upload":
            try:
                body = self._body(limit=18 * 1024 * 1024)
                center = str(body.get("center") or "").strip()[:100]
                floor = str(body.get("floor") or "").strip()[:100]
                if not center or not floor:
                    return self._json({"ok": False, "error": "센터와 층을 선택해 주세요."}, 400)
                filename, size, url = _save_floorplan_asset(center, floor, body.get("image"))
                return self._json({"ok": True, "filename": filename, "bytes": size, "url": url})
            except Exception as e:
                return self._json({"ok": False, "error": str(e)}, 400)

        if u.path == "/api/history/save":
            try:
                body = self._body(limit=2 * 1024 * 1024)
                snapshots = _save_capa_snapshot(body.get("snapshot"))
                return self._json({"ok": True, "snapshots": snapshots})
            except Exception as e:
                return self._json({"ok": False, "error": str(e)}, 400)

        if u.path == "/api/history/delete":
            try:
                body = self._body(limit=4096)
                snapshot_id = str(body.get("id") or "").strip()
                if not snapshot_id:
                    return self._json({"ok": False, "error": "삭제할 저장 이력이 필요합니다."}, 400)
                snapshots = _delete_capa_snapshot(snapshot_id)
                return self._json({"ok": True, "snapshots": snapshots})
            except Exception as e:
                return self._json({"ok": False, "error": str(e)}, 400)

        if u.path == "/api/gaon/login":
            try:
                body = self._body(limit=8192)
                uid = str(body.get("id") or "").strip()
                pw = str(body.get("pw") or "")
                company = str(body.get("company") or os.environ.get("GAON_COMPANY", "100")).strip()
                if not uid or not pw:
                    return self._json({"ok": False, "error": "사번과 비밀번호가 필요합니다."}, 400)
                SESSION.login(company, uid, pw)
                # 비밀번호는 어디에도 저장하지 않는다 (세션 쿠키만 메모리에 유지)
                print(f"  gaon 로그인 성공: 사번 {uid} (회사코드 {company})")
                return self._json({"ok": True, "userId": uid})
            except Exception as e:
                # 실패 원인을 콘솔에도 남긴다 (비밀번호는 절대 찍지 않는다)
                print(f"  gaon 로그인 실패: 사번 {uid} / 회사코드 {company} → {e}")
                return self._json({"ok": False, "error": str(e)}, 401)
        if u.path == "/api/mail/send":
            try:
                body = self._body(limit=8 * 1024 * 1024)
                recipients = [str(v).strip() for v in (body.get("to") or []) if str(v).strip()]
                subject = str(body.get("subject") or "").strip()[:200]
                html = str(body.get("html") or "")
                attachment_html = str(body.get("attachmentHtml") or html)
                attachment_name = _safe_attachment_name(body.get("attachmentName"))
                if not recipients or len(recipients) > 100:
                    return self._json({"ok": False, "error": "수신자는 1~100명이어야 합니다."}, 400)
                if any("@" not in address or len(address) > 254 for address in recipients):
                    return self._json({"ok": False, "error": "올바르지 않은 수신 메일 주소가 있습니다."}, 400)
                if not subject or not html:
                    return self._json({"ok": False, "error": "메일 제목과 HTML 본문이 필요합니다."}, 400)
                if _mail_configured():
                    status = _send_outlook_mail(recipients, subject, html, attachment_name, attachment_html)
                    sender = MAIL_SENDER
                    mode = "graph"
                elif _outlook_desktop_available():
                    status = _send_outlook_desktop(recipients, subject, html, attachment_name, attachment_html)
                    sender = "현재 Outlook 계정"
                    mode = "outlook-desktop"
                else:
                    raise RuntimeError("Outlook 발송 환경변수가 설정되지 않았고 데스크톱 Outlook도 사용할 수 없습니다")
                print(f"  Outlook 메일 발송 완료({mode}): {sender} → {len(recipients)}명 / {subject}")
                return self._json({"ok": True, "sent": len(recipients), "sender": sender, "mode": mode, "status": status, "attachment": attachment_name})
            except Exception as e:
                traceback.print_exc()
                return self._json({"ok": False, "error": str(e)}, 503 if not (_mail_configured() or _outlook_desktop_available()) else 502)
        self.send_error(404)


if __name__ == "__main__":
    # 한국어 Windows 콘솔(cp949)은 일부 문자를 못 찍어 print 하나에 서버가 죽는다.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    creds = bool(os.environ.get("GAON_ID") and os.environ.get("GAON_PW"))
    st = store.stats()
    where = "localhost 전용" if HOST in ("127.0.0.1", "localhost") else f"{HOST} (외부 접속 허용)"
    print(f"capa_dash 서버 → http://localhost:{PORT}   [{where}]")
    print(f"  정적 폴더: {ROOT}")
    if SHARE_ENABLED:
        print(f"  공유 저장소: 켜짐 · {st['path']}  (키 {st['keys']}개 · {st['bytes']:,} bytes)")
    else:
        print("  공유 저장소: 꺼짐 (브라우저 저장만 사용. 함께 쓰려면 SHARE=1)")
    print(f"  접속 암호: {'설정됨' if APP_PASSWORD else '없음 (APP_PASSWORD 미설정, 아무나 접속 가능)'}")
    print(f"  gaon 자격증명: {'설정됨' if creds else '없음 (앱에서 직접 로그인)'}")
    mail_mode = f"Graph · {MAIL_SENDER}" if _mail_configured() else "데스크톱 Outlook · 현재 로그인 계정" if _outlook_desktop_available() else "미설정"
    print(f"  Outlook 메일: {mail_mode}")
    if HOST not in ("127.0.0.1", "localhost") and not APP_PASSWORD:
        print("  ! 외부 접속을 열어두고 암호가 없습니다. APP_PASSWORD 를 설정하세요.")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
