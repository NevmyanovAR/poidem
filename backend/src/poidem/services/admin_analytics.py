"""D61: агрегаты существующих записей. История, которой нет в БД, не восстанавливается."""

import csv
import io
from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import and_, case, distinct, func, select, union_all

from poidem.db.models import (
    AnalyticsEvent,
    Category,
    ChatMessage,
    FeedbackAnswer,
    Match,
    Plan,
    PlanResponse,
    Report,
    Survey,
    User,
)
from poidem.services import analytics_events, plans, surveys


def period_bounds(period, at):
    zone = ZoneInfo(period.time_zone)
    start = datetime.combine(period.start_date, time.min, zone).astimezone(UTC)
    end = datetime.combine(period.end_date + timedelta(days=1), time.min, zone).astimezone(UTC)
    stop = min(end, at)
    # Смежный предыдущий интервал точно той же длительности, без пересечений при DST.
    return start, stop, start - (stop - start), start


def within(column, start, end):
    return and_(column >= start, column < end)


def actions():
    # Не auth_sessions.last_seen_at и не последний изменяемый ответ опроса.
    return union_all(
        select(Plan.author_id.label("actor"), Plan.created_at.label("at")),
        select(PlanResponse.responder_id, PlanResponse.created_at),
        select(Match.author_id, Match.created_at),
        select(ChatMessage.sender_id, ChatMessage.created_at),
    ).subquery("product_actions")


def meeting_results(at):
    a, b = FeedbackAnswer.__table__.alias("answer_a"), FeedbackAnswer.__table__.alias("answer_b")

    def valid(side, role):
        return and_(
            side.c.survey_id == Survey.id,
            side.c.participant_side == role,
            side.c.completion_state == "submitted",
            side.c.met.is_not(None),
        )

    answered_a, answered_b = a.c.survey_id.is_not(None), b.c.survey_id.is_not(None)
    outcome = case(
        (and_(a.c.met.is_(True), b.c.met.is_(True)), "mutual_yes"),
        (and_(a.c.met.is_(False), b.c.met.is_(False)), "mutual_no"),
        (and_(answered_a, answered_b), "conflicting"),
        (answered_a | answered_b, "insufficient"),
        else_="no_data",
    )
    return (
        select(
            Match.id.label("match_id"),
            Match.meeting_starts_at.label("meeting_at"),
            outcome.label("result"),
        )
        .join(Plan, Plan.id == Match.plan_id)
        .outerjoin(
            Survey,
            and_(
                Survey.match_id == Match.id,
                Survey.policy_version == surveys.POLICY,
                Survey.scheduled_at <= at,
            ),
        )
        .outerjoin(a, valid(a, "author"))
        .outerjoin(b, valid(b, "responder"))
        .where(
            Plan.publication_status != "cancelled",
            Match.meeting_starts_at <= at - timedelta(hours=2),
        )
        .subquery("meeting_results")
    )


DEFINITIONS = {
    "users_total": (
        "Всего пользователей",
        "аккаунтов",
        "COUNT(users) на момент снимка; удалённые аккаунты не восстанавливаются",
    ),
    "new_users": (
        "Новые пользователи",
        "аккаунтов",
        "COUNT(users.created_at в периоде) среди существующих аккаунтов",
    ),
    "active_users": (
        "Активные по действиям",
        "пользователей",
        "DISTINCT actor: создание плана, отклик, принятие отклика или сообщение; "
        "входы/чтение/редактирование не учитываются",
    ),
    "plans_created": (
        "Созданные планы",
        "планов",
        "COUNT(plans.created_at в периоде), включая черновики",
    ),
    "plans_published": (
        "Первые публикации",
        "планов",
        "COUNT уникальных D61 plan_published в периоде; время прежних публикаций неизвестно",
    ),
    "responses": (
        "Отправленные отклики",
        "откликов",
        "COUNT(plan_responses.created_at в периоде), одна строка на человека/план",
    ),
    "matches": (
        "Созданные мэтчи",
        "мэтчей",
        "COUNT(matches.created_at в периоде), один мэтч на план",
    ),
    "confirmed_meetings": (
        "Взаимно подтверждённые встречи",
        "встреч",
        "COUNT DISTINCT Match.id с временем встречи в периоде, опросом D53 "
        "и двумя завершёнными Да после +2ч; не число уникальных партнёров",
    ),
    "pending_reports": (
        "Жалобы в очереди",
        "жалоб",
        "COUNT(reports.state=pending) сейчас, вне фильтра периода",
    ),
    "plans_response_rate": (
        "Доля созданных в периоде планов с откликами",
        "%",
        "100 × созданные в периоде планы с откликом / все созданные планы, включая черновики; "
        "исходы на дату снимка",
    ),
    "accepted_rate": (
        "Принятые отклики",
        "%",
        "100 × отклики когорты периода со статусом accepted / все отклики когорты периода; "
        "когорты имеют разный срок ожидания",
    ),
    "retention": (
        "Возвращаемость по открытиям",
        "%",
        "Нет журнала открытий/сессий использования и согласованного D1/D7 retention; "
        "Telegram-вход не подменяет активность",
    ),
    "plans_published_now": (
        "Опубликовано планов сейчас",
        "планов",
        "COUNT plans со статусом published и доступной модерацией сейчас; "
        "снимок вне фильтра периода, не первые публикации",
    ),
    "published_response_rate_now": (
        "Доля текущих публикаций с откликами",
        "%",
        "100 × текущие published с доступной модерацией и EXISTS отклик / "
        "все текущие published с доступной модерацией; снимок, не историческая конверсия",
    ),
}


