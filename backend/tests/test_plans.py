import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select
from test_accounts import clients as clients
from test_accounts import headers, login, profile, upload

from poidem.db.models import DailyPlanUsage, Plan, PlanResponse, User
from poidem.services import plans

pytestmark = pytest.mark.database


@pytest.fixture
def members(clients):
    result = []
    for identity in (101, 202):
        client = clients()
        account = login(client, identity)
        photo = upload(client, account).json()
        response = client.put("/api/v1/me/profile", json=profile(photo), headers=headers(account))
        assert response.status_code == 200, response.text
        result.append((client, account))
    return result


def body(**changes):
    return {
        "title": "Кофе после музея",
        "category_code": "art",
        "description": "Встреча у входа",
        "starts_at": (datetime.now(UTC) + timedelta(days=30)).isoformat(),
        "time_zone": "Europe/Moscow",
        "place": "Вход в музей",
        **changes,
    }


def create(client, account, payload=None, key=None):
    from place_helpers import chosen_fields

    payload = chosen_fields(client, account, payload or body())
    return client.post(
        "/api/v1/plans",
        json=payload,
        headers={
            **headers(account),
            "Idempotency-Key": str(key or uuid.uuid4()),
        },
    )


def publish(client, account, plan):
    return client.post(
        f"/api/v1/plans/{plan['id']}/publish",
        json={"expected_version": plan["version"]},
        headers=headers(account),
    )


def test_create_is_persisted_and_publication_is_explicit(members, migration_engine):
    (a, aa), (b, _) = members
    response = create(a, aa)
    assert response.status_code == 201, response.text
    plan = response.json()["plan"]
    assert plan["author"]["id"] == aa["user"]["id"]
    assert plan["publication_status"] == "draft"
    assert a.get("/api/v1/me/quotas").json()["remaining"] == 2
    assert b.get("/api/v1/plans").json()["items"] == []
    assert b.get(f"/api/v1/plans/{plan['id']}").status_code == 404
    with migration_engine.connect() as connection:
        stored = (
            connection.execute(select(Plan.__table__).where(Plan.id == uuid.UUID(plan["id"])))
            .mappings()
            .one()
        )
        assert stored["author_id"] == uuid.UUID(aa["user"]["id"])
        assert stored["quota_charged_day"] is not None
        assert stored["time_zone"] == "Europe/Moscow"
    published = publish(a, aa, plan)
    assert published.status_code == 200, published.text
    assert published.json()["plan"]["moderation_status"] == "not_submitted"
    assert a.get("/api/v1/plans").json()["items"] == []
    foreign = b.get("/api/v1/plans").json()["items"]
    assert [item["id"] for item in foreign] == [plan["id"]]
    assert foreign[0]["own"] is False
    assert "telegram" not in str(foreign).lower()
    assert "photo" not in foreign[0]["author"]


def test_edit_cancel_and_versions_do_not_refund_or_recharge(members):
    (a, aa), (b, ba) = members
    plan = publish(a, aa, create(a, aa).json()["plan"]).json()["plan"]
    patch = {"expected_version": plan["version"], "title": "Новый план"}
    assert (
        b.patch(f"/api/v1/plans/{plan['id']}", json=patch, headers=headers(ba)).status_code == 404
    )
    updated = a.patch(f"/api/v1/plans/{plan['id']}", json=patch, headers=headers(aa))
    assert updated.status_code == 200, updated.text
    assert b.get("/api/v1/plans").json()["items"][0]["title"] == "Новый план"
    assert (
        a.patch(f"/api/v1/plans/{plan['id']}", json=patch, headers=headers(aa)).status_code == 409
    )
    plan = updated.json()["plan"]
    cancelled = a.post(
        f"/api/v1/plans/{plan['id']}/cancel",
        json={"expected_version": plan["version"]},
        headers=headers(aa),
    )
    assert cancelled.status_code == 200
    assert cancelled.json()["plan"]["publication_status"] == "cancelled"
    assert b.get("/api/v1/plans").json()["items"] == []
    assert b.get(f"/api/v1/plans/{plan['id']}").status_code == 404
    assert a.get("/api/v1/me/plans").json()["items"][0]["publication_status"] == "cancelled"
    assert a.get("/api/v1/me/quotas").json()["used"] == 1
    assert a.delete(f"/api/v1/plans/{plan['id']}", headers=headers(aa)).status_code == 405


def test_limit_is_three_and_account_reset_cannot_bypass_it(members):
    (a, aa), _ = members
    for _ in range(3):
        assert create(a, aa).status_code == 201
    rejected = create(a, aa)
    assert rejected.status_code == 429
    assert rejected.json()["error"]["code"] == "PLAN_DAILY_LIMIT"
    assert int(rejected.headers["retry-after"]) > 0
    assert a.get("/api/v1/me/quotas").json()["remaining"] == 0
    assert a.delete("/api/v1/me", headers=headers(aa)).status_code == 409
    again = login(a)
    assert again["user"]["id"] == aa["user"]["id"]
    assert a.get("/api/v1/me/quotas").json()["remaining"] == 0


