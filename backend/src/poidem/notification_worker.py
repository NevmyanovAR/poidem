"""Lease/fencing PostgreSQL outbox. Telegram вызывается вне транзакции события."""

import asyncio
import logging
import uuid
from dataclasses import dataclass
from datetime import timedelta

from aiogram.exceptions import (
    TelegramAPIError,
    TelegramBadRequest,
    TelegramForbiddenError,
    TelegramNetworkError,
    TelegramRetryAfter,
    TelegramServerError,
    TelegramUnauthorizedError,
)
from aiogram.types import LinkPreviewOptions
from sqlalchemy import BigInteger, and_, cast, func, or_, select, update

from poidem.bot_ui import chat_message, open_app, response_message
from poidem.db.locks import advisory_lock
from poidem.db.models import (
    BotBinding,
    ChatMessage,
    ChatReadState,
    Match,
    NotificationJob,
    Plan,
    PlanResponse,
    SurveyRecipient,
    User,
)
from poidem.services import archive, plans, surveys
from poidem.services.notifications import retry_delay

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Lease:
    identity: uuid.UUID
    owner: str
    recipient_id: uuid.UUID


async def claim(database, settings):
    async with database.sessions() as session:
        at = plans.now()
        entry = await session.scalar(
            select(NotificationJob)
            .where(
                NotificationJob.due_at <= at,
                or_(
                    and_(
                        NotificationJob.state.in_(("pending", "retry")),
                        NotificationJob.next_attempt_at <= at,
                    ),
                    and_(NotificationJob.state == "leased", NotificationJob.lease_until <= at),
                ),
            )
            .order_by(NotificationJob.next_attempt_at, NotificationJob.id)
            .with_for_update(skip_locked=True)
            .limit(1)
        )
        if not entry:
            return None
        if entry.attempts >= settings.notification_max_attempts:
            entry.state = "failed"
            entry.safe_error_code = "attempts_exhausted"
            entry.lease_until = entry.lease_owner = None
            if entry.kind == "post_meeting_survey":
                recipient = await session.get(
                    SurveyRecipient,
                    (uuid.UUID(entry.entity_ref["survey_id"]), entry.entity_ref["side"]),
                )
                if recipient:
                    recipient.delivery_state = "failed"
            await session.commit()
            return None
        owner = str(uuid.uuid4())
        entry.state = "leased"
        entry.lease_owner = owner
        entry.lease_until = at + timedelta(seconds=settings.notification_lease_seconds)
        entry.attempts += 1
        await session.commit()
        return Lease(entry.id, owner, entry.recipient_id)


