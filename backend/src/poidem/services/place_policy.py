"""Категории собственного каталога. Публичную доступность подтверждает модератор."""

import unicodedata

from poidem.schemas.place import PlaceCandidate

POLICY_VERSION = "local-catalog-v1"
CATEGORIES = {
    "cafe": "Кафе и кофейня",
    "restaurant": "Ресторан",
    "bar": "Бар",
    "museum": "Музей",
    "gallery": "Галерея",
    "cinema": "Кинотеатр",
    "theatre": "Театр",
    "park": "Парк и общественное пространство",
    "culture": "Культурное пространство",
}


def clean(value: str) -> str:
    if any(unicodedata.category(char).startswith("C") for char in value):
        raise ValueError("Control characters in place data")
    return " ".join(unicodedata.normalize("NFKC", value).split())


def place_label(place: PlaceCandidate) -> str:
    return f"{place.name} · {place.address}"
