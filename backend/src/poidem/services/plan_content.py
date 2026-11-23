"""Авторитетный серверный фильтр всех текстовых полей плана."""

from poidem.api.errors import AppError
from poidem.services.content_context import context_error
from poidem.services.content_language import has_profanity


def content_errors(**fields: str) -> dict[str, str]:
    errors: dict[str, str] = {}
    for field, value in fields.items():
        if has_profanity(value):
            errors[field] = "Убери мат и грубые оскорбления из текста плана"
        elif contextual := context_error(value):
            errors[field] = contextual
    return errors


def validate_content(*, title: str, description: str, place: str) -> None:
    fields = {"title": title, "description": description, "place": place}
    errors = content_errors(**fields)
    combined = content_errors(combined=" ".join(fields.values())) if not errors else {}
    if combined:
        errors = dict.fromkeys(fields, next(iter(combined.values())))
    if errors:
        raise AppError(422, "PLAN_CONTENT_REJECTED", next(iter(errors.values())), errors)
