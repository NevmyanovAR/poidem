import asyncio
import base64
import json
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select
from test_accounts import ORIGIN, headers, login
from test_accounts import clients as clients
from test_connections import decide, published, respond
from test_plans import create, publish
from test_plans import members as members
from test_telegram_validation import signed_data

from poidem.db.models import ChatMessage, ChatThread, Plan, User
from poidem.db.session import Database
from poidem.services import archive, plans

pytestmark = pytest.mark.database


def paired(members):
    (a, aa), (b, bb) = members
    plan = published(members)
    response = respond(b, bb, plan).json()["response"]
    result = decide(a, aa, response)
    assert result.status_code == 200, result.text
    return plan, result.json()["response"]["match_id"]


def send(client, account, match_id, text="Привет!", client_id=None):
    return client.post(
        f"/api/v1/matches/{match_id}/messages",
        json={"text": text, "client_id": str(client_id or uuid.uuid4())},
        headers=headers(account),
    )


def activity(client, scope="active", **params):
    return client.get("/api/v1/me/activity", params={"scope": scope, **params})


def test_chat_exists_without_username_and_has_no_private_fields(members, migration_engine, clients):
    (a, aa), (b, bb) = members
    _, match_id = paired(members)
    with migration_engine.begin() as connection:
        connection.execute(User.__table__.update().values(private_username=None))
        assert connection.scalar(select(func.count()).select_from(ChatThread)) == 1
    assert b.get(f"/api/v1/matches/{match_id}/contact").json()["available"] is False
    assert a.get(f"/api/v1/matches/{match_id}/chat").json()["can_send"] is True
    result = send(b, bb, match_id)
    assert result.status_code == 201, result.text
    for private in ("sender_id", "telegram", "phone", "photo", "storage_key"):
        assert private not in result.text
    c = clients()
    login(c, 303)
    for suffix in ("/chat", "/messages"):
        assert c.get(f"/api/v1/matches/{match_id}" + suffix).status_code == 404
    cc = login(c, 303)
    assert send(c, cc, match_id).status_code == 404
    assert (
        c.post(
            f"/api/v1/matches/{match_id}/read", json={"through_sequence": 1}, headers=headers(cc)
        ).status_code
        == 404
    )
    assert clients().get(f"/api/v1/matches/{match_id}/messages").status_code == 401
    assert (
        a.post(
            f"/api/v1/matches/{match_id}/messages",
            json={"text": "x", "client_id": str(uuid.uuid4())},
        ).status_code
        == 403
    )


def test_chat_history_pagination_read_receipts_and_reopening(members):
    (a, aa), (b, bb) = members
    _, identity = paired(members)
    for number in range(8):
        assert send(a, aa, identity, f"Сообщение {number}").status_code == 201
    base = f"/api/v1/matches/{identity}"
    assert b.get(base + "/chat").json()["unread_count"] == 8
    newest = b.get(base + "/messages?limit=3").json()
    assert [item["sequence"] for item in newest["items"]] == [6, 7, 8]
    assert newest["next_before"] == 6
    older = b.get(base + "/messages?before=6&limit=3").json()
    assert [item["sequence"] for item in older["items"]] == [3, 4, 5]
    after = b.get(base + "/messages?after=3&limit=2").json()
    assert [item["sequence"] for item in after["items"]] == [4, 5] and after["has_more"]
    assert b.get(base + "/messages?after=3&before=5").status_code == 422
    read = b.post(base + "/read", json={"through_sequence": 6}, headers=headers(bb))
    assert read.status_code == 200 and read.json()["unread_count"] == 2
    b.post(base + "/read", json={"through_sequence": 2}, headers=headers(bb))
    assert b.get(base + "/chat").json()["last_read_sequence"] == 6
    assert a.get(base + "/chat").json()["other_last_read_sequence"] == 6
    assert (
        b.post(base + "/read", json={"through_sequence": 99}, headers=headers(bb)).status_code
        == 422
    )
    login(b, 202)
    assert b.get(base + "/chat").json()["last_read_sequence"] == 6
    assert len(b.get(base + "/messages").json()["items"]) == 8
    assert a.get(base + "/chat").json()["unread_count"] == 0
    assert b.get("/api/v1/me/matches").json()["items"][0]["unread_count"] == 2


