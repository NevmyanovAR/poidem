from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, model_validator


class FeedbackWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    met: StrictBool
    rating: StrictInt | None = Field(None, ge=1, le=5)
    comment: str | None = Field(None, max_length=2000)

    @model_validator(mode="after")
    def validate_answer(self):
        self.comment = self.comment.strip() or None if self.comment is not None else None
        if self.met and self.rating is None:
            raise ValueError("После ответа «Да» выбери оценку от 1 до 5")
        if not self.met and (self.rating is not None or self.comment is not None):
            raise ValueError("При ответе «Нет» оценка и комментарий не указываются")
        return self


class OwnFeedbackDTO(BaseModel):
    met: bool | None
    rating: int | None
    comment: str | None
    submitted: bool
    updated_at: datetime


class MeetingResultDTO(BaseModel):
    result: Literal["mutual_yes", "mutual_no", "insufficient", "conflicting", "no_data"]
    author_answered: bool
    responder_answered: bool


class SurveyDTO(BaseModel):
    availability: Literal[
        "not_scheduled", "upcoming", "available", "expired", "cancelled", "unavailable"
    ]
    opens_at: datetime | None
    closes_at: datetime | None
    can_answer: bool
    own_answer: OwnFeedbackDTO | None
    other_answered: bool
    result: MeetingResultDTO
    policy_version: str | None


class ExperienceDTO(BaseModel):
    pleasant_communication: bool = False
    unique_confirmed_partners: int = Field(ge=0)
    policy_version: Literal["D58-mutual-unique-partners-v1"] = "D58-mutual-unique-partners-v1"


class ImpressionWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    options: list[Literal["pleasant", "interesting", "comfortable"]] = Field(max_length=3)
    consent_accepted: StrictBool
    consent_version: Literal["positive-impressions-v1"]

    @model_validator(mode="after")
    def voluntary(self):
        if len(set(self.options)) != len(self.options) or (
            self.options and not self.consent_accepted
        ):
            raise ValueError("Выбери разные варианты и подтверди влияние на публичную отметку")
        return self
