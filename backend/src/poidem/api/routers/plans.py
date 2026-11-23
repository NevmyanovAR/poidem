import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query, Request, Response

from poidem.api.errors import AppError
from poidem.api.routers.account import Authenticated, Session, WriteActor
from poidem.schemas.plan import PlanCommand, PlanEnvelope, PlanFields, PlanPage, PlanPatch, QuotaDTO
from poidem.services import plans


async def check_context(request: Request, actor: Authenticated) -> None:
    expected = request.headers.get("X-Account-Context")
    if expected is not None and expected != str(actor.user_id):
        raise AppError(
            409, "AUTH_CONTEXT_CHANGED", "Сессия другого аккаунта — открой Mini App заново"
        )


router = APIRouter(prefix="/api/v1", tags=["Планы"], dependencies=[Depends(check_context)])


@router.get("/me/quotas", response_model=QuotaDTO)
async def own_quota(actor: Authenticated, session: Session):
    await plans.require_active(session, actor)
    return await plans.quota(session, actor)


@router.get("/me/plans", response_model=PlanPage)
async def own_plans(
    actor: Authenticated,
    session: Session,
    cursor: str | None = Query(None, max_length=512),
    limit: int = Query(20, ge=1, le=50),
):
    return await plans.list_plans(session, actor, own=True, cursor=cursor, limit=limit)


@router.get("/plans", response_model=PlanPage)
async def catalogue(
    actor: Authenticated,
    session: Session,
    category: str | None = Query(None, max_length=40),
    cursor: str | None = Query(None, max_length=512),
    limit: int = Query(20, ge=1, le=50),
):
    return await plans.list_plans(session, actor, category=category, cursor=cursor, limit=limit)


@router.post("/plans", response_model=PlanEnvelope, status_code=201)
async def create_plan(
    payload: PlanFields,
    actor: WriteActor,
    session: Session,
    response: Response,
    key: Annotated[uuid.UUID, Header(alias="Idempotency-Key")],
):
    plan, created = await plans.create(session, actor, payload, key)
    response.status_code = 201 if created else 200
    return PlanEnvelope(plan=plan)


@router.get("/plans/{plan_id}", response_model=PlanEnvelope)
async def get_plan(plan_id: uuid.UUID, actor: Authenticated, session: Session):
    return PlanEnvelope(plan=await plans.get_plan(session, actor, plan_id))


@router.patch("/plans/{plan_id}", response_model=PlanEnvelope)
async def edit_plan(plan_id: uuid.UUID, payload: PlanPatch, actor: WriteActor, session: Session):
    return PlanEnvelope(plan=await plans.update(session, actor, plan_id, payload))


@router.post("/plans/{plan_id}/publish", response_model=PlanEnvelope)
async def publish_plan(
    plan_id: uuid.UUID, payload: PlanCommand, actor: WriteActor, session: Session
):
    return PlanEnvelope(plan=await plans.command(session, actor, plan_id, payload, "publish"))


@router.post("/plans/{plan_id}/cancel", response_model=PlanEnvelope)
async def cancel_plan(
    plan_id: uuid.UUID, payload: PlanCommand, actor: WriteActor, session: Session
):
    return PlanEnvelope(plan=await plans.command(session, actor, plan_id, payload, "cancel"))
