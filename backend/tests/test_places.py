import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy import func, select, update
from test_accounts import clients as clients
from test_accounts import headers
from test_plans import body, publish
from test_plans import members as members

from poidem.db.models import AdminAuditLog, Plan, PublicPlace, User

pytestmark = pytest.mark.database


def proposal(client, account, **changes):
    return client.post(
        "/api/v1/places/proposals",
        json={
            "name": "Тестовый музей",
            "address": "улица Примерная, 1",
            "city": "Тестовый город",
            "category": "museum",
            **changes,
        },
        headers=headers(account),
    )


def grant(engine, account, role="moderator"):
    with engine.begin() as connection:
        connection.execute(
            update(User).where(User.id == uuid.UUID(account["user"]["id"])).values(role_code=role)
        )


def decide(client, account, place, action="approve", **changes):
    return client.post(
        f"/api/v1/admin/places/{place['id']}/decision",
        json={
            "expected_version": place["version"],
            "action": action,
            "reason": "Объект проверен модератором",
            "public_access_confirmed": True,
            **changes,
        },
        headers=headers(account),
    )


def draft(client, account, selected):
    place = selected["place"]
    return client.post(
        "/api/v1/plans",
        json=body(
            place=f"{place['name']} · {place['address']}",
            selected_place_id=selected["selection_id"],
        ),
        headers={**headers(account), "Idempotency-Key": str(uuid.uuid4())},
    )


def test_proposal_draft_moderation_publication_and_no_external_api(
    members, migration_engine, monkeypatch
):
    import aiohttp

    monkeypatch.setattr(
        aiohttp.ClientSession, "get", lambda *a, **k: pytest.fail("Запрещён внешний Places API")
    )
    (a, aa), (b, ba) = members
    assert a.get("/api/v1/places/search?q=Музей").json()["items"] == []
    selected = proposal(a, aa).json()
    assert selected["place"]["status"] == "pending" and selected["place"]["latitude"] is None
    plan = draft(a, aa, selected).json()["plan"]
    assert plan["place_check_status"] == "pending" and "publish" in plan["allowed_actions"]
    assert plan["place_check_status"] == "pending"
    assert (
        b.post(
            "/api/v1/places/resolve",
            json={"provider_place_id": selected["place"]["provider_place_id"]},
            headers=headers(ba),
        ).status_code
        == 404
    )
    grant(migration_engine, ba)
    item = b.get("/api/v1/admin/places").json()["items"][0]
    assert decide(b, ba, item, public_access_confirmed=False).status_code == 422
    assert decide(b, ba, item).status_code == 200
    own = a.get(f"/api/v1/plans/{plan['id']}").json()["plan"]
    assert own["place_status"] == "catalogue" and "publish" in own["allowed_actions"]
    assert len(a.get("/api/v1/places/search?q=Музей").json()["items"]) == 1
    assert publish(a, aa, own).status_code == 200
    foreign = b.get(f"/api/v1/plans/{plan['id']}").json()["plan"]
    assert foreign["venue"]["provider"] == "local" and foreign["selected_place_id"] is None
    with migration_engine.connect() as conn:
        assert (
            conn.scalar(
                select(func.count())
                .select_from(AdminAuditLog)
                .where(AdminAuditLog.action == "place_approve")
            )
            == 1
        )


def test_catalogue_rejection_does_not_block_plan_or_leak_reason(members, migration_engine):
    (a, aa), (b, ba) = members
    selected = proposal(a, aa).json()
    plan = draft(a, aa, selected).json()["plan"]
    grant(migration_engine, ba)
    item = b.get("/api/v1/admin/places").json()["items"][0]
    assert (
        decide(b, ba, item, "reject", reason="Не подтверждена публичная доступность").status_code
        == 200
    )
    own = a.get(f"/api/v1/plans/{plan['id']}").json()["plan"]
    assert own["place_check_status"] == "pending" and "publish" in own["allowed_actions"]
    assert "публичная" in a.get("/api/v1/me/place-proposals").json()["items"][0]["reason"]
    assert publish(a, aa, own).status_code == 200
    assert b.get(f"/api/v1/plans/{plan['id']}").json()["plan"]["venue"]["moderation_reason"] is None
    assert b.get("/api/v1/places/search?q=музей").json()["items"] == []
    assert a.get("/api/v1/me/place-proposals").json()["items"][0]["status"] == "rejected"


@pytest.mark.parametrize("field", ["status", "proposer_id", "latitude", "longitude", "reviewed_at"])
def test_cannot_spoof_proposal_fields(members, field):
    (a, aa), _ = members
    assert proposal(a, aa, **{field: "approved"}).status_code == 422


def test_exact_duplicates_repeat_safely_and_cross_user_race(members, migration_engine):
    (a, aa), (b, ba) = members
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(proposal, a, aa)
        second = pool.submit(proposal, b, ba)
        results = [first.result(), second.result()]
    assert sorted(r.status_code for r in results) == [200, 409]
    owner, account = (a, aa) if results[0].status_code == 200 else (b, ba)
    repeated = proposal(owner, account, name="ТЕСТОВЫЙ   МУЗЕЙ", city="Тестовый ГОРОД").json()
    with migration_engine.connect() as conn:
        assert conn.scalar(select(func.count()).select_from(PublicPlace)) == 1
    assert repeated["place"]["status"] == "pending"


