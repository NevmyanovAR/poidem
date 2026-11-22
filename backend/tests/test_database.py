import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import inspect, select, text
from sqlalchemy.exc import IntegrityError, ProgrammingError

from poidem.db.base import Base
from poidem.db.models import (
    AdminAuditLog,
    AnalyticsEvent,
    BotBinding,
    DailyPlanUsage,
    FeedbackAnswer,
    GenderOption,
    Interest,
    Match,
    ModerationCase,
    ModerationDecision,
    NotificationJob,
    Photo,
    PlanResponse,
    PreferenceOption,
    Profile,
    ProfileInterest,
    Survey,
    SurveyRecipient,
    User,
)

pytestmark = pytest.mark.database


def response_for(plan, person, slot, **overrides):
    values = {
        "plan_id": plan.id,
        "plan_author_id": plan.author_id,
        "responder_id": person.id,
        "agreed_plan_version": 1,
        "slot_no": slot,
    }
    values.update(overrides)
    return PlanResponse(**values)


def match_for(plan, response, **overrides):
    values = {
        "response_id": response.id,
        "plan_id": plan.id,
        "author_id": plan.author_id,
        "responder_id": response.responder_id,
        "accepted_plan_version": 1,
        "meeting_starts_at": plan.starts_at,
        "meeting_time_zone": plan.time_zone,
        "meeting_place": plan.place,
    }
    values.update(overrides)
    return Match(**values)


def test_migrations_create_complete_schema(runtime_engine):
    tables = set(inspect(runtime_engine).get_table_names())
    assert set(Base.metadata.tables) <= tables
    with runtime_engine.connect() as connection:
        assert connection.scalar(text("SELECT version_num FROM alembic_version")) == "0002"


def test_roles_are_not_superusers(runtime_engine, migration_engine):
    for engine in (runtime_engine, migration_engine):
        with engine.connect() as connection:
            assert connection.execute(
                text(
                    "SELECT rolsuper, rolcreatedb, rolcreaterole "
                    "FROM pg_roles WHERE rolname=current_user"
                )
            ).one() == (False, False, False)


def test_runtime_cannot_change_schema_or_alembic_version(runtime_engine):
    for statement in (
        "CREATE TABLE public.unauthorized_table (id integer)",
        "UPDATE alembic_version SET version_num='unauthorized'",
        "INSERT INTO interests (code,title) VALUES ('unauthorized','unauthorized')",
    ):
        with runtime_engine.connect() as connection:
            with pytest.raises(ProgrammingError) as caught:
                connection.execute(text(statement))
            assert caught.value.orig.sqlstate == "42501"


def test_telegram_id_uses_bigint_and_is_unique(db):
    first = User(telegram_user_id=2**50)
    db.add(first)
    db.flush()
    assert db.scalar(select(User.telegram_user_id).where(User.id == first.id)) == 2**50
    db.add(User(telegram_user_id=2**50))
    with pytest.raises(IntegrityError):
        db.flush()


def test_user_delete_does_not_cascade_into_plans(db, plan, users):
    db.delete(users[0])
    with pytest.raises(IntegrityError):
        db.flush()


@pytest.mark.parametrize("used", [-1, 4])
def test_quota_cannot_exceed_confirmed_bounds(db, users, used):
    db.add(
        DailyPlanUsage(
            user_id=users[0].id,
            quota_day=datetime.now(UTC).date(),
            used=used,
            calendar_zone="UTC",
            policy_version="test-not-a-business-default",
        )
    )
    with pytest.raises(IntegrityError):
        db.flush()


@pytest.mark.parametrize("slot", [0, 16, None])
def test_invalid_or_missing_waiting_response_slot_rejected(db, plan, users, slot):
    db.add(response_for(plan, users[1], slot))
    with pytest.raises(IntegrityError):
        db.flush()


def test_author_cannot_respond_to_own_plan(db, plan, users):
    db.add(response_for(plan, users[0], 1))
    with pytest.raises(IntegrityError):
        db.flush()


def test_wrong_plan_author_is_rejected(db, plan, users):
    db.add(response_for(plan, users[1], 1, plan_author_id=users[2].id))
    with pytest.raises(IntegrityError):
        db.flush()


def test_one_person_cannot_create_duplicate_responses(db, plan, users):
    db.add(response_for(plan, users[1], 1))
    db.flush()
    db.add(response_for(plan, users[1], 2))
    with pytest.raises(IntegrityError):
        db.flush()


def test_fifteen_occupied_slots_and_no_duplicate_slot(db, plan, users):
    db.add_all(response_for(plan, users[i], i) for i in range(1, 16))
    db.flush()
    db.add(response_for(plan, users[16], 15))
    with pytest.raises(IntegrityError):
        db.flush()


def test_only_author_can_be_recorded_as_decision_actor(db, plan, users):
    db.add(
        response_for(
            plan,
            users[1],
            1,
            status="accepted",
            decision_actor_id=users[2].id,
            decided_at=datetime.now(UTC),
        )
    )
    with pytest.raises(IntegrityError):
        db.flush()


def test_match_cannot_substitute_a_third_participant(db, plan, accepted_response, users):
    db.add(match_for(plan, accepted_response, responder_id=users[2].id))
    with pytest.raises(IntegrityError):
        db.flush()


