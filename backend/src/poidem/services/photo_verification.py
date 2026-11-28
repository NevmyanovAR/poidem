import secrets
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, or_, select

from poidem.api.errors import AppError
from poidem.db.models import AdminAuditLog, Photo, PhotoVerification, Profile, User
from poidem.security.session import lock_actor
from poidem.services import admin_permissions, media, notifications

GESTURES = {
    "open_palm": "Покажи открытую ладонь рядом с лицом",
    "two_fingers": "Покажи два пальца рядом с лицом",
    "thumb_up": "Покажи большой палец вверх рядом с лицом",
}
REASONS = {
    "face_mismatch": "Лицо не совпадает с фотографией анкеты",
    "face_unclear": "Лицо плохо видно",
    "instruction_mismatch": "Проверочный снимок не соответствует инструкции",
    "insufficient": "Недостаточно данных для подтверждения",
    "other": "Другая причина",
}


def now():
    return datetime.now(UTC)


def enabled(settings):
    return bool(
        settings.photo_verification_enabled
        and settings.photo_verification_policy_approved
        and settings.photo_verification_consent_version.strip()
        and settings.photo_verification_consent_text.strip()
        and settings.photo_verification_pending_hours is not None
        and settings.photo_verification_reviewed_retention_hours is not None
    )


def require_enabled(settings):
    if not enabled(settings):
        raise AppError(503, "PHOTO_VERIFICATION_UNAVAILABLE", "Подтверждение фото пока недоступно")


async def verified(session, profile, photo=None):
    if not profile:
        return False
    photo = photo or await session.get(Photo, profile.photo_id)
    return bool(
        photo
        and await session.scalar(
            select(PhotoVerification.id)
            .where(
                PhotoVerification.user_id == profile.user_id,
                PhotoVerification.photo_id == profile.photo_id,
                PhotoVerification.photo_revision == profile.photo_revision,
                PhotoVerification.photo_content_version == photo.content_version,
                PhotoVerification.state == "approved",
                PhotoVerification.consent_revoked_at.is_(None),
            )
            .limit(1)
        )
    )


async def clear_materials(session, entry):
    await media.queue_deletions(
        session, [key for key in (entry.primary_key, entry.selfie_key) if key]
    )
    entry.primary_key = entry.selfie_key = None
    entry.purge_at = None


async def expire(session, entry):
    if entry.state == "pending" and entry.expires_at <= now():
        entry.state = "expired"
        entry.reason_code = "timeout"
        entry.version += 1
        await clear_materials(session, entry)


async def invalidate_photo(session, user_id):
    entries = (
        await session.scalars(
            select(PhotoVerification)
            .where(
                PhotoVerification.user_id == user_id,
                PhotoVerification.state.in_(("pending", "approved")),
            )
            .with_for_update()
        )
    ).all()
    for entry in entries:
        entry.state = "expired"
        entry.reason_code = "photo_changed"
        entry.version += 1
        await clear_materials(session, entry)


def dto(entry):
    return {
        "id": str(entry.id),
        "state": entry.state,
        "version": entry.version,
        "created_at": entry.created_at,
        "submitted_at": entry.submitted_at,
        "expires_at": entry.expires_at,
        "reviewed_at": entry.reviewed_at,
        "instruction": GESTURES[entry.gesture_code],
        "reason_code": entry.reason_code,
        "reason": (
            entry.reason_comment if entry.reason_code == "other" else REASONS.get(entry.reason_code)
        ),
        "consent_version": entry.consent_version,
    }


async def status(session, actor, settings):
    user = await lock_actor(session, actor, active=False)
    profile = await session.get(Profile, actor.user_id)
    entry = await session.scalar(
        select(PhotoVerification)
        .where(PhotoVerification.user_id == actor.user_id)
        .order_by(PhotoVerification.created_at.desc(), PhotoVerification.id.desc())
        .limit(1)
        .with_for_update()
    )
    if entry:
        await expire(session, entry)
    confirmed = await verified(session, profile)
    state = "verified" if confirmed else "unverified"
    if entry and not confirmed and entry.consent_revoked_at is None:
        state = (
            "invalidated"
            if profile
            and (
                entry.photo_id != profile.photo_id
                or entry.photo_revision != profile.photo_revision
                or entry.reason_code == "photo_changed"
            )
            else "pending"
            if entry.state == "pending" and entry.submitted_at
            else "rejected"
            if entry.state == "rejected"
            else "unverified"
        )
    await session.commit()
    return {
        "photo_id": str(profile.photo_id) if profile else None,
        "available": enabled(settings) and user.account_status == "active",
        "state": state,
        "photo_verified": confirmed,
        "consent_version": settings.photo_verification_consent_version if enabled(settings) else "",
        "consent_text": settings.photo_verification_consent_text if enabled(settings) else "",
        "retention": {
            "pending_hours": settings.photo_verification_pending_hours,
            "reviewed_hours": settings.photo_verification_reviewed_retention_hours,
        }
        if enabled(settings)
        else None,
        "request": dto(entry) if entry else None,
    }


