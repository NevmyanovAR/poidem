import base64
import hashlib
import json
import math
import uuid
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from pydantic import ValidationError
from sqlalchemy import select, tuple_
from sqlalchemy.dialects.postgresql import insert

from poidem.api.errors import AppError
from poidem.db.models import (
    Category,
    DailyPlanUsage,
    IdempotencyRecord,
    Match,
    Plan,
    PlanResponse,
    Profile,
    User,
)
from poidem.schemas.plan import PlanAuthorDTO, PlanDTO, PlanFields, PlanPage, QuotaDTO
from poidem.security.session import lock_actor
from poidem.services.plan_content import validate_content

QUOTA_ZONE = ZoneInfo("Europe/Moscow")
POLICY_VERSION = "plans-v1"
VISIBLE_MODERATION = ("not_submitted", "approved")
CREATE_PATH = "/api/v1/plans"


def now() -> datetime:
    return datetime.now(UTC)


def quota_calendar(at: datetime) -> tuple:
    local = at.astimezone(QUOTA_ZONE)
    day = local.date()
    reset = datetime.combine(day + timedelta(days=1), datetime.min.time(), QUOTA_ZONE)
    return day, reset.astimezone(UTC)


async def quota(session, actor, at: datetime | None = None) -> QuotaDTO:
    at = at or now()
    day, reset = quota_calendar(at)
    usage = await session.get(DailyPlanUsage, (actor.user_id, day))
    used = usage.used if usage else 0
    return QuotaDTO(used=used, remaining=max(0, 3 - used), day=day, resets_at=reset)


async def require_active(session, actor, *, profile=False):
    user = await session.get(User, actor.user_id)
    if not user or user.account_status != "active":
        raise AppError(403, "ACCOUNT_BLOCKED", "Действия аккаунта ограничены")
    if profile:
        entry = await session.get(Profile, actor.user_id)
        if not entry:
            raise AppError(409, "PROFILE_REQUIRED", "Сначала заполни и сохрани анкету")
        if entry.moderation_status not in VISIBLE_MODERATION:
            raise AppError(403, "PROFILE_RESTRICTED", "Публикации этой анкеты ограничены")


async def validate_fields(session, fields: PlanFields) -> None:
    validate_content(title=fields.title, description=fields.description, place=fields.place)
    if fields.starts_at <= now():
        raise AppError(
            422,
            "PLAN_DATE_PAST",
            "Встреча должна быть в будущем",
            {"starts_at": "Проверь дату и время"},
        )
    category = await session.get(Category, fields.category_code)
    if not category or not category.enabled:
        raise AppError(
            422,
            "PLAN_CATEGORY_INVALID",
            "Выбери существующую категорию",
            {"category_code": "Выбери категорию"},
        )


def public_conditions(actor, at):
    return (
        Plan.publication_status == "published",
        Plan.moderation_status.in_(VISIBLE_MODERATION),
        Plan.starts_at > at,
        Plan.author_id != actor.user_id,
        User.account_status == "active",
        Profile.moderation_status.in_(VISIBLE_MODERATION),
        Category.enabled.is_(True),
    )


def joined_plans():
    return (
        select(Plan, Profile.name, Category.cover_asset_key)
        .join(User, User.id == Plan.author_id)
        .join(Profile, Profile.user_id == Plan.author_id)
        .join(Category, Category.code == Plan.category_code)
    )


def dto(row, actor) -> PlanDTO:
    plan, name, image = row
    return PlanDTO(
        id=plan.id,
        author=PlanAuthorDTO(id=plan.author_id, name=name),
        title=plan.title,
        category_code=plan.category_code,
        description=plan.description,
        starts_at=plan.starts_at,
        time_zone=plan.time_zone,
        place=plan.place,
        publication_status=plan.publication_status,
        moderation_status=plan.moderation_status,
        created_at=plan.created_at,
        version=plan.version,
        image=image,
        own=plan.author_id == actor.user_id,
    )


async def get_plan(session, actor, plan_id: uuid.UUID) -> PlanDTO:
    await require_active(session, actor)
    row = (await session.execute(joined_plans().where(Plan.id == plan_id))).first()
    if row is None:
        raise AppError(404, "PLAN_NOT_FOUND", "Этот план не найден")
    plan = row[0]
    if plan.author_id != actor.user_id:
        allowed = await session.scalar(
            select(Plan.id)
            .select_from(Plan)
            .join(User, User.id == Plan.author_id)
            .join(Profile, Profile.user_id == Plan.author_id)
            .join(Category, Category.code == Plan.category_code)
            .where(Plan.id == plan_id, *public_conditions(actor, now()))
        )
        if allowed is None:
            raise AppError(404, "PLAN_NOT_FOUND", "Этот план не найден")
    return dto(row, actor)


def encode_cursor(stamp: datetime, identity: uuid.UUID) -> str:
    return base64.urlsafe_b64encode(
        json.dumps([stamp.isoformat(), str(identity)]).encode()
    ).decode()


def decode_cursor(cursor: str) -> tuple:
    try:
        stamp, identity = json.loads(base64.b64decode(cursor, altchars=b"-_", validate=True))
        stamp = datetime.fromisoformat(stamp)
        if stamp.tzinfo is None:
            raise ValueError
        return stamp, uuid.UUID(identity)
    except (ValueError, TypeError, UnicodeError) as error:
        raise AppError(422, "CURSOR_INVALID", "Некорректная страница списка") from error


