import uuid
from datetime import date, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StrictInt,
    field_validator,
    model_validator,
)

from poidem.schemas.place import CheckedPlace


class PlanFields(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    title: str = Field(min_length=1, max_length=80)
    category_code: str = Field(min_length=1, max_length=40)
    description: str = Field(default="", max_length=300)
    starts_at: AwareDatetime
    time_zone: str = Field(min_length=1, max_length=80)
    place: str = Field(default="", max_length=500)
    place_name: str | None = Field(None, min_length=1, max_length=160)
    place_address: str | None = Field(None, min_length=1, max_length=300)

    @model_validator(mode="after")
    def structured_place(self):
        if (self.place_name is None) != (self.place_address is None):
            raise ValueError("Укажи название места и адрес")
        if self.place_name is not None:
            self.place_name = " ".join(self.place_name.split())
            self.place_address = " ".join(self.place_address.split())
            self.place = f"{self.place_name} · {self.place_address}"
        if "\x00" in self.place or any(0xD800 <= ord(char) <= 0xDFFF for char in self.place):
            raise ValueError("Укажи место без неподдерживаемых символов")
        if not self.place.strip():
            raise ValueError("Укажи место встречи")
        return self

    selected_place_id: uuid.UUID | None = None

    @field_validator("time_zone")
    @classmethod
    def valid_zone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ValueError, ZoneInfoNotFoundError) as error:
            raise ValueError("Укажите существующий часовой пояс IANA") from error
        return value

    @field_validator("starts_at", mode="before")
    @classmethod
    def date_format(cls, value):
        if not isinstance(value, (str, datetime)):
            raise ValueError("Укажите дату RFC3339 с часовым смещением")
        return value


class PlanPatch(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    expected_version: StrictInt = Field(ge=1)
    title: str | None = Field(default=None, min_length=1, max_length=80)
    category_code: str | None = Field(default=None, min_length=1, max_length=40)
    description: str | None = Field(default=None, max_length=300)
    starts_at: AwareDatetime | None = None
    time_zone: str | None = Field(default=None, min_length=1, max_length=80)
    place: str | None = Field(default=None, min_length=1, max_length=500)
    place_name: str | None = Field(None, min_length=1, max_length=160)
    place_address: str | None = Field(None, min_length=1, max_length=300)
    selected_place_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def no_null_fields(self):
        if any(getattr(self, key) is None for key in self.model_fields_set - {"selected_place_id"}):
            raise ValueError("Поля плана не могут быть null")
        return self


class PlanCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: StrictInt = Field(ge=1)


class PlanAuthorDTO(BaseModel):
    id: uuid.UUID
    name: str


class PlanDTO(BaseModel):
    id: uuid.UUID
    author: PlanAuthorDTO
    title: str
    category_code: str
    description: str
    starts_at: datetime
    time_zone: str
    place: str
    place_name: str | None = None
    place_address: str | None = None
    place_check_status: str = "pending"
    venue: CheckedPlace | None = None
    selected_place_id: uuid.UUID | None = None
    place_status: str = "legacy"
    publication_status: str
    moderation_status: str
    created_at: datetime
    version: int
    image: str
    own: bool
    updated_at: datetime
    archived: bool = False
    allowed_actions: list[str] = Field(default_factory=list)


class PlanPage(BaseModel):
    items: list[PlanDTO]
    next_cursor: str | None = None


class PlanEnvelope(BaseModel):
    plan: PlanDTO


class QuotaDTO(BaseModel):
    maximum: int = 3
    used: int
    remaining: int
    day: date
    time_zone: str = "Europe/Moscow"
    resets_at: datetime
    policy_version: str = "plans-v1"
