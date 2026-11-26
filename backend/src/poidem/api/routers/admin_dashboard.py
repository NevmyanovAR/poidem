import uuid
from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from poidem.api.routers.account import Authenticated, Session, WriteActor
from poidem.api.routers.plans import check_context
from poidem.schemas.admin_dashboard import AnalyticsPeriod, PlanSort, UserSort
from poidem.services import (
    admin_analytics,
    admin_dashboard,
    admin_permissions,
    analytics_events,
    candidates,
    plans,
)

router = APIRouter(
    prefix="/api/v1", tags=["Административная аналитика"], dependencies=[Depends(check_context)]
)


def request_id(request):
    try:
        return uuid.UUID(str(request.state.request_id))
    except (ValueError, AttributeError):
        return uuid.uuid4()


async def snapshot(request, actor, period):
    # Та же БД/пул, отдельная последовательная read-транзакция: все агрегаты одного снимка.
    engine = request.app.state.database.engine.execution_options(isolation_level="REPEATABLE READ")
    async with AsyncSession(engine) as session:
        await admin_permissions.require(session, actor, "analytics")
        return await admin_analytics.analytics(session, period)


@router.get("/admin/analytics")
async def analytics(
    actor: Authenticated,
    session: Session,
    request: Request,
    period: Annotated[AnalyticsPeriod, Query()],
):
    await admin_permissions.require(session, actor, "analytics")
    result = await snapshot(request, actor, period)
    await admin_dashboard.audit(
        session,
        actor,
        "admin_analytics_read",
        "analytics:" + result["generated_at"],
        request_id(request),
    )
    return result


@router.post("/admin/analytics/export")
async def export(period: AnalyticsPeriod, actor: WriteActor, session: Session, request: Request):
    await admin_permissions.require(session, actor, "analytics", write=True)
    result = await snapshot(request, actor, period)
    await admin_dashboard.audit(
        session,
        actor,
        "admin_analytics_export",
        "analytics:" + result["generated_at"],
        request_id(request),
    )
    return {
        "report": result,
        "csv": admin_analytics.csv_report(result),
        "filename": f"poidem-{period.start_date}-{period.end_date}.csv",
    }


@router.get("/admin/users")
async def users(
    actor: Authenticated,
    session: Session,
    q: str = Query("", max_length=100),
    state: Literal["active", "blocked"] | None = None,
    since: date | None = None,
    until: date | None = None,
    sort: UserSort = "created",
    direction: Literal["asc", "desc"] = "desc",
    cursor: str | None = Query(None, max_length=512),
    limit: int = Query(25, ge=1, le=50),
):
    return await admin_dashboard.users(
        session,
        actor,
        q=q,
        state=state,
        since=since,
        until=until,
        sort=sort,
        direction=direction,
        cursor=cursor,
        limit=limit,
    )


@router.get("/admin/users/{identity}")
async def user_detail(
    identity: uuid.UUID, actor: Authenticated, session: Session, request: Request
):
    result = await admin_dashboard.user_detail(session, actor, identity)
    await admin_dashboard.audit(
        session, actor, "admin_user_read", f"user:{identity}", request_id(request)
    )
    return result


@router.get("/admin/plans")
async def plan_list(
    actor: Authenticated,
    session: Session,
    q: str = Query("", max_length=100),
    state: Literal["draft", "submitted", "published", "closed", "cancelled"] | None = None,
    author: str = Query("", max_length=100),
    category: str | None = Query(None, max_length=40),
    moderation: Literal["not_submitted", "pending", "approved", "rejected", "blocked"]
    | None = None,
    has_reports: bool | None = None,
    since: date | None = None,
    until: date | None = None,
    sort: PlanSort = "created",
    direction: Literal["asc", "desc"] = "desc",
    cursor: str | None = Query(None, max_length=512),
    limit: int = Query(25, ge=1, le=50),
):
    return await admin_dashboard.plans(
        session,
        actor,
        q=q,
        state=state,
        category=category,
        author=author,
        moderation=moderation,
        has_reports=has_reports,
        since=since,
        until=until,
        sort=sort,
        direction=direction,
        cursor=cursor,
        limit=limit,
    )


@router.get("/admin/plans/{identity}")
async def plan_detail(
    identity: uuid.UUID, actor: Authenticated, session: Session, request: Request
):
    result = await admin_dashboard.plan_detail(session, actor, identity)
    await admin_dashboard.audit(
        session, actor, "admin_plan_read", f"plan:{identity}", request_id(request)
    )
    return result


@router.get("/admin/system")
async def system(actor: Authenticated, session: Session):
    return await admin_dashboard.system(session, actor)


@router.post("/plans/{identity}/view")
async def view(identity: uuid.UUID, actor: WriteActor, session: Session):
    plan = await plans.get_plan(session, actor, identity)
    # Доступность живой анкеты проверяется тем же сервисом, что использует People.
    await candidates.plan_author(session, actor, identity)
    if plan.own or plan.publication_status != "published":
        return {"recorded": False}
    await analytics_events.record(session, analytics_events.VIEW, actor.user_id, identity)
    await session.commit()
    return {"recorded": True}
