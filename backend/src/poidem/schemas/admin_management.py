import re
import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

Role = Literal["user", "analyst", "moderator", "admin", "owner"]


class RoleWrite(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    role: Role
    version: int = Field(ge=1)
    confirm_user_id: uuid.UUID
    reason: str = Field(min_length=3, max_length=300)


class EditorialFields(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    title: str = Field(min_length=1, max_length=80)
    subtitle: str = Field(default="", max_length=500)
    category_code: str = Field(min_length=1, max_length=40)
    place: str = Field(default="", max_length=160)
    plan_title: str = Field(default="", max_length=80)
    tag: str = Field(default="", max_length=80)
    sort_order: int = Field(default=0, ge=0, le=1_000_000)


class EditorialCreate(EditorialFields):
    id: str = Field(min_length=1, max_length=64)

    @field_validator("id")
    @classmethod
    def slug(cls, value):
        if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", value):
            raise ValueError("Адрес: латинские буквы, цифры и дефисы")
        return value


class EditorialEdit(EditorialFields):
    version: int = Field(ge=1)


class EditorialCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: int = Field(ge=1)
    action: Literal["publish", "unpublish", "delete"]
    confirm_id: str
