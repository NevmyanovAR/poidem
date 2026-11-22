from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, DateTime, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from poidem.db.base import Base


class MediaDeletion(Base):
    """Очередь не зависит FK от аккаунта и переживает его удаление."""

    __tablename__ = "media_deletions"
    storage_key: Mapped[str] = mapped_column(Text, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    attempts: Mapped[int] = mapped_column(server_default="0")
    next_attempt_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )


class RateLimitWindow(Base):
    __tablename__ = "rate_limit_windows"
    __table_args__ = (CheckConstraint("attempts > 0", name="attempts_positive"),)
    key_hash: Mapped[str] = mapped_column(Text, primary_key=True)
    window: Mapped[int] = mapped_column(BigInteger, index=True)
    attempts: Mapped[int]
