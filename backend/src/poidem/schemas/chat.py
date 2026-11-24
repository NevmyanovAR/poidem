import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator


class MessageCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    client_id: uuid.UUID
    text: str = Field(min_length=1, max_length=2000)

    @field_validator("text")
    @classmethod
    def meaningful_text(cls, value):
        if not value.strip() or any(ord(c) < 32 and c not in "\n\t\r" for c in value):
            raise ValueError("Напиши текст сообщения без служебных символов")
        return value


class MessageDTO(BaseModel):
    id: uuid.UUID
    sequence: int
    sender: Literal["self", "other"]
    text: str
    created_at: datetime
    client_id: uuid.UUID | None = None


class MessageEnvelope(BaseModel):
    message: MessageDTO


class MessagePage(BaseModel):
    items: list[MessageDTO]
    next_before: int | None = None
    has_more: bool = False


class ReadCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")
    through_sequence: StrictInt = Field(ge=0, le=9007199254740991)


class ChatDTO(BaseModel):
    match_id: uuid.UUID
    last_sequence: int
    last_read_sequence: int
    other_last_read_sequence: int
    unread_count: int
    can_send: bool
    meeting_cancelled: bool
    archived: bool
