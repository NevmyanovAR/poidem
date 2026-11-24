import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header, Query, Request, Response

from poidem.api.routers.account import Authenticated, Session, WriteActor
from poidem.api.routers.plans import check_context
from poidem.schemas.connections import (
    CapacityDTO,
    ContactDTO,
    MatchEnvelope,
    MatchPage,
    PublicProfileEnvelope,
    ResponseCreate,
    ResponseDecision,
    ResponseEnvelope,
    ResponsePage,
)
from poidem.services import candidates, connections, plans

router = APIRouter(prefix="/api/v1", tags=["Знакомства"], dependencies=[Depends(check_context)])


@router.get("/plans/{plan_id}/author", response_model=PublicProfileEnvelope)
async def plan_author(plan_id: uuid.UUID, actor: Authenticated, session: Session):
    profile, _ = await candidates.plan_author(session, actor, plan_id)
    return PublicProfileEnvelope(profile=profile)


@router.get("/plans/{plan_id}/author/photo")
async def author_photo(
    plan_id: uuid.UUID, actor: Authenticated, session: Session, request: Request
):
    _, photo = await candidates.plan_author(session, actor, plan_id)
    content = await candidates.photo_content(photo, request.app.state.settings)
    return Response(content, media_type="image/jpeg")


@router.get("/plans/{plan_id}/capacity", response_model=CapacityDTO)
async def capacity(plan_id: uuid.UUID, actor: Authenticated, session: Session):
    return await connections.capacity(session, actor, plan_id)


@router.post("/plans/{plan_id}/responses", response_model=ResponseEnvelope, status_code=201)
async def respond(
    plan_id: uuid.UUID,
    payload: ResponseCreate,
    actor: WriteActor,
    session: Session,
    response: Response,
    key: Annotated[uuid.UUID, Header(alias="Idempotency-Key")],
):
    entry, created = await connections.send(session, actor, plan_id, payload, key)
    response.status_code = 201 if created else 200
    return ResponseEnvelope(response=entry)


@router.get("/plans/{plan_id}/responses", response_model=ResponsePage)
async def incoming_for_plan(
    plan_id: uuid.UUID,
    actor: Authenticated,
    session: Session,
    cursor: str | None = Query(None, max_length=512),
    limit: int = Query(20, ge=1, le=50),
):
    return await connections.list_responses(
        session, actor, incoming=True, plan_id=plan_id, cursor=cursor, limit=limit
    )


@router.get("/me/responses", response_model=ResponsePage)
async def own_responses(
    actor: Authenticated,
    session: Session,
    direction: Literal["incoming", "outgoing"] = "incoming",
    cursor: str | None = Query(None, max_length=512),
    limit: int = Query(20, ge=1, le=50),
):
    return await connections.list_responses(
        session, actor, incoming=direction == "incoming", cursor=cursor, limit=limit
    )


@router.get("/responses/{response_id}", response_model=ResponseEnvelope)
async def get_response(response_id: uuid.UUID, actor: Authenticated, session: Session):
    await plans.require_active(session, actor)
    entry = await connections.response_record(session, actor, response_id)
    return ResponseEnvelope(response=await connections.response_dto(session, actor, entry))


@router.post("/responses/{response_id}/decision", response_model=ResponseEnvelope)
async def decide(
    response_id: uuid.UUID, payload: ResponseDecision, actor: WriteActor, session: Session
):
    return ResponseEnvelope(response=await connections.decide(session, actor, response_id, payload))


@router.get("/responses/{response_id}/profile/photo")
async def response_photo(
    response_id: uuid.UUID, actor: Authenticated, session: Session, request: Request
):
    entry = await connections.response_record(session, actor, response_id)
    _, photo = await connections.response_profile(session, actor, entry)
    return Response(
        await candidates.photo_content(photo, request.app.state.settings), media_type="image/jpeg"
    )


@router.get("/me/matches", response_model=MatchPage)
async def matches(
    actor: Authenticated,
    session: Session,
    cursor: str | None = Query(None, max_length=512),
    limit: int = Query(20, ge=1, le=50),
):
    return await connections.list_matches(session, actor, cursor=cursor, limit=limit)


@router.get("/matches/{match_id}", response_model=MatchEnvelope)
async def get_match(match_id: uuid.UUID, actor: Authenticated, session: Session):
    entry = await connections.match_record(session, actor, match_id)
    return MatchEnvelope(match=await connections.match_dto(session, actor, entry))


@router.get("/matches/{match_id}/contact", response_model=ContactDTO)
async def match_contact(match_id: uuid.UUID, actor: Authenticated, session: Session):
    return await connections.contact(session, actor, match_id)


@router.get("/matches/{match_id}/photo/{role}")
async def match_photo(
    match_id: uuid.UUID,
    role: Literal["author", "responder"],
    actor: Authenticated,
    session: Session,
    request: Request,
):
    _, photo = await connections.match_photo(session, actor, match_id, role)
    return Response(
        await candidates.photo_content(photo, request.app.state.settings), media_type="image/jpeg"
    )
