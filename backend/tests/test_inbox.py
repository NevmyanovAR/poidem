import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session
from test_accounts import clients as clients
from test_accounts import headers, login
from test_chat_archive import paired, send
from test_connections import published, respond
from test_plans import create
from test_plans import members as members
from test_safety import block, context

from poidem.db.models import ChatMessage, Match, Plan

pytestmark = pytest.mark.database


def test_dialogs_use_existing_messages_and_private_read_states(members, clients):
    (a, aa), (b, bb) = members
    _, identity = paired(members)
    empty = a.get("/api/v1/me/chats").json()["items"]
    assert len(empty) == 1 and empty[0]["last_message"] is None
    assert empty[0]["match"]["id"] == identity
    own = a.get("/api/v1/me/activity?view=own").json()["items"][0]
    assert own["match_id"] == identity and own["history"] is True
    assert own["pending_response_count"] == 0
    assert send(a, aa, identity, "Тестовое первое сообщение").status_code == 201
    assert send(a, aa, identity, "Тестовое последнее сообщение").status_code == 201
    a_nav = a.get("/api/v1/me/navigation").json()
    assert a_nav["unread_messages"] == 0
    assert b.get("/api/v1/me/navigation").json() == {
        "pending_responses": 0,
        "unread_messages": 2,
        "unread_dialogs": 1,
    }
    view = b.get("/api/v1/me/chats").json()["items"][0]
    assert view["last_message"]["text"] == "Тестовое последнее сообщение"
    assert view["last_message"]["sender"] == "other"
    assert view["match"]["unread_count"] == 2
    assert (
        b.post(
            f"/api/v1/matches/{identity}/read", json={"through_sequence": 2}, headers=headers(bb)
        ).status_code
        == 200
    )
    assert b.get("/api/v1/me/navigation").json()["unread_messages"] == 0
    c = clients()
    login(c, 303)
    assert c.get("/api/v1/me/chats").json()["items"] == []
    assert "Тестовое последнее сообщение" not in c.get("/api/v1/me/chats").text
    for path in ("/api/v1/me/chats", "/api/v1/me/navigation"):
        assert clients().get(path).status_code == 401


def test_dialog_order_and_pagination_use_global_last_activity(members, migration_engine):
    (a, aa), (b, bb) = members
    ids = [paired(members)[1] for _ in range(3)]
    for identity in ids[:2]:
        assert send(b, bb, identity).status_code == 201
    base = datetime.now(UTC)
    with Session(migration_engine) as session:
        for number, identity in enumerate(ids):
            session.get(Match, uuid.UUID(identity)).created_at = base - timedelta(days=10 - number)
        for number, identity in enumerate(ids[:2]):
            session.scalar(
                select(ChatMessage).where(ChatMessage.match_id == uuid.UUID(identity))
            ).created_at = base - timedelta(hours=number)
        session.commit()
    page = a.get("/api/v1/me/chats?limit=1").json()
    assert page["items"][0]["match"]["id"] == ids[0]
    assert a.get("/api/v1/me/navigation").json()["unread_dialogs"] == 2
    assert b.get("/api/v1/me/chats", params={"cursor": page["next_cursor"]}).status_code == 422
    found = [ids[0]]
    while page["next_cursor"]:
        page = a.get("/api/v1/me/chats", params={"cursor": page["next_cursor"], "limit": 1}).json()
        found.extend(item["match"]["id"] for item in page["items"])
    assert found == [ids[0], ids[1], ids[2]]
    assert a.get("/api/v1/me/chats?cursor=bad").status_code == 422


def test_own_view_prioritizes_actions_future_draft_history_across_pages(members, migration_engine):
    (a, aa), (b, bb) = members
    first = published(members)
    second = published(members)
    assert respond(b, bb, first).status_code == 201
    with Session(migration_engine) as session:
        session.get(Plan, uuid.UUID(first["id"])).starts_at += timedelta(days=3)
        session.commit()
    assert a.get("/api/v1/me/navigation").json()["pending_responses"] == 1
    page = a.get("/api/v1/me/activity?view=own&limit=1").json()
    assert page["items"][0]["plan_id"] == first["id"]
    assert page["items"][0]["pending_response_count"] == 1
    assert a.get("/api/v1/me/activity", params={"cursor": page["next_cursor"]}).status_code == 422
    next_page = a.get(
        "/api/v1/me/activity", params={"view": "own", "cursor": page["next_cursor"]}
    ).json()
    assert next_page["items"][0]["plan_id"] == second["id"]
    with Session(migration_engine) as session:
        session.get(Plan, uuid.UUID(first["id"])).publication_status = "closed"
        session.commit()
    rows = a.get("/api/v1/me/activity?view=own").json()["items"]
    assert [row["plan_id"] for row in rows] == [second["id"], first["id"]]
    assert rows[1]["history"] is True
    assert a.get("/api/v1/me/navigation").json()["pending_responses"] == 0
    assert b.get("/api/v1/me/activity?view=own").json()["items"] == []