def test_similar_places_are_separate_and_shown_to_moderator(members, migration_engine):
    (a, aa), (b, ba) = members
    first = proposal(a, aa).json()
    assert (
        proposal(a, aa, name="Тестовый музей искусств", address="улица Примерная, 2").status_code
        == 200
    )
    grant(migration_engine, ba)
    detail = b.get(f"/api/v1/admin/places/{first['place']['provider_place_id']}").json()
    assert len(detail["possible_duplicates"]) == 1
    unusual = proposal(a, aa, name="Другой музей", city="Тестовый_%" + chr(92)).json()
    assert b.get(f"/api/v1/admin/places/{unusual['place']['provider_place_id']}").status_code == 200


def test_edit_and_hide_do_not_rewrite_published_plan_or_history(members, migration_engine):
    (a, aa), (b, ba) = members
    selected = proposal(a, aa).json()
    grant(migration_engine, ba)
    place = b.get("/api/v1/admin/places").json()["items"][0]
    approved = decide(b, ba, place).json()
    plan = publish(a, aa, draft(a, aa, selected).json()["plan"]).json()["plan"]
    edited = b.put(
        f"/api/v1/admin/places/{place['id']}",
        json={
            "expected_version": approved["version"],
            "name": "Уточнённый музей",
            "address": "другая улица, 2",
            "city": "Тестовый город",
            "category": "museum",
            "reason": "Сведения уточнены",
            "public_access_confirmed": True,
        },
        headers=headers(ba),
    )
    assert edited.status_code == 200, edited.text
    assert decide(b, ba, edited.json(), "hide").status_code == 200
    assert b.get(f"/api/v1/plans/{plan['id']}").json()["plan"]["place"] == plan["place"]
    assert not a.get("/api/v1/places/search?q=музей").json()["items"]
    assert publish(a, aa, draft(a, aa, selected).json()["plan"]).status_code == 200


def test_legacy_places_not_imported_or_changed_and_publication_is_free(members, migration_engine):
    (a, aa), _ = members
    raw = a.post(
        "/api/v1/plans",
        json=body(place="Старый адрес"),
        headers={**headers(aa), "Idempotency-Key": str(uuid.uuid4())},
    ).json()["plan"]
    with migration_engine.begin() as conn:
        conn.execute(
            update(Plan).where(Plan.id == uuid.UUID(raw["id"])).values(place_policy_version=None)
        )
    assert a.get(f"/api/v1/plans/{raw['id']}").json()["plan"]["place"] == "Старый адрес"
    assert publish(a, aa, raw).status_code == 200
    with migration_engine.connect() as conn:
        assert conn.scalar(select(func.count()).select_from(PublicPlace)) == 0


def test_foreign_selection_and_tampered_label_cannot_publish(members):
    (a, aa), (b, ba) = members
    selected = proposal(a, aa).json()
    assert draft(b, ba, selected).status_code == 422
    copied = {**selected, "place": {**selected["place"], "address": "частная квартира"}}
    assert draft(a, aa, copied).status_code == 422


@pytest.mark.parametrize("role", ["user", "analyst"])
def test_admin_permission_checks_and_csrf(members, migration_engine, role):
    (a, aa), (b, ba) = members
    selected = proposal(a, aa).json()
    grant(migration_engine, ba, role)
    identity = selected["place"]["provider_place_id"]
    assert b.get("/api/v1/admin/places").status_code == 403
    assert b.get(f"/api/v1/admin/places/{identity}").status_code == 403
    assert (
        b.post(
            "/api/v1/admin/places/import",
            json={"csv": "x", "public_access_confirmed": True},
            headers=headers(ba),
        ).status_code
        == 403
    )
    assert a.post("/api/v1/places/proposals", json={}).status_code == 403


def test_csv_import_is_checked_atomic_and_idempotent(members, migration_engine):
    (a, aa), _ = members
    grant(migration_engine, aa)
    csv = (
        "name,address,city,category\nСинтетический музей,Примерная улица 1,Тестовый город,museum\n"
    )
    result = a.post(
        "/api/v1/admin/places/import",
        json={"csv": csv, "public_access_confirmed": False},
        headers=headers(aa),
    )
    assert result.status_code == 422
    result = a.post(
        "/api/v1/admin/places/import",
        json={"csv": csv, "public_access_confirmed": True},
        headers=headers(aa),
    )
    assert result.status_code == 200, result.text
    assert result.json()["created"] == 1
    assert (
        a.post(
            "/api/v1/admin/places/import",
            json={"csv": csv, "public_access_confirmed": True},
            headers=headers(aa),
        ).json()["skipped"]
        == 1
    )
    bad = csv + "Ошибка,Улица,Город,apartment\n"
    assert (
        a.post(
            "/api/v1/admin/places/import",
            json={"csv": bad, "public_access_confirmed": True},
            headers=headers(aa),
        ).status_code
        == 422
    )
    with migration_engine.connect() as conn:
        assert conn.scalar(select(func.count()).select_from(PublicPlace)) == 1


