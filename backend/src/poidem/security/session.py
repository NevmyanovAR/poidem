import hashlib
import hmac
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from poidem.api.errors import AppError
from poidem.db.models import AuthSession, User
from poidem.db.session import get_session


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def require_origin(request: Request) -> None:
    if request.headers.get("origin") not in request.app.state.settings.cors_origins:
        raise AppError(403, "ORIGIN_INVALID", "Недопустимый источник запроса")


@dataclass(frozen=True)
class Principal:
    user_id: uuid.UUID
    session_id: uuid.UUID
    telegram_id: int
    csrf_token: str
    authenticated_at: datetime


async def require_session(
    request: Request, session: Annotated[AsyncSession, Depends(get_session)]
) -> Principal:
    token = request.cookies.get(request.app.state.settings.cookie_name, "")
    if not token or len(token) > 128:
        raise AppError(401, "AUTH_REQUIRED", "Открой приложение в Telegram, чтобы войти")
    row = (
        await session.execute(
            select(AuthSession, User)
            .join(User, User.id == AuthSession.user_id)
            .where(
                AuthSession.token_hash == digest(token),
                AuthSession.revoked_at.is_(None),
                AuthSession.expires_at > datetime.now(UTC),
            )
        )
    ).first()
    if row is None:
        raise AppError(401, "SESSION_EXPIRED", "Сессия завершена. Открой Mini App заново")
    auth, user = row
    return Principal(
        user.id, auth.id, user.telegram_user_id, auth.csrf_token, auth.authenticated_at
    )


async def require_write(
    request: Request, actor: Annotated[Principal, Depends(require_session)]
) -> Principal:
    require_origin(request)
    csrf = request.headers.get("x-csrf-token", "")
    if len(csrf) > 128 or not hmac.compare_digest(csrf.encode(), actor.csrf_token.encode()):
        raise AppError(403, "CSRF_INVALID", "Не удалось проверить запрос. Обнови страницу")
    return actor


async def lock_actor(session: AsyncSession, actor: Principal, *, active: bool = True) -> User:
    user = await session.scalar(
        select(User)
        .where(User.id == actor.user_id)
        # Сериализуем изменения аккаунта, но разрешаем FK KEY SHARE другой стороны.
        # FOR UPDATE создавал цикл user A → pair → FK user B при блокировке/чате.
        .with_for_update(key_share=True)
        .execution_options(populate_existing=True)
    )
    auth = await session.scalar(
        select(AuthSession)
        .where(AuthSession.id == actor.session_id)
        .execution_options(populate_existing=True)
    )
    if user is None or auth is None or auth.revoked_at or auth.expires_at <= datetime.now(UTC):
        raise AppError(401, "SESSION_EXPIRED", "Сессия завершена")
    if active and user.account_status != "active":
        raise AppError(403, "ACCOUNT_BLOCKED", "Действия аккаунта ограничены")
    return user
