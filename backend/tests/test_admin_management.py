import asyncio
import csv
import io
import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta

import pytest
from bot_helpers import bot_settings as bot_settings
from bot_helpers import run
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session
from test_accounts import clients as clients
from test_accounts import headers, image_bytes
from test_admin_dashboard import metrics, period, read
from test_connections import published, respond
from test_plans import members as members
from test_safety import context, report

from poidem.admin import assign_role
from poidem.bot import polling
from poidem.db.models import (
    AdminAuditLog,
    AnalyticsEvent,
    BotHeartbeat,
    EditorialIdea,
    NotificationJob,
    Plan,
    User,
)
from poidem.services.admin_system import CATEGORIES
from poidem.services.analytics_events import COVERAGE_KEY

pytestmark = pytest.mark.database


def grant(engine, account, role):
    with Session(engine) as session:
        assign_role(session, uuid.UUID(account["user"]["id"]), role, "Назначение роли для проверки")


def fields(**extra):
    return {
        "title": "Новая редакционная идея",
        "subtitle": "Описание редакционной идеи",
        "category_code": "art",
        "place": "Музей",
        "plan_title": "Вместе на выставку",
        "tag": "Искусство",
        "sort_order": 3,
        **extra,
    }


def create(client, account, identity="new-idea", **extra):
    result = client.post(
        "/api/v1/admin/inspiration",
        json={"id": identity, **fields(**extra)},
        headers=headers(account),
    )
    assert result.status_code == 201, result.text
    return result.json()


def command(client, account, idea, action):
    return client.post(
        f"/api/v1/admin/inspiration/{idea['id']}/command",
        json={"action": action, "version": idea["version"], "confirm_id": idea["id"]},
        headers=headers(account),
    )


@pytest.mark.parametrize(
    "role,allowed",
    [
        ("user", set()),
        ("analyst", {"analytics"}),
        ("moderator", {"moderation"}),
        ("admin", {"analytics", "users", "plans", "moderation", "system", "editorial"}),
        ("owner", {"analytics", "users", "plans", "moderation", "system", "editorial", "team"}),
    ],
)
def test_roles_enforced_on_server_for_existing_session(members, migration_engine, role, allowed):
    (a, aa), _ = members
    grant(migration_engine, aa, role)
    response = a.get("/api/v1/admin/session")
    assert response.status_code == (200 if allowed else 403)
    if allowed:
        assert set(response.json()["permissions"]) == allowed
    for permission, path in {
        "analytics": "analytics",
        "users": "users",
        "plans": "plans",
        "moderation": "reports",
        "system": "system",
        "editorial": "inspiration",
        "team": "team",
    }.items():
        result = a.get(
            "/api/v1/admin/" + path, params=period() if permission == "analytics" else {}
        )
        assert result.status_code == (200 if permission in allowed else 403), result.text
    # Ни analyst, ни moderator, ни admin не могут повышать себя прямым запросом.
    if role != "owner":
        result = a.put(
            f"/api/v1/admin/team/{aa['user']['id']}/role",
            json={
                "role": "owner",
                "version": 1,
                "confirm_user_id": aa["user"]["id"],
                "reason": "Попытка повышения",
            },
            headers=headers(aa),
        )
        assert result.status_code == 403


def test_owner_assignment_revocation_csrf_version_and_audit(members, migration_engine):
    (a, aa), (b, bb) = members
    grant(migration_engine, aa, "owner")
    rows = a.get("/api/v1/admin/team", params={"limit": 1}).json()
    assert rows["total"] == 2 and rows["next_cursor"]
    assert (
        a.get(
            "/api/v1/admin/team", params={"cursor": rows["next_cursor"], "q": "changed"}
        ).status_code
        == 422
    )
    target = next(
        r for r in a.get("/api/v1/admin/team").json()["items"] if r["id"] == bb["user"]["id"]
    )
    url = f"/api/v1/admin/team/{target['id']}/role"
    body = {
        "role": "analyst",
        "version": target["version"],
        "confirm_user_id": target["id"],
        "reason": "Аналитика дипломного пилота",
    }
    assert a.put(url, json=body).status_code == 403
    assert a.put(url, json={**body, "reason": "   "}, headers=headers(aa)).status_code == 422
    assert (
        a.put(
            url, json={**body, "confirm_user_id": aa["user"]["id"]}, headers=headers(aa)
        ).status_code
        == 422
    )
    result = a.put(url, json=body, headers=headers(aa))
    assert result.status_code == 200, result.text
    assert a.put(url, json=body, headers=headers(aa)).json()["changed"] is False
    assert b.get("/api/v1/admin/analytics", params=period()).status_code == 200
    assert a.put(url, json={**body, "role": "admin"}, headers=headers(aa)).status_code == 409
    assert (
        a.put(
            url,
            json={**body, "role": "user", "version": result.json()["version"]},
            headers=headers(aa),
        ).status_code
        == 200
    )
    assert b.get("/api/v1/admin/analytics", params=period()).status_code == 403  # та же cookie
    with migration_engine.connect() as connection:
        assert (
            connection.scalar(
                select(func.count())
                .select_from(AdminAuditLog)
                .where(AdminAuditLog.action == "team_role_change")
            )
            == 2
        )


