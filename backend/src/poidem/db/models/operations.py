import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from poidem.db.base import Base, IdentityMixin


class AnalyticsEvent(IdentityMixin, Base):
    __tablename__ = "analytics_events"
    __table_args__ = (
        CheckConstraint("jsonb_typeof(allowed_dimensions) = 'object'", name="dimensions_object"),
        Index("ix_analytics_events_type_occurred", "event_type", "occurred_at"),
    )
    event_key: Mapped[str] = mapped_column(Text, unique=True)
    event_type: Mapped[str] = mapped_column(Text)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    entity_type: Mapped[str | None] = mapped_column(Text)
    entity_id: Mapped[uuid.UUID | None]
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    allowed_dimensions: Mapped[dict[str, Any]] = mapped_column(
        JSONB, server_default=text("'{}'::jsonb")
    )


class AdminAuditLog(IdentityMixin, Base):
    __tablename__ = "admin_audit_log"
    __table_args__ = (Index("ix_admin_audit_actor_occurred", "actor_id", "occurred_at"),)
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    action: Mapped[str] = mapped_column(Text)
    target_ref: Mapped[str] = mapped_column(Text)
    object_version: Mapped[int | None]
    old_status: Mapped[str | None] = mapped_column(Text)
    new_status: Mapped[str | None] = mapped_column(Text)
    reason_code: Mapped[str] = mapped_column(Text)
    request_id: Mapped[uuid.UUID]
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class IdempotencyRecord(Base):
    __tablename__ = "idempotency_records"
    __table_args__ = (
        CheckConstraint("length(request_fingerprint) = 64", name="fingerprint_length"),
    )
    actor_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), primary_key=True
    )
    method: Mapped[str] = mapped_column(Text, primary_key=True)
    path: Mapped[str] = mapped_column(Text, primary_key=True)
    key: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    request_fingerprint: Mapped[str] = mapped_column(Text)
    result_resource_ref: Mapped[str] = mapped_column(Text)
    safe_result: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default=text("'{}'::jsonb"))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
