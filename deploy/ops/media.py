"""Container-only operations; stdout is reserved for the media archive."""

import argparse
import asyncio
import os
import re
import sys
import tarfile
from datetime import UTC, datetime
from types import SimpleNamespace

from sqlalchemy import create_engine, select, text

from poidem.db.models import BotHeartbeat
from poidem.services.bot_health import status
from poidem.settings import load_settings


def bot_healthy(rows, at):
    healthy = {
        row["component"] for row in rows if status(SimpleNamespace(**row), at)["state"] == "ok"
    }
    return healthy == {"polling", "worker"}


def media_key(value):
    if not isinstance(value, str) or not re.fullmatch(r"[a-f0-9]{32}\.jpg", value):
        raise ValueError("Invalid media key")
    return value


def export_media(settings, allowed, output):
    root = settings.media_root.resolve()
    with tarfile.open(fileobj=output, mode="w|") as target:
        for key in sorted(allowed):
            source = root / media_key(key)
            if source.is_symlink() or source.resolve().parent != root or not source.is_file():
                raise ValueError("Referenced photo missing; backup is incomplete")
            info = target.gettarinfo(str(source), arcname=key)
            if info.size > settings.photo_max_bytes:
                raise ValueError("Unexpected media size")
            info.uid = info.gid = 0
            info.uname = info.gname = ""
            info.mode = 0o600
            with source.open("rb") as stream:
                target.addfile(info, stream)


def ensure_empty_media(settings):
    root = settings.media_root.resolve()
    root.mkdir(parents=True, exist_ok=True)
    if any(root.iterdir()):
        raise ValueError("Restore requires an empty media directory")
    return root


def import_media(settings, allowed, source):
    root = ensure_empty_media(settings)
    expected = {media_key(key) for key in allowed}
    seen = set()
    os.umask(0o077)
    with tarfile.open(fileobj=source, mode="r|") as archive:
        for item in archive:
            key = media_key(item.name)
            if (
                not item.isfile()
                or item.issym()
                or item.islnk()
                or key not in expected
                or key in seen
            ):
                raise ValueError("Unexpected archive member")
            if not 0 < item.size <= settings.photo_max_bytes:
                raise ValueError("Unexpected archive size")
            payload = archive.extractfile(item)
            if payload is None:
                raise ValueError("Missing archive content")
            # No extractall, paths, links, metadata ownership or overwrite.
            with (root / key).open("xb") as target:
                content = payload.read(item.size + 1)
                if len(content) != item.size:
                    raise ValueError("Truncated media")
                target.write(content)
            seen.add(key)
    if seen != expected:
        raise ValueError("Archive is missing referenced photos")


async def finalize_restore(settings):
    from poidem.db.models import PhotoVerification
    from poidem.db.session import Database
    from poidem.services.photo_verification import clear_materials, expire

    database = Database(settings)
    try:
        async with database.sessions() as session:
            # Restored session cookies must not resurrect old access.
            await session.execute(
                text("UPDATE auth_sessions SET revoked_at=now() WHERE revoked_at IS NULL")
            )
            for entry in await session.scalars(select(PhotoVerification).with_for_update()):
                if entry.state == "pending":
                    entry.expires_at = datetime.now(UTC)
                    await expire(session, entry)
                    entry.reason_code = "backup_restore"
                await clear_materials(session, entry)
            await session.commit()
    finally:
        await database.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "action",
        choices=[
            "backup",
            "restore",
            "finalize-restore",
            "bot-health",
            "schema-head",
            "check-empty-media",
        ],
    )
    args = parser.parse_args()
    settings = load_settings()
    if args.action == "check-empty-media":
        ensure_empty_media(settings)
    elif args.action == "schema-head":
        from poidem.api.routers.health import migration_heads

        print("\n".join(sorted(migration_heads())))
    elif args.action == "bot-health":
        engine = create_engine(
            settings.database_url.get_secret_value(),
            hide_parameters=True,
            connect_args={"connect_timeout": 5, "options": "-c statement_timeout=5000"},
        )
        try:
            with engine.connect() as connection:
                rows = connection.execute(select(BotHeartbeat.__table__)).mappings().all()
            at = datetime.now(UTC)
            if not bot_healthy(rows, at):
                raise ValueError("Bot heartbeat is not fresh")
        finally:
            engine.dispose()
    elif args.action == "finalize-restore":
        asyncio.run(finalize_restore(settings))
    else:
        # Reuse the exact allowlist from the existing backup implementation.
        sys.path.insert(0, "/opt")
        from backup_local import backup_media_keys

        keys = backup_media_keys(settings)
        if args.action == "backup":
            export_media(settings, keys, sys.stdout.buffer)
        else:
            import_media(settings, keys, sys.stdin.buffer)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        raise SystemExit("Operation failed; no sensitive details are logged") from None