async def payload(session, entry, binding, settings):
    if entry.kind == "post_meeting_survey":
        return await surveys.delivery(session, entry, settings)
    if entry.kind == "chat_message":
        match = await session.get(Match, uuid.UUID(entry.entity_ref["match_id"]))
        if not match or entry.recipient_id not in (match.author_id, match.responder_id):
            return None
        plan = await session.get(Plan, match.plan_id)
        other_id = match.responder_id if entry.recipient_id == match.author_id else match.author_id
        other = await session.get(User, other_id)
        if (
            other.account_status != "active"
            or plan.moderation_status not in plans.VISIBLE_MODERATION
        ):
            return None
        role = "author" if match.author_id == entry.recipient_id else "responder"
        last_read = await session.scalar(
            select(ChatReadState.last_read_sequence).where(
                ChatReadState.match_id == match.id, ChatReadState.role == role
            )
        )
        notified = await session.scalar(
            select(
                func.max(cast(NotificationJob.entity_ref["notified_through"].astext, BigInteger))
            ).where(
                NotificationJob.recipient_id == entry.recipient_id,
                NotificationJob.kind == "chat_message",
                NotificationJob.state == "sent",
                NotificationJob.entity_ref["match_id"].astext == str(match.id),
            )
        )
        unseen = await session.scalar(
            select(func.max(ChatMessage.sequence))
            .where(
                ChatMessage.match_id == match.id,
                ChatMessage.sender_id != entry.recipient_id,
                ChatMessage.sequence > max(last_read or 0, notified or 0),
            )
            .limit(1)
        )
        if not unseen:
            return None
        entry.entity_ref = {**entry.entity_ref, "notified_through": unseen}
        return chat_message(plan.title), open_app(settings, f"match/{match.id}/chat", "Открыть чат")
    response = await session.get(PlanResponse, uuid.UUID(entry.entity_ref["response_id"]))
    if not response:
        return None
    plan = await session.get(Plan, response.plan_id)
    if not plan or plan.moderation_status not in plans.VISIBLE_MODERATION:
        return None
    expected = {
        "response_received": "waiting",
        "response_accepted": "accepted",
        "response_rejected": "rejected",
        "response_closed": "closed",
    }.get(entry.kind)
    target = response.plan_author_id if entry.kind == "response_received" else response.responder_id
    if expected is None or response.status != expected or target != entry.recipient_id:
        return None
    if entry.kind == "response_received":
        if plan.publication_status != "published" or plan.starts_at <= plans.now():
            return None
        return response_message(entry.kind, response.history_context, plan.title), open_app(
            settings, f"plans?tab=incoming&plan={plan.id}", "Посмотреть отклик"
        )
    if entry.kind == "response_accepted":
        match = await session.scalar(select(Match).where(Match.response_id == response.id))
        if not match:
            return None
        return response_message(entry.kind, response.history_context, plan.title), open_app(
            settings, f"match/{match.id}", "Открыть мэтч"
        )
    route = "plans?tab=archive" if archive.is_archived(plan) else "plans?tab=outgoing"
    return response_message(entry.kind, response.history_context), open_app(
        settings, f"{route}&plan={plan.id}", "Посмотреть ответ"
    )


