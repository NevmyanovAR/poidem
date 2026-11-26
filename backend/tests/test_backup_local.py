import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
from zipfile import ZipFile

import pytest


def module():
    script = Path(__file__).resolve().parents[2] / "scripts" / "backup_local.py"
    spec = importlib.util.spec_from_file_location("backup_local_test", script)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def test_backup_requires_explicit_stopped_writers_before_touching_files(tmp_path, monkeypatch):
    backup = module()
    monkeypatch.setattr(backup, "ROOT", tmp_path)
    monkeypatch.setattr(backup, "command", lambda _: pytest.fail("Docker не должен вызываться"))
    monkeypatch.setattr("sys.argv", ["backup_local.py"])
    with pytest.raises(SystemExit) as error:
        backup.main()
    assert error.value.code == 2
    assert not (tmp_path / ".local").exists()


def test_backup_archive_includes_database_and_shared_media_without_env(tmp_path, monkeypatch):
    backup = module()
    media = tmp_path / "private-media"
    media.mkdir()
    (media / "profile.jpg").write_bytes(b"synthetic profile")
    (media / "editorial.jpg").write_bytes(b"synthetic editorial")
    (media / "unfinished.tmp").write_bytes(b"incomplete")
    (tmp_path / ".env").write_text("DO_NOT_COPY=synthetic", encoding="utf-8")
    monkeypatch.setattr(backup, "ROOT", tmp_path)
    monkeypatch.setattr(backup, "load_settings", lambda: SimpleNamespace(media_root=media))
    calls = []

    def docker(args):
        calls.append(args)
        if "cp" in args:
            Path(args[-1]).write_bytes(b"synthetic pg_dump; actual restore is not tested here")

    monkeypatch.setattr(backup, "command", docker)
    monkeypatch.setattr("sys.argv", ["backup_local.py", "--writers-stopped"])
    backup.main()
    assert len(calls) == 2 and calls[0][:5] == ["docker", "compose", "exec", "-T", "db"]
    archive = next((tmp_path / ".local" / "backups").glob("*.zip"))
    with ZipFile(archive) as output:
        assert set(output.namelist()) == {
            "database.dump",
            "media/profile.jpg",
            "media/editorial.jpg",
            "manifest.json",
        }
        assert output.read("media/editorial.jpg") == b"synthetic editorial"
        assert json.loads(output.read("manifest.json"))["writers_stopped_confirmed"] is True


def test_backup_failure_does_not_echo_raw_process_output(monkeypatch):
    backup = module()
    monkeypatch.setattr(
        backup.subprocess,
        "run",
        lambda *a, **k: SimpleNamespace(returncode=1, stderr=b"sensitive output"),
    )
    with pytest.raises(RuntimeError) as error:
        backup.command(["docker", "compose", "version"])
    assert "sensitive" not in str(error.value)
