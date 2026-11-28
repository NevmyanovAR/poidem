import uuid

import pytest
from pydantic import SecretStr, ValidationError

from poidem.settings import Settings


def local_settings(**overrides):
    # Unit defaults must not inherit the live tunnel's Secure cookie / origins
    # when compose supplies those values as process environment variables.
    values = {
        "database_url": "postgresql+psycopg://app:unit-only@127.0.0.1/poidem",
        "app_env": "development",
        "session_cookie_secure": None,
        "session_cookie_samesite": "lax",
        "cors_origins": ["http://localhost:5173"],
        "trusted_hosts": ["localhost"],
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


@pytest.mark.parametrize("url", ["", "sqlite:///test.db", "postgresql://u:p@localhost/db"])
def test_requires_explicit_psycopg_postgresql_url(url):
    with pytest.raises(ValidationError):
        local_settings(database_url=url)


def test_configuration_errors_do_not_expose_input():
    secret = f"never-log-{uuid.uuid4()}"
    with pytest.raises(ValidationError) as caught:
        local_settings(database_url=f"invalid://{secret}")
    assert secret not in str(caught.value)


@pytest.mark.parametrize("origin", ["*", "https://example.org/path", "null", "http://u:p@host"])
def test_cors_only_accepts_exact_origins(origin):
    with pytest.raises(ValidationError):
        local_settings(cors_origins=[origin])


def test_production_refuses_development_defaults():
    with pytest.raises(ValidationError):
        local_settings(app_env="production")
    settings = local_settings(
        app_env="production",
        cors_origins=["https://app.example.org"],
        trusted_hosts=["api.example.org"],
    )
    assert settings.app_env == "production"


@pytest.mark.parametrize("test_database", ["poidem", "other_database", "production"])
def test_database_guard_refuses_non_test_database(test_database):
    settings = local_settings(
        database_url_test=f"postgresql+psycopg://app:unit-only@127.0.0.1/{test_database}",
        migration_database_url_test=f"postgresql+psycopg://owner:unit-only@127.0.0.1/{test_database}",
    )
    with pytest.raises(ValueError):
        settings.test_urls()


def test_database_guard_rejects_same_database_even_on_different_host():
    settings = local_settings(
        database_url="postgresql+psycopg://app:unit-only@localhost/shared_test",
        database_url_test="postgresql+psycopg://app:unit-only@127.0.0.1/shared_test",
        migration_database_url_test="postgresql+psycopg://owner:unit-only@127.0.0.1/shared_test",
    )
    with pytest.raises(ValueError):
        settings.test_urls()


def test_database_guard_rejects_remote_or_mismatched_test_roles():
    settings = local_settings(
        database_url_test="postgresql+psycopg://app:unit-only@remote.example/poidem_test",
        migration_database_url_test="postgresql+psycopg://owner:unit-only@remote.example/poidem_test",
    )
    with pytest.raises(ValueError):
        settings.test_urls()
    settings = local_settings(
        database_url_test="postgresql+psycopg://app:unit-only@localhost/poidem_test",
        migration_database_url_test="postgresql+psycopg://app:unit-only@localhost/poidem_test",
    )
    with pytest.raises(ValueError):
        settings.test_urls()


def test_secret_configuration_is_not_in_repr():
    settings = local_settings(telegram_bot_token="42:synthetic-settings-test-only")
    assert isinstance(settings.database_url, SecretStr)
    assert "unit-only" not in repr(settings)
    assert "synthetic-settings" not in repr(settings)


def test_cookie_security_defaults_and_cross_site_configuration():
    local = local_settings()
    assert not local.secure_cookie
    assert local.cookie_name == "poidem_session"
    with pytest.raises(ValidationError):
        local_settings(session_cookie_samesite="none", session_cookie_secure=False)
    secure = local_settings(session_cookie_samesite="none", session_cookie_secure=True)
    assert secure.cookie_name == "__Host-poidem_session"
    production = dict(
        app_env="production",
        cors_origins=["https://app.example.org"],
        trusted_hosts=["api.example.org"],
    )
    assert local_settings(**production).secure_cookie
    with pytest.raises(ValidationError):
        local_settings(**production, session_cookie_secure=False)
