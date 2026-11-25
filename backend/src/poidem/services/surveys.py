"""D53/B09: два независимых самоотчёта, без рейтинга надёжности и доказанных фактов."""

import base64
import hmac
from datetime import UTC, timedelta
from zoneinfo import ZoneInfo

from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup
from sqlalchemy import and_, or_, select

from poidem.api.errors import AppError
from poidem.bot_ui import text_message
from poidem.db.models import FeedbackAnswer, Match, Plan, Survey, SurveyRecipient, User
from poidem.security.session import digest
from poidem.services import plans
from poidem.services.notifications import enqueue

POLICY = "D53-2h-1to5-optional-comment-edit7d"


def deadline(match):
    return (
        match.meeting_starts_at.astimezone(ZoneInfo(match.meeting_time_zone)) + timedelta(days=7)
    ).astimezone(UTC)


async def schedule(session, match):
    survey = Survey(
        match_id=match.id,
        scheduled_at=match.meeting_starts_at + timedelta(hours=2),
        meeting_context_version=match.accepted_plan_version,
        policy_version=POLICY,
    )
    session.add(survey)
    await session.flush()
    for side, user_id in (("author", match.author_id), ("responder", match.responder_id)):
        session.add(
            SurveyRecipient(survey_id=survey.id, participant_side=side, expires_at=deadline(match))
        )
        await enqueue(
            session,
            "post_meeting_survey",
            user_id,
            {"survey_id": str(survey.id), "side": side},
            f"survey:{survey.id}:{side}",
            due_at=survey.scheduled_at,
        )


def token_for(survey_id, side, settings):
    # В БД только hash; callback также проверяет реального Telegram-отправителя.
    key = settings.telegram_bot_token.get_secret_value().encode()
    value = hmac.digest(key, f"survey:{survey_id}:{side}".encode(), "sha256")[:16]
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def keyboard(token, stage="question"):
    choices = {
        "question": [("Да", "y"), ("Нет", "n")],
        "rating": [(str(number), f"r{number}") for number in range(1, 6)],
        "saved_yes": [("Добавить комментарий", "comment"), ("Изменить ответ", "edit")],
        "saved_no": [("Изменить ответ", "edit")],
    }[stage]
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text=label, callback_data=f"sv:{token}:{action}")]
            for label, action in choices
        ]
    )


async def delivery(session, job, settings):
    import uuid

    survey = await session.scalar(
        select(Survey).where(Survey.id == uuid.UUID(job.entity_ref["survey_id"])).with_for_update()
    )
    if not survey or survey.policy_version != POLICY:
        return None
    match = await session.get(Match, survey.match_id)
    side = job.entity_ref["side"]
    if side not in ("author", "responder"):
        return None
    user_id = match.author_id if side == "author" else match.responder_id
    plan = await session.get(Plan, match.plan_id)
    if (
        job.recipient_id != user_id
        or plan.publication_status == "cancelled"
        or plan.moderation_status not in plans.VISIBLE_MODERATION
        or not survey.scheduled_at <= plans.now() < deadline(match)
    ):
        return None
    answer = await session.get(FeedbackAnswer, (survey.id, side))
    if answer and answer.completion_state == "submitted":
        return None
    recipient = await session.get(SurveyRecipient, (survey.id, side))
    if not recipient:
        return None
    token = token_for(survey.id, side, settings)
    recipient.callback_token_hash = digest(token)
    survey.state = "available"
    return await question(session, survey), keyboard(token)


def unavailable():
    return AppError(404, "SURVEY_UNAVAILABLE", "Этот опрос недоступен или время ответа прошло")


async def question(session, survey):
    match = await session.get(Match, survey.match_id)
    plan = await session.get(Plan, match.plan_id)
    date = match.meeting_starts_at.astimezone(ZoneInfo(match.meeting_time_zone))
    return text_message("Вы встретились?", f"План «{plan.title}»", f"{date:%d.%m.%Y, %H:%M}")


async def recipient_for(session, telegram_id, token=None, prompt_id=None):
    identity = or_(
        and_(SurveyRecipient.participant_side == "author", User.id == Match.author_id),
        and_(SurveyRecipient.participant_side == "responder", User.id == Match.responder_id),
    )
    query = (
        select(SurveyRecipient, Survey, Match, Plan)
        .join(Survey, Survey.id == SurveyRecipient.survey_id)
        .join(Match, Match.id == Survey.match_id)
        .join(Plan, Plan.id == Match.plan_id)
        .join(User, identity)
        .where(User.telegram_user_id == telegram_id, User.account_status == "active")
    )
    if token is not None:
        query = query.where(SurveyRecipient.callback_token_hash == digest(token))
    elif prompt_id is not None:
        query = query.where(SurveyRecipient.comment_prompt_message_id == prompt_id)
    else:
        raise unavailable()
    row = (await session.execute(query.with_for_update(of=Survey))).first()
    if not row:
        raise unavailable()
    recipient, survey, match, plan = row
    if (
        survey.policy_version != POLICY
        or survey.state != "available"
        or not survey.scheduled_at <= plans.now() < deadline(match)
        or recipient.expires_at is None
        or plans.now() >= recipient.expires_at
        or plan.publication_status == "cancelled"
        or plan.moderation_status not in plans.VISIBLE_MODERATION
    ):
        raise unavailable()
    return recipient, survey


async def answer(session, telegram_id, token, action):
    recipient, survey = await recipient_for(session, telegram_id, token=token)
    current = await session.get(FeedbackAnswer, (survey.id, recipient.participant_side))
    if action == "edit":
        return await question(session, survey), keyboard(token), False
    if action not in ("y", "n", "comment", *(f"r{n}" for n in range(1, 6))):
        raise unavailable()
    if current is None:
        current = FeedbackAnswer(survey_id=survey.id, participant_side=recipient.participant_side)
        session.add(current)
    previous = (current.met, current.rating, current.comment, current.completion_state)
    if action == "y":
        current.met = True
        current.rating = None
        current.completion_state = "in_progress"
    elif action == "n":
        current.met = False
        current.rating = None
        current.comment = None
        current.completion_state = "submitted"
        recipient.comment_prompt_message_id = None
    else:
        if current.met is not True:
            raise unavailable()
        if action == "comment":
            if current.rating is None:
                raise unavailable()
            return (
                text_message("Добавь комментарий", "Ответь на это сообщение: до 2000 символов"),
                None,
                True,
            )
        current.rating = int(action[1:])
        current.completion_state = "submitted"
    if previous != (current.met, current.rating, current.comment, current.completion_state):
        current.updated_at = plans.now()
        current.submitted_at = plans.now() if current.completion_state == "submitted" else None
    if current.met and current.rating is None:
        return text_message("Как оценишь встречу?", "От 1 до 5"), keyboard(token, "rating"), False
    return (
        text_message("Ответ сохранён", "Комментарий необязателен" if current.met else ""),
        keyboard(token, "saved_yes" if current.met else "saved_no"),
        False,
    )


async def comment(session, telegram_id, prompt_id, body):
    recipient, survey = await recipient_for(session, telegram_id, prompt_id=prompt_id)
    current = await session.get(FeedbackAnswer, (survey.id, recipient.participant_side))
    if not current or current.met is not True or current.rating is None:
        raise unavailable()
    if not body.strip() or len(body) > 2000:
        raise AppError(422, "FEEDBACK_COMMENT_INVALID", "Комментарий: от 1 до 2000 символов")
    if current.comment != body.strip():
        current.comment = body.strip()
        current.updated_at = plans.now()
        current.submitted_at = plans.now()
    return text_message("Комментарий сохранён")
