import csv
import io
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from test_accounts import clients as clients
from test_accounts import headers
from test_chat_archive import paired, send
from test_connections import decide, published, respond
from test_plans import members as members
from test_safety import context, make_admin, report

from poidem.db.models import (
    AdminAuditLog,
    AnalyticsEvent,
    FeedbackAnswer,
    Match,
    Plan,
    Survey,
    User,
)
from poidem.schemas.admin_dashboard import AnalyticsPeriod
from poidem.services.admin_analytics import csv_report, period_bounds
from poidem.services.analytics_events import COVERAGE_KEY

pytestmark = pytest.mark.database


def period(days=7):
    end = datetime.now(UTC).date()
    return {
        "start_date": str(end - timedelta(days=days - 1)),
        "end_date": str(end),
        "time_zone": "UTC",
    }


@pytest.fixture
def operator(members, migration_engine):
    (a, aa), _ = members
    make_admin(a, aa, migration_engine)
    with Session(migration_engine) as session:
        session.add(
            AnalyticsEvent(
                event_key=COVERAGE_KEY,
                event_type="measurement_started",
                occurred_at=datetime.now(UTC) - timedelta(days=400),
                allowed_dimensions={"policy": "D61-v1"},
            )
        )
        session.commit()
    return a, aa


def read(client, **params):
    response = client.get("/api/v1/admin/analytics", params={**period(), **params})
    assert response.status_code == 200, response.text
    return response.json()


def metrics(data):
    return {row["id"]: row for row in data["metrics"]}


def test_known_aggregates_unique_events_and_complete_funnel(operator, members, migration_engine):
    a, aa = operator
    (b, bb) = members[1]
    plan = published(members)
    for _ in range(2):
        assert b.post(f"/api/v1/plans/{plan['id']}/view", headers=headers(bb)).status_code == 200
    response = respond(b, bb, plan).json()["response"]
    match = decide(a, aa, response).json()["response"]["match_id"]
    assert send(b, bb, match, client_id=uuid.uuid4()).status_code == 201
    data = read(a)
    values = metrics(data)
    assert {
        key: values[key]["value"]
        for key in [
            "users_total",
            "new_users",
            "active_users",
            "plans_created",
            "plans_published",
            "responses",
            "matches",
            "confirmed_meetings",
            "pending_reports",
        ]
    } == dict(
        zip(
            [
                "users_total",
                "new_users",
                "active_users",
                "plans_created",
                "plans_published",
                "responses",
                "matches",
                "confirmed_meetings",
                "pending_reports",
            ],
            [2, 2, 2, 1, 1, 1, 1, 0, 0],
            strict=True,
        )
    )
    assert [row["value"] for row in data["funnel"]["stages"]] == [1, 1, 1, 1, 0]
    assert values["retention"]["value"] is None
    assert data["categories"][0]["value"] == 1
    with Session(migration_engine) as session:
        assert (
            session.scalar(
                select(func.count())
                .select_from(AnalyticsEvent)
                .where(AnalyticsEvent.event_type == "plan_detail_view")
            )
            == 1
        )


@pytest.mark.parametrize(
    "answers,expected",
    [
        ((True, True), "mutual_yes"),
        ((False, False), "mutual_no"),
        ((True, False), "conflicting"),
        ((True, None), "insufficient"),
        ((None, None), "no_data"),
    ],
)
def test_meeting_results_are_not_personal_rating(
    operator, members, migration_engine, answers, expected
):
    a, _ = operator
    plan, identity = paired(members)
    now = datetime.now(UTC)
    with Session(migration_engine) as session:
        match = session.get(Match, uuid.UUID(identity))
        match.meeting_starts_at = now - timedelta(hours=3)
        survey = session.scalar(select(Survey).where(Survey.match_id == match.id))
        survey.scheduled_at = now - timedelta(hours=1)
        for side, value in zip(("author", "responder"), answers, strict=True):
            if value is not None:
                session.add(
                    FeedbackAnswer(
                        survey_id=survey.id,
                        participant_side=side,
                        met=value,
                        rating=5 if value else None,
                        completion_state="submitted",
                        submitted_at=now,
                    )
                )
        session.commit()
    data = read(a)
    outcomes = {row["id"]: row["value"] for row in data["meetings"]}
    assert outcomes[expected] == 1 and sum(outcomes.values()) == 1
    assert metrics(data)["confirmed_meetings"]["value"] == int(expected == "mutual_yes")


