import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from poidem.api.errors import AppError
from poidem.db.models import AuthSession, User
from poidem.security.session import digest
from poidem.security.telegram import validate_init_data
from poidem.services.rate_limit import rate_limit
from poidem.settings import Settings


async def login(session: AsyncSession, raw: str, settings: Settings, old_cookie: str = ""):
    identity = validate_init_data(raw, settings)
    # Общая блокировка для входа и удаления этого Telegram-аккаунта.
    await session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": identity.user_id})
    await rate_limit(session, f"login:{identity.user_id}", settings.login_requests_per_minute)
    await session.execute(
        insert(User)
        .values(
            telegram_user_id=identity.user_id,
            private_username=identity.username,
        )
        .on_conflict_do_nothing(index_elements=[User.telegram_user_id])
    )
    user = await session.scalar(
        select(User).where(User.telegram_user_id == identity.user_id).with_for_update()
    )
    if user.account_status != "active":
        raise AppError(403, "ACCOUNT_BLOCKED", "Действия аккаунта ограничены")
    user.private_username = identity.username
    now = datetime.now(UTC)
    await session.execute(
        delete(AuthSession).where(
            AuthSession.user_id == user.id,
            AuthSession.expires_at <= now,
        )
    )
    if old_cookie and len(old_cookie) <= 128:
        await session.execute(
            delete(AuthSession).where(AuthSession.token_hash == digest(old_cookie))
        )
    token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    auth = AuthSession(
        user_id=user.id,
        token_hash=digest(token),
        csrf_token=csrf,
        authenticated_at=now,
        expires_at=now + timedelta(seconds=settings.session_ttl_seconds),
    )
    session.add(auth)
    await session.flush()
    return user, auth, token
