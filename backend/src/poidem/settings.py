"""Конфигурация без секретов в исходниках и сообщениях об ошибках."""

import os
from pathlib import Path
from typing import Literal, Self
from urllib.parse import urlsplit

from pydantic import AnyHttpUrl, Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import URL, make_url

REPOSITORY_ROOT = Path(os.environ.get("POIDEM_ROOT", Path(__file__).resolve().parents[3]))


def postgres_url(value: SecretStr) -> SecretStr:
    try:
        url = make_url(value.get_secret_value())
        valid = url.drivername == "postgresql+psycopg" and bool(
            url.host and url.database and url.username and url.password
        )
    except Exception:
        valid = False
    if not valid:
        raise ValueError("Нужен полный PostgreSQL URL с драйвером postgresql+psycopg")
    return value


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=REPOSITORY_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
        hide_input_in_errors=True,
    )

    app_env: Literal["development", "testing", "production"] = "development"
    database_url: SecretStr = Field(repr=False)
    migration_database_url: SecretStr | None = Field(default=None, repr=False)
    database_url_test: SecretStr | None = Field(default=None, repr=False)
    migration_database_url_test: SecretStr | None = Field(default=None, repr=False)
    cors_origins: list[str] = Field(
        default_factory=lambda: [
            "http://127.0.0.1:5173",
            "http://localhost:5173",
            "http://127.0.0.1:4173",
            "http://localhost:4173",
        ]
    )
    trusted_hosts: list[str] = Field(default_factory=lambda: ["localhost", "127.0.0.1"])
    db_connect_timeout_seconds: int = Field(default=5, ge=1, le=30)
    db_statement_timeout_ms: int = Field(default=5000, ge=100, le=60000)
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    telegram_bot_token: SecretStr | None = Field(default=None, repr=False)
    init_data_max_age_seconds: int = Field(default=300, ge=30, le=3600)
    auth_clock_skew_seconds: int = Field(default=30, ge=0, le=120)
    session_ttl_seconds: int = Field(default=86400, ge=300, le=2592000)
    session_cookie_secure: bool | None = None
    session_cookie_samesite: Literal["lax", "strict", "none"] = "lax"
    mini_app_url: AnyHttpUrl | None = None
    api_public_url: AnyHttpUrl | None = None
    media_root: Path = REPOSITORY_ROOT / "uploads" / "profiles"
    photo_max_bytes: int = Field(default=3 * 1024 * 1024, ge=1024, le=10 * 1024 * 1024)
    photo_max_pixels: int = Field(default=16_000_000, ge=1, le=25_000_000)
    photo_max_edge: int = Field(default=2048, ge=128, le=4096)
    login_requests_per_minute: int = Field(default=30, ge=1, le=120)
    photo_requests_per_minute: int = Field(default=10, ge=1, le=60)
    chat_messages_per_minute: int = Field(default=30, ge=1, le=120)
    telegram_bot_username: str = "ShallWeGoo_bot"
    notifications_enabled: bool = True
    photo_verification_enabled: bool = False
    photo_verification_policy_approved: bool = False
    photo_verification_consent_version: str = ""
    photo_verification_consent_text: str = ""
    photo_verification_pending_hours: int | None = Field(default=None, ge=1, le=336)
    photo_verification_reviewed_retention_hours: int | None = Field(default=None, ge=0, le=168)
    photo_verification_challenge_seconds: int = Field(default=600, ge=60, le=1800)
    photo_verification_attempts_per_day: int = Field(default=3, ge=1, le=20)
    positive_impressions_threshold: int = Field(default=3, ge=1, le=100)
    places_search_per_minute: int = Field(default=20, ge=1, le=60)
    places_resolve_per_minute: int = Field(default=10, ge=1, le=30)
    notification_max_attempts: int = Field(default=5, ge=1, le=10)
    notification_lease_seconds: int = Field(default=90, ge=60, le=300)
    telegram_request_timeout_seconds: int = Field(default=10, ge=3, le=30)
    chat_notification_window_seconds: int = Field(default=60, ge=30, le=600)

    @field_validator("telegram_bot_username")
    @classmethod
    def bot_username(cls, value):
        import re

        if not re.fullmatch(r"[A-Za-z0-9_]{5,32}", value):
            raise ValueError("Некорректный username бота")
        return value

    @field_validator("telegram_bot_token", mode="before")
    @classmethod
    def blank_token(cls, value):
        return None if value == "" else value

    @field_validator("mini_app_url", "api_public_url", mode="before")
    @classmethod
    def blank_address(cls, value):
        return None if value == "" else value

    @field_validator(
        "session_cookie_secure",
        "photo_verification_pending_hours",
        "photo_verification_reviewed_retention_hours",
        mode="before",
    )
    @classmethod
    def blank_secure(cls, value):
        return None if value == "" else value

    @field_validator("media_root")
    @classmethod
    def absolute_media_root(cls, value: Path) -> Path:
        return value.resolve() if value.is_absolute() else (REPOSITORY_ROOT / value).resolve()

    @property
    def secure_cookie(self) -> bool:
        return (
            self.app_env == "production"
            if self.session_cookie_secure is None
            else self.session_cookie_secure
        )

    @property
    def cookie_name(self) -> str:
        return "__Host-poidem_session" if self.secure_cookie else "poidem_session"

    @field_validator(
        "database_url",
        "migration_database_url",
        "database_url_test",
        "migration_database_url_test",
    )
    @classmethod
    def validate_database_url(cls, value: SecretStr | None) -> SecretStr | None:
        return postgres_url(value) if value is not None else None

    @field_validator("cors_origins")
    @classmethod
    def exact_origins(cls, values: list[str]) -> list[str]:
        for value in values:
            parsed = urlsplit(value)
            if (
                parsed.scheme not in {"http", "https"}
                or not parsed.hostname
                or parsed.path
                or parsed.query
                or parsed.fragment
                or parsed.username
                or parsed.password
                or "*" in value
            ):
                raise ValueError("CORS origin должен быть точным адресом без пути или wildcard")
        return list(dict.fromkeys(values))

    @field_validator("trusted_hosts")
    @classmethod
    def exact_hosts(cls, values: list[str]) -> list[str]:
        if not values or any(
            not value or any(char in value for char in "*/:?@ #\\") for value in values
        ):
            raise ValueError("Укажите точные имена разрешённых хостов")
        return list(dict.fromkeys(values))

    @model_validator(mode="after")
    def production_configuration(self) -> Self:
        if self.session_cookie_samesite == "none" and not self.secure_cookie:
            raise ValueError("SameSite=None требует Secure cookie")
        if self.app_env == "production":
            if not self.secure_cookie:
                raise ValueError("Production требует Secure cookie")
            if not self.cors_origins or any(
                urlsplit(origin).scheme != "https"
                or urlsplit(origin).hostname in {"localhost", "127.0.0.1", "::1"}
                for origin in self.cors_origins
            ):
                raise ValueError("Production требует явно заданные HTTPS origins")
            if any(host in {"localhost", "127.0.0.1", "testserver"} for host in self.trusted_hosts):
                raise ValueError("Production требует явно заданные публичные trusted hosts")
        return self

    def test_urls(self) -> tuple[URL, URL]:
        """Защита от случайного запуска интеграционных тестов на основной БД."""
        if not self.database_url_test or not self.migration_database_url_test:
            raise ValueError("Нужны DATABASE_URL_TEST и MIGRATION_DATABASE_URL_TEST")
        runtime = make_url(self.database_url_test.get_secret_value())
        migration = make_url(self.migration_database_url_test.get_secret_value())
        primary = make_url(self.database_url.get_secret_value())
        primary_migration = (
            make_url(self.migration_database_url.get_secret_value())
            if self.migration_database_url
            else primary
        )
        for url in (runtime, migration):
            if (
                not url.database
                or not url.database.endswith("_test")
                or url.database in {primary.database, primary_migration.database}
                or url.host not in {"127.0.0.1", "localhost", "db-test"}
            ):
                raise ValueError("Тесты разрешены только на отдельной локальной БД *_test")
        if (runtime.host, runtime.port, runtime.database) != (
            migration.host,
            migration.port,
            migration.database,
        ):
            raise ValueError("Обе тестовые роли должны подключаться к одной тестовой БД")
        if runtime.username == migration.username:
            raise ValueError("Тесты требуют разные runtime и migration роли")
        return runtime, migration


def load_settings() -> Settings:
    # Содержимое ValidationError конфигурации не попадает в startup log.
    try:
        return Settings()
    except Exception:
        raise RuntimeError("Некорректная конфигурация backend; проверьте .env по README") from None