def test_message_idempotency_concurrency_validation_and_rate_limit(members, migration_engine):
    (a, aa), _ = members
    _, match_id = paired(members)
    key = uuid.uuid4()
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda _: send(a, aa, match_id, client_id=key), range(4)))
    assert sorted(result.status_code for result in results) == [200, 200, 200, 201]
    assert len({result.json()["message"]["id"] for result in results}) == 1
    assert send(a, aa, match_id, "Другой текст", key).status_code == 409
    for text in ("", "   ", "x" * 2001, "x\x00y"):
        assert send(a, aa, match_id, text).status_code == 422
    # Экранирование текста выполняет React; сервер сохраняет текст, а не HTML-разметку.
    assert send(a, aa, match_id, '<script>alert("x")</script>').status_code == 201
    maximum = a.app.state.settings.chat_messages_per_minute
    for number in range(maximum - 2):
        assert send(a, aa, match_id, str(number)).status_code == 201
    limited = send(a, aa, match_id)
    assert limited.status_code == 429 and limited.headers["retry-after"]
    assert send(a, aa, match_id, client_id=key).status_code == 200
    with migration_engine.connect() as connection:
        assert connection.scalar(select(func.count()).select_from(ChatMessage)) == maximum
        assert connection.scalar(select(ChatThread.last_sequence)) == maximum


def test_restricted_peer_disables_new_messages_but_keeps_history(members, migration_engine):
    (a, aa), (_, bb) = members
    _, identity = paired(members)
    assert send(a, aa, identity).status_code == 201
    with migration_engine.begin() as connection:
        connection.execute(
            User.__table__.update()
            .where(User.id == uuid.UUID(bb["user"]["id"]))
            .values(account_status="blocked")
        )
    assert a.get(f"/api/v1/matches/{identity}/chat").json()["can_send"] is False
    assert send(a, aa, identity).status_code == 403
    assert len(a.get(f"/api/v1/matches/{identity}/messages").json()["items"]) == 1
    assert a.delete("/api/v1/me", headers=headers(aa)).status_code == 409


def test_cancellation_archive_hiding_restore_and_no_active_hiding(members):
    (a, aa), (b, bb) = members
    plan = published(members)
    path = f"/api/v1/me/archive/{plan['id']}/visibility"
    assert a.post(path, json={"hidden": True}, headers=headers(aa)).status_code == 404
    result = a.post(
        f"/api/v1/plans/{plan['id']}/cancel",
        json={"expected_version": plan["version"]},
        headers=headers(aa),
    )
    assert result.status_code == 200 and result.json()["plan"]["archived"]
    assert not activity(a).json()["items"]
    assert len(activity(a, "archive").json()["items"]) == 1
    assert b.post(path, json={"hidden": True}, headers=headers(bb)).status_code == 404
    for _ in range(2):
        assert a.post(path, json={"hidden": True}, headers=headers(aa)).status_code == 204
    assert not activity(a, "archive").json()["items"]
    assert activity(a, "archive", include_hidden=True).json()["items"][0]["hidden"] is True
    assert a.post(path, json={"hidden": False}, headers=headers(aa)).status_code == 204
    assert len(activity(a, "archive").json()["items"]) == 1


def test_calendar_archive_dst_background_and_chat_preservation(
    members, migration_engine, api_settings, monkeypatch
):
    (a, aa), (b, bb) = members
    plan, identity = paired(members)
    assert send(a, aa, identity).status_code == 201
    starts = datetime(2027, 3, 7, 15, tzinfo=UTC)  # 10:00 EST; через неделю 10:00 EDT
    deadline = datetime(2027, 3, 14, 14, tzinfo=UTC)
    with migration_engine.begin() as connection:
        connection.execute(
            Plan.__table__.update()
            .where(Plan.id == uuid.UUID(plan["id"]))
            .values(starts_at=starts, time_zone="America/New_York")
        )
    monkeypatch.setattr(plans, "now", lambda: deadline - timedelta(seconds=1))
    assert len(activity(a).json()["items"]) == 1
    assert not activity(a, "archive").json()["items"]
    monkeypatch.setattr(plans, "now", lambda: deadline)
    assert not activity(a).json()["items"]
    assert len(activity(a, "archive").json()["items"]) == 1

    async def background():
        database = Database(api_settings)
        try:
            async with database.sessions() as session:
                await archive.archive_due(session)
                assert await archive.archive_due(session) == 0
        finally:
            await database.close()

    with asyncio.Runner(loop_factory=asyncio.SelectorEventLoop) as runner:
        runner.run(background())
    with migration_engine.connect() as connection:
        stored = connection.execute(select(Plan.archived_at, Plan.publication_status)).one()
        assert stored.archived_at is not None and stored.publication_status == "closed"
    assert send(b, bb, identity, "Переписка доступна из архива").status_code == 201
    assert len(a.get(f"/api/v1/matches/{identity}/messages").json()["items"]) == 2
    assert (
        a.post(
            f"/api/v1/me/archive/{plan['id']}/visibility",
            json={"hidden": True},
            headers=headers(aa),
        ).status_code
        == 204
    )
    assert not activity(a, "archive").json()["items"]
    assert len(activity(b, "archive").json()["items"]) == 1
    assert a.get(f"/api/v1/matches/{identity}/chat").status_code == 200
    with migration_engine.begin() as connection:
        connection.execute(Plan.__table__.update().values(publication_status="cancelled"))
    assert b.get(f"/api/v1/matches/{identity}/chat").json()["meeting_cancelled"] is True


