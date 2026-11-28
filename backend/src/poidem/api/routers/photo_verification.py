import uuid
from typing import Literal

import anyio
from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy import select

from poidem.api.errors import AppError
from poidem.api.routers.account import Authenticated, Session, WriteActor
from poidem.api.routers.plans import check_context
from poidem.db.models import AdminAuditLog, PhotoVerification, Profile
from poidem.schemas.verification import (
    VerificationConsent,
    VerificationDecision,
    VerificationWithdrawal,
)
from poidem.services import admin_permissions, media
from poidem.services import photo_verification as service
from poidem.services.rate_limit import rate_limit

router = APIRouter(
    prefix="/api/v1", tags=["Подтверждение фото"], dependencies=[Depends(check_context)]
)


@router.get("/me/photo-verification")
async def status(actor: Authenticated, session: Session, request: Request):
    return await service.status(session, actor, request.app.state.settings)


@router.post("/me/photo-verification/challenge")
async def challenge(
    payload: VerificationConsent, actor: WriteActor, session: Session, request: Request
):
    return await service.challenge(session, actor, payload, request.app.state.settings)


@router.post(
    "/me/photo-verification/{identity}/selfie",
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {
                "multipart/form-data": {
                    "schema": {
                        "type": "object",
                        "required": ["file"],
                        "additionalProperties": False,
                        "properties": {"file": {"type": "string", "format": "binary"}},
                    }
                }
            },
        }
    },
)
async def submit(identity: uuid.UUID, request: Request, actor: WriteActor, session: Session):
    # Ручной multipart после проверки сессии/владельца/политики: выключенный сбор
    # не должен создавать SpooledTemporaryFile при разборе большого UploadFile.
    from starlette.datastructures import UploadFile as IncomingFile

    settings = request.app.state.settings
    service.require_enabled(settings)
    await service.own_entry(session, actor, identity)
    await rate_limit(session, f"verification-photo:{actor.user_id}", 6)
    await session.commit()
    async with request.form(max_files=1, max_fields=5) as form:
        file = form.get("file")
        if len(form.multi_items()) != 1 or not isinstance(file, IncomingFile):
            raise AppError(422, "VALIDATION_ERROR", "Отправь только проверочный снимок")
        content = await file.read(settings.photo_max_bytes + 1)
        async with request.app.state.photo_limiter:
            prepared = await anyio.to_thread.run_sync(
                lambda: media.prepare_photo(content, file.content_type or "", settings)
            )
    return await service.submit(session, actor, identity, prepared, settings)


@router.post("/me/photo-verification/{identity}/withdraw")
async def withdraw(
    identity: uuid.UUID,
    payload: VerificationWithdrawal,
    actor: WriteActor,
    session: Session,
    request: Request,
):
    result = await service.withdraw(session, actor, identity, payload.expected_version)
    return result


async def image(entry, kind, request):
    if entry.state == "pending" and entry.expires_at <= service.now() or entry.consent_revoked_at:
        raise AppError(404, "PHOTO_UNAVAILABLE", "Снимок больше недоступен")
    if entry.purge_at and entry.purge_at <= service.now():
        raise AppError(404, "PHOTO_UNAVAILABLE", "Срок хранения снимка завершён")
    key = entry.selfie_key if kind == "selfie" else entry.primary_key
    if not key:
        raise AppError(404, "PHOTO_UNAVAILABLE", "Проверочные материалы уже удалены")
    try:
        content = await anyio.to_thread.run_sync(
            lambda: media.media_path(request.app.state.settings, key).read_bytes()
        )
    except OSError:
        raise AppError(404, "PHOTO_UNAVAILABLE", "Снимок недоступен") from None
    return Response(
        content,
        media_type="image/jpeg",
        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
    )


@router.get("/me/photo-verification/{identity}/selfie")
async def own_image(identity: uuid.UUID, actor: Authenticated, session: Session, request: Request):
    entry = await service.own_entry(session, actor, identity)
    if entry.state != "pending":
        raise AppError(404, "PHOTO_UNAVAILABLE", "Снимок недоступен")
    return await image(entry, "selfie", request)


