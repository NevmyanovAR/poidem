import uuid
from datetime import datetime, timedelta
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit

import pytest
from aiogram.exceptions import (
    TelegramBadRequest,
    TelegramForbiddenError,
    TelegramNetworkError,
    TelegramRetryAfter,
)
from aiogram.methods import EditMessageText
from bot_helpers import bot_settings as bot_settings
from bot_helpers import callback, message, run
from sqlalchemy import update
from test_accounts import clients as clients
from test_accounts import headers, login
from test_connections import decide, published, respond
from test_plans import members as members

from poidem.bot_ui import chat_message, notification_settings, response_message, welcome
from poidem.db.models import BotBinding, TelegramUpdate, User
from poidem.services import plans

pytestmark = pytest.mark.database


@pytest.mark.parametrize(
    "kind",
    [
        "response_received",
        "response_accepted",
        "response_rejected",
        "response_closed",
        "chat_message",
    ],
)
def test_html_messages_are_short_escape_user_text_and_have_no_commands(kind):
    title, name = 'Галерея <a href="https://invalid.test">&</a>', "Аня <b>&</b>"
    context = {"plan_title": title, "author_name": name, "responder_name": name}
    text = chat_message(title) if kind == "chat_message" else response_message(kind, context)
    assert text.startswith("<b>") and text.count("<b>") == 1
    assert "&lt;a" in text and "<a " not in text
    assert "<b>&</b>" not in text and "/notifications" not in text
    assert len([line for line in text.splitlines() if line]) <= 3
    if kind in ("response_rejected", "response_closed"):
        assert "Живое закрытое название" not in response_message(
            kind, None, "Живое закрытое название"
        )


def test_start_and_settings_templates_need_no_username_or_system_styling():
    settings = SimpleNamespace(mini_app_url="https://miniapp.example.test/")
    for ready, route in ((False, "/profile"), (True, "/home")):
        text, markup = welcome(settings, ready)
        assert len(markup.inline_keyboard) == 2
        assert urlsplit(markup.inline_keyboard[0][0].web_app.url).path == route
        assert markup.inline_keyboard[1][0].callback_data == "notify:settings"
        assert "/notifications" not in text
    for enabled, action in ((True, "notify:off"), (False, "notify:on")):
        text, markup = notification_settings(settings, enabled)
        assert markup.inline_keyboard[0][0].callback_data == action
        assert "/notifications" not in text and "username" not in text


def test_settings_edit_same_message_and_repeated_target_is_idempotent(
    members, bot_settings, migration_engine
):
    with migration_engine.begin() as connection:
        connection.execute(update(User).values(private_username=None))

    async def execute(db, bot, handler, worker):
        await handler.process(message(1))
        assert "/home" in bot.sent[0]["reply_markup"].inline_keyboard[0][0].web_app.url
        assert bot.sent[0]["parse_mode"] == "HTML"
        await handler.process(callback(2, 101, "notify:settings", message_id=101))
        await handler.process(callback(3, 101, "notify:off", message_id=101))
        method = EditMessageText(chat_id=101, message_id=101, text="test")
        bot.edit_errors = [TelegramBadRequest(method, "Bad Request: message is not modified")]
        await handler.process(callback(4, 101, "notify:off", message_id=101))
        assert len(bot.sent) == 1 and len(bot.edits) == 3
        assert {item["message_id"] for item in bot.edits} == {101}
        assert not bot.callback_notices[-1]["show_alert"]
        await handler.process(callback(3, 101, "notify:off", message_id=101))
        assert len(bot.edits) == 3  # Уже обработанный update не повторяет edit.
        async with db.sessions() as session:
            assert (await session.get(BotBinding, 101)).notifications_enabled is False
        await handler.process(callback(5, 101, "notify:on", message_id=101))
        assert len(bot.sent) == 1
        assert bot.edits[-1]["reply_markup"].inline_keyboard[0][0].callback_data == "notify:off"
        assert bot.edits[-1]["reply_markup"].inline_keyboard[1][0].web_app.url.endswith("/home")
        assert bot.edits[-1]["link_preview_options"].is_disabled
        for number, command in ((6, "/notifications_off"), (7, "/notifications_on")):
            await handler.process(message(number, text=command))
        assert all("/notifications" not in entry["text"] for entry in bot.sent + bot.edits)
        async with db.sessions() as session:
            assert (await session.get(BotBinding, 101)).notifications_enabled is True

    run(bot_settings, execute)


