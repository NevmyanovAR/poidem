from typing import Literal

from pydantic import BaseModel, ConfigDict


class HealthDTO(BaseModel):
    status: Literal["ok"] = "ok"
    database: Literal["ready"] = "ready"
    migrations: Literal["current"] = "current"


class LivenessDTO(BaseModel):
    status: Literal["ok"] = "ok"


class ReferenceItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    code: str
    title: str


class ReferenceDataDTO(BaseModel):
    categories: list[ReferenceItem]
    interests: list[ReferenceItem]
    gender_options: list[ReferenceItem]
    preference_options: list[ReferenceItem]
    # Никаких выдуманных timezone/scale/match policy.
    plan_daily_limit: Literal[3] = 3
    plan_response_limit: Literal[15] = 15
    business_operations_enabled: Literal[True] = True
