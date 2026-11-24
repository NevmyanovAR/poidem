"""Архив — представление плана, а не доказательство состоявшейся встречи."""

import asyncio
import logging
from datetime import timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func, or_, select, text, update
from sqlalchemy.dialects.postgresql import insert

from poidem.api.errors import AppError
from poidem.db.models import ArchiveHidden, Plan, PlanResponse
from poidem.security.session import lock_actor
from poidem.services import plans

logger = logging.getLogger(__name__)


def is_archived(plan, at=None):
    deadline = plan.starts_at.astimezone(ZoneInfo(plan.time_zone)) + timedelta(days=7)
    return bool(
        plan.archived_at
        or plan.publication_status == "cancelled"
        or deadline <= (at or plans.now())
    )


def due_at():
    # 7 календарных дней именно в зоне плана, включая переходы DST.
    return func.timezone(
        Plan.time_zone, func.timezone(Plan.time_zone, Plan.starts_at) + text("interval '7 days'")
    )


def archived(at):
    # Чтения не зависят от задержки фонового цикла.
    return or_(
        Plan.archived_at.is_not(None), Plan.publication_status == "cancelled", due_at() <= at
    )


async def archive_due(session, at=None):
    result = await session.execute(
        update(Plan)
        .where(Plan.archived_at.is_(None), archived(at or plans.now()))
        .values(archived_at=at or plans.now())
    )
    await session.commit()
    return result.rowcount


async def archive_loop(database):
    while True:
        try:
            async with database.sessions() as session:
                await archive_due(session)
        except Exception:
            # Не журналируем ни SQL-параметры, ни пользовательский текст.
            logger.warning("archive_processing_unavailable")
        await asyncio.sleep(60)


async def set_hidden(session, actor, plan_id, hidden):
    await lock_actor(session, actor)
    allowed = await session.scalar(
        select(Plan.id).where(
            Plan.id == plan_id,
            or_(
                Plan.author_id == actor.user_id,
                select(PlanResponse.id)
                .where(PlanResponse.plan_id == Plan.id, PlanResponse.responder_id == actor.user_id)
                .exists(),
            ),
            archived(plans.now()),
        )
    )
    if not allowed:
        raise AppError(404, "ARCHIVE_NOT_FOUND", "Архивная карточка недоступна")
    if hidden:
        await session.execute(
            insert(ArchiveHidden)
            .values(user_id=actor.user_id, plan_id=plan_id)
            .on_conflict_do_nothing()
        )
    else:
        await session.execute(
            ArchiveHidden.__table__.delete().where(
                ArchiveHidden.user_id == actor.user_id, ArchiveHidden.plan_id == plan_id
            )
        )
    await session.commit()
