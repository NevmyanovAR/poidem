"""D61: минимальные административные проекции. Личные фото/переписки/отзывы не выдаются."""

import base64
import hashlib
import json
import uuid
from datetime import UTC, datetime, time, timedelta

from sqlalchemy import func, or_, select

from poidem.api.errors import AppError
from poidem.db.models import (
    AdminAuditLog,
    Category,
    Match,
    Plan,
    PlanResponse,
    Profile,
    Report,
    User,
)
from poidem.services import admin_permissions


def scalar_count(model, condition):
    return select(func.count()).select_from(model).where(condition).scalar_subquery()


def literal_search(column, value):
    escaped = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return column.ilike("%" + escaped + "%", escape="\\")


def reports_for_user(identity):
    return or_(
        Report.reported_user_id == identity,
        Report.reporter_id == identity,
        Report.plan_id.in_(select(Plan.id).where(Plan.author_id == identity)),
    )


def date_filters(column, since, until):
    # Списки используют календарные UTC даты; явно обозначено в UI отдельно от аналитики.
    if since and until and since > until:
        raise AppError(422, "PERIOD_INVALID", "Начало периода позже конца")
    conditions = []
    if since:
        conditions.append(column >= datetime.combine(since, time.min, UTC))
    if until:
        conditions.append(column < datetime.combine(until + timedelta(days=1), time.min, UTC))
    return conditions


async def page(session, query, columns, *, actor, kind, filters, cursor, limit):
    fingerprint = hashlib.sha256(
        json.dumps([str(actor.user_id), kind, filters], sort_keys=True, default=str).encode()
    ).hexdigest()
    offset = 0
    if cursor:
        try:
            saved, offset = json.loads(base64.b64decode(cursor, altchars=b"-_", validate=True))
            if saved != fingerprint or type(offset) is not int or not 0 <= offset <= 1_000_000:
                raise ValueError
        except (ValueError, TypeError, UnicodeError) as error:
            raise AppError(
                422, "CURSOR_INVALID", "Начни список заново после изменения фильтра"
            ) from error
    descending = filters["direction"] == "desc"
    ordering = columns[filters["sort"]]
    identity = User.id if kind == "users" else Plan.id
    total = int(
        await session.scalar(select(func.count()).select_from(query.order_by(None).subquery()))
    )
    records = (
        await session.execute(
            query.order_by(
                ordering.desc() if descending else ordering.asc(),
                identity.desc() if descending else identity.asc(),
            )
            .offset(offset)
            .limit(limit + 1)
        )
    ).all()
    following = (
        base64.urlsafe_b64encode(json.dumps([fingerprint, offset + limit]).encode()).decode()
        if len(records) > limit
        else None
    )
    return records[:limit], total, following


async def users(
    session,
    actor,
    *,
    q="",
    state=None,
    since=None,
    until=None,
    sort="created",
    direction="desc",
    cursor=None,
    limit=25,
):
    await admin_permissions.require(session, actor, "users")
    plans = scalar_count(Plan, Plan.author_id == User.id).label("plans")
    pairs = scalar_count(
        Match, or_(Match.author_id == User.id, Match.responder_id == User.id)
    ).label("matches")
    query = select(
        User.id,
        User.created_at,
        User.account_status,
        Profile.name,
        Profile.moderation_status,
        plans,
        pairs,
    ).outerjoin(Profile, Profile.user_id == User.id)
    if q:
        try:
            identity = uuid.UUID(q)
        except ValueError:
            identity = None
        query = query.where(
            or_(literal_search(Profile.name, q), User.id == identity if identity else False)
        )
    if state:
        query = query.where(User.account_status == state)
    query = query.where(*date_filters(User.created_at, since, until))
    rows, total, following = await page(
        session,
        query,
        {
            "created": User.created_at,
            "name": func.coalesce(Profile.name, ""),
            "plans": plans,
            "matches": pairs,
        },
        actor=actor,
        kind="users",
        filters={
            "q": q,
            "state": state,
            "since": since,
            "until": until,
            "sort": sort,
            "direction": direction,
        },
        cursor=cursor,
        limit=limit,
    )
    return {
        "items": [
            {
                "id": row[0],
                "created_at": row[1],
                "state": row[2],
                "name": row[3],
                "profile_state": row[4] or "missing",
                "plans": row[5],
                "matches": row[6],
            }
            for row in rows
        ],
        "total": total,
        "next_cursor": following,
    }


