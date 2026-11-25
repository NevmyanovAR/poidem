import uuid

from fastapi import APIRouter, Depends

from poidem.api.routers.account import Authenticated, Session, WriteActor
from poidem.api.routers.plans import check_context
from poidem.schemas.feedback import ExperienceDTO, FeedbackWrite, SurveyDTO
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
