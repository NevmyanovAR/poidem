import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy import func, select
from test_accounts import clients as clients
from test_accounts import headers, login, profile, upload
from test_plans import create, publish
from test_plans import members as members

from poidem.db.models import Match, Photo, Plan, PlanResponse, User

pytestmark = pytest.mark.database


def published(members):
    (a, aa), _ = members
    return publish(a, aa, create(a, aa).json()["plan"]).json()["plan"]


def respond(client, account, plan, *, key=None, **changes):
    return client.post(
        f"/api/v1/plans/{plan['id']}/responses",
        json={"expected_plan_version": plan["version"], **changes},
        headers={**headers(account), "Idempotency-Key": str(key or uuid.uuid4())},
    )


def decide(client, account, response, decision="accept", **changes):
    return client.post(
        f"/api/v1/responses/{response['id']}/decision",
        json={"decision": decision, "expected_version": response["version"], **changes},
        headers=headers(account),
    )


def test_public_profile_is_scoped_and_private_photo_remains_private(members):
    (a, aa), (b, _) = members
    plan = published(members)
    response = b.get(f"/api/v1/plans/{plan['id']}/author")
    assert response.status_code == 200, response.text
    public = response.json()["profile"]
    assert set(public) == {"name", "age", "bio", "interests", "photo"}
    assert set(public["photo"]) == {"url"}
    assert len(public["interests"]) == 3
    photo = b.get(public["photo"]["url"])
    assert photo.status_code == 200
    assert photo.headers["content-type"] == "image/jpeg"
    assert "no-store" in photo.headers["cache-control"]
    private = a.get("/api/v1/me/profile").json()["profile"]["photo"]["url"]
    assert b.get(private).status_code == 404
    assert (
        a.post(
            f"/api/v1/plans/{plan['id']}/cancel",
            json={"expected_version": plan["version"]},
            headers=headers(aa),
        ).status_code
        == 200
    )
    assert b.get(public["photo"]["url"]).status_code == 404


def test_create_repeat_and_contextual_visibility(members, clients, migration_engine):
    (a, aa), (b, bb) = members
    plan = published(members)
    key = uuid.uuid4()
    first = respond(b, bb, plan, key=key)
    assert first.status_code == 201, first.text
    entry = first.json()["response"]
    assert entry["status"] == "waiting" and entry["match_id"] is None
    assert respond(b, bb, plan, key=key).json()["response"]["id"] == entry["id"]
    assert respond(b, bb, plan).json()["response"]["id"] == entry["id"]
    assert respond(b, bb, plan, key=key, expected_plan_version=999).status_code == 409
    with migration_engine.connect() as connection:
        assert connection.scalar(select(func.count()).select_from(PlanResponse)) == 1
    incoming = a.get("/api/v1/me/responses").json()["items"]
    assert incoming[0]["id"] == entry["id"] and incoming[0]["profile"]
    assert len(b.get("/api/v1/me/responses?direction=outgoing").json()["items"]) == 1
    assert b.get(f"/api/v1/plans/{plan['id']}/responses").status_code == 404
    c = clients()
    login(c, 303)
    assert c.get(f"/api/v1/responses/{entry['id']}").status_code == 404
    assert c.get(f"/api/v1/responses/{entry['id']}/profile/photo").status_code == 404
    assert a.get(incoming[0]["profile"]["photo"]["url"]).status_code == 200
    assert decide(b, bb, entry).status_code == 404
    assert decide(a, aa, entry, expected_version=999).status_code == 409
    text = first.text
    for private in (
        "telegram_user_id",
        "private_username",
        "preference_code",
        "gender_code",
        "storage_key",
        "csrf_token",
    ):
        assert private not in text


