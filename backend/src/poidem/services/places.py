import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from poidem.api.errors import AppError
from poidem.db.models import PlaceSelectionRecord, PublicPlace
from poidem.schemas.place import CheckedPlace, PlaceSearchResult, PlaceSelection
from poidem.security.session import lock_actor
from poidem.services import place_catalogue as catalogue
from poidem.services.place_policy import place_label


class PlacesService:
    def __init__(self, settings):
        self.settings = settings

    async def search(self, session, query):
        if len(catalogue.normalized(query)) < 3:
            raise AppError(
                422, "PLACE_QUERY_SHORT", "Введи хотя бы три символа названия или города"
            )
        statement = select(PublicPlace).where(PublicPlace.status == "approved")
        for term in catalogue.normalized(query).split():
            statement = statement.where(PublicPlace.search_text.contains(term, autoescape=True))
        rows = (
            await session.scalars(statement.order_by(PublicPlace.name, PublicPlace.id).limit(20))
        ).all()
        return PlaceSearchResult(items=[catalogue.candidate(row) for row in rows], attribution="")

    async def resolve(self, session, actor, identity):
        await lock_actor(session, actor)
        place = await catalogue.entry(session, identity)
        if place.status != "approved" and place.proposer_id != actor.user_id:
            raise AppError(404, "PLACE_NOT_FOUND", "Место пока недоступно в каталоге")
        checked = catalogue.candidate(place, actor.user_id)
        statement = (
            insert(PlaceSelectionRecord)
            .values(
                id=uuid.uuid4(),
                user_id=actor.user_id,
                provider="local",
                provider_place_id=str(place.id),
                checked_at=datetime.now(UTC),
                snapshot=checked.model_dump(mode="json"),
            )
            .on_conflict_do_update(
                constraint="uq_place_selection",
                set_={
                    "checked_at": datetime.now(UTC),
                    "snapshot": checked.model_dump(mode="json"),
                },
            )
            .returning(PlaceSelectionRecord.id)
        )
        identity = await session.scalar(statement)
        await session.commit()
        return PlaceSelection(selection_id=identity, place=checked)

    async def selection(self, session, actor, identity, label):
        selection = await session.scalar(
            select(PlaceSelectionRecord).where(
                PlaceSelectionRecord.id == identity, PlaceSelectionRecord.user_id == actor.user_id
            )
        )
        if selection is None or selection.provider != "local":
            raise AppError(422, "PLACE_SELECTION_INVALID", "Выбери место из собственного каталога")
        checked = CheckedPlace.model_validate(selection.snapshot)
        current = catalogue.candidate(
            await catalogue.entry(session, checked.provider_place_id), actor.user_id
        )
        if label not in (place_label(checked), place_label(current)):
            raise AppError(
                422,
                "PLACE_SELECTION_CHANGED",
                "Название или адрес изменились — выбери место заново",
            )
        return {**current.model_dump(mode="json"), "selection_id": str(selection.id)}

    async def publication(self, session, venue):
        if (
            not venue
            or venue.get("provider") != "local"
            or venue.get("policy_version") != catalogue.POLICY
        ):
            raise AppError(
                422, "PLACE_REQUIRED", "Выбери одобренное место из собственного каталога"
            )
        try:
            identity = uuid.UUID(venue["provider_place_id"])
        except (ValueError, KeyError, TypeError):
            raise AppError(422, "PLACE_SELECTION_INVALID", "Выбери место заново") from None
        # FOR SHARE: скрытие/редактирование не может обогнать публикацию.
        place = await session.scalar(
            select(PublicPlace)
            .where(PublicPlace.id == identity)
            .with_for_update(read=True)
            .execution_options(populate_existing=True)
        )
        if not place or place.status != "approved":
            raise AppError(
                409,
                "PLACE_NOT_APPROVED",
                "Место ещё не одобрено или скрыто. Сохрани черновик или выбери другое",
            )
        return {
            **catalogue.candidate(place).model_dump(mode="json"),
            "selection_id": venue["selection_id"],
        }


async def draft_views(session, entries, actor_id=None):
    identities = set()
    for plan in entries:
        if (
            plan.publication_status == "draft"
            and plan.venue
            and plan.venue.get("provider") == "local"
        ):
            identities.add(uuid.UUID(plan.venue["provider_place_id"]))
    if not identities:
        return {}
    rows = (await session.scalars(select(PublicPlace).where(PublicPlace.id.in_(identities)))).all()
    return {str(row.id): catalogue.candidate(row, actor_id) for row in rows}
