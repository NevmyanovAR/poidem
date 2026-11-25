"""Транзакционный outbox без Telegram I/O, копий анкет или переписки."""

from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from poidem.db.models import NotificationJob
from poidem.services import plans


async def enqueue(session, kind, recipient_id, entity_ref, dedupe_key, due_at=None):
    due = due_at or plans.now()
    await session.execute(
        insert(NotificationJob)
        .values(
            kind=kind,
            recipient_id=recipient_id,
            entity_ref=entity_ref,
            dedupe_key=dedupe_key,
            created_at=plans.now(),
            due_at=due,
            next_attempt_at=due,
        )
        .on_conflict_do_nothing(index_elements=[NotificationJob.dedupe_key])
    )


async def response_event(session, entry, kind):
    await enqueue(
        session,
        kind,
        entry.plan_author_id if kind == "response_received" else entry.responder_id,
        {"response_id": str(entry.id)},
        f"response:{entry.id}:{kind}",
    )


async def chat_event(session, match, recipient_id, client_id):
    # Вызывается под существующей блокировкой ChatThread. Объединяем открытый
    # пакет, но не теряем новую реплику после уже отправленного/прочитанного пакета.
    pending = await session.scalar(
        select(NotificationJob)
        .where(
            NotificationJob.kind == "chat_message",
            NotificationJob.recipient_id == recipient_id,
            NotificationJob.entity_ref["match_id"].astext == str(match.id),
            NotificationJob.state.in_(("pending", "retry")),
        )
        .order_by(NotificationJob.created_at, NotificationJob.id)
        .with_for_update()
        .limit(1)
    )
    if pending:
        if pending.state == "pending":
            pending.due_at = min(
                plans.now() + timedelta(seconds=20), pending.created_at + timedelta(seconds=60)
            )
            pending.next_attempt_at = pending.due_at
        return
    due = plans.now() + timedelta(seconds=20)
    await enqueue(
        session,
        "chat_message",
        recipient_id,
        {"match_id": str(match.id)},
        f"chat:{match.id}:{recipient_id}:{client_id}",
        due_at=due,
    )


def retry_delay(attempt):
    return timedelta(seconds=min(300, 5 * 2 ** min(attempt - 1, 6)))