async def list_plans(
    session, actor, *, own=False, category=None, cursor=None, limit=20
) -> PlanPage:
    await require_active(session, actor)
    query = joined_plans()
    sort_column = Plan.created_at if own else Plan.starts_at
    query = (
        query.where(Plan.author_id == actor.user_id)
        if own
        else query.where(*public_conditions(actor, now()))
    )
    if category:
        query = query.where(Plan.category_code == category)
    if cursor:
        position = decode_cursor(cursor)
        query = query.where(
            tuple_(sort_column, Plan.id) < position
            if own
            else tuple_(sort_column, Plan.id) > position
        )
    query = (
        query.order_by(sort_column.desc(), Plan.id.desc())
        if own
        else query.order_by(sort_column, Plan.id)
    )
    rows = (await session.execute(query.limit(limit + 1))).all()
    page = rows[:limit]
    next_cursor = (
        encode_cursor(getattr(page[-1][0], "created_at" if own else "starts_at"), page[-1][0].id)
        if len(rows) > limit
        else None
    )
    return PlanPage(items=[dto(row, actor) for row in page], next_cursor=next_cursor)


async def create(session, actor, fields: PlanFields, key: uuid.UUID) -> tuple[PlanDTO, bool]:
    await lock_actor(session, actor)
    await require_active(session, actor, profile=True)
    fingerprint = hashlib.sha256(
        json.dumps(fields.model_dump(mode="json"), sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()
    record = await session.get(IdempotencyRecord, (actor.user_id, "POST", CREATE_PATH, key))
    if record:
        if record.request_fingerprint != fingerprint:
            raise AppError(
                409, "IDEMPOTENCY_CONFLICT", "Ключ повтора уже использован для другого плана"
            )
        return await get_plan(session, actor, uuid.UUID(record.result_resource_ref)), False
    await validate_fields(session, fields)
    at = now()
    day, reset = quota_calendar(at)
    statement = insert(DailyPlanUsage).values(
        user_id=actor.user_id,
        quota_day=day,
        used=1,
        calendar_zone=QUOTA_ZONE.key,
        policy_version=POLICY_VERSION,
    )
    statement = statement.on_conflict_do_update(
        index_elements=[DailyPlanUsage.user_id, DailyPlanUsage.quota_day],
        set_={"used": DailyPlanUsage.used + 1},
        where=DailyPlanUsage.used < 3,
    ).returning(DailyPlanUsage.used)
    if await session.scalar(statement) is None:
        raise AppError(
            429,
            "PLAN_DAILY_LIMIT",
            "Сегодня можно создать не больше 3 планов — новый лимит после полуночи по Москве",
            retry_after=max(1, math.ceil((reset - at).total_seconds())),
        )
    values = fields.model_dump()
    values["starts_at"] = fields.starts_at.astimezone(UTC)
    plan = Plan(author_id=actor.user_id, **values, quota_charged_at=at, quota_charged_day=day)
    session.add(plan)
    await session.flush()
    session.add(
        IdempotencyRecord(
            actor_id=actor.user_id,
            method="POST",
            path=CREATE_PATH,
            key=key,
            request_fingerprint=fingerprint,
            result_resource_ref=str(plan.id),
            safe_result={"plan_id": str(plan.id)},
            expires_at=at + timedelta(days=1),
        )
    )
    await session.commit()
    return await get_plan(session, actor, plan.id), True


async def editable(session, actor, plan_id, expected):
    await lock_actor(session, actor)
    await require_active(session, actor, profile=True)
    plan = await session.scalar(
        select(Plan).where(Plan.id == plan_id, Plan.author_id == actor.user_id).with_for_update()
    )
    if not plan:
        raise AppError(404, "PLAN_NOT_FOUND", "Этот план не найден")
    if plan.version != expected:
        raise AppError(409, "PLAN_VERSION_CONFLICT", "План уже изменился — обнови страницу")
    if await session.scalar(
        select(PlanResponse.id).where(PlanResponse.plan_id == plan.id).limit(1)
    ) or await session.scalar(select(Match.id).where(Match.plan_id == plan.id).limit(1)):
        raise AppError(
            409,
            "PLAN_HAS_RELATED_DATA",
            "У плана есть отклики или встречи — изменение пока недоступно",
        )
    if plan.moderation_status not in VISIBLE_MODERATION:
        raise AppError(409, "PLAN_MODERATION_RESTRICTED", "Изменение плана ограничено модерацией")
    return plan


async def update(session, actor, plan_id, payload) -> PlanDTO:
    plan = await editable(session, actor, plan_id, payload.expected_version)
    if plan.publication_status not in ("draft", "published"):
        raise AppError(409, "PLAN_NOT_EDITABLE", "Этот план уже закрыт или отменён")
    values = {key: getattr(plan, key) for key in PlanFields.model_fields}
    values.update(payload.model_dump(exclude_unset=True, exclude={"expected_version"}))
    try:
        fields = PlanFields.model_validate(values)
    except ValidationError as error:
        raise AppError(422, "VALIDATION_ERROR", "Проверь поля плана") from error
    await validate_fields(session, fields)
    for key, value in fields.model_dump().items():
        setattr(plan, key, value.astimezone(UTC) if key == "starts_at" else value)
    plan.moderation_status = "not_submitted"
    plan.version += 1
    await session.commit()
    return await get_plan(session, actor, plan.id)


async def command(session, actor, plan_id, payload, action: str) -> PlanDTO:
    plan = await editable(session, actor, plan_id, payload.expected_version)
    if plan.publication_status not in ("draft", "published"):
        raise AppError(409, "PLAN_NOT_EDITABLE", "Этот план уже закрыт или отменён")
    if action == "publish":
        await validate_fields(
            session,
            PlanFields.model_validate({key: getattr(plan, key) for key in PlanFields.model_fields}),
        )
        plan.publication_status = "published"
        plan.moderation_status = "not_submitted"
    else:
        plan.publication_status = "cancelled"
    plan.version += 1
    await session.commit()
    return await get_plan(session, actor, plan.id)