class NotificationWorker:
    def __init__(self, database, bot, settings):
        self.database, self.bot, self.settings = database, bot, settings
        self.pause_until = None

    async def finish(self, lease, state, code=None, message_id=None, retry_at=None):
        async with self.database.sessions() as session:
            entry = await session.scalar(
                select(NotificationJob)
                .where(
                    NotificationJob.id == lease.identity,
                    NotificationJob.state == "leased",
                    NotificationJob.lease_owner == lease.owner,
                )
                .with_for_update()
            )
            if not entry:
                return False  # Старый процесс не подтверждает новую lease.
            if state == "retry" and entry.attempts >= self.settings.notification_max_attempts:
                state = "failed"
            entry.state, entry.safe_error_code = state, code
            entry.lease_until = entry.lease_owner = None
            if retry_at:
                entry.next_attempt_at = retry_at
            if code == "cooldown":
                entry.attempts -= 1
            if state == "sent":
                entry.sent_at, entry.telegram_message_id = plans.now(), message_id
            if code == "telegram_forbidden":
                await session.execute(
                    update(BotBinding)
                    .where(BotBinding.user_id == entry.recipient_id)
                    .values(access_state="denied")
                )
            if entry.kind == "post_meeting_survey" and state in ("sent", "suppressed", "failed"):
                recipient = await session.get(
                    SurveyRecipient,
                    (uuid.UUID(entry.entity_ref["survey_id"]), entry.entity_ref["side"]),
                )
                if recipient:
                    recipient.delivery_state = "sent" if state == "sent" else "failed"
            await session.commit()
            return True

    async def prepare(self, lease):
        async with self.database.sessions() as session:
            entry = await session.get(NotificationJob, lease.identity)
            if entry.state != "leased" or entry.lease_owner != lease.owner:
                return None, "stale_lease", None
            user = await session.get(User, entry.recipient_id)
            binding = await session.scalar(
                select(BotBinding).where(BotBinding.user_id == entry.recipient_id)
            )
            if not user or user.account_status != "active":
                return None, "recipient_unavailable", None
            if not binding or binding.access_state != "allowed":
                return None, "bot_not_allowed", None
            if not binding.notifications_enabled or not self.settings.notifications_enabled:
                return None, "notifications_disabled", None
            # Ограничение частоты между фактическими доставками, в том числе после retry.
            last = await session.scalar(
                select(func.max(NotificationJob.sent_at)).where(
                    NotificationJob.recipient_id == entry.recipient_id,
                    NotificationJob.state == "sent",
                )
            )
            next_at = last + timedelta(seconds=1) if last else plans.now()
            if entry.kind == "chat_message":
                last_chat = await session.scalar(
                    select(func.max(NotificationJob.sent_at)).where(
                        NotificationJob.recipient_id == entry.recipient_id,
                        NotificationJob.kind == "chat_message",
                        NotificationJob.entity_ref["match_id"].astext
                        == entry.entity_ref["match_id"],
                        NotificationJob.state == "sent",
                    )
                )
                if last_chat:
                    next_at = max(
                        next_at,
                        last_chat
                        + timedelta(seconds=self.settings.chat_notification_window_seconds),
                    )
            if next_at > plans.now():
                return None, "cooldown", next_at
            result = await payload(session, entry, binding, self.settings)
            # Callback hash и состояние опроса устойчивы до внешней отправки.
            await session.commit()
            return ((binding.private_chat_id, *result) if result else None), "event_obsolete", None

    async def run_once(self):
        if self.pause_until and self.pause_until > plans.now():
            return False
        lease = await claim(self.database, self.settings)
        if lease is None:
            return False
        async with advisory_lock(self.database, f"notifications:{lease.recipient_id}") as acquired:
            if not acquired:
                await self.finish(
                    lease, "retry", "cooldown", retry_at=plans.now() + timedelta(seconds=1)
                )
                return True
            return await self.deliver(lease)

    async def deliver(self, lease):
        try:
            result, code, deferred = await self.prepare(lease)
            if not result:
                await self.finish(
                    lease, "retry" if deferred else "suppressed", code, retry_at=deferred
                )
                return True
            chat_id, text, markup = result
            async with asyncio.timeout(self.settings.telegram_request_timeout_seconds):
                message = await self.bot.send_message(
                    chat_id=chat_id,
                    text=text,
                    reply_markup=markup,
                    parse_mode="HTML",
                    link_preview_options=LinkPreviewOptions(is_disabled=True),
                )
            await self.finish(lease, "sent", message_id=message.message_id)
        except TelegramForbiddenError:
            await self.finish(lease, "suppressed", "telegram_forbidden")
        except TelegramRetryAfter as error:
            self.pause_until = plans.now() + timedelta(seconds=max(1, error.retry_after))
            await self.finish(lease, "retry", "telegram_rate_limited", retry_at=self.pause_until)
        except TelegramUnauthorizedError:
            await self.finish(
                lease, "retry", "telegram_unauthorized", retry_at=plans.now() + timedelta(minutes=5)
            )
            raise RuntimeError("Токен бота отклонён Telegram") from None
        except (TelegramBadRequest, TelegramAPIError) as error:
            if isinstance(error, (TelegramNetworkError, TelegramServerError)):
                await self.retry(lease, "telegram_temporary")
            else:
                await self.finish(lease, "failed", "telegram_request_invalid")
        except (TimeoutError, OSError):
            await self.retry(lease, "telegram_ambiguous")
        except Exception:
            # CancelledError здесь не перехватывается: просроченная lease восстановится.
            await self.retry(lease, "delivery_processing_unavailable")
            logger.warning("notification_processing_unavailable")
        return True

    async def retry(self, lease, code):
        async with self.database.sessions() as session:
            entry = await session.get(NotificationJob, lease.identity)
            delay = retry_delay(entry.attempts)
        await self.finish(lease, "retry", code, retry_at=plans.now() + delay)

    async def run(self):
        while True:
            try:
                worked = await self.run_once()
            except RuntimeError:
                raise
            except Exception:
                logger.warning("notification_queue_unavailable")
                worked = False
            await asyncio.sleep(0.1 if worked else 1)