def test_last_owner_cli_http_and_concurrent_self_demotion(members, migration_engine):
    (a, aa), (b, bb) = members
    grant(migration_engine, aa, "owner")
    with Session(migration_engine) as session:
        with pytest.raises(ValueError, match="последнего"):
            assign_role(session, uuid.UUID(aa["user"]["id"]), "user", "Снять владельца")
    assert a.delete("/api/v1/me", headers=headers(aa)).status_code == 409
    grant(migration_engine, bb, "owner")
    rows = {r["id"]: r for r in a.get("/api/v1/admin/team").json()["items"]}

    def demote(pair):
        client, account = pair
        identity = account["user"]["id"]
        return client.put(
            f"/api/v1/admin/team/{identity}/role",
            json={
                "role": "user",
                "version": rows[identity]["version"],
                "confirm_user_id": identity,
                "reason": "Передача полномочий",
            },
            headers=headers(account),
        ).status_code

    with ThreadPoolExecutor(max_workers=2) as executor:
        assert sorted(executor.map(demote, members)) == [200, 409]
    with migration_engine.connect() as connection:
        assert (
            connection.scalar(
                select(func.count()).select_from(User).where(User.role_code == "owner")
            )
            == 1
        )


def test_editorial_crud_preview_photos_and_original_links(
    members, migration_engine, api_settings, clients
):
    (a, aa), (b, _) = members
    grant(migration_engine, aa, "admin")
    idea = create(a, aa, "gallery-date")  # прежний адрес допускается и сохраняется
    assert clients().get("/api/v1/inspiration/gallery-date").status_code == 404
    assert command(a, aa, idea, "publish").status_code == 422
    upload = a.post(
        "/api/v1/admin/inspiration/gallery-date/photo",
        params={"version": idea["version"]},
        files={"file": ("photo.jpg", image_bytes("JPEG"), "image/jpeg")},
        headers=headers(aa),
    )
    assert upload.status_code == 200, upload.text
    idea = upload.json()
    content = a.get(idea["image"])
    assert content.status_code == 200 and b"private camera metadata" not in content.content
    assert b.get(idea["image"]).status_code == 403
    assert clients().get("/api/v1/inspiration/gallery-date/photo").status_code == 404
    assert list(api_settings.media_root.glob("*.jpg"))
    # Старый редакционный файл не считается orphan после перезапуска сборщика.
    with Session(migration_engine) as session:
        photo_key = session.get(EditorialIdea, "gallery-date").image_key
    photo_path = api_settings.media_root / photo_key
    stale_time = datetime.now(UTC).timestamp() - 7200
    os.utime(photo_path, (stale_time, stale_time))

    async def cleanup(database, bot, handler, worker):
        from poidem.services.media import collect_orphans, drain_deletions

        await collect_orphans(database, api_settings)
        await drain_deletions(database, api_settings)

    run(api_settings, cleanup)
    assert photo_path.exists()
    result = command(a, aa, idea, "publish")
    assert result.status_code == 200, result.text
    idea = result.json()
    # Новый процесс приложения, та же БД и MEDIA_ROOT: фото/содержание переживают перезапуск.
    restarted = clients()
    public = restarted.get("/api/v1/inspiration/gallery-date").json()
    assert public["plan_title"] == "Вместе на выставку" and public["image"].startswith(
        "/api/v1/inspiration/"
    )
    assert restarted.get(public["image"]).status_code == 200
    assert "created_by" not in public and "image_key" not in public
    assert restarted.get("/api/v1/inspiration").json()["items"][0]["id"] == "gallery-date"
    edited = a.put(
        "/api/v1/admin/inspiration/gallery-date",
        json={**fields(title="Новое название", sort_order=0), "version": idea["version"]},
        headers=headers(aa),
    )
    assert edited.status_code == 200
    assert (
        a.put(
            "/api/v1/admin/inspiration/gallery-date",
            json={**fields(), "version": idea["version"]},
            headers=headers(aa),
        ).status_code
        == 409
    )
    idea = command(a, aa, edited.json(), "unpublish").json()
    assert restarted.get("/api/v1/inspiration/gallery-date/photo").status_code == 404
    assert command(a, aa, idea, "delete").status_code == 200
    with migration_engine.connect() as connection:
        assert connection.scalar(select(func.count()).select_from(EditorialIdea)) == 0
        assert connection.scalar(select(func.count()).select_from(Plan)) == 0


