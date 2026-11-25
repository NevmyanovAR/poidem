"""Один локальный процесс: aiogram Bot API polling и PostgreSQL outbox worker."""

import argparse
import asyncio
import logging
from contextlib import suppress
from dataclasses import dataclass

from aiogram import Bot
from aiogram.client.session.aiohttp import AiohttpSession
from aiogram.exceptions import (
    TelegramBadRequest,
    TelegramConflictError,
    TelegramForbiddenError,
    TelegramNetworkError,
    TelegramRetryAfter,
    TelegramServerError,
    TelegramUnauthorizedError,
)
from aiogram.types import BotCommand, ForceReply, LinkPreviewOptions, Message
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert

from poidem.api.errors import AppError
from poidem.api.routers.health import migration_heads
from poidem.bot_ui import app_url, notification_settings, text_message, welcome
from poidem.db.locks import advisory_lock
from poidem.db.models import BotBinding, Profile, SurveyRecipient, TelegramUpdate
from poidem.db.session import Database
from poidem.logging import configure_logging
from poidem.notification_worker import NotificationWorker
from poidem.runtime import loop_factory
from poidem.services import bot_bindings, plans, surveys
from poidem.settings import load_settings

logger = logging.getLogger("poidem.bot")


class BotSetupError(Exception):
    def __init__(self, code):
        self.code = code


@dataclass
class BotReply:
    chat_id: int
    text: str
    markup: object = None
    prompt: tuple | None = None
    edit_message_id: int | None = None


