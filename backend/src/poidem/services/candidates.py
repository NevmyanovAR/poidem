"""Публичные поля анкеты выдаются только из разрешённого контекста знакомства."""

import anyio
from sqlalchemy import select

from poidem.api.errors import AppError
from poidem.db.models import Interest, Photo, Profile, ProfileInterest, User
from poidem.schemas.connections import PublicPhotoDTO, PublicProfileDTO
from poidem.services import media, plans


def not_found() -> AppError:
    return AppError(404, "CANDIDATE_NOT_FOUND", "Эта анкета недоступна")


async def public_profile(session, user_id, photo_url: str) -> tuple[PublicProfileDTO, Photo]:
    row = (
        await session.execute(
            select(Profile, Photo)
            .join(User, User.id == Profile.user_id)
            .join(Photo, (Photo.id == Profile.photo_id) & (Photo.owner_id == Profile.user_id))
            .where(
                Profile.user_id == user_id,
                User.account_status == "active",
                Profile.moderation_status.in_(plans.VISIBLE_MODERATION),
                Photo.processing_status == "ready",
                Photo.moderation_status.in_(plans.VISIBLE_MODERATION),
            )
        )
    ).first()
    if row is None:
        raise not_found()
    profile, photo = row
    interests = (
        await session.scalars(
            select(Interest.title)
            .join(ProfileInterest, ProfileInterest.interest_code == Interest.code)
            .where(ProfileInterest.user_id == user_id)
            .order_by(ProfileInterest.position)
        )
    ).all()
    return PublicProfileDTO(
        name=profile.name,
        age=profile.age,
        bio=profile.bio,
        interests=list(interests),
        photo=PublicPhotoDTO(url=photo_url),
    ), photo


async def plan_author(session, actor, plan_id):
    plan = await plans.get_plan(session, actor, plan_id)
    return await public_profile(session, plan.author.id, f"/api/v1/plans/{plan_id}/author/photo")


async def photo_content(photo: Photo, settings) -> bytes:
    try:
        return await anyio.to_thread.run_sync(
            lambda: media.media_path(settings, photo.storage_key).read_bytes()
        )
    except OSError:
        raise not_found() from None
