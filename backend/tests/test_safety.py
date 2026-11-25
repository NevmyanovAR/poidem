import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import pytest
from bot_helpers import bot_settings as bot_settings
from bot_helpers import clock as clock
from bot_helpers import message, run
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from test_accounts import clients as clients
from test_accounts import headers, login
from test_chat_archive import paired, send
from test_connections import decide, published, respond
from test_plans import members as members

from poidem.admin import assign_role
from poidem.db.models import (
    AdminAuditLog,
    ChatMessage,
    Match,
    ModerationCase,
    ModerationDecision,
    NotificationJob,
    Plan,
    PlanResponse,
    Profile,
    Report,
    User,
    UserRestriction,
)

pytestmark = pytest.mark.database


def context(identity, target="plan", kind="plan", **extra):
    return {"target_type": target, "context_type": kind, "context_id": identity, **extra}


def report(client, account, data, **extra):
    return client.post(
        "/api/v1/reports",
        json={**data, "reason_code": "content", **extra},
        headers=headers(account),
    )


def block(client, account, data):
    result = client.post("/api/v1/me/blocks", json=data, headers=headers(account))
    assert result.status_code == 200, result.text
    return result.json()["id"]


def make_admin(client, account, engine):
    with Session(engine) as session:
        assign_role(
            session, uuid.UUID(account["user"]["id"]), "admin", "Тестовое назначение оператора"
        )
    assert client.get("/api/v1/admin/session").status_code == 200


def test_report_duplicate_private_rights_and_no_automatic_sanction(
    members, clients, migration_engine
):
    (a, aa), (b, bb) = members
    plan = published(members)
    first = report(b, bb, context(plan["id"]), comment="Контекст жалобы")
    assert first.status_code == 201, first.text
    identity = first.json()["id"]
    assert report(b, bb, context(plan["id"])).json()["id"] == identity
    assert b.get(f"/api/v1/reports/{identity}").status_code == 200
    assert a.get(f"/api/v1/reports/{identity}").status_code == 404
    assert clients().get(f"/api/v1/reports/{identity}").status_code == 401
    assert b.get(f"/api/v1/plans/{plan['id']}").status_code == 200
    assert report(a, aa, context(plan["id"])).status_code == 422
    with migration_engine.connect() as connection:
        assert connection.scalar(select(func.count()).select_from(Report)) == 1
        assert connection.scalar(select(func.count()).select_from(ModerationCase)) == 1
        assert connection.scalar(select(Plan.moderation_status)) == "not_submitted"
        assert set(connection.scalars(select(User.account_status))) == {"active"}


def test_parallel_report_is_one_case(members, migration_engine):
    _, (b, bb) = members
    plan = published(members)
    with ThreadPoolExecutor(max_workers=3) as executor:
        results = list(executor.map(lambda _: report(b, bb, context(plan["id"])), range(3)))
    assert sorted(result.status_code for result in results) == [200, 200, 201]
    assert len({result.json()["id"] for result in results}) == 1


def test_report_requires_csrf_context_and_cannot_promote_role(members, clients):
    (a, aa), (b, bb) = members
    plan = published(members)
    payload = {**context(plan["id"]), "reason_code": "content"}
    assert clients().post("/api/v1/reports", json=payload).status_code == 401
    assert (
        b.post(
            "/api/v1/reports", json=payload, headers={"Origin": "http://127.0.0.1:5173"}
        ).status_code
        == 403
    )
    assert report(b, bb, context(plan["id"]), role_code="admin").status_code == 422
    assert report(b, bb, context(str(uuid.uuid4()))).status_code == 404
    assert report(b, bb, context(plan["id"], "message")).status_code == 422
    assert b.patch("/api/v1/me", json={"role_code": "admin"}, headers=headers(bb)).status_code in (
        404,
        405,
    )
    assert b.get("/api/v1/admin/session").status_code == 403
    assert a.get("/api/v1/admin/reports").status_code == 403


