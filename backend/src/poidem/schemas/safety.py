import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

Reason = Literal["content", "harassment", "fraud", "fake", "danger", "other"]
Target = Literal["profile", "plan", "match", "chat", "message"]
ReportTarget = Literal["profile", "plan", "match", "chat"]


class SafetyContext(BaseModel):
    model_config = ConfigDict(extra="forbid")
    target_type: ReportTarget
    context_type: Literal["plan", "response", "match"]
    context_id: uuid.UUID


class ReportWrite(SafetyContext):
    reason_code: Reason
    comment: str | None = Field(None, max_length=1000)

    @field_validator("comment")
    @classmethod
    def clean(cls, value):
        return value.strip() or None if value is not None else None


class AdminDecisionWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["dismiss", "hide_plan"]
    reason: str = Field(min_length=3, max_length=1000)

    @field_validator("reason")
    @classmethod
    def clean(cls, value):
        value = value.strip()
        if len(value) < 3:
            raise ValueError("Укажи причину решения")
        return value
