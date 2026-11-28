import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from bot_helpers import clock as clock
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session
from test_accounts import clients as clients
from test_accounts import headers, login, profile, upload
from test_chat_archive import paired
from test_meeting_feedback import answer
from test_meeting_feedback import meeting as meeting
from test_places import grant
from test_plans import body, publish
from test_plans import members as members

from poidem.db.models import AdminAuditLog, Plan, PositiveImpression, Survey

pytestmark = pytest.mark.database


def free_plan(member, **changes):
    client, account = member
    payload = body(
        place_name="  Кафе   у музея ",
        place_address=" Москва, ул. Примерная, д. 1. Вход А ",
        **changes,
    )
    payload.pop("place")
    result = client.post(
        "/api/v1/plans",
        json=payload,
        headers={**headers(account), "Idempotency-Key": str(uuid.uuid4())},
    )
    assert result.status_code == 201, result.text
    return result.json()["plan"]


def check_place(member, plan, **changes):
    client, account = member
    return client.post(
        f"/api/v1/admin/place-checks/{plan['id']}/decision",
        headers=headers(account),
        json={
            "expected_revision": 1,
            "expected_version": 1,
            "decision": "confirmed",
            "reason": "Сверены название и адрес по источнику",
            "evidence_confirmed": True,
            **changes,
        },
    )


def impressions(member, identity, options=("pleasant",), **changes):
    client, account = member
    return client.put(
        f"/api/v1/matches/{identity}/impressions",
        headers=headers(account),
        json={
            "options": list(options),
            "consent_version": "positive-impressions-v1",
            "consent_accepted": True,
            **changes,
        },
    )


def test_free_publication_review_and_reset(members, migration_engine, monkeypatch):
    import aiohttp

    monkeypatch.setattr(
        aiohttp.ClientSession, "get", lambda *a, **k: pytest.fail("No external Places API")
    )
    (a, aa), (b, ba) = members
    draft = free_plan(members[0])
    assert draft["place_name"] == "Кафе у музея"
    assert draft["place_address"] == "Москва, ул. Примерная, д. 1. Вход А"
    assert draft["place"] == "Кафе у музея · Москва, ул. Примерная, д. 1. Вход А"
    assert "publish" in draft["allowed_actions"]
    result = publish(a, aa, draft)
    assert result.status_code == 200, result.text
    plan = result.json()["plan"]
    assert plan["place_check_status"] == "pending"
    assert b.get("/api/v1/plans").json()["items"][0]["id"] == plan["id"]
    assert check_place(members[1], plan).status_code == 403
    grant(migration_engine, ba)
    queue = b.get("/api/v1/admin/place-checks").json()
    assert queue["items"][0]["plan_title"] == plan["title"]
    assert check_place(members[1], plan, evidence_confirmed=False).status_code == 422
    assert check_place(members[1], plan).status_code == 200
    assert check_place(members[1], plan).status_code == 409
    checked = a.get(f"/api/v1/plans/{plan['id']}").json()["plan"]
    assert checked["place_check_status"] == "confirmed" and checked["version"] == plan["version"]
    edited = a.patch(
        f"/api/v1/plans/{plan['id']}",
        headers=headers(aa),
        json={"expected_version": checked["version"], "title": "Другое название плана"},
    ).json()["plan"]
    assert edited["place_check_status"] == "confirmed"
    edited = a.patch(
        f"/api/v1/plans/{plan['id']}",
        headers=headers(aa),
        json={"expected_version": edited["version"], "place_address": "Москва, ул. Другая, 2"},
    ).json()["plan"]
    assert edited["place_check_status"] == "pending"
    assert edited["publication_status"] == "published"
    assert check_place(members[1], plan).status_code == 409
    assert (
        check_place(
            members[1],
            edited,
            expected_revision=2,
            expected_version=3,
            decision="unconfirmed",
            evidence_confirmed=False,
        ).status_code
        == 200
    )
    assert (
        a.get(f"/api/v1/plans/{plan['id']}").json()["plan"]["place_check_status"] == "unconfirmed"
    )
    assert b.get("/api/v1/plans").json()["items"]
    with migration_engine.connect() as c:
        assert (
            c.scalar(
                select(func.count())
                .select_from(AdminAuditLog)
                .where(AdminAuditLog.action == "place_check_decision")
            )
            == 2
        )


@pytest.mark.parametrize(
    "changes",
    [
        {"place_name": ""},
        {"place_name": "Музей\x00"},
        {"place_address": " "},
        {"place_name": "x" * 161},
        {"place_address": "x" * 301},
        {"place_check_status": "confirmed"},
        {"place_checked_by": str(uuid.uuid4())},
        {"place_revision": 100},
    ],
)
def test_free_fields_validation_no_spoof(members, changes):
    a, aa = members[0]
    payload = body(place_name="Музей", place_address="Город, улица 1") | changes
    assert (
        a.post(
            "/api/v1/plans",
            json=payload,
            headers={**headers(aa), "Idempotency-Key": str(uuid.uuid4())},
        ).status_code
        == 422
    )


