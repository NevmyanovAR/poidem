"""Локальная резервная копия БД и общего MEDIA_ROOT. Не запускает и не останавливает сервисы."""

import argparse
import json
import subprocess
import uuid
import zipfile
from datetime import UTC, datetime
from pathlib import Path

from poidem.db.models import EditorialIdea, Photo
from poidem.settings import load_settings
from sqlalchemy import create_engine, select
from sqlalchemy.exc import SQLAlchemyError

ROOT = Path(__file__).resolve().parents[1]


def command(args):
    result = subprocess.run(args, cwd=ROOT, capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError(
            "Не удалось выполнить шаг резервного копирования; проверь Docker и место на диске"
        )


def backup_media_keys(settings):
    """Только основные/редакционные фото; временные материалы проверки не копируются.

    Allowlist также исключает уже отозванные файлы в очереди удаления и orphan-файлы.
    Получается после подтверждённой остановки writers, теми же ролями/БД.
    """
    engine = create_engine(
        settings.database_url.get_secret_value(),
        hide_parameters=True,
        connect_args={"connect_timeout": settings.db_connect_timeout_seconds},
    )
    try:
        with engine.connect() as connection:
            return {
                *connection.execute(select(Photo.storage_key)).scalars(),
                *connection.execute(select(EditorialIdea.image_key)).scalars(),
            } - {None}
    except SQLAlchemyError:
        raise RuntimeError("Не удалось определить разрешённые фото для копии") from None
    finally:
        engine.dispose()


def main():
    parser = argparse.ArgumentParser(
        description="Закрытая локальная копия БД и фотографий"
    )
    parser.add_argument(
        "--writers-stopped",
        action="store_true",
        help="Подтвердить остановку API и bot/worker перед копированием",
    )
    args = parser.parse_args()
    if not args.writers_stopped:
        parser.error(
            "Сначала останови API и единственный bot/worker; затем укажи --writers-stopped"
        )
    settings = load_settings()
    allowed_media = backup_media_keys(settings)
    root = ROOT / ".local" / "backups"
    root.mkdir(parents=True, exist_ok=True)
    marker = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]
    dump = root / f"{marker}.dump"
    archive = root / f"poidem-{marker}.zip"
    container_file = f"/tmp/poidem-{marker}.dump"
    # Фиксированная команда; секреты остаются внутри существующего контейнера.
    command(
        [
            "docker",
            "compose",
            "exec",
            "-T",
            "db",
            "sh",
            "-c",
            'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f "$1"',
            "backup",
            container_file,
        ]
    )
    command(["docker", "compose", "cp", f"db:{container_file}", str(dump)])
    media_root = settings.media_root.resolve()
    with zipfile.ZipFile(archive, "x", compression=zipfile.ZIP_DEFLATED) as target:
        target.write(dump, "database.dump")
        for photo in media_root.glob("*.jpg"):
            if (
                photo.name in allowed_media
                and photo.is_file()
                and photo.resolve().is_relative_to(media_root)
            ):
                target.write(photo, "media/" + photo.name)
        target.writestr(
            "manifest.json",
            json.dumps(
                {
                    "created_at": datetime.now(UTC).isoformat(),
                    "includes": [
                        "PostgreSQL",
                        "MEDIA_ROOT профилей и редакционных идей",
                    ],
                    "static_editorial_assets": "Сохраняйте соответствующую версию frontend/public/images вместе с репозиторием",
                    "writers_stopped_confirmed": True,
                    "verification_materials_included": False,
                    "pending_verification_restore": "Проверочные материалы не восстанавливаются; потребуется новая заявка",
                },
                ensure_ascii=False,
            ),
        )
    # Не удаляем исходный dump при неоднозначном исходе записи ZIP.
    print(f"Локальная копия: {archive.relative_to(ROOT)}")
    print(
        "Копия содержит персональные данные: храните с ограниченным доступом и вне Git"
    )


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, zipfile.BadZipFile):
        raise SystemExit(
            "Резервная копия не завершена; не считайте оставшиеся файлы проверенной копией"
        ) from None