async def user_detail(session, actor, identity):
    await admin_permissions.require(session, actor, "users")
    row = (
        await session.execute(
            select(User, Profile.name, Profile.moderation_status)
            .outerjoin(Profile, Profile.user_id == User.id)
            .where(User.id == identity)
        )
    ).first()
    if not row:
        raise AppError(404, "ADMIN_USER_NOT_FOUND", "Пользователь не найден")
    user, name, profile_state = row
    return {
        "id": user.id,
        "name": name,
        "state": user.account_status,
        "created_at": user.created_at,
        "profile_state": profile_state or "missing",
        "plans": await session.scalar(
            select(func.count()).select_from(Plan).where(Plan.author_id == identity)
        ),
        "matches": await session.scalar(
            select(func.count())
            .select_from(Match)
            .where(or_(Match.author_id == identity, Match.responder_id == identity))
        ),
        "related_reports": await session.scalar(
            select(func.count()).select_from(Report).where(reports_for_user(identity))
        ),
    }


async def plans(
    session,
    actor,
    *,
    q="",
    author="",
    state=None,
    category=None,
    moderation=None,
    has_reports=None,
    since=None,
    until=None,
    sort="created",
    direction="desc",
    cursor=None,
    limit=25,
):
    await admin_permissions.require(session, actor, "plans")
    responses = scalar_count(PlanResponse, PlanResponse.plan_id == Plan.id).label("responses")
    reported = select(Report.id).where(Report.plan_id == Plan.id).exists()
    query = (
        select(Plan, Profile.name, Category.title, responses, reported)
        .join(Category, Category.code == Plan.category_code)
        .outerjoin(Profile, Profile.user_id == Plan.author_id)
    )
    if q:
        query = query.where(literal_search(Plan.title, q))
    if state:
        query = query.where(Plan.publication_status == state)
    if author:
        try:
            author_id = uuid.UUID(author)
        except ValueError:
            author_id = None
        query = query.where(
            or_(
                literal_search(Profile.name, author),
                Plan.author_id == author_id if author_id else False,
            )
        )
    if category:
        query = query.where(Plan.category_code == category)
    if moderation:
        query = query.where(Plan.moderation_status == moderation)
    if has_reports is not None:
        query = query.where(reported if has_reports else ~reported)
    query = query.where(*date_filters(Plan.created_at, since, until))
    rows, total, following = await page(
        session,
        query,
        {
            "created": Plan.created_at,
            "title": Plan.title,
            "meeting": Plan.starts_at,
            "responses": responses,
        },
        actor=actor,
        kind="plans",
        filters={
            "q": q,
            "state": state,
            "category": category,
            "author": author,
            "moderation": moderation,
            "has_reports": has_reports,
            "since": since,
            "until": until,
            "sort": sort,
            "direction": direction,
        },
        cursor=cursor,
        limit=limit,
    )
    return {"items": [plan_dto(*row) for row in rows], "total": total, "next_cursor": following}


def plan_dto(plan, name, category, responses, has_reports):
    return {
        "id": plan.id,
        "title": plan.title,
        "category": category,
        "category_code": plan.category_code,
        "starts_at": plan.starts_at,
        "time_zone": plan.time_zone,
        "publication_status": plan.publication_status,
        "moderation_status": plan.moderation_status,
        "responses": responses,
        "created_at": plan.created_at,
        "author": {"id": plan.author_id, "name": name},
        "has_reports": has_reports,
    }


async def plan_detail(session, actor, identity):
    await admin_permissions.require(session, actor, "plans")
    row = (
        await session.execute(
            select(Plan, Profile.name, Category.title)
            .join(Category, Category.code == Plan.category_code)
            .outerjoin(Profile, Profile.user_id == Plan.author_id)
            .where(Plan.id == identity)
        )
    ).first()
    if not row:
        raise AppError(404, "ADMIN_PLAN_NOT_FOUND", "План не найден")
    plan, name, category = row
    reports = await session.scalar(
        select(func.count()).select_from(Report).where(Report.plan_id == identity)
    )
    result = plan_dto(
        plan,
        name,
        category,
        await session.scalar(
            select(func.count()).select_from(PlanResponse).where(PlanResponse.plan_id == identity)
        ),
        bool(reports),
    )
    return {
        **result,
        "description": plan.description,
        "place": plan.place,
        "related_reports": reports,
    }


async def system(session, actor):
    from poidem.services.admin_system import summary

    return await summary(session, actor)


async def audit(session, actor, action, target, request_id):
    session.add(
        AdminAuditLog(
            actor_id=actor.user_id,
            action=action,
            target_ref=target,
            reason_code="D61-admin-read-export",
            request_id=request_id,
        )
    )
    await session.commit()
