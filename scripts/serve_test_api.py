"""Только для Playwright: синтетическая подпись, отдельная локальная *_test БД.

Не изменяет .env, не слушает публичные интерфейсы и не содержит bypass в API.
"""

import os
import tempfile
from argparse import Namespace
from pathlib import Path

import uvicorn
from alembic import command
from alembic.config import Config
from poidem.db import models  # noqa: F401
from poidem.db.base import Base
from poidem.logging import configure_logging
from poidem.settings import Settings
from sqlalchemy import create_engine, text

root = Path(__file__).resolve().parents[1]
settings = Settings()
runtime, migration = settings.test_urls()  # Проверить до любых изменений окружения.
config = Config(
    str(root / "backend/alembic.ini"), cmd_opts=Namespace(x=["target=test"])
)
command.upgrade(config, "head")


def clear_test_data():
    # URL проверен выше; справочники сохраняются, реальные базы не затрагиваются.
    names = [
        name
        for name in Base.metadata.tables
        if name
        not in {"categories", "interests", "gender_options", "preference_options"}
    ]
    engine = create_engine(migration, hide_parameters=True)
    try:
        with engine.begin() as connection:
            connection.execute(
                text("TRUNCATE " + ",".join(f'"{name}"' for name in names) + " CASCADE")
            )
    finally:
        engine.dispose()


clear_test_data()

with tempfile.TemporaryDirectory(prefix="poidem-browser-test-") as media:
    os.environ.update(
        {
            "DATABASE_URL": runtime.render_as_string(hide_password=False),
            "MIGRATION_DATABASE_URL": migration.render_as_string(hide_password=False),
            "APP_ENV": "testing",
            "TELEGRAM_BOT_TOKEN": "42:unit-test-only-not-a-real-bot",
            "CORS_ORIGINS": '["http://127.0.0.1:4173","http://127.0.0.1:5173"]',
            "TRUSTED_HOSTS": '["127.0.0.1","localhost"]',
            "SESSION_COOKIE_SECURE": "false",
            "SESSION_COOKIE_SAMESITE": "lax",
            "MEDIA_ROOT": media,
        }
    )
    configure_logging()
    try:
        uvicorn.run(
            "poidem.main:create_app",
            factory=True,
            host="127.0.0.1",
            port=8002,
            loop="poidem.runtime:loop_factory",
            access_log=False,
            log_config=None,
            proxy_headers=False,
        )
    finally:
        clear_test_data()
