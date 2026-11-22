import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from poidem.db.base import Base, CreatedMixin, IdentityMixin
from poidem.db.models.common import state_type


class BotBinding(Base):
    __tablename__ = "bot_bindings"
    __table_args__ = (
        ForeignKeyConstraint(
            ["user_id", "telegram_user_id"],
            ["users.id", "users.telegram_user_id"],
            name="fk_bot_bindings_verified_identity",
            ondelete="RESTRICT",
        ),
        CheckConstraint(
            "telegram_user_id > 0 AND private_chat_id > 0", name="private_identity_positive"
        ),
    )
    telegram_user_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(unique=True)
    private_chat_id: Mapped[int] = mapped_column(BigInteger, unique=True)
    access_state: Mapped[str] = mapped_column(
        state_type("bot_access_state", "unknown", "allowed", "denied"), server_default="unknown"
    )
    last_interaction_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class NotificationJob(IdentityMixin, CreatedMixin, Base):
    __tablename__ = "notification_jobs"
    __table_args__ = (
        CheckConstraint("attempts >= 0", name="attempts_nonnegative"),
        CheckConstraint("jsonb_typeof(entity_ref) = 'object'", name="entity_object"),
        CheckConstraint(
            "(state = 'leased' AND lease_until IS NOT NULL AND lease_owner IS NOT NULL) OR "
            "(state <> 'leased' AND lease_until IS NULL AND lease_owner IS NULL)",
            name="lease_pair",
        ),
        Index("ix_notification_jobs_due", "state", "next_attempt_at"),
        Index("ix_notification_jobs_recipient_created", "recipient_id", "created_at"),
    )
    kind: Mapped[str] = mapped_column(Text)
    recipient_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    entity_ref: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default=text("'{}'::jsonb"))
    dedupe_key: Mapped[str] = mapped_column(Text, unique=True)
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    state: Mapped[str] = mapped_column(
        state_type("job_state", "pending", "leased", "sent", "retry", "failed", "suppressed"),
        server_default="pending",
    )
    attempts: Mapped[int] = mapped_column(server_default="0")
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    lease_owner: Mapped[str | None] = mapped_column(Text)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    telegram_message_id: Mapped[int | None] = mapped_column(BigInteger)
    safe_error_code: Mapped[str | None] = mapped_column(Text)


class TelegramUpdate(Base):
    __tablename__ = "telegram_updates"
    bot_key: Mapped[str] = mapped_column(Text, primary_key=True)
    update_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    state: Mapped[str] = mapped_column(
        state_type("update_state", "pending", "processed", "failed"), server_default="pending"
    )
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
