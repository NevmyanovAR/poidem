import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Numeric,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from poidem.db.base import Base, CreatedMixin, IdentityMixin
from poidem.db.models.common import state_type


class Survey(IdentityMixin, CreatedMixin, Base):
    __tablename__ = "surveys"
    __table_args__ = (CheckConstraint("meeting_context_version > 0", name="version_positive"),)
    match_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("matches.id", ondelete="RESTRICT"), unique=True
    )
    scheduled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    meeting_context_version: Mapped[int]
    state: Mapped[str] = mapped_column(
        state_type("survey_state", "scheduled", "available", "closed"), server_default="scheduled"
    )
    policy_version: Mapped[str] = mapped_column(Text)


class SurveyRecipient(Base):
    __tablename__ = "survey_recipients"
    survey_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("surveys.id", ondelete="RESTRICT"), primary_key=True
    )
    participant_side: Mapped[str] = mapped_column(
        state_type("participant_side", "author", "responder"), primary_key=True
    )
    delivery_state: Mapped[str] = mapped_column(
        state_type("delivery_state", "pending", "sent", "failed"), server_default="pending"
    )
    callback_token_hash: Mapped[str | None] = mapped_column(Text, unique=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    comment_prompt_message_id: Mapped[int | None] = mapped_column(BigInteger)


class FeedbackAnswer(Base):
    __tablename__ = "feedback_answers"
    __table_args__ = (
        ForeignKeyConstraint(
            ["survey_id", "participant_side"],
            ["survey_recipients.survey_id", "survey_recipients.participant_side"],
            name="fk_feedback_answers_recipient",
            ondelete="RESTRICT",
        ),
    )
    survey_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    participant_side: Mapped[str] = mapped_column(Text, primary_key=True)
    met: Mapped[bool | None]
    rating: Mapped[Decimal | None] = mapped_column(Numeric)
    comment: Mapped[str | None] = mapped_column(Text)
    completion_state: Mapped[str] = mapped_column(
        state_type("completion_state", "in_progress", "submitted"), server_default="in_progress"
    )
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ReliabilityEvent(IdentityMixin, CreatedMixin, Base):
    __tablename__ = "reliability_events"
    subject_user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    match_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("matches.id", ondelete="RESTRICT"), index=True
    )
    kind: Mapped[str] = mapped_column(Text)
    evidence_ref: Mapped[str] = mapped_column(Text)
    verification_state: Mapped[str] = mapped_column(
        state_type("verification_state", "pending", "confirmed", "disputed", "rejected"),
        server_default="pending",
    )
    verified_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT")
    )
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    policy_version: Mapped[str] = mapped_column(Text)
    source_event_key: Mapped[str] = mapped_column(Text, unique=True)


class PositiveImpression(Base):
    """Независимый добровольный ответ. Партнёр определяется только через Survey/Match."""

    __tablename__ = "positive_impressions"
    __table_args__ = (
        ForeignKeyConstraint(
            ["survey_id", "participant_side"],
            ["survey_recipients.survey_id", "survey_recipients.participant_side"],
            name="fk_positive_impressions_recipient",
            ondelete="RESTRICT",
        ),
    )
    survey_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    participant_side: Mapped[str] = mapped_column(Text, primary_key=True)
    pleasant: Mapped[bool] = mapped_column(Boolean)
    interesting: Mapped[bool] = mapped_column(Boolean)
    comfortable: Mapped[bool] = mapped_column(Boolean)
    consent_version: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
