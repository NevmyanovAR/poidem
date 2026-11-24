import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request, Response

from poidem.api.routers.account import Authenticated, Session, WriteActor
from poidem.api.routers.plans import check_context
from poidem.schemas.activity import ActivityPage, HiddenCommand
from poidem.schemas.chat import ChatDTO, MessageCreate, MessageEnvelope, MessagePage, ReadCommand
from poidem.services import activity, archive, chat

router = APIRouter(
    prefix="/api/v1", tags=["Переписка и архив"], dependencies=[Depends(check_context)]
)


@router.get("/matches/{match_id}/chat", response_model=ChatDTO)
async def chat_state(match_id: uuid.UUID, actor: Authenticated, session: Session):
    return await chat.state(session, actor, match_id)


@router.get("/matches/{match_id}/messages", response_model=MessagePage)
async def history(
    match_id: uuid.UUID,
    actor: Authenticated,
    session: Session,
    before: int | None = Query(None, ge=1, le=9007199254740991),
    after: int | None = Query(None, ge=0, le=9007199254740991),
    limit: int = Query(30, ge=1, le=50),
):
    return await chat.messages(session, actor, match_id, before=before, after=after, limit=limit)


@router.post("/matches/{match_id}/messages", response_model=MessageEnvelope, status_code=201)
async def send_message(
    match_id: uuid.UUID,
    payload: MessageCreate,
    actor: WriteActor,
    session: Session,
    request: Request,
    response: Response,
):
    message, created = await chat.send(
        session, actor, match_id, payload, request.app.state.settings.chat_messages_per_minute
    )
    response.status_code = 201 if created else 200
    return MessageEnvelope(message=message)


@router.post("/matches/{match_id}/read", response_model=ChatDTO)
async def read(match_id: uuid.UUID, payload: ReadCommand, actor: WriteActor, session: Session):
    return await chat.mark_read(session, actor, match_id, payload)


@router.get("/me/activity", response_model=ActivityPage)
async def my_activity(
    actor: Authenticated,
    session: Session,
    scope: Literal["active", "archive"] = "active",
    include_hidden: bool = False,
    cursor: str | None = Query(None, max_length=512),
    limit: int = Query(20, ge=1, le=50),
):
    return await activity.listing(
        session, actor, scope=scope, include_hidden=include_hidden, cursor=cursor, limit=limit
    )


@router.post("/me/archive/{plan_id}/visibility", status_code=204)
async def archive_visibility(
    plan_id: uuid.UUID, payload: HiddenCommand, actor: WriteActor, session: Session
):
    await archive.set_hidden(session, actor, plan_id, payload.hidden)
