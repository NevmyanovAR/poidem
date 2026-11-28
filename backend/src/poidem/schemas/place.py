import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, model_validator

PlaceCategory = Literal[
    "cafe", "restaurant", "bar", "museum", "gallery", "cinema", "theatre", "park", "culture"
]


class PlaceCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    provider: str = Field(min_length=1, max_length=20)
    provider_place_id: str = Field(min_length=1, max_length=2048)
    name: str = Field(min_length=1, max_length=160)
    address: str = Field(min_length=1, max_length=240)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    category: PlaceCategory
    category_label: str
    city: str | None = None
    status: Literal["pending", "approved", "rejected", "hidden"] | None = None
    catalogue_version: int | None = None
    moderation_reason: str | None = None


class CheckedPlace(PlaceCandidate):
    checked_at: datetime | None
    policy_version: str


class PlaceSelection(BaseModel):
    selection_id: uuid.UUID
    place: CheckedPlace


class PlaceSearchResult(BaseModel):
    items: list[PlaceCandidate]
    attribution: str


class PlaceResolve(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    provider_place_id: str = Field(min_length=1, max_length=2048)


class PlaceProposal(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: str = Field(min_length=2, max_length=160)
    address: str = Field(min_length=3, max_length=240)
    city: str = Field(min_length=2, max_length=100)
    category: PlaceCategory


class PlaceEdit(PlaceProposal):
    expected_version: StrictInt = Field(ge=1)
    reason: str = Field(min_length=3, max_length=300)
    public_access_confirmed: StrictBool = False


class PlaceDecision(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    expected_version: StrictInt = Field(ge=1)
    action: Literal["approve", "reject", "hide"]
    reason: str = Field(min_length=3, max_length=300)
    public_access_confirmed: StrictBool = False


class PlacesImport(BaseModel):
    model_config = ConfigDict(extra="forbid")
    csv: str = Field(min_length=1, max_length=65536)
    public_access_confirmed: StrictBool

    @model_validator(mode="after")
    def reviewed(self):
        if not self.public_access_confirmed:
            raise ValueError("Подтверди предварительную проверку объектов")
        return self


class PlanPlaceDecision(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    expected_revision: StrictInt = Field(ge=1)
    expected_version: StrictInt = Field(ge=1)
    decision: Literal["confirmed", "unconfirmed"]
    reason: str = Field(min_length=3, max_length=500)
    evidence_confirmed: StrictBool = False