def test_rejection_releases_slot_but_permanently_hides_plan(members, migration_engine):
    (a, aa), (b, bb) = members
    plan = published(members)
    key = uuid.uuid4()
    first = respond(b, bb, plan, key=key).json()["response"]
    rejected = decide(a, aa, first, "decline")
    assert rejected.status_code == 200, rejected.text
    assert decide(a, aa, first, "decline").status_code == 200
    assert decide(a, aa, first, "accept").status_code == 409
    assert respond(b, bb, plan, key=key).status_code == 409
    assert b.get(f"/api/v1/plans/{plan['id']}/capacity").status_code == 404
    assert respond(b, bb, plan).status_code == 409
    assert not b.get("/api/v1/plans").json()["items"]
    for suffix in ("", "/author", "/author/photo"):
        assert b.get(f"/api/v1/plans/{plan['id']}" + suffix).status_code == 404
    result = b.get("/api/v1/me/responses?direction=outgoing").json()["items"][0]
    assert result["status"] == "rejected" and result["plan"] is None and result["profile"] is None
    second = publish(a, aa, create(a, aa).json()["plan"]).json()["plan"]
    assert [item["id"] for item in b.get("/api/v1/plans").json()["items"]] == [second["id"]]
    with migration_engine.connect() as connection:
        entries = connection.execute(
            select(PlanResponse.status, PlanResponse.slot_no).order_by(PlanResponse.created_at)
        ).all()
        assert entries == [("rejected", None)]
    assert a.get(f"/api/v1/responses/{first['id']}/profile/photo").status_code == 404
    # Даже последующая правка оператором и новый подписанный вход не сбрасывают отказ.
    with migration_engine.begin() as connection:
        connection.execute(
            Plan.__table__.update()
            .where(Plan.id == uuid.UUID(plan["id"]))
            .values(title="Обновлённое название")
        )
    login(b, 202)
    assert b.get(f"/api/v1/plans/{plan['id']}").status_code == 404
    assert [item["id"] for item in b.get("/api/v1/plans").json()["items"]] == [second["id"]]


def test_own_hidden_past_invalid_and_unauthorized_responses(members, clients, migration_engine):
    (a, aa), (b, bb) = members
    plan = published(members)
    assert respond(a, aa, plan).status_code == 409
    assert respond(b, bb, plan, responder_id=aa["user"]["id"]).status_code == 422
    assert respond(b, bb, plan, expected_plan_version=True).status_code == 422
    assert respond(b, bb, plan, expected_plan_version=999).status_code == 409
    anon = clients()
    for path in (
        "/me/responses",
        "/me/matches",
        f"/plans/{plan['id']}/author",
        f"/plans/{plan['id']}/author/photo",
        f"/plans/{plan['id']}/capacity",
    ):
        assert anon.get("/api/v1" + path).status_code == 401
    assert respond(anon, bb, plan).status_code == 401
    assert (
        b.post(
            f"/api/v1/plans/{plan['id']}/responses", json={"expected_plan_version": plan["version"]}
        ).status_code
        == 403
    )
    assert (
        b.get(
            f"/api/v1/plans/{plan['id']}/author", headers={"X-Account-Context": aa["user"]["id"]}
        ).status_code
        == 409
    )
    for status in ("draft", "cancelled", "closed"):
        with migration_engine.begin() as connection:
            connection.execute(
                Plan.__table__.update()
                .where(Plan.id == uuid.UUID(plan["id"]))
                .values(publication_status=status)
            )
        assert respond(b, bb, plan).status_code == 404


