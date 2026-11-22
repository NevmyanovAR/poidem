"""Alembic работает синхронно и только под migration-role."""

from alembic import context
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.pool import NullPool

from poidem.db import models  # noqa: F401 — регистрирует всю metadata
from poidem.db.base import Base
from poidem.logging import configure_logging
from poidem.settings import load_settings

config = context.config
target_metadata = Base.metadata
settings = load_settings()
if config.attributes.get("configure_logging", True):
    configure_logging(settings.log_level)

target = context.get_x_argument(as_dictionary=True).get("target", "main")
if target == "test":
    _, migration_url = settings.test_urls()
elif target == "main" and settings.migration_database_url:
    migration_url = make_url(settings.migration_database_url.get_secret_value())
    runtime_url = make_url(settings.database_url.get_secret_value())
    if migration_url.username == runtime_url.username:
        raise RuntimeError("API и Alembic должны использовать разные роли PostgreSQL")
    if (migration_url.host, migration_url.port, migration_url.database) != (
        runtime_url.host,
        runtime_url.port,
        runtime_url.database,
    ):
        raise RuntimeError("API и Alembic должны указывать на одну основную БД")
else:
    raise RuntimeError("Нужен MIGRATION_DATABASE_URL; target может быть только main или test")


def offline() -> None:
    context.configure(
        url=migration_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def online() -> None:
    engine = create_engine(migration_url, poolclass=NullPool, hide_parameters=True)
    try:
        with engine.connect() as connection:
            context.configure(
                connection=connection, target_metadata=target_metadata, compare_type=True
            )
            with context.begin_transaction():
                context.run_migrations()
    finally:
        engine.dispose()


if context.is_offline_mode():
    offline()
else:
    online()