def test_personal_block_hides_initiator_plans_stops_responses_without_status_changes(
    members, migration_engine
):
    (a, aa), (b, bb) = members
    plan = published(members)
    response = respond(b, bb, plan).json()["response"]
    identity = block(a, aa, context(response["id"], "profile", "response"))
    assert respond(b, bb, plan).status_code == 403
    assert decide(a, aa, response).status_code == 403
    assert a.get("/api/v1/me/responses").json()["items"][0]["display_status"] == "unavailable"
    assert b.get(f"/api/v1/plans/{plan['id']}/capacity").json()["can_respond"] is False
    assert b.delete(f"/api/v1/me/blocks/{identity}", headers=headers(bb)).status_code == 404
    assert a.delete(f"/api/v1/me/blocks/{identity}", headers=headers(aa)).status_code == 204
    with migration_engine.connect() as connection:
        assert connection.scalar(select(PlanResponse.status)) == "waiting"
        assert connection.scalar(select(func.count()).select_from(Match)) == 0


def test_block_plan_repeat_and_unblock_preserve_history(members, migration_engine):
    (a, aa), (b, bb) = members
    plan = published(members)
    identity = block(b, bb, context(plan["id"], "profile"))
    assert block(b, bb, context(plan["id"], "profile")) == identity
    assert b.get("/api/v1/plans").json()["items"] == []
    assert b.get(f"/api/v1/plans/{plan['id']}/author/photo").status_code == 404
    assert b.get("/api/v1/me/blocks").json()["items"][0]["id"] == identity
    assert a.get("/api/v1/me/blocks").json()["items"] == []
    for _ in range(2):
        assert b.delete(f"/api/v1/me/blocks/{identity}", headers=headers(bb)).status_code == 204
    assert len(b.get("/api/v1/plans").json()["items"]) == 1
    with migration_engine.connect() as connection:
        assert connection.scalar(select(func.count()).select_from(PlanResponse)) == 0
        assert connection.scalar(select(func.count()).select_from(UserRestriction)) == 1


def test_block_stops_both_chat_directions_preserves_match_and_reading(members, migration_engine):
    (a, aa), (b, bb) = members
    _, match = paired(members)
    first = send(b, bb, match)
    assert first.status_code == 201
    identity = block(a, aa, context(match, "chat", "match"))
    for client, account in members:
        assert send(client, account, match).status_code == 403
        assert client.get(f"/api/v1/matches/{match}/chat").json()["can_send"] is False
        assert len(client.get(f"/api/v1/matches/{match}/messages").json()["items"]) == 1
        assert client.get(f"/api/v1/matches/{match}").status_code == 200
        assert client.get(f"/api/v1/matches/{match}/contact").json()["available"] is False
    assert a.delete(f"/api/v1/me/blocks/{identity}", headers=headers(aa)).status_code == 204
    assert send(b, bb, match).status_code == 201
    with migration_engine.connect() as connection:
        assert connection.scalar(select(func.count()).select_from(Match)) == 1
        assert connection.scalar(select(Plan.publication_status)) == "closed"
        assert connection.scalar(select(PlanResponse.status)) == "accepted"


def test_block_after_send_commits_suppresses_unsent_jobs(
    members, bot_settings, clock, migration_engine
):
    from datetime import timedelta

    (a, aa), (b, bb) = members
    _, match = paired(members)

    async def bind(db, bot, handler, worker):
        await handler.process(message(1, 101))
        await handler.process(message(2, 202))

    run(bot_settings, bind)
    assert send(b, bb, match).status_code == 201
    block(a, aa, context(match, "chat", "match"))
    clock[0] += timedelta(seconds=65)

    async def drain(db, bot, handler, worker):
        for _ in range(8):
            if not await worker.run_once():
                break
        assert not bot.sent

    run(bot_settings, drain)
    with migration_engine.connect() as connection:
        states = connection.scalars(
            select(NotificationJob.state).where(NotificationJob.kind != "post_meeting_survey")
        ).all()
        assert states and set(states) == {"suppressed"}


