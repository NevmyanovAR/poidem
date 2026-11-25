import uuid
from datetime import timedelta

import pytest
from bot_helpers import bot_settings as bot_settings
from bot_helpers import callback, message, run
from bot_helpers import clock as clock
from sqlalchemy import func, select, update
from test_accounts import clients as clients
from test_chat_archive import paired
from test_connections import decide, published, respond
from test_plans import members as members

from poidem.db.models import (
    FeedbackAnswer,
    NotificationJob,
    Plan,
    ReliabilityEvent,
    Survey,
    SurveyRecipient,
)

pytestmark = pytest.mark.database


def only_surveys(migration_engine):
    with migration_engine.begin() as connection:
        connection.execute(
            update(NotificationJob)
            .where(NotificationJob.kind != "post_meeting_survey")
            .values(state="suppressed")
        )


def test_survey_schedule_and_retry_accept_do_not_duplicate(members, migration_engine):
    (a, aa), (b, bb) = members
    plan = published(members)
    response = respond(b, bb, plan).json()["response"]
    assert decide(a, aa, response).status_code == 200
    assert decide(a, aa, response).status_code == 200
    with migration_engine.connect() as connection:
        survey = connection.execute(
            select(Survey.scheduled_at, Survey.meeting_context_version)
        ).one()
        assert survey.scheduled_at.isoformat().replace("+00:00", "Z")
        assert connection.scalar(select(func.count()).select_from(Survey)) == 1
        assert connection.scalar(select(func.count()).select_from(SurveyRecipient)) == 2
        assert (
            connection.scalar(
                select(func.count())
                .select_from(NotificationJob)
                .where(NotificationJob.kind == "post_meeting_survey")
            )
            == 2
        )
        assert connection.scalar(select(func.count()).select_from(FeedbackAnswer)) == 0


def test_two_independent_answers_comment_edit_expiry_and_foreign_callback_are_safe(
    members, clients, bot_settings, migration_engine, clock
):
    plan, _ = paired(members)
    only_surveys(migration_engine)

    async def execute(db, bot, handler, worker):
        await handler.process(message(1))
        await handler.process(message(2, 202))
        bot.sent.clear()
        async with db.sessions() as session:
            survey = await session.scalar(select(Survey))
            clock[0] = survey.scheduled_at - timedelta(seconds=1)
        assert not await worker.run_once()
        clock[0] += timedelta(seconds=1)
        assert await worker.run_once()
        assert await worker.run_once()
        assert len(bot.sent) == 2 and {item["chat_id"] for item in bot.sent} == {101, 202}
        for item in bot.sent:
            assert item["text"].startswith("<b>Вы встретились?</b>\n\nПлан «")
            assert plan["title"] in item["text"]
        data = {
            item["chat_id"]: item["reply_markup"].inline_keyboard[0][0].callback_data
            for item in bot.sent
        }
        a_token, b_token = data[101].split(":")[1], data[202].split(":")[1]
        assert a_token != b_token
        await handler.process(callback(3, 303, data[101]))  # Не участник.
        async with db.sessions() as session:
            assert await session.scalar(select(func.count()).select_from(FeedbackAnswer)) == 0
        await handler.process(callback(4, 101, f"sv:{a_token}:y"))
        async with db.sessions() as session:
            answers = (await session.scalars(select(FeedbackAnswer))).all()
            assert len(answers) == 1 and answers[0].met is True
            assert answers[0].rating is None and answers[0].completion_state == "in_progress"
        await handler.process(callback(5, 101, f"sv:{a_token}:r6"))
        assert "недоступен" in bot.sent[-1]["text"]
        await handler.process(callback(6, 101, f"sv:{a_token}:r5"))
        await handler.process(callback(7, 101, f"sv:{a_token}:comment"))
        async with db.sessions() as session:
            prompt = await session.scalar(
                select(SurveyRecipient.comment_prompt_message_id).where(
                    SurveyRecipient.participant_side == "author"
                )
            )
        assert prompt
        await handler.process(message(8, 202, "Чужой комментарий", prompt_id=prompt))
        assert "недоступен" in bot.sent[-1]["text"]
        await handler.process(message(9, 101, "Комментарий только для теста", prompt_id=prompt))
        await handler.process(callback(10, 202, f"sv:{b_token}:n"))
        async with db.sessions() as session:
            rows = {
                answer.participant_side: answer
                for answer in (await session.scalars(select(FeedbackAnswer))).all()
            }
            assert rows["author"].met is True and rows["author"].rating == 5
            assert rows["author"].comment == "Комментарий только для теста"
            assert rows["responder"].met is False and rows["responder"].rating is None
            assert await session.scalar(select(func.count()).select_from(ReliabilityEvent)) == 0
        await handler.process(callback(11, 101, f"sv:{a_token}:edit"))
        await handler.process(callback(14, 101, f"sv:{a_token}:y"))
        assert "От 1 до 5" in bot.sent[-1]["text"]
        await handler.process(callback(15, 101, f"sv:{a_token}:r3"))
        async with db.sessions() as session:
            changed = await session.scalar(
                select(FeedbackAnswer).where(FeedbackAnswer.participant_side == "author")
            )
            assert changed.rating == 3 and changed.comment == "Комментарий только для теста"
        await handler.process(callback(12, 101, f"sv:{a_token}:n"))
        async with db.sessions() as session:
            changed = await session.scalar(
                select(FeedbackAnswer).where(FeedbackAnswer.participant_side == "author")
            )
            assert changed.met is False and changed.rating is None and changed.comment is None
            expires = await session.scalar(select(SurveyRecipient.expires_at).limit(1))
        clock[0] = expires
        await handler.process(callback(13, 101, f"sv:{a_token}:y"))
        assert "время ответа прошло" in bot.sent[-1]["text"]
        async with db.sessions() as session:
            assert (
                await session.scalar(
                    select(FeedbackAnswer.met).where(FeedbackAnswer.participant_side == "author")
                )
                is False
            )
        assert not await worker.run_once()  # Напоминаний нет.

    run(bot_settings, execute)


