"""Жалобы, персональные ограничения и решения без автоматических санкций."""

import base64
import hashlib
import uuid

from sqlalchemy import Text, and_, or_, select, text, update

from poidem.api.errors import AppError
from poidem.db.models import (
    AdminAuditLog,
    ChatMessage,
    Match,
    ModerationCase,
    ModerationDecision,
    NotificationJob,
    Photo,
    Plan,
    PlanResponse,
    Profile,
    Report,
    User,
    UserRestriction,
)
from poidem.security.session import lock_actor
from poidem.services import candidates, connections, meeting_feedback, plans
from poidem.services.rate_limit import rate_limit


def missing():
    return AppError(404, "SAFETY_NOT_FOUND", "Эти сведения недоступны")


def pair_condition(first, second):
    return and_(
        UserRestriction.kind == "personal",
        UserRestriction.lifted_at.is_(None),
        or_(
            and_(UserRestriction.imposed_by == first, UserRestriction.user_id == second),
            and_(UserRestriction.imposed_by == second, UserRestriction.user_id == first),
        ),
    )


def blocked_expression(first, second):
    return select(UserRestriction.id).where(pair_condition(first, second)).exists()


def hidden_author_expression(viewer, author):
    return (
        select(UserRestriction.id)
        .where(
            UserRestriction.kind == "personal",
            UserRestriction.lifted_at.is_(None),
            UserRestriction.imposed_by == viewer,
            UserRestriction.user_id == author,
        )
        .exists()
    )


def pair_key(first, second):
    return "safety:" + ":".join(sorted((str(first), str(second))))


async def blocked(session, first, second):
    return bool(await session.scalar(select(blocked_expression(first, second))))


async def lock_pair(session, first, second):
    key = pair_key(first, second)
    await session.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key,0))"), {"key": key}
    )


async def require_interaction(session, first, second):
    await lock_pair(session, first, second)
    if await blocked(session, first, second):
        raise AppError(403, "INTERACTION_UNAVAILABLE", "Взаимодействие недоступно")


async def context(session, actor, payload, *, reporting=False):
    """Клиент задаёт контекст, сервер устанавливает участника и доступные доказательства."""
    await plans.require_active(session, actor)
    target, plan, match = None, None, None
    if payload.context_type == "plan":
        plan = await session.get(Plan, payload.context_id)
        if not plan:
            raise missing()
        own_block = await session.scalar(
            select(UserRestriction.id).where(
                UserRestriction.kind == "personal",
                UserRestriction.imposed_by == actor.user_id,
                UserRestriction.user_id == plan.author_id,
                UserRestriction.lifted_at.is_(None),
            )
        )
        if reporting or not own_block:
            await plans.get_plan(session, actor, payload.context_id)
        if payload.target_type not in ("plan", "profile") or plan.publication_status != "published":
            raise missing()
        target = plan.author_id
    elif payload.context_type == "response":
        entry = await connections.response_record(session, actor, payload.context_id)
        if payload.target_type != "profile":
            raise missing()
        target = (
            entry.responder_id if entry.plan_author_id == actor.user_id else entry.plan_author_id
        )
        own_block = await session.scalar(
            select(UserRestriction.id).where(
                UserRestriction.kind == "personal",
                UserRestriction.imposed_by == actor.user_id,
                UserRestriction.user_id == target,
                UserRestriction.lifted_at.is_(None),
            )
        )
        if reporting or not own_block:
            await connections.response_profile(session, actor, entry)
    else:
        match = await connections.match_record(session, actor, payload.context_id)
        if payload.target_type not in ("profile", "match", "chat"):
            raise missing()
        target = match.responder_id if match.author_id == actor.user_id else match.author_id
    if target == actor.user_id:
        raise AppError(422, "SAFETY_SELF", "Выбери другого участника")
    if not reporting:
        return target, None, None, None
    evidence = {}
    target_key = f"{payload.target_type}:{target}"
    case_target = {"target_user_id": target}
    version = 1
    if payload.target_type == "plan":
        evidence = {
            "title": plan.title,
            "description": plan.description,
            "place": plan.place,
            "starts_at": plan.starts_at.isoformat(),
        }
        target_key = f"plan:{plan.id}:{plan.version}"
        case_target = {"plan_id": plan.id}
        version = plan.version
    elif payload.target_type == "profile":
        if match:
            role = "responder" if actor.user_id == match.author_id else "author"
            await connections.match_photo(session, actor, match.id, role)
        else:
            await candidates.public_profile(session, target, "")
        profile = await session.get(Profile, target)
        if not profile:
            raise missing()
        evidence = {
            "name": profile.name,
            "age": profile.age,
            "bio": profile.bio,
            "photo_id": str(profile.photo_id),
        }
        version = profile.version
        target_key = f"profile:{target}:{version}"
        case_target = {"profile_user_id": target}
    else:
        evidence = {"title": (await session.get(Plan, match.plan_id)).title}
        target_key = f"{payload.target_type}:{match.id}"
        if payload.target_type == "chat":
            query = select(ChatMessage).where(ChatMessage.match_id == match.id)
            rows = (
                await session.scalars(query.order_by(ChatMessage.sequence.desc()).limit(3))
            ).all()
            evidence["messages"] = [
                {
                    "id": str(row.id),
                    "text": row.body,
                    "speaker": "reported" if row.sender_id == target else "reporter",
                    "created_at": row.created_at.isoformat(),
                }
                for row in reversed(rows)
            ]
    if match:
        evidence["meeting_context"] = {
            "match_id": str(match.id),
            "at_report": (await meeting_feedback.review(session, match)).model_dump(),
        }
    return target, target_key, evidence, (case_target, version)


