"""Собственная база общественных мест. Сеть/ключи провайдера не используются."""

import csv
import hashlib
import io
import re
import unicodedata
import uuid
from datetime import UTC, datetime
from difflib import SequenceMatcher

from pydantic import ValidationError
from sqlalchemy import func, select, text

from poidem.api.errors import AppError
from poidem.db.models import AdminAuditLog, PublicPlace
from poidem.schemas.place import CheckedPlace, PlaceProposal
from poidem.services import admin_permissions
from poidem.services.place_policy import CATEGORIES, clean
from poidem.services.place_policy import POLICY_VERSION as POLICY
from poidem.services.plan_content import validate_content


def normalized(value):
    return " ".join(
        re.findall(r"\w+", unicodedata.normalize("NFKC", value).casefold().replace("ё", "е"))
    )


def fields(payload):
    try:
        values = {
            key: clean(getattr(payload, key)) for key in ("name", "address", "city", "category")
        }
        PlaceProposal.model_validate(values)
    except (ValueError, ValidationError):
        raise AppError(422, "PLACE_FIELDS_INVALID", "Проверь название, адрес и город") from None
    validate_content(title=values["name"], description=values["city"], place=values["address"])
    identity = "\0".join(normalized(values[k]) for k in ("name", "address", "city"))
    values["dedupe_key"] = hashlib.sha256(identity.encode()).hexdigest()
    values["search_text"] = normalized(" ".join(values[k] for k in ("name", "address", "city")))
    return values


def full_address(place):
    return (
        place.address
        if f" {normalized(place.city)} " in f" {normalized(place.address)} "
        else f"{place.city}, {place.address}"
    )


def candidate(place, actor_id=None):
    return CheckedPlace(
        provider="local",
        provider_place_id=str(place.id),
        name=place.name,
        address=full_address(place),
        city=place.city,
        category=place.category,
        category_label=CATEGORIES[place.category],
        status=place.status,
        moderation_reason=place.reason
        if place.status != "approved" and place.proposer_id == actor_id and actor_id is not None
        else None,
        catalogue_version=place.version,
        checked_at=place.reviewed_at,
        policy_version=POLICY,
    )


def dto(place):
    return {
        key: getattr(place, key)
        for key in (
            "id",
            "name",
            "address",
            "city",
            "category",
            "status",
            "version",
            "created_at",
            "updated_at",
            "reviewed_at",
            "reason",
        )
    } | {"category_label": CATEGORIES[place.category]}


async def entry(session, identity, *, lock=False):
    try:
        identity = uuid.UUID(str(identity))
    except ValueError:
        raise AppError(422, "PLACE_ID_INVALID", "Выбери место из каталога") from None
    query = select(PublicPlace).where(PublicPlace.id == identity)
    if lock:
        query = query.with_for_update()
    place = await session.scalar(query.execution_options(populate_existing=True))
    if not place:
        raise AppError(404, "PLACE_NOT_FOUND", "Место не найдено в каталоге")
    return place


async def key_lock(session, key):
    await session.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key,0))"),
        {"key": "public-place:" + key},
    )


def audit(session, actor, place, action, request_id, old=None, reason="catalogue_read"):
    session.add(
        AdminAuditLog(
            actor_id=actor.user_id,
            action="place_" + action,
            target_ref=f"place:{place.id}",
            object_version=place.version,
            old_status=old,
            new_status=place.status,
            reason_code=reason,
            request_id=request_id,
        )
    )


async def propose(session, actor, payload):
    from poidem.security.session import lock_actor

    await lock_actor(session, actor)
    values = fields(payload)
    await key_lock(session, values["dedupe_key"])
    existing = await session.scalar(
        select(PublicPlace).where(PublicPlace.dedupe_key == values["dedupe_key"])
    )
    if existing:
        if existing.status == "approved" or existing.proposer_id == actor.user_id:
            return existing
        raise AppError(
            409, "PLACE_ALREADY_PROPOSED", "Такое место уже предложено и пока недоступно в каталоге"
        )
    place = PublicPlace(**values, proposer_id=actor.user_id)
    session.add(place)
    await session.flush()
    return place


async def similar(session, place):
    # Ограниченная подсказка человеку, не автоматическое слияние объектов/филиалов.
    rows = (
        await session.scalars(
            select(PublicPlace)
            .where(PublicPlace.id != place.id, func.lower(PublicPlace.city) == place.city.lower())
            .limit(100)
        )
    ).all()
    return [
        dto(p)
        for p in rows
        if normalized(p.address) == normalized(place.address)
        or SequenceMatcher(None, normalized(p.name), normalized(place.name)).ratio() >= 0.7
    ][:10]


