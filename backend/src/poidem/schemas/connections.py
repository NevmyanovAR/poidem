import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt

from poidem.schemas.plan import PlanDTO


class PublicPhotoDTO(BaseModel):
    url: str


class PublicProfileDTO(BaseModel):
    name: str
    age: int
    bio: str
    interests: list[str]
    photo: PublicPhotoDTO


class PublicProfileEnvelope(BaseModel):
    profile: PublicProfileDTO


class ResponseCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_plan_version: StrictInt = Field(ge=1)


class ResponseDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: StrictInt = Field(ge=1)
    decision: Literal["accept", "decline"]


class CapacityDTO(BaseModel):
    count: int
    maximum: int = 15
    remaining: int
    can_respond: bool
    own_response_id: uuid.UUID | None = None


class ResponseHistoryDTO(BaseModel):
    plan_title: str
    author_name: str
    responder_name: str
    responder_age: int
    captured_at: datetime
    source: Literal["response", "legacy"]


class ResponseDTO(BaseModel):
    id: uuid.UUID
    plan_id: uuid.UUID
    plan: PlanDTO | None
    status: str
    display_status: Literal[
        "waiting", "accepted", "rejected", "closed", "expired", "cancelled", "unavailable"
    ]
    version: int
    created_at: datetime
    decided_at: datetime | None = None
    profile: PublicProfileDTO | None
    match_id: uuid.UUID | None = None
    archived: bool = False
    viewer_role: Literal["author", "responder"]
    history_context: ResponseHistoryDTO | None = None
    match: "MatchDTO | None" = None


class ResponseEnvelope(BaseModel):
    response: ResponseDTO


class ResponsePage(BaseModel):
    items: list[ResponseDTO]
    next_cursor: str | None = None


class ParticipantDTO(BaseModel):
    role: Literal["author", "responder"]
    profile: PublicProfileDTO | None


class MatchDTO(BaseModel):
    id: uuid.UUID
    plan_id: uuid.UUID
    title: str
    image: str
    starts_at: datetime
    time_zone: str
    place: str
    created_at: datetime
    participants: list[ParticipantDTO] = Field(min_length=2, max_length=2)
    unread_count: int = 0
    archived: bool = False
    meeting_cancelled: bool = False
    viewer_role: Literal["author", "responder"]


class MatchEnvelope(BaseModel):
    match: MatchDTO


class MatchPage(BaseModel):
    items: list[MatchDTO]
    next_cursor: str | None = None


class ContactDTO(BaseModel):
    available: bool
    telegram_url: str | None = None
    reason: str | None = None