@pytest.mark.parametrize("failure", ["missing", "forbidden", "network", "rate_limit"])
def test_settings_api_errors_do_not_create_messages_or_reverse_preference(
    members, bot_settings, failure
):
    method = EditMessageText(chat_id=101, message_id=101, text="test")
    failures = {
        "missing": TelegramBadRequest(method, "Bad Request: message to edit not found"),
        "forbidden": TelegramForbiddenError(method, "test"),
        "network": TelegramNetworkError(method, "test"),
        "rate_limit": TelegramRetryAfter(method, "test", 2),
    }

    async def execute(db, bot, handler, worker):
        await handler.process(message(1, text="/notifications"))
        event = callback(2, 101, "notify:off", message_id=101)
        bot.edit_errors = [failures[failure]]
        if failure in ("network", "rate_limit"):
            with pytest.raises(type(failures[failure])):
                await handler.process(event)
            async with db.sessions() as session:
                assert (await session.get(BotBinding, 101)).notifications_enabled is False
            await handler.process(event)
            assert len(bot.edits) == 2
        else:
            await handler.process(event)
        assert len(bot.sent) == 1
        async with db.sessions() as session:
            binding = await session.get(BotBinding, 101)
            assert binding.notifications_enabled is False
            if failure == "forbidden":
                assert binding.access_state == "denied"
            if failure == "missing":
                assert (await session.get(TelegramUpdate, ("telegram:42", 2))).state == "failed"
                assert "Настройка сохранена" in bot.callback_notices[-1]["text"]

    run(bot_settings, execute)


def test_forwarded_or_unknown_settings_button_cannot_change_preferences(members, bot_settings):
    async def execute(db, bot, handler, worker):
        await handler.process(message(1))
        await handler.process(callback(2, 202, "notify:off", sender_id=303))
        await handler.process(callback(3, 101, "notify:flip"))
        assert len(bot.sent) == 1 and not bot.edits
        assert bot.callback_notices[-1]["show_alert"]
        async with db.sessions() as session:
            assert (await session.get(BotBinding, 101)).notifications_enabled is True
            assert await session.get(BotBinding, 202) is None

    run(bot_settings, execute)


def test_notification_links_and_context_open_permitted_destination(members, bot_settings):
    (a, aa), (b, bb) = members
    plan = published(members)
    response = respond(b, bb, plan).json()["response"]

    async def received(db, bot, handler, worker):
        await handler.process(message(1))
        bot.sent.clear()
        await worker.run_once()
        notice = bot.sent[0]
        assert notice["text"].startswith("<b>Новый отклик</b>")
        assert plan["title"] in notice["text"] and "Проверка" in notice["text"]
        assert len(notice["reply_markup"].inline_keyboard) == 1
        url = urlsplit(notice["reply_markup"].inline_keyboard[0][0].web_app.url)
        assert url.path == "/plans" and parse_qs(url.query) == {
            "tab": ["incoming"],
            "plan": [plan["id"]],
        }
        assert notice["parse_mode"] == "HTML" and notice["link_preview_options"].is_disabled

    run(bot_settings, received)
    assert decide(a, aa, response, "decline").status_code == 200

    async def rejected(db, bot, handler, worker):
        await handler.process(message(2, 202))
        bot.sent.clear()
        await worker.run_once()
        notice = bot.sent[0]
        assert plan["title"] in notice["text"]
        url = urlsplit(notice["reply_markup"].inline_keyboard[0][0].web_app.url)
        assert parse_qs(url.query) == {"tab": ["outgoing"], "plan": [plan["id"]]}
        assert "/people/" not in url.path

    run(bot_settings, rejected)


def test_activity_plan_deep_link_keeps_pagination_and_private_archive_rules(
    members, clients, monkeypatch
):
    (a, aa), (b, bb) = members
    first, second = published(members), published(members)
    one = respond(b, bb, first).json()["response"]
    respond(b, bb, second)
    endpoint = "/api/v1/me/activity"
    page = a.get(endpoint, params={"plan_id": second["id"], "limit": 1}).json()
    assert page["next_cursor"]
    assert (
        a.get(endpoint, params={"plan_id": second["id"], "cursor": page["next_cursor"]}).status_code
        == 200
    )
    assert (
        a.get(endpoint, params={"plan_id": first["id"], "cursor": page["next_cursor"]}).status_code
        == 422
    )
    assert a.get(endpoint, params={"cursor": page["next_cursor"]}).status_code == 422
    assert decide(a, aa, one, "decline").status_code == 200
    monkeypatch.setattr(
        plans, "now", lambda: datetime.fromisoformat(first["starts_at"]) + timedelta(days=8)
    )
    params = {"scope": "archive", "plan_id": first["id"]}
    for client in (a, b):
        items = client.get(endpoint, params=params).json()["items"]
        assert len(items) == 1 and items[0]["plan_id"] == first["id"]
    outsider = clients()
    login(outsider, 303)
    assert outsider.get(endpoint, params=params).json()["items"] == []
    assert clients().get(endpoint, params=params).status_code == 401
    assert (
        b.post(
            f"/api/v1/me/archive/{first['id']}/visibility",
            json={"hidden": True},
            headers=headers(bb),
        ).status_code
        == 204
    )
    assert b.get(endpoint, params=params).json()["items"] == []
    assert len(b.get(endpoint, params={**params, "include_hidden": True}).json()["items"]) == 1
    assert b.get(endpoint, params={"plan_id": str(uuid.uuid4())}).json()["items"] == []
