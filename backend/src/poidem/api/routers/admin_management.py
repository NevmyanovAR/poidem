import uuid
from typing import Annotated, Literal

import anyio
from fastapi import APIRouter, Depends, File, Query, Request, Response, UploadFile

from poidem.api.errors import AppError
from poidem.api.routers.account import Authenticated, Session, WriteActor
from poidem.api.routers.admin_dashboard import request_id
from poidem.api.routers.plans import check_context
from poidem.schemas.admin_management import (
    EditorialCommand,
    EditorialCreate,
    EditorialEdit,
    Role,
    RoleWrite,
)
from poidem.services import admin_system, admin_team, editorial, media
from poidem.services.rate_limit import rate_limit

router = APIRouter(
    prefix="/api/v1/admin", tags=["Управление"], dependencies=[Depends(check_context)]
)
public_router = APIRouter(prefix="/api/v1/inspiration", tags=["Редакционные идеи"])


@router.get("/notifications")
async def jobs(
    actor: Authenticated,
    session: Session,
    category: Literal["sent", "pending", "retry", "suppressed", "failed", "unknown"] | None = None,
    offset: int = Query(0, ge=0, le=1_000_000),
    limit: int = Query(25, ge=1, le=50),
):
    return await admin_system.jobs(session, actor, category=category, offset=offset, limit=limit)


@router.get("/audit")
async def audit(
    actor: Authenticated,
    session: Session,
    kind: Literal["changes", "reads", "all"] = "changes",
    user: uuid.UUID | None = None,
    plan: uuid.UUID | None = None,
    offset: int = Query(0, ge=0, le=1_000_000),
    limit: int = Query(25, ge=1, le=50),
):
    return await admin_system.audit_page(
        session, actor, kind=kind, user=user, plan=plan, offset=offset, limit=limit
    )


@router.get("/team")
async def team(
    actor: Authenticated,
    session: Session,
    q: str = Query("", max_length=100),
    role: Role | None = None,
    cursor: str | None = Query(None, max_length=512),
    limit: int = Query(25, ge=1, le=50),
):
    return await admin_team.members(session, actor, q=q, role=role, cursor=cursor, limit=limit)


@router.put("/team/{identity}/role")
async def role(
    identity: uuid.UUID, payload: RoleWrite, actor: WriteActor, session: Session, request: Request
):
    return await admin_team.change(session, actor, identity, payload, request_id(request))


@router.get("/inspiration")
async def ideas(
    actor: Authenticated,
    session: Session,
    q: str = Query("", max_length=100),
    state: Literal["draft", "published"] | None = None,
    offset: int = Query(0, ge=0, le=1_000_000),
    limit: int = Query(25, ge=1, le=50),
):
    return await editorial.listing(session, actor, q=q, state=state, offset=offset, limit=limit)


@router.post("/inspiration", status_code=201)
async def create(payload: EditorialCreate, actor: WriteActor, session: Session, request: Request):
    return await editorial.create(session, actor, payload, request_id(request))


@router.put("/inspiration/{identity}")
async def edit(
    identity: str, payload: EditorialEdit, actor: WriteActor, session: Session, request: Request
):
    return await editorial.edit(session, actor, identity, payload, request_id(request))


@router.post("/inspiration/{identity}/command")
async def command(
    identity: str, payload: EditorialCommand, actor: WriteActor, session: Session, request: Request
):
    return await editorial.command(session, actor, identity, payload, request_id(request))


@router.post("/inspiration/{identity}/photo")
async def upload(
    identity: str,
    version: int,
    request: Request,
    actor: WriteActor,
    session: Session,
    file: Annotated[UploadFile, File()],
):
    idea = await editorial.get(session, identity, actor=actor, write=True, version=version)
    await rate_limit(
        session, f"photo:{actor.user_id}", request.app.state.settings.photo_requests_per_minute
    )
    form = await request.form()
    if len(form.multi_items()) != 1:
        raise AppError(422, "VALIDATION_ERROR", "Передай одну фотографию")
    settings = request.app.state.settings
    try:
        content = await file.read(settings.photo_max_bytes + 1)
    finally:
        await file.close()
    async with request.app.state.photo_limiter:
        prepared = await anyio.to_thread.run_sync(
            lambda: media.prepare_photo(content, file.content_type or "", settings)
        )
    old_key = idea.image_key
    idea.image_key = await anyio.to_thread.run_sync(lambda: media.write_photo(settings, prepared))
    idea.static_image = None
    idea.version += 1
    from datetime import UTC, datetime

    idea.updated_at = datetime.now(UTC)
    editorial.audit(session, actor, idea, "editorial_photo", request_id(request))
    await media.queue_deletions(session, [old_key] if old_key else [])
    await session.commit()
    # Надёжное удаление отложено прежней media_deletions, не мешает успешному ответу.
    return editorial.dto(idea, admin=True)


async def photo(idea, request):
    if not idea.image_key:
        raise AppError(404, "PHOTO_NOT_FOUND", "Загруженная фотография не найдена")
    try:
        content = await anyio.to_thread.run_sync(
            lambda: media.media_path(request.app.state.settings, idea.image_key).read_bytes()
        )
    except OSError:
        raise AppError(404, "PHOTO_NOT_FOUND", "Фотография временно недоступна") from None
    return Response(
        content,
        media_type="image/jpeg",
        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
    )


@router.get("/inspiration/{identity}/photo")
async def preview_photo(identity: str, request: Request, actor: Authenticated, session: Session):
    return await photo(await editorial.get(session, identity, actor=actor), request)


@public_router.get("")
async def published(
    session: Session,
    offset: int = Query(0, ge=0, le=1_000_000),
    limit: int = Query(25, ge=1, le=50),
):
    return await editorial.listing(session, offset=offset, limit=limit)


@public_router.get("/{identity}")
async def published_detail(identity: str, session: Session):
    return editorial.dto(await editorial.get(session, identity))


@public_router.get("/{identity}/photo")
async def published_photo(identity: str, request: Request, session: Session):
    return await photo(await editorial.get(session, identity), request)