def test_optional_review_roles_csrf_parallel_and_legacy(members, clients, migration_engine):
    a, aa = members[0]
    draft = free_plan(members[0])
    plan = publish(a, aa, draft).json()["plan"]
    b, ba = members[1]
    for role in ("analyst", "user"):
        grant(migration_engine, ba, role)
        assert b.get("/api/v1/admin/place-checks").status_code == 403
    grant(migration_engine, ba)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: check_place(members[1], plan), range(2)))
    assert sorted(r.status_code for r in results) == [200, 409]
    path = f"/api/v1/admin/place-checks/{plan['id']}/decision"
    assert (
        b.post(
            path,
            json={
                "expected_revision": 1,
                "expected_version": 2,
                "decision": "unconfirmed",
                "reason": "Нет сведений",
            },
        ).status_code
        == 403
    )
    grant(migration_engine, aa)
    assert check_place(members[0], plan, expected_version=2).status_code == 200
    assert clients().get("/api/v1/admin/place-checks").status_code == 401
    # No guessed splitting/backfill of historical strings.
    with migration_engine.begin() as c:
        c.execute(
            update(Plan)
            .where(Plan.id == uuid.UUID(plan["id"]))
            .values(
                place_name=None,
                place_address=None,
                place="Старый адрес, корпус. Вход без разделителя",
            )
        )
    view = a.get(f"/api/v1/plans/{plan['id']}").json()["plan"]
    assert view["place_name"] is None and view["place_address"] is None
    assert view["place"] == "Старый адрес, корпус. Вход без разделителя"


def test_impressions_require_mutual_consent_and_only_own_answers(
    members, meeting, clients, migration_engine
):
    _, identity = meeting
    (a, aa), (b, ba) = members
    path = f"/api/v1/matches/{identity}/impressions"
    assert impressions(members[0], identity).status_code == 409
    assert answer(members[0], identity).status_code == 200
    assert impressions(members[0], identity).status_code == 409
    assert answer(members[1], identity, rating=1, comment="Приватная оценка").status_code == 200
    assert a.get("/api/v1/me/reliability").json()["pleasant_communication"] is False
    for fields in (
        {"consent_accepted": False},
        {"consent_version": "fake"},
        {"subject_id": aa["user"]["id"]},
        {"options": ["negative"]},
        {"options": ["pleasant", "pleasant"]},
    ):
        assert impressions(members[0], identity, **fields).status_code == 422
    assert impressions(members[0], identity, options=("pleasant", "comfortable")).status_code == 200
    assert a.get(path).json()["own_options"] == ["pleasant", "comfortable"]
    assert b.get(path).json()["own_options"] == []
    assert "Приватная оценка" not in a.get(path).text
    stranger = clients()
    login(stranger, 303)
    assert stranger.get(path).status_code == 404
    assert clients().get(path).status_code == 401
    assert (
        b.put(
            path,
            json={
                "options": ["pleasant"],
                "consent_accepted": True,
                "consent_version": "positive-impressions-v1",
            },
        ).status_code
        == 403
    )
    assert impressions(members[0], identity, options=("interesting",)).status_code == 200
    with migration_engine.connect() as c:
        assert c.scalar(select(func.count()).select_from(PositiveImpression)) == 1
    assert answer(members[1], identity, False).status_code == 200
    assert a.get(path).json()["eligible"] is False
    assert impressions(members[0], identity).status_code == 409
    assert a.delete(path, headers=headers(aa)).json()["submitted"] is False
    assert a.delete(path, headers=headers(aa)).status_code == 200


