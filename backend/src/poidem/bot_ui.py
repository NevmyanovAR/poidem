"""Только представление бота: короткие HTML-тексты и стандартные inline-кнопки."""

from html import escape
from urllib.parse import urljoin, urlsplit

from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo


def text_message(title, *lines):
    # Разметка только наша; пользовательские имена/названия всегда обычный текст.
    body = "\n".join(escape(str(line), quote=False) for line in lines if line)
    return f"<b>{escape(title, quote=False)}</b>" + (f"\n\n{body}" if body else "")


def short_text(value):
    return " ".join(value.split())[:120] if isinstance(value, str) else ""


def app_url(settings, route=""):
    base = str(settings.mini_app_url or "")
    parsed = urlsplit(base)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("Для кнопки бота требуется MINI_APP_URL с HTTPS без query/fragment")
    return urljoin(base.rstrip("/") + "/", route.lstrip("/"))


def open_app(settings, route="", label="Открыть «Пойдём?»"):
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text=label, web_app=WebAppInfo(url=app_url(settings, route)))]
        ]
    )


def welcome(settings, registered):
    markup = open_app(settings, "home" if registered else "profile")
    markup.inline_keyboard.append(
        [InlineKeyboardButton(text="Уведомления", callback_data="notify:settings")]
    )
    return text_message(
        "Пойдём?",
        "Твои планы и знакомства — в одном месте"
        if registered
        else "Знакомства начинаются с совместных планов",
        "Открой приложение и выбери, куда пойти"
        if registered
        else "Заполни анкету и найди свой план",
    ), markup


def notification_settings(settings, enabled, registered=False):
    label = "Выключить уведомления" if enabled else "Включить уведомления"
    action = "notify:off" if enabled else "notify:on"
    markup = InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text=label, callback_data=action)],
            open_app(settings, "home" if registered else "profile").inline_keyboard[0],
        ]
    )
    return text_message(
        "Уведомления включены" if enabled else "Уведомления выключены",
        "Отклики, мэтчи и новые сообщения будут приходить сюда"
        if enabled
        else "Все события сохраняются в приложении",
    ), markup


def response_message(kind, context, live_title=""):
    context = context or {}
    # Для отказа/closed только разрешённый снимок D51, без восстановления живой анкеты.
    historical = kind in ("response_rejected", "response_closed")
    title = short_text(context.get("plan_title")) or ("" if historical else short_text(live_title))
    plan = f"План «{title}»" if title else "Твой отклик"
    if kind == "response_received":
        name = short_text(context.get("responder_name"))
        return text_message(
            "Новый отклик",
            plan,
            f"{name} хочет пойти с тобой" if name else "Кто-то хочет пойти с тобой",
        )
    if kind == "response_accepted":
        name = short_text(context.get("author_name"))
        return text_message(
            "У вас мэтч",
            plan,
            f"{name} тоже хочет пойти с тобой" if name else "Вы выбрали друг друга",
        )
    if kind == "response_rejected":
        return text_message("Отклик не принят", plan, "Можно выбрать другой план")
    return text_message("Пара уже выбрана", plan, "Твой отклик закрыт — другие планы доступны")


def chat_message(title):
    plan = short_text(title)
    return text_message(
        "Новые сообщения",
        f"В чате плана «{plan}»" if plan else "В вашем чате",
        "Открой переписку, чтобы ответить",
    )
