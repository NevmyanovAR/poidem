import uuid
from datetime import datetime, timedelta

import pytest
from sqlalchemy import select
from test_accounts import clients as clients
from test_accounts import headers, login, profile, upload
from test_connections import decide, published, respond
from test_plans import create, publish
from test_plans import members as members

from poidem.db.models import PlanResponse
from poidem.services import plans

pytestmark = pytest.mark.database


def test_expiry_is_read_only_and_removes_response_from_active_feed(
    members, monkeypatch, migration_engine
):
    (a, aa), (b, bb) = members
    plan = published(members)
    entry = respond(b, bb, plan).json()["response"]
    assert entry["display_status"] == "waiting"
    monkeypatch.setattr(plans, "now", lambda: datetime.fromisoformat(plan["starts_at"]))
    for client in (a, b):
        result = client.get(f"/api/v1/responses/{entry['id']}").json()["response"]
        assert result["status"] == "waiting" and result["display_status"] == "expired"
        assert result["decided_at"] is None and result["profile"] is None
        assert not result["archived"]
        assert not any(
            item["kind"] in ("incoming", "outgoing")
            for item in client.get("/api/v1/me/activity").json()["items"]
        )
    assert decide(a, aa, entry, "accept").status_code == 409
    assert decide(a, aa, entry, "decline").status_code == 409
    with migration_engine.connect() as connection:
        stored = connection.execute(select(PlanResponse.status, PlanResponse.decided_at)).one()
        assert stored.status == "waiting" and stored.decided_at is None


def test_archive_owner_history_paginates_all_outcomes_without_changing_them(
    members, clients, migration_engine, monkeypatch
):
    (a, aa), (b, bb) = members
    c = clients()
    cc = login(c, 303)
    photo = upload(c, cc).json()
    assert c.put("/api/v1/me/profile", json=profile(photo), headers=headers(cc)).status_code == 200
    first = published(members)
    accepted = respond(b, bb, first).json()["response"]
    closed = respond(c, cc, first).json()["response"]
    assert decide(a, aa, accepted).status_code == 200
    second = publish(a, aa, create(a, aa).json()["plan"]).json()["plan"]
    rejected = respond(b, bb, second).json()["response"]
    expired = respond(c, cc, second).json()["response"]
    assert decide(a, aa, rejected, "decline").status_code == 200
    deadline = max(
        datetime.fromisoformat(plan["starts_at"]) for plan in (first, second)
    ) + timedelta(days=8)
    monkeypatch.setattr(plans, "now", lambda: deadline)
    seen = {}
    for plan in (first, second):
        cursor = None
        while True:
            result = a.get(
                f"/api/v1/plans/{plan['id']}/responses",
                params={"limit": 1, **({"cursor": cursor} if cursor else {})},
            )
            assert result.status_code == 200, result.text
            page = result.json()
            for item in page["items"]:
                assert item["archived"] and item["viewer_role"] == "author"
                assert item["history_context"]["responder_name"]
                assert item["created_at"]
                seen[item["id"]] = (item["status"], item["display_status"])
            cursor = page["next_cursor"]
            if not cursor:
                break
        assert b.get(f"/api/v1/plans/{plan['id']}/responses").status_code == 404
        assert clients().get(f"/api/v1/plans/{plan['id']}/responses").status_code == 401
    assert seen == {
        accepted["id"]: ("accepted", "accepted"),
        closed["id"]: ("closed", "closed"),
        rejected["id"]: ("rejected", "rejected"),
        expired["id"]: ("waiting", "expired"),
    }
    assert b.get(f"/api/v1/responses/{rejected['id']}").json()["response"]["plan"] is None
    assert decide(a, aa, expired).status_code == 409
    with migration_engine.connect() as connection:
        assert set(connection.scalars(select(PlanResponse.id))) == {
            uuid.UUID(identity) for identity in seen
        }
