import time

from sqlalchemy import case, or_
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from poidem.api.errors import AppError
from poidem.db.models import RateLimitWindow
from poidem.security.session import digest


async def rate_limit(session: AsyncSession, key: str, maximum: int) -> None:
    window = int(time.time()) // 60
    query = insert(RateLimitWindow).values(key_hash=digest(key), window=window, attempts=1)
    query = query.on_conflict_do_update(
        index_elements=[RateLimitWindow.key_hash],
        set_={
            "window": window,
            "attempts": case(
                (RateLimitWindow.window < window, 1), else_=RateLimitWindow.attempts + 1
            ),
        },
        where=or_(RateLimitWindow.window < window, RateLimitWindow.attempts < maximum),
    ).returning(RateLimitWindow.attempts)
    if await session.scalar(query) is None:
        raise AppError(429, "REQUEST_RATE_LIMITED", "Слишком много запросов. Попробуй через минуту")
