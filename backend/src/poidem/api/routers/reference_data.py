from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from poidem.db.models import Category, GenderOption, Interest, PreferenceOption
from poidem.db.session import get_session
from poidem.schemas.system import ReferenceDataDTO, ReferenceItem

router = APIRouter(prefix="/api/v1", tags=["Справочники"])


@router.get("/reference-data", response_model=ReferenceDataDTO)
async def reference_data(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ReferenceDataDTO:
    result = {}
    for name, model in (
        ("categories", Category),
        ("interests", Interest),
        ("gender_options", GenderOption),
        ("preference_options", PreferenceOption),
    ):
        rows = (
            await session.scalars(select(model).where(model.enabled.is_(True)).order_by(model.code))
        ).all()
        result[name] = [ReferenceItem.model_validate(row) for row in rows]
    return ReferenceDataDTO(**result)
