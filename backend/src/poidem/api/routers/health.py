import logging

from alembic.config import Config
from alembic.script import ScriptDirectory
from fastapi import APIRouter, Request
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from poidem.api.errors import AppError
from poidem.schemas.system import HealthDTO, LivenessDTO
from poidem.settings import REPOSITORY_ROOT

logger = logging.getLogger("poidem.health")
router = APIRouter(tags=["Состояние сервера"])


def migration_heads() -> set[str]:
    config = Config(str(REPOSITORY_ROOT / "backend" / "alembic.ini"))
    return set(ScriptDirectory.from_config(config).get_heads())


async def check_readiness(request: Request) -> HealthDTO:
    try:
        async with request.app.state.database.engine.connect() as connection:
            await connection.execute(text("SELECT 1"))
            revisions = set(
                (
                    await connection.execute(text("SELECT version_num FROM alembic_version"))
                ).scalars()
            )
        if not revisions or revisions != request.app.state.migration_heads:
            raise AppError(503, "MIGRATIONS_REQUIRED", "Требуется применение миграций")
    except SQLAlchemyError as exc:
        logger.warning("database_not_ready", extra={"error_type": type(exc).__name__})
        raise AppError(503, "SERVICE_UNAVAILABLE", "База данных временно недоступна") from None
    return HealthDTO()


@router.get("/health", response_model=HealthDTO)
@router.get("/health/ready", response_model=HealthDTO)
async def readiness(request: Request) -> HealthDTO:
    return await check_readiness(request)


@router.get("/health/live", response_model=LivenessDTO)
async def liveness() -> LivenessDTO:
    return LivenessDTO()