def test_repeated_match_for_same_response_is_rejected(db, plan, accepted_response):
    db.add(match_for(plan, accepted_response))
    db.flush()
    db.add(match_for(plan, accepted_response))
    with pytest.raises(IntegrityError):
        db.flush()


def test_bot_binding_cannot_claim_another_telegram_identity(db, users):
    db.add(
        BotBinding(
            user_id=users[0].id,
            telegram_user_id=users[1].telegram_user_id,
            private_chat_id=users[1].telegram_user_id,
        )
    )
    with pytest.raises(IntegrityError):
        db.flush()


@pytest.mark.parametrize("target_count", [0, 2])
def test_moderation_case_requires_exactly_one_target(db, users, target_count):
    db.add(
        ModerationCase(
            target_user_id=users[0].id if target_count else None,
            profile_user_id=None,
            photo_id=None,
            # Второй реальный FK не требуется: нарушен CHECK раньше/независимо от FK.
            plan_id=uuid.uuid4() if target_count else None,
            object_version=1,
            workflow_version="test-only",
        )
    )
    with pytest.raises(IntegrityError):
        db.flush()


def test_notifications_are_deduplicated(db, users):
    now = datetime.now(UTC)
    for _ in range(2):
        db.add(
            NotificationJob(
                kind="test",
                recipient_id=users[0].id,
                dedupe_key="same-test-key",
                due_at=now,
                next_attempt_at=now,
            )
        )
    with pytest.raises(IntegrityError):
        db.flush()


def test_analytics_event_is_not_counted_twice(db):
    db.add_all(
        [
            AnalyticsEvent(event_key="same-test-event", event_type="test"),
            AnalyticsEvent(event_key="same-test-event", event_type="test"),
        ]
    )
    with pytest.raises(IntegrityError):
        db.flush()


@pytest.mark.parametrize("table", [AdminAuditLog.__table__, ModerationDecision.__table__])
def test_history_is_append_only_for_runtime_role(runtime_engine, table):
    for statement in (table.update().values(id=uuid.uuid4()), table.delete()):
        with runtime_engine.connect() as connection:
            with pytest.raises(ProgrammingError) as caught:
                connection.execute(statement)
            assert caught.value.orig.sqlstate == "42501"


def test_profile_photo_must_belong_to_profile_owner(privileged_db):
    session = privileged_db
    owner, stranger = User(telegram_user_id=111), User(telegram_user_id=222)
    session.add_all(
        [
            owner,
            stranger,
            GenderOption(code="test", title="Тест"),
            PreferenceOption(code="test", title="Тест"),
        ]
    )
    session.flush()
    photo = Photo(
        owner_id=stranger.id,
        storage_key=str(uuid.uuid4()),
        media_type="image/png",
        byte_size=100,
        width=10,
        height=10,
    )
    session.add(photo)
    session.flush()
    session.add(
        Profile(
            user_id=owner.id,
            name="Тест",
            age=24,
            gender_code="test",
            preference_code="test",
            bio="Тест",
            photo_id=photo.id,
        )
    )
    with pytest.raises(IntegrityError) as caught:
        session.flush()
    assert caught.value.orig.diag.constraint_name == "fk_profiles_photo_owner"


@pytest.mark.parametrize(
    "position, constraint",
    [
        (2, "uq_profile_interests_user_interest"),
        (4, "ck_profile_interests_position_range"),
    ],
)
def test_interests_cannot_repeat_or_use_fourth_position(privileged_db, position, constraint):
    session = privileged_db
    person = User(telegram_user_id=333)
    session.add_all(
        [
            person,
            GenderOption(code="test", title="Тест"),
            PreferenceOption(code="test", title="Тест"),
            Interest(code="test", title="Тест"),
        ]
    )
    session.flush()
    photo = Photo(
        owner_id=person.id,
        storage_key=str(uuid.uuid4()),
        media_type="image/png",
        byte_size=100,
        width=10,
        height=10,
    )
    session.add(photo)
    session.flush()
    session.add(
        Profile(
            user_id=person.id,
            name="Тест",
            age=24,
            gender_code="test",
            preference_code="test",
            bio="Тест",
            photo_id=photo.id,
        )
    )
    session.flush()
    session.add(ProfileInterest(user_id=person.id, position=1, interest_code="test"))
    session.flush()
    session.add(ProfileInterest(user_id=person.id, position=position, interest_code="test"))
    with pytest.raises(IntegrityError) as caught:
        session.flush()
    assert caught.value.orig.diag.constraint_name == constraint


def test_feedback_preserves_unknown_meeting_and_exactly_two_sides(db, plan, accepted_response):
    match = match_for(plan, accepted_response)
    db.add(match)
    db.flush()
    survey = Survey(
        match_id=match.id,
        scheduled_at=datetime.now(UTC),
        meeting_context_version=1,
        policy_version="test-only",
    )
    db.add(survey)
    db.flush()
    db.add_all(
        [
            SurveyRecipient(survey_id=survey.id, participant_side=side)
            for side in ("author", "responder")
        ]
    )
    db.flush()
    answer = FeedbackAnswer(survey_id=survey.id, participant_side="author")
    db.add(answer)
    db.flush()
    assert answer.met is None
    with pytest.raises(IntegrityError):
        db.execute(
            text("INSERT INTO survey_recipients (survey_id,participant_side) VALUES (:id,'third')"),
            {"id": survey.id},
        )