def report_dto(entry):
    return {
        "id": entry.id,
        "state": entry.state,
        "target_type": entry.target_type,
        "reason_code": entry.reason_code,
        "created_at": entry.created_at,
    }


async def submit_report(session, actor, payload):
    await lock_actor(session, actor)
    target, key, evidence, (case_target, version) = await context(
        session, actor, payload, reporting=True
    )
    previous = await session.scalar(
        select(Report).where(Report.reporter_id == actor.user_id, Report.target_key == key)
    )
    if previous:
        return report_dto(previous), False
    # Технический антиспам; не санкция и не оценка достоверности жалобы.
    await rate_limit(session, f"reports:{actor.user_id}", 5)
    case = ModerationCase(
        **case_target, object_version=version, workflow_version="D55-report-review"
    )
    session.add(case)
    await session.flush()
    entry = Report(
        reporter_id=actor.user_id,
        plan_id=case_target.get("plan_id"),
        reported_user_id=None if "plan_id" in case_target else target,
        target_key=key,
        target_type=payload.target_type,
        evidence=evidence,
        case_id=case.id,
        reason_code=payload.reason_code,
        comment=payload.comment,
    )
    session.add(entry)
    await session.commit()
    return report_dto(entry), True


async def get_report(session, actor, identity):
    await plans.require_active(session, actor)
    entry = await session.get(Report, identity)
    if not entry or entry.reporter_id != actor.user_id:
        raise missing()
    return report_dto(entry)


async def set_block(session, actor, payload):
    await lock_actor(session, actor)
    target, *_ = await context(session, actor, payload)
    await lock_pair(session, actor.user_id, target)
    entry = await session.scalar(
        select(UserRestriction).where(
            UserRestriction.kind == "personal",
            UserRestriction.imposed_by == actor.user_id,
            UserRestriction.user_id == target,
            UserRestriction.lifted_at.is_(None),
        )
    )
    if not entry:
        await rate_limit(session, f"blocks:{actor.user_id}", 10)
        entry = UserRestriction(
            user_id=target, imposed_by=actor.user_id, kind="personal", reason="personal_block"
        )
        session.add(entry)
    responses = select(PlanResponse.id).where(
        or_(
            and_(PlanResponse.plan_author_id == actor.user_id, PlanResponse.responder_id == target),
            and_(PlanResponse.plan_author_id == target, PlanResponse.responder_id == actor.user_id),
        )
    )
    matches = select(Match.id).where(
        or_(
            and_(Match.author_id == actor.user_id, Match.responder_id == target),
            and_(Match.author_id == target, Match.responder_id == actor.user_id),
        )
    )
    await session.execute(
        update(NotificationJob)
        .where(
            NotificationJob.state.in_(("pending", "retry", "leased")),
            NotificationJob.kind != "post_meeting_survey",
            or_(
                NotificationJob.entity_ref["response_id"].astext.in_(
                    select(responses.subquery().c.id.cast(Text))
                ),
                NotificationJob.entity_ref["match_id"].astext.in_(
                    select(matches.subquery().c.id.cast(Text))
                ),
            ),
        )
        .values(
            state="suppressed",
            safe_error_code="interaction_unavailable",
            lease_until=None,
            lease_owner=None,
        )
    )
    await session.commit()
    return {"id": entry.id, "blocked": True}


async def list_blocks(session, actor):
    await plans.require_active(session, actor)
    rows = (
        await session.execute(
            select(UserRestriction, Profile.name)
            .outerjoin(Profile, Profile.user_id == UserRestriction.user_id)
            .where(
                UserRestriction.kind == "personal",
                UserRestriction.imposed_by == actor.user_id,
                UserRestriction.lifted_at.is_(None),
            )
            .order_by(UserRestriction.imposed_at.desc(), UserRestriction.id)
        )
    ).all()
    return {"items": [await block_presentation(session, actor, row, name) for row, name in rows]}


