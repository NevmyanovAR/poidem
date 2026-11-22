from sqlalchemy import Enum


def state_type(name: str, *values: str) -> Enum:
    """Строковые CHECK, не PostgreSQL ENUM: будущие состояния меняются миграциями."""
    return Enum(
        *values, name=name, native_enum=False, create_constraint=True, validate_strings=True
    )


def moderation_type() -> Enum:
    return state_type(
        "moderation_status", "not_submitted", "pending", "approved", "rejected", "blocked"
    )