def test_accept_creates_one_pair_and_closes_other_responses(members, clients, migration_engine):
    (a, aa), (b, bb) = members
    c = clients()
    cc = login(c, 303)
    photo = upload(c, cc).json()
    assert c.put("/api/v1/me/profile", json=profile(photo), headers=headers(cc)).status_code == 200
    plan = published(members)
    first = respond(b, bb, plan).json()["response"]
    other = respond(c, cc, plan).json()["response"]
    result = decide(a, aa, first)
    assert result.status_code == 200, result.text
    match_id = result.json()["response"]["match_id"]
    assert match_id
    assert decide(a, aa, first).json()["response"]["match_id"] == match_id
    assert decide(a, aa, other).status_code == 409
    assert c.get(f"/api/v1/responses/{other['id']}").json()["response"]["status"] == "closed"
    for client in (a, b):
        pairs = client.get("/api/v1/me/matches").json()["items"]
        assert len(pairs) == 1 and pairs[0]["id"] == match_id
        assert len(pairs[0]["participants"]) == 2
        assert all(p["profile"] for p in pairs[0]["participants"])
        for part in pairs[0]["participants"]:
            assert client.get(part["profile"]["photo"]["url"]).status_code == 200
    for path in (
        f"/matches/{match_id}",
        f"/matches/{match_id}/contact",
        f"/matches/{match_id}/photo/author",
    ):
        assert c.get("/api/v1" + path).status_code == 404
    assert a.get("/api/v1/me/plans").json()["items"][0]["publication_status"] == "closed"
    assert b.get("/api/v1/plans").json()["items"] == []
    with migration_engine.connect() as connection:
        assert connection.scalar(select(func.count()).select_from(Match)) == 1
        closed = connection.execute(
            select(PlanResponse.slot_no, PlanResponse.decision_actor_id).where(
                PlanResponse.id == uuid.UUID(other["id"])
            )
        ).one()
        assert closed == (None, None)
    # Контакт до принятия не появился в публичных/ответных DTO.
    assert "telegram_url" not in result.text
    with migration_engine.begin() as connection:
        connection.execute(
            User.__table__.update()
            .where(User.id == uuid.UUID(aa["user"]["id"]))
            .values(private_username=None)
        )
    contact = b.get(f"/api/v1/matches/{match_id}/contact")
    assert contact.status_code == 200
    assert contact.json()["available"] is False
    with migration_engine.begin() as connection:
        connection.execute(
            User.__table__.update()
            .where(User.id == uuid.UUID(aa["user"]["id"]))
            .values(private_username="Synthetic_A")
        )
    assert (
        b.get(f"/api/v1/matches/{match_id}/contact").json()["telegram_url"]
        == "https://t.me/Synthetic_A"
    )
    with migration_engine.begin() as connection:
        connection.execute(
            User.__table__.update()
            .where(User.id == uuid.UUID(aa["user"]["id"]))
            .values(private_username="evil/?redirect=secret")
        )
    assert b.get(f"/api/v1/matches/{match_id}/contact").json()["available"] is False


def test_concurrent_accepts_cannot_create_second_match(members, clients, migration_engine):
    (a, aa), (b, bb) = members
    c = clients()
    cc = login(c, 303)
    photo = upload(c, cc).json()
    c.put("/api/v1/me/profile", json=profile(photo), headers=headers(cc))
    plan = published(members)
    entries = [respond(b, bb, plan).json()["response"], respond(c, cc, plan).json()["response"]]
    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(lambda entry: decide(a, aa, entry).status_code, entries))
    assert sorted(outcomes) == [200, 409]
    with migration_engine.connect() as connection:
        assert connection.scalar(select(func.count()).select_from(Match)) == 1


@pytest.mark.parametrize("_round", range(3))
def test_concurrent_responses_limit_fifteen_and_new_person_after_decline(
    clients, migration_engine, monkeypatch, _round
):
    from poidem.api import errors

    captured = []
    original = errors.internal_error_response

    def capture(request, error):
        captured.append(
            (
                type(error).__name__,
                getattr(getattr(error, "orig", None), "sqlstate", None),
                str(error)[:100] if isinstance(error, Warning) else None,
            )
        )
        return original(request, error)

    monkeypatch.setattr(errors, "internal_error_response", capture)
    people = []
    for identity in range(1000, 1018):
        client = clients()
        account = login(client, identity)
        photo = upload(client, account).json()
        assert (
            client.put(
                "/api/v1/me/profile", json=profile(photo), headers=headers(account)
            ).status_code
            == 200
        )
        people.append((client, account))
    a, aa = people[0]
    plan = publish(a, aa, create(a, aa).json()["plan"]).json()["plan"]
    with ThreadPoolExecutor(max_workers=17) as pool:
        results = list(pool.map(lambda pair: respond(*pair, plan), people[1:]))
    assert sum(result.status_code == 201 for result in results) == 15, [
        r.status_code for r in results
    ]
    assert sum(result.status_code == 409 for result in results) == 2, {
        "statuses": [result.status_code for result in results],
        "error_types": captured,
    }
    first = next(result.json()["response"] for result in results if result.status_code == 201)
    assert decide(a, aa, first, "decline").status_code == 200
    new_person = next(
        person
        for person, result in zip(people[1:], results, strict=True)
        if result.status_code == 409
    )
    assert respond(*new_person, plan).status_code == 201
    with migration_engine.connect() as connection:
        assert (
            connection.scalar(
                select(func.count())
                .select_from(PlanResponse)
                .where(PlanResponse.status == "waiting")
            )
            == 15
        )
        assert connection.scalar(select(func.count(func.distinct(PlanResponse.responder_id)))) == 16


