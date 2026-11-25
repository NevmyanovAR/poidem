import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from bot_helpers import bot_settings as bot_settings
from bot_helpers import callback, message, run
from bot_helpers import clock as clock
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from test_accounts import clients as clients
from test_accounts import headers, login, profile, upload
from test_bot_surveys import only_surveys
from test_chat_archive import paired
from test_plans import members as members
from test_safety import context, make_admin, report

from poidem.db.models import FeedbackAnswer, Match, Plan, ReliabilityEvent, Survey, SurveyRecipient
from poidem.services.surveys import deadline

pytestmark = pytest.mark.database


@pytest.fixture
def meeting(members, migration_engine, clock):
    plan, match_id = paired(members)
    with Session(migration_engine) as session:
        survey = session.scalar(select(Survey))
        clock[0] = survey.scheduled_at
    return plan, match_id


def answer(member, match_id, met=True, **fields):
    client, account = member
    return client.post(
        f"/api/v1/matches/{match_id}/feedback",
        json={"met": met, **({"rating": 4} if met else {}), **fields},
        headers=headers(account),
    )


def status(client, match_id):
    result = client.get(f"/api/v1/matches/{match_id}/survey")
    assert result.status_code == 200, result.text
    return result.json()


def count(client):
    response = client.get("/api/v1/me/reliability")
    assert response.status_code == 200, response.text
    return response.json()["unique_confirmed_partners"]


@pytest.mark.parametrize(
    "left,right,result",
    [
        (True, True, "mutual_yes"),
        (False, False, "mutual_no"),
        (True, False, "conflicting"),
        (False, True, "conflicting"),
        (True, None, "insufficient"),
        (False, None, "insufficient"),
        (None, True, "insufficient"),
        (None, False, "insufficient"),
        (None, None, "no_data"),
    ],
)
def test_result_matrix_two_roles_without_penalties(members, meeting, left, right, result):
    _, identity = meeting
    for member, met in zip(members, (left, right), strict=True):
        if met is not None:
            saved = answer(member, identity, met)
            assert saved.status_code == 200, saved.text
    for client, _ in members:
        view = status(client, identity)
        assert view["result"]["result"] == result
        assert count(client) == int(result == "mutual_yes")


def test_private_ratings_comments_and_foreign_identity_are_not_disclosed(
    members, meeting, clients, migration_engine
):
    (a, aa), (b, bb) = members
    _, identity = meeting
    assert answer(members[0], identity, rating=1, comment="Личный ответ А").status_code == 200
    assert answer(members[1], identity, rating=5, comment="Личный ответ Б").status_code == 200
    assert status(a, identity)["own_answer"]["rating"] == 1
    assert "Личный ответ Б" not in str(status(a, identity))
    assert "Личный ответ А" not in str(status(b, identity))
    c = clients()
    cc = login(c, 303)
    make_admin(c, cc, migration_engine)
    path = f"/api/v1/matches/{identity}"
    for stranger in (c, clients()):
        expected = 404 if stranger is c else 401
        assert stranger.get(path + "/survey").status_code == expected
        assert (
            stranger.post(path + "/feedback", json={"met": False}, headers=headers(cc)).status_code
            == expected
        )
    for field in ("participant_side", "user_id", "telegram_id", "score", "policy_version"):
        assert answer(members[0], identity, **{field: bb["user"]["id"]}).status_code == 422
    assert a.post(path + "/feedback", json={"met": False}).status_code == 403
    assert status(b, identity)["own_answer"]["rating"] == 5


@pytest.mark.parametrize(
    "payload",
    [
        {"met": "yes", "rating": 4},
        {"met": 1, "rating": 4},
        {"met": True},
        {"met": True, "rating": 6},
        {"met": True, "rating": 3.5},
        {"met": True, "rating": True},
        {"met": False, "rating": 4},
        {"met": False, "comment": "Нельзя"},
        {"met": True, "rating": 4, "comment": "a" * 2001},
    ],
)
def test_server_validates_existing_b09_fields(members, meeting, payload):
    a, aa = members[0]
    assert (
        a.post(
            f"/api/v1/matches/{meeting[1]}/feedback", json=payload, headers=headers(aa)
        ).status_code
        == 422
    )
    assert status(a, meeting[1])["own_answer"] is None


