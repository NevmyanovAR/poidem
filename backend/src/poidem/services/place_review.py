"""Optional review of the exact current plan address; no publication gate."""

from sqlalchemy import func, select

from poidem.api.errors import AppError
from poidem.db.models import AdminAuditLog, Plan, Profile
from poidem.services import admin_permissions, plans


def dto(plan, name):
    return {
        "id": plan.id,
        "plan_id": plan.id,
        "plan_title": plan.title,
        "author_name": name,
        "name": plan.place_name,
        "address": plan.place_address,
        "legacy_place": plan.place,
        "status": plan.place_check_status,
        "revision": plan.place_revision,
        "version": plan.place_review_version,
        "reason": plan.place_check_reason,
        "checked_at": plan.place_checked_at,
        "publication_status": plan.publication_status,
    }


async def listing(session, actor, state, offset, limit, request_id):
    await admin_permissions.require(session, actor, "moderation")
    query = (
        select(Plan, Profile.name)
        .join(Profile, Profile.user_id == Plan.author_id)
        .where(Plan.publication_status.in_(("published", "closed")))
    )
    if state:
        query = query.where(Plan.place_check_status == state)
    total = await session.scalar(select(func.count()).select_from(query.subquery()))
    rows = (
        await session.execute(
            query.order_by(Plan.created_at.desc(), Plan.id).offset(offset).limit(limit)
        )
    ).all()
    session.add(
        AdminAuditLog(
            actor_id=actor.user_id,
            action="place_check_list",
            target_ref="plans:places",
            reason_code="place_check_read",
            request_id=request_id,
        )
    )
    await session.commit()
    return {
        "items": [dto(p, name) for p, name in rows],
        "total": total,
        "next_offset": offset + limit if offset + limit < total else None,
    }


async def decide(session, actor, identity, payload, request_id):
    await admin_permissions.require(session, actor, "moderation", write=True)
    plan = await session.scalar(select(Plan).where(Plan.id == identity).with_for_update())
    if not plan or plan.publication_status not in ("published", "closed"):
        raise AppError(404, "PLACE_CHECK_NOT_FOUND", "План недоступен для проверки места")
    if (plan.place_revision, plan.place_review_version) != (
        payload.expected_revision,
        payload.expected_version,
    ):
        raise AppError(
            409, "PLACE_CHECK_CONFLICT", "Сведения или решение уже изменились — обнови очередь"
        )
    if payload.decision == "confirmed" and not payload.evidence_confirmed:
        raise AppError(
            422, "PLACE_CHECK_EVIDENCE", "Подтверди, что название и адрес сверены по источникам"
        )
    previous = plan.place_check_status
    plan.place_check_status = payload.decision
    plan.place_checked_revision = plan.place_revision
    plan.place_review_version += 1
    plan.place_checked_by = actor.user_id
    plan.place_checked_at = plans.now()
    plan.place_check_reason = payload.reason
    session.add(
        AdminAuditLog(
            actor_id=actor.user_id,
            action="place_check_decision",
            target_ref=f"plan:{plan.id}:place:{plan.place_revision}",
            object_version=plan.place_review_version,
            old_status=previous,
            new_status=payload.decision,
            reason_code=payload.reason,
            request_id=request_id,
        )
    )
    name = await session.scalar(select(Profile.name).where(Profile.user_id == plan.author_id))
    result = dto(plan, name)
    await session.commit()
    return result
