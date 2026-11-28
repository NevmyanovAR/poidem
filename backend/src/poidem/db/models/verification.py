import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from poidem.db.base import Base, CreatedMixin, IdentityMixin


class PhotoVerification(IdentityMixin, CreatedMixin, Base):
    __tablename__ = "photo_verifications"
    __table_args__ = (
        CheckConstraint(
            "state IN ('pending','approved','rejected','cancelled','expired')", name="state_valid"
        ),
        CheckConstraint(
            "photo_revision > 0 AND photo_content_version > 0 AND version > 0",
            name="versions_positive",
        ),
        CheckConstraint("review_retention_hours >= 0", name="retention_nonnegative"),
        Index(
            "uq_photo_verifications_pending",
            "user_id",
            unique=True,
            postgresql_where=text("state = 'pending'"),
        ),
        Index("ix_photo_verifications_state_created", "state", "created_at", "id"),
        Index("ix_photo_verifications_user_created", "user_id", "created_at", "id"),
        Index("ix_photo_verifications_purge", "purge_at"),
    )
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    # UUID снимка, не FK: прежние Photo удаляются существующим процессом смены фото.
    photo_id: Mapped[uuid.UUID]
    photo_revision: Mapped[int]
    photo_content_version: Mapped[int]
    gesture_code: Mapped[str] = mapped_column(Text)
    state: Mapped[str] = mapped_column(Text, server_default="pending")
    version: Mapped[int] = mapped_column(server_default="1")
    consent_version: Mapped[str] = mapped_column(Text)
    consent_text: Mapped[str] = mapped_column(Text)
    consented_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    consent_revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    reason_code: Mapped[str | None] = mapped_column(Text)
    reason_comment: Mapped[str | None] = mapped_column(Text)
    primary_key: Mapped[str | None] = mapped_column(Text)
    selfie_key: Mapped[str | None] = mapped_column(Text)
    purge_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    review_retention_hours: Mapped[int]