async def challenge(session, actor, payload, settings):
    require_enabled(settings)
    await lock_actor(session, actor)
    profile = await session.get(Profile, actor.user_id)
    if not profile:
        raise AppError(409, "PROFILE_REQUIRED", "Сначала сохрани анкету и основное фото")
    if payload.consent_version != settings.photo_verification_consent_version:
        raise AppError(409, "CONSENT_CHANGED", "Условия изменились — прочитай их ещё раз")
    entry = await session.scalar(
        select(PhotoVerification)
        .where(PhotoVerification.user_id == actor.user_id, PhotoVerification.state == "pending")
        .with_for_update()
    )
    if entry:
        await expire(session, entry)
        if (
            entry.state == "pending"
            and not entry.submitted_at
            and entry.consent_version != payload.consent_version
        ):
            entry.state = "expired"
            entry.reason_code = "consent_changed"
            entry.version += 1
            await clear_materials(session, entry)
        if entry.state == "pending":
            return dto(entry)
    if await verified(session, profile):
        raise AppError(409, "PHOTO_ALREADY_VERIFIED", "Это фото уже подтверждено")
    await session.flush()
    count = await session.scalar(
        select(func.count())
        .select_from(PhotoVerification)
        .where(
            PhotoVerification.user_id == actor.user_id,
            PhotoVerification.created_at > now() - timedelta(days=1),
        )
    )
    if count >= settings.photo_verification_attempts_per_day:
        raise AppError(
            429,
            "VERIFICATION_RATE_LIMITED",
            "Лимит попыток за последние сутки достигнут. Попробуй позже",
            retry_after=3600,
        )
    photo = await session.get(Photo, profile.photo_id)
    entry = PhotoVerification(
        user_id=actor.user_id,
        photo_id=photo.id,
        photo_revision=profile.photo_revision,
        photo_content_version=photo.content_version,
        gesture_code=secrets.choice(tuple(GESTURES)),
        consent_version=payload.consent_version,
        consent_text=settings.photo_verification_consent_text,
        consented_at=now(),
        expires_at=now() + timedelta(seconds=settings.photo_verification_challenge_seconds),
        review_retention_hours=settings.photo_verification_reviewed_retention_hours,
    )
    session.add(entry)
    await session.flush()
    await session.commit()
    return dto(entry)


async def own_entry(session, actor, identity, *, active=True):
    await lock_actor(session, actor, active=active)
    entry = await session.scalar(
        select(PhotoVerification)
        .where(PhotoVerification.id == identity, PhotoVerification.user_id == actor.user_id)
        .with_for_update()
    )
    if not entry:
        raise AppError(404, "VERIFICATION_NOT_FOUND", "Заявка не найдена")
    return entry


async def submit(session, actor, identity, prepared, settings):
    require_enabled(settings)
    entry = await own_entry(session, actor, identity)
    await expire(session, entry)
    profile = await session.get(Profile, actor.user_id)
    photo = await session.get(Photo, profile.photo_id) if profile else None
    if (
        entry.state != "pending"
        or not photo
        or entry.photo_id != photo.id
        or entry.photo_revision != profile.photo_revision
        or entry.photo_content_version != photo.content_version
    ):
        await session.commit()
        raise AppError(
            409, "VERIFICATION_EXPIRED", "Фото или инструкция изменились — начни проверку заново"
        )
    if entry.submitted_at:
        return dto(entry)
    if entry.consent_version != settings.photo_verification_consent_version:
        raise AppError(409, "CONSENT_CHANGED", "Условия изменились — начни проверку заново")
    # Снимок основной фотографии сохраняется только для этой заявки, без публичного Photo.
    import anyio

    try:
        original = await anyio.to_thread.run_sync(
            lambda: media.media_path(settings, photo.storage_key).read_bytes()
        )
    except OSError:
        raise AppError(
            409, "PHOTO_UNAVAILABLE", "Основное фото недоступно — повтори позже"
        ) from None
    primary = media.PreparedPhoto(original, photo.width, photo.height)
    entry.primary_key = await anyio.to_thread.run_sync(lambda: media.write_photo(settings, primary))
    entry.selfie_key = await anyio.to_thread.run_sync(lambda: media.write_photo(settings, prepared))
    entry.submitted_at = now()
    entry.expires_at = now() + timedelta(hours=settings.photo_verification_pending_hours)
    entry.purge_at = entry.expires_at
    entry.version += 1
    await session.commit()
    return dto(entry)