async def count(session, model, *conditions):
    return int(await session.scalar(select(func.count()).select_from(model).where(*conditions)))


async def cohort(session, start, end, at, coverage):
    results = meeting_results(at)
    act = actions()
    plan_where = within(Plan.created_at, start, end)
    response_where = within(PlanResponse.created_at, start, end)
    made = await count(session, Plan, plan_where)
    responses = await count(session, PlanResponse, response_where)
    with_responses = await count(
        session,
        Plan,
        plan_where,
        select(PlanResponse.id).where(PlanResponse.plan_id == Plan.id).exists(),
    )
    accepted = await count(session, PlanResponse, response_where, PlanResponse.status == "accepted")
    return {
        "new_users": await count(session, User, within(User.created_at, start, end)),
        "active_users": int(
            await session.scalar(
                select(func.count(distinct(act.c.actor))).where(within(act.c.at, start, end))
            )
        ),
        "plans_created": made,
        "plans_published": await count(
            session,
            AnalyticsEvent,
            AnalyticsEvent.event_type == analytics_events.PUBLISHED,
            within(AnalyticsEvent.occurred_at, start, end),
        )
        if coverage and start >= coverage
        else None,
        "responses": responses,
        "matches": await count(session, Match, within(Match.created_at, start, end)),
        "confirmed_meetings": int(
            await session.scalar(
                select(func.count())
                .select_from(results)
                .where(within(results.c.meeting_at, start, end), results.c.result == "mutual_yes")
            )
        ),
        "plans_response_rate": round(100 * with_responses / made, 2) if made else None,
        "accepted_rate": round(100 * accepted / responses, 2) if responses else None,
        "retention": None,
    }


async def funnel(session, start, end, at, coverage):
    # Единица всей цепочки — уникальная пара кандидат/план, не смесь людей и сообщений.
    results = meeting_results(at)
    confirmed = select(results.c.match_id).where(results.c.result == "mutual_yes")
    started = (
        select(ChatMessage.id)
        .where(ChatMessage.match_id == Match.id, ChatMessage.created_at <= at)
        .exists()
    )
    if coverage and start >= coverage:
        query = (
            select(
                func.count(AnalyticsEvent.id),
                func.count(PlanResponse.id),
                func.count(Match.id),
                func.count(Match.id).filter(started),
                func.count(Match.id).filter(started, Match.id.in_(confirmed)),
            )
            .select_from(AnalyticsEvent)
            .outerjoin(
                PlanResponse,
                and_(
                    PlanResponse.plan_id == AnalyticsEvent.entity_id,
                    PlanResponse.responder_id == AnalyticsEvent.actor_id,
                    PlanResponse.created_at >= AnalyticsEvent.occurred_at,
                    PlanResponse.created_at <= at,
                ),
            )
            .outerjoin(Match, Match.response_id == PlanResponse.id)
            .where(
                AnalyticsEvent.event_type == analytics_events.VIEW,
                within(AnalyticsEvent.occurred_at, start, end),
            )
        )
        values = list((await session.execute(query)).one())
        basis = (
            "Первые зарегистрированные просмотры кандидатом плана в периоде; "
            "последующие исходы на дату снимка"
        )
    else:
        query = (
            select(
                func.count(PlanResponse.id),
                func.count(Match.id),
                func.count(Match.id).filter(started),
                func.count(Match.id).filter(started, Match.id.in_(confirmed)),
            )
            .select_from(PlanResponse)
            .outerjoin(Match, Match.response_id == PlanResponse.id)
            .where(within(PlanResponse.created_at, start, end))
        )
        values = [None, *(await session.execute(query)).one()]
        basis = "Когорта отправленных в периоде откликов; просмотры за весь диапазон не измерялись"
    labels = [
        "Просмотр плана",
        "Отклик",
        "Мэтч",
        "Начало переписки",
        "Подтверждение после переписки",
    ]
    stages = []
    for i, (label, value) in enumerate(zip(labels, values, strict=True)):
        denominator = values[i - 1] if i else None
        stages.append(
            {
                "label": label,
                "value": value,
                "numerator": value if i else None,
                "denominator": denominator,
                "conversion": round(100 * value / denominator, 2)
                if value is not None and denominator
                else None,
            }
        )
    return {
        "unit": "уникальная пара кандидат/план",
        "basis": basis,
        "stages": stages,
        "note": (
            "Цепочка последовательная. Встречи без встроенного чата включены в итоги встреч, "
            "но не в последний переход этой воронки. Нулевой знаменатель означает "
            "нет данных для конверсии"
        ),
    }


