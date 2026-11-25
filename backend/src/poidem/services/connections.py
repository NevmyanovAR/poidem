"""Отклики и ровно одна пара на план; все изменения сериализуются строкой плана."""

import hashlib
import json
import re
import uuid
from datetime import timedelta

from sqlalchemy import func, or_, select, tuple_, update

from poidem.api.errors import AppError
from poidem.db.models import (
    Category,
    ChatReadState,
    ChatThread,
    IdempotencyRecord,
    Match,
    Plan,
    PlanResponse,
    User,
)
from poidem.schemas.connections import (
    CapacityDTO,
    ContactDTO,
    MatchDTO,
    MatchPage,
    ParticipantDTO,
    ResponseDTO,
    ResponsePage,
)
from poidem.security.session import lock_actor
from poidem.services import candidates, notifications, plans, surveys

ACTIVE = ("waiting", "accepted")


def missing():
    return AppError(404, "CONNECTION_NOT_FOUND", "Эта запись недоступна")


async def response_record(session, actor, identity):
    entry = await session.get(PlanResponse, identity)
    if not entry or actor.user_id not in (entry.plan_author_id, entry.responder_id):
        raise missing()
    return entry


async def match_record(session, actor, identity):
    await plans.require_active(session, actor)
    entry = await session.get(Match, identity)
    if not entry or actor.user_id not in (entry.author_id, entry.responder_id):
        raise missing()
    return entry


async def optional_profile(session, user_id, url):
    try:
        profile, _ = await candidates.public_profile(session, user_id, url)
        return profile
    except AppError as error:
        if error.status_code != 404:
            raise
        return None


async def response_profile(session, actor, entry):
    await plans.require_active(session, actor)
    if entry.status not in ACTIVE:
        raise candidates.not_found()
    plan = await session.get(Plan, entry.plan_id)
    if not plan or plan.moderation_status not in plans.VISIBLE_MODERATION:
        raise candidates.not_found()
    if entry.status == "waiting" and (
        plan.publication_status != "published" or plan.starts_at <= plans.now()
    ):
        raise candidates.not_found()
    target = entry.responder_id if actor.user_id == entry.plan_author_id else entry.plan_author_id
    return await candidates.public_profile(
        session, target, f"/api/v1/responses/{entry.id}/profile/photo"
    )


async def response_dto(session, actor, entry):
    from poidem.services.archive import is_archived

    row = (await session.execute(plans.joined_plans().where(Plan.id == entry.plan_id))).first()
    plan = row[0] if row else await session.get(Plan, entry.plan_id)
    own = entry.plan_author_id == actor.user_id
    visible = row is not None and (own or plan.moderation_status in plans.VISIBLE_MODERATION)
    if not own and entry.status == "rejected":
        visible = False
    profile = None
    try:
        profile, _ = await response_profile(session, actor, entry)
    except AppError as error:
        if error.status_code != 404:
            raise
    match = await session.scalar(select(Match).where(Match.response_id == entry.id))
    return ResponseDTO(
        id=entry.id,
        plan_id=entry.plan_id,
        plan=plans.dto(row, actor) if visible else None,
        status=entry.status,
        display_status=response_display_status(entry, plan, plans.now()),
        version=entry.version,
        created_at=entry.created_at,
        decided_at=entry.decided_at,
        profile=profile,
        match_id=match.id if match else None,
        archived=is_archived(plan) if plan else True,
        viewer_role="author" if own else "responder",
        history_context=entry.history_context,
        match=await match_dto(session, actor, match) if match else None,
    )


def response_display_status(entry, plan, at):
    """Только представление. Время не превращает принятие/отказ в другой результат."""
    if entry.status != "waiting":
        return entry.status
    if plan and plan.publication_status == "cancelled":
        return "cancelled"
    if plan and plan.starts_at <= at:
        return "expired"
    if (
        not plan
        or plan.publication_status != "published"
        or plan.moderation_status not in plans.VISIBLE_MODERATION
    ):
        return "unavailable"
    return "waiting"


