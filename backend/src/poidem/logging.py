"""Логи из разрешённых полей: без URL, тел запросов, SQL и текстов исключений."""

import json
import logging
from datetime import UTC, datetime


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        result = {
            "time": datetime.now(UTC).isoformat(),
            "level": record.levelname,
            "event": record.getMessage() if record.name.startswith("poidem") else record.name,
        }
        for name in ("request_id", "method", "route", "status", "duration_ms", "error_type"):
            value = getattr(record, name, None)
            if value is not None:
                result[name] = value
        return json.dumps(result, ensure_ascii=False)


def configure_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    logging.basicConfig(level=level, handlers=[handler], force=True)
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logger = logging.getLogger(name)
        logger.handlers.clear()
        logger.propagate = True
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)