def test_blocking_and_archiving_keep_chat_history_without_fake_unreads(members, migration_engine):
    (a, aa), (b, bb) = members
    plan, identity = paired(members)
    assert send(b, bb, identity).status_code == 201
    block(a, aa, context(identity, "chat", "match"))
    with Session(migration_engine) as session:
        session.get(Plan, uuid.UUID(plan["id"])).archived_at = datetime.now(UTC)
        session.commit()
    assert (
        a.post(
            f"/api/v1/me/archive/{plan['id']}/visibility",
            json={"hidden": True},
            headers=headers(aa),
        ).status_code
        == 204
    )
    row = a.get("/api/v1/me/chats").json()["items"][0]
    assert row["last_message"]["text"] == "Привет!"
    assert row["match"]["archived"] is True
    assert a.get("/api/v1/me/navigation").json()["unread_messages"] == 1
    assert send(b, bb, identity).status_code == 403


def test_own_order_draft_history_nearest_and_archive_filter(members, migration_engine):
    (a, aa), _ = members
    later, nearer = published(members), published(members)
    draft = create(a, aa).json()["plan"]
    with Session(migration_engine) as session:
        session.get(Plan, uuid.UUID(later["id"])).starts_at += timedelta(days=2)
        session.commit()
    rows = a.get("/api/v1/me/activity?view=own").json()["items"]
    assert [row["plan_id"] for row in rows] == [nearer["id"], later["id"], draft["id"]]
    with Session(migration_engine) as session:
        for identity in (nearer["id"], later["id"]):
            plan = session.get(Plan, uuid.UUID(identity))
            plan.publication_status = "closed"
            plan.updated_at = datetime.now(UTC) - timedelta(days=3)
        session.get(Plan, uuid.UUID(nearer["id"])).starts_at = datetime.now(UTC) - timedelta(
            hours=1
        )
        session.commit()
    rows = a.get("/api/v1/me/activity?view=own").json()["items"]
    assert [row["plan_id"] for row in rows] == [draft["id"], nearer["id"], later["id"]]
    assert [row["history"] for row in rows] == [False, True, True]
    filtered = a.get(f"/api/v1/me/activity?view=own&plan_id={later['id']}").json()["items"]
    assert [row["plan_id"] for row in filtered] == [later["id"]]
    with Session(migration_engine) as session:
        session.get(Plan, uuid.UUID(nearer["id"])).archived_at = datetime.now(UTC)
        session.commit()
    active = a.get("/api/v1/me/activity?view=own").json()["items"]
    archived = a.get("/api/v1/me/activity?view=own&scope=archive").json()["items"]
    assert nearer["id"] not in [row["plan_id"] for row in active]
    assert [row["plan_id"] for row in archived] == [nearer["id"]]


def test_actionable_count_excludes_expiry_moderation_and_personal_block(members, migration_engine):
    (a, aa), (b, bb) = members
    plan = published(members)
    assert respond(b, bb, plan).status_code == 201

    def count():
        return a.get("/api/v1/me/navigation").json()["pending_responses"]

    assert count() == 1
    with Session(migration_engine) as session:
        record = session.get(Plan, uuid.UUID(plan["id"]))
        original = record.starts_at
        record.starts_at = datetime.now(UTC) - timedelta(minutes=1)
        session.commit()
    assert count() == 0
    with Session(migration_engine) as session:
        record = session.get(Plan, uuid.UUID(plan["id"]))
        record.starts_at = original
        record.moderation_status = "blocked"
        session.commit()
    assert count() == 0
    with Session(migration_engine) as session:
        session.get(Plan, uuid.UUID(plan["id"])).moderation_status = "not_submitted"
        session.commit()
    assert count() == 1
    reply = a.get("/api/v1/me/responses?direction=incoming").json()["items"][0]
    block(a, aa, context(reply["id"], "profile", "response"))
    assert count() == 0
