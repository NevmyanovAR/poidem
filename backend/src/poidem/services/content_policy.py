"""Детерминированный публичный снимок правил для мгновенных клиентских подсказок.

Здесь только настройки фильтра, без Settings, сессий, анкет или сетевых вызовов.
JSON включается в frontend заранее: Python в Cloudflare Pages build не требуется.
"""

from poidem.services import content_context, content_language
from poidem.services.content_vocabulary import (
    ENGLISH_WORDS,
    NEUTRAL_LATIN_WORDS,
    POLICY_VERSION,
    RUSSIAN_WORDS,
)


def _table(value: dict[int, str]) -> dict[str, str]:
    return {chr(key): item for key, item in value.items()}


def _js(pattern: str) -> str:
    return (
        pattern.replace(r"[^\W_]", r"[\p{L}\p{N}]")
        .replace(r"\w", r"[\p{L}\p{N}_]")
        .replace("(?P<", "(?<")
        .replace(r"\"", '"')
        .replace(r"\-", "-")
    )


def public_policy() -> dict:
    return {
        "version": POLICY_VERSION,
        "russian": sorted(RUSSIAN_WORDS),
        "english": sorted(ENGLISH_WORDS),
        "neutralLatin": sorted(NEUTRAL_LATIN_WORDS),
        "visual": _table(content_language._VISUAL),
        "digits": _table(content_language._DIGITS),
        "latin": _table(content_language._LATIN),
        "sounds": content_language._SOUNDS,
        "pairs": content_language._PAIRS.pattern,
        "word": _js(content_language._WORD.pattern),
        "termReference": _js(content_language._TERM_REFERENCE.pattern),
        "neutralPrefix": _js(content_context._NEUTRAL_PREFIX.pattern),
        "topicPrefix": _js(content_context._TOPIC_PREFIX.pattern),
        "topicCodes": sorted(content_context._TOPIC_CODES),
        "profanityMessage": "Убери мат и грубые оскорбления из текста плана",
        "context": [
            {
                "code": rule.code,
                "message": rule.message,
                "patterns": [_js(p.pattern) for p in patterns],
            }
            for rule, patterns in content_context._COMPILED
        ],
    }