def test_parallel_creations_never_exceed_three(members, migration_engine):
    (a, aa), _ = members
    with ThreadPoolExecutor(max_workers=8) as pool:
        statuses = list(pool.map(lambda _: create(a, aa).status_code, range(8)))
    assert statuses.count(201) == 3, statuses
    assert statuses.count(429) == 5, statuses
    with migration_engine.connect() as connection:
        assert connection.scalar(select(func.count()).select_from(Plan)) == 3
        assert connection.scalar(select(DailyPlanUsage.used)) == 3


def test_idempotency_is_atomic_and_rejects_changed_payload(members):
    (a, aa), _ = members
    payload, key = body(), uuid.uuid4()
    with ThreadPoolExecutor(max_workers=5) as pool:
        results = list(pool.map(lambda _: create(a, aa, payload, key), range(5)))
    assert sorted(item.status_code for item in results) == [200, 200, 200, 200, 201]
    assert len({item.json()["plan"]["id"] for item in results}) == 1
    assert a.get("/api/v1/me/quotas").json()["used"] == 1
    assert create(a, aa, {**payload, "title": "Другое"}, key).status_code == 409


def test_moscow_calendar_resets_at_utc_2100(members, monkeypatch):
    (a, aa), _ = members
    monkeypatch.setattr(plans, "now", lambda: datetime(2026, 11, 22, 20, 59, 59, tzinfo=UTC))
    for _ in range(3):
        assert create(a, aa).status_code == 201
    quota = a.get("/api/v1/me/quotas").json()
    assert quota["day"] == "2026-11-22"
    assert quota["time_zone"] == "Europe/Moscow"
    assert quota["remaining"] == 0
    monkeypatch.setattr(plans, "now", lambda: datetime(2026, 11, 22, 21, 0, tzinfo=UTC))
    assert a.get("/api/v1/me/quotas").json()["remaining"] == 3
    assert create(a, aa).status_code == 201


@pytest.mark.parametrize(
    "changes",
    [
        {"title": ""},
        {"title": "a" * 81},
        {"place": ""},
        {"description": "a" * 301},
        {"starts_at": "2020-01-01T12:00:00Z"},
        {"starts_at": "2099-01-01T12:00:00"},
        {"time_zone": "Wrong/Zone"},
        {"category_code": "unknown"},
        {"author_id": "00000000-0000-4000-8000-000000000001"},
        {"publication_status": "published"},
        {"is_demo": True},
        {"place": "стрип-клуб"},
        {"description": "заброшенное здание"},
        {"title": "Сука"},
        {"description": "Купим кокаин"},
        {"place": "сексуальные услуги"},
        {"description": "Я тебя убью"},
        {"description": "создадим фишинговый сайт"},
        {"title": "Стриптиз"},
        {"title": "Наркотики"},
        {"place": "Бордель"},
        {"place": "Закрытая крыша"},
        {"place": "Аварийное здание"},
        {"description": "проберемся на стройку"},
    ],
)
def test_invalid_create_never_spends_quota(members, changes):
    (a, aa), _ = members
    response = create(a, aa, body(**changes))
    assert response.status_code == 422, response.text
    assert a.get("/api/v1/me/quotas").json()["used"] == 0


def test_educational_discussion_is_allowed_without_bypassing_other_rules(members):
    (a, aa), _ = members
    result = create(a, aa, body(description="Лекция о вреде наркотиков"))
    assert result.status_code == 201, result.text
    assert publish(a, aa, result.json()["plan"]).status_code == 200
    assert a.get("/api/v1/me/quotas").json()["used"] == 1


def test_content_rejection_keeps_published_plan_and_account_usable(members):
    (a, aa), (b, _) = members
    plan = publish(a, aa, create(a, aa).json()["plan"]).json()["plan"]
    rejected = a.patch(
        f"/api/v1/plans/{plan['id']}",
        json={"expected_version": plan["version"], "description": "п и д о р"},
        headers=headers(aa),
    )
    assert rejected.status_code == 422, rejected.text
    assert rejected.json()["error"]["code"] == "PLAN_CONTENT_REJECTED"
    stored = b.get("/api/v1/plans").json()["items"][0]
    assert stored["description"] == plan["description"]
    assert stored["version"] == plan["version"]
    assert a.get("/api/v1/me/quotas").json()["used"] == 1
    assert create(a, aa).status_code == 201  # Отказ фильтра не блокирует пользователя.


def test_saved_draft_is_rechecked_on_publication(members, migration_engine):
    (a, aa), (b, _) = members
    plan = create(a, aa).json()["plan"]
    # Запись старой версии правил только в изолированной тестовой БД.
    with migration_engine.begin() as connection:
        connection.execute(
            Plan.__table__.update()
            .where(Plan.id == uuid.UUID(plan["id"]))
            .values(description="Продам кокаин")
        )
    rejected = publish(a, aa, plan)
    assert rejected.status_code == 422, rejected.text
    assert rejected.json()["error"]["code"] == "PLAN_CONTENT_REJECTED"
    assert a.get("/api/v1/me/plans").json()["items"][0]["publication_status"] == "draft"
    assert a.get("/api/v1/me/quotas").json()["used"] == 1
    assert b.get("/api/v1/plans").json()["items"] == []


