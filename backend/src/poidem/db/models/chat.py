"""Переписка пары и персональное представление архива, без копий аккаунтов."""

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from poidem.db.base import Base, CreatedMixin, IdentityMixin


class ChatThread(Base):
    __tablename__ = "chat_threads"
    __table_args__ = (CheckConstraint("last_sequence >= 0", name="sequence_nonnegative"),)
    match_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("matches.id", ondelete="RESTRICT"), primary_key=True
    )
    last_sequence: Mapped[int] = mapped_column(BigInteger, server_default="0")


class ChatMessage(IdentityMixin, CreatedMixin, Base):
    __tablename__ = "chat_messages"
    __table_args__ = (
        Index("ix_chat_messages_created_id", "created_at", "id"),
        UniqueConstraint("match_id", "sequence", name="uq_chat_messages_sequence"),
        UniqueConstraint("match_id", "sender_id", "client_id", name="uq_chat_messages_retry"),
        CheckConstraint("sequence > 0", name="sequence_positive"),
        CheckConstraint("length(btrim(body)) BETWEEN 1 AND 2000", name="body_length"),
        Index("ix_chat_messages_sender_created", "sender_id", "created_at"),
    )
    match_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("chat_threads.match_id", ondelete="RESTRICT")
    )
    sender_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    client_id: Mapped[uuid.UUID]
    sequence: Mapped[int] = mapped_column(BigInteger)
    body: Mapped[str] = mapped_column(Text)


class ChatReadState(Base):
    __tablename__ = "chat_read_states"
    __table_args__ = (
        CheckConstraint("role IN ('author','responder')", name="participant_role"),
        CheckConstraint("last_read_sequence >= 0", name="sequence_nonnegative"),
    )
    match_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("chat_threads.match_id", ondelete="RESTRICT"), primary_key=True
    )
    role: Mapped[str] = mapped_column(Text, primary_key=True)
    last_read_sequence: Mapped[int] = mapped_column(BigInteger, server_default="0")
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ArchiveHidden(CreatedMixin, Base):
    __tablename__ = "archive_hidden"
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), primary_key=True
    )
    plan_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("plans.id", ondelete="RESTRICT"), primary_key=True
    )
