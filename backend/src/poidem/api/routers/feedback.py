import uuid

from fastapi import APIRouter, Depends

from poidem.api.routers.account import Authenticated, Session, WriteActor
from poidem.api.routers.plans import check_context
from poidem.schemas.feedback import ExperienceDTO, FeedbackWrite, ImpressionWrite, SurveyDTO
from poidem.services import meeting_feedback, plans

router = APIRouter(prefix="/api/v1", tags=["Итоги встречи"], dependencies=[Depends(check_context)])


@router.get("/matches/{match_id}/survey", response_model=SurveyDTO)
async def survey(match_id: uuid.UUID, actor: Authenticated, session: Session):
    return await meeting_feedback.read(session, actor, match_id)


@router.post("/matches/{match_id}/feedback", response_model=SurveyDTO)
async def feedback(
    match_id: uuid.UUID, payload: FeedbackWrite, actor: WriteActor, session: Session
):
    return await meeting_feedback.submit(session, actor, match_id, payload)


@router.get("/me/reliability", response_model=ExperienceDTO)
async def experience(actor: Authenticated, session: Session):
    await plans.require_active(session, actor)
    return await meeting_feedback.experience(session, actor.user_id)


@router.get("/matches/{match_id}/impressions")
async def own_impressions(match_id: uuid.UUID, actor: Authenticated, session: Session):
    from poidem.services import impressions

    return await impressions.status(session, actor, match_id)


@router.put("/matches/{match_id}/impressions")
async def save_impressions(
    match_id: uuid.UUID, payload: ImpressionWrite, actor: WriteActor, session: Session
):
    from poidem.services import impressions

    return await impressions.save(session, actor, match_id, payload)


@router.delete("/matches/{match_id}/impressions")
async def withdraw_impressions(match_id: uuid.UUID, actor: WriteActor, session: Session):
    from poidem.services import impressions

    return await impressions.save(session, actor, match_id)
