"""Подмена только Telegram transport. Сервисы и PostgreSQL настоящие *_test."""

import asyncio
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from aiogram.types import Update
from pydantic import AnyHttpUrl

from poidem.bot import BotHandler
from poidem.db.session import Database
from poidem.notification_worker import NotificationWorker
from poidem.runtime import loop_factory
from poidem.services import plans


@pytest.fixture
def bot_settings(api_settings):
    return api_settings.model_copy(
        update={
            "mini_app_url": AnyHttpUrl("https://miniapp.example.test/"),
            "notifications_enabled": True,
        }
    )


@pytest.fixture
def clock(monkeypatch):
    value = [datetime.now(UTC)]
    monkeypatch.setattr(plans, "now", lambda: value[0])
    return value


class FakeBot:
    id = 42

    def __init__(self):
        self.calls, self.sent, self.errors, self.acks = [], [], [], []
        self.hook = None
        self.edits, self.edit_errors, self.callback_notices = [], [], []

    async def send_message(self, **kwargs):
        self.calls.append(kwargs)
        if self.hook:
            await self.hook()
        if self.errors:
            raise self.errors.pop(0)
        self.sent.append(kwargs)
        return SimpleNamespace(message_id=100 + len(self.calls))

    async def edit_message_text(self, **kwargs):
        self.edits.append(kwargs)
        if self.edit_errors:
            raise self.edit_errors.pop(0)
        return SimpleNamespace(message_id=kwargs["message_id"])

    async def answer_callback_query(self, callback_id, **kwargs):
        self.acks.append(callback_id)
        self.callback_notices.append(kwargs)


def message(update_id, telegram_id=101, text="/start", *, prompt_id=None, chat_type="private"):
    body = {
        "message_id": update_id,
        "date": int(datetime.now(UTC).timestamp()),
        "chat": {"id": telegram_id, "type": chat_type},
        "from": {"id": telegram_id, "is_bot": False, "first_name": "Синтетический участник"},
        "text": text,
    }
    if prompt_id is not None:
        body["reply_to_message"] = {
            "message_id": prompt_id,
            "date": body["date"],
            "chat": body["chat"],
            "from": {"id": 42, "is_bot": True, "first_name": "Тестовый бот"},
            "text": "Тестовый запрос комментария",
        }
    return Update.model_validate({"update_id": update_id, "message": body})


def callback(update_id, telegram_id, data, *, message_id=10, sender_id=42):
    return Update.model_validate(
        {
            "update_id": update_id,
            "callback_query": {
                "id": str(update_id),
                "from": {"id": telegram_id, "is_bot": False, "first_name": "Тест"},
                "chat_instance": "synthetic-only",
                "data": data,
                "message": {
                    "message_id": message_id,
                    "date": int(datetime.now(UTC).timestamp()),
                    "chat": {"id": telegram_id, "type": "private"},
                    "from": {
                        "id": sender_id,
                        "is_bot": sender_id == 42,
                        "first_name": "Тестовый бот",
                    },
                    "text": "Вы встретились?",
                },
            },
        }
    )


def run(settings, operation):
    async def execute():
        database, bot = Database(settings), FakeBot()
        try:
            return await operation(
                database,
                bot,
                BotHandler(database, bot, settings),
                NotificationWorker(database, bot, settings),
            )
        finally:
            await database.close()

    with asyncio.Runner(loop_factory=loop_factory) as runner:
        return runner.run(execute())