async def analytics(session, period):
    at = datetime.now(UTC)
    start, stop, old_start, old_stop = period_bounds(period, at)
    coverage = await session.scalar(
        select(AnalyticsEvent.occurred_at).where(
            AnalyticsEvent.event_key == analytics_events.COVERAGE_KEY
        )
    )
    current = await cohort(session, start, stop, at, coverage)
    previous = await cohort(session, old_start, old_stop, at, coverage)
    current["users_total"] = await count(session, User)
    current["pending_reports"] = await count(session, Report, Report.state == "pending")
    visible = (
        Plan.publication_status == "published",
        Plan.moderation_status.in_(plans.VISIBLE_MODERATION),
    )
    current["plans_published_now"] = await count(session, Plan, *visible)
    responded_now = await count(
        session,
        Plan,
        *visible,
        select(PlanResponse.id).where(PlanResponse.plan_id == Plan.id).exists(),
    )
    current["published_response_rate_now"] = (
        round(100 * responded_now / current["plans_published_now"], 2)
        if current["plans_published_now"]
        else None
    )
    metrics = []
    for key, (label, unit, definition) in DEFINITIONS.items():
        value, old = current[key], previous.get(key)
        reason = None
        if value is None:
            reason = (
                "Нет полного учёта первых публикаций за этот период"
                if key == "plans_published"
                else definition
                if key == "retention"
                else "Нет знаменателя для расчёта"
            )
        incomplete = key == "plans_published" and value is None
        if incomplete:
            reason = (
                f"Учёт ведётся с {coverage.isoformat()}; выбранный период начинается раньше"
                if coverage
                else "Дата начала учёта пока неизвестна"
            )
        # Снимки текущего состояния и когорты разного возраста не выдаём за рост.
        comparable = key not in (
            "users_total",
            "pending_reports",
            "accepted_rate",
            "plans_response_rate",
            "retention",
            "plans_published_now",
            "published_response_rate_now",
        )
        delta = (
            round(100 * (value - old) / old, 2)
            if comparable and value is not None and old
            else None
        )
        metrics.append(
            {
                "id": key,
                "label": label,
                "unit": unit,
                "value": value,
                "previous": old,
                "change_percent": delta,
                "definition": definition,
                "reason": reason,
                "data_status": "incomplete"
                if incomplete
                else "unavailable"
                if value is None
                else "complete",
                "collection_started_at": coverage.isoformat()
                if key == "plans_published" and coverage
                else None,
            }
        )
    act = actions()
    day = func.date(func.timezone(period.time_zone, User.created_at))
    registered = dict(
        (
            await session.execute(
                select(day, func.count()).where(within(User.created_at, start, stop)).group_by(day)
            )
        ).all()
    )
    act_day = func.date(func.timezone(period.time_zone, act.c.at))
    active = dict(
        (
            await session.execute(
                select(act_day, func.count(distinct(act.c.actor)))
                .where(within(act.c.at, start, stop))
                .group_by(act_day)
            )
        ).all()
    )
    daily = []
    for n in range((period.end_date - period.start_date).days + 1):
        date = period.start_date + timedelta(days=n)
        daily.append(
            {
                "date": date.isoformat(),
                "registrations": registered.get(date, 0),
                "active_users": active.get(date, 0),
            }
        )
    categories = (
        await session.execute(
            select(Category.code, Category.title, func.count(Plan.id))
            .join(Plan, Plan.category_code == Category.code)
            .where(within(Plan.created_at, start, stop))
            .group_by(Category.code, Category.title)
            .order_by(func.count(Plan.id).desc(), Category.code)
        )
    ).all()
    outcomes = meeting_results(at)
    result_counts = dict(
        (
            await session.execute(
                select(outcomes.c.result, func.count())
                .where(within(outcomes.c.meeting_at, start, stop))
                .group_by(outcomes.c.result)
            )
        ).all()
    )
    return {
        "generated_at": at.isoformat(),
        "period": {
            **period.model_dump(mode="json"),
            "from": start.isoformat(),
            "to_exclusive": stop.isoformat(),
            "previous_from": old_start.isoformat(),
            "previous_to_exclusive": old_stop.isoformat(),
        },
        "collection_started_at": coverage.isoformat() if coverage else None,
        "metrics": metrics,
        "daily": daily,
        "categories": [{"code": row[0], "label": row[1], "value": row[2]} for row in categories],
        "funnel": await funnel(session, start, stop, at, coverage),
        "meetings": [
            {"id": key, "value": result_counts.get(key, 0)}
            for key in ("mutual_yes", "mutual_no", "conflicting", "insufficient", "no_data")
        ],
        "limitations": [
            "Существующие записи, без восстановления удалённых аккаунтов и событий",
            "Активность: создание плана, отклик, принятие и сообщения; не все открытия приложения",
            "Публикации и первые просмотры собираются только после установки этапа 9",
            "Опросы — изменяемые самоотчёты, не доказательство факта встречи; молчание не неявка",
            "Итоги встреч относятся к датам встреч после +2 часов; "
            "другие события — к датам создания",
            "Текущий день сравнивается с такой же прошедшей длительностью предыдущего периода; "
            "нулевой знаменатель не даёт процент роста",
        ],
    }


