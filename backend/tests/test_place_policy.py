import pytest
from pydantic import ValidationError

from poidem.api.errors import AppError
from poidem.schemas.place import PlaceProposal
from poidem.services.place_catalogue import fields, normalized
from poidem.services.place_policy import CATEGORIES


@pytest.mark.parametrize("category", CATEGORIES)
def test_only_public_categories_have_labels(category):
    assert (
        PlaceProposal(
            name="Тестовое место",
            address="Примерная улица, 1",
            city="Тестовый город",
            category=category,
        ).category
        in CATEGORIES
    )


@pytest.mark.parametrize("category", ["private", "residential", "hotel_room", "unknown", "adult"])
def test_unknown_and_private_categories_are_not_proposable(category):
    with pytest.raises(ValidationError):
        PlaceProposal(name="Место", address="Улица 1", city="Город", category=category)


def test_normalized_duplicate_key_ignores_case_spacing_and_punctuation():
    a = fields(
        PlaceProposal(name="Кафе «Пример»", address="Улица, 1", city="Город", category="cafe")
    )
    b = fields(PlaceProposal(name="КАФЕ ПРИМЕР", address="улица  1", city="ГОРОД", category="cafe"))
    assert a["dedupe_key"] == b["dedupe_key"]
    assert normalized("Ёлка") == "елка"
    c = fields(PlaceProposal(name="Кафе Пример", address="Улица 2", city="Город", category="cafe"))
    assert c["dedupe_key"] != a["dedupe_key"]


def test_control_characters_and_existing_forbidden_themes_are_rejected():
    for name in ("Кафе\x00Пример", "Стриптиз-клуб"):
        with pytest.raises((AppError, ValueError)):
            fields(PlaceProposal(name=name, address="Улица 1", city="Город", category="bar"))