@router.get("/admin/photo-verifications")
async def queue(
    actor: Authenticated,
    session: Session,
    state: Literal["pending", "approved", "rejected"] = "pending",
    offset: int = Query(0, ge=0, le=100000),
    limit: int = Query(20, ge=1, le=50),
):
    await admin_permissions.require(session, actor, "moderation")
    query = (
        select(PhotoVerification, Profile.name)
        .outerjoin(Profile, Profile.user_id == PhotoVerification.user_id)
        .where(PhotoVerification.state == state, PhotoVerification.submitted_at.is_not(None))
    )
    if state == "pending":
        query = query.where(PhotoVerification.expires_at > service.now())
    rows = (
        await session.execute(
            query.order_by(PhotoVerification.submitted_at, PhotoVerification.id)
            .offset(offset)
            .limit(limit + 1)
        )
    ).all()
    return {
        "items": [
            {
                **service.dto(entry),
                "user_name": name or "Анкета недоступна",
                "waiting_minutes": max(
                    0, int((service.now() - entry.submitted_at).total_seconds() // 60)
                ),
            }
            for entry, name in rows[:limit]
        ],
        "next_offset": offset + limit if len(rows) > limit else None,
    }


async def admin_entry(session, actor, identity):
    await admin_permissions.require(session, actor, "moderation", write=True)
    entry = await session.scalar(
        select(PhotoVerification).where(PhotoVerification.id == identity).with_for_update()
    )
    if not entry or not entry.submitted_at:
        raise AppError(404, "VERIFICATION_NOT_FOUND", "Заявка не найдена")
    await service.expire(session, entry)
    return entry


@router.get("/admin/photo-verifications/{identity}")
async def detail(identity: uuid.UUID, actor: Authenticated, session: Session, request: Request):
    entry = await admin_entry(session, actor, identity)
    name = await session.scalar(select(Profile.name).where(Profile.user_id == entry.user_id))
    available = (
        entry.primary_key
        and entry.selfie_key
        and not entry.consent_revoked_at
        and (not entry.purge_at or entry.purge_at > service.now())
    )
    result = {
        **service.dto(entry),
        "user_name": name or "Анкета недоступна",
        "primary_url": f"/api/v1/admin/photo-verifications/{entry.id}/photo/primary"
        if available
        else None,
        "selfie_url": f"/api/v1/admin/photo-verifications/{entry.id}/photo/selfie"
        if available
        else None,
        "can_decide": bool(
            entry.state == "pending" and entry.user_id != actor.user_id and available
        ),
    }
    session.add(
        AdminAuditLog(
            actor_id=actor.user_id,
            action="photo_verification.read",
            target_ref=f"photo_verification:{entry.id}",
            reason_code="verification_context",
            request_id=uuid.UUID(request.state.request_id),
        )
    )
    await session.commit()
    return result


@router.get("/admin/photo-verifications/{identity}/photo/{kind}")
async def admin_image(
    identity: uuid.UUID,
    kind: Literal["primary", "selfie"],
    actor: Authenticated,
    session: Session,
    request: Request,
):
    entry = await admin_entry(session, actor, identity)
    result = await image(entry, kind, request)
    session.add(
        AdminAuditLog(
            actor_id=actor.user_id,
            action="photo_verification.photo_read",
            target_ref=f"photo_verification:{entry.id}",
            reason_code="verification_context",
            request_id=uuid.UUID(request.state.request_id),
        )
    )
    await session.commit()
    return result


@router.post("/admin/photo-verifications/{identity}/decision")
async def decision(
    identity: uuid.UUID,
    payload: VerificationDecision,
    actor: WriteActor,
    session: Session,
    request: Request,
):
    return await service.decide(
        session, actor, identity, payload, uuid.UUID(request.state.request_id)
    )