async def listing(session, actor, q="", state=None, offset=0, limit=20, request_id=None):
    await admin_permissions.require(session, actor, "moderation")
    query = select(PublicPlace)
    if state:
        query = query.where(PublicPlace.status == state)
    for term in normalized(q).split():
        query = query.where(PublicPlace.search_text.contains(term, autoescape=True))
    total = await session.scalar(select(func.count()).select_from(query.subquery()))
    rows = (
        await session.scalars(
            query.order_by(PublicPlace.created_at.desc(), PublicPlace.id)
            .offset(offset)
            .limit(limit)
        )
    ).all()
    session.add(
        AdminAuditLog(
            actor_id=actor.user_id,
            action="place_list",
            target_ref="places",
            reason_code="catalogue_read",
            request_id=request_id or uuid.uuid4(),
        )
    )
    await session.commit()
    return {
        "items": [dto(p) for p in rows],
        "total": total,
        "next_offset": offset + limit if offset + limit < total else None,
    }


async def detail(session, actor, identity, request_id):
    await admin_permissions.require(session, actor, "moderation")
    place = await entry(session, identity)
    result = dto(place) | {"possible_duplicates": await similar(session, place)}
    audit(session, actor, place, "read", request_id)
    await session.commit()
    return result


async def edit(session, actor, identity, payload, request_id):
    await admin_permissions.require(session, actor, "moderation", write=True)
    place = await entry(session, identity, lock=True)
    if place.version != payload.expected_version:
        raise AppError(409, "PLACE_VERSION_CONFLICT", "Место уже изменилось — открой его заново")
    if place.status == "approved" and not payload.public_access_confirmed:
        raise AppError(422, "PLACE_REVIEW_REQUIRED", "Подтверди проверку обновлённых сведений")
    values = fields(payload)
    await key_lock(session, values["dedupe_key"])
    duplicate = await session.scalar(
        select(PublicPlace.id).where(
            PublicPlace.dedupe_key == values["dedupe_key"], PublicPlace.id != place.id
        )
    )
    if duplicate:
        raise AppError(
            409, "PLACE_DUPLICATE", "Такое место уже есть — открой совпадение в каталоге"
        )
    for key, value in values.items():
        setattr(place, key, value)
    place.version += 1
    place.updated_at = datetime.now(UTC)
    if place.status == "approved":
        place.reviewed_at, place.reviewed_by = place.updated_at, actor.user_id
    audit(session, actor, place, "edit", request_id, place.status, payload.reason)
    await session.commit()
    return dto(place)


async def decision(session, actor, identity, payload, request_id):
    await admin_permissions.require(session, actor, "moderation", write=True)
    place = await entry(session, identity, lock=True)
    if place.version != payload.expected_version:
        raise AppError(409, "PLACE_VERSION_CONFLICT", "Место уже изменилось — открой его заново")
    old = place.status
    if payload.action == "approve":
        if not payload.public_access_confirmed:
            raise AppError(
                422,
                "PLACE_REVIEW_REQUIRED",
                "Подтверди существование и публичную доступность объекта",
            )
        fields(
            PlaceProposal(**{k: getattr(place, k) for k in ("name", "address", "city", "category")})
        )
        place.status = "approved"
    elif payload.action == "reject" and old == "pending":
        place.status = "rejected"
    elif payload.action == "hide" and old == "approved":
        place.status = "hidden"
    else:
        raise AppError(409, "PLACE_STATE_CONFLICT", "Это действие недоступно для текущего статуса")
    place.version += 1
    place.reviewed_at = place.updated_at = datetime.now(UTC)
    place.reviewed_by = actor.user_id
    place.reason = payload.reason
    audit(session, actor, place, payload.action, request_id, old, payload.reason)
    await session.commit()
    return dto(place)


async def import_csv(session, actor, payload, request_id):
    await admin_permissions.require(session, actor, "moderation", write=True)
    try:
        reader = csv.DictReader(io.StringIO(payload.csv.lstrip("\ufeff")), strict=True)
        if reader.fieldnames != ["name", "address", "city", "category"]:
            raise ValueError
        rows = list(reader)
        if not 1 <= len(rows) <= 100:
            raise ValueError
        values = [fields(PlaceProposal.model_validate(row)) for row in rows]
        if len({v["dedupe_key"] for v in values}) != len(values):
            raise ValueError
    except (ValueError, ValidationError, csv.Error, TypeError):
        raise AppError(
            422,
            "PLACES_CSV_INVALID",
            "Проверь CSV: name,address,city,category; 1–100 строк без повторов",
        ) from None
    created, skipped = [], 0
    for value in sorted(values, key=lambda v: v["dedupe_key"]):
        await key_lock(session, value["dedupe_key"])
        existing = await session.scalar(
            select(PublicPlace.id).where(PublicPlace.dedupe_key == value["dedupe_key"])
        )
        if existing:
            skipped += 1
            continue
        place = PublicPlace(
            **value, status="approved", reviewed_by=actor.user_id, reviewed_at=datetime.now(UTC)
        )
        session.add(place)
        await session.flush()
        audit(
            session,
            actor,
            place,
            "csv_import",
            request_id,
            reason="CSV: объекты проверены оператором",
        )
        created.append(dto(place))
    await session.commit()
    return {"created": len(created), "skipped": skipped, "items": created}
