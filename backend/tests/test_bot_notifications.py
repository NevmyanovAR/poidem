import asyncio
import json
import time
import uuid
from datetime import datetime, timedelta

import pytest
from aiogram.exceptions import (
    TelegramBadRequest,
    TelegramForbiddenError,
    TelegramNetworkError,
    TelegramRetryAfter,
)
from aiogram.methods import SendMessage
from aiogram.types import Update
from bot_helpers import bot_settings as bot_settings
from bot_helpers import clock as clock
from bot_helpers import message, run
from sqlalchemy import func, select, update
from test_accounts import ORIGIN, headers, login, profile, upload
from test_accounts import clients as clients
from test_chat_archive import paired, send
from test_connections import decide, published, respond
from test_plans import members as members
from test_telegram_validation import signed_data

from poidem.db.models import BotBinding, ChatMessage, NotificationJob, PlanResponse, User
from poidem.notification_worker import NotificationWorker, claim
from poidem.services import notifications

pytestmark = pytest.mark.database


def test_start_before_signup_repeated_update_and_no_username_bind_existing_identity(
    clients, bot_settings, migration_engine
):
    async def start(db, bot, handler, worker):
        assert await handler.process(message(1))
        assert await handler.process(message(1))
        assert len(bot.sent) == 1
        assert bot.sent[0]["reply_markup"].inline_keyboard[0][0].web_app.url.startswith("https://")

    run(bot_settings, start)
    with migration_engine.connect() as connection:
        assert connection.scalar(select(func.count()).select_from(User)) == 0
        assert connection.scalar(select(BotBinding.user_id)) is None
    client = clients()
    account = client.post(
        "/api/v1/auth/telegram",
        json={
            "init_data": signed_data(
                101, int(time.time()), user=json.dumps({"id": 101, "first_name": "Тест"})
            )
        },
        headers=ORIGIN,
    ).json()
    with migration_engine.connect() as connection:
        assert connection.scalar(select(BotBinding.user_id)) == uuid.UUID(account["user"]["id"])
        assert connection.scalar(select(User.private_username)) is None

    async def again(db, bot, handler, worker):
        for number, command in [(2, "/notifications_off"), (3, "/start"), (4, "/start")]:
            assert await handler.process(message(number, text=command))
        assert await handler.process(message(5, telegram_id=303, chat_type="group"))

    run(bot_settings, again)
    with migration_engine.connect() as connection:
        assert connection.scalar(select(func.count()).select_from(User)) == 1
        assert connection.scalar(select(func.count()).select_from(BotBinding)) == 1
        assert connection.scalar(select(BotBinding.notifications_enabled)) is False


@pytest.mark.parametrize(
    "kind", ["response_received", "response_accepted", "response_rejected", "response_closed"]
)
def test_real_event_outbox_and_idempotency_all_response_notifications(
    members, clients, bot_settings, migration_engine, clock, kind
):
    (a, aa), (b, bb) = members
    plan = published(members)
    key = uuid.uuid4()
    entry = respond(b, bb, plan, key=key).json()["response"]
    assert respond(b, bb, plan, key=key).status_code == 200
    assert respond(b, bb, plan).status_code == 200
    if kind == "response_closed":
        c = clients()
        cc = login(c, 303)
        photo = upload(c, cc).json()
        assert (
            c.put("/api/v1/me/profile", json=profile(photo), headers=headers(cc)).status_code == 200
        )
        chosen = respond(c, cc, plan).json()["response"]
        assert decide(a, aa, chosen).status_code == 200
    elif kind in ("response_accepted", "response_rejected"):
        operation = "accept" if kind == "response_accepted" else "decline"
        assert decide(a, aa, entry, operation).status_code == 200
        assert decide(a, aa, entry, operation).status_code == 200
    with migration_engine.connect() as connection:
        assert (
            connection.scalar(
                select(func.count())
                .select_from(NotificationJob)
                .where(NotificationJob.kind == kind)
            )
            == 1
        )

    async def deliver(db, bot, handler, worker):
        await handler.process(message(10))
        await handler.process(message(11, 202))
        bot.sent.clear()
        for _ in range(15):
            if not await worker.run_once():
                break
            clock[0] += timedelta(seconds=2)
        expected = 101 if kind == "response_received" else 202
        delivered = [item for item in bot.sent if item["chat_id"] == expected]
        assert len(delivered) == 1
        assert delivered[0]["reply_markup"]
        assert "test_user" not in delivered[0]["text"]

    run(bot_settings, deliver)
    if kind in ("response_rejected", "response_closed"):
        with migration_engine.begin() as connection:
            connection.execute(
                update(NotificationJob)
                .where(NotificationJob.kind == kind)
                .values(state="pending", sent_at=None, telegram_message_id=None)
            )
        clock[0] = datetime.fromisoformat(plan["starts_at"]) + timedelta(days=8)

        async def archived(db, bot, handler, worker):
            for _ in range(5):
                if not await worker.run_once():
                    break
            delivered = [item for item in bot.sent if item["chat_id"] == 202]
            assert len(delivered) == 1
            assert "tab=archive" in delivered[0]["reply_markup"].inline_keyboard[0][0].web_app.url

        run(bot_settings, archived)