def test_all_priority_and_server_pagination_are_stable(members):
    (a, aa), (b, bb) = members
    _, identity = paired(members)
    next_plan = publish(a, aa, create(a, aa).json()["plan"]).json()["plan"]
    incoming = respond(b, bb, next_plan).json()["response"]
    draft = create(a, aa).json()["plan"]
    their = publish(b, bb, create(b, bb).json()["plan"]).json()["plan"]
    outgoing = respond(a, aa, their).json()["response"]
    response = activity(a)
    assert response.status_code == 200, response.text
    items = response.json()["items"]
    assert [item["key"] for item in items] == [
        f"match:{identity}",
        f"incoming:{incoming['id']}",
        f"plan:{next_plan['id']}",
        f"outgoing:{outgoing['id']}",
        f"plan:{draft['id']}",
    ]
    seen, cursor = [], None
    while True:
        page = activity(a, limit=1, **({"cursor": cursor} if cursor else {})).json()
        seen.extend(item["key"] for item in page["items"])
        cursor = page["next_cursor"]
        if not cursor:
            break
    assert seen == [item["key"] for item in items]
    assert activity(a).json()["items"] == items
    assert activity(b).json()["items"][0]["key"] == f"match:{identity}"
    assert activity(a, cursor="malformed").status_code == 422
    for priority, stamp in ((float("inf"), "0"), (0, "1e10000000"), (0, "NaN")):
        forged = base64.urlsafe_b64encode(
            json.dumps(["active", False, priority, stamp, str(uuid.uuid4()), "match"]).encode()
        ).decode()
        assert activity(a, cursor=forged).status_code == 422


def test_many_drafts_sort_by_modified_time_across_pages(members, migration_engine):
    (a, aa), _ = members
    at = plans.now()
    identities = [uuid.uuid4() for _ in range(27)]
    # Только изолированная *_test БД: проверяется серверная пагинация, не обход квоты UI.
    with migration_engine.begin() as connection:
        connection.execute(
            Plan.__table__.insert(),
            [
                dict(
                    id=identity,
                    author_id=uuid.UUID(aa["user"]["id"]),
                    title=f"Черновик {number}",
                    category_code="art",
                    starts_at=at + timedelta(days=30),
                    time_zone="UTC",
                    place="Тестовый музей",
                    description="",
                    created_at=at - timedelta(days=1),
                    updated_at=at + timedelta(seconds=number),
                )
                for number, identity in enumerate(identities)
            ],
        )
    first = activity(a).json()
    assert len(first["items"]) == 20 and first["next_cursor"]
    second = activity(a, cursor=first["next_cursor"]).json()
    assert len(second["items"]) == 7 and second["next_cursor"] is None
    assert [item["plan_id"] for item in first["items"] + second["items"]] == [
        str(identity) for identity in reversed(identities)
    ]
    assert activity(a, "archive", cursor=first["next_cursor"]).status_code == 422


def test_contact_updates_only_from_signed_login_while_chat_is_independent(members):
    (a, _), (b, _) = members
    _, identity = paired(members)
    for username in ("New_Username", None):
        signed_user = {"id": 202, "first_name": "Тест"}
        if username:
            signed_user["username"] = username
        result = b.post(
            "/api/v1/auth/telegram",
            json={"init_data": signed_data(202, int(time.time()), user=json.dumps(signed_user))},
            headers=ORIGIN,
        )
        assert result.status_code == 200
        contact = a.get(f"/api/v1/matches/{identity}/contact").json()
        assert contact["available"] is bool(username)
        assert contact["telegram_url"] == (f"https://t.me/{username}" if username else None)
        assert b.get(f"/api/v1/matches/{identity}/chat").json()["can_send"]
    assert (
        b.post(
            "/api/v1/auth/telegram",
            json={"init_data": signed_data(202, int(time.time())), "username": "Spoofed"},
            headers=ORIGIN,
        ).status_code
        == 422
    )
