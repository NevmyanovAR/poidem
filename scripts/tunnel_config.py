"""Обратимая настройка публичных параметров .env для одного Quick Tunnel origin."""

import argparse
import json
import re
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
ENV = ROOT / ".env"
STATE = ROOT / ".local" / "quick-tunnel.json"
BACKUP = ROOT / ".local" / "tunnel-settings-before.json"
KEYS = (
    "APP_ENV",
    "CORS_ORIGINS",
    "TRUSTED_HOSTS",
    "MINI_APP_URL",
    "API_PUBLIC_URL",
    "SESSION_COOKIE_SECURE",
    "SESSION_COOKIE_SAMESITE",
    "VITE_API_BASE_URL",
    "POIDEM_API_PROXY_TARGET",
    "POIDEM_DEV_ALLOWED_HOSTS",
)


def canonical_origin(value: str) -> str:
    parsed = urlsplit(value)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com", parsed.hostname)
        or parsed.netloc != parsed.hostname
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("Нужен точный HTTPS origin Quick Tunnel без пути/параметров")
    return f"https://{parsed.hostname}"


def settings_for(origin: str) -> dict[str, str]:
    origin = canonical_origin(origin)
    return {
        "APP_ENV": "development",
        "CORS_ORIGINS": json.dumps([origin]),
        # Vite changeOrigin передаёт backend локальный Host, публичный тут не нужен.
        "TRUSTED_HOSTS": '["127.0.0.1","localhost"]',
        "MINI_APP_URL": f"{origin}/",
        "API_PUBLIC_URL": f"{origin}/api/v1",
        "SESSION_COOKIE_SECURE": "true",
        "SESSION_COOKIE_SAMESITE": "lax",
        "VITE_API_BASE_URL": "/api/v1",
        "POIDEM_API_PROXY_TARGET": "http://127.0.0.1:8001",
        "POIDEM_DEV_ALLOWED_HOSTS": json.dumps([urlsplit(origin).hostname]),
    }


def replace_public_values(content: str, values: dict[str, str | None]) -> str:
    if set(values) - set(KEYS):
        raise ValueError("Изменение секретных/неразрешённых переменных запрещено")
    lines = []
    remaining = dict(values)
    for line in content.splitlines():
        match = re.match(r"^([A-Z_]+)=", line)
        if match and match[1] in values:
            key = match[1]
            value = remaining.pop(key, None)
            if value is not None:
                lines.append(f"{key}={value}")
        else:
            lines.append(line)
    lines.extend(f"{key}={value}" for key, value in remaining.items() if value is not None)
    return "\n".join(lines) + "\n"


def apply(origin: str, env: Path = ENV, backup: Path = BACKUP) -> None:
    values = settings_for(origin)
    content = env.read_text(encoding="utf-8-sig")
    if not backup.exists():
        original: dict[str, str | None] = dict.fromkeys(KEYS)
        for line in content.splitlines():
            match = re.match(r"^([A-Z_]+)=(.*)$", line)
            if match and match[1] in original:
                original[match[1]] = match[2]
        backup.parent.mkdir(parents=True, exist_ok=True)
        backup.write_text(json.dumps(original, indent=2), encoding="utf-8")
    temporary = env.with_name(env.name + ".tunnel-tmp")
    temporary.write_text(replace_public_values(content, values), encoding="utf-8")
    temporary.replace(env)


def restore(env: Path = ENV, backup: Path = BACKUP) -> None:
    values = json.loads(backup.read_text(encoding="utf-8"))
    if not isinstance(values, dict) or set(values) != set(KEYS):
        raise ValueError("Некорректная копия публичных настроек")
    if any(value is not None and not isinstance(value, str) for value in values.values()):
        raise ValueError("Некорректные значения публичных настроек")
    temporary = env.with_name(env.name + ".tunnel-tmp")
    temporary.write_text(
        replace_public_values(env.read_text(encoding="utf-8-sig"), values),
        encoding="utf-8",
    )
    temporary.replace(env)
    backup.unlink()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--apply", action="store_true")
    action.add_argument("--restore", action="store_true")
    parser.add_argument("--origin", help="HTTPS origin; по умолчанию .local/quick-tunnel.json")
    args = parser.parse_args()
    try:
        if args.restore:
            restore()
            print("Исходные публичные настройки восстановлены. Перезапустите backend/Vite.")
        else:
            origin = args.origin
            if not origin:
                state = json.loads(STATE.read_text(encoding="utf-8"))
                if state.get("stopped_at"):
                    raise ValueError("Туннель уже остановлен")
                origin = state["origin"]
            apply(origin)
            print(f"Настройки применены: {canonical_origin(origin)}/")
            print("Backend 8001, Vite 5173, Secure/HttpOnly/SameSite=Lax. Перезапустите процессы.")
    except Exception as exc:  # noqa: BLE001 - do not expose .env values through exceptions
        print(f"Настройки не применены ({type(exc).__name__}). Проверьте .env и адрес туннеля.")
        raise SystemExit(1) from None
