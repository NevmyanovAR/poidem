import uuid

from sqlalchemy import func, or_, select

from poidem.api.errors import AppError
from poidem.db.models import AdminAuditLog, Profile, User
from poidem.services import admin_permissions
from poidem.services.admin_dashboard import literal_search, page


async def members(session, actor, *, q="", role=None, cursor=None, limit=25):
    await admin_permissions.require(session, actor, "team")
    query = select(
        User.id, Profile.name, User.role_code, User.version, User.account_status, User.created_at
    ).outerjoin(Profile, Profile.user_id == User.id)
    if q:
        try:
            identity = uuid.UUID(q)
        except ValueError:
            identity = None
        query = query.where(
            or_(literal_search(Profile.name, q), User.id == identity if identity else False)
        )
    if role:
        query = query.where(User.role_code == role)
    rows, total, following = await page(
        session,
        query,
        {"created": User.created_at},
        actor=actor,
        kind="users",
        filters={"sort": "created", "direction": "desc", "scope": "team", "q": q, "role": role},
        cursor=cursor,
        limit=limit,
    )
    return {
        "items": [
            {
                "id": r[0],
                "name": r[1],
                "role": r[2],
                "version": r[3],
                "state": r[4],
                "created_at": r[5],
            }
            for r in rows
        ],
        "total": total,
        "next_cursor": following,
    }


async def change(session, actor, identity, payload, request_id):
    # До любых row locks: два owner не могут взаимно снять друг друга одновременно.
    await admin_permissions.team_lock(session)
    await admin_permissions.require(session, actor, "team", write=True)
    if payload.confirm_user_id != identity:
        raise AppError(422, "ROLE_CONFIRMATION_REQUIRED", "Подтверди выбранного сотрудника")
    target = await session.scalar(
        select(User)
        .where(User.id == identity)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if not target or target.account_status != "active":
        raise AppError(404, "TEAM_USER_NOT_FOUND", "Нужен существующий активный пользователь")
    if target.role_code == payload.role:
        return {
            "id": target.id,
            "role": target.role_code,
            "version": target.version,
            "changed": False,
        }
    if target.version != payload.version:
        raise AppError(409, "VERSION_CONFLICT", "Права изменились — обнови список сотрудников")
    if target.role_code == "owner" and payload.role != "owner":
        owners = await session.scalar(
            select(func.count())
            .select_from(User)
            .where(User.role_code == "owner", User.account_status == "active")
        )
        if owners <= 1:
            raise AppError(409, "LAST_OWNER", "Нельзя отозвать права последнего владельца")
    previous = target.role_code
    target.role_code = payload.role
    target.version += 1
    session.add(
        AdminAuditLog(
            actor_id=actor.user_id,
            action="team_role_change",
            target_ref=f"user:{identity}",
            old_status=previous,
            new_status=payload.role,
            object_version=target.version,
            reason_code=payload.reason.strip(),
            request_id=request_id,
        )
    )
    await session.commit()
    return {"id": target.id, "role": target.role_code, "version": target.version, "changed": True}
