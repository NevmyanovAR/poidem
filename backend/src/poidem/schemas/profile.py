import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator


class TelegramLogin(BaseModel):
    model_config = ConfigDict(extra="forbid")
    init_data: str = Field(min_length=1, max_length=16384)


class ProfileWrite(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    expected_version: StrictInt = Field(ge=0)
    name: str = Field(min_length=1, max_length=40)
    age: StrictInt = Field(ge=18, le=2**53 - 1)
    gender_code: Literal["woman", "man", "other"]
    preference_code: Literal["women", "men", "any"]
    bio: str = Field(min_length=1, max_length=300)
    photo_id: uuid.UUID
    interest_ids: list[str] = Field(min_length=3, max_length=3)

    @field_validator("interest_ids")
    @classmethod
    def unique_interests(cls, values: list[str]) -> list[str]:
        if len(set(values)) != 3:
            raise ValueError("Выбери три разных интереса")
        return values


class PhotoDTO(BaseModel):
    id: uuid.UUID
    url: str
    processing_status: Literal["ready"] = "ready"


class OwnProfileDTO(BaseModel):
    photo_verified: bool = False
    user_id: uuid.UUID
    name: str
    age: int
    gender_code: str
    preference_code: str
    bio: str
    photo: PhotoDTO
    interest_ids: list[str]
    version: int
    moderation_status: str


class ProfileEnvelope(BaseModel):
    profile: OwnProfileDTO | None
