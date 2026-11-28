from datetime import UTC, datetime

from sqlalchemy import and_, case, func, or_, select

from poidem.db.models import AdminAuditLog, BotHeartbeat, NotificationJob, Plan, Report
from poidem.services import admin_permissions, bot_health

CATEGORIES = {
    "sent": "Успешно отправлены",
    "pending": "Ожидают отправки",
    "retry": "Ожидают повторной попытки после ошибки",
    "suppressed": "Намеренно пропущены",
    "failed": "Окончательно не доставлены",
    "unknown": "Причина неизвестна для старых записей",
}
REASONS = {
    "recipient_unavailable": "Аккаунт получателя недоступен",
    "bot_not_allowed": "Нет разрешённой привязки к личному чату бота",
    "notifications_disabled": "Уведомления отключены",
    "telegram_forbidden": "Telegram запретил отправку в этот чат",
    "pair_blocked": "Между участниками установлена блокировка",
    "content_unavailable": "Контент недоступен по текущим правилам",
    "already_read_or_notified": "Сообщения уже прочитаны или уведомление уже отправлено",
    "response_changed": "Отклик уже получил другой результат",
    "plan_unavailable": "План закрыт или время плана прошло",
    "survey_unavailable": "Опрос уже отвечен, закрыт или недоступен",
    "event_obsolete": "Событие утратило актуальность; точная причина в старой записи не сохранена",
    "cooldown": "Ожидание разрешённого интервала отправки",
    "attempts_exhausted": "Исчерпан лимит попыток",
    "telegram_rate_limited": "Ограничение частоты Telegram",
    "telegram_unauthorized": "Telegram отклонил доступ бота",
    "telegram_temporary": "Временная ошибка Telegram или сети",
    "telegram_ambiguous": "Нет подтверждения доставки после сетевой ошибки",
    "telegram_request_invalid": "Telegram отклонил запрос",
    "delivery_processing_unavailable": "Временная ошибка обработки задания",
    "stale_lease": "Задание обрабатывается другой попыткой",
}
SUPPRESSION_CODES = tuple(
    key
    for key in REASONS
    if key
    not in {
        "event_obsolete",
        "cooldown",
        "attempts_exhausted",
        "telegram_rate_limited",
        "telegram_unauthorized",
        "telegram_temporary",
        "telegram_ambiguous",
        "telegram_request_invalid",
        "delivery_processing_unavailable",
        "stale_lease",
    }
)
READ_ACTIONS = (
    "admin_analytics_read",
    "admin_user_read",
    "admin_plan_read",
    "place_list",
    "place_check_list",
    "place_read",
)
KIND_LABELS = {
    "photo_verification_approved": "Фото подтверждено",
    "photo_verification_rejected": "Проверка фото отклонена",
    "response_received": "Новый отклик",
    "response_accepted": "Принятие отклика",
    "response_rejected": "Отказ",
    "response_closed": "Пара уже выбрана",
    "chat_message": "Сообщения чата",
    "post_meeting_survey": "Опрос после встречи",
}


def category_expr():
    return case(
        (NotificationJob.state == "sent", "sent"),
        (
            or_(
                NotificationJob.state.in_(("pending", "leased")),
                and_(
                    NotificationJob.state == "retry", NotificationJob.safe_error_code == "cooldown"
                ),
            ),
            "pending",
        ),
        (NotificationJob.state == "retry", "retry"),
        (NotificationJob.state == "failed", "failed"),
        (
            and_(
                NotificationJob.state == "suppressed",
                NotificationJob.safe_error_code.in_(SUPPRESSION_CODES),
            ),
            "suppressed",
        ),
        else_="unknown",
    )


async def jobs(session, actor, *, category=None, offset=0, limit=25):
    await admin_permissions.require(session, actor, "system")
    query = select(NotificationJob)
    if category:
        query = query.where(category_expr() == category)
    total = await session.scalar(select(func.count()).select_from(query.subquery()))
    rows = (
        await session.scalars(
            query.order_by(NotificationJob.created_at.desc(), NotificationJob.id.desc())
            .offset(offset)
            .limit(limit)
        )
    ).all()
    now = datetime.now(UTC)
    items = []
    for row in rows:
        cat = (
            "sent"
            if row.state == "sent"
            else "pending"
            if row.state in ("pending", "leased")
            or row.state == "retry"
            and row.safe_error_code == "cooldown"
            else "retry"
            if row.state == "retry"
            else "failed"
            if row.state == "failed"
            else "suppressed"
            if row.state == "suppressed" and row.safe_error_code in SUPPRESSION_CODES
            else "unknown"
        )
        items.append(
            {
                "id": row.id,
                "kind": KIND_LABELS.get(row.kind, "Другое уведомление"),
                "category": cat,
                "state_label": CATEGORIES[cat],
                "created_at": row.created_at,
                "due_at": row.due_at,
                "next_attempt_at": row.next_attempt_at,
                "sent_at": row.sent_at,
                "attempts": row.attempts,
                "reason": REASONS.get(
                    row.safe_error_code, "Причина не сохранена" if cat != "sent" else "Доставлено"
                ),
                "overdue": row.state in ("pending", "retry", "leased")
                and max(row.due_at, row.next_attempt_at, row.lease_until or row.next_attempt_at)
                < now,
            }
        )
    return {
        "items": items,
        "total": total,
        "next_offset": offset + limit if offset + limit < total else None,
    }


