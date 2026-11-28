"""Voluntary positive impressions, never private 1–5 ratings or comments."""

from sqlalchemy import and_, case, delete, distinct, func, or_, select

from poidem.api.errors import AppError
from poidem.db.models import (
    FeedbackAnswer,
    Match,
    Plan,
    PositiveImpression,
    Survey,
    SurveyRecipient,
)
from poidem.security.session import lock_actor
from poidem.services import meeting_feedback, plans, surveys

POLICY = "positive-impressions-v1"
OPTIONS = ("pleasant", "interesting", "comfortable")


async def count_partners(session, subject):
    a = FeedbackAnswer.__table__.alias("positive_author")
    b = FeedbackAnswer.__table__.alias("positive_responder")
    giver = case(
        (PositiveImpression.participant_side == "author", Match.author_id), else_=Match.responder_id
    )
    recipient = case(
        (PositiveImpression.participant_side == "author", Match.responder_id), else_=Match.author_id
    )
    query = (
        select(func.count(distinct(giver)))
        .select_from(PositiveImpression)
        .join(Survey, Survey.id == PositiveImpression.survey_id)
        .join(Match, Match.id == Survey.match_id)
        .join(Plan, Plan.id == Match.plan_id)
        .join(a, and_(a.c.survey_id == Survey.id, a.c.participant_side == "author"))
        .join(b, and_(b.c.survey_id == Survey.id, b.c.participant_side == "responder"))
        .where(
            recipient == subject,
            a.c.met.is_(True),
            b.c.met.is_(True),
            a.c.completion_state == "submitted",
            b.c.completion_state == "submitted",
            Plan.publication_status != "cancelled",
            Survey.policy_version == surveys.POLICY,
            Survey.scheduled_at <= plans.now(),
            PositiveImpression.consent_version == POLICY,
            or_(
                PositiveImpression.pleasant,
                PositiveImpression.interesting,
                PositiveImpression.comfortable,
            ),
        )
    )
    return await session.scalar(query)


async def context(session, actor, identity, locked=False):
    from poidem.services.connections import match_record

    match = await match_record(session, actor, identity)
    query = select(Survey).where(Survey.match_id == match.id)
    survey = await session.scalar(query.with_for_update() if locked else query)
    side = "author" if actor.user_id == match.author_id else "responder"
    eligible = False
    if survey:
        plan = await session.get(Plan, match.plan_id)
        eligible = (
            survey.policy_version == surveys.POLICY
            and survey.scheduled_at <= plans.now()
            and plan.publication_status != "cancelled"
            and meeting_feedback.result_from(
                await meeting_feedback.answers_for(session, survey)
            ).result
            == "mutual_yes"
            and await session.get(SurveyRecipient, (survey.id, side)) is not None
        )
    return survey, side, bool(eligible)


async def status(session, actor, identity):
    survey, side, eligible = await context(session, actor, identity)
    own = await session.get(PositiveImpression, (survey.id, side)) if survey else None
    return {
        "eligible": eligible,
        "own_options": [key for key in OPTIONS if own and getattr(own, key)],
        "consent_version": POLICY,
        "submitted": own is not None,
    }


async def save(session, actor, identity, payload=None):
    await lock_actor(session, actor)
    survey, side, eligible = await context(session, actor, identity, locked=True)
    if payload and payload.options:
        if not eligible:
            raise AppError(
                409,
                "IMPRESSION_UNAVAILABLE",
                "Впечатления доступны после взаимного подтверждения встречи",
            )
        own = await session.get(PositiveImpression, (survey.id, side))
        if own is None:
            own = PositiveImpression(
                survey_id=survey.id, participant_side=side, consent_version=POLICY
            )
            session.add(own)
        values = {key: key in payload.options for key in OPTIONS}
        if any(getattr(own, key) != value for key, value in values.items()):
            for key, value in values.items():
                setattr(own, key, value)
            own.updated_at = plans.now()
    elif survey:
        await session.execute(
            delete(PositiveImpression).where(
                PositiveImpression.survey_id == survey.id,
                PositiveImpression.participant_side == side,
            )
        )
    await session.flush()
    result = await status(session, actor, identity)
    await session.commit()
    return result