def test_blocked_photo_and_user_cannot_be_matched(members, migration_engine):
    (a, aa), (b, bb) = members
    plan = published(members)
    entry = respond(b, bb, plan).json()["response"]
    with migration_engine.begin() as connection:
        connection.execute(
            Photo.__table__.update()
            .where(Photo.owner_id == uuid.UUID(bb["user"]["id"]))
            .values(moderation_status="blocked")
        )
    assert decide(a, aa, entry).status_code == 404
    assert not a.get("/api/v1/me/matches").json()["items"]
    with migration_engine.begin() as connection:
        connection.execute(
            User.__table__.update()
            .where(User.id == uuid.UUID(bb["user"]["id"]))
            .values(account_status="blocked")
        )
    assert b.get("/api/v1/me/responses").status_code == 403
    assert decide(a, aa, entry, "decline").status_code == 200


def test_parallel_duplicate_sends_create_one_active_response(members, migration_engine):
    _, (b, bb) = members
    plan = published(members)
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(lambda _: respond(b, bb, plan), range(6)))
    assert sorted(result.status_code for result in results) == [200, 200, 200, 200, 200, 201]
    assert len({result.json()["response"]["id"] for result in results}) == 1
    with migration_engine.connect() as connection:
        assert connection.scalar(select(func.count()).select_from(PlanResponse)) == 1


def test_edit_and_response_cannot_silently_change_consent(members):
    (a, aa), (b, bb) = members
    plan = published(members)
    with ThreadPoolExecutor(max_workers=2) as pool:
        editing = pool.submit(
            lambda: a.patch(
                f"/api/v1/plans/{plan['id']}",
                json={"expected_version": plan["version"], "place": "Другой вход"},
                headers=headers(aa),
            )
        )
        sending = pool.submit(lambda: respond(b, bb, plan))
        outcomes = (editing.result().status_code, sending.result().status_code)
    assert outcomes in ((200, 409), (409, 201)), outcomes


def test_contact_and_match_photos_are_revoked_on_restriction(members, migration_engine):
    (a, aa), (b, bb) = members
    plan = published(members)
    response = respond(b, bb, plan).json()["response"]
    identity = decide(a, aa, response).json()["response"]["match_id"]
    with migration_engine.begin() as connection:
        connection.execute(
            Plan.__table__.update()
            .where(Plan.id == uuid.UUID(plan["id"]))
            .values(moderation_status="blocked")
        )
    assert b.get(f"/api/v1/matches/{identity}/contact").status_code == 404
    assert b.get(f"/api/v1/matches/{identity}/photo/author").status_code == 404
    assert all(
        part["profile"] is None
        for part in b.get(f"/api/v1/matches/{identity}").json()["match"]["participants"]
    )


def test_expired_plan_cannot_accept_and_no_match_is_created(members, migration_engine):
    from datetime import UTC, datetime, timedelta

    (a, aa), (b, bb) = members
    plan = published(members)
    response = respond(b, bb, plan).json()["response"]
    with migration_engine.begin() as connection:
        connection.execute(
            Plan.__table__.update()
            .where(Plan.id == uuid.UUID(plan["id"]))
            .values(starts_at=datetime.now(UTC) - timedelta(seconds=1))
        )
    assert decide(a, aa, response).status_code == 409
    assert respond(b, bb, plan).status_code == 404
    assert not a.get("/api/v1/me/matches").json()["items"]
