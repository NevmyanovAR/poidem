import uuid
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from poidem.db.base import Base, CreatedMixin, IdentityMixin
from poidem.db.models.common import moderation_type, state_type


class Category(Base):
    __tablename__ = "categories"
    code: Mapped[str] = mapped_column(Text, primary_key=True)
    title: Mapped[str] = mapped_column(Text)
    cover_asset_key: Mapped[str] = mapped_column(Text)
    enabled: Mapped[bool] = mapped_column(Boolean, server_default="true")


class Plan(IdentityMixin, CreatedMixin, Base):
    __tablename__ = "plans"
    __table_args__ = (
        UniqueConstraint("id", "author_id", name="uq_plans_id_author_id"),
        CheckConstraint("length(btrim(title)) > 0", name="title_nonempty"),
        CheckConstraint("version > 0", name="version_positive"),
        CheckConstraint(
            "(quota_charged_at IS NULL) = (quota_charged_day IS NULL)", name="quota_charge_pair"
        ),
        Index("ix_plans_publication_starts_id", "publication_status", "starts_at", "id"),
        Index("ix_plans_author_created_id", "author_id", "created_at", "id"),
    )
    author_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    title: Mapped[str] = mapped_column(Text)
    category_code: Mapped[str] = mapped_column(
        ForeignKey("categories.code", ondelete="RESTRICT"), index=True
    )
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    time_zone: Mapped[str] = mapped_column(Text)
    place: Mapped[str] = mapped_column(Text)
    description: Mapped[str] = mapped_column(Text)
    publication_status: Mapped[str] = mapped_column(
        state_type("publication_status", "draft", "submitted", "published", "closed", "cancelled"),
        server_default="draft",
    )
    moderation_status: Mapped[str] = mapped_column(
        moderation_type(), server_default="not_submitted"
    )
    version: Mapped[int] = mapped_column(server_default="1")
    quota_charged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    quota_charged_day: Mapped[date | None] = mapped_column(Date)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    responses: Mapped[list["PlanResponse"]] = relationship(viewonly=True, lazy="raise")


class DailyPlanUsage(Base):
    __tablename__ = "daily_plan_usage"
    __table_args__ = (CheckConstraint("used BETWEEN 0 AND 3", name="usage_range"),)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), primary_key=True
    )
    quota_day: Mapped[date] = mapped_column(Date, primary_key=True)
    used: Mapped[int] = mapped_column(server_default="0")
    calendar_zone: Mapped[str] = mapped_column(Text)
    policy_version: Mapped[str] = mapped_column(Text)


class PlanResponse(IdentityMixin, CreatedMixin, Base):
    __tablename__ = "plan_responses"
    __table_args__ = (
        ForeignKeyConstraint(
            ["plan_id", "plan_author_id"],
            ["plans.id", "plans.author_id"],
            name="fk_plan_responses_plan_author",
            ondelete="RESTRICT",
        ),
        UniqueConstraint(
            "id", "plan_id", "plan_author_id", "responder_id", name="uq_plan_responses_identity"
        ),
        UniqueConstraint("plan_id", "responder_id", name="uq_plan_responses_plan_responder"),
        CheckConstraint("responder_id <> plan_author_id", name="not_author"),
        CheckConstraint("slot_no BETWEEN 1 AND 15 OR slot_no IS NULL", name="slot_range"),
        CheckConstraint("status <> 'waiting' OR slot_no IS NOT NULL", name="waiting_has_slot"),
        CheckConstraint("version > 0 AND agreed_plan_version > 0", name="versions_positive"),
        CheckConstraint(
            "(status = 'waiting' AND decision_actor_id IS NULL AND decided_at IS NULL) OR "
            "(status IN ('accepted', 'rejected') AND decision_actor_id = plan_author_id "
            "AND decision_actor_id IS NOT NULL AND decided_at IS NOT NULL) OR "
            "(status = 'closed' AND decision_actor_id IS NULL AND decided_at IS NOT NULL)",
            name="decision_by_author",
        ),
        CheckConstraint(
            "status NOT IN ('rejected','closed') OR slot_no IS NULL", name="terminal_no_slot"
        ),
        Index(
            "uq_plan_responses_active_person",
            "plan_id",
            "responder_id",
            unique=True,
            postgresql_where=text("status IN ('waiting','accepted')"),
        ),
        Index(
            "uq_plan_responses_accepted_plan",
            "plan_id",
            unique=True,
            postgresql_where=text("status = 'accepted'"),
        ),
        Index(
            "uq_plan_responses_occupied_slot",
            "plan_id",
            "slot_no",
            unique=True,
            postgresql_where=text("slot_no IS NOT NULL"),
        ),
        Index("ix_plan_responses_plan_status_created", "plan_id", "status", "created_at"),
        Index("ix_plan_responses_responder_created", "responder_id", "created_at"),
    )
    plan_id: Mapped[uuid.UUID]
    plan_author_id: Mapped[uuid.UUID]
    responder_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    agreed_plan_version: Mapped[int]
    status: Mapped[str] = mapped_column(
        state_type("response_status", "waiting", "accepted", "rejected", "closed"),
        server_default="waiting",
    )
    slot_no: Mapped[int | None]
    version: Mapped[int] = mapped_column(server_default="1")
    decision_actor_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT")
    )
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    history_context: Mapped[dict | None] = mapped_column(JSONB(none_as_null=True))
    match: Mapped["Match | None"] = relationship(viewonly=True, lazy="raise")


class Match(IdentityMixin, CreatedMixin, Base):
    __tablename__ = "matches"
    __table_args__ = (
        UniqueConstraint("plan_id", name="uq_matches_plan_id"),
        ForeignKeyConstraint(
            ["response_id", "plan_id", "author_id", "responder_id"],
            [
                "plan_responses.id",
                "plan_responses.plan_id",
                "plan_responses.plan_author_id",
                "plan_responses.responder_id",
            ],
            name="fk_matches_response_participants",
            ondelete="RESTRICT",
        ),
        CheckConstraint("author_id <> responder_id", name="two_distinct_participants"),
        CheckConstraint("accepted_plan_version > 0", name="version_positive"),
        Index("ix_matches_author_created", "author_id", "created_at"),
        Index("ix_matches_responder_created", "responder_id", "created_at"),
        Index("ix_matches_plan", "plan_id"),
    )
    response_id: Mapped[uuid.UUID] = mapped_column(unique=True)
    plan_id: Mapped[uuid.UUID]
    author_id: Mapped[uuid.UUID]
    responder_id: Mapped[uuid.UUID]
    accepted_plan_version: Mapped[int]
    meeting_starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    meeting_time_zone: Mapped[str] = mapped_column(Text)
    meeting_place: Mapped[str] = mapped_column(Text)