def blocked_display_code(user_id):
    # UUID4 имеет высокую энтропию. Код не кодирует Telegram ID/UUID и не меняется
    # при перезапуске, ротации токена или повторной блокировке того же аккаунта.
    digest = hashlib.sha256(b"poidem:blocked-display:v1:" + user_id.bytes).digest()
    code = base64.b32encode(digest).decode()[:12]
    return "-".join(code[i : i + 4] for i in range(0, 12, 4))


async def block_presentation(session, actor, restriction, name):
    target = restriction.user_id
    result = {
        "id": restriction.id,
        "name": name or "Участник",
        "age": None,
        "created_at": restriction.imposed_at,
        "display_code": blocked_display_code(target),
        "photo_url": None,
        "context": None,
        "context_saved_later": False,
    }
    pair = or_(
        and_(PlanResponse.plan_author_id == actor.user_id, PlanResponse.responder_id == target),
        and_(PlanResponse.plan_author_id == target, PlanResponse.responder_id == actor.user_id),
    )
    match = await session.scalar(
        select(Match)
        .where(
            or_(
                and_(Match.author_id == actor.user_id, Match.responder_id == target),
                and_(Match.author_id == target, Match.responder_id == actor.user_id),
            )
        )
        .order_by(Match.created_at.desc(), Match.id)
        .limit(1)
    )
    response = (
        await session.get(PlanResponse, match.response_id)
        if match
        else await session.scalar(
            select(PlanResponse)
            .where(pair)
            .order_by(PlanResponse.created_at.desc(), PlanResponse.id)
            .limit(1)
        )
    )
    if response and response.history_context:
        frozen = response.history_context
        viewer_author = response.plan_author_id == actor.user_id
        result["name"] = (
            frozen.get("responder_name" if viewer_author else "author_name") or result["name"]
        )
        result["age"] = frozen.get("responder_age") if viewer_author else None
        result["context"] = frozen.get("plan_title")
        result["context_saved_later"] = frozen.get("source") == "legacy"
    if match:
        role = "responder" if match.author_id == actor.user_id else "author"
        try:
            profile, _ = await connections.match_photo(session, actor, match.id, role)
            result.update(name=profile.name, age=profile.age, photo_url=profile.photo.url)
        except AppError as error:
            if error.status_code != 404:
                raise
    # Без общей истории исходный план блокировки не записывался: не выдумываем
    # связь и не обходим запрет публичных фото через список настроек.
    return result


async def unblock(session, actor, identity):
    await lock_actor(session, actor)
    entry = await session.get(UserRestriction, identity)
    if not entry or entry.kind != "personal" or entry.imposed_by != actor.user_id:
        raise missing()
    await lock_pair(session, actor.user_id, entry.user_id)
    if not entry.lifted_at:
        entry.lifted_at, entry.lifted_by = plans.now(), actor.user_id
    await session.commit()


async def require_admin(session, actor, *, write=False):
    user = (
        await lock_actor(session, actor)
        if write
        else await session.get(User, actor.user_id, populate_existing=True)
    )
    if not user or user.account_status != "active" or user.role_code != "admin":
        raise AppError(403, "ADMIN_REQUIRED", "Этот раздел доступен только администратору")


async def admin_reports(session, actor, *, state=None, target_type=None, cursor=None, limit=20):
    await require_admin(session, actor)
    query = select(Report)
    if state:
        query = query.where(Report.state == state)
    if target_type:
        query = query.where(Report.target_type == target_type)
    if cursor:
        from sqlalchemy import tuple_

        query = query.where(tuple_(Report.created_at, Report.id) < plans.decode_cursor(cursor))
    rows = list(
        (
            await session.scalars(
                query.order_by(Report.created_at.desc(), Report.id.desc()).limit(limit + 1)
            )
        ).all()
    )
    return {
        "items": [report_dto(row) for row in rows[:limit]],
        "next_cursor": plans.encode_cursor(rows[limit - 1].created_at, rows[limit - 1].id)
        if len(rows) > limit
        else None,
    }