def test_three_distinct_partners_recompute_and_no_public_counts(
    members, clients, migration_engine, clock
):
    a, aa = members[0]
    base = clock[0]
    identities = []
    others = [members[1]]
    for telegram in (303, 404):
        c = clients()
        account = login(c, telegram)
        photo = upload(c, account).json()
        assert (
            c.put("/api/v1/me/profile", json=profile(photo), headers=headers(account)).status_code
            == 200
        )
        others.append((c, account))
    for index, partner in enumerate(others):
        clock[0] = base
        _, identity = paired((members[0], partner))
        identities.append(identity)
        with Session(migration_engine) as s:
            clock[0] = s.scalar(
                select(Survey).where(Survey.match_id == uuid.UUID(identity))
            ).scheduled_at
        assert answer(members[0], identity).status_code == 200
        assert answer(partner, identity).status_code == 200
        assert (
            impressions(
                partner, identity, options=("pleasant", "interesting", "comfortable")
            ).status_code
            == 200
        )
        assert a.get("/api/v1/me/reliability").json()["pleasant_communication"] is (index == 2)
    # Updating/duplicating one partner never creates a fourth vote.
    with ThreadPoolExecutor(max_workers=3) as pool:
        assert all(
            x.status_code == 200
            for x in pool.map(lambda _: impressions(others[2], identities[2]), range(3))
        )
    assert a.get("/api/v1/me/reliability").json()["pleasant_communication"] is True
    assert answer(others[2], identities[2], False).status_code == 200
    assert a.get("/api/v1/me/reliability").json()["pleasant_communication"] is False
    assert answer(others[2], identities[2]).status_code == 200
    assert a.get("/api/v1/me/reliability").json()["pleasant_communication"] is True
    c, cc = others[2]
    assert (
        c.delete(f"/api/v1/matches/{identities[2]}/impressions", headers=headers(cc)).status_code
        == 200
    )
    assert a.get("/api/v1/me/reliability").json()["pleasant_communication"] is False
    view = a.get(f"/api/v1/matches/{identities[0]}").json()
    assert (
        "own_options" not in str(view)
        and "rating" not in str(view)
        and "positive_count" not in str(view)
    )


def test_repeated_meetings_with_one_partner_do_not_reach_threshold(
    members, migration_engine, clock
):
    base = clock[0]
    for _ in range(3):
        clock[0] = base
        _, identity = paired(members)
        with Session(migration_engine) as session:
            clock[0] = session.scalar(
                select(Survey).where(Survey.match_id == uuid.UUID(identity))
            ).scheduled_at
        for member in members:
            assert answer(member, identity).status_code == 200
        for member in members:
            assert impressions(member, identity).status_code == 200
    for client, _ in members:
        result = client.get("/api/v1/me/reliability").json()
        assert result["unique_confirmed_partners"] == 1
        assert result["pleasant_communication"] is False
    # Cancellation invalidates the contribution without deleting private answers.
    with migration_engine.begin() as c:
        c.execute(update(Plan).values(publication_status="cancelled"))
    assert members[0][0].get("/api/v1/me/reliability").json()["unique_confirmed_partners"] == 0


def test_positive_threshold_is_runtime_configuration(
    clients, api_settings, migration_engine, clock
):
    api_settings.positive_impressions_threshold = 1
    people = []
    for telegram in (101, 202):
        client = clients()
        account = login(client, telegram)
        photo = upload(client, account).json()
        assert (
            client.put(
                "/api/v1/me/profile", json=profile(photo), headers=headers(account)
            ).status_code
            == 200
        )
        people.append((client, account))
    _, identity = paired(people)
    with Session(migration_engine) as session:
        clock[0] = session.scalar(
            select(Survey).where(Survey.match_id == uuid.UUID(identity))
        ).scheduled_at
    for member in people:
        assert answer(member, identity).status_code == 200
    assert impressions(people[1], identity).status_code == 200
    assert people[0][0].get("/api/v1/me/reliability").json()["pleasant_communication"] is True


def test_review_does_not_change_agreed_plan_and_related_location_is_immutable(
    members, migration_engine
):
    from test_connections import decide, respond

    a, aa = members[0]
    b, ba = members[1]
    draft = free_plan(members[0])
    plan = publish(a, aa, draft).json()["plan"]
    pending = respond(b, ba, plan).json()["response"]
    grant(migration_engine, ba)
    assert check_place(members[1], plan).status_code == 200
    current = a.get(f"/api/v1/plans/{plan['id']}").json()["plan"]
    assert current["version"] == plan["version"]
    edit = {
        "expected_version": current["version"],
        "place_name": "Другой музей",
        "place_address": "Город, улица 2",
    }
    assert a.patch(f"/api/v1/plans/{plan['id']}", json=edit, headers=headers(aa)).status_code == 409
    matched = decide(a, aa, pending)
    assert matched.status_code == 200, matched.text
    identity = matched.json()["response"]["match_id"]
    meeting = a.get(f"/api/v1/matches/{identity}").json()["match"]
    assert meeting["place"] == plan["place"]
    assert meeting["place_check_status"] == "confirmed"
    assert (
        check_place(
            members[1], plan, expected_version=2, decision="unconfirmed", evidence_confirmed=False
        ).status_code
        == 200
    )
    meeting = a.get(f"/api/v1/matches/{identity}").json()["match"]
    assert meeting["place_check_status"] == "unconfirmed"
    assert not meeting["meeting_cancelled"] and meeting["place"] == plan["place"]
