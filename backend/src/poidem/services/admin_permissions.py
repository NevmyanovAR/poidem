"""D62: права существующего User, проверяемые заново для каждого запроса."""

from sqlalchemy import select, text

from poidem.api.errors import AppError
from poidem.db.models.accounts import User
from poidem.security.session import lock_actor

ROLES = ("user", "analyst", "moderator", "admin", "owner")
PERMISSIONS = {
    "user": (),
    "analyst": ("analytics",),
    "moderator": ("moderation",),
    "admin": ("analytics", "users", "plans", "moderation", "system", "editorial"),
    "owner": ("analytics", "users", "plans", "moderation", "system", "editorial", "team"),
}
# Единый ключ для CLI, HTTP и проверки удаления владельца; не Telegram ID.
TEAM_LOCK = 682062091001


async def team_lock(session):
    await session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": TEAM_LOCK})


async def require(session, actor, permission=None, *, write=False):
    user = (
        await lock_actor(session, actor)
        if write
        else await session.scalar(
            select(User).where(User.id == actor.user_id).execution_options(populate_existing=True)
        )
    )
    if (
        not user
        or user.account_status != "active"
        or not PERMISSIONS.get(user.role_code)
        or permission is not None
        and permission not in PERMISSIONS.get(user.role_code, ())
    ):
        raise AppError(403, "ADMIN_REQUIRED", "Недостаточно прав для этого раздела")
    return user