class BotHandler:
    def __init__(self, database, bot, settings):
        self.database, self.bot, self.settings = database, bot, settings
        self.bot_key = f"telegram:{bot.id}"

    async def mark(self, update_id, state):
        async with self.database.sessions() as session:
            await session.execute(
                update(TelegramUpdate)
                .where(
                    TelegramUpdate.bot_key == self.bot_key,
                    TelegramUpdate.update_id == update_id,
                )
                .values(state=state, processed_at=plans.now())
            )
            await session.commit()

    async def prepare(self, session, event):
        change = event.my_chat_member
        if change:
            if change.chat.type != "private":
                return None
            binding = await session.scalar(
                select(BotBinding).where(BotBinding.private_chat_id == change.chat.id)
            )
            if binding:
                # Unblock не снимает пользовательский отказ от уведомлений.
                binding.access_state = (
                    "denied" if change.new_chat_member.status in ("kicked", "left") else "allowed"
                )
                binding.last_interaction_at = plans.now()
            return None
        callback = event.callback_query
        message = callback.message if callback else event.message
        sender = callback.from_user if callback else message.from_user if message else None
        if (
            not isinstance(message, Message)
            or not sender
            or sender.is_bot
            or message.chat.type != "private"
            or message.chat.id != sender.id
            or sender.id <= 0
        ):
            return None
        words = (message.text or "").split(maxsplit=1)
        command = words[0].split("@")[0].lower() if words else ""
        notification_link = (
            not callback and command == "/start" and len(words) == 2 and words[1] == "notifications"
        )
        enabled = {"/notifications_on": True, "/notifications_off": False}.get(command)
        settings_callback = callback and (callback.data or "").startswith("notify:")
        if callback:
            enabled = None
        if settings_callback:
            if (
                not message.from_user
                or message.from_user.id != self.bot.id
                or not message.from_user.is_bot
                or callback.data not in ("notify:on", "notify:off", "notify:settings")
            ):
                raise AppError(404, "SETTINGS_UNAVAILABLE", "Эта кнопка недоступна")
            enabled = {"notify:on": True, "notify:off": False}.get(callback.data)
        user = await bot_bindings.interact(session, sender.id, message.chat.id, enabled)
        prompt = None
        if (
            settings_callback
            or enabled is not None
            or command == "/notifications"
            or notification_link
        ):
            binding = await session.get(BotBinding, sender.id)
            profile_ready = user is not None and await session.get(Profile, user.id) is not None
            text, markup = notification_settings(
                self.settings, binding.notifications_enabled, profile_ready
            )
        elif callback:
            data = (callback.data or "").split(":")
            if len(data) != 3 or data[0] != "sv" or len(data[1]) != 22:
                raise surveys.unavailable()
            text, markup, wants_comment = await surveys.answer(session, sender.id, data[1], data[2])
            if wants_comment:
                recipient, _ = await surveys.recipient_for(session, sender.id, token=data[1])
                prompt = (recipient.survey_id, recipient.participant_side)
                markup = ForceReply(
                    selective=True, input_field_placeholder="Комментарий необязателен"
                )
        elif message.reply_to_message and message.text and not command.startswith("/"):
            text = await surveys.comment(
                session, sender.id, message.reply_to_message.message_id, message.text
            )
            markup = None
        else:
            profile_ready = user is not None and await session.get(Profile, user.id) is not None
            text, markup = welcome(self.settings, profile_ready)
        return BotReply(
            message.chat.id,
            text,
            markup,
            prompt,
            message.message_id if settings_callback else None,
        )

    async def acknowledge(self, callback, notice=None):
        if callback:
            try:
                async with asyncio.timeout(self.settings.telegram_request_timeout_seconds):
                    await self.bot.answer_callback_query(
                        callback.id, text=notice, show_alert=bool(notice)
                    )
            except TelegramBadRequest:
                pass  # Истёкший callback не отменяет сохранённую настройку/ответ.

    async def process(self, event):
        key = (self.bot_key, event.update_id)
        callback = event.callback_query
        settings_callback = callback and (callback.data or "").startswith("notify:")
        callback_notice = None
        async with advisory_lock(
            self.database, f"bot-update:{self.bot_key}:{event.update_id}"
        ) as acquired:
            if not acquired:
                return False
            async with self.database.sessions() as session:
                previous = await session.get(TelegramUpdate, key)
                if previous and previous.state in ("processed", "failed"):
                    return True
                await session.execute(
                    insert(TelegramUpdate)
                    .values(bot_key=self.bot_key, update_id=event.update_id)
                    .on_conflict_do_nothing()
                )
                await session.commit()
                try:
                    reply = await self.prepare(session, event)
                    await session.commit()
                except AppError as error:
                    await session.rollback()
                    message = (
                        event.callback_query.message if event.callback_query else event.message
                    )
                    if settings_callback:
                        reply = None
                        callback_notice = error.message
                    else:
                        reply = (
                            BotReply(message.chat.id, text_message("Не получилось", error.message))
                            if isinstance(message, Message)
                            else None
                        )
            if not settings_callback:
                await self.acknowledge(callback)
            try:
                if reply:
                    async with asyncio.timeout(self.settings.telegram_request_timeout_seconds):
                        arguments = dict(
                            chat_id=reply.chat_id,
                            text=reply.text,
                            reply_markup=reply.markup,
                            parse_mode="HTML",
                            link_preview_options=LinkPreviewOptions(is_disabled=True),
                        )
                        if reply.edit_message_id is not None:
                            sent = await self.bot.edit_message_text(
                                message_id=reply.edit_message_id, **arguments
                            )
                        else:
                            sent = await self.bot.send_message(**arguments)
                    if reply.prompt:
                        async with self.database.sessions() as session:
                            recipient = await session.get(SurveyRecipient, reply.prompt)
                            recipient.comment_prompt_message_id = sent.message_id
                            await session.commit()
            except TelegramForbiddenError:
                async with self.database.sessions() as session:
                    if reply:
                        await session.execute(
                            update(BotBinding)
                            .where(BotBinding.private_chat_id == reply.chat_id)
                            .values(access_state="denied")
                        )
                    await session.commit()
            except TelegramBadRequest as error:
                unchanged = settings_callback and "message is not modified" in error.message.lower()
                if not unchanged:
                    if settings_callback:
                        await self.acknowledge(
                            callback, "Настройка сохранена. Открой настройки снова"
                        )
                    await self.mark(event.update_id, "failed")
                    logger.warning("bot_reply_rejected")
                    return True
            if settings_callback:
                await self.acknowledge(callback, callback_notice)
            await self.mark(event.update_id, "processed")
            return True


