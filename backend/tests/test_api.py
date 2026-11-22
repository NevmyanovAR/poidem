import logging
import uuid

import pytest
from conftest import make_test_client
from pydantic import BaseModel, ConfigDict, Field, SecretStr
from sqlalchemy import text

from poidem.db.models import Interest
from poidem.main import create_app

pytestmark = pytest.mark.database


@pytest.mark.parametrize("path", ["/health", "/health/live", "/health/ready"])
def test_health_uses_migrated_postgresql(client, path):
    response = client.get(path)
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert uuid.UUID(response.headers["X-Request-ID"])
    assert response.headers["Cache-Control"] == "no-store"


def test_openapi_only_exposes_own_profile_not_arbitrary_users(client):
    schema = client.get("/openapi.json").json()
    assert "/api/v1/me/profile" in schema["paths"]
    assert "/api/v1/users" not in schema["paths"]


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/users",
        "/api/v1/plans",
        "/api/v1/admin/users",
        "/api/v1/matches",
    ],
)
def test_no_public_personal_write_routes(client, path):
    response = client.post(
        path,
        json={"telegram_user_id": 123, "role": "admin"},
        headers={
            "X-Telegram-User-Id": "123",
            "Cookie": "poidem_session=forged",
        },
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "RESOURCE_NOT_FOUND"


def test_unknown_path_and_method_have_safe_json_errors(client):
    response = client.get("/unknown/private-value?token=private-value")
    assert response.status_code == 404
    assert "private-value" not in response.text
    response = client.post("/health")
    assert response.status_code == 405
    assert response.json()["error"]["code"] == "METHOD_NOT_ALLOWED"


def test_cors_allows_only_configured_origins(client):
    headers = {"Origin": "http://127.0.0.1:5173", "Access-Control-Request-Method": "GET"}
    response = client.options("/api/v1/reference-data", headers=headers)
    assert response.status_code == 200
    assert response.headers["Access-Control-Allow-Origin"] == headers["Origin"]
    assert response.headers["Access-Control-Allow-Credentials"] == "true"
    rejected = client.options(
        "/api/v1/reference-data",
        headers={
            **headers,
            "Origin": "https://untrusted.example",
        },
    )
    assert rejected.status_code == 400
    assert "Access-Control-Allow-Origin" not in rejected.headers


def test_invalid_host_has_safe_error(client):
    response = client.get("/health/live", headers={"Host": "untrusted.example"})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "INVALID_HOST"


def test_stale_revision_is_not_ready(client, app):
    app.state.migration_heads = {"not-current"}
    response = client.get("/health")
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "MIGRATIONS_REQUIRED"
    assert client.get("/health/live").status_code == 200


def test_unavailable_database_does_not_expose_connection_string(api_settings):
    invalid_url = "postgresql+psycopg://nobody:never-expose-this@127.0.0.1:1/poidem_test"
    settings = api_settings.model_copy(
        update={
            "database_url": SecretStr(invalid_url),
            "db_connect_timeout_seconds": 1,
        }
    )
    with make_test_client(create_app(settings)) as client:
        assert client.get("/health/live").status_code == 200
        response = client.get("/health")
    assert response.status_code == 503
    assert "never-expose-this" not in response.text
    assert "psycopg" not in response.text


def test_validation_and_unexpected_errors_are_sanitized(app):
    class Input(BaseModel):
        model_config = ConfigDict(extra="forbid")
        age: int = Field(strict=True, ge=18)

    @app.post("/_test/validation")
    async def validation(payload: Input):
        return payload

    @app.get("/_test/failure")
    async def failure():
        raise RuntimeError("private-token-and-user-data")

    with make_test_client(app) as client:
        response = client.post("/_test/validation", json={"age": "private-token-and-user-data"})
        assert response.status_code == 422
        assert "private-token-and-user-data" not in response.text
        failed = client.get("/_test/failure", headers={"Origin": "http://127.0.0.1:5173"})
    assert failed.status_code == 500
    assert failed.json()["error"]["code"] == "INTERNAL_ERROR"
    assert "private-token-and-user-data" not in failed.text
    assert failed.headers["Access-Control-Allow-Origin"] == "http://127.0.0.1:5173"
    assert failed.headers["X-Request-ID"] == failed.json()["error"]["request_id"]


def test_request_logs_do_not_contain_raw_path_query_or_untrusted_request_id(client, caplog):
    with caplog.at_level(logging.INFO, logger="poidem.requests"):
        client.get("/private-path?token=private-query", headers={"X-Request-ID": "private-id"})
    records = [record for record in caplog.records if record.name == "poidem.requests"]
    assert records
    assert records[-1].route == "unmatched"
    assert records[-1].request_id != "private-id"
    assert "private-query" not in records[-1].getMessage()


def test_reference_data_is_read_only_and_excludes_disabled_rows(client, migration_engine):
    code = str(uuid.uuid4())
    with migration_engine.begin() as connection:
        connection.execute(
            Interest.__table__.insert(),
            [
                {"code": f"{code}-on", "title": "Проверка", "enabled": True},
                {"code": f"{code}-off", "title": "Скрыто", "enabled": False},
            ],
        )
    try:
        response = client.get("/api/v1/reference-data")
        assert response.status_code == 200
        codes = {item["code"] for item in response.json()["interests"]}
        assert f"{code}-on" in codes
        assert f"{code}-off" not in codes
        assert response.json()["business_operations_enabled"] is False
        assert client.post("/api/v1/reference-data", json={}).status_code == 405
    finally:
        with migration_engine.begin() as connection:
            connection.execute(
                Interest.__table__.delete().where(Interest.code.in_([f"{code}-on", f"{code}-off"]))
            )


def test_health_does_not_publish_personal_data(client, migration_engine):
    with migration_engine.connect() as connection:
        assert connection.scalar(text("SELECT current_database()")) == "poidem_test"
    response = client.get("/health")
    assert set(response.json()) == {"status", "database", "migrations"}