def test_unknown_historical_views_and_publications_are_null(operator, members, migration_engine):
    a, _ = operator
    published(members)
    with Session(migration_engine) as session:
        marker = session.scalar(
            select(AnalyticsEvent).where(AnalyticsEvent.event_key == COVERAGE_KEY)
        )
        marker.occurred_at = datetime.now(UTC)
        session.commit()
    data = read(a)
    assert metrics(data)["plans_published"]["value"] is None
    assert data["funnel"]["stages"][0]["value"] is None


def test_export_is_same_snapshot_safe_csv_and_audited(operator):
    a, aa = operator
    response = a.post("/api/v1/admin/analytics/export", json=period(), headers=headers(aa))
    assert response.status_code == 200, response.text
    data = response.json()
    rows = list(csv.reader(io.StringIO(data["csv"].lstrip("\ufeff")), delimiter=";"))
    assert rows[1][2] == str(metrics(data["report"])["users_total"]["value"])
    assert "telegram_user_id" not in data["csv"]
    data["report"]["categories"] = [{"label": "=HYPERLINK(1)", "value": 1}]
    assert "'=HYPERLINK(1)" in csv_report(data["report"])
    assert a.post("/api/v1/admin/analytics/export", json=period()).status_code == 403


def test_comparable_periods_and_utc_boundaries(operator, migration_engine):
    a, _ = operator
    end = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    with Session(migration_engine) as session:
        users = session.scalars(select(User).order_by(User.id)).all()
        users[0].created_at = end - (datetime.now(UTC) - end) / 2
        users[1].created_at = end
        session.commit()
    data = read(a, start_date=str(end.date()), end_date=str(end.date()))
    values = metrics(data)
    assert values["new_users"]["value"] == 1 and values["new_users"]["previous"] == 1
    assert values["new_users"]["change_percent"] == 0
    assert data["daily"] == [{"date": str(end.date()), "registrations": 1, "active_users": 0}]


def test_repeated_publish_views_and_export_have_no_duplicate_measurements(
    operator, members, migration_engine
):
    a, aa = operator
    b, bb = members[1]
    plan = published(members)
    for _ in range(2):
        current = a.get(f"/api/v1/plans/{plan['id']}").json()["plan"]
        assert (
            a.post(
                f"/api/v1/plans/{plan['id']}/publish",
                json={"expected_version": current["version"]},
                headers=headers(aa),
            ).status_code
            == 200
        )
    assert a.post(f"/api/v1/plans/{plan['id']}/view", headers=headers(aa)).json() == {
        "recorded": False
    }
    with Session(migration_engine) as session:
        assert (
            session.scalar(
                select(func.count())
                .select_from(AnalyticsEvent)
                .where(AnalyticsEvent.event_type == "plan_published")
            )
            == 1
        )
    for _ in range(2):
        assert (
            a.post("/api/v1/admin/analytics/export", json=period(), headers=headers(aa)).status_code
            == 200
        )
    with Session(migration_engine) as session:
        assert (
            session.scalar(
                select(func.count())
                .select_from(AdminAuditLog)
                .where(AdminAuditLog.action == "admin_analytics_export")
            )
            == 2
        )
    assert read(a)["metrics"] == read(a)["metrics"]


def test_related_reports_and_existing_decisions_stay_scoped(operator, members):
    a, aa = operator
    b, bb = members[1]
    plan = published(members)
    identity = report(b, bb, context(plan["id"])).json()["id"]
    assert a.get("/api/v1/admin/plans", params={"has_reports": True}).json()["total"] == 1
    assert (
        a.get(
            "/api/v1/admin/reports", params={"plan_id": plan["id"], "reason_code": "content"}
        ).json()["items"][0]["id"]
        == identity
    )
    assert (
        a.get("/api/v1/admin/reports", params={"user_id": aa["user"]["id"]}).json()["items"][0][
            "id"
        ]
        == identity
    )
    assert (
        a.get("/api/v1/admin/reports", params={"plan_id": str(uuid.uuid4())}).json()["items"] == []
    )
    assert (
        a.post(
            f"/api/v1/admin/reports/{identity}/decision",
            json={"action": "hide_plan", "reason": "Проверенное нарушение"},
            headers=headers(aa),
        ).status_code
        == 200
    )
    assert a.get(f"/api/v1/admin/plans/{plan['id']}").json()["moderation_status"] == "rejected"
    assert metrics(read(a))["pending_reports"]["value"] == 0