def csv_report(report):
    stream = io.StringIO(newline="")
    writer = csv.writer(stream, delimiter=";", quoting=csv.QUOTE_ALL)

    def safe(value):
        if value is None:
            return "Нет данных"
        if isinstance(value, str) and value.lstrip().startswith(
            ("=", "+", "-", "@", "\t", "\r", "\n")
        ):
            return "'" + value
        return value

    period = report["period"]
    writer.writerow(
        [
            "Раздел",
            "Показатель",
            "Значение",
            "Предыдущий период",
            "Единица",
            "Определение",
            "С",
            "До (исключая)",
            "Часовой пояс",
            "Снимок UTC",
            "Предыдущий период с",
            "Предыдущий период до (исключая)",
            "Числитель перехода",
            "Знаменатель перехода",
            "Конверсия перехода, %",
            "Полнота данных",
            "Начало учёта UTC",
        ]
    )

    def row(
        section,
        label,
        value,
        old,
        unit,
        definition,
        numerator=None,
        denominator=None,
        conversion=None,
        data_status=None,
        collection_started_at=None,
    ):
        writer.writerow(
            [
                safe(v)
                for v in [
                    section,
                    label,
                    value,
                    old,
                    unit,
                    definition,
                    period["from"],
                    period["to_exclusive"],
                    period["time_zone"],
                    report["generated_at"],
                    period["previous_from"],
                    period["previous_to_exclusive"],
                    numerator,
                    denominator,
                    conversion,
                    data_status,
                    collection_started_at,
                ]
            ]
        )

    for metric in report["metrics"]:
        row(
            "Показатели",
            metric["label"],
            metric["value"],
            metric["previous"],
            metric["unit"],
            metric["definition"],
            data_status=metric.get("data_status"),
            collection_started_at=metric.get("collection_started_at"),
        )
    for day in report["daily"]:
        for key in ("registrations", "active_users"):
            row(
                "Дни",
                f"{day['date']} / {key}",
                day[key],
                None,
                "пользователей",
                "День в указанном часовом поясе",
            )
    for category in report["categories"]:
        row(
            "Категории",
            category["label"],
            category["value"],
            None,
            "планов",
            "Созданные в периоде планы",
        )
    for stage in report["funnel"]["stages"]:
        row(
            "Воронка",
            stage["label"],
            stage["value"],
            None,
            report["funnel"]["unit"],
            report["funnel"]["basis"],
            stage["numerator"],
            stage["denominator"],
            stage["conversion"],
        )
    for meeting in report["meetings"]:
        row(
            "Встречи",
            meeting["id"],
            meeting["value"],
            None,
            "мэтчей",
            "Текущий результат завершённых ответов для дат встреч периода после +2 часов",
        )
    return "\ufeff" + stream.getvalue()
