import asyncio
import io
import logging
import re
import uuid
import warnings
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

import anyio
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import SQLAlchemyError

from poidem.api.errors import AppError
from poidem.db.models import MediaDeletion, RateLimitWindow
from poidem.settings import Settings

logger = logging.getLogger("poidem.media")


def media_path(settings: Settings, key: str) -> Path:
    if not re.fullmatch(r"[0-9a-f]{32}\.jpg", key):
        raise AppError(404, "RESOURCE_NOT_FOUND", "Фотография не найдена")
    root = settings.media_root.resolve()
    path = (root / key).resolve()
    if not path.is_relative_to(root):
        raise AppError(404, "RESOURCE_NOT_FOUND", "Фотография не найдена")
    return path


@dataclass(frozen=True)
class PreparedPhoto:
    content: bytes
    width: int
    height: int


def prepare_photo(content: bytes, media_type: str, settings: Settings) -> PreparedPhoto:
    formats = {"image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP"}
    if media_type not in formats:
        raise AppError(415, "PHOTO_TYPE_UNSUPPORTED", "Подойдёт JPG, PNG или WebP")
    if not content or len(content) > settings.photo_max_bytes:
        raise AppError(413, "PHOTO_TOO_LARGE", "Выбери фотографию размером до 3 МБ")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(content)) as original:
                if (
                    original.format != formats[media_type]
                    or original.width * original.height > settings.photo_max_pixels
                ):
                    raise ValueError
                if getattr(original, "n_frames", 1) != 1:
                    raise ValueError
                original.verify()
            with Image.open(io.BytesIO(content)) as original:
                original.load()
                oriented = ImageOps.exif_transpose(original)
                image = Image.new("RGB", oriented.size, "white")
                if oriented.mode in ("RGBA", "LA") or "transparency" in oriented.info:
                    rgba = oriented.convert("RGBA")
                    image.paste(rgba, mask=rgba.getchannel("A"))
                else:
                    image.paste(oriented.convert("RGB"))
                image.thumbnail((settings.photo_max_edge, settings.photo_max_edge))
                output = io.BytesIO()
                # Новое растровое изображение, без EXIF/ICC/комментариев исходника.
                image.save(output, "JPEG", quality=90, optimize=True)
                result = output.getvalue()
                if len(result) > settings.photo_max_bytes:
                    raise ValueError
                return PreparedPhoto(result, image.width, image.height)
    except (
        UnidentifiedImageError,
        OSError,
        ValueError,
        SyntaxError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
    ):
        raise AppError(
            422,
            "PHOTO_CONTENT_INVALID",
            "Не удалось проверить фото. Выбери обычный JPG, PNG или WebP до 16 мегапикселей",
        ) from None


def write_photo(settings: Settings, photo: PreparedPhoto) -> str:
    settings.media_root.mkdir(parents=True, exist_ok=True)
    key = f"{uuid.uuid4().hex}.jpg"
    target = media_path(settings, key)
    temporary = target.with_suffix(".tmp")
    try:
        with temporary.open("xb") as stream:
            stream.write(photo.content)
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)
    return key


async def queue_deletions(session, keys: list[str]) -> None:
    if keys:
        await session.execute(
            insert(MediaDeletion)
            .values([{"storage_key": key} for key in keys])
            .on_conflict_do_nothing()
        )


async def drain_deletions(database, settings: Settings, keys: list[str] | None = None) -> bool:
    """Удаление идемпотентно; запись остаётся для повторов после I/O ошибки."""
    async with database.sessions() as session:
        query = select(MediaDeletion).where(MediaDeletion.next_attempt_at <= datetime.now(UTC))
        if keys is not None:
            if not keys:
                return True
            query = query.where(MediaDeletion.storage_key.in_(keys))
        jobs = (
            await session.scalars(
                query.order_by(MediaDeletion.created_at)
                .limit(100)
                .with_for_update(skip_locked=True)
            )
        ).all()
        for job in jobs:
            try:
                await anyio.to_thread.run_sync(
                    lambda key=job.storage_key: media_path(settings, key).unlink(missing_ok=True)
                )
                await session.delete(job)
            except (OSError, AppError):
                job.attempts += 1
                job.next_attempt_at = datetime.now(UTC) + timedelta(seconds=30)
                logger.warning("media_cleanup_retry")
        await session.commit()
        if keys:
            remaining = await session.scalar(
                select(MediaDeletion.storage_key)
                .where(MediaDeletion.storage_key.in_(keys))
                .limit(1)
            )
            return remaining is None
        return True


async def try_drain_deletions(database, settings: Settings, keys: list[str]) -> bool:
    try:
        return await drain_deletions(database, settings, keys)
    except (SQLAlchemyError, OSError):
        logger.warning("media_cleanup_unavailable")
        return False


async def cleanup_loop(database, settings: Settings) -> None:
    while True:
        try:
            await collect_orphans(database, settings)
            await drain_deletions(database, settings)
            async with database.sessions() as session:
                await session.execute(
                    delete(RateLimitWindow).where(
                        RateLimitWindow.window < int(datetime.now(UTC).timestamp()) // 60 - 2
                    )
                )
                await session.commit()
        except Exception:
            logger.warning("media_cleanup_unavailable")
        await asyncio.sleep(30)


async def collect_orphans(database, settings: Settings) -> None:
    """Файлы незавершённой записи после аварии: часовой запас для активных запросов."""
    from poidem.db.models import EditorialIdea, Photo

    cutoff = datetime.now(UTC).timestamp() - 3600

    def scan() -> list[str]:
        root = settings.media_root.resolve()
        found = []
        for path in root.glob("*"):
            resolved = path.resolve()
            if not resolved.is_relative_to(root) or not re.fullmatch(
                r"[0-9a-f]{32}\.(jpg|tmp)", path.name
            ):
                continue
            try:
                if path.stat().st_mtime >= cutoff:
                    continue
                if path.suffix == ".tmp":
                    path.unlink(missing_ok=True)
                else:
                    found.append(path.name)
            except FileNotFoundError:
                continue
        return found

    candidates = await anyio.to_thread.run_sync(scan)
    if not candidates:
        return
    async with database.sessions() as session:
        known = set(
            (
                await session.scalars(
                    select(Photo.storage_key).where(Photo.storage_key.in_(candidates))
                )
            ).all()
        )
        known.update(
            (
                await session.scalars(
                    select(EditorialIdea.image_key).where(EditorialIdea.image_key.in_(candidates))
                )
            ).all()
        )
        await queue_deletions(session, [key for key in candidates if key not in known])
        await session.commit()