def test_private_or_unknown_plan_views_do_not_create_events(operator, members, migration_engine):
    a, _ = operator
    b, bb = members[1]
    plan = published(members)
    with Session(migration_engine) as session:
        session.get(Plan, uuid.UUID(plan["id"])).publication_status = "draft"
        session.commit()
    assert b.post(f"/api/v1/plans/{plan['id']}/view", headers=headers(bb)).status_code == 404
    with Session(migration_engine) as session:
        assert (
            session.scalar(
                select(func.count())
                .select_from(AnalyticsEvent)
                .where(AnalyticsEvent.event_type == "plan_detail_view")
            )
            == 0
        )


def test_admin_directory_pagination_filters_private_allowlist(operator, members):
    a, _ = operator
    first = a.get("/api/v1/admin/users", params={"limit": 1}).json()
    second = a.get(
        "/api/v1/admin/users", params={"limit": 1, "cursor": first["next_cursor"]}
    ).json()
    assert first["total"] == 2
    assert first["items"][0]["id"] != second["items"][0]["id"]
    assert (
        a.get(
            "/api/v1/admin/users", params={"cursor": first["next_cursor"], "q": "changed"}
        ).status_code
        == 422
    )
    identity = first["items"][0]["id"]
    detail = a.get(f"/api/v1/admin/users/{identity}")
    assert detail.status_code == 200
    for key in ("telegram_user_id", "private_username", "photo", "bio", "csrf", "comment"):
        assert key not in detail.text
    plan = published(members)
    rows = a.get("/api/v1/admin/plans", params={"q": "%", "limit": 1}).json()
    assert rows["items"] == []  # SQL wildcards — обычный ввод
    assert a.get(f"/api/v1/admin/plans/{plan['id']}").json()["description"] == plan["description"]


def test_admin_access_boundaries_and_validation(operator, members, clients):
    a, _ = operator
    b, _ = members[1]
    paths = ["/admin/analytics", "/admin/users", "/admin/plans", "/admin/system"]
    for path in paths:
        assert b.get("/api/v1" + path, params=period()).status_code == 403
        assert clients().get("/api/v1" + path, params=period()).status_code == 401
    for params in [
        {"start_date": "2025-01-01", "end_date": "2026-11-01"},
        {"time_zone": "Not/AZone"},
        {"end_date": "2099-01-01"},
    ]:
        assert a.get("/api/v1/admin/analytics", params={**period(), **params}).status_code == 422
    system = a.get("/api/v1/admin/system").json()
    assert system["worker"] == "unknown" and system["database"] == "available"
    assert "database_url" not in str(system) and "token" not in str(system)


def test_comparison_intervals_are_adjacent_and_equal_across_dst():
    request = AnalyticsPeriod(
        start_date="2026-10-31", end_date="2026-11-02", time_zone="America/New_York"
    )
    start, stop, previous, previous_stop = period_bounds(
        request, datetime(2026, 11, 25, tzinfo=UTC)
    )
    assert stop - start == timedelta(hours=73)
    assert previous_stop == start and stop - start == previous_stop - previous


def test_meetings_count_distinct_matches_not_repeated_partners(operator, members, migration_engine):
    a, _ = operator
    identities = [paired(members)[1] for _ in range(2)]
    now = datetime.now(UTC)
    with Session(migration_engine) as session:
        for identity in identities:
            match = session.get(Match, uuid.UUID(identity))
            match.meeting_starts_at = now - timedelta(hours=3)
            survey = session.scalar(select(Survey).where(Survey.match_id == match.id))
            survey.scheduled_at = now - timedelta(hours=1)
            for side in ("author", "responder"):
                session.add(
                    FeedbackAnswer(
                        survey_id=survey.id,
                        participant_side=side,
                        met=True,
                        rating=5,
                        completion_state="submitted",
                        submitted_at=now,
                    )
                )
        session.commit()
    assert metrics(read(a))["confirmed_meetings"]["value"] == 2
    assert a.get("/api/v1/me/reliability").json()["unique_confirmed_partners"] == 1
    with Session(migration_engine) as session:
        survey = session.scalar(select(Survey).where(Survey.match_id == uuid.UUID(identities[0])))
        answer = session.get(FeedbackAnswer, (survey.id, "author"))
        answer.completion_state = "in_progress"
        answer.rating = None
        session.commit()
    data = read(a)
    assert metrics(data)["confirmed_meetings"]["value"] == 1
    assert next(row["value"] for row in data["meetings"] if row["id"] == "insufficient") == 1
