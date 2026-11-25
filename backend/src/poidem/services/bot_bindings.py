"""Привязка только по update из Bot API или уже проверенной сервером identity."""

from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert

from poidem.db.models import BotBinding, User
from poidem.services import plans


async def attach_verified_user(session, user):
    # Вызов из login уже держит advisory-lock Telegram ID и строку User.
    await session.execute(
        BotBinding.__table__.update()
        .where(BotBinding.telegram_user_id == user.telegram_user_id)
        .values(user_id=user.id)
    )


async def interact(session, telegram_id, private_chat_id, enabled=None):
    await session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": telegram_id})
    user = await session.scalar(
        select(User).where(User.telegram_user_id == telegram_id).with_for_update()
    )
    await session.execute(
        insert(BotBinding)
        .values(
            telegram_user_id=telegram_id,
            user_id=user.id if user else None,
            private_chat_id=private_chat_id,
            access_state="allowed",
            last_interaction_at=plans.now(),
        )
        .on_conflict_do_update(
            index_elements=[BotBinding.telegram_user_id],
            set_={
                "user_id": user.id if user else None,
                "private_chat_id": private_chat_id,
                "access_state": "allowed",
                "last_interaction_at": plans.now(),
            },
        )
    )
    if enabled is not None:
        await session.execute(
            BotBinding.__table__.update()
            .where(BotBinding.telegram_user_id == telegram_id)
            .values(notifications_enabled=enabled)
        )
    return user
