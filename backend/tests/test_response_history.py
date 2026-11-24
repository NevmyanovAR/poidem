import importlib.util
import uuid
from datetime import datetime
from pathlib import Path

import pytest
from sqlalchemy import select
from test_accounts import clients as clients
from test_accounts import login
from test_connections import decide, published, respond
from test_plans import members as members

from poidem.db.models import Plan, PlanResponse, Profile

pytestmark = pytest.mark.database


def test_rejection_history_roles_are_server_owned_and_context_is_frozen(
    members, migration_engine, clients
):
    (a, aa), (b, bb) = members
    with migration_engine.begin() as connection:
        connection.execute(
            Profile.__table__.update()
            .where(Profile.user_id == uuid.UUID(aa["user"]["id"]))
            .values(name="Автор", age=26)
        )
        connection.execute(
            Profile.__table__.update()
            .where(Profile.user_id == uuid.UUID(bb["user"]["id"]))
            .values(name="Кандидат", age=24)
        )
    plan = published(members)
    entry = respond(b, bb, plan).json()["response"]
    assert entry["viewer_role"] == "responder"
    history = entry["history_context"]
    assert history["plan_title"] == plan["title"]
    assert (history["author_name"], history["responder_name"], history["responder_age"]) == (
        "Автор",
        "Кандидат",
        24,
    )
    assert history["source"] == "response"
    assert decide(a, aa, entry, "decline").json()["response"]["viewer_role"] == "author"
    with migration_engine.begin() as connection:
        connection.execute(
            Plan.__table__.update()
            .where(Plan.id == uuid.UUID(plan["id"]))
            .values(title="Позднее изменение")
        )
        connection.execute(Profile.__table__.update().values(name="Позднее имя", age=40))
    for client, expected in ((a, "author"), (b, "responder")):
        record = client.get(f"/api/v1/responses/{entry['id']}").json()["response"]
        assert record["history_context"] == history and record["viewer_role"] == expected
        assert record["profile"] is None and record["match"] is None
        if expected == "responder":
            assert record["plan"] is None
    assert b.get(f"/api/v1/plans/{plan['id']}/author/photo").status_code == 404
    assert respond(b, bb, plan).status_code == 409
    assert respond(b, bb, plan, viewer_role="author", history_context=history).status_code == 422
    c = clients()
    login(c, 303)
    assert c.get(f"/api/v1/responses/{entry['id']}").status_code == 404
    with migration_engine.connect() as connection:
        stored = connection.scalar(select(PlanResponse.history_context))
        assert datetime.fromisoformat(stored.pop("captured_at")) == datetime.fromisoformat(
            history["captured_at"]
        )
        assert stored == {key: value for key, value in history.items() if key != "captured_at"}


def test_accepted_response_embeds_same_match_and_authoritative_roles(members):
    (a, aa), (b, bb) = members
    plan = published(members)
    entry = respond(b, bb, plan).json()["response"]
    accepted = decide(a, aa, entry).json()["response"]
    identity = accepted["match_id"]
    for client, role in ((a, "author"), (b, "responder")):
        record = client.get(f"/api/v1/responses/{entry['id']}").json()["response"]
        match = client.get(f"/api/v1/matches/{identity}").json()["match"]
        assert record["viewer_role"] == role and match["viewer_role"] == role
        assert record["match"] == match


def test_legacy_capture_is_explicit_minimal_idempotent_and_preserves_existing_history(
    members, migration_engine
):
    (a, aa), (b, bb) = members
    plan = published(members)
    assert respond(b, bb, plan).status_code == 201
    path = (
        Path(__file__).resolve().parents[1] / "migrations/versions/0006_response_history_context.py"
    )
    spec = importlib.util.spec_from_file_location("response_history_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    with migration_engine.begin() as connection:
        assert migration.capture_legacy_context(connection).rowcount == 0
        connection.execute(PlanResponse.__table__.update().values(history_context=None))
        assert migration.capture_legacy_context(connection).rowcount == 1
        context = connection.scalar(select(PlanResponse.history_context))
        assert context["source"] == "legacy"
        assert set(context) == {
            "plan_title",
            "author_name",
            "responder_name",
            "responder_age",
            "captured_at",
            "source",
        }
        connection.execute(Plan.__table__.update().values(title="Дальнейшее изменение"))
        assert migration.capture_legacy_context(connection).rowcount == 0
        assert connection.scalar(select(PlanResponse.history_context)) == context
