"""Синтетическое наполнение настоящего каталога только в отдельной *_test БД."""

import hashlib
import uuid
from datetime import UTC, datetime

from sqlalchemy.dialects.postgresql import insert

from poidem.db.models import PublicPlace
from poidem.schemas.place import PlaceProposal
from poidem.services.place_catalogue import fields


class FakePlaces:
    def __init__(self, engine):
        assert engine.url.database.endswith("_test")
        self.engine = engine

    def prepare(self, label):
        values = fields(
            PlaceProposal(name=label, address="улица 1", city="Тестовый город", category="museum")
        )
        identity = uuid.UUID(hashlib.sha256(values["dedupe_key"].encode()).hexdigest()[:32])
        with self.engine.begin() as connection:
            identity = connection.scalar(
                insert(PublicPlace)
                .values(id=identity, **values, status="approved", reviewed_at=datetime.now(UTC))
                .on_conflict_do_update(
                    constraint="uq_public_places_identity", set_={"status": "approved"}
                )
                .returning(PublicPlace.id)
            )
        return str(identity)


def chosen_fields(client, account, payload):
    """Старые тесты планов выбирают место через тот же защищённый API, без обхода сервера."""
    from test_accounts import headers

    result = dict(payload)
    label = result.get("place")
    if "selected_place_id" in result or not isinstance(label, str) or not label or len(label) > 160:
        return result
    cache = getattr(client, "_test_places", {})
    key = (account["user"]["id"], label)
    selected = cache.get(key)
    if selected is None:
        try:
            identity = client.app.state.test_places.prepare(label)
        except Exception as error:
            from poidem.api.errors import AppError

            if not isinstance(error, (AppError, ValueError)):
                raise
            return result
        response = client.post(
            "/api/v1/places/resolve", json={"provider_place_id": identity}, headers=headers(account)
        )
        if response.status_code != 200:
            return result  # Проверку запрещённого текста выполнит и сам API плана.
        selected = response.json()
        cache[key] = selected
        client._test_places = cache
    result["place"] = selected["place"]["name"] + " · " + selected["place"]["address"]
    result["selected_place_id"] = selected["selection_id"]
    return result