@pytest.mark.parametrize(
    "content,mime,code",
    [
        (b"<svg onload='alert(1)'/>", "image/svg+xml", 415),
        (b"not a photo", "image/jpeg", 422),
        (image_bytes(), "image/jpeg", 422),
        (b"x" * (3 * 1024 * 1024 + 1), "image/png", 413),
    ],
)
def test_editorial_rejects_unsafe_photos(members, migration_engine, content, mime, code):
    (a, aa), _ = members
    grant(migration_engine, aa, "admin")
    idea = create(a, aa)
    response = a.post(
        f"/api/v1/admin/inspiration/{idea['id']}/photo",
        params={"version": 1},
        files={"file": ("photo", content, mime)},
        headers=headers(aa),
    )
    assert response.status_code == code, response.text


def test_editorial_permissions_no_client_owner_no_csrf_and_concurrency(members, migration_engine):
    (a, aa), (b, bb) = members
    grant(migration_engine, aa, "admin")
    assert a.post("/api/v1/admin/inspiration", json={"id": "x", **fields()}).status_code == 403
    assert (
        b.post(
            "/api/v1/admin/inspiration", json={"id": "x", **fields()}, headers=headers(bb)
        ).status_code
        == 403
    )
    assert (
        a.post(
            "/api/v1/admin/inspiration",
            json={"id": "x", **fields(), "created_by": bb["user"]["id"]},
            headers=headers(aa),
        ).status_code
        == 422
    )
    assert (
        a.post(
            "/api/v1/admin/inspiration", json={"id": "../unsafe", **fields()}, headers=headers(aa)
        ).status_code
        == 422
    )
    with ThreadPoolExecutor(max_workers=2) as executor:
        statuses = list(
            executor.map(
                lambda _: (
                    a.post(
                        "/api/v1/admin/inspiration",
                        json={"id": "same", **fields()},
                        headers=headers(aa),
                    ).status_code
                ),
                range(2),
            )
        )
    assert sorted(statuses) == [201, 409]


def test_notification_categories_real_reasons_and_no_private_payload(members, migration_engine):
    (a, aa), _ = members
    grant(migration_engine, aa, "admin")
    at = datetime.now(UTC)
    states = [
        ("sent", None),
        ("pending", None),
        ("retry", "telegram_temporary"),
        ("retry", "cooldown"),
        ("suppressed", "notifications_disabled"),
        ("suppressed", "bot_not_allowed"),
        ("suppressed", "event_obsolete"),
        ("suppressed", None),
        ("failed", "attempts_exhausted"),
    ]
    with Session(migration_engine) as session:
        for i, (state, reason) in enumerate(states):
            session.add(
                NotificationJob(
                    kind="chat_message",
                    recipient_id=uuid.UUID(aa["user"]["id"]),
                    entity_ref={"private": "НЕ ВЫДАВАТЬ"},
                    dedupe_key=f"test:{i}",
                    due_at=at,
                    next_attempt_at=at,
                    state=state,
                    safe_error_code=reason,
                )
            )
        session.commit()
    data = a.get("/api/v1/admin/system").json()
    assert {r["id"]: r["count"] for r in data["categories"]} == {
        "sent": 1,
        "pending": 2,
        "retry": 1,
        "suppressed": 2,
        "failed": 1,
        "unknown": 2,
    }
    for category in CATEGORIES:
        page = a.get("/api/v1/admin/notifications", params={"category": category, "limit": 1})
        assert page.status_code == 200, page.text
        assert "НЕ ВЫДАВАТЬ" not in page.text and "recipient_id" not in page.text
        assert page.json()["items"][0]["category"] == category
    with migration_engine.connect() as connection:
        assert (
            connection.scalar(
                select(func.count())
                .select_from(NotificationJob)
                .where(NotificationJob.state == "sent")
            )
            == 1
        )  # просмотр ничего не переотправил


@pytest.mark.parametrize(
    "age,state,expected",
    [
        (None, "ok", "unknown"),
        (5, "ok", "ok"),
        (70, "ok", "stale"),
        (5, "error", "error"),
        (5, "stopped", "stopped"),
    ],
)
def test_heartbeat_freshness_is_not_last_delivery(members, migration_engine, age, state, expected):
    (a, aa), _ = members
    grant(migration_engine, aa, "admin")
    if age is not None:
        with Session(migration_engine) as session:
            session.add(
                BotHeartbeat(
                    component="worker",
                    last_seen_at=datetime.now(UTC) - timedelta(seconds=age),
                    state=state,
                )
            )
            session.commit()
    data = a.get("/api/v1/admin/system").json()
    assert data["heartbeat"]["worker"]["state"] == expected
    assert data["heartbeat"]["polling"]["state"] == "unknown"


