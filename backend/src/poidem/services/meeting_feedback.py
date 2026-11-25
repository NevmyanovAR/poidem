"""D58: результаты самоотчётов, собственный ответ и счётчик, без оценок/санкций."""

from sqlalchemy import and_, case, distinct, func, select

from poidem.api.errors import AppError
from poidem.db.models import FeedbackAnswer, Match, Plan, Survey, SurveyRecipient
from poidem.schemas.feedback import ExperienceDTO, MeetingResultDTO, OwnFeedbackDTO, SurveyDTO
from poidem.security.session import lock_actor
from poidem.services import plans, surveys


def result_from(answers):
    completed = {
        row.participant_side: row.met
        for row in answers
        if row.completion_state == "submitted" and row.met is not None
    }
    if len(completed) == 2:
        result = (
            "mutual_yes"
            if all(completed.values())
            else "mutual_no"
            if not any(completed.values())
            else "conflicting"
        )
    else:
        result = "insufficient" if completed else "no_data"
    return MeetingResultDTO(
        result=result,
        author_answered="author" in completed,
        responder_answered="responder" in completed,
    )


async def answers_for(session, survey):
    return (
        list(
            (
                await session.scalars(
                    select(FeedbackAnswer).where(FeedbackAnswer.survey_id == survey.id)
                )
            ).all()
        )
        if survey
        else []
    )


async def experience(session, user_id):
    # Источник истины — текущие ответы, не второй журнал/снимок счёта.
    # Исправление ответа пересчитывается сразу; множество партнёров не накручивается
    # повторами одной пары. Имена/фото/жалобы/блокировки/оценки не участвуют.
    author = FeedbackAnswer.__table__.alias("experience_author")
    responder = FeedbackAnswer.__table__.alias("experience_responder")
    partner = case((Match.author_id == user_id, Match.responder_id), else_=Match.author_id)
    query = (
        select(func.count(distinct(partner)))
        .select_from(Match)
        .join(Survey, Survey.match_id == Match.id)
        .join(Plan, Plan.id == Match.plan_id)
        .join(author, and_(author.c.survey_id == Survey.id, author.c.participant_side == "author"))
        .join(
            responder,
            and_(responder.c.survey_id == Survey.id, responder.c.participant_side == "responder"),
        )
        .where(
            (Match.author_id == user_id) | (Match.responder_id == user_id),
            Survey.policy_version == surveys.POLICY,
            Survey.scheduled_at <= plans.now(),
            Plan.publication_status != "cancelled",
            author.c.completion_state == "submitted",
            author.c.met.is_(True),
            responder.c.completion_state == "submitted",
            responder.c.met.is_(True),
        )
    )
    return ExperienceDTO(unique_confirmed_partners=await session.scalar(query))


async def status_for(session, match, actor_id):
    survey = await session.scalar(select(Survey).where(Survey.match_id == match.id))
    answers = await answers_for(session, survey)
    side = "author" if actor_id == match.author_id else "responder"
    own = next((row for row in answers if row.participant_side == side), None)
    plan = await session.get(Plan, match.plan_id)
    availability = "not_scheduled"
    recipient = await session.get(SurveyRecipient, (survey.id, side)) if survey else None
    if survey:
        if plan.publication_status == "cancelled":
            availability = "cancelled"
        elif (
            survey.policy_version != surveys.POLICY
            or survey.state == "closed"
            or plan.moderation_status not in plans.VISIBLE_MODERATION
            or recipient is None
            or recipient.expires_at is None
        ):
            availability = "unavailable"
        elif plans.now() >= min(surveys.deadline(match), recipient.expires_at):
            availability = "expired"
        elif plans.now() < survey.scheduled_at:
            availability = "upcoming"
        else:
            # Получение ответа не зависит от доставки Telegram и opt-out бота.
            availability = "available"
    outcome = result_from(answers)
    return SurveyDTO(
        availability=availability,
        opens_at=survey.scheduled_at if survey else None,
        closes_at=min(surveys.deadline(match), recipient.expires_at)
        if survey and recipient and recipient.expires_at
        else surveys.deadline(match)
        if survey
        else None,
        can_answer=availability == "available",
        own_answer=OwnFeedbackDTO(
            met=own.met,
            rating=own.rating,
            comment=own.comment,
            submitted=own.completion_state == "submitted",
            updated_at=own.updated_at,
        )
        if own
        else None,
        other_answered=outcome.responder_answered if side == "author" else outcome.author_answered,
        result=outcome,
        policy_version=survey.policy_version if survey else None,
    )


async def read(session, actor, match_id):
    from poidem.services.connections import match_record

    match = await match_record(session, actor, match_id)
    return await status_for(session, match, actor.user_id)


async def submit(session, actor, match_id, payload):
    from poidem.services.connections import match_record

    await lock_actor(session, actor)
    match = await match_record(session, actor, match_id)
    # Тот же замок используется callback бота: оба участника и оба транспорта
    # последовательно изменяют прежний опрос, а не создают независимые ответы.
    survey = await session.scalar(
        select(Survey).where(Survey.match_id == match_id).with_for_update()
    )
    current = await status_for(session, match, actor.user_id)
    if not current.can_answer:
        raise AppError(409, "SURVEY_UNAVAILABLE", "Сейчас ответить на этот опрос нельзя")
    side = "author" if actor.user_id == match.author_id else "responder"
    row = await session.get(FeedbackAnswer, (survey.id, side))
    if row is None:
        row = FeedbackAnswer(survey_id=survey.id, participant_side=side)
        session.add(row)
    if (row.met, row.rating, row.comment, row.completion_state) != (
        payload.met,
        payload.rating,
        payload.comment,
        "submitted",
    ):
        row.met, row.rating, row.comment = payload.met, payload.rating, payload.comment
        row.completion_state = "submitted"
        row.submitted_at = row.updated_at = plans.now()
    recipient = await session.get(SurveyRecipient, (survey.id, side))
    recipient.comment_prompt_message_id = None
    survey.state = "available"
    await session.flush()
    result = await status_for(session, match, actor.user_id)
    await session.commit()
    return result


async def review(session, match):
    survey = await session.scalar(select(Survey).where(Survey.match_id == match.id))
    return result_from(await answers_for(session, survey))