async def audit_page(session, actor, *, kind="changes", offset=0, limit=25, user=None, plan=None):
    await admin_permissions.require(
        session, actor, "users" if user else "plans" if plan else "system"
    )
    query = select(AdminAuditLog)
    if kind != "all":
        query = query.where(
            AdminAuditLog.action.in_(READ_ACTIONS)
            if kind == "reads"
            else AdminAuditLog.action.not_in(READ_ACTIONS)
        )
    if user:
        report_ids = select(func.concat("report:", Report.id)).where(
            or_(
                Report.reported_user_id == user,
                Report.reporter_id == user,
                Report.plan_id.in_(select(Plan.id).where(Plan.author_id == user)),
            )
        )
        query = query.where(
            or_(
                AdminAuditLog.target_ref == f"user:{user}",
                AdminAuditLog.target_ref.in_(report_ids),
                AdminAuditLog.target_ref.in_(
                    select(func.concat("plan:", Plan.id)).where(Plan.author_id == user)
                ),
            )
        )
    if plan:
        query = query.where(
            or_(
                AdminAuditLog.target_ref == f"plan:{plan}",
                AdminAuditLog.target_ref.in_(
                    select(func.concat("report:", Report.id)).where(Report.plan_id == plan)
                ),
            )
        )
    total = await session.scalar(select(func.count()).select_from(query.subquery()))
    rows = (
        await session.scalars(
            query.order_by(AdminAuditLog.occurred_at.desc(), AdminAuditLog.id.desc())
            .offset(offset)
            .limit(limit)
        )
    ).all()
    return {
        "items": [
            {
                "id": r.id,
                "action": r.action,
                "occurred_at": r.occurred_at,
                "target": r.target_ref,
                "reason": r.reason_code,
                "old_status": r.old_status,
                "new_status": r.new_status,
            }
            for r in rows
        ],
        "total": total,
        "next_offset": offset + limit if offset + limit < total else None,
    }


async def summary(session, actor):
    await admin_permissions.require(session, actor, "system")
    now = datetime.now(UTC)
    category = category_expr()
    grouped = dict((await session.execute(select(category, func.count()).group_by(category))).all())
    heartbeat = {r.component: r for r in (await session.scalars(select(BotHeartbeat))).all()}
    oldest = await session.scalar(
        select(func.min(NotificationJob.next_attempt_at)).where(
            NotificationJob.state.in_(("pending", "retry")),
            NotificationJob.due_at <= now,
            NotificationJob.next_attempt_at < now,
        )
    )
    leased = await session.scalar(
        select(func.count())
        .select_from(NotificationJob)
        .where(NotificationJob.state == "leased", NotificationJob.lease_until < now)
    )
    return {
        "checked_at": now,
        "api": "available",
        "database": "available",
        "heartbeat": {
            key: bot_health.status(heartbeat.get(key), now) for key in ("polling", "worker")
        },
        "worker": bot_health.status(heartbeat.get("worker"), now)["state"],
        "worker_explanation": (
            "Статус каждого цикла по heartbeat не старше 60 секунд; "
            "последняя доставка не заменяет heartbeat"
        ),
        "jobs": grouped,
        "categories": [
            {"id": key, "label": label, "count": grouped.get(key, 0)}
            for key, label in CATEGORIES.items()
        ],
        "last_sent_at": await session.scalar(select(func.max(NotificationJob.sent_at))),
        "oldest_due_at": oldest,
        "expired_leases": leased,
        "errors": [
            {"code": REASONS.get(code, "Неизвестная ошибка старой записи"), "count": n}
            for code, n in (
                await session.execute(
                    select(NotificationJob.safe_error_code, func.count())
                    .where(
                        NotificationJob.state.in_(("retry", "failed")),
                        NotificationJob.safe_error_code != "cooldown",
                    )
                    .group_by(NotificationJob.safe_error_code)
                )
            ).all()
        ],
        "audit": (await audit_page(session, actor))["items"],
    }
