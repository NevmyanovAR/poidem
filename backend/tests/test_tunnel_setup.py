"""Конфигурация временного стенда без подключения к БД и секретов."""

import importlib.util
import json
import sys
from pathlib import Path

import pytest


def load_script(name):
    path = Path(__file__).resolve().parents[2] / "scripts" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


config = load_script("tunnel_config")
tunnel = load_script("quick_tunnel")
ORIGIN = "https://unit-test-origin.trycloudflare.com"


@pytest.mark.parametrize(
    "value",
    [
        "http://unit-test-origin.trycloudflare.com",
        "https://trycloudflare.com",
        "https://attacker.example",
        "https://x.trycloudflare.com.attacker.example",
        "https://u:p@x.trycloudflare.com",
        "https://x.trycloudflare.com:443",
        "https://x.trycloudflare.com/profile",
        "https://x.trycloudflare.com?secret=private",
        "https://x.trycloudflare.com#private",
        "https://*.trycloudflare.com",
    ],
)
def test_tunnel_origin_is_exact_https_and_has_no_credentials(value):
    with pytest.raises(ValueError):
        config.settings_for(value)


def test_origin_config_keeps_api_on_same_origin_and_backend_on_loopback():
    values = config.settings_for(ORIGIN + "/")
    assert values["MINI_APP_URL"] == ORIGIN + "/"
    assert values["API_PUBLIC_URL"] == ORIGIN + "/api/v1"
    assert values["VITE_API_BASE_URL"] == "/api/v1"
    assert values["POIDEM_API_PROXY_TARGET"] == "http://127.0.0.1:8001"
    assert values["SESSION_COOKIE_SECURE"] == "true"
    assert values["SESSION_COOKIE_SAMESITE"] == "lax"
    assert json.loads(values["CORS_ORIGINS"]) == [ORIGIN]
    assert json.loads(values["TRUSTED_HOSTS"]) == ["127.0.0.1", "localhost"]


def test_apply_restore_preserves_secrets_and_original_absence_of_public_settings(tmp_path):
    env = tmp_path / ".env"
    backup = tmp_path / "state" / "public.json"
    original = (
        "# comment\nTELEGRAM_BOT_TOKEN=synthetic-secret-never-logged\n"
        "DATABASE_URL=private-db-address\nSESSION_COOKIE_SECURE=\n"
        "MINI_APP_URL=https://example.org\n"
    )
    env.write_text(original, encoding="utf-8")
    config.apply(ORIGIN, env, backup)
    current = env.read_text(encoding="utf-8")
    assert "TELEGRAM_BOT_TOKEN=synthetic-secret-never-logged" in current
    assert "DATABASE_URL=private-db-address" in current
    assert "secret" not in backup.read_text(encoding="utf-8")
    assert "private-db" not in backup.read_text(encoding="utf-8")
    # Новый туннель сохраняет самую первую резервную копию, а не предыдущий URL.
    config.apply("https://second-test.trycloudflare.com", env, backup)
    config.restore(env, backup)
    assert env.read_text(encoding="utf-8") == original
    assert not backup.exists()


def test_secret_updates_and_corrupt_backup_do_not_change_env(tmp_path):
    with pytest.raises(ValueError):
        config.replace_public_values("TELEGRAM_BOT_TOKEN=private\n", {"TELEGRAM_BOT_TOKEN": "x"})
    env, backup = tmp_path / ".env", tmp_path / "backup.json"
    env.write_text("private content", encoding="utf-8")
    backup.write_text('{"TELEGRAM_BOT_TOKEN":"forged"}', encoding="utf-8")
    with pytest.raises(ValueError):
        config.restore(env, backup)
    assert env.read_text(encoding="utf-8") == "private content"


def test_tunnel_logs_only_startup_origin_and_fixed_statuses():
    startup = json.dumps({"level": "info", "message": f"| {ORIGIN} |"})
    assert tunnel.public_event(startup) == ("origin", ORIGIN)
    sensitive = json.dumps(
        {
            "level": "error",
            "message": f"Request failed {ORIGIN}/?initData=private",
            "cookie": "private-cookie",
            "error": "private-token",
        },
        separators=(",", ":"),
    )
    result = tunnel.public_event(sensitive)
    assert result is not None
    assert "private" not in str(result)
    assert "initData" not in str(result)
    assert tunnel.public_event("Cookie: private-cookie initData=private") is None