async def admin_detail(session, actor, identity):
    await require_admin(session, actor)
    entry = await session.get(Report, identity)
    if not entry:
        raise missing()
    decisions = (
        (
            await session.execute(
                select(ModerationDecision, Profile.name)
                .outerjoin(Profile, Profile.user_id == ModerationDecision.actor_id)
                .where(ModerationDecision.case_id == entry.case_id)
                .order_by(ModerationDecision.decided_at)
            )
        ).all()
        if entry.case_id
        else []
    )
    return {
        **report_dto(entry),
        "comment": entry.comment,
        "evidence": entry.evidence,
        "can_hide_plan": entry.target_type == "plan" and entry.state == "pending",
        "meeting_review": await report_meeting_review(session, entry),
        "decisions": [
            {
                "action": d.action,
                "reason": d.reason,
                "actor": name or "Администратор",
                "actor_id": d.actor_id,
                "decided_at": d.decided_at,
            }
            for d, name in decisions
        ],
    }


async def report_meeting_review(session, entry):
    context = entry.evidence.get("meeting_context")
    identity = context.get("match_id") if isinstance(context, dict) else None
    # Legacy chat/match keys were assigned by the same protected server context.
    if not identity and entry.target_type in ("chat", "match") and entry.target_key:
        prefix, _, value = entry.target_key.partition(":")
        if prefix == entry.target_type:
            identity = value
    try:
        match_id = uuid.UUID(identity) if isinstance(identity, str) else None
    except ValueError:
        return None
    match = await session.get(Match, match_id) if match_id else None
    if not match or {entry.reporter_id, entry.reported_user_id} != {
        match.author_id,
        match.responder_id,
    }:
        return None
    return {
        "match_id": str(match.id),
        "current": (await meeting_feedback.review(session, match)).model_dump(),
        "at_report": context.get("at_report") if isinstance(context, dict) else None,
    }


async def admin_photo(session, actor, identity):
    await require_admin(session, actor)
    entry = await session.get(Report, identity)
    if not entry or entry.target_type != "profile" or not entry.evidence.get("photo_id"):
        raise missing()
    photo = await session.get(Photo, uuid.UUID(entry.evidence["photo_id"]))
    if not photo or photo.owner_id != entry.reported_user_id:
        raise missing()
    return photo


async def decide_report(session, actor, identity, payload, request_id):
    await require_admin(session, actor, write=True)
    entry = await session.scalar(select(Report).where(Report.id == identity).with_for_update())
    if not entry:
        raise missing()
    if not entry.case_id:
        # Старые записи остаются читаемыми; отсутствующие доказательства не выдумываем.
        if payload.action != "dismiss":
            raise AppError(
                409,
                "REPORT_EVIDENCE_UNAVAILABLE",
                "У этой жалобы нет сохранённых доказательств для скрытия плана",
            )
        target = (
            {"plan_id": entry.plan_id}
            if entry.plan_id
            else {"target_user_id": entry.reported_user_id}
        )
        case = ModerationCase(**target, object_version=1, workflow_version="D55-legacy-report")
        session.add(case)
        await session.flush()
        entry.case_id = case.id
    case = await session.get(ModerationCase, entry.case_id)
    previous = await session.scalar(
        select(ModerationDecision).where(ModerationDecision.case_id == case.id)
    )
    if previous:
        if previous.action != payload.action or previous.reason != payload.reason:
            raise AppError(409, "REPORT_ALREADY_REVIEWED", "Жалоба уже рассмотрена — обнови её")
        return await admin_detail(session, actor, identity)
    old_status, new_status = "pending", "approved"
    if payload.action == "hide_plan":
        if entry.target_type != "plan" or not entry.plan_id:
            raise AppError(422, "MODERATION_ACTION_INVALID", "По этой жалобе нельзя скрыть план")
        plan = await session.scalar(select(Plan).where(Plan.id == entry.plan_id).with_for_update())
        if plan.version != case.object_version:
            raise AppError(
                409,
                "MODERATION_VERSION_CONFLICT",
                "План изменился после жалобы; скрытие по устаревшим сведениям недоступно",
            )
        if plan.publication_status not in ("published", "closed"):
            raise AppError(409, "MODERATION_PLAN_UNAVAILABLE", "План уже снят с публикации")
        old_status, new_status = plan.moderation_status, "rejected"
        plan.moderation_status = "rejected"
        plan.version += 1
        plan.updated_at = plans.now()
        case.state = "blocked"
    else:
        case.state = "approved"
    entry.state = "reviewed"
    session.add(
        ModerationDecision(
            case_id=case.id,
            actor_id=actor.user_id,
            step_key="manual_report",
            action=payload.action,
            reason=payload.reason,
            object_version=case.object_version,
        )
    )
    session.add(
        AdminAuditLog(
            actor_id=actor.user_id,
            action=payload.action,
            target_ref=f"report:{entry.id}",
            object_version=case.object_version,
            old_status=old_status,
            new_status=new_status,
            reason_code=payload.reason,
            request_id=request_id,
        )
    )
    await session.commit()
    return await admin_detail(session, actor, identity)
