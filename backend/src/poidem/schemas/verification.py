from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, model_validator


class VerificationConsent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    consent_version: str = Field(min_length=1, max_length=80)
    consent_accepted: StrictBool

    @model_validator(mode="after")
    def consent(self):
        if not self.consent_accepted:
            raise ValueError("Нужно согласие на обработку снимка")
        return self


class VerificationDecision(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    expected_version: StrictInt = Field(ge=1)
    decision: Literal["approved", "rejected"]
    reason_code: (
        Literal["face_mismatch", "face_unclear", "instruction_mismatch", "insufficient", "other"]
        | None
    ) = None
    comment: str | None = Field(default=None, max_length=300)

    @model_validator(mode="after")
    def reason(self):
        if self.decision == "rejected" and (
            not self.reason_code or self.reason_code == "other" and not self.comment
        ):
            raise ValueError("Выбери причину, для другой причины добавь комментарий")
        if self.decision == "approved" and (self.reason_code or self.comment):
            raise ValueError("Одобрение не содержит причины отказа")
        return self


class VerificationWithdrawal(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: StrictInt = Field(ge=1)
