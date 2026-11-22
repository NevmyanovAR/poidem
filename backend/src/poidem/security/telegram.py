"""HMAC владельца бота, по core.telegram.org/bots/webapps.

Raw initData не сохраняется. Подпись signature для third-party Ed25519 здесь
не используется: для HMAC в data-check-string включаются все поля кроме hash.
"""

import hashlib
import hmac
import json
import re
import time
from dataclasses import dataclass
from urllib.parse import parse_qsl

from poidem.api.errors import AppError
from poidem.settings import Settings


@dataclass(frozen=True)
class TelegramIdentity:
    user_id: int
    username: str | None
    auth_date: int


def invalid() -> AppError:
    return AppError(401, "TELEGRAM_AUTH_INVALID", "Не удалось подтвердить вход через Telegram")


def validate_init_data(raw: str, settings: Settings, *, now: int | None = None) -> TelegramIdentity:
    if not settings.telegram_bot_token:
        raise AppError(503, "TELEGRAM_AUTH_UNAVAILABLE", "Вход через Telegram ещё не настроен")
    if not raw or len(raw.encode("utf-8")) > 16384 or re.search(r"%(?![0-9a-fA-F]{2})", raw):
        raise invalid()
    try:
        pairs = parse_qsl(
            raw,
            keep_blank_values=True,
            strict_parsing=True,
            encoding="utf-8",
            errors="strict",
            max_num_fields=64,
        )
    except (ValueError, UnicodeError):
        raise invalid() from None
    fields = dict(pairs)
    if len(fields) != len(pairs) or any(not re.fullmatch(r"[a-z_]+", key) for key in fields):
        raise invalid()
    received = fields.pop("hash", "")
    if not re.fullmatch(r"[a-fA-F0-9]{64}", received):
        raise invalid()
    check_string = "\n".join(f"{key}={value}" for key, value in sorted(fields.items()))
    secret = hmac.digest(
        b"WebAppData", settings.telegram_bot_token.get_secret_value().encode(), "sha256"
    )
    expected = hmac.new(secret, check_string.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, received.lower()):
        raise invalid()
    try:
        if not re.fullmatch(r"\d{1,12}", fields.get("auth_date", "")):
            raise ValueError
        auth_date = int(fields["auth_date"])
        user = json.loads(fields["user"])
        user_id = user["id"]
        if type(user_id) is not int or not 0 < user_id <= 2**52 - 1:
            raise ValueError
        username = user.get("username")
        if username is not None and (not isinstance(username, str) or len(username) > 64):
            raise ValueError
    except (ValueError, TypeError, KeyError):
        raise invalid() from None
    current = int(time.time()) if now is None else now
    if auth_date > current + settings.auth_clock_skew_seconds:
        raise invalid()
    if current - auth_date > settings.init_data_max_age_seconds:
        raise AppError(
            401, "TELEGRAM_AUTH_EXPIRED", "Вход устарел. Закрой и заново открой Mini App в Telegram"
        )
    return TelegramIdentity(user_id=user_id, username=username, auth_date=auth_date)