def test_parallel_decisions_are_versioned(members, migration_engine):
    (a, aa), (b, ba) = members
    proposal(a, aa)
    grant(migration_engine, ba)
    item = b.get("/api/v1/admin/places").json()["items"][0]
    with ThreadPoolExecutor(max_workers=2) as pool:
        one = pool.submit(decide, b, ba, item)
        two = pool.submit(decide, b, ba, item, "reject")
        assert sorted([one.result().status_code, two.result().status_code]) == [200, 409]


def test_catalogue_edits_never_silently_rewrite_existing_draft(members, migration_engine):
    (a, aa), (b, ba) = members
    selected = proposal(a, aa).json()
    plan = draft(a, aa, selected).json()["plan"]
    grant(migration_engine, ba)
    place = b.get("/api/v1/admin/places").json()["items"][0]
    modified = b.put(
        f"/api/v1/admin/places/{place['id']}",
        json={
            "expected_version": place["version"],
            "name": "Проверенный музей",
            "address": "Уточнённая улица, 2",
            "city": "Тестовый город",
            "category": "museum",
            "reason": "Адрес проверен",
            "public_access_confirmed": False,
        },
        headers=headers(ba),
    )
    assert modified.status_code == 200
    assert decide(b, ba, modified.json()).status_code == 200
    updated = a.get(f"/api/v1/plans/{plan['id']}").json()["plan"]
    assert updated["place"] == plan["place"]
    with migration_engine.connect() as conn:
        assert (
            conn.scalar(select(Plan.place).where(Plan.id == uuid.UUID(plan["id"]))) == plan["place"]
        )
    edited = a.patch(
        f"/api/v1/plans/{plan['id']}",
        json={
            "expected_version": updated["version"],
            "description": "Описание после уточнения адреса",
            "place": updated["place"],
            "selected_place_id": updated["selected_place_id"],
        },
        headers=headers(aa),
    )
    assert edited.status_code == 200, edited.text
    assert publish(a, aa, edited.json()["plan"]).json()["plan"]["place"] == plan["place"]
    fresh = draft(a, aa, selected).json()["plan"]
    with migration_engine.connect() as conn:
        assert "Уточнённая" in conn.scalar(
            select(Plan.place).where(Plan.id == uuid.UUID(fresh["id"]))
        )


def test_hide_racing_with_publication_is_serialized(members, migration_engine):
    (a, aa), (b, ba) = members
    selected = proposal(a, aa).json()
    grant(migration_engine, ba)
    place = decide(b, ba, b.get("/api/v1/admin/places").json()["items"][0]).json()
    plan = draft(a, aa, selected).json()["plan"]
    with ThreadPoolExecutor(max_workers=2) as pool:
        publishing = pool.submit(publish, a, aa, plan)
        hiding = pool.submit(decide, b, ba, place, "hide")
        assert hiding.result().status_code == 200
        assert publishing.result().status_code == 200
    current = a.get(f"/api/v1/plans/{plan['id']}").json()["plan"]
    if current["publication_status"] == "draft":
        assert publish(a, aa, current).status_code == 200


def test_catalogue_reads_and_changes_are_separate_in_existing_audit(members, migration_engine):
    (a, aa), (b, ba) = members
    selected = proposal(a, aa).json()
    assert selected["place"]["checked_at"] is None
    grant(migration_engine, ba, "owner")
    item = b.get("/api/v1/admin/places").json()["items"][0]
    assert b.get(f"/api/v1/admin/places/{item['id']}").status_code == 200
    assert decide(b, ba, item).status_code == 200
    reads = b.get("/api/v1/admin/audit?kind=reads").json()["items"]
    changes = b.get("/api/v1/admin/audit?kind=changes").json()["items"]
    assert {row["action"] for row in reads}.issuperset({"place_list", "place_read"})
    assert "place_approve" in {row["action"] for row in changes}
    assert not {"place_list", "place_read"}.intersection(row["action"] for row in changes)


def test_hidden_place_reason_is_not_exposed_to_other_draft_owners(members, migration_engine):
    (a, aa), (b, ba) = members
    selected = proposal(a, aa).json()
    own_a = draft(a, aa, selected).json()["plan"]
    assert own_a["place_check_status"] == "pending"
    grant(migration_engine, ba)
    place = decide(b, ba, b.get("/api/v1/admin/places").json()["items"][0]).json()
    selected_b = b.post(
        "/api/v1/places/resolve", json={"provider_place_id": place["id"]}, headers=headers(ba)
    ).json()
    own_b = draft(b, ba, selected_b).json()["plan"]
    assert decide(b, ba, place, "hide", reason="Служебная причина решения").status_code == 200
    assert a.get("/api/v1/me/place-proposals").json()["items"][0]["reason"]
    assert (
        b.get(f"/api/v1/plans/{own_b['id']}").json()["plan"]["venue"]["moderation_reason"] is None
    )