def test_missing_contact_opt_out_and_block_updates_suppress_without_retries(
    members, bot_settings, migration_engine, clock
):
    _, (b, bb) = members
    plan = published(members)
    respond(b, bb, plan)

    async def execute(db, bot, handler, worker):
        assert await worker.run_once()  # Без /start не пытается писать на Telegram ID из login.
        assert not bot.calls
        await handler.process(message(1, text="/notifications_off"))
        await handler.process(message(2, text="/start"))
        blocked = Update.model_validate(
            {
                "update_id": 3,
                "my_chat_member": {
                    "chat": {"id": 101, "type": "private"},
                    "from": {"id": 101, "is_bot": False, "first_name": "Тест"},
                    "date": int(time.time()),
                    "old_chat_member": {
                        "status": "member",
                        "user": {"id": 42, "is_bot": True, "first_name": "Бот"},
                    },
                    "new_chat_member": {
                        "status": "kicked",
                        "until_date": 0,
                        "user": {"id": 42, "is_bot": True, "first_name": "Бот"},
                    },
                },
            }
        )
        await handler.process(blocked)

    run(bot_settings, execute)
    with migration_engine.connect() as connection:
        assert connection.scalar(select(NotificationJob.state)) == "suppressed"
        row = connection.execute(
            select(BotBinding.access_state, BotBinding.notifications_enabled)
        ).one()
        assert row.access_state == "denied" and row.notifications_enabled is False


def test_ten_chat_messages_coalesce_and_read_before_delivery_suppresses(
    members, bot_settings, migration_engine, clock
):
    (a, aa), (b, bb) = members
    _, match_id = paired(members)
    with migration_engine.begin() as connection:
        connection.execute(update(NotificationJob).values(state="suppressed"))
    first_key = uuid.uuid4()
    for number in range(10):
        assert (
            send(
                b,
                bb,
                match_id,
                f"Синтетический текст {number}",
                client_id=first_key if number == 0 else None,
            ).status_code
            == 201
        )
    assert send(b, bb, match_id, "Синтетический текст 0", client_id=first_key).status_code == 200
    with migration_engine.connect() as connection:
        assert (
            connection.scalar(
                select(func.count())
                .select_from(NotificationJob)
                .where(NotificationJob.kind == "chat_message")
            )
            == 1
        )

    async def deliver(db, bot, handler, worker):
        await handler.process(message(1))
        bot.calls.clear()
        bot.sent.clear()
        clock[0] += timedelta(seconds=61)
        # Два worker не отправляют один job дважды.
        await asyncio.gather(
            worker.run_once(), NotificationWorker(db, bot, bot_settings).run_once()
        )
        assert len(bot.sent) == 1 and bot.sent[0]["chat_id"] == 101
        assert "Синтетический текст" not in bot.sent[0]["text"]

    run(bot_settings, deliver)
    assert send(b, bb, match_id, "Прочитано до отправки").status_code == 201
    with migration_engine.connect() as connection:
        sequence = connection.scalar(select(func.max(ChatMessage.sequence)))
    assert (
        a.post(
            f"/api/v1/matches/{match_id}/read",
            json={"through_sequence": sequence},
            headers=headers(aa),
        ).status_code
        == 200
    )

    async def suppress(db, bot, handler, worker):
        clock[0] += timedelta(seconds=61)
        assert await worker.run_once()
        assert not bot.sent

    run(bot_settings, suppress)