def test_chat_report_bounded_context_no_free_chat_access(members, clients, migration_engine):
    (a, aa), (b, bb) = members
    _, match = paired(members)
    messages = [send(b, bb, match, f"Контекст {i}").json()["message"] for i in range(6)]
    result = report(a, aa, context(match, "chat", "match"))
    assert result.status_code == 201, result.text
    admin = clients()
    admin_account = login(admin, 303)
    make_admin(admin, admin_account, migration_engine)
    detail = admin.get(f"/api/v1/admin/reports/{result.json()['id']}").json()
    assert [item["text"] for item in detail["evidence"]["messages"]] == [
        "Контекст 3",
        "Контекст 4",
        "Контекст 5",
    ]
    assert admin.get(f"/api/v1/matches/{match}/messages").status_code == 404
    assert (
        report(b, bb, context(match, "message", "match", message_id=messages[3]["id"])).status_code
        == 422
    )
    assert (
        report(a, aa, context(match, "message", "match", message_id=str(uuid.uuid4()))).status_code
        == 422
    )
    assert (
        report(a, aa, context(match, "chat", "match", message_id=messages[3]["id"])).status_code
        == 422
    )
    assert (
        a.post(
            "/api/v1/me/blocks", json=context(match, "message", "match"), headers=headers(aa)
        ).status_code
        == 422
    )
    assert "telegram" not in str(detail)
    assert "csrf_token" not in str(detail)

    # Старые жалобы остаются читаемыми: удалён только их новый приём, не история.
    with Session(migration_engine) as session:
        stored = session.get(Report, uuid.UUID(result.json()["id"]))
        stored.target_type = "message"
        stored.evidence = {**stored.evidence, "reported_message_id": messages[5]["id"]}
        session.commit()
    legacy = admin.get(f"/api/v1/admin/reports/{result.json()['id']}").json()
    assert legacy["target_type"] == "message"
    assert legacy["evidence"]["reported_message_id"] == messages[5]["id"]


def test_report_antispam(members, monkeypatch, migration_engine):
    fixed_time = time.time()
    monkeypatch.setattr("poidem.services.rate_limit.time", SimpleNamespace(time=lambda: fixed_time))
    _, (b, bb) = members
    plan = published(members)
    results = []
    for version in range(1, 7):
        with Session(migration_engine) as session:
            session.get(Plan, uuid.UUID(plan["id"])).version = version
            session.commit()
        results.append(report(b, bb, context(plan["id"])))
    assert [result.status_code for result in results] == [201] * 5 + [429]
    with Session(migration_engine) as session:
        session.get(Plan, uuid.UUID(plan["id"])).version = 1
        session.commit()
    assert report(b, bb, context(plan["id"])).status_code == 200


@pytest.mark.parametrize("action", ["dismiss", "hide_plan"])
def test_admin_decision_audit_idempotency_and_sanctions(members, clients, migration_engine, action):
    _, (b, bb) = members
    plan = published(members)
    entry = report(b, bb, context(plan["id"])).json()
    admin = clients()
    admin_account = login(admin, 303)
    make_admin(admin, admin_account, migration_engine)
    url = f"/api/v1/admin/reports/{entry['id']}/decision"
    payload = {"action": action, "reason": "Проверенный контекст жалобы"}
    assert b.post(url, json=payload, headers=headers(bb)).status_code == 403
    assert admin.post(url, json=payload).status_code == 403
    for _ in range(2):
        result = admin.post(url, json=payload, headers=headers(admin_account))
        assert result.status_code == 200, result.text
    assert result.json()["state"] == "reviewed"
    assert (
        admin.get("/api/v1/admin/reports?state=reviewed&target_type=plan").json()["items"][0]["id"]
        == entry["id"]
    )
    assert admin.get("/api/v1/admin/reports?state=pending").json()["items"] == []
    assert (
        admin.post(
            url, json={**payload, "reason": "Другое решение"}, headers=headers(admin_account)
        ).status_code
        == 409
    )
    with migration_engine.connect() as connection:
        assert connection.scalar(select(func.count()).select_from(ModerationDecision)) == 1
        assert connection.scalar(select(func.count()).select_from(AdminAuditLog)) == 2
        assert connection.scalar(select(Plan.moderation_status)) == (
            "rejected" if action == "hide_plan" else "not_submitted"
        )
    assert b.get(f"/api/v1/plans/{plan['id']}").status_code == (
        404 if action == "hide_plan" else 200
    )