def test_current_published_metrics_incomplete_coverage_and_csv(members, migration_engine):
    (a, aa), (b, bb) = members
    grant(migration_engine, aa, "admin")
    plan = published(members)
    assert respond(b, bb, plan).status_code == 201
    with Session(migration_engine) as session:
        session.add(
            AnalyticsEvent(
                event_key=COVERAGE_KEY,
                event_type="measurement_started",
                occurred_at=datetime.now(UTC),
                allowed_dimensions={},
            )
        )
        session.commit()
    data = read(a)
    values = metrics(data)
    assert values["plans_published_now"]["value"] == 1
    assert values["published_response_rate_now"]["value"] == 100
    assert values["plans_published_now"]["previous"] is None
    assert (
        values["plans_published"]["value"] is None
        and values["plans_published"]["data_status"] == "incomplete"
    )
    exported = a.post("/api/v1/admin/analytics/export", json=period(), headers=headers(aa)).json()
    rows = list(csv.reader(io.StringIO(exported["csv"].lstrip("\ufeff")), delimiter=";"))
    publication = next(row for row in rows if row[1] == "Первые публикации")
    assert (
        publication[-2] == "incomplete"
        and publication[-1] == exported["report"]["collection_started_at"]
    )
    with migration_engine.begin() as connection:
        connection.execute(
            update(AnalyticsEvent)
            .where(AnalyticsEvent.event_key == COVERAGE_KEY)
            .values(occurred_at=datetime.now(UTC) - timedelta(days=400))
        )
        connection.execute(update(Plan).values(moderation_status="pending"))
    assert metrics(read(a))["plans_published"]["value"] == 1
    assert metrics(read(a))["plans_published_now"]["value"] == 0
    assert metrics(read(a))["published_response_rate_now"]["value"] is None


def test_plan_author_filter_scoped_audit_and_no_private_read(members, migration_engine):
    (a, aa), (b, bb) = members
    grant(migration_engine, aa, "admin")
    plan = published(members)
    assert a.get("/api/v1/admin/plans", params={"author": bb["user"]["id"]}).json()["total"] == 0
    assert a.get("/api/v1/admin/plans", params={"author": aa["user"]["id"]}).json()["total"] == 1
    a.get(f"/api/v1/admin/plans/{plan['id']}")
    changes = a.get("/api/v1/admin/audit", params={"kind": "changes", "plan": plan["id"]}).json()
    reads = a.get("/api/v1/admin/audit", params={"kind": "reads", "plan": plan["id"]}).json()
    assert changes["total"] == 0 and reads["items"][0]["action"] == "admin_plan_read"
    assert b.get("/api/v1/admin/audit").status_code == 403


@pytest.mark.parametrize(
    "role,status", [("owner", 200), ("admin", 200), ("moderator", 200), ("analyst", 403)]
)
def test_existing_moderation_actions_keep_role_permissions(members, migration_engine, role, status):
    (a, aa), (b, bb) = members
    plan = published(members)
    identity = report(b, bb, context(plan["id"])).json()["id"]
    grant(migration_engine, aa, role)
    response = a.post(
        f"/api/v1/admin/reports/{identity}/decision",
        json={"action": "dismiss", "reason": "Контекст обращения рассмотрен"},
        headers=headers(aa),
    )
    assert response.status_code == status, response.text


def test_live_polling_and_worker_record_their_own_heartbeat(
    clients, bot_settings, migration_engine
):
    # Не настоящий Telegram и не второй polling. Два реальных цикла на тестовой БД,
    # внешний getUpdates замокан; завершение через CancelledError после первого прохода.
    calls = 0

    async def execute(database, bot, handler, worker):
        async def updates(**kwargs):
            nonlocal calls
            calls += 1
            if calls > 1:
                raise asyncio.CancelledError
            return []

        bot.get_updates = updates
        with pytest.raises(asyncio.CancelledError):
            await polling(handler)
        task = asyncio.create_task(worker.run())
        for _ in range(100):
            async with database.sessions() as session:
                if await session.get(BotHeartbeat, "worker"):
                    break
            await asyncio.sleep(0.01)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    run(bot_settings, execute)
    with migration_engine.connect() as connection:
        assert set(
            connection.scalars(select(BotHeartbeat.component).where(BotHeartbeat.state == "ok"))
        ) == {"polling", "worker"}
