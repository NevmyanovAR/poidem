import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from poidem.db.base import Base, CreatedMixin, IdentityMixin
from poidem.db.models.common import state_type

if TYPE_CHECKING:
    from poidem.db.models.plans import Plan
    from poidem.db.models.profiles import Photo, Profile


class User(IdentityMixin, CreatedMixin, Base):
    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("telegram_user_id"),
        UniqueConstraint("id", "telegram_user_id", name="uq_users_id_telegram_user_id"),
        CheckConstraint("telegram_user_id > 0", name="telegram_id_positive"),
        CheckConstraint("version > 0", name="version_positive"),
    )
    telegram_user_id: Mapped[int] = mapped_column(BigInteger)
    private_username: Mapped[str | None] = mapped_column(Text)
    account_status: Mapped[str] = mapped_column(
        state_type("account_status", "active", "blocked"), server_default="active"
    )
    role_code: Mapped[str] = mapped_column(
        state_type("role_code", "user", "admin"), server_default="user"
    )
    version: Mapped[int] = mapped_column(server_default="1")
    profile: Mapped["Profile | None"] = relationship(viewonly=True, lazy="raise")
    plans: Mapped[list["Plan"]] = relationship(viewonly=True, lazy="raise")
    photos: Mapped[list["Photo"]] = relationship(viewonly=True, lazy="raise")


class AuthSession(IdentityMixin, Base):
    __tablename__ = "auth_sessions"
    __table_args__ = (
        CheckConstraint("length(token_hash) = 64", name="token_hash_length"),
        CheckConstraint("expires_at > authenticated_at", name="expiry_after_auth"),
        Index("ix_auth_sessions_user_expires", "user_id", "expires_at"),
    )
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    token_hash: Mapped[str] = mapped_column(Text, unique=True)
    csrf_token: Mapped[str] = mapped_column(Text)
    authenticated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