async def polling(handler):
    # Публичный getUpdates aiogram; offset двигается только после устойчивой обработки.
    # start_polling по умолчанию подтверждает update до окончания отдельной task.
    offset = None
    while True:
        try:
            updates = await handler.bot.get_updates(
                offset=offset,
                timeout=20,
                request_timeout=30,
                allowed_updates=["message", "my_chat_member", "callback_query"],
            )
            for event in updates:
                attempts = 0
                while True:
                    try:
                        if await handler.process(event):
                            break
                        await asyncio.sleep(1)
                    except (TelegramUnauthorizedError, TelegramConflictError):
                        raise
                    except Exception as error:
                        attempts += 1
                        logger.warning(
                            "bot_update_processing_unavailable",
                            extra={"error_type": type(error).__name__},
                        )
                        if attempts >= 5:
                            # Не подтверждаем update при неработающей БД.
                            await handler.mark(event.update_id, "failed")
                            break
                        await asyncio.sleep(
                            error.retry_after
                            if isinstance(error, TelegramRetryAfter)
                            else min(30, 2**attempts)
                        )
                offset = event.update_id + 1
        except (TelegramUnauthorizedError, TelegramConflictError):
            raise RuntimeError("Проверь токен и единственный polling-процесс бота") from None
        except TelegramRetryAfter as error:
            await asyncio.sleep(max(1, error.retry_after))
        except (TelegramNetworkError, TelegramServerError, OSError):
            logger.warning("bot_polling_temporarily_unavailable")
            await asyncio.sleep(5)
        except Exception:
            logger.warning("bot_storage_temporarily_unavailable")
            await asyncio.sleep(5)


async def serve(settings, *, check=False):
    from sqlalchemy import text

    if not settings.telegram_bot_token:
        raise BotSetupError("token_missing")
    try:
        app_url(settings)
    except ValueError:
        raise BotSetupError("mini_app_https_required") from None
    database = Database(settings)
    bot = Bot(
        settings.telegram_bot_token.get_secret_value(),
        session=AiohttpSession(timeout=settings.telegram_request_timeout_seconds),
    )
    try:
        async with database.sessions() as session:
            revisions = set(
                (await session.execute(text("SELECT version_num FROM alembic_version"))).scalars()
            )
            if revisions != migration_heads():
                raise BotSetupError("migrations_required")
        identity = await bot.get_me()
        if (identity.username or "").lower() != settings.telegram_bot_username.lower():
            raise BotSetupError("username_mismatch")
        if check:
            logger.info("bot_configuration_verified")
            return
        async with advisory_lock(database, f"bot-polling:{bot.id}") as acquired:
            if not acquired:
                raise BotSetupError("polling_already_started")
            if (await bot.get_webhook_info()).url:
                raise BotSetupError("webhook_active")
            await bot.set_my_commands(
                [
                    BotCommand(command="start", description="Открыть Пойдём?"),
                    BotCommand(command="notifications", description="Управление уведомлениями"),
                ]
            )
            logger.info("bot_polling_and_worker_started")
            tasks = [
                asyncio.create_task(polling(BotHandler(database, bot, settings))),
                asyncio.create_task(NotificationWorker(database, bot, settings).run()),
            ]
            try:
                done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
                for task in done:
                    await task
            finally:
                for task in tasks:
                    task.cancel()
                for task in tasks:
                    with suppress(asyncio.CancelledError):
                        await task
    finally:
        await bot.session.close()
        await database.close()


def main():
    parser = argparse.ArgumentParser(description="Telegram-бот и очередь уведомлений Пойдём?")
    parser.add_argument(
        "--check", action="store_true", help="Проверить БД/токен, без polling/отправки"
    )
    args = parser.parse_args()
    try:
        settings = load_settings()
        configure_logging(settings.log_level)
        with asyncio.Runner(loop_factory=loop_factory) as runner:
            runner.run(serve(settings, check=args.check))
    except KeyboardInterrupt:
        pass
    except BotSetupError as error:
        logger.error(f"bot_setup_{error.code}")
        raise SystemExit(1) from None
    except TelegramUnauthorizedError:
        logger.error("bot_token_rejected")
        raise SystemExit(1) from None
    except Exception as error:
        # Только тип, не traceback/URL/строка ошибки с потенциальным токеном.
        logger.error("bot_startup_or_runtime_failed", extra={"error_type": type(error).__name__})
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
