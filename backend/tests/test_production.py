"""Production ops: validate secrets/hosts, safe backup extraction and heartbeat."""

import importlib.util
import io
import json
import tarfile
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[2]


def load(relative):
    spec = importlib.util.spec_from_file_location("production_ops", ROOT / relative)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def config():
    return {
        "APP_DOMAIN": "poidem-audit.org",
        "ACME_EMAIL": "ops@poidem-audit.org",
        "MINI_APP_URL": "https://poidem-audit.org",
        "API_PUBLIC_URL": "https://poidem-audit.org/api/v1",
        "CORS_ORIGINS": '["https://poidem-audit.org"]',
        "TRUSTED_HOSTS": '["poidem-audit.org"]',
        "RELEASE_TAG": "a" * 40,
        "POSTGRES_PASSWORD": "a" * 64,
        "POSTGRES_APP_PASSWORD": "b" * 64,
        "POSTGRES_MIGRATION_PASSWORD": "c" * 64,
        "TELEGRAM_BOT_TOKEN": "123456789:" + "synthetic_only_not_a_real_token_0000",
        "TELEGRAM_BOT_USERNAME": "Synthetic_bot",
        "PHOTO_VERIFICATION_ENABLED": "false",
        "PHOTO_VERIFICATION_POLICY_APPROVED": "false",
        "POSITIVE_IMPRESSIONS_THRESHOLD": "3",
    }


def test_production_config_accepts_exact_https_and_independent_passwords(tmp_path, monkeypatch):
    module = load("deploy/configure.py")
    monkeypatch.setattr(module, "ENV", tmp_path / "absent.env")
    module.validate(config())


@pytest.mark.parametrize(
    "change",
    [
        {"APP_DOMAIN": "example.com"},
        {"COMPOSE_PROJECT_NAME": "unrelated-application"},
        {"COMPOSE_PROJECT_NAME": "poidem;echo unsafe"},
        {"APP_DOMAIN": "212.69.85.148"},
        {"APP_DOMAIN": "x;echo secret"},
        {"MINI_APP_URL": "http://poidem-audit.org"},
        {"API_PUBLIC_URL": "https://other.org/api/v1"},
        {"CORS_ORIGINS": '["*"]'},
        {"TRUSTED_HOSTS": '["localhost"]'},
        {"POSTGRES_PASSWORD": "short"},
        {"POSTGRES_APP_PASSWORD": "a" * 64},
        {"TELEGRAM_BOT_TOKEN": ""},
        {"RELEASE_TAG": "latest"},
        {"PHOTO_VERIFICATION_ENABLED": "true"},
        {"PHOTO_VERIFICATION_ENABLED": "true", "PHOTO_VERIFICATION_POLICY_APPROVED": "true"},
        {"POSITIVE_IMPRESSIONS_THRESHOLD": "1"},
    ],
)
def test_production_preflight_rejects_unsafe_or_unapproved_configuration(
    change, tmp_path, monkeypatch
):
    module = load("deploy/configure.py")
    monkeypatch.setattr(module, "ENV", tmp_path / "absent.env")
    with pytest.raises(ValueError):
        module.validate(config() | change)


def test_verification_can_only_be_enabled_with_explicit_complete_approved_policy(
    tmp_path, monkeypatch
):
    module = load("deploy/configure.py")
    monkeypatch.setattr(module, "ENV", tmp_path / "absent.env")
    values = config() | {
        "PHOTO_VERIFICATION_ENABLED": "true",
        "PHOTO_VERIFICATION_POLICY_APPROVED": "true",
        "PHOTO_VERIFICATION_CONSENT_VERSION": "synthetic-unit-test-only",
        "PHOTO_VERIFICATION_CONSENT_TEXT": "Synthetic policy; not a production approval",
        "PHOTO_VERIFICATION_PENDING_HOURS": "48",
        "PHOTO_VERIFICATION_REVIEWED_RETENTION_HOURS": "0",
    }
    module.validate(values)
    for change in [
        {"PHOTO_VERIFICATION_POLICY_APPROVED": "false"},
        {"PHOTO_VERIFICATION_CONSENT_TEXT": ""},
        {"PHOTO_VERIFICATION_PENDING_HOURS": "0"},
        {"PHOTO_VERIFICATION_REVIEWED_RETENTION_HOURS": "-1"},
    ]:
        with pytest.raises(ValueError):
            module.validate(values | change)


