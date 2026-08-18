import base64
import hmac
import json
import os
import re
import smtplib
from email.message import EmailMessage
from http.server import BaseHTTPRequestHandler
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen


MAX_BODY = 8 * 1024 * 1024
DATA_IMAGE = re.compile(r'src="data:image/png;base64,([A-Za-z0-9+/=]+)"')


def _safe_attachment_name(name):
    value = str(name or "센터_CAPA_대시보드.html").strip()
    value = "".join(c for c in value if c not in '\\/:*?"<>|\r\n')[:120]
    return value if value.lower().endswith(".html") else f"{value}.html"


def _attachment_document(html):
    return f'<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>센터 CAPA 대시보드</title></head><body style="margin:0;padding:24px;background:#eef3f8">{html}</body></html>'


def _extract_inline_images(html):
    images = []

    def replace(match):
        cid = f"capa-chart-{len(images) + 1}@hanex"
        images.append({"cid": cid, "data": base64.b64decode(match.group(1))})
        return f'src="cid:{cid}"'

    return DATA_IMAGE.sub(replace, html), images


def _graph_request(url, data, headers):
    try:
        with urlopen(Request(url, data=data, headers=headers, method="POST"), timeout=30) as response:
            raw = response.read()
            return response.status, json.loads(raw.decode("utf-8")) if raw else {}
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Microsoft Graph HTTP {error.code}: {detail[-500:]}") from error
    except URLError as error:
        raise RuntimeError(f"Microsoft Graph 연결 실패: {error.reason}") from error


def _send_graph(recipients, subject, html, attachment_html, attachment_name):
    tenant = os.environ["MS_TENANT_ID"].strip()
    client = os.environ["MS_CLIENT_ID"].strip()
    secret = os.environ["MS_CLIENT_SECRET"]
    sender = os.environ["MAIL_SENDER"].strip()
    token_body = urlencode({
        "client_id": client,
        "client_secret": secret,
        "scope": "https://graph.microsoft.com/.default",
        "grant_type": "client_credentials",
    }).encode("utf-8")
    _, token_data = _graph_request(
        f"https://login.microsoftonline.com/{quote(tenant)}/oauth2/v2.0/token",
        token_body,
        {"Content-Type": "application/x-www-form-urlencoded"},
    )
    token = token_data.get("access_token")
    if not token:
        raise RuntimeError("Microsoft Graph 액세스 토큰을 받지 못했습니다.")
    body_html, inline_images = _extract_inline_images(html)
    attachments = [{
        "@odata.type": "#microsoft.graph.fileAttachment",
        "name": attachment_name,
        "contentType": "text/html; charset=utf-8",
        "contentBytes": base64.b64encode(_attachment_document(attachment_html).encode("utf-8")).decode("ascii"),
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
    status, _ = _graph_request(
        f"https://graph.microsoft.com/v1.0/users/{quote(sender)}/sendMail",
        json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        {"Authorization": f"Bearer {token}", "Content-Type": "application/json; charset=utf-8"},
    )
    return status, sender, "graph"


def _send_gmail(recipients, subject, html, attachment_html, attachment_name):
    sender = os.environ["GMAIL_USER"].strip()
    password = os.environ["GMAIL_APP_PASSWORD"].replace(" ", "")
    body_html, inline_images = _extract_inline_images(html)
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = sender
    message["To"] = ", ".join(recipients)
    message.set_content("센터 CAPA 대시보드 HTML 메일입니다.")
    message.add_alternative(body_html, subtype="html")
    html_part = message.get_payload()[-1]
    for index, image in enumerate(inline_images, 1):
        html_part.add_related(
            image["data"], maintype="image", subtype="png",
            cid=f'<{image["cid"]}>', filename=f"capa-chart-{index}.png",
        )
    message.add_attachment(
        _attachment_document(attachment_html).encode("utf-8"),
        maintype="text", subtype="html", filename=attachment_name,
    )
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=30) as smtp:
        smtp.login(sender, password)
        smtp.send_message(message)
    return 200, sender, "gmail"


class handler(BaseHTTPRequestHandler):
    def _json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        try:
            expected_password = os.environ.get("MAIL_SEND_PASSWORD", "")
            supplied_password = self.headers.get("X-Mail-Password", "")
            if not expected_password or not hmac.compare_digest(supplied_password, expected_password):
                return self._json({"ok": False, "error": "메일 발송 비밀번호가 올바르지 않습니다."}, 401)
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_BODY:
                return self._json({"ok": False, "error": "메일 데이터 크기가 허용 범위를 벗어났습니다."}, 413)
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            recipients = [str(value).strip() for value in payload.get("to", []) if str(value).strip()]
            subject = str(payload.get("subject") or "").strip()[:200]
            html = str(payload.get("html") or "")
            attachment_html = str(payload.get("attachmentHtml") or html)
            attachment_name = _safe_attachment_name(payload.get("attachmentName"))
            if not recipients or len(recipients) > 100:
                return self._json({"ok": False, "error": "수신자는 1~100명이어야 합니다."}, 400)
            if any("@" not in address or len(address) > 254 for address in recipients):
                return self._json({"ok": False, "error": "올바르지 않은 수신 메일 주소가 있습니다."}, 400)
            if not subject or not html:
                return self._json({"ok": False, "error": "메일 제목과 HTML 본문이 필요합니다."}, 400)
            graph_ready = all(os.environ.get(key, "").strip() for key in (
                "MS_TENANT_ID", "MS_CLIENT_ID", "MS_CLIENT_SECRET", "MAIL_SENDER"
            ))
            gmail_ready = all(os.environ.get(key, "").strip() for key in (
                "GMAIL_USER", "GMAIL_APP_PASSWORD"
            ))
            if graph_ready:
                status, sender, mode = _send_graph(recipients, subject, html, attachment_html, attachment_name)
            elif gmail_ready:
                status, sender, mode = _send_gmail(recipients, subject, html, attachment_html, attachment_name)
            else:
                return self._json({"ok": False, "error": "Vercel 메일 계정 환경변수가 설정되지 않았습니다."}, 503)
            self._json({
                "ok": True, "sent": len(recipients), "sender": sender,
                "mode": mode, "status": status, "attachment": attachment_name,
            })
        except Exception as error:
            self._json({"ok": False, "error": str(error)[:500]}, 502)
