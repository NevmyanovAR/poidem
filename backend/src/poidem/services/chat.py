"""Текстовый чат участников мэтча. Порядок и повторы контролирует PostgreSQL."""

from sqlalchemy import func, select

from poidem.api.errors import AppError
from poidem.db.models import ChatMessage, ChatReadState, ChatThread, Plan, User
from poidem.schemas.chat import ChatDTO, MessageDTO, MessagePage
from poidem.security.session import lock_actor
from poidem.services import archive, connections, plans
from poidem.services.rate_limit import rate_limit


def role_for(match, actor):
    return "author" if actor.user_id == match.author_id else "responder"


async def unread(session, actor, match):
    last_read = (
        await session.scalar(
            select(ChatReadState.last_read_sequence).where(
                ChatReadState.match_id == match.id, ChatReadState.role == role_for(match, actor)
            )
        )
        or 0
    )
    return (
        await session.scalar(
            select(func.count())
            .select_from(ChatMessage)
            .where(
                ChatMessage.match_id == match.id,
                ChatMessage.sender_id != actor.user_id,
                ChatMessage.sequence > last_read,
            )
        )
        or 0
    )


async def state(session, actor, match_id):
    match = await connections.match_record(session, actor, match_id)
    thread = await session.get(ChatThread, match_id)
    if not thread:
        raise connections.missing()
    role = role_for(match, actor)
    reads = dict(
        (
            await session.execute(
                select(ChatReadState.role, ChatReadState.last_read_sequence).where(
                    ChatReadState.match_id == match_id
                )
            )
        ).all()
    )
    plan = await session.get(Plan, match.plan_id)
    other = await session.get(User, match.responder_id if role == "author" else match.author_id)
    is_archived = bool(
        await session.scalar(
            select(Plan.id).where(Plan.id == plan.id, archive.archived(plans.now()))
        )
    )
    return ChatDTO(
        match_id=match_id,
        last_sequence=thread.last_sequence,
        last_read_sequence=reads.get(role, 0),
        other_last_read_sequence=reads.get("responder" if role == "author" else "author", 0),
        unread_count=await unread(session, actor, match),
        can_send=other.account_status == "active"
        and plan.moderation_status in plans.VISIBLE_MODERATION,
        meeting_cancelled=plan.publication_status == "cancelled",
        archived=is_archived,
    )


def message_dto(message, actor):
    own = message.sender_id == actor.user_id
    return MessageDTO(
        id=message.id,
        sequence=message.sequence,
        sender="self" if own else "other",
        text=message.body,
        created_at=message.created_at,
        client_id=message.client_id if own else None,
    )


async def messages(session, actor, match_id, *, before=None, after=None, limit=30):
    await connections.match_record(session, actor, match_id)
    if before is not None and after is not None:
        raise AppError(422, "CHAT_CURSOR_INVALID", "Выбери одно направление истории")
    query = select(ChatMessage).where(ChatMessage.match_id == match_id)
    if before is not None:
        query = query.where(ChatMessage.sequence < before)
    if after is not None:
        query = query.where(ChatMessage.sequence > after)
    query = query.order_by(
        ChatMessage.sequence if after is not None else ChatMessage.sequence.desc()
    )
    rows = (await session.scalars(query.limit(limit + 1))).all()
    page = list(rows[:limit])
    if after is None:
        page.reverse()
    return MessagePage(
        items=[message_dto(row, actor) for row in page],
        next_before=page[0].sequence if after is None and len(rows) > limit else None,
        has_more=len(rows) > limit,
    )


async def send(session, actor, match_id, payload, maximum):
    await lock_actor(session, actor)
    match = await connections.match_record(session, actor, match_id)
    thread = await session.scalar(
        select(ChatThread)
        .where(ChatThread.match_id == match_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if not thread:
        raise connections.missing()
    previous = await session.scalar(
        select(ChatMessage).where(
            ChatMessage.match_id == match_id,
            ChatMessage.sender_id == actor.user_id,
            ChatMessage.client_id == payload.client_id,
        )
    )
    if previous:
        if previous.body != payload.text:
            raise AppError(
                409, "MESSAGE_RETRY_CONFLICT", "Ключ повтора уже использован для другого сообщения"
            )
        return message_dto(previous, actor), False
    other_id = match.responder_id if actor.user_id == match.author_id else match.author_id
    other = await session.get(User, other_id)
    plan = await session.get(Plan, match.plan_id)
    if other.account_status != "active" or plan.moderation_status not in plans.VISIBLE_MODERATION:
        raise AppError(403, "CHAT_RESTRICTED", "Отправка сообщений в этой переписке ограничена")
    await rate_limit(session, f"chat:{actor.user_id}", maximum)
    thread.last_sequence += 1
    message = ChatMessage(
        match_id=match_id,
        sender_id=actor.user_id,
        client_id=payload.client_id,
        sequence=thread.last_sequence,
        body=payload.text,
    )
    session.add(message)
    await session.commit()
    return message_dto(message, actor), True


async def mark_read(session, actor, match_id, payload):
    await lock_actor(session, actor)
    match = await connections.match_record(session, actor, match_id)
    thread = await session.scalar(
        select(ChatThread).where(ChatThread.match_id == match_id).with_for_update()
    )
    if not thread:
        raise connections.missing()
    if payload.through_sequence > thread.last_sequence:
        raise AppError(422, "CHAT_READ_INVALID", "Такого сообщения в переписке ещё нет")
    read = await session.get(ChatReadState, (match_id, role_for(match, actor)))
    if payload.through_sequence > read.last_read_sequence:
        read.last_read_sequence = payload.through_sequence
        read.read_at = plans.now()
    await session.commit()
    return await state(session, actor, match_id)
