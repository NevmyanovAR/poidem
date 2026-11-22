from typing import Annotated

import anyio
from fastapi import APIRouter, Depends, File, Request, Response, UploadFile
from fastapi.responses import JSONResponse
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from poidem.api.errors import AppError
from poidem.db.models import AuthSession, Photo, Profile, User
from poidem.db.session import get_session
from poidem.schemas.profile import PhotoDTO, ProfileEnvelope, ProfileWrite, TelegramLogin
from poidem.security.session import (
    Principal,
    lock_actor,
    require_origin,
    require_session,
    require_write,
)
from poidem.services import auth, media, profiles
from poidem.services.rate_limit import rate_limit

router = APIRouter(prefix="/api/v1", tags=["Мой аккаунт"])
Session = Annotated[AsyncSession, Depends(get_session)]
Authenticated = Annotated[Principal, Depends(require_session)]
WriteActor = Annotated[Principal, Depends(require_write)]


def clear_cookie(request: Request, response: Response) -> None:
    settings = request.app.state.settings
    response.delete_cookie(
        settings.cookie_name,
        path="/",
        secure=settings.secure_cookie,
        httponly=True,
        samesite=settings.session_cookie_samesite,
    )


@router.post("/auth/telegram")
async def telegram_login(
    payload: TelegramLogin, request: Request, response: Response, session: Session
):
    require_origin(request)
    settings = request.app.state.settings
    user, entry, token = await auth.login(
        session, payload.init_data, settings, request.cookies.get(settings.cookie_name, "")
    )
    profile = await profiles.get_profile(session, user.id)
    await session.commit()
    response.set_cookie(
        settings.cookie_name,
        token,
        max_age=settings.session_ttl_seconds,
        httponly=True,
        secure=settings.secure_cookie,
        samesite=settings.session_cookie_samesite,
        path="/",
    )
    return {
        "user": {"id": str(user.id), "account_status": user.account_status},
        "authorization": {
            "method": "telegram_init_data",
            "verified_at": entry.authenticated_at.isoformat(),
        },
        "session_expires_at": entry.expires_at.isoformat(),
        "csrf_token": entry.csrf_token,
        "profile": profile.model_dump(mode="json") if profile else None,
    }


@router.get("/me")
async def me(actor: Authenticated, session: Session):
    user = await session.get(User, actor.user_id)
    profile = await profiles.get_profile(session, actor.user_id)
    return {
        "user": {"id": str(user.id), "account_status": user.account_status},
        "authorization": {
            "method": "telegram_init_data",
            "verified_at": actor.authenticated_at.isoformat(),
        },
        "csrf_token": actor.csrf_token,
        "profile": profile.model_dump(mode="json") if profile else None,
    }


@router.get("/auth/csrf")
async def csrf(actor: Authenticated):
    return {"csrf_token": actor.csrf_token, "user_id": str(actor.user_id)}


@router.post("/auth/logout", status_code=204)
async def logout(actor: WriteActor, request: Request, session: Session):
    await lock_actor(session, actor, active=False)
    await session.execute(delete(AuthSession).where(AuthSession.id == actor.session_id))
    await session.commit()
    response = Response(status_code=204)
    clear_cookie(request, response)
    return response


@router.get("/me/profile", response_model=ProfileEnvelope)
async def own_profile(actor: Authenticated, session: Session):
    return ProfileEnvelope(profile=await profiles.get_profile(session, actor.user_id))


@router.put("/me/profile", response_model=ProfileEnvelope)
async def put_profile(payload: ProfileWrite, actor: WriteActor, request: Request, session: Session):
    result, keys = await profiles.save_profile(session, actor, payload)
    await media.try_drain_deletions(request.app.state.database, request.app.state.settings, keys)
    return ProfileEnvelope(profile=result)


@router.post("/me/photos", response_model=PhotoDTO, status_code=201)
async def upload_photo(
    request: Request, actor: WriteActor, session: Session, file: Annotated[UploadFile, File()]
):
    form = await request.form()
    if len(form.multi_items()) != 1:
        raise AppError(422, "VALIDATION_ERROR", "Передай одну фотографию без дополнительных полей")
    settings = request.app.state.settings
    try:
        content = await file.read(settings.photo_max_bytes + 1)
    finally:
        await file.close()
    await lock_actor(session, actor)
    await rate_limit(session, f"photo:{actor.user_id}", settings.photo_requests_per_minute)
    async with request.app.state.photo_limiter:
        prepared = await anyio.to_thread.run_sync(
            lambda: media.prepare_photo(content, file.content_type or "", settings)
        )
    profile = await session.get(Profile, actor.user_id)
    unused_query = select(Photo).where(Photo.owner_id == actor.user_id)
    if profile:
        unused_query = unused_query.where(Photo.id != profile.photo_id)
    unused = (await session.scalars(unused_query)).all()
    keys = [entry.storage_key for entry in unused]
    await media.queue_deletions(session, keys)
    for entry in unused:
        await session.delete(entry)
    key = await anyio.to_thread.run_sync(lambda: media.write_photo(settings, prepared))
    try:
        photo = Photo(
            owner_id=actor.user_id,
            storage_key=key,
            media_type="image/jpeg",
            byte_size=len(prepared.content),
            width=prepared.width,
            height=prepared.height,
            processing_status="ready",
        )
        session.add(photo)
        await session.flush()
        result = profiles.photo_dto(photo)
        await session.commit()
    except Exception:
        # Исход commit при потере соединения неизвестен. Файл не удаляется вслепую:
        # orphan scan проверит отсутствие metadata перед последующей очисткой.
        await session.rollback()
        raise
    await media.try_drain_deletions(request.app.state.database, settings, keys)
    return result


@router.get("/media/photos/{photo_id}")
async def photo_bytes(photo_id: str, actor: Authenticated, request: Request, session: Session):
    import uuid

    try:
        identity = uuid.UUID(photo_id)
    except ValueError:
        raise AppError(404, "RESOURCE_NOT_FOUND", "Фотография не найдена") from None
    photo = await session.get(Photo, identity)
    # Выдача кандидатам добавится после согласованного API планов/мэтчей.
    if not photo or photo.owner_id != actor.user_id:
        raise AppError(404, "RESOURCE_NOT_FOUND", "Фотография не найдена")
    try:
        content = await anyio.to_thread.run_sync(
            lambda: media.media_path(request.app.state.settings, photo.storage_key).read_bytes()
        )
    except OSError:
        raise AppError(404, "RESOURCE_NOT_FOUND", "Фотография не найдена") from None
    return Response(content, media_type="image/jpeg")


@router.delete("/me")
@router.delete("/me/profile")
async def remove_account(actor: WriteActor, request: Request, session: Session):
    keys = await profiles.delete_account(session, actor)
    complete = await media.try_drain_deletions(
        request.app.state.database, request.app.state.settings, keys
    )
    response = JSONResponse(
        {"deleted": True, "media_cleanup_pending": not complete},
        status_code=200 if complete else 202,
    )
    clear_cookie(request, response)
    return response
