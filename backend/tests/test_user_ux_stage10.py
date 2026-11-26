import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.orm import Session
from test_accounts import clients as clients
from test_accounts import headers
from test_connections import published, respond
from test_plans import create
from test_plans import members as members

from poidem.db.models import Plan, Profile

pytestmark = pytest.mark.database


def test_plan_actions_are_owner_only_and_match_existing_commands(members):
    (a, aa), (b, _) = members
    draft = create(a, aa).json()["plan"]
    assert draft["allowed_actions"] == ["edit", "cancel", "publish"]
    plan = published(members)
    own = a.get(f"/api/v1/plans/{plan['id']}").json()["plan"]
    assert own["allowed_actions"] == ["edit", "cancel"]
    assert b.get(f"/api/v1/plans/{plan['id']}").json()["plan"]["allowed_actions"] == []
    assert b.get("/api/v1/plans").json()["items"][0]["allowed_actions"] == []
    own_items = a.get("/api/v1/me/activity?view=own").json()["items"]
    assert all(item["plan"]["allowed_actions"] for item in own_items)


def test_historical_rejection_does_not_restore_edit_or_cancel(members):
    (a, aa), (b, bb) = members
    plan = published(members)
    response = respond(b, bb, plan).json()["response"]
    path = f"/api/v1/responses/{response['id']}/decision"
    assert (
        a.post(
            path,
            json={"decision": "decline", "expected_version": response["version"]},
            headers=headers(aa),
        ).status_code
        == 200
    )
    assert a.get(f"/api/v1/plans/{plan['id']}").json()["plan"]["allowed_actions"] == []
    own = a.get("/api/v1/me/plans").json()["items"][0]
    assert own["allowed_actions"] == []
    assert (
        a.post(
            f"/api/v1/plans/{plan['id']}/cancel",
            json={"expected_version": own["version"]},
            headers=headers(aa),
        ).status_code
        == 409
    )


@pytest.mark.parametrize("restricted", ["plan", "profile", "archive", "closed"])
def test_restricted_own_record_does_not_offer_actions(members, migration_engine, restricted):
    (a, aa), _ = members
    plan = published(members)
    with Session(migration_engine) as session:
        entry = session.get(Plan, uuid.UUID(plan["id"]))
        if restricted == "plan":
            entry.moderation_status = "blocked"
        elif restricted == "profile":
            session.get(Profile, uuid.UUID(aa["user"]["id"])).moderation_status = "blocked"
        elif restricted == "archive":
            entry.archived_at = datetime.now(UTC)
        else:
            entry.publication_status = "closed"
        session.commit()
    assert a.get(f"/api/v1/plans/{plan['id']}").json()["plan"]["allowed_actions"] == []


def test_archive_uses_newest_history_across_pages_not_meeting_date(members, migration_engine):
    (a, _), _ = members
    first, second = published(members), published(members)
    at = datetime.now(UTC)
    with Session(migration_engine) as session:
        for number, record in enumerate([first, second]):
            entry = session.get(Plan, uuid.UUID(record["id"]))
            entry.archived_at = at - timedelta(days=2 - number)
            entry.publication_status = "cancelled"
            entry.updated_at = entry.archived_at
            entry.starts_at = at + timedelta(days=20 + number)
        session.commit()
    for view in ["all", "own"]:
        page = a.get(f"/api/v1/me/activity?scope=archive&view={view}&limit=1").json()
        assert page["items"][0]["plan_id"] == second["id"]
        following = a.get(
            "/api/v1/me/activity",
            params={"scope": "archive", "view": view, "limit": 1, "cursor": page["next_cursor"]},
        ).json()
        assert following["items"][0]["plan_id"] == first["id"]
        assert following["next_cursor"] is None