def test_simultaneous_answers_and_retries_are_idempotent(members, meeting, migration_engine, clock):
    _, identity = meeting
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda member: answer(member, identity), members))
    assert [r.status_code for r in results] == [200, 200]
    before = status(members[0][0], identity)["own_answer"]["updated_at"]
    clock[0] += timedelta(seconds=2)
    with ThreadPoolExecutor(max_workers=4) as pool:
        assert all(
            r.status_code == 200 for r in pool.map(lambda _: answer(members[0], identity), range(4))
        )
    assert status(members[0][0], identity)["own_answer"]["updated_at"] == before
    assert count(members[0][0]) == count(members[1][0]) == 1
    with migration_engine.connect() as connection:
        assert connection.scalar(select(func.count()).select_from(FeedbackAnswer)) == 2
        assert connection.scalar(select(func.count()).select_from(ReliabilityEvent)) == 0


def test_edits_recompute_counter_and_same_pair_counts_once(
    members, meeting, migration_engine, clock
):
    _, identity = meeting
    for member in members:
        assert answer(member, identity).status_code == 200
    assert count(members[0][0]) == 1
    assert answer(members[1], identity, False).status_code == 200
    assert count(members[0][0]) == 0
    assert status(members[0][0], identity)["result"]["result"] == "conflicting"
    assert answer(members[1], identity).status_code == 200
    # Ещё две настоящие строки Match/Survey для той же пары через действующие API.
    clock[0] -= timedelta(hours=2)
    for _ in range(2):
        _, other = paired(members)
        with Session(migration_engine) as session:
            survey = session.scalar(select(Survey).where(Survey.match_id == uuid.UUID(other)))
            clock[0] = survey.scheduled_at
        for member in members:
            assert answer(member, other).status_code == 200
        clock[0] -= timedelta(hours=2)
    clock[0] += timedelta(hours=2)
    assert count(members[0][0]) == count(members[1][0]) == 1


def test_window_cancellation_archive_and_read_after_expiry(
    members, meeting, migration_engine, clock
):
    plan, identity = meeting
    a, _ = members[0]
    clock[0] -= timedelta(microseconds=1)
    assert status(a, identity)["availability"] == "upcoming"
    assert answer(members[0], identity).status_code == 409
    clock[0] += timedelta(microseconds=1)
    for member in members:
        assert answer(member, identity).status_code == 200
    with Session(migration_engine) as session:
        match = session.get(Match, uuid.UUID(identity))
        clock[0] = deadline(match)
    assert status(a, identity)["availability"] == "expired"
    assert answer(members[0], identity, False).status_code == 409
    # Архив вычисляется прежним D50 независимо от результата опроса.
    assert a.get(f"/api/v1/matches/{identity}").json()["match"]["archived"] is True
    assert status(a, identity)["result"]["result"] == "mutual_yes"
    assert count(a) == 1
    with Session(migration_engine) as session:
        session.get(Plan, uuid.UUID(plan["id"])).publication_status = "cancelled"
        session.commit()
    assert status(a, identity)["availability"] == "cancelled"
    assert status(a, identity)["own_answer"]["submitted"] is True
    assert count(a) == 0


def test_profile_changes_do_not_reset_experience(members, meeting):
    a, aa = members[0]
    _, identity = meeting
    for member in members:
        assert answer(member, identity).status_code == 200
    current = a.get("/api/v1/me").json()["profile"]
    photo = upload(a, aa).json()
    result = a.put(
        "/api/v1/me/profile",
        json=profile(
            photo,
            name="Другое имя",
            age=35,
            bio="Новое описание",
            expected_version=current["version"],
        ),
        headers=headers(aa),
    )
    assert result.status_code == 200, result.text
    assert count(a) == 1
    view = members[1][0].get(f"/api/v1/matches/{identity}").json()["match"]
    assert view["participants"][0]["profile"]["name"] == "Другое имя"
    assert view["participants"][0]["profile"]["experience"]["unique_confirmed_partners"] == 1


def test_report_links_only_scoped_meeting_and_has_no_reputation_penalty(
    members, meeting, migration_engine, clients
):
    (a, aa), (b, bb) = members
    _, identity = meeting
    assert (
        answer(members[0], identity, rating=1, comment="Закрытый комментарий А").status_code == 200
    )
    assert answer(members[1], identity, False).status_code == 200
    complaint = report(b, bb, context(identity, "match", "match"), reason_code="harassment")
    assert complaint.status_code == 201, complaint.text
    c = clients()
    cc = login(c, 303)
    make_admin(c, cc, migration_engine)
    detail = c.get(f"/api/v1/admin/reports/{complaint.json()['id']}").json()
    assert detail["meeting_review"]["current"]["result"] == "conflicting"
    assert detail["meeting_review"]["at_report"]["result"] == "conflicting"
    assert "Закрытый комментарий" not in str(detail)
    assert "rating" not in str(detail["meeting_review"])
    assert c.get(f"/api/v1/matches/{identity}/survey").status_code == 404
    assert a.get(f"/api/v1/admin/reports/{complaint.json()['id']}").status_code == 403
    assert answer(members[1], identity).status_code == 200
    detail = c.get(f"/api/v1/admin/reports/{complaint.json()['id']}").json()
    assert detail["meeting_review"]["current"]["result"] == "mutual_yes"
    assert detail["meeting_review"]["at_report"]["result"] == "conflicting"
    assert (
        b.post(
            "/api/v1/me/blocks", json=context(identity, "match", "match"), headers=headers(bb)
        ).status_code
        == 200
    )
    assert count(a) == count(b) == 1
    assert (
        c.post(
            f"/api/v1/admin/reports/{complaint.json()['id']}/decision",
            json={"action": "confirm_violation", "reason": "Нельзя назначить нарушение"},
            headers=headers(cc),
        ).status_code
        == 422
    )


