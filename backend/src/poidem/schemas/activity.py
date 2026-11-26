import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict

from poidem.schemas.connections import MatchDTO, ResponseDTO
from poidem.schemas.plan import PlanDTO


class ActivityItem(BaseModel):
    key: str
    kind: Literal["match", "incoming", "plan", "outgoing"]
    plan_id: uuid.UUID
    archived: bool
    hidden: bool
    pending_response_count: int = 0
    match_id: uuid.UUID | None = None
    history: bool = False
    plan: PlanDTO | None = None
    response: ResponseDTO | None = None
    match: MatchDTO | None = None


class ActivityPage(BaseModel):
    items: list[ActivityItem]
    next_cursor: str | None = None


class HiddenCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")
    hidden: bool
