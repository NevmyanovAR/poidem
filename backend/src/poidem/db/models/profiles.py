import uuid
from typing import TYPE_CHECKING

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from poidem.db.base import Base, CreatedMixin, IdentityMixin
from poidem.db.models.common import moderation_type, state_type

if TYPE_CHECKING:
    from poidem.db.models.accounts import User


class GenderOption(Base):
    __tablename__ = "gender_options"
    code: Mapped[str] = mapped_column(Text, primary_key=True)
    title: Mapped[str] = mapped_column(Text)
    enabled: Mapped[bool] = mapped_column(Boolean, server_default="true")


class PreferenceOption(Base):
    __tablename__ = "preference_options"
    code: Mapped[str] = mapped_column(Text, primary_key=True)
    title: Mapped[str] = mapped_column(Text)
    enabled: Mapped[bool] = mapped_column(Boolean, server_default="true")


class Interest(Base):
    __tablename__ = "interests"
    code: Mapped[str] = mapped_column(Text, primary_key=True)
    title: Mapped[str] = mapped_column(Text)
    enabled: Mapped[bool] = mapped_column(Boolean, server_default="true")


class Photo(IdentityMixin, CreatedMixin, Base):
    __tablename__ = "photos"
    __table_args__ = (
        UniqueConstraint("id", "owner_id", name="uq_photos_id_owner_id"),
        CheckConstraint("bytes > 0 AND width > 0 AND height > 0", name="dimensions_positive"),
        CheckConstraint("content_version > 0", name="content_version_positive"),
    )
    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    storage_key: Mapped[str] = mapped_column(Text, unique=True)
    media_type: Mapped[str] = mapped_column(Text)
    byte_size: Mapped[int] = mapped_column("bytes", BigInteger)
    width: Mapped[int]
    height: Mapped[int]
    processing_status: Mapped[str] = mapped_column(
        state_type("processing_status", "processing", "ready", "rejected"),
        server_default="processing",
    )
    moderation_status: Mapped[str] = mapped_column(
        moderation_type(), server_default="not_submitted"
    )
    content_version: Mapped[int] = mapped_column(server_default="1")


class Profile(Base):
    __tablename__ = "profiles"
    __table_args__ = (
        ForeignKeyConstraint(
            ["photo_id", "user_id"],
            ["photos.id", "photos.owner_id"],
            name="fk_profiles_photo_owner",
            ondelete="RESTRICT",
        ),
        CheckConstraint("age >= 18", name="adult_age"),
        CheckConstraint("length(btrim(name)) > 0", name="name_nonempty"),
        CheckConstraint("version > 0", name="version_positive"),
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), primary_key=True
    )
    name: Mapped[str] = mapped_column(Text)
    age: Mapped[int] = mapped_column(BigInteger)
    gender_code: Mapped[str] = mapped_column(ForeignKey("gender_options.code", ondelete="RESTRICT"))
    preference_code: Mapped[str] = mapped_column(
        ForeignKey("preference_options.code", ondelete="RESTRICT")
    )
    bio: Mapped[str] = mapped_column(Text)
    photo_id: Mapped[uuid.UUID] = mapped_column(index=True)
    photo_revision: Mapped[int] = mapped_column(server_default="1")
    moderation_status: Mapped[str] = mapped_column(
        moderation_type(), server_default="not_submitted"
    )
    version: Mapped[int] = mapped_column(server_default="1")
    user: Mapped["User"] = relationship(viewonly=True, lazy="raise")
    photo: Mapped[Photo] = relationship(viewonly=True, lazy="raise")
    interests: Mapped[list["ProfileInterest"]] = relationship(
        viewonly=True, lazy="raise", order_by="ProfileInterest.position"
    )


class ProfileInterest(Base):
    __tablename__ = "profile_interests"
    __table_args__ = (
        UniqueConstraint("user_id", "interest_code", name="uq_profile_interests_user_interest"),
        CheckConstraint("position BETWEEN 1 AND 3", name="position_range"),
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("profiles.user_id", ondelete="RESTRICT"), primary_key=True
    )
    position: Mapped[int] = mapped_column(primary_key=True)
    interest_code: Mapped[str] = mapped_column(
        ForeignKey("interests.code", ondelete="RESTRICT"), index=True
    )