async def capacity(session, actor, plan_id):
    plan = await plans.get_plan(session, actor, plan_id)
    count = await session.scalar(
        select(func.count())
        .select_from(PlanResponse)
        .where(PlanResponse.plan_id == plan_id, PlanResponse.status == "waiting")
    )
    own = await session.scalar(
        select(PlanResponse.id).where(
            PlanResponse.plan_id == plan_id,
            PlanResponse.responder_id == actor.user_id,
            PlanResponse.status.in_(ACTIVE),
        )
    )
    allowed = not plan.own and own is None and count < 15 and plan.publication_status == "published"
    if allowed:
        try:
            await candidates.public_profile(session, actor.user_id, "")
            await candidates.public_profile(session, plan.author.id, "")
        except AppError:
            allowed = False
    return CapacityDTO(
        count=count, remaining=max(0, 15 - count), can_respond=allowed, own_response_id=own
    )


async def send(session, actor, plan_id, payload, key):
    await lock_actor(session, actor)
    await plans.require_active(session, actor, profile=True)
    path = f"/api/v1/plans/{plan_id}/responses"
    fingerprint = hashlib.sha256(
        json.dumps(payload.model_dump(), sort_keys=True).encode()
    ).hexdigest()
    replay = await session.get(IdempotencyRecord, (actor.user_id, "POST", path, key))
    if replay:
        if replay.request_fingerprint != fingerprint:
            raise AppError(
                409, "IDEMPOTENCY_CONFLICT", "Ключ повтора уже использован для другого отклика"
            )
        entry = await response_record(session, actor, uuid.UUID(replay.result_resource_ref))
        if entry.status == "rejected":
            raise AppError(409, "RESPONSE_REJECTED", "Отклик отклонён — выбери другой план")
        return await response_dto(session, actor, entry), False
    plan = await session.scalar(
        select(Plan)
        .where(Plan.id == plan_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if not plan:
        raise missing()
    if plan.author_id == actor.user_id:
        raise AppError(409, "OWN_PLAN_RESPONSE", "Нельзя откликнуться на собственный план")
    previous = await session.scalar(
        select(PlanResponse).where(
            PlanResponse.plan_id == plan_id, PlanResponse.responder_id == actor.user_id
        )
    )
    if previous and previous.status == "rejected":
        raise AppError(409, "RESPONSE_REJECTED", "Отклик отклонён — выбери другой план")
    if previous and previous.status == "closed":
        raise AppError(409, "RESPONSE_ALREADY_DECIDED", "Для этого плана уже выбрана пара")
    # Тот же набор публичной доступности, что у каталога, плюс проверка фото обоих.
    await plans.get_plan(session, actor, plan_id)
    responder_profile, _ = await candidates.public_profile(session, actor.user_id, "")
    author_profile, _ = await candidates.public_profile(session, plan.author_id, "")
    if plan.version != payload.expected_plan_version:
        raise AppError(409, "PLAN_VERSION_CONFLICT", "План изменился — открой его заново")
    entry = await session.scalar(
        select(PlanResponse).where(
            PlanResponse.plan_id == plan_id,
            PlanResponse.responder_id == actor.user_id,
            PlanResponse.status.in_(ACTIVE),
        )
    )
    created = entry is None
    if created:
        occupied = set(
            (
                await session.scalars(
                    select(PlanResponse.slot_no).where(
                        PlanResponse.plan_id == plan_id, PlanResponse.slot_no.is_not(None)
                    )
                )
            ).all()
        )
        free = next((number for number in range(1, 16) if number not in occupied), None)
        if free is None:
            raise AppError(409, "PLAN_RESPONSE_LIMIT", "На этот план уже ожидают ответа 15 человек")
        entry = PlanResponse(
            plan_id=plan.id,
            plan_author_id=plan.author_id,
            responder_id=actor.user_id,
            agreed_plan_version=plan.version,
            status="waiting",
            slot_no=free,
            version=1,
            history_context={
                "plan_title": plan.title,
                "author_name": author_profile.name,
                "responder_name": responder_profile.name,
                "responder_age": responder_profile.age,
                "captured_at": plans.now().isoformat(),
                "source": "response",
            },
        )
        session.add(entry)
        await session.flush()
        await notifications.response_event(session, entry, "response_received")
    session.add(
        IdempotencyRecord(
            actor_id=actor.user_id,
            method="POST",
            path=path,
            key=key,
            request_fingerprint=fingerprint,
            result_resource_ref=str(entry.id),
            expires_at=plans.now() + timedelta(days=1),
        )
    )
    await session.commit()
    return await response_dto(session, actor, entry), created


async def decide(session, actor, response_id, payload):
    await lock_actor(session, actor)
    initial = await response_record(session, actor, response_id)
    if initial.plan_author_id != actor.user_id:
        raise missing()
    plan = await session.scalar(
        select(Plan)
        .where(Plan.id == initial.plan_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    entry = await session.scalar(
        select(PlanResponse)
        .where(PlanResponse.id == response_id)
        .execution_options(populate_existing=True)
    )
    target = "accepted" if payload.decision == "accept" else "rejected"
    if entry.status == target:
        return await response_dto(session, actor, entry)
    if entry.status != "waiting":
        raise AppError(409, "RESPONSE_ALREADY_DECIDED", "Ответ уже изменился — обнови список")
    if entry.version != payload.expected_version:
        raise AppError(409, "RESPONSE_VERSION_CONFLICT", "Отклик изменился — обнови список")
    if plan.publication_status != "published" or plan.starts_at <= plans.now():
        raise AppError(409, "PLAN_NOT_AVAILABLE", "Этот план уже закрыт или встреча началась")
    if plan.moderation_status not in plans.VISIBLE_MODERATION:
        raise AppError(409, "PLAN_NOT_AVAILABLE", "Этот план недоступен для знакомства")
    await candidates.public_profile(session, actor.user_id, "")
    if target == "accepted":
        await candidates.public_profile(session, entry.responder_id, "")
        if entry.agreed_plan_version != plan.version:
            raise AppError(
                409, "PLAN_VERSION_CONFLICT", "Условия плана изменились — нужно новое согласие"
            )
        if await session.scalar(select(Match.id).where(Match.plan_id == plan.id)):
            raise AppError(409, "PLAN_ALREADY_MATCHED", "Для этого плана уже выбрана пара")
        match = Match(
            response_id=entry.id,
            plan_id=plan.id,
            author_id=plan.author_id,
            responder_id=entry.responder_id,
            accepted_plan_version=plan.version,
            meeting_starts_at=plan.starts_at,
            meeting_time_zone=plan.time_zone,
            meeting_place=plan.place,
        )
        session.add(match)
        await session.flush()
        session.add(ChatThread(match_id=match.id))
        await session.flush()
        session.add_all(
            [ChatReadState(match_id=match.id, role=role) for role in ("author", "responder")]
        )
        # Не выдаём автоматическое закрытие за персональный отказ автора.
        closed_rows = await session.execute(
            update(PlanResponse)
            .where(
                PlanResponse.plan_id == plan.id,
                PlanResponse.id != entry.id,
                PlanResponse.status == "waiting",
            )
            .values(
                status="closed",
                slot_no=None,
                decided_at=plans.now(),
                decision_actor_id=None,
                version=PlanResponse.version + 1,
            )
            .returning(PlanResponse)
        )
        for closed in closed_rows.scalars():
            await notifications.response_event(session, closed, "response_closed")
        await notifications.response_event(session, entry, "response_accepted")
        await surveys.schedule(session, match)
        plan.publication_status = "closed"
        plan.version += 1
        plan.updated_at = plans.now()
    else:
        entry.slot_no = None
    entry.status = target
    entry.decision_actor_id = actor.user_id
    entry.decided_at = plans.now()
    entry.version += 1
    if target == "rejected":
        await notifications.response_event(session, entry, "response_rejected")
    await session.commit()
    return await response_dto(session, actor, entry)


async def list_responses(session, actor, *, incoming, plan_id=None, cursor=None, limit=20):
    await plans.require_active(session, actor)
    if plan_id is not None:
        plan = await session.get(Plan, plan_id)
        if not plan or plan.author_id != actor.user_id:
            raise missing()
    query = select(PlanResponse).where(
        PlanResponse.plan_author_id == actor.user_id
        if incoming
        else PlanResponse.responder_id == actor.user_id
    )
    if plan_id is not None:
        query = query.where(PlanResponse.plan_id == plan_id)
    if cursor:
        query = query.where(
            tuple_(PlanResponse.created_at, PlanResponse.id) < plans.decode_cursor(cursor)
        )
    rows = (
        await session.scalars(
            query.order_by(PlanResponse.created_at.desc(), PlanResponse.id.desc()).limit(limit + 1)
        )
    ).all()
    page = rows[:limit]
    return ResponsePage(
        items=[await response_dto(session, actor, entry) for entry in page],
        next_cursor=plans.encode_cursor(page[-1].created_at, page[-1].id)
        if len(rows) > limit
        else None,
    )


async def match_dto(session, actor, entry):
    from poidem.services import archive, chat

    plan = await session.get(Plan, entry.plan_id)
    category = await session.get(Category, plan.category_code)
    participants = []
    for role, user_id in (("author", entry.author_id), ("responder", entry.responder_id)):
        profile = (
            await optional_profile(session, user_id, f"/api/v1/matches/{entry.id}/photo/{role}")
            if plan.moderation_status in plans.VISIBLE_MODERATION
            else None
        )
        participants.append(ParticipantDTO(role=role, profile=profile))
    return MatchDTO(
        id=entry.id,
        plan_id=plan.id,
        title=plan.title,
        image=category.cover_asset_key,
        starts_at=entry.meeting_starts_at,
        time_zone=entry.meeting_time_zone,
        place=entry.meeting_place,
        created_at=entry.created_at,
        participants=participants,
        archived=archive.is_archived(plan),
        meeting_cancelled=plan.publication_status == "cancelled",
        unread_count=await chat.unread(session, actor, entry),
        viewer_role="author" if actor.user_id == entry.author_id else "responder",
    )


async def list_matches(session, actor, *, cursor=None, limit=20):
    await plans.require_active(session, actor)
    query = select(Match).where(
        or_(Match.author_id == actor.user_id, Match.responder_id == actor.user_id)
    )
    if cursor:
        query = query.where(tuple_(Match.created_at, Match.id) < plans.decode_cursor(cursor))
    rows = (
        await session.scalars(
            query.order_by(Match.created_at.desc(), Match.id.desc()).limit(limit + 1)
        )
    ).all()
    page = rows[:limit]
    return MatchPage(
        items=[await match_dto(session, actor, entry) for entry in page],
        next_cursor=plans.encode_cursor(page[-1].created_at, page[-1].id)
        if len(rows) > limit
        else None,
    )


async def match_photo(session, actor, match_id, role):
    entry = await match_record(session, actor, match_id)
    plan = await session.get(Plan, entry.plan_id)
    if plan.moderation_status not in plans.VISIBLE_MODERATION:
        raise missing()
    user_id = entry.author_id if role == "author" else entry.responder_id
    return await candidates.public_profile(
        session, user_id, f"/api/v1/matches/{match_id}/photo/{role}"
    )


async def contact(session, actor, match_id):
    entry = await match_record(session, actor, match_id)
    plan = await session.get(Plan, entry.plan_id)
    if plan.moderation_status not in plans.VISIBLE_MODERATION:
        raise missing()
    other = entry.responder_id if actor.user_id == entry.author_id else entry.author_id
    if (
        await optional_profile(session, other, "") is None
        or await optional_profile(session, actor.user_id, "") is None
    ):
        raise missing()
    user = await session.get(User, other)
    username = user.private_username
    reserved = {
        "share",
        "login",
        "proxy",
        "socks",
        "contact",
        "joinchat",
        "addstickers",
        "addemoji",
        "invoice",
        "boost",
        "setlanguage",
        "addlist",
        "m",
        "nft",
        "web",
        "auth",
    }
    if not username:
        return ContactDTO(available=False, reason="username_missing")
    if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,63}", username) or username.lower() in reserved:
        return ContactDTO(available=False, reason="username_unavailable")
    return ContactDTO(available=True, telegram_url=f"https://t.me/{username}")
