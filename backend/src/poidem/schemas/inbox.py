from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from poidem.schemas.connections import MatchDTO


class LastMessageDTO(BaseModel):
    text: str
    sender: Literal["self", "other"]
    created_at: datetime


class DialogDTO(BaseModel):
    match: MatchDTO
    last_message: LastMessageDTO | None
    last_activity_at: datetime


class DialogPage(BaseModel):
    items: list[DialogDTO]
    next_cursor: str | None = None


class NavigationDTO(BaseModel):
    pending_responses: int = Field(ge=0)
    unread_messages: int = Field(ge=0)
    unread_dialogs: int = Field(ge=0)