def test_new_unread_message_after_read_in_same_minute_gets_a_deferred_notification(
    members, bot_settings, migration_engine, clock
):
    (a, aa), (b, bb) = members
    clock[0] = clock[0].replace(second=1, microsecond=0)
    _, match_id = paired(members)
    with migration_engine.begin() as connection:
        connection.execute(update(NotificationJob).values(state="suppressed"))
    assert send(b, bb, match_id, "Первая тестовая реплика").status_code == 201

    async def first(db, bot, handler, worker):
        await handler.process(message(1))
        bot.sent.clear()
        clock[0] += timedelta(seconds=20)
        assert await worker.run_once()
        assert len(bot.sent) == 1

    run(bot_settings, first)
    assert (
        a.post(
            f"/api/v1/matches/{match_id}/read", json={"through_sequence": 1}, headers=headers(aa)
        ).status_code
        == 200
    )
    clock[0] += timedelta(seconds=2)
    assert clock[0].second == 23
    assert send(b, bb, match_id, "Вторая тестовая реплика").status_code == 201
    with migration_engine.connect() as connection:
        assert (
            connection.scalar(
                select(func.count())
                .select_from(NotificationJob)
                .where(NotificationJob.kind == "chat_message")
            )
            == 2
        )

    async def second(db, bot, handler, worker):
        clock[0] += timedelta(seconds=20)
        assert await worker.run_once()  # Отправка отложена до частотного предела.
        assert not bot.sent
        clock[0] += timedelta(seconds=38)
        assert await worker.run_once()
        assert len(bot.sent) == 1
        assert not await worker.run_once()

    run(bot_settings, second)


@pytest.mark.parametrize(
    "failure", ["forbidden", "rate_limit", "network", "bad_request", "timeout"]
)
def test_delivery_failures_keep_domain_data_and_retry_is_bounded(
    members, bot_settings, migration_engine, clock, failure
):
    _, (b, bb) = members
    plan = published(members)
    respond(b, bb, plan)
    method = SendMessage(chat_id=101, text="Синтетика")
    errors = {
        "forbidden": TelegramForbiddenError(method, "test"),
        "rate_limit": TelegramRetryAfter(method, "test", 45),
        "network": TelegramNetworkError(method, "test"),
        "bad_request": TelegramBadRequest(method, "test"),
        "timeout": TimeoutError(),
    }

    async def execute(db, bot, handler, worker):
        await handler.process(message(1))
        bot.calls.clear()
        bot.sent.clear()
        bot.errors = [errors[failure]] * 5
        assert await worker.run_once()
        if failure in ("network", "timeout", "rate_limit"):
            assert not await worker.run_once()
            for _ in range(5):
                clock[0] += timedelta(minutes=6)
                await worker.run_once()

    run(bot_settings, execute)
    with migration_engine.connect() as connection:
        row = connection.execute(select(NotificationJob.state, NotificationJob.attempts)).one()
        assert row.state == ("suppressed" if failure == "forbidden" else "failed")
        assert row.attempts == (1 if failure in ("forbidden", "bad_request") else 5)
        assert connection.scalar(select(func.count()).select_from(PlanResponse)) == 1
        if failure == "forbidden":
            assert connection.scalar(select(BotBinding.access_state)) == "denied"