def test_seven_calendar_days_across_dst():
    match = SimpleNamespace(
        meeting_starts_at=datetime(2026, 3, 7, 15, tzinfo=UTC), meeting_time_zone="America/New_York"
    )
    assert deadline(match) == datetime(2026, 3, 14, 14, tzinfo=UTC)


def test_different_partners_increase_only_their_own_totals(
    members, meeting, clients, migration_engine, clock
):
    for member in members:
        assert answer(member, meeting[1]).status_code == 200
    c = clients()
    cc = login(c, 303)
    photo = upload(c, cc).json()
    assert c.put("/api/v1/me/profile", json=profile(photo), headers=headers(cc)).status_code == 200
    clock[0] -= timedelta(hours=2)
    _, other = paired((members[0], (c, cc)))
    with Session(migration_engine) as session:
        clock[0] = session.scalar(
            select(Survey).where(Survey.match_id == uuid.UUID(other))
        ).scheduled_at
    for member in (members[0], (c, cc)):
        assert answer(member, other).status_code == 200
    assert count(members[0][0]) == 2
    assert count(members[1][0]) == count(c) == 1


def test_bot_http_share_answers_and_restarting_worker_does_not_duplicate(
    members, meeting, bot_settings, migration_engine, clock
):
    only_surveys(migration_engine)
    token = None

    async def first(db, bot, handler, worker):
        nonlocal token
        await handler.process(message(1))
        for _ in range(2):
            await worker.run_once()
        delivered = next(
            item
            for item in bot.sent
            if item.get("reply_markup")
            and (item["reply_markup"].inline_keyboard[0][0].callback_data or "").startswith("sv:")
        )
        token = delivered["reply_markup"].inline_keyboard[0][0].callback_data.split(":")[1]
        await handler.process(callback(2, 101, f"sv:{token}:y"))
        # Незавершённое Да не считается завершённым ответом/подтверждением.
        assert status(members[1][0], meeting[1])["result"]["result"] == "no_data"
        assert answer(members[1], meeting[1]).status_code == 200
        await handler.process(callback(3, 101, f"sv:{token}:r5"))
        assert status(members[1][0], meeting[1])["result"]["result"] == "mutual_yes"
        assert count(members[0][0]) == 1

    run(bot_settings, first)

    async def restarted(db, bot, handler, worker):
        await handler.process(callback(3, 101, f"sv:{token}:r5"))
        await handler.process(callback(4, 101, f"sv:{token}:r5"))
        assert not await worker.run_once()
        assert count(members[0][0]) == count(members[1][0]) == 1
        async with db.sessions() as session:
            assert await session.scalar(select(func.count()).select_from(FeedbackAnswer)) == 2
            assert await session.scalar(select(func.count()).select_from(ReliabilityEvent)) == 0

    run(bot_settings, restarted)


@pytest.mark.parametrize("condition", ["closed", "recipient_expired", "recipient_without_deadline"])
def test_api_cannot_bypass_existing_survey_closure(
    members, meeting, migration_engine, clock, condition
):
    with Session(migration_engine) as session:
        survey = session.scalar(select(Survey))
        recipient = session.get(SurveyRecipient, (survey.id, "author"))
        if condition == "closed":
            survey.state = "closed"
        else:
            recipient.expires_at = clock[0] if condition == "recipient_expired" else None
        session.commit()
    assert answer(members[0], meeting[1]).status_code == 409
    assert status(members[0][0], meeting[1])["own_answer"] is None


def test_archive_without_second_answer_does_not_create_a_no_show(
    members, meeting, migration_engine, clock
):
    assert answer(members[0], meeting[1]).status_code == 200
    with Session(migration_engine) as session:
        clock[0] = deadline(session.get(Match, uuid.UUID(meeting[1])))
    for client, _ in members:
        view = status(client, meeting[1])
        assert view["result"]["result"] == "insufficient"
        assert view["can_answer"] is False
        assert count(client) == 0
    assert status(members[1][0], meeting[1])["own_answer"] is None
