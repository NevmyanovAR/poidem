import hashlib
import hmac
import json
from urllib.parse import urlencode

import pytest
from pydantic import SecretStr

from poidem.api.errors import AppError
from poidem.security.telegram import validate_init_data
from poidem.settings import Settings

TEST_TOKEN = "42:unit-test-only-not-a-real-bot"


def signed_data(user_id=101, timestamp=1700000000, *, token=TEST_TOKEN, **extra):
    fields = {
        "user": json.dumps(
            {"id": user_id, "first_name": "Тест", "username": "test_user"}, ensure_ascii=False
        ),
        "auth_date": str(timestamp),
        "query_id": "synthetic-test-query",
        **extra,
    }
    key = hmac.new(b"WebAppData", token.encode(), hashlib.sha256).digest()
    signature = hmac.new(
        key, "\n".join(f"{k}={fields[k]}" for k in sorted(fields)).encode(), hashlib.sha256
    ).hexdigest()
    return urlencode({**fields, "hash": signature})


@pytest.fixture
def settings():
    return Settings(
        _env_file=None,
        database_url="postgresql+psycopg://test:test@localhost/unit",
        telegram_bot_token=SecretStr(TEST_TOKEN),
    )


def test_signed_unicode_fields_and_third_party_signature_are_covered(settings):
    raw = signed_data(signature="an-independent-ed25519-field")
    user = validate_init_data(raw, settings, now=1700000010)
    assert user.user_id == 101
    assert user.username == "test_user"
    with pytest.raises(AppError):
        validate_init_data(raw.replace("independent", "tampered"), settings, now=1700000010)


@pytest.mark.parametrize(
    "change",
    [
        lambda raw: raw.replace("101", "102"),
        lambda raw: raw + "&user=forged",
        lambda raw: raw + "&auth_date=1700000010",
        lambda raw: raw.replace("hash=", "fake="),
        lambda raw: raw + "&broken=%ZZ",
        lambda raw: "",
    ],
)
def test_tampering_or_ambiguous_query_is_rejected(settings, change):
    with pytest.raises(AppError) as caught:
        validate_init_data(change(signed_data()), settings, now=1700000010)
    assert caught.value.status_code == 401


def test_signature_for_other_bot_is_rejected(settings):
    with pytest.raises(AppError):
        validate_init_data(signed_data(token="999:different-test-token"), settings, now=1700000010)


@pytest.mark.parametrize(
    "age, code", [(301, "TELEGRAM_AUTH_EXPIRED"), (-31, "TELEGRAM_AUTH_INVALID")]
)
def test_old_and_future_auth_date_rejected(settings, age, code):
    with pytest.raises(AppError) as caught:
        validate_init_data(signed_data(), settings, now=1700000000 + age)
    assert caught.value.code == code


@pytest.mark.parametrize("identity", [0, -1, True, "101", 2**53])
def test_signed_id_must_be_valid_telegram_integer(settings, identity):
    with pytest.raises(AppError):
        validate_init_data(signed_data(user_id=identity), settings, now=1700000010)


def test_excessive_init_data_rejected(settings):
    with pytest.raises(AppError):
        validate_init_data("user=" + "a" * 17000, settings)
