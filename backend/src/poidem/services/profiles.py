import uuid

from sqlalchemy import delete, or_, select, text

from poidem.api.errors import AppError
from poidem.db.base import Base
from poidem.db.models import (
    AnalyticsEvent,
    AuthSession,
    BotBinding,
    GenderOption,
    Interest,
    ModerationCase,
    Photo,
    PreferenceOption,
    Profile,
    ProfileInterest,
    RateLimitWindow,
    User,
)
from poidem.schemas.profile import OwnProfileDTO, PhotoDTO, ProfileWrite
from poidem.security.session import digest, lock_actor
from poidem.services.media import queue_deletions


def photo_dto(photo: Photo) -> PhotoDTO:
    return PhotoDTO(id=photo.id, url=f"/api/v1/media/photos/{photo.id}")


async def get_profile(session, user_id: uuid.UUID) -> OwnProfileDTO | None:
    profile = await session.get(Profile, user_id)
    if profile is None:
        return None
    photo = await session.get(Photo, profile.photo_id)
    interests = list(
        (
            await session.scalars(
                select(ProfileInterest.interest_code)
                .where(ProfileInterest.user_id == user_id)
                .order_by(ProfileInterest.position)
            )
        ).all()
    )
    return OwnProfileDTO(
        user_id=user_id,
        name=profile.name,
        age=profile.age,
        gender_code=profile.gender_code,
        preference_code=profile.preference_code,
        bio=profile.bio,
        photo=photo_dto(photo),
        interest_ids=interests,
        version=profile.version,
        moderation_status=profile.moderation_status,
    )


async def save_profile(session, actor, payload: ProfileWrite) -> tuple[OwnProfileDTO, list[str]]:
    await lock_actor(session, actor)
    profile = await session.get(Profile, actor.user_id)
    if (profile.version if profile else 0) != payload.expected_version:
        raise AppError(409, "VERSION_CONFLICT", "Анкета уже изменилась. Обнови страницу")
    photo = await session.get(Photo, payload.photo_id)
    if photo is None or photo.owner_id != actor.user_id or photo.processing_status != "ready":
        raise AppError(404, "RESOURCE_NOT_FOUND", "Фотография не найдена")
    for model, code in (
        (GenderOption, payload.gender_code),
        (PreferenceOption, payload.preference_code),
    ):
        if (
            await session.scalar(
                select(model.code).where(model.code == code, model.enabled.is_(True))
            )
            is None
        ):
            raise AppError(422, "PROFILE_INVALID", "Проверь варианты анкеты")
    count = len(
        (
            await session.scalars(
                select(Interest.code).where(
                    Interest.code.in_(payload.interest_ids), Interest.enabled.is_(True)
                )
            )
        ).all()
    )
    if count != 3:
        raise AppError(422, "PROFILE_INVALID", "Выбери три интереса из списка")
    values = payload.model_dump(exclude={"expected_version", "interest_ids"})
    if profile is None:
        profile = Profile(user_id=actor.user_id, version=1, **values)
        session.add(profile)
    else:
        for name, value in values.items():
            setattr(profile, name, value)
        profile.version += 1
        profile.moderation_status = "not_submitted"
    await session.flush()
    await session.execute(delete(ProfileInterest).where(ProfileInterest.user_id == actor.user_id))
    session.add_all(
        ProfileInterest(user_id=actor.user_id, position=index, interest_code=code)
        for index, code in enumerate(payload.interest_ids, 1)
    )
    # Временные загрузки и прежняя фотография не остаются навсегда на диске.
    unused = (
        await session.scalars(
            select(Photo).where(Photo.owner_id == actor.user_id, Photo.id != photo.id)
        )
    ).all()
    keys = [entry.storage_key for entry in unused]
    await queue_deletions(session, keys)
    for entry in unused:
        await session.delete(entry)
    await session.flush()
    result = await get_profile(session, actor.user_id)
    await session.commit()
    return result, keys


async def delete_account(session, actor) -> list[str]:
    await session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": actor.telegram_id})
    user = await lock_actor(session, actor, active=False)
    photos = (await session.scalars(select(Photo).where(Photo.owner_id == user.id))).all()
    # До определения судьбы совместных записей нельзя удалять чужую историю.
    handled = {"users", "profiles", "photos", "auth_sessions", "bot_bindings", "analytics_events"}
    for table in Base.metadata.tables.values():
        if table.name in handled:
            continue
        columns = [fk.parent for fk in table.foreign_keys if fk.column.table.name == "users"]
        if (
            columns
            and await session.scalar(
                select(table).where(or_(*(column == user.id for column in columns))).limit(1)
            )
            is not None
        ):
            raise AppError(
                409,
                "ACCOUNT_HAS_RELATED_DATA",
                "Удаление связанных планов и записей требует отдельного порядка. "
                "Обратись к администратору",
            )
    targets = [ModerationCase.profile_user_id == user.id]
    if photos:
        targets.append(ModerationCase.photo_id.in_([photo.id for photo in photos]))
    if await session.scalar(select(ModerationCase.id).where(or_(*targets)).limit(1)) is not None:
        raise AppError(
            409, "ACCOUNT_HAS_RELATED_DATA", "Удаление записей модерации требует отдельного порядка"
        )
    keys = [photo.storage_key for photo in photos]
    await queue_deletions(session, keys)
    await session.execute(delete(ProfileInterest).where(ProfileInterest.user_id == user.id))
    await session.execute(delete(Profile).where(Profile.user_id == user.id))
    await session.execute(delete(Photo).where(Photo.owner_id == user.id))
    await session.execute(delete(AuthSession).where(AuthSession.user_id == user.id))
    await session.execute(
        delete(BotBinding).where(
            or_(BotBinding.user_id == user.id, BotBinding.telegram_user_id == actor.telegram_id)
        )
    )
    await session.execute(
        delete(AnalyticsEvent).where(
            or_(AnalyticsEvent.actor_id == user.id, AnalyticsEvent.entity_id == user.id)
        )
    )
    await session.execute(
        delete(RateLimitWindow).where(
            RateLimitWindow.key_hash.in_(
                [
                    digest(f"login:{actor.telegram_id}"),
                    digest(f"photo:{user.id}"),
                ]
            )
        )
    )
    await session.execute(delete(User).where(User.id == user.id))
    await session.commit()
    return keys
