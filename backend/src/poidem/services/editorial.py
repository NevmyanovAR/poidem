from datetime import UTC, datetime

from sqlalchemy import func, select

from poidem.api.errors import AppError
from poidem.db.models import AdminAuditLog, Category, EditorialIdea
from poidem.services import admin_permissions, media
from poidem.services.admin_dashboard import literal_search


def dto(idea, *, admin=False):
    image = idea.static_image
    if idea.image_key:
        prefix = "/admin" if admin else ""
        image = f"/api/v1{prefix}/inspiration/{idea.id}/photo?v={idea.version}"
    return {
        key: getattr(idea, key)
        for key in (
            "id",
            "title",
            "subtitle",
            "category_code",
            "place",
            "plan_title",
            "tag",
            "state",
            "sort_order",
            "version",
            "created_at",
            "updated_at",
        )
    } | {"image": image}


async def listing(session, actor=None, *, q="", state=None, offset=0, limit=25):
    if actor:
        await admin_permissions.require(session, actor, "editorial")
    query = select(EditorialIdea)
    if not actor:
        query = query.where(EditorialIdea.state == "published")
    elif state:
        query = query.where(EditorialIdea.state == state)
    if q:
        query = query.where(literal_search(EditorialIdea.title, q))
    total = await session.scalar(select(func.count()).select_from(query.subquery()))
    ideas = (
        await session.scalars(
            query.order_by(EditorialIdea.sort_order, EditorialIdea.id).offset(offset).limit(limit)
        )
    ).all()
    return {
        "items": [dto(idea, admin=bool(actor)) for idea in ideas],
        "total": total,
        "next_offset": offset + limit if offset + limit < total else None,
    }


async def get(session, identity, *, actor=None, write=False, version=None):
    if actor:
        await admin_permissions.require(session, actor, "editorial", write=write)
    query = select(EditorialIdea).where(EditorialIdea.id == identity)
    if not actor:
        query = query.where(EditorialIdea.state == "published")
    if write:
        query = query.with_for_update()
    idea = await session.scalar(query.execution_options(populate_existing=True))
    if not idea:
        raise AppError(404, "IDEA_NOT_FOUND", "Идея больше не опубликована или недоступна")
    if version is not None and idea.version != version:
        raise AppError(409, "VERSION_CONFLICT", "Идея изменилась — обнови её перед сохранением")
    return idea


async def category(session, code):
    if not await session.get(Category, code):
        raise AppError(422, "CATEGORY_UNKNOWN", "Выбери существующую категорию")


def audit(session, actor, idea, action, request_id, old=None):
    session.add(
        AdminAuditLog(
            actor_id=actor.user_id,
            action=action,
            target_ref=f"idea:{idea.id}",
            object_version=idea.version,
            old_status=old,
            new_status=idea.state,
            reason_code="D62-editorial-confirmed",
            request_id=request_id,
        )
    )


async def create(session, actor, payload, request_id):
    await admin_permissions.require(session, actor, "editorial", write=True)
    await category(session, payload.category_code)
    # Сериализация ID для повторных/параллельных созданий без IntegrityError в API.
    from sqlalchemy import text

    await session.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key,0))"),
        {"key": "editorial:" + payload.id},
    )
    if await session.get(EditorialIdea, payload.id):
        raise AppError(409, "IDEA_ID_EXISTS", "Этот адрес уже занят — открой существующую идею")
    idea = EditorialIdea(**payload.model_dump(), created_by=actor.user_id)
    session.add(idea)
    await session.flush()
    audit(session, actor, idea, "editorial_create", request_id)
    await session.commit()
    return dto(idea, admin=True)


async def edit(session, actor, identity, payload, request_id):
    idea = await get(session, identity, actor=actor, write=True, version=payload.version)
    await category(session, payload.category_code)
    for key, value in payload.model_dump(exclude={"version"}).items():
        setattr(idea, key, value)
    idea.version += 1
    idea.updated_at = datetime.now(UTC)
    audit(session, actor, idea, "editorial_edit", request_id)
    await session.commit()
    return dto(idea, admin=True)


async def command(session, actor, identity, payload, request_id):
    idea = await get(session, identity, actor=actor, write=True, version=payload.version)
    if payload.confirm_id != identity:
        raise AppError(422, "IDEA_CONFIRM_REQUIRED", "Подтверди выбранную идею")
    if payload.action == "publish" and (
        not idea.image_key and not idea.static_image or not idea.plan_title or not idea.place
    ):
        raise AppError(
            422, "IDEA_INCOMPLETE", "Для публикации нужны фото, название будущего плана и место"
        )
    old = idea.state
    idea.version += 1
    idea.updated_at = datetime.now(UTC)
    if payload.action == "delete":
        # На идеи нет FK из пользовательских планов: план хранит собственные поля.
        # FK RESTRICT сохраняет защиту, если связи появятся в следующем этапе.
        audit(session, actor, idea, "editorial_delete", request_id, old)
        await media.queue_deletions(session, [idea.image_key] if idea.image_key else [])
        await session.delete(idea)
        await session.commit()
        return {"deleted": True}
    idea.state = "published" if payload.action == "publish" else "draft"
    audit(session, actor, idea, "editorial_" + payload.action, request_id, old)
    await session.commit()
    return dto(idea, admin=True)
