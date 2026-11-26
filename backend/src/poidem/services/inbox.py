"""Проекции прежних чатов и откликов. Никаких новых переписок или счётчиков в БД."""

import base64
import json
import uuid
from datetime import datetime

from sqlalchemy import and_, case, func, select, tuple_

from poidem.api.errors import AppError
from poidem.db.models import ChatMessage, ChatReadState, Match, Plan, PlanResponse
from poidem.schemas.inbox import DialogDTO, DialogPage, LastMessageDTO, NavigationDTO
from poidem.services import archive, connections, plans, safety


def actionable(at):
    return and_(
        PlanResponse.status == "waiting",
        Plan.publication_status == "published",
        Plan.moderation_status.in_(plans.VISIBLE_MODERATION),
        Plan.starts_at > at,
        ~archive.archived(at),
        ~safety.blocked_expression(PlanResponse.plan_author_id, PlanResponse.responder_id),
    )


def pending_for_plan(at):
    return (
        select(func.count())
        .select_from(PlanResponse)
        .where(PlanResponse.plan_id == Plan.id, actionable(at))
        .correlate(Plan)
        .scalar_subquery()
    )


def membership(actor):
    return (Match.author_id == actor.user_id) | (Match.responder_id == actor.user_id)


async def navigation(session, actor):
    await plans.require_active(session, actor)
    role = case((Match.author_id == actor.user_id, "author"), else_="responder")
    unread = (
        select(func.count(ChatMessage.id), func.count(func.distinct(ChatMessage.match_id)))
        .select_from(ChatMessage)
        .join(Match, Match.id == ChatMessage.match_id)
        .outerjoin(
            ChatReadState, and_(ChatReadState.match_id == Match.id, ChatReadState.role == role)
        )
        .where(
            membership(actor),
            ChatMessage.sender_id != actor.user_id,
            ChatMessage.sequence > func.coalesce(ChatReadState.last_read_sequence, 0),
        )
    )
    messages, dialogs = (await session.execute(unread)).one()
    pending = await session.scalar(
        select(func.count())
        .select_from(PlanResponse)
        .join(Plan, Plan.id == PlanResponse.plan_id)
        .where(PlanResponse.plan_author_id == actor.user_id, actionable(plans.now()))
    )
    return NavigationDTO(
        pending_responses=pending, unread_messages=messages, unread_dialogs=dialogs
    )


async def dialogs(session, actor, *, cursor=None, limit=20):
    await plans.require_active(session, actor)
    last = (
        select(ChatMessage.created_at)
        .where(ChatMessage.match_id == Match.id)
        .order_by(ChatMessage.sequence.desc())
        .limit(1)
        .correlate(Match)
        .scalar_subquery()
    )
    stamp = func.coalesce(last, Match.created_at)
    query = select(Match, stamp.label("activity_at")).where(membership(actor))
    if cursor:
        try:
            owner, date, identity = json.loads(
                base64.b64decode(cursor, altchars=b"-_", validate=True)
            )
            date = datetime.fromisoformat(date)
            if owner != str(actor.user_id) or date.tzinfo is None:
                raise ValueError
            query = query.where(tuple_(stamp, Match.id) < (date, uuid.UUID(identity)))
        except (ValueError, TypeError, UnicodeError) as error:
            raise AppError(422, "CURSOR_INVALID", "Некорректная страница переписок") from error
    rows = (
        await session.execute(query.order_by(stamp.desc(), Match.id.desc()).limit(limit + 1))
    ).all()
    items = []
    for match, activity_at in rows[:limit]:
        message = await session.scalar(
            select(ChatMessage)
            .where(ChatMessage.match_id == match.id)
            .order_by(ChatMessage.sequence.desc())
            .limit(1)
        )
        items.append(
            DialogDTO(
                match=await connections.match_dto(session, actor, match),
                last_message=LastMessageDTO(
                    text=message.body,
                    sender="self" if message.sender_id == actor.user_id else "other",
                    created_at=message.created_at,
                )
                if message
                else None,
                last_activity_at=activity_at,
            )
        )
    following = None
    if len(rows) > limit:
        match, activity_at = rows[limit - 1]
        following = base64.urlsafe_b64encode(
            json.dumps([str(actor.user_id), activity_at.isoformat(), str(match.id)]).encode()
        ).decode()
    return DialogPage(items=items, next_cursor=following)
