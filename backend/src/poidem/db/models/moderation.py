import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from poidem.db.base import Base, CreatedMixin, IdentityMixin
from poidem.db.models.common import state_type


class ModerationCase(IdentityMixin, CreatedMixin, Base):
    __tablename__ = "moderation_cases"
    __table_args__ = (
        CheckConstraint(
            "num_nonnulls(target_user_id, profile_user_id, photo_id, plan_id) = 1",
            name="exactly_one_target",
        ),
        CheckConstraint("object_version > 0", name="version_positive"),
        Index("ix_moderation_cases_state_created", "state", "created_at"),
    )
    target_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    profile_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("profiles.user_id", ondelete="RESTRICT"), index=True
    )
    photo_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("photos.id", ondelete="RESTRICT"), index=True
    )
    plan_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("plans.id", ondelete="RESTRICT"), index=True
    )
    object_version: Mapped[int]
    workflow_version: Mapped[str] = mapped_column(Text)
    state: Mapped[str] = mapped_column(
        state_type("case_state", "pending", "approved", "rejected", "blocked"),
        server_default="pending",
    )


class ModerationDecision(IdentityMixin, Base):
    __tablename__ = "moderation_decisions"
    __table_args__ = (CheckConstraint("object_version > 0", name="version_positive"),)
    case_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("moderation_cases.id", ondelete="RESTRICT"), index=True
    )
    actor_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    step_key: Mapped[str] = mapped_column(Text)
    action: Mapped[str] = mapped_column(Text)
    reason: Mapped[str] = mapped_column(Text)
    object_version: Mapped[int]
    decided_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Report(IdentityMixin, CreatedMixin, Base):
    __tablename__ = "reports"
    __table_args__ = (
        CheckConstraint("num_nonnulls(reported_user_id, plan_id) = 1", name="exactly_one_target"),
        Index("ix_reports_state_created", "state", "created_at"),
    )
    reporter_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    reported_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    plan_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("plans.id", ondelete="RESTRICT"), index=True
    )
    reason_code: Mapped[str] = mapped_column(Text)
    comment: Mapped[str | None] = mapped_column(Text)
    state: Mapped[str] = mapped_column(
        state_type("report_state", "pending", "reviewed"), server_default="pending"
    )


class UserRestriction(IdentityMixin, Base):
    __tablename__ = "user_restrictions"
    __table_args__ = (
        CheckConstraint("(lifted_at IS NULL) = (lifted_by IS NULL)", name="lift_pair"),
        CheckConstraint("lifted_at IS NULL OR lifted_at >= imposed_at", name="lift_after_impose"),
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    imposed_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    reason: Mapped[str] = mapped_column(Text)
    imposed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    lifted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    lifted_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