@pytest.mark.parametrize("action", ["n", "r4", "comment"])
def test_identical_answer_with_new_update_keeps_original_timestamps(
    members, bot_settings, migration_engine, clock, action
):
    paired(members)
    only_surveys(migration_engine)

    async def execute(db, bot, handler, worker):
        await handler.process(message(1))
        async with db.sessions() as session:
            survey = await session.scalar(select(Survey))
            clock[0] = survey.scheduled_at
        for _ in range(2):
            await worker.run_once()
        delivered = next(
            item
            for item in bot.sent
            if item.get("reply_markup")
            and (item["reply_markup"].inline_keyboard[0][0].callback_data or "").startswith("sv:")
        )
        token = delivered["reply_markup"].inline_keyboard[0][0].callback_data.split(":")[1]
        if action != "n":
            await handler.process(callback(2, 101, f"sv:{token}:y"))
            await handler.process(callback(3, 101, f"sv:{token}:r4"))
        if action == "comment":
            await handler.process(callback(4, 101, f"sv:{token}:comment"))
            async with db.sessions() as session:
                prompt = await session.scalar(
                    select(SurveyRecipient.comment_prompt_message_id).where(
                        SurveyRecipient.participant_side == "author"
                    )
                )
            first = message(5, 101, "Синтетический комментарий", prompt_id=prompt)
            again = message(6, 101, "Синтетический комментарий", prompt_id=prompt)
        else:
            first = callback(5, 101, f"sv:{token}:{action}")
            again = callback(6, 101, f"sv:{token}:{action}")
        await handler.process(first)
        async with db.sessions() as session:
            before = (
                await session.execute(
                    select(FeedbackAnswer.updated_at, FeedbackAnswer.submitted_at)
                )
            ).one()
        clock[0] += timedelta(seconds=1)
        await handler.process(first)  # Тот же Telegram update.
        await handler.process(again)  # Та же операция в новом update.
        async with db.sessions() as session:
            after = (
                await session.execute(
                    select(FeedbackAnswer.updated_at, FeedbackAnswer.submitted_at)
                )
            ).one()
            assert after == before
            assert await session.scalar(select(func.count()).select_from(FeedbackAnswer)) == 1
            assert await session.scalar(select(func.count()).select_from(ReliabilityEvent)) == 0

    run(bot_settings, execute)


@pytest.mark.parametrize("case", ["cancelled", "expired", "not_started", "opt_out"])
def test_cancelled_or_undeliverable_survey_does_not_become_a_no_answer(
    members, bot_settings, migration_engine, clock, case
):
    plan, _ = paired(members)
    only_surveys(migration_engine)
    if case == "cancelled":
        with migration_engine.begin() as connection:
            connection.execute(
                update(Plan)
                .where(Plan.id == uuid.UUID(plan["id"]))
                .values(publication_status="cancelled")
            )

    async def execute(db, bot, handler, worker):
        if case != "not_started":
            command = "/notifications_off" if case == "opt_out" else "/start"
            await handler.process(message(1, text=command))
            await handler.process(message(2, 202, command))
        bot.sent.clear()
        async with db.sessions() as session:
            survey = await session.scalar(select(Survey))
            clock[0] = survey.scheduled_at + timedelta(days=8 if case == "expired" else 0)
        for _ in range(3):
            await worker.run_once()
        assert not bot.sent
        async with db.sessions() as session:
            assert await session.scalar(select(func.count()).select_from(FeedbackAnswer)) == 0
            assert await session.scalar(select(func.count()).select_from(ReliabilityEvent)) == 0
            assert set(
                (
                    await session.scalars(
                        select(NotificationJob.state).where(
                            NotificationJob.kind == "post_meeting_survey"
                        )
                    )
                ).all()
            ) == {"suppressed"}

    run(bot_settings, execute)
