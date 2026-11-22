"""Временный туннель только к Vite 5173, без вывода сырых логов cloudflared."""

import argparse
import hashlib
import json
import os
import queue
import re
import subprocess
import threading
import time
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERSION = "2026.11.1"
SHA256 = "341deda3db5ec498a0482254d6c38c0b7cf01a30c37bb5dd95d2216d08955e35"
BINARY = ROOT / ".tools" / "cloudflared.exe"
STATE = ROOT / ".local" / "quick-tunnel.json"
ORIGIN = re.compile(r"https://[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com\b")


def install() -> None:
    if os.name != "nt":
        raise RuntimeError("Этот локальный installer предназначен для Windows x64")
    BINARY.parent.mkdir(parents=True, exist_ok=True)
    if BINARY.exists() and hashlib.sha256(BINARY.read_bytes()).hexdigest() == SHA256:
        print(f"cloudflared {VERSION}: SHA-256 подтверждён")
        return
    url = (
        "https://github.com/cloudflare/cloudflared/releases/download/"
        f"{VERSION}/cloudflared-windows-amd64.exe"
    )
    temporary = BINARY.with_suffix(".download")
    try:
        request = urllib.request.Request(url, headers={"User-Agent": "poidem-local-setup"})
        with (
            urllib.request.urlopen(request, timeout=60) as response,
            temporary.open("wb") as out,
        ):
            while chunk := response.read(1024 * 1024):
                out.write(chunk)
        if hashlib.sha256(temporary.read_bytes()).hexdigest() != SHA256:
            raise RuntimeError("SHA-256 не совпал; файл не запускается")
        temporary.replace(BINARY)
    finally:
        temporary.unlink(missing_ok=True)
    print(f"cloudflared {VERSION}: установлен локально, SHA-256 подтверждён")


def public_event(line: str) -> tuple[str, str] | None:
    """Только сгенерированный origin и фиксированные статусы, никогда raw URL/headers."""
    # URL нужен только из стартового сообщения, а не из URL ошибочного запроса.
    if "trycloudflare.com" in line and "https://" in line:
        try:
            record = json.loads(line)
        except ValueError:
            record = {}
        message = record.get("message", "")
        if isinstance(message, str) and re.fullmatch(
            r"[ |+\-]*https://[a-z0-9-]+\.trycloudflare\.com[ |+\-]*", message
        ):
            match = ORIGIN.search(message)
            if match:
                return "origin", match.group()
    if "Registered tunnel connection" in line:
        return "connected", "Соединение Cloudflare установлено"
    if "failed to dial" in line.lower() or '"level":"error"' in line:
        return "error", "Ошибка соединения туннеля; подробные запросы не журналируются"
    return None


def run() -> None:
    if not BINARY.is_file() or hashlib.sha256(BINARY.read_bytes()).hexdigest() != SHA256:
        raise RuntimeError("Сначала выполните quick_tunnel.py --install")
    STATE.parent.mkdir(parents=True, exist_ok=True)
    args = [
        str(BINARY),
        "--output",
        "json",
        "tunnel",
        "--no-autoupdate",
        "--loglevel",
        "info",
        "--protocol",
        "http2",
        "--metrics",
        "127.0.0.1:20241",
        "--url",
        "http://127.0.0.1:5173",
    ]
    process = subprocess.Popen(
        args,
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    events: queue.Queue[str] = queue.Queue()

    def read(stream):
        for line in stream:
            events.put(line)
        stream.close()

    for stream in (process.stdout, process.stderr):
        threading.Thread(target=read, args=(stream,), daemon=True).start()
    origin = None
    started = time.monotonic()
    print("Создаётся Quick Tunnel к 127.0.0.1:5173. Остановка: Ctrl+C", flush=True)
    try:
        while process.poll() is None or not events.empty():
            if not origin and time.monotonic() - started > 90:
                raise RuntimeError("Cloudflare не выдал адрес за 90 секунд")
            try:
                event = public_event(events.get(timeout=0.25))
            except queue.Empty:
                continue
            if not event:
                continue
            kind, value = event
            if kind == "origin" and origin is None:
                origin = value
                STATE.write_text(
                    json.dumps(
                        {
                            "origin": origin,
                            "cloudflared_pid": process.pid,
                            "started_at": datetime.now(UTC).isoformat(),
                            "target": "http://127.0.0.1:5173",
                        },
                        indent=2,
                    ),
                    encoding="utf-8",
                )
                print(f"Mini App: {origin}/", flush=True)
                print(
                    "В другом терминале: python scripts/tunnel_config.py --apply",
                    flush=True,
                )
            elif kind == "connected":
                print(value, flush=True)
        raise RuntimeError("Процесс туннеля завершился; запустите его заново")
    except KeyboardInterrupt:
        print("Туннель остановлен")
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        # Сохраняем только статус, а не продолжаем выдавать закрытый адрес за рабочий.
        if origin and STATE.exists():
            record = json.loads(STATE.read_text(encoding="utf-8"))
            if record.get("cloudflared_pid") == process.pid:
                record["stopped_at"] = datetime.now(UTC).isoformat()
                STATE.write_text(json.dumps(record, indent=2), encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--install", action="store_true")
    options = parser.parse_args()
    try:
        install() if options.install else run()
    except Exception as exc:  # noqa: BLE001 - CLI boundary must never echo raw network errors
        # Ни исключения urllib, ни stderr cloudflared не выводим: в них бывают URL.
        print(f"Не удалось подготовить туннель ({type(exc).__name__}). Проверьте сеть/установку.")
        raise SystemExit(1) from None