def test_env_reader_does_not_execute_shell_and_rejects_duplicate_keys(tmp_path):
    module = load("deploy/configure.py")
    path = tmp_path / "config.env"
    path.write_text(
        'TEXT=$(echo unsafe)\nCORS_ORIGINS=["https://poidem-audit.org"]\n', encoding="utf-8"
    )
    values = module.read_env(path)
    assert values["TEXT"] == "$(echo unsafe)"
    assert json.loads(values["CORS_ORIGINS"]) == ["https://poidem-audit.org"]
    path.write_text("TEXT=a\nTEXT=b\n", encoding="utf-8")
    with pytest.raises(ValueError):
        module.read_env(path)


def test_media_roundtrip_uses_allowlist_excludes_verification_and_requires_empty_target(tmp_path):
    module = load("deploy/ops/media.py")
    media = tmp_path / "source"
    media.mkdir()
    key, temporary = "a" * 32 + ".jpg", "b" * 32 + ".jpg"
    (media / key).write_bytes(b"synthetic profile image")
    (media / temporary).write_bytes(b"synthetic verification must not be copied")
    settings = SimpleNamespace(media_root=media, photo_max_bytes=1024)
    archive = io.BytesIO()
    module.export_media(settings, {key}, archive)
    archive.seek(0)
    with tarfile.open(fileobj=archive) as target:
        assert target.getnames() == [key]
    archive.seek(0)
    settings.media_root = tmp_path / "restored"
    module.import_media(settings, {key}, archive)
    assert (settings.media_root / key).read_bytes() == b"synthetic profile image"
    assert not (settings.media_root / temporary).exists()
    archive.seek(0)
    with pytest.raises(ValueError, match="empty"):
        module.import_media(settings, {key}, archive)


@pytest.mark.parametrize(
    "name,kind",
    [
        ("../outside.jpg", tarfile.REGTYPE),
        ("a" * 32 + ".jpg", tarfile.SYMTYPE),
        ("a" * 32 + ".jpg", tarfile.LNKTYPE),
        ("b" * 32 + ".jpg", tarfile.REGTYPE),
    ],
)
def test_restore_rejects_paths_links_and_unreferenced_files(name, kind, tmp_path):
    module = load("deploy/ops/media.py")
    archive = io.BytesIO()
    with tarfile.open(fileobj=archive, mode="w") as target:
        info = tarfile.TarInfo(name)
        info.type = kind
        info.linkname = "../outside.jpg" if kind != tarfile.REGTYPE else ""
        target.addfile(info)
    archive.seek(0)
    settings = SimpleNamespace(media_root=tmp_path / "restored", photo_max_bytes=1024)
    with pytest.raises(ValueError):
        module.import_media(settings, {"a" * 32 + ".jpg"}, archive)
    assert not (tmp_path / "outside.jpg").exists()


def test_backup_refuses_missing_referenced_file_and_restore_refuses_incomplete_archive(tmp_path):
    module = load("deploy/ops/media.py")
    settings = SimpleNamespace(media_root=tmp_path, photo_max_bytes=1024)
    with pytest.raises(ValueError, match="missing"):
        module.export_media(settings, {"a" * 32 + ".jpg"}, io.BytesIO())
    archive = io.BytesIO()
    with tarfile.open(fileobj=archive, mode="w"):
        pass
    archive.seek(0)
    with pytest.raises(ValueError, match="missing"):
        module.import_media(settings, {"a" * 32 + ".jpg"}, archive)


def test_bot_health_requires_both_real_fresh_loop_heartbeats():
    module = load("deploy/ops/media.py")
    now = datetime.now(UTC)
    rows = [
        {"component": name, "state": "ok", "last_seen_at": now} for name in ("worker", "polling")
    ]
    assert module.bot_healthy(rows, now)
    assert not module.bot_healthy(rows[:1], now)
    assert not module.bot_healthy(rows, now + timedelta(seconds=61))
    assert not module.bot_healthy([rows[0], rows[1] | {"state": "error"}], now)
