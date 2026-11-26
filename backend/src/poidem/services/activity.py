"""Единая серверная пагинация приоритетного списка, не сортировка отдельных страниц."""

import base64
import json
import uuid
from decimal import Decimal, InvalidOperation

from sqlalchemy import case, func, literal, or_, select, tuple_, union_all

from poidem.api.errors import AppError
from poidem.db.models import ArchiveHidden, Match, Plan, PlanResponse
from poidem.schemas.activity import ActivityItem, ActivityPage
from poidem.services import archive, connections, inbox, plans


def selection(kind, identity, priority, stamp, descending=False):
    order = func.extract("epoch", stamp)
    if descending:
        order = -order
    return [
        literal(kind).label("kind"),
        identity.label("identity"),
        Plan.id.label("plan_id"),
        literal(priority).label("priority"),
        order.label("ordering"),
    ]


async def listing(
    session,
    actor,
    *,
    scope="active",
    include_hidden=False,
    cursor=None,
    limit=20,
    plan_id=None,
    view="all",
):
    await plans.require_active(session, actor)
    at = plans.now()
    is_archive = scope == "archive"
    last_decision = (
        select(func.max(PlanResponse.decided_at))
        .where(PlanResponse.plan_id == Plan.id)
        .correlate(Plan)
        .scalar_subquery()
    )
    event_at = func.greatest(
        Plan.updated_at,
        func.coalesce(last_decision, Plan.updated_at),
        case((Plan.starts_at <= at, Plan.starts_at), else_=Plan.updated_at),
    )
    exists_match = select(Match.id).where(Match.plan_id == Plan.id).exists()
    membership = or_(Match.author_id == actor.user_id, Match.responder_id == actor.user_id)
    pair = (
        select(
            *selection(
                "match",
                Match.id,
                0,
                event_at if is_archive else Match.meeting_starts_at,
                is_archive,
            )
        )
        .join(Plan, Plan.id == Match.plan_id)
        .where(membership)
    )
    mine = select(
        *selection(
            "plan",
            Plan.id,
            0 if is_archive else 2,
            event_at if is_archive else Plan.starts_at,
            is_archive,
        )
    ).where(
        Plan.author_id == actor.user_id,
        ~exists_match,
        Plan.publication_status.in_(("published", "draft")) if not is_archive else literal(True),
    )
    if not is_archive:
        mine = select(
            literal("plan").label("kind"),
            Plan.id.label("identity"),
            Plan.id.label("plan_id"),
            case((Plan.publication_status == "draft", 4), else_=2).label("priority"),
            case(
                (Plan.publication_status == "draft", -func.extract("epoch", Plan.updated_at)),
                else_=func.extract("epoch", Plan.starts_at),
            ).label("ordering"),
        ).where(
            Plan.author_id == actor.user_id,
            ~exists_match,
            Plan.publication_status.in_(("published", "draft")),
        )
    outgoing = (
        select(
            *selection(
                "outgoing",
                PlanResponse.id,
                0 if is_archive else 3,
                event_at if is_archive else PlanResponse.created_at,
                True,
            )
        )
        .join(Plan, Plan.id == PlanResponse.plan_id)
        .where(
            PlanResponse.responder_id == actor.user_id,
            PlanResponse.status != "accepted" if is_archive else PlanResponse.status == "waiting",
        )
    )
    if not is_archive:
        outgoing = outgoing.where(Plan.starts_at > at, Plan.publication_status == "published")
    parts = [pair, mine, outgoing]
    if not is_archive:
        parts.append(
            select(*selection("incoming", PlanResponse.id, 1, PlanResponse.created_at, True))
            .join(Plan, Plan.id == PlanResponse.plan_id)
            .where(
                PlanResponse.plan_author_id == actor.user_id,
                PlanResponse.status == "waiting",
                Plan.publication_status == "published",
                Plan.starts_at > at,
            )
        )
    if view == "own":
        pending = inbox.pending_for_plan(at)
        published = (
            (Plan.publication_status == "published")
            & (Plan.starts_at > at)
            & Plan.moderation_status.in_(plans.VISIBLE_MODERATION)
        )
        priority = case(
            (published & (pending > 0), 0),
            (published, 1),
            (Plan.publication_status == "draft", 2),
            else_=3,
        )
        ordering = case(
            (published, func.extract("epoch", Plan.starts_at)),
            else_=-func.extract("epoch", event_at),
        )
        parts = [
            select(
                literal("plan").label("kind"),
                Plan.id.label("identity"),
                Plan.id.label("plan_id"),
                (literal(0) if is_archive else priority).label("priority"),
                (-func.extract("epoch", event_at) if is_archive else ordering).label("ordering"),
            ).where(Plan.author_id == actor.user_id)
        ]
    queries = []
    for query in parts:
        if plan_id is not None:
            query = query.where(Plan.id == plan_id)
        query = query.where(archive.archived(at) if is_archive else ~archive.archived(at))
        if not include_hidden or not is_archive:
            query = query.where(
                ~select(ArchiveHidden.plan_id)
                .where(ArchiveHidden.plan_id == Plan.id, ArchiveHidden.user_id == actor.user_id)
                .exists()
            )
        queries.append(query)
    combined = (queries[0] if len(queries) == 1 else union_all(*queries)).subquery()
    query = select(combined)
    if cursor:
        try:
            saved = json.loads(base64.b64decode(cursor, altchars=b"-_", validate=True))
            if not isinstance(saved, list) or len(saved) not in (6, 7, 8):
                raise ValueError
            if (saved[7] if len(saved) == 8 else "all") != view:
                raise ValueError
            saved_scope, saved_hidden, priority, ordering, identity, kind = saved[:6]
            if (saved[6] if len(saved) >= 7 else None) != (str(plan_id) if plan_id else None):
                raise ValueError
            ordering = Decimal(ordering)
            if (
                saved_scope != scope
                or saved_hidden != include_hidden
                or type(priority) is not int
                or not 0 <= priority <= 4
                or not ordering.is_finite()
                or ordering.copy_abs() > Decimal("1e12")
                or kind not in ("match", "plan", "incoming", "outgoing")
            ):
                raise ValueError
            query = query.where(
                tuple_(
                    combined.c.priority, combined.c.ordering, combined.c.identity, combined.c.kind
                )
                > (int(priority), ordering, uuid.UUID(identity), kind)
            )
        except (ValueError, TypeError, InvalidOperation, UnicodeError, OverflowError) as error:
            raise AppError(422, "CURSOR_INVALID", "Некорректная страница списка") from error
    rows = (
        await session.execute(
            query.order_by(
                combined.c.priority, combined.c.ordering, combined.c.identity, combined.c.kind
            ).limit(limit + 1)
        )
    ).all()
    items = []
    for row in rows[:limit]:
        hidden = await session.get(ArchiveHidden, (actor.user_id, row.plan_id)) is not None
        item = ActivityItem(
            key=f"{row.kind}:{row.identity}",
            kind=row.kind,
            plan_id=row.plan_id,
            archived=is_archive,
            hidden=hidden,
        )
        if row.kind == "match":
            entry = await connections.match_record(session, actor, row.identity)
            item.match = await connections.match_dto(session, actor, entry)
        elif row.kind == "plan":
            item.plan = await plans.get_plan(session, actor, row.identity)
            if view == "own":
                item.pending_response_count = await session.scalar(
                    select(inbox.pending_for_plan(at)).where(Plan.id == row.plan_id)
                )
                item.match_id = await session.scalar(
                    select(Match.id).where(Match.plan_id == row.plan_id, membership)
                )
                item.history = row.priority == 3
        else:
            entry = await connections.response_record(session, actor, row.identity)
            item.response = await connections.response_dto(session, actor, entry)
        items.append(item)
    next_cursor = None
    if len(rows) > limit:
        row = rows[limit - 1]
        next_cursor = base64.urlsafe_b64encode(
            json.dumps(
                [
                    scope,
                    include_hidden,
                    row.priority,
                    str(row.ordering),
                    str(row.identity),
                    row.kind,
                ]
                + (
                    [str(plan_id) if plan_id else None, view]
                    if view != "all"
                    else [str(plan_id)]
                    if plan_id
                    else []
                )
            ).encode()
        ).decode()
    return ActivityPage(items=items, next_cursor=next_cursor)
