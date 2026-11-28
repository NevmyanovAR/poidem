import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request

from poidem.api.routers.account import Authenticated, Session, WriteActor
from poidem.api.routers.admin_dashboard import request_id
from poidem.api.routers.plans import check_context
from poidem.schemas.place import (
    PlaceDecision,
    PlaceEdit,
    PlaceProposal,
    PlaceResolve,
    PlacesImport,
    PlanPlaceDecision,
)
from poidem.services import place_catalogue as catalogue
from poidem.services.plans import require_active
from poidem.services.rate_limit import rate_limit

router = APIRouter(prefix="/api/v1", tags=["Места"], dependencies=[Depends(check_context)])


@router.get("/places/search")
async def search(
    request: Request,
    actor: Authenticated,
    session: Session,
    q: str = Query(min_length=3, max_length=100),
):
    await require_active(session, actor)
    await rate_limit(
        session,
        f"places:search:{actor.user_id}",
        request.app.state.settings.places_search_per_minute,
    )
    await session.commit()
    return await request.app.state.places.search(session, q)


@router.post("/places/resolve")
async def resolve(payload: PlaceResolve, request: Request, actor: WriteActor, session: Session):
    await require_active(session, actor)
    await rate_limit(
        session,
        f"places:resolve:{actor.user_id}",
        request.app.state.settings.places_resolve_per_minute,
    )
    await session.commit()
    return await request.app.state.places.resolve(session, actor, payload.provider_place_id)


@router.post("/places/proposals")
async def propose(payload: PlaceProposal, request: Request, actor: WriteActor, session: Session):
    await require_active(session, actor)
    await rate_limit(
        session,
        f"places:resolve:{actor.user_id}",
        request.app.state.settings.places_resolve_per_minute,
    )
    await session.commit()
    place = await catalogue.propose(session, actor, payload)
    return await request.app.state.places.resolve(session, actor, str(place.id))


@router.get("/me/place-proposals")
async def own(
    actor: Authenticated,
    session: Session,
    offset: int = Query(0, ge=0, le=100000),
    limit: int = Query(20, ge=1, le=50),
):
    from sqlalchemy import select

    from poidem.db.models import PublicPlace

    rows = (
        await session.scalars(
            select(PublicPlace)
            .where(PublicPlace.proposer_id == actor.user_id)
            .order_by(PublicPlace.created_at.desc())
            .offset(offset)
            .limit(limit + 1)
        )
    ).all()
    return {
        "items": [catalogue.dto(p) for p in rows[:limit]],
        "next_offset": offset + limit if len(rows) > limit else None,
    }


@router.get("/admin/places")
async def admin_listing(
    request: Request,
    actor: Authenticated,
    session: Session,
    q: str = Query("", max_length=100),
    state: Literal["pending", "approved", "rejected", "hidden"] | None = None,
    offset: int = Query(0, ge=0, le=100000),
    limit: int = Query(20, ge=1, le=50),
):
    return await catalogue.listing(session, actor, q, state, offset, limit, request_id(request))


@router.post("/admin/places/import")
async def import_csv(payload: PlacesImport, actor: WriteActor, session: Session, request: Request):
    return await catalogue.import_csv(session, actor, payload, request_id(request))


@router.get("/admin/places/{identity}")
async def detail(identity: uuid.UUID, actor: Authenticated, session: Session, request: Request):
    return await catalogue.detail(session, actor, identity, request_id(request))


@router.put("/admin/places/{identity}")
async def edit(
    identity: uuid.UUID, payload: PlaceEdit, actor: WriteActor, session: Session, request: Request
):
    return await catalogue.edit(session, actor, identity, payload, request_id(request))


@router.post("/admin/places/{identity}/decision")
async def decide(
    identity: uuid.UUID,
    payload: PlaceDecision,
    actor: WriteActor,
    session: Session,
    request: Request,
):
    return await catalogue.decision(session, actor, identity, payload, request_id(request))


@router.get("/admin/place-checks")
async def checks(
    request: Request,
    actor: Authenticated,
    session: Session,
    state: Literal["pending", "confirmed", "unconfirmed"] | None = None,
    offset: int = Query(0, ge=0, le=100000),
    limit: int = Query(20, ge=1, le=50),
):
    from poidem.services import place_review

    return await place_review.listing(session, actor, state, offset, limit, request_id(request))


@router.post("/admin/place-checks/{identity}/decision")
async def check_decision(
    identity: uuid.UUID,
    payload: PlanPlaceDecision,
    request: Request,
    actor: WriteActor,
    session: Session,
):
    from poidem.services import place_review

    return await place_review.decide(session, actor, identity, payload, request_id(request))