def test_expired_lease_restart_and_stale_fencing(members, bot_settings, clock, migration_engine):
    _, (b, bb) = members
    respond(b, bb, published(members))

    async def execute(db, bot, handler, worker):
        await handler.process(message(1))
        bot.sent.clear()
        old = await claim(db, bot_settings)
        assert old and not await worker.run_once()
        clock[0] += timedelta(seconds=bot_settings.notification_lease_seconds + 1)
        replacement = await claim(db, bot_settings)
        assert (
            replacement and replacement.identity == old.identity and replacement.owner != old.owner
        )
        assert not await worker.finish(old, "sent", message_id=999)
        assert await worker.deliver(replacement)
        assert len(bot.sent) == 1

    run(bot_settings, execute)
    with migration_engine.connect() as connection:
        assert connection.scalar(select(NotificationJob.state)) == "sent"


def test_worker_cancelled_after_send_keeps_lease_for_restart(
    members, bot_settings, clock, migration_engine
):
    _, (b, bb) = members
    respond(b, bb, published(members))

    async def execute(db, bot, handler, worker):
        await handler.process(message(1))
        bot.calls.clear()

        async def killed():
            raise asyncio.CancelledError

        bot.hook = killed
        with pytest.raises(asyncio.CancelledError):
            await worker.run_once()
        clock[0] += timedelta(seconds=bot_settings.notification_lease_seconds + 1)
        bot.hook = None
        assert await NotificationWorker(db, bot, bot_settings).run_once()
        assert len(bot.calls) == 2  # Возможный внешний повтор честно не скрываем.

    run(bot_settings, execute)
    with migration_engine.connect() as connection:
        assert connection.scalar(select(NotificationJob.state)) == "sent"


def test_opt_out_suppresses_pending_jobs_and_unblock_does_not_enable_preferences(
    members, bot_settings, migration_engine, clock
):
    _, (b, bb) = members
    respond(b, bb, published(members))

    async def execute(db, bot, handler, worker):
        await handler.process(message(1, text="/notifications_off"))
        bot.sent.clear()
        assert await worker.run_once()
        assert not bot.sent
        await handler.process(message(2, text="   "))
        assert "Открой" in bot.sent[-1]["text"]
        async with db.sessions() as session:
            binding = await session.get(BotBinding, 101)
            assert binding.notifications_enabled is False

    run(bot_settings, execute)
    with migration_engine.connect() as connection:
        assert (
            connection.scalar(select(NotificationJob.safe_error_code)) == "notifications_disabled"
        )


def test_notification_outbox_rolls_back_with_domain_write(members, monkeypatch, migration_engine):
    (a, aa), (b, bb) = members
    plan = published(members)

    async def failing(*args, **kwargs):
        raise RuntimeError("synthetic queue failure")

    monkeypatch.setattr(notifications, "enqueue", failing)
    assert respond(b, bb, plan).status_code == 500
    with migration_engine.connect() as connection:
        assert connection.scalar(select(func.count()).select_from(PlanResponse)) == 0
        assert connection.scalar(select(func.count()).select_from(NotificationJob)) == 0
    assert a.get(f"/api/v1/plans/{plan['id']}").status_code == 200


def test_wrong_recipient_never_receives_a_foreign_response_notification(
    members, clients, bot_settings, migration_engine
):
    _, (b, bb) = members
    entry = respond(b, bb, published(members))
    assert entry.status_code == 201
    outsider = login(clients(), 303)
    with migration_engine.begin() as connection:
        connection.execute(
            update(NotificationJob).values(recipient_id=uuid.UUID(outsider["user"]["id"]))
        )

    async def execute(db, bot, handler, worker):
        await handler.process(message(1, 303))
        bot.sent.clear()
        assert await worker.run_once()
        assert not bot.sent

    run(bot_settings, execute)
    with migration_engine.connect() as connection:
        assert connection.scalar(select(NotificationJob.state)) == "suppressed"
