from datetime import date, datetime
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, field_validator, model_validator


class AnalyticsPeriod(BaseModel):
    model_config = ConfigDict(extra="forbid")
    start_date: date
    end_date: date
    time_zone: str = "Europe/Moscow"

    @field_validator("time_zone")
    @classmethod
    def valid_zone(cls, value):
        try:
            ZoneInfo(value)
        except (ValueError, ZoneInfoNotFoundError):
            raise ValueError("Неизвестный часовой пояс") from None
        return value

    @model_validator(mode="after")
    def valid_range(self):
        if not 0 <= (self.end_date - self.start_date).days < 366:
            raise ValueError("Выбери диапазон от 1 до 366 дней")
        if self.end_date > datetime.now(ZoneInfo(self.time_zone)).date():
            raise ValueError("Период не может заканчиваться в будущем")
        return self


UserSort = Literal["created", "name", "plans", "matches"]
PlanSort = Literal["created", "title", "meeting", "responses"]
