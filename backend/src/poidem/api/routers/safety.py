import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request, Response

from poidem.api.routers.account import Authenticated, Session, WriteActor
from poidem.api.routers.plans import check_context
from poidem.schemas.safety import AdminDecisionWrite, Reason, ReportWrite, SafetyContext, Target
from poidem.services import candidates, safety

router = APIRouter(prefix="/api/v1", tags=["Безопасность"], dependencies=[Depends(check_context)])


@router.post("/reports", status_code=201)
async def report(payload: ReportWrite, actor: WriteActor, session: Session, response: Response):
    result, created = await safety.submit_report(session, actor, payload)
    response.status_code = 201 if created else 200
    return result


@router.get("/reports/{report_id}")
async def own_report(report_id: uuid.UUID, actor: Authenticated, session: Session):
    return await safety.get_report(session, actor, report_id)


@router.post("/me/blocks")
async def block(payload: SafetyContext, actor: WriteActor, session: Session):
    return await safety.set_block(session, actor, payload)


@router.get("/me/blocks")
async def blocks(actor: Authenticated, session: Session):
    return await safety.list_blocks(session, actor)


@router.delete("/me/blocks/{block_id}", status_code=204)
async def unblock(block_id: uuid.UUID, actor: WriteActor, session: Session):
    await safety.unblock(session, actor, block_id)


@router.get("/admin/session")
async def admin_session(actor: Authenticated, session: Session):
    from poidem.services.admin_permissions import PERMISSIONS, require

    user = await require(session, actor)
    return {"role": user.role_code, "permissions": PERMISSIONS[user.role_code]}


@router.get("/admin/reports")
async def admin_reports(
    actor: Authenticated,
    session: Session,
    state: Literal["pending", "reviewed"] | None = None,
    target_type: Target | None = None,
    reason_code: Reason | None = None,
    user_id: uuid.UUID | None = None,
    plan_id: uuid.UUID | None = None,
    cursor: str | None = Query(None, max_length=512),
    limit: int = Query(20, ge=1, le=50),
):
    return await safety.admin_reports(
        session,
        actor,
        state=state,
        target_type=target_type,
        cursor=cursor,
        limit=limit,
        reason_code=reason_code,
        user_id=user_id,
        plan_id=plan_id,
    )


@router.get("/admin/reports/{report_id}")
async def admin_report(report_id: uuid.UUID, actor: Authenticated, session: Session):
    return await safety.admin_detail(session, actor, report_id)


@router.get("/admin/reports/{report_id}/photo")
async def report_photo(
    report_id: uuid.UUID, actor: Authenticated, session: Session, request: Request
):
    photo = await safety.admin_photo(session, actor, report_id)
    return Response(
        await candidates.photo_content(photo, request.app.state.settings), media_type="image/jpeg"
    )


@router.post("/admin/reports/{report_id}/decision")
async def decision(
    report_id: uuid.UUID,
    payload: AdminDecisionWrite,
    actor: WriteActor,
    session: Session,
    request: Request,
):
    request_id = getattr(request.state, "request_id", None)
    try:
        request_id = uuid.UUID(str(request_id))
    except (ValueError, TypeError):
        request_id = uuid.uuid4()
    return await safety.decide_report(session, actor, report_id, payload, request_id)