def test_profile_evidence_photo_scoped_and_admin_cannot_hide_it(members, clients, migration_engine):
    (a, _), (b, bb) = members
    plan = published(members)
    entry = report(b, bb, context(plan["id"], "profile")).json()
    admin = clients()
    account = login(admin, 303)
    make_admin(admin, account, migration_engine)
    url = f"/api/v1/admin/reports/{entry['id']}"
    assert b.get(url + "/photo").status_code == 403
    assert admin.get(url + "/photo").status_code == 200
    assert (
        admin.get(a.get("/api/v1/me/profile").json()["profile"]["photo"]["url"]).status_code == 404
    )
    assert (
        admin.post(
            url + "/decision",
            json={"action": "hide_plan", "reason": "Проверка"},
            headers=headers(account),
        ).status_code
        == 422
    )


def test_role_cli_requires_existing_user_and_revocation_effective(members, migration_engine):
    (a, aa), _ = members
    make_admin(a, aa, migration_engine)
    with Session(migration_engine) as session:
        with pytest.raises(ValueError):
            assign_role(session, uuid.uuid4(), "admin", "Тест")
        session.rollback()
        assert assign_role(session, uuid.UUID(aa["user"]["id"]), "user", "Отзыв тестовой роли")
    assert a.get("/api/v1/admin/reports").status_code == 403


def test_admin_stale_plan_cannot_hide_new_version(members, clients, migration_engine):
    _, (b, bb) = members
    plan = published(members)
    entry = report(b, bb, context(plan["id"])).json()
    with migration_engine.begin() as connection:
        connection.execute(Plan.__table__.update().values(version=Plan.version + 1))
    admin = clients()
    account = login(admin, 303)
    make_admin(admin, account, migration_engine)
    assert (
        admin.post(
            f"/api/v1/admin/reports/{entry['id']}/decision",
            json={"action": "hide_plan", "reason": "Причина"},
            headers=headers(account),
        ).status_code
        == 409
    )


def test_parallel_block_and_message_are_serialized(members, migration_engine):
    (a, aa), (b, bb) = members
    _, match = paired(members)
    with ThreadPoolExecutor(max_workers=2) as executor:
        blocking = executor.submit(block, a, aa, context(match, "chat", "match"))
        sending = executor.submit(send, b, bb, match)
        identity, result = blocking.result(), sending.result()
    assert identity
    assert result.status_code in (201, 403), result.text
    assert send(b, bb, match).status_code == 403
    with migration_engine.connect() as connection:
        assert connection.scalar(select(func.count()).select_from(ChatMessage)) == int(
            result.status_code == 201
        )
        assert connection.scalar(select(func.count()).select_from(Match)) == 1


def test_parallel_decision_and_block_cannot_create_pair_after_block(members):
    (a, aa), (b, bb) = members
    plan = published(members)
    response = respond(b, bb, plan).json()["response"]
    with ThreadPoolExecutor(max_workers=2) as executor:
        blocking = executor.submit(block, b, bb, context(response["id"], "profile", "response"))
        accepting = executor.submit(decide, a, aa, response)
        assert blocking.result()
        result = accepting.result()
    assert result.status_code in (200, 403), result.text
    if result.status_code == 200:
        match = result.json()["response"]["match_id"]
        assert send(a, aa, match).status_code == 403
    else:
        assert decide(a, aa, response).status_code == 403


