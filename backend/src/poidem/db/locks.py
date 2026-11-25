"""Короткоживущая session-lock без открытой транзакции во время Telegram I/O."""

from contextlib import asynccontextmanager

from sqlalchemy import text


@asynccontextmanager
async def advisory_lock(database, key):
    async with database.engine.connect() as connection:
        acquired = await connection.scalar(
            text("SELECT pg_try_advisory_lock(hashtextextended(:key, 0))"), {"key": key}
        )
        await connection.commit()
        try:
            yield bool(acquired)
        finally:
            if acquired:
                try:
                    await connection.execute(
                        text("SELECT pg_advisory_unlock(hashtextextended(:key, 0))"), {"key": key}
                    )
                    await connection.commit()
                except BaseException:
                    # Session-lock не должна вернуться в пул даже при отмене задачи.
                    await connection.invalidate()
                    raise
