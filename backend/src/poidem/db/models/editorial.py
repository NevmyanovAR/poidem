import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from poidem.db.base import Base, CreatedMixin
from poidem.db.models.common import state_type


class EditorialIdea(CreatedMixin, Base):
    __tablename__ = "editorial_ideas"
    __table_args__ = (
        CheckConstraint("version > 0", name="version_positive"),
        CheckConstraint("sort_order >= 0", name="order_nonnegative"),
        CheckConstraint("image_key IS NULL OR static_image IS NULL", name="one_image"),
        Index("ix_editorial_ideas_state_order", "state", "sort_order", "id"),
    )
    id: Mapped[str] = mapped_column(Text, primary_key=True)
    title: Mapped[str] = mapped_column(Text)
    subtitle: Mapped[str] = mapped_column(Text)
    category_code: Mapped[str] = mapped_column(ForeignKey("categories.code", ondelete="RESTRICT"))
    place: Mapped[str] = mapped_column(Text)
    plan_title: Mapped[str] = mapped_column(Text)
    tag: Mapped[str] = mapped_column(Text)
    state: Mapped[str] = mapped_column(
        state_type("editorial_state", "draft", "published"), server_default="draft"
    )
    sort_order: Mapped[int] = mapped_column(server_default="0")
    version: Mapped[int] = mapped_column(server_default="1")
    static_image: Mapped[str | None] = mapped_column(Text)
    image_key: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT")
    )
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
