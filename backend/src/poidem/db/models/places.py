import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from poidem.db.base import Base, CreatedMixin, IdentityMixin


class PlaceSelectionRecord(IdentityMixin, CreatedMixin, Base):
    """Минимальный результат явного выбора, не копия каталога/история поисковых запросов."""

    __tablename__ = "place_selections"
    __table_args__ = (
        UniqueConstraint("user_id", "provider", "provider_place_id", name="uq_place_selection"),
        CheckConstraint("jsonb_typeof(snapshot) = 'object'", name="snapshot_object"),
        Index("ix_place_selections_user_created", "user_id", "created_at"),
    )
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    provider: Mapped[str] = mapped_column(Text)
    provider_place_id: Mapped[str] = mapped_column(Text)
    checked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    snapshot: Mapped[dict] = mapped_column(JSONB)


class PublicPlace(IdentityMixin, CreatedMixin, Base):
    __tablename__ = "public_places"
    __table_args__ = (
        UniqueConstraint("dedupe_key", name="uq_public_places_identity"),
        CheckConstraint(
            "status IN ('pending','approved','rejected','hidden')", name="status_valid"
        ),
        CheckConstraint("version > 0", name="version_positive"),
        CheckConstraint(
            "length(btrim(name)) > 0 AND length(btrim(address)) > 0 AND length(btrim(city)) > 0",
            name="fields_nonempty",
        ),
        CheckConstraint(
            "category IN ('cafe','restaurant','bar','museum','gallery',"
            "'cinema','theatre','park','culture')",
            name="category_valid",
        ),
        CheckConstraint(
            "status <> 'approved' OR reviewed_at IS NOT NULL", name="approval_reviewed"
        ),
        Index("ix_public_places_status_created", "status", "created_at", "id"),
        Index("ix_public_places_proposer_created", "proposer_id", "created_at"),
    )
    name: Mapped[str] = mapped_column(Text)
    address: Mapped[str] = mapped_column(Text)
    city: Mapped[str] = mapped_column(Text)
    category: Mapped[str] = mapped_column(Text)
    dedupe_key: Mapped[str] = mapped_column(Text)
    search_text: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, server_default="pending")
    version: Mapped[int] = mapped_column(server_default="1")
    proposer_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    reason: Mapped[str | None] = mapped_column(Text)
