import asyncio
import sys
import uuid
from argparse import Namespace
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from poidem.db.models import Category, Plan, PlanResponse, User
from poidem.main import create_app
from poidem.settings import Settings

BACKEND_ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="session")
def configured_settings():
    settings = Settings()
    # Проверяется до первого подключения или применения миграций.
    settings.test_urls()
    return settings


@pytest.fixture(scope="session")
def migrated_database(configured_settings):
    config = Config(str(BACKEND_ROOT / "alembic.ini"), cmd_opts=Namespace(x=["target=test"]))
    config.attributes["configure_logging"] = False
    # Не create_all: тестируется именно схема, созданная Alembic.
    command.upgrade(config, "head")
    return configured_settings.test_urls()


@pytest.fixture(scope="session")
def runtime_engine(migrated_database):
    engine = create_engine(migrated_database[0], hide_parameters=True)
    yield engine
    engine.dispose()


@pytest.fixture(scope="session")
def migration_engine(migrated_database):
    engine = create_engine(migrated_database[1], hide_parameters=True)
    yield engine
    engine.dispose()


@pytest.fixture
def db(runtime_engine):
    with runtime_engine.connect() as connection:
        transaction = connection.begin()
        with Session(bind=connection, join_transaction_mode="create_savepoint") as session:
            yield session
        transaction.rollback()


@pytest.fixture
def privileged_db(migration_engine):
    with migration_engine.connect() as connection:
        transaction = connection.begin()
        with Session(bind=connection, join_transaction_mode="create_savepoint") as session:
            yield session
        transaction.rollback()


@pytest.fixture
def users(db):
    result = [User(telegram_user_id=uuid.uuid4().int % (2**60) + 1) for _ in range(18)]
    db.add_all(result)
    db.flush()
    return result


@pytest.fixture
def category(migration_engine, db):
    # Справочники изменяет оператор, не runtime-role.
    code = f"test-{uuid.uuid4()}"
    with migration_engine.begin() as connection:
        connection.execute(
            Category.__table__.insert().values(
                code=code, title="Тестовая категория", cover_asset_key="test-cover", enabled=True
            )
        )
    yield code
    # Снять FK-lock незавершённого теста до удаления справочной строки.
    db.rollback()
    with migration_engine.begin() as connection:
        connection.execute(Category.__table__.delete().where(Category.code == code))


@pytest.fixture
def plan(db, users, category):
    result = Plan(
        author_id=users[0].id,
        title="Проверка БД",
        category_code=category,
        starts_at=datetime.now(UTC) + timedelta(days=1),
        time_zone="UTC",
        place="Тестовое место",
        description="Не реальные пользовательские данные",
    )
    db.add(result)
    db.flush()
    return result


@pytest.fixture
def accepted_response(db, users, plan):
    response = PlanResponse(
        plan_id=plan.id,
        plan_author_id=users[0].id,
        responder_id=users[1].id,
        agreed_plan_version=1,
        status="accepted",
        slot_no=1,
        decision_actor_id=users[0].id,
        decided_at=datetime.now(UTC),
    )
    db.add(response)
    db.flush()
    return response


@pytest.fixture
def api_settings(configured_settings, migrated_database, tmp_path):
    return configured_settings.model_copy(
        update={
            "database_url": configured_settings.database_url_test,
            "app_env": "testing",
            "trusted_hosts": ["testserver", "127.0.0.1", "localhost"],
            "cors_origins": ["http://127.0.0.1:5173"],
            "telegram_bot_token": SecretStr("42:unit-test-only-not-a-real-bot"),
            "photo_verification_enabled": False,
            "photo_verification_policy_approved": False,
            "photo_verification_consent_version": "",
            "photo_verification_consent_text": "",
            "photo_verification_pending_hours": None,
            "photo_verification_reviewed_retention_hours": None,
            "places_search_per_minute": 60,
            "places_resolve_per_minute": 30,
            "session_cookie_secure": False,
            "session_cookie_samesite": "lax",
            "media_root": tmp_path / "media",
        }
    )


def make_test_client(app):
    options = {"loop_factory": asyncio.SelectorEventLoop} if sys.platform == "win32" else {}
    return TestClient(app, backend_options=options, raise_server_exceptions=False)


@pytest.fixture
def app(api_settings, migration_engine):
    from place_helpers import FakePlaces

    app = create_app(api_settings)
    # Lifespan не заменяет этот тестовый helper; в runtime его нет.
    app.state.test_places = FakePlaces(migration_engine)
    return app


@pytest.fixture
def client(app):
    with make_test_client(app) as client:
        yield client