@pytest.mark.parametrize("status", ["pending", "rejected", "blocked"])
def test_hidden_moderation_states_are_not_exposed(members, migration_engine, status):
    (a, aa), (b, _) = members
    plan = publish(a, aa, create(a, aa).json()["plan"]).json()["plan"]
    with migration_engine.begin() as connection:
        connection.execute(
            Plan.__table__.update()
            .where(Plan.id == uuid.UUID(plan["id"]))
            .values(moderation_status=status)
        )
    assert b.get("/api/v1/plans").json()["items"] == []
    assert b.get(f"/api/v1/plans/{plan['id']}").status_code == 404
    assert a.get("/api/v1/me/plans").json()["items"][0]["moderation_status"] == status


def test_past_plan_cannot_be_published_and_blocked_author_is_hidden(members, migration_engine):
    (a, aa), (b, _) = members
    plan = create(a, aa).json()["plan"]
    with migration_engine.begin() as connection:
        connection.execute(
            Plan.__table__.update()
            .where(Plan.id == uuid.UUID(plan["id"]))
            .values(starts_at=datetime.now(UTC) - timedelta(minutes=1))
        )
    assert publish(a, aa, plan).status_code == 422
    second = publish(a, aa, create(a, aa).json()["plan"]).json()["plan"]
    with migration_engine.begin() as connection:
        connection.execute(
            User.__table__.update()
            .where(User.id == uuid.UUID(aa["user"]["id"]))
            .values(account_status="blocked")
        )
    assert b.get("/api/v1/plans").json()["items"] == []
    assert b.get(f"/api/v1/plans/{second['id']}").status_code == 404
    assert create(a, aa).status_code == 403


def test_related_responses_prevent_changes_until_rules_are_approved(members, migration_engine):
    (a, aa), (_, ba) = members
    plan = publish(a, aa, create(a, aa).json()["plan"]).json()["plan"]
    with migration_engine.begin() as connection:
        connection.execute(
            PlanResponse.__table__.insert().values(
                id=uuid.uuid4(),
                plan_id=uuid.UUID(plan["id"]),
                plan_author_id=uuid.UUID(aa["user"]["id"]),
                responder_id=uuid.UUID(ba["user"]["id"]),
                agreed_plan_version=plan["version"],
                status="waiting",
                slot_no=1,
                version=1,
            )
        )
    assert (
        a.patch(
            f"/api/v1/plans/{plan['id']}",
            json={"expected_version": plan["version"], "title": "Перенос"},
            headers=headers(aa),
        ).status_code
        == 409
    )
    assert (
        a.post(
            f"/api/v1/plans/{plan['id']}/cancel",
            json={"expected_version": plan["version"]},
            headers=headers(aa),
        ).status_code
        == 409
    )


def test_catalogue_pagination_and_category_are_stable(members):
    (a, aa), (b, _) = members
    start = datetime.now(UTC) + timedelta(days=30)
    ids = []
    for index in range(3):
        plan = create(a, aa, body(starts_at=(start + timedelta(hours=index)).isoformat())).json()[
            "plan"
        ]
        ids.append(publish(a, aa, plan).json()["plan"]["id"])
    first = b.get("/api/v1/plans?limit=2&category=art").json()
    assert [item["id"] for item in first["items"]] == ids[:2]
    second = b.get("/api/v1/plans", params={"limit": 2, "cursor": first["next_cursor"]}).json()
    assert [item["id"] for item in second["items"]] == ids[2:]
    assert second["next_cursor"] is None
    assert b.get("/api/v1/plans?category=food").json()["items"] == []
    assert b.get("/api/v1/plans?cursor=not-valid").status_code == 422


def test_private_plan_endpoints_require_session_and_csrf(clients, members):
    (a, aa), _ = members
    anonymous = clients()
    for path in ("/api/v1/plans", "/api/v1/me/plans", "/api/v1/me/quotas"):
        assert anonymous.get(path).status_code == 401
    assert create(anonymous, aa).status_code == 401
    assert (
        a.post(
            "/api/v1/plans",
            json=body(),
            headers={"Origin": "http://127.0.0.1:5173", "Idempotency-Key": str(uuid.uuid4())},
        ).status_code
        == 403
    )
    bare = clients()
    account = login(bare, 303)
    assert create(bare, account).status_code == 409


def test_plan_reads_reject_a_cookie_from_another_verified_launch(members):
    (_, aa), (b, ba) = members
    assert create(b, ba, body(title="Частный черновик B")).status_code == 201
    # Два WebView одного origin могут иметь общий cookie jar. Контекст окна A
    # не должен получить собственные планы/квоту B после смены cookie на B.
    for path in ("/api/v1/me/plans", "/api/v1/me/quotas", "/api/v1/plans"):
        response = b.get(path, headers={"X-Account-Context": aa["user"]["id"]})
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "AUTH_CONTEXT_CHANGED"
    assert (
        b.get("/api/v1/me/plans", headers={"X-Account-Context": ba["user"]["id"]}).status_code
        == 200
    )
