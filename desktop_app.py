"""한익스프레스 센터 CAPA 관리 Windows 데스크톱 실행기."""

from __future__ import annotations

import ctypes
import os
import sys
import threading
from pathlib import Path

APP_TITLE = "한익스프레스 센터 CAPA 관리"
APP_PORT = 5181
MUTEX_NAME = "HanexCapaDashboardDesktop"


def _resource_root() -> Path:
    return Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))


def _data_root() -> Path:
    base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
    root = Path(base) / "HanexCapaDashboard"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _message(text: str, title: str = APP_TITLE, error: bool = False) -> None:
    if os.name == "nt":
        ctypes.windll.user32.MessageBoxW(None, text, title, 0x10 if error else 0x40)


def _single_instance():
    if os.name != "nt":
        return None
    handle = ctypes.windll.kernel32.CreateMutexW(None, False, MUTEX_NAME)
    if ctypes.windll.kernel32.GetLastError() == 183:
        _message("프로그램이 이미 실행 중입니다.")
        raise SystemExit(0)
    return handle


def main() -> int:
    mutex = _single_instance()
    root = _resource_root()
    data_root = _data_root()

    if sys.stdout is None:
        sys.stdout = open(os.devnull, "w", encoding="utf-8")
    if sys.stderr is None:
        sys.stderr = open(os.devnull, "w", encoding="utf-8")

    os.environ["HOST"] = "127.0.0.1"
    os.environ["PORT"] = str(APP_PORT)
    os.environ.setdefault("SHARE", "0")
    os.environ.setdefault("OUTLOOK_DESKTOP_SEND", "1")
    os.environ["CAPA_DATA_DIR"] = str(data_root / "server-data")

    os.chdir(root)
    sys.path.insert(0, str(root))

    import webview
    from http.server import ThreadingHTTPServer
    from server.serve import Handler

    try:
        server = ThreadingHTTPServer(("127.0.0.1", APP_PORT), Handler)
    except OSError:
        _message(
            f"전용 포트 {APP_PORT}을 사용할 수 없습니다.\n"
            "실행 중인 CAPA 프로그램을 종료한 뒤 다시 실행하세요.",
            error=True,
        )
        return 1

    thread = threading.Thread(target=server.serve_forever, name="capa-http", daemon=True)
    thread.start()
    icon = root / "desktop" / "hanex_capa.ico"

    try:
        webview.settings["ALLOW_DOWNLOADS"] = True
        webview.settings["OPEN_EXTERNAL_LINKS_IN_BROWSER"] = True
        webview.create_window(
            APP_TITLE,
            f"http://127.0.0.1:{APP_PORT}/",
            width=1440,
            height=900,
            min_size=(1050, 680),
            maximized=True,
            resizable=True,
            confirm_close=True,
            background_color="#eef3f8",
            text_select=True,
        )
        webview.start(
            private_mode=False,
            storage_path=str(data_root / "webview"),
            icon=str(icon) if icon.exists() else None,
            debug=False,
        )
        return 0
    except Exception as error:
        _message(f"프로그램을 시작하지 못했습니다.\n\n{error}", error=True)
        return 1
    finally:
        server.shutdown()
        server.server_close()
        if mutex and os.name == "nt":
            ctypes.windll.kernel32.CloseHandle(mutex)


if __name__ == "__main__":
    raise SystemExit(main())
