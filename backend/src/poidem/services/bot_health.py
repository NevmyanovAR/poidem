"""Heartbeat отдельных живых циклов, а не доказательство по старой доставке."""

from datetime import UTC, datetime

from sqlalchemy.dialects.postgresql import insert

from poidem.db.models import BotHeartbeat


async def beat(database, component, state="ok"):
    async with database.sessions() as session:
        await session.execute(
            insert(BotHeartbeat)
            .values(component=component, last_seen_at=datetime.now(UTC), state=state)
            .on_conflict_do_update(
                index_elements=[BotHeartbeat.component],
                set_={"last_seen_at": datetime.now(UTC), "state": state},
            )
        )
        await session.commit()


def status(row, at):
    if row is None:
        return {"state": "unknown", "label": "Нет данных", "last_seen_at": None}
    age = (at - row.last_seen_at).total_seconds()
    state = "stale" if age > 60 or age < -5 else row.state
    return {
        "state": state,
        "label": {
            "ok": "Работает",
            "error": "Ошибка цикла",
            "stopped": "Остановлен",
            "stale": "Нет свежего сигнала",
        }.get(state, "Нет данных"),
        "last_seen_at": row.last_seen_at,
    }