async def withdraw(session, actor, identity, expected):
    entry = await own_entry(session, actor, identity, active=False)
    if entry.version != expected:
        raise AppError(409, "VERIFICATION_VERSION", "Заявка изменилась — обнови её")
    latest = await session.scalar(
        select(PhotoVerification.id)
        .where(PhotoVerification.user_id == actor.user_id)
        .order_by(PhotoVerification.created_at.desc(), PhotoVerification.id.desc())
        .limit(1)
    )
    if latest != entry.id:
        raise AppError(409, "VERIFICATION_VERSION", "Появилась новая заявка — обнови страницу")
    entries = (
        await session.scalars(
            select(PhotoVerification)
            .where(
                PhotoVerification.user_id == actor.user_id,
                PhotoVerification.consent_revoked_at.is_(None),
            )
            .with_for_update()
        )
    ).all()
    for item in entries:
        item.consent_revoked_at = now()
        item.state = "cancelled"
        item.reason_code = "consent_withdrawn"
        item.version += 1
        await clear_materials(session, item)
    await session.commit()
    return dto(entry)


async def decide(session, actor, identity, payload, request_id=None):
    await admin_permissions.require(session, actor, "moderation")
    entry = await session.get(PhotoVerification, identity)
    if not entry or not entry.submitted_at:
        raise AppError(404, "VERIFICATION_NOT_FOUND", "Заявка не найдена")
    if entry.user_id == actor.user_id:
        raise AppError(
            403,
            "VERIFICATION_SELF_REVIEW",
            "Собственную заявку должен рассмотреть другой модератор",
        )
    await session.scalars(
        select(User)
        .where(User.id.in_((actor.user_id, entry.user_id)))
        .order_by(User.id)
        .with_for_update(key_share=True)
    )
    await lock_actor(session, actor)
    await admin_permissions.require(session, actor, "moderation")
    entry = await session.scalar(
        select(PhotoVerification)
        .where(PhotoVerification.id == identity)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if entry is None:
        raise AppError(404, "VERIFICATION_NOT_FOUND", "Заявка не найдена")
    await expire(session, entry)
    profile = await session.get(Profile, entry.user_id)
    photo = await session.get(Photo, profile.photo_id) if profile else None
    if (
        entry.state != "pending"
        or not photo
        or entry.photo_id != photo.id
        or entry.photo_revision != profile.photo_revision
        or entry.photo_content_version != photo.content_version
    ):
        await session.commit()
        raise AppError(409, "VERIFICATION_EXPIRED", "Заявка уже рассмотрена или фото изменилось")
    if entry.version != payload.expected_version:
        raise AppError(409, "VERIFICATION_VERSION", "Заявка изменилась — обнови её")
    entry.state = payload.decision
    entry.reason_code = payload.reason_code
    entry.reason_comment = payload.comment if payload.reason_code == "other" else None
    entry.reviewed_by = actor.user_id
    entry.reviewed_at = now()
    entry.version += 1
    entry.purge_at = now() + timedelta(hours=entry.review_retention_hours)
    session.add(
        AdminAuditLog(
            actor_id=actor.user_id,
            action="photo_verification." + entry.state,
            target_ref=f"photo_verification:{entry.id}",
            object_version=entry.version,
            old_status="pending",
            new_status=entry.state,
            reason_code=entry.reason_code or "photo_match",
            request_id=request_id or uuid.uuid4(),
        )
    )
    await notifications.enqueue(
        session,
        "photo_verification_" + entry.state,
        entry.user_id,
        {"verification_id": str(entry.id)},
        f"verification:{entry.id}:{entry.state}",
    )
    if entry.review_retention_hours == 0:
        await clear_materials(session, entry)
    await session.commit()
    return dto(entry)


async def cleanup(session):
    # Та же очередь файлов/тот же цикл cleanup. Сначала user lock, затем request lock.
    identities = (
        await session.scalars(
            select(PhotoVerification.user_id)
            .where(
                or_(
                    (PhotoVerification.state == "pending")
                    & (PhotoVerification.expires_at <= now()),
                    PhotoVerification.purge_at <= now(),
                )
            )
            .distinct()
            .limit(100)
        )
    ).all()
    for user_id in sorted(identities):
        await session.scalar(
            select(User.id).where(User.id == user_id).with_for_update(key_share=True)
        )
        entries = (
            await session.scalars(
                select(PhotoVerification)
                .where(PhotoVerification.user_id == user_id)
                .with_for_update()
            )
        ).all()
        for entry in entries:
            await expire(session, entry)
            if entry.purge_at and entry.purge_at <= now():
                await clear_materials(session, entry)
