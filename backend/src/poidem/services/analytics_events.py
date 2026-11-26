"""Минимальные D61-события: первый просмотр и первая новая публикация, без сырого ввода."""

from sqlalchemy.dialects.postgresql import insert

from poidem.db.models import AnalyticsEvent

COVERAGE_KEY = "measurement:D61"
VIEW = "plan_detail_view"
PUBLISHED = "plan_published"


async def record(session, kind, actor_id, plan_id):
    await session.execute(
        insert(AnalyticsEvent)
        .values(
            event_key=f"D61:{kind}:{actor_id}:{plan_id}",
            event_type=kind,
            actor_id=actor_id,
            entity_type="plan",
            entity_id=plan_id,
            allowed_dimensions={"policy": "D61-v1"},
        )
        .on_conflict_do_nothing(index_elements=[AnalyticsEvent.event_key])
    )