def test_hidden_plan_keeps_related_match_chat_and_account_deletion_guard(
    members, clients, migration_engine
):
    (a, aa), (b, bb) = members
    plan, match = paired(members)
    assert send(b, bb, match).status_code == 201
    # Жалоба на закрытый план из мэтча не создаёт новый канал чтения плана.
    assert report(b, bb, context(plan["id"])).status_code == 404
    # Представляем уже поданную на ту же версию жалобу, сохраняя реальные связанные записи.
    with Session(migration_engine) as session:
        current = session.get(Plan, uuid.UUID(plan["id"]))
        case = ModerationCase(
            plan_id=current.id, object_version=current.version, workflow_version="D55-report-review"
        )
        session.add(case)
        session.flush()
        entry = Report(
            reporter_id=uuid.UUID(bb["user"]["id"]),
            plan_id=current.id,
            target_type="plan",
            target_key=f"plan:{current.id}:{current.version}",
            case_id=case.id,
            reason_code="content",
            evidence={"title": current.title},
        )
        session.add(entry)
        session.commit()
        report_id = str(entry.id)
    admin = clients()
    account = login(admin, 303)
    make_admin(admin, account, migration_engine)
    result = admin.post(
        f"/api/v1/admin/reports/{report_id}/decision",
        json={"action": "hide_plan", "reason": "Подтверждённое нарушение"},
        headers=headers(account),
    )
    assert result.status_code == 200, result.text
    assert len(a.get(f"/api/v1/matches/{match}/messages").json()["items"]) == 1
    assert a.get(f"/api/v1/matches/{match}").json()["match"]["meeting_cancelled"] is False
    assert a.delete("/api/v1/me", headers=headers(aa)).status_code == 409
    with migration_engine.connect() as connection:
        assert connection.scalar(select(func.count()).select_from(Match)) == 1
        assert connection.scalar(select(func.count()).select_from(PlanResponse)) == 1


def test_nonparticipant_cannot_report_or_block_other_chat(members, clients):
    _, match = paired(members)
    outsider = clients()
    account = login(outsider, 303)
    for path in ("/reports", "/me/blocks"):
        payload = context(match, "chat", "match")
        if path == "/reports":
            payload["reason_code"] = "content"
        assert (
            outsider.post("/api/v1" + path, json=payload, headers=headers(account)).status_code
            == 404
        )


def test_block_list_same_names_stable_codes_and_permitted_photo(members, clients):
    from test_accounts import profile, upload
    from test_plans import create, publish

    (a, aa), (b, bb) = members
    _, match = paired(members)
    first = block(a, aa, context(match, "chat", "match"))
    c = clients()
    cc = login(c, 303)
    photo = upload(c, cc).json()
    assert c.put("/api/v1/me/profile", json=profile(photo), headers=headers(cc)).status_code == 200
    plan = publish(c, cc, create(c, cc).json()["plan"]).json()["plan"]
    second = block(a, aa, context(plan["id"], "profile"))
    result = a.get("/api/v1/me/blocks").json()["items"]
    assert len(result) == 2 and result[0]["name"] == result[1]["name"]
    rows = {row["id"]: row for row in result}
    assert rows[first]["display_code"] != rows[second]["display_code"]
    assert rows[first]["age"] == 24 and rows[first]["context"]
    assert a.get(rows[first]["photo_url"]).status_code == 200
    assert rows[second]["photo_url"] is None and rows[second]["age"] is None
    assert rows[second]["context"] is None  # Исходный контекст старого API не записывался.
    assert a.get(photo["url"]).status_code == 404
    for private in (
        bb["user"]["id"],
        cc["user"]["id"],
        "telegram_user_id",
        "private_username",
        "storage_key",
    ):
        assert private not in str(result)
    assert a.delete(f"/api/v1/me/blocks/{second}", headers=headers(aa)).status_code == 204
    assert a.get("/api/v1/me/blocks").json()["items"][0]["id"] == first
    block(a, aa, context(plan["id"], "profile"))
    repeated = a.get("/api/v1/me/blocks").json()["items"]
    assert sorted(row["display_code"] for row in repeated) == sorted(
        row["display_code"] for row in result
    )


def test_block_list_preserves_frozen_context_without_opening_response_photos(
    members, migration_engine
):
    (a, aa), (b, bb) = members
    plan = published(members)
    response = respond(b, bb, plan).json()["response"]
    block(a, aa, context(response["id"], "profile", "response"))
    with migration_engine.begin() as connection:
        connection.execute(
            Profile.__table__.update()
            .where(Profile.user_id == uuid.UUID(bb["user"]["id"]))
            .values(name="Новое имя", age=25)
        )
    row = a.get("/api/v1/me/blocks").json()["items"][0]
    assert row["name"] == response["history_context"]["responder_name"]
    assert row["age"] == response["history_context"]["responder_age"]
    assert row["context"] == plan["title"] and row["photo_url"] is None
    assert a.get(f"/api/v1/responses/{response['id']}/profile/photo").status_code == 404
