# Проект контракта API

**D67 / этап 11В — актуальные требования:** свободные название/адрес без предварительного одобрения; необязательная проверка точной версии места, 0014/39 таблиц. Каталог D66 и исторические адреса сохранены, но не блокируют публикацию. Репутация — три независимых положительных признака, прежние фото/встречи + добровольные впечатления разных партнёров; старые приватные оценки не используются. [Устройство, формулы и API](FREE_PLACES_REPUTATION_STAGE11V.md)

**D66 / предыдущая реализация:** собственный каталог общественных мест без 2ГИС/внешних ключей, ручная модерация/CSV/0013 (38 таблиц), исторические адреса сохранены. Фотоверификация — компактный UI без изменения backend-проверки. Это заменяет прежние условия внешнего Places API. [Реализация, API и запуск](LOCAL_PLACES_AND_VERIFICATION_UX.md)

**D65:** private /me/photo-verification (+ challenge/selfie/withdraw), moderation /admin/photo-verifications (+ detail/photo/decision). Сессия/контекст/CSRF/права; публично только photo_verified в прежних OwnProfile/PublicProfile DTO. Фото/версия/владелец не задаются клиентом. [Точные маршруты](PHOTO_VERIFICATION_STAGE11B.md#api)

**D64 / этап 11А:** GET /places/search?q=… и POST /places/resolve {provider_place_id} защищены сессией/account context, запись Origin/CSRF. PlanFields/Patch дополнены selected_place_id; PlanDTO venue/selected_place_id/place_status. Новый POI выбирается и проверяется сервером, свободный адрес только в черновике; прежние адреса сохраняются. Без ключа/подтверждения хранения 503 до запроса поставщику. [Полный контракт/ошибки](PLACES_STAGE11A.md#api)

**D63 / этап 10:** существующий `PlanDTO` дополнен `allowed_actions: ("edit" | "cancel" | "publish")[]` (пустой список по умолчанию). Поле только для чтения: чужие планы, архив, ограниченный автор/анкета/публикация, закрытые планы или любая история откликов/мэтчей не предлагают команды. Для доступного черновика публикация дополнительно требует будущей даты. Проверки версии/владельца/связей/полей в командах сохраняются независимо от этой проекции. Существующий `GET /me/activity?scope=archive` сортируется по времени события истории убывающе до пагинации, личное скрытие/привязка курсора сохраняются. Новых endpoint/миграций нет. [Детали](USER_UX_STAGE10.md)

**D62 / этап 9Б:** admin/session возвращает role/permissions. Добавлены GET admin/team и PUT admin/team/{uuid}/role (owner), CRUD/command/photo admin/inspiration (editorial), публичные GET inspiration (только опубликованные идеи), GET admin/notifications и admin/audit, фильтр author у admin/plans. Прежние admin API используют разрешения функции, а не единственную строку admin. Аналитика дополнена текущими публикациями/долей с откликами и полнотой исторического учёта, CSV того же снимка. [Контракт/матрица/формулы](ADMIN_STAGE9B.md), Pydantic/OpenAPI — авторитетные DTO

**D61 / этап 9:** прежние admin/session|reports|photo|decision сохранены. Добавлены admin/analytics (GET start_date/end_date/time_zone), analytics/export (POST периода → report/csv/filename), users|plans (GET фильтрованных серверных каталогов + details/{uuid}), system (GET). Все active/admin; экспорт Origin/CSRF; чтение аналитики/details и экспорт аудируются. reports дополнен reason_code/user_id/plan_id. Пользовательский POST plans/{uuid}/view повторно проверяет доступ и пишет дедуплицированное событие, actor только из сессии. [Точный контракт и методика](ADMIN_STAGE9.md), schemas/admin_dashboard.py и OpenAPI. Новых endpoints выдачи ролей/изменения чужих записей/свободного чтения переписок/фото нет

**D60 — реализованный read-контракт:**

- `GET /api/v1/me/chats?cursor=…&limit=20` → `{items:[{match:MatchDTO,last_message:{text,sender,created_at}|null,last_activity_at}],next_cursor}`. Только участник; дата последнего сообщения или создания мэтча, DESC + UUID DESC; курсор привязан к аккаунту, limit 1–50
- `GET /api/v1/me/navigation` → `{pending_responses,unread_messages,unread_dialogs}`. Только подтверждённая сессия/активный пользователь; все записи, реальные read states, свои сообщения не считаются непрочитанными; pending исключает истёкшее/закрытое/архив/блокировку/недоступную модерацию
- `GET /api/v1/me/activity` дополнен `view=own` (по умолчанию прежний `all`). SQL-порядок собственных планов: ожидающие решения будущие публикации → остальные будущие → черновики → история. Дополнительные поля ActivityItem: `pending_response_count`, `match_id`, `history`, по умолчанию 0/null/false. Scope/hidden/plan_id и проверка прав сохранены; cursor проверяет view и plan_id. Базовые маршруты response/match/chat/read/feedback не меняются

Это проекции существующих таблиц без новых мутаций/миграций. Последнее сообщение доступно только участнику мэтча, не включается в бот/логи. [D60](NAVIGATION_CHATS_UX.md)

D58: реализованы GET /matches/{id}/survey, POST /matches/{id}/feedback и GET /me/reliability. SurveyDTO содержит общий результат/наличие ответов и только собственный rating/comment; POST принимает лишь met/rating/comment и прежний CSRF/account context. Публичная анкета дополнена experience={unique_confirmed_partners,policy_version:"D58-mutual-unique-partners-v1"}; это число уникальных партнёров, а не звёздный рейтинг. Admin detail дополнен meeting_review только по связанной жалобе; новых санкций нет. Нижние архитектурные черновики ReliabilityDTO/FeedbackDTO заменены действующими схемами feedback.py для этого объёма. [Поля, правила и ошибки](MEETINGS_STAGE8.md#api-и-безопасность)

D57: POST /reports и POST /me/blocks принимают только target_type=profile|plan|match|chat; поля message_id больше нет (extra=forbid), старые payload с message/message_id возвращают 422. Чтение ранее сохранённых message-жалоб и admin-фильтр по их типу сохранены; миграций/удаления истории нет. Жалоба на переписку по-прежнему содержит не более трёх последних сообщений разрешённого чата

D56: GET /me/blocks дополнен age/photo_url/context/context_saved_later/display_code без новых прав на фото и без Telegram ID/UUID пользователя. DELETE остаётся по id связи; схема БД/остальные операции не меняются. [Точный смысл полей](SETTINGS_UX.md)

D55 / этап 7: добавлены /reports, /me/blocks и /admin/session|reports|reports/{id}/photo|decision. Прежняя сессия/CSRF/account context, автор/цель устанавливаются из доступного контекста; нет HTTP назначения ролей и свободного чтения переписок администратором. Схемы/коды/маршруты — [SAFETY_STAGE7](SAFETY_STAGE7.md), poidem/schemas/safety.py и OpenAPI локального backend. Существующие API сохраняют историю и применяют блокировку в прямых запросах

Версия 0.10 / D54: GET /me/activity принимает необязательный UUID plan_id для прямого перехода из бота в архив. Роли, scope, скрытие и пагинация сохраняются; cursor привязан к фильтру, прежние cursor без plan_id совместимы. Новых endpoints/операций записи/миграций нет. [Контракт ссылок](BOT_UX.md#прямые-переходы)

Версия 0.9 / D53: новых HTTP-endpoints нет. Бот получает private updates напрямую Bot API, не принимает клиентский Telegram ID через публичный bind API. Прежние команды откликов/решений/чата транзакционно создают notification_jobs; клиенты не назначают kind/recipient/payload. Опрос и настройки доступны командами/кнопками бота, каждый callback проверяет участника и срок. Существующие защищённые маршруты Mini App сохраняются. [События, поля и гарантии](BOT_STAGE6.md)

Версия 0.8 / D52: endpoints и миграции прежние. ResponseDTO дополнен display_status (waiting|accepted|rejected|closed|expired|cancelled|unavailable) и decided_at (nullable UTC). status по-прежнему отражает БД; expired/cancelled/unavailable вычисляются только для waiting и не записываются как статусы отклика. GET /plans/{id}/responses с limit/cursor читается автором и для архивного плана, включая все результаты; чужой пользователь — 404, без сессии — 401. GET /me/activity активного scope больше не выдаёт истёкшие outgoing как активные. [Поля, семантика и права](RESPONSE_HISTORY_UX.md#api-и-хранение)

Версия 0.7 / D51 / migration 0006: endpoints прежние. ResponseDTO дополнен viewer_role (author|responder), history_context и match для accepted. MatchDTO содержит viewer_role. История отказа использует неизменяемый минимальный снимок, у rejected отправителю plan/profile остаются null. Все права/CSRF/квоты и D50 сохраняются. [Поля и семантика](CARDS_UX_REVIEW.md#изменённые-данные-и-api)


Версия 0.6 / D50 / migration 0005: rejected окончательный; отклонённому план и публичный контекст недоступны, ResponseDTO.plan/profile=null. 15 ожидающих, место освобождается только другим людям. Реализованы /matches/{id}/chat, /messages, /read, GET /me/activity и POST /me/archive/{plan_id}/visibility. [Полный действующий контракт и пагинация](CHAT_ARCHIVE_STAGE5.md#api). Предыдущие описания повторной попытки и обязательной связи через Telegram заменены D50


Версия 0.5 / D49: [действующий API откликов/мэтчей](MATCHES_STAGE5.md#api). Лимит теперь 15 одновременно ожидающих, отказ освобождает слот; попытки сохраняются отдельно. Один Match на план, контекстные public profile/photo, контакт только участникам. POST отклика: expected_plan_version и UUID Idempotency-Key; решение автора: expected_version/decision. Следующие старые предположения о 15 исторических людях и нерешённой кратности мэтчей заменены D49.

D48: клиент показывает полные ошибки текста при вводе по генерируемой политике, но сервер независимо применяет те же ограничения на POST/PATCH/publish. Расширены формы названий локаций и наркотиков, сохранены нейтральные обсуждения. HTTP/DTO не менялись, новых endpoints для отправки текста на каждый символ нет. [Правила и синхронизация](CONTENT_FILTER.md).

D47, 23.11.2026: при создании, PATCH и публикации планов действует расширенный [фильтр содержания](CONTENT_FILTER.md). Мат/оскорбления и явные опасные предложения возвращают HTTP 422 `PLAN_CONTENT_REJECTED` с безопасной причиной и словарём `fields` для title/description/place. Это не блокировка аккаунта и не новая стадия модерации. Неуспешное создание не расходует квоту, отклонённое изменение не заменяет сохранённый план. DTO и endpoints не изменены.

Версия 0.4, этап 4: реализованы пользовательские планы. Действующие DTO, статусы, обязательный Idempotency-Key создания, квота Europe/Moscow и команды перечислены в [PLANS_STAGE4](PLANS_STAGE4.md#api). Реализованы GET/POST /plans, GET/PATCH /plans/{id}, POST /plans/{id}/publish и /cancel, GET /me/plans и /me/quotas. Запись — сессия/Origin/CSRF; автор только из сессии, extra-поля запрещены. Коллекции items/next_cursor, limit 1–50. Отменённый статус cancelled, отдельного DELETE плана нет. Справочники включают четыре категории и business_operations_enabled:true (это не означает готовность откликов/мэтчей). Следующие версии 0.3 и таблицы полного MVP сохраняются как история/проект будущих операций; для реализованного этапа приоритетен блок PLANS_STAGE4.

Уточнение D43: демонстрационный режим удалён. Единственный пользовательский источник — защищённый API; fixtures/старые localStorage-флаги не являются fallback. Без бизнес-API выдача планов/мэтчей пустая. Синтетические записи разрешены только в тестовой БД.

Версия 0.3, 20.11.2026. **Реализованы health/ref, auth и собственная анкета/фото/удаление; остальной контракт — план полного MVP.** Открытые B-вопросы — [архитектура](BACKEND_ARCHITECTURE.md#7-противоречия-и-решения-до-реализации); данные — [схема](DATABASE_SCHEMA.md), права — [SECURITY](SECURITY.md), текущий протокол/настройки — [TELEGRAM_AUTH](TELEGRAM_AUTH.md).

Действуют `GET /health`, `/health/ready`, `/health/live`, `/api/v1/reference-data`, а также перечисленные в разделе 2 auth endpoints и собственные `/me/profile`, `/me/photos`, `/media/photos/{photo_id}`, `DELETE /me` (алиас DELETE /me/profile). Персональные операции защищены сессией/владельцем; запись — Origin/CSRF. Бизнес-API планов и далее отвечают 404, не имитируют успех. Справочники возвращают `{code,title}`, 3/15 и business_operations_enabled:false; policy_version не выдумывается. В dev фактический OpenAPI — /openapi.json, Swagger — /docs; production их отключает.

## 1. Общие соглашения

- Base path: `/api/v1`; JSON UTF-8, snake_case, идентификаторы экземпляров ресурсов — UUID; неперсональные справочники используют строковые коды, например art. Telegram ID не является ID в URL и не принимается как actor
- API определяет пользователя из серверной сессии. Предложение — HttpOnly cookie на согласованном same-origin/same-site размещении, `credentials: include`; детали B14 должны быть согласованы до production
- Запросы записи после входа содержат `X-CSRF-Token`; login проверяет Origin и формат запроса. Токены сессии не возвращаются в JSON и не кладутся в localStorage
- Время — RFC3339 с offset, хранение UTC. Для пользовательской встречи передаётся также IANA `time_zone`; нельзя интерпретировать голое `date + time` в часовом поясе API-хоста
- Коллекции: `{ "items": [], "next_cursor": null }`, стабильный порядок по времени/UUID. Предложение: limit по умолчанию 20, максимум 50; это технические параметры пагинации, не новый бизнес-лимит
- Входные DTO запрещают неизвестные поля. `author_id`, `responder_id`, `telegram_id`, `role`, `is_demo`, статусы проверки и числовой рейтинг не назначаются из клиентского JSON
- Для JSON-ответов с персональными данными — `Cache-Control: no-store`. DTO из явного списка полей; ORM-объект целиком не сериализуется
- `GET /reference-data` возвращает актуальные справочники, public policy_version и лимиты **3/15**. Статические значения frontend не авторитетны. Недостающая обязательная policy не получает случайный default

В примерах только вымышленные UUID и строки, без настоящих initData, Telegram ID или контактов. Пример `Europe/Moscow` показывает формат, не выбирает часовой пояс пилота.

## 2. Аутентификация

| Метод/путь | Реализованное поведение |
| --- | --- |
| POST `/auth/telegram` | Принять единственное поле init_data, проверить подпись и свежесть, создать/найти пользователя и серверную сессию; 200 + Set-Cookie |
| GET `/auth/csrf` | `{csrf_token,user_id}` текущей сессии, без анкеты; клиент проверяет принятие cookie и UUID контекста; 200 |
| POST `/auth/logout` | Отозвать текущую сессию, удалить cookie; 204, повторный выход не удаляет анкету/планы |
| GET `/me` | `{user:{id,account_status},authorization:{method,verified_at},csrf_token,profile}`; профиль null или OwnProfileDTO; без сессии 401 |

```json
{
  "init_data": "<raw Telegram.WebApp.initData, не initDataUnsafe>"
}
```

Проверка следует [официальному Telegram протоколу](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app). Настраиваемые defaults: initData 300 секунд, future skew 30 секунд, сессия 86400 секунд. Подделка/истечение — 401; отсутствующий JSON-параметр или пустая строка — 422; отсутствующая настройка bot token — 503 для непустого запроса. Недоступный SDK не создаёт фиктивный вход. Demo остаётся локальным источником.

Реализованный ответ входа (неперсональный пример):

```json
{
  "user": { "id": "11111111-1111-4111-8111-111111111111", "account_status": "active" },
  "authorization": { "method": "telegram_init_data", "verified_at": "2026-11-20T10:00:00Z" },
  "session_expires_at": "2026-11-21T10:00:00Z",
  "csrf_token": "<непрозрачное значение только для памяти клиента>",
  "profile": null
}
```

HttpOnly cookie содержит opaque session token, JSON его не возвращает. Статус подтверждает происхождение данных, не паспорт/возраст. Frontend verified содержит внутренний userId; initDataUnsafe не используется. Logout отзывает только текущую сессию и возвращает 204; запрос с уже отсутствующей сессией — 401, который клиент считает завершённым выходом.

## 3. Реестр ресурсов

Реализованы собственная анкета/фото и удаление. Остальные строки реестра — будущий контракт. Фото сейчас доступно только владельцу; разрешённый просмотр кандидатами ещё не реализован. `DELETE /me` и алиас `DELETE /me/profile` удаляют аккаунт приложения/анкету/фото/все сессии: 200 `{deleted:true,media_cleanup_pending:false}`, 202 при отложенной очистке файлов; 409 ACCOUNT_HAS_RELATED_DATA до любых изменений при будущей совместной истории. Ошибки привязки чужого фото — 404, некорректные поля — 422, устаревшая версия — 409; размеры — 413, неподдерживаемый MIME — 415, технические rate limits — 429 + Retry-After.

U — серверно аутентифицированный пользователь; A — активный пользователь с полной анкетой и разрешениями действующей policy; O — владелец объекта; M — один из двух участников соответствующего мэтча; ADMIN — проверенное сервером административное право. Группы не являются клиентскими флагами. Права заблокированного аккаунта на историю/контакт/опрос требуют B06; `/me` и logout не должны лишать его информации о состоянии входа.

| Метод/путь | Кто | Назначение/результат |
| --- | --- | --- |
| GET `/reference-data` | Без персональных данных | Категории, интересы, согласованные gender/preference codes, ограничения и policy_version |
| GET `/me/profile` | U | `{ "profile": null }` при первой регистрации либо собственная полная анкета |
| PUT `/me/profile` | U | Полное сохранение анкеты, интересов и ссылки на своё фото; 200, конкурентная запись — 409 |
| POST `/me/photos` | U | multipart/form-data, одно file; проверка/сохранение собственного фото; 201 |
| GET `/media/photos/{photo_id}` | O или разрешённый просмотр | Приватная фотография, не публичный storage_key; чужое/запрещённое фото — 404 |
| GET `/me/quotas` | U | Серверная дневная квота и её календарь, reset_at; 200 |
| GET `/plans` | U, по правилам B02/B06 | Опубликованные и доступные caller планы; category_id, опциональные q/starts_from/starts_to по B02, cursor/limit |
| POST `/plans` | U; submit требует A | Новый план/черновик по согласованному B04; 201. submit_for_publication позволяет выполнить create+submit одной транзакцией |
| GET `/plans/{plan_id}` | O либо разрешённый читатель | Детали и capacity; приватный черновик виден только O |
| POST `/plans/{plan_id}/submit` | O и A | Отправить существующую версию на согласованную модерацию; 202, не фиктивная мгновенная публикация |
| GET `/plans/{plan_id}/author` | Разрешённый читатель | CandidateProfile автора этого доступного плана; без Telegram-контакта |
| GET `/me/plans` | U | Собственные планы. Состав других вкладок уточняется B03, не смешивается с чужими черновиками |
| POST `/plans/{plan_id}/responses` | A, не автор | Создать один отклик, занять место; 201; существующий отклик caller — 200 без нового места |
| GET `/plans/{plan_id}/responses` | O | Все доступные отклики с минимальными анкетами кандидатов; максимум 15 занятых мест не означает скрыть исторические записи |
| GET `/me/responses` | U | Собственные outgoing либо incoming на свои планы, фильтр direction; список, не одна запись |
| POST `/responses/{response_id}/decision` | O плана | accept/decline. Только accept атомарно создаёт парный мэтч; 200 |
| GET `/me/matches` | U | Все мэтчи caller, pagination; не `.find()` по плану |
| GET `/matches/{match_id}` | M | Два участника и серверный контекст встречи; чужой caller — 404 |
| GET `/matches/{match_id}/contact` | M, разрешённая policy | Контакт только другого участника после мэтча; отдельный запрос, не часть каталога |
| POST `/reports` | U | Жалоба на пользователя или план, 201; не автоматическая блокировка/штраф |
| GET `/matches/{match_id}/survey` | M | Статус/доступность опроса caller; без ответа другого участника |
| POST `/matches/{match_id}/feedback` | M, опрос доступен | Ответ caller на опрос, 200/201; формат шкалы/изменений gated B09 |
| POST `/events` | U | Только согласованные клиентские события, например contact_link_clicked; 202, не произвольная доменная аналитика |
| GET `/admin/me` | ADMIN | Разрешённые функции панели, без секретов |
| GET `/admin/reports` | ADMIN | Очередь жалоб, фильтры/пагинация |
| GET `/admin/moderation-cases` | ADMIN | Очередь модерации без выдуманных стадий |
| POST `/admin/moderation-cases/{id}/decision` | ADMIN | Действие по согласованному B06 workflow и версии объекта; аудит |
| POST `/admin/users/{user_id}/restriction` | ADMIN | Согласованная блокировка/снятие, причина/версия; аудит |
| GET `/admin/analytics` | ADMIN | Только утверждённые B12 агрегаты и границы периода |

Отдельно: `GET /health/live` — жив ли процесс; `GET /health/ready` — готовность БД/миграций/обязательных настроек, 200 или 503 без подробностей подключения. Это не существующие URL.

Произвольный `GET /users/{id}` со всеми полями не предлагается. Контекст автора ограничен доступным планом, входящего кандидата — правом автора увидеть отклик; административный доступ к жалобе не открывает контакты участников.

## 4. DTO и соответствие прототипу

### Анкета и фото

PUT `/me/profile`:

```json
{
  "expected_version": 0,
  "name": "Пример",
  "age": 24,
  "gender_code": "woman",
  "preference_code": "any",
  "bio": "Описание для примера",
  "photo_id": "55555555-5555-4555-8555-555555555555",
  "interest_ids": ["art", "coffee", "cinema"]
}
```

0 создаёт первую версию; последующая запись передаёт version прочитанного профиля. Реализованы собственный photo_id, ровно три разных включённых интереса и поля прежней формы: имя 1–40, bio 1–300, фото 3 МиБ. Возраст — строго целый 18+ **без верхней продуктовой границы**, по явному ответу пользователя. Технически число должно точно представляться в JavaScript (до 2^53−1).

Реализованный OwnProfileDTO: user_id, name, age, gender_code, preference_code, bio, photo:{id,url}, interest_ids, version, moderation_status. GET/PUT /me/profile возвращают `{profile:...}`. CandidateProfile для будущей выдачи ещё не реализован; он должен исключать предпочтения, chat_id, Telegram ID, initData и контакт.

Реализованный PhotoDTO: `{id,url}`. `url` — относительный `/api/v1/media/photos/{id}`, не путь диска; frontend разрешает его относительно origin API. При multipart допускается ровно одно поле file, JPEG/PNG/WebP; проверяются фактическое содержимое/16MP и перекодирование без metadata. Успешное декодирование не является модерацией. Preview находится в памяти, не в localStorage.

ExperienceDTO по D58: `{ "unique_confirmed_partners": 0, "policy_version": "D58-mutual-unique-partners-v1" }`. Число считается по двум завершённым Да для уникальных серверных UUID партнёров, без среднего рейтинга/ярлыка. Клиент не отправляет счёт, версию или source:server. Прежний проект ReliabilityDTO не применяется к этому endpoint.

### План

POST `/plans`:

```json
{
  "title": "На выставку",
  "category_id": "art",
  "starts_at": "2026-12-01T19:00:00+03:00",
  "time_zone": "Europe/Moscow",
  "place": "Галерея — пример места",
  "description": "Посмотреть выставку вместе",
  "submit_for_publication": true
}
```

Сервер создаёт id, author_id, created_at и статусы; проверяет согласованную календарную policy и содержание title/description. Поля `date/time` frontend преобразуются в starts_at/time_zone адаптером. Проверяются несогласованный offset, несуществующее локальное время DST и дата в прошлом согласно B07; время не исправляется молча. Собственная геолокация не добавляется.

PlanDTO: `{id, author:{id,name}, title, category, starts_at, time_zone, place, description, cover_url, publication_status, moderation, version, created_at, response_capacity}`. `cover_url` выбирает сервер из утверждённых статических ресурсов; пользовательская загрузка фото плана не заявлена. `own` вычисляет frontend сравнением author.id и собственного server user_id. `label` прототипа — оформление/редакционный контент, не произвольное правило мэтчинга.

Предложенные publication_status: draft/submitted/published/closed. Закрытие/изменение плана и условия публикации требуют B06/B07; endpoint редактирования/отмены **не предлагается как утверждённая функция**. moderation имеет not_submitted/pending/approved/rejected/blocked и reason, но эти слова не определяют два этапа проверки. DTO строится только из разрешённой версии, не из необработанного изменения под старым approved.

QuotaDTO: `{day, time_zone, used, remaining, limit:3, resets_at, policy_version}`. ResponseCapacityDTO: `{count, limit:15, remaining, can_respond, already_responded, policy_version}`. Все значения серверные; показывается именно согласованная семантика B04/B05. Повтор submit того же ресурса не создаёт второй plan_id; расход квоты определяется выбранным событием B04, не числом HTTP-запросов.

### Отклик и мэтч

POST response принимает `{ "expected_plan_version": 1 }`; responder определяется сессией. Сервер под блокировкой сверяет увиденную версию, сохраняет agreed_plan_version и не принимает согласие на незаметно изменившийся план: конфликт — 409. ResponseDTO: `{id, plan_id, agreed_plan_version, responder_profile, status, created_at, version, match_id:null}`. Публичный счётчик не раскрывает всех откликнувшихся; список кандидатов получает только автор.

```json
{
  "decision": "accept",
  "expected_version": 1
}
```

При accept ответ содержит ResponseDTO и MatchDTO. `MatchDTO = {id, plan_id, response_id, participants:[CandidateProfile,CandidateProfile], meeting_context, created_at}`. participants всегда ровно два различных человека: автор этого плана и этот откликнувшийся. Повтор того же решения возвращает уже созданный match_id; противоположное решение по разрешённому отклику даёт 409. Кратность мэтчей на план не решена: до B03 нельзя добавлять UNIQUE(plan_id) или принимать несколько кандидатов как неявный default.

`meeting_context` сохраняет принятую серверную версию даты/зоны/места. При принятии проверяется, что согласие откликнувшегося относится к этой же версии; изменение не превращается в молчаливое новое согласие. Политика изменения/повторного согласия требует B07. Поля контакта не включаются в MatchDTO автоматически.

Пример формы ContactDTO без выдуманного Telegram-перехода:

```json
{
  "available": false,
  "telegram_url": null,
  "reason": "username_missing"
}
```

При доступности сервер возвращает allowlisted Telegram URL другого участника. Fallback без username/приватность — B08, не самодельный `t.me/<числовой-id>`.

### Жалоба, опрос и события

ReportCreate: `{target:{type:"user"|"plan",id}, reason_code, comment}`. Actor, status и решение не принимаются от клиента; reason_code/границы комментария согласуются B06. Повтор HTTP-запроса с тем же ключом не создаёт вторую жалобу; разрешены ли новые жалобы об иной ситуации — отдельная policy.

FeedbackWrite по D53/D58: `{met:boolean,rating:null|integer(1..5),comment:null|string(до 2000)}`; match_id только в URL, сторона выводится из серверной сессии. Да требует оценку, Нет не принимает оценку/комментарий; extra=forbid. У каждого участника прежняя отдельная запись; отсутствие/незавершённость не становятся met:false. Бот и HTTP сериализуют прежний Survey. Результат — SurveyDTO с собственным ответом и общим итогом, без чужих индивидуальных оценок/комментариев.

`POST /events`: только allowlist B12, например `{event_id, type:"contact_link_clicked", match_id}` после разрешённого контакта. user_id и время задаёт сервер; снаружи нельзя заявить plan_created, match_created, meeting_confirmed, произвольную оценку или событие от другого пользователя.

## 5. Запись, повторы и гонки

Для создающих ресурсов команд предлагается `Idempotency-Key` (UUID), scope — actor + method + path. Сервер сохраняет hash нормализованного запроса и ссылку на ресурс/безопасный результат в одной транзакции с записью. Та же команда возвращает тот же ресурс и не тратит новую квоту; тот же ключ с другим body — 409. Перед повторной выдачей проверяются актуальные права; DTO может отражать текущее состояние, а закрытый контакт/токен/анкета не сохраняется как неограниченный кеш ответа. Срок хранения ключей требует технической настройки B14 и не может быть короче обещанного окна повторов. Ключ не предоставляет авторизацию и не позволяет получить результат чужой сессии.

`expected_version` предотвращает перезапись изменившегося объекта. Обновление проверяет версию атомарно. Повтор идентичного уже выполненного решения идемпотентен, а не создаёт второй мэтч. Ошибка транзакции не оставляет списанную квоту/уведомление без ресурса. После неизвестного результата сети клиент повторяет исходный ключ, не генерирует новый план автоматически.

Политики B03–B07 не закрываются этим механизмом: запрет четвёртого создания и шестнадцатого места реализуется БД/сервисом, не disabled-кнопкой и не доверенным клиентским count.

## 6. Ошибки и состояния UI

```json
{
  "error": {
    "code": "PLAN_DAILY_LIMIT_REACHED",
    "message": "Дневной лимит создания планов достигнут",
    "fields": {},
    "details": { "limit": 3, "remaining": 0 },
    "request_id": "<идентификатор диагностики>"
  }
}
```

| HTTP | Коды/поведение |
| --- | --- |
| 401 | AUTH_REQUIRED / TELEGRAM_AUTH_INVALID / TELEGRAM_AUTH_EXPIRED / SESSION_EXPIRED; очистить real cache, не включать demo |
| 403 | ACCOUNT_BLOCKED / ADMIN_REQUIRED / CSRF_INVALID; права не выводятся из видимости кнопки |
| 404 | RESOURCE_NOT_FOUND для отсутствующего или недоступного caller приватного объекта |
| 409 | PLAN_DAILY_LIMIT_REACHED, PLAN_RESPONSE_LIMIT_REACHED, PLAN_NOT_OPEN, RESPONSE_STATE_CONFLICT, VERSION_CONFLICT, IDEMPOTENCY_CONFLICT |
| 413/415 | PHOTO_TOO_LARGE / PHOTO_TYPE_UNSUPPORTED |
| 422 | VALIDATION_ERROR / PLAN_CONTENT_FORBIDDEN / PROFILE_REQUIRED; понятные field-errors, введённый текст не стирается |
| 429 | REQUEST_RATE_LIMITED и Retry-After; это rate limit, а не бизнес-квота 3/15 |
| 503 | SERVICE_UNAVAILABLE; готовность обязательной policy проверяется до выпуска функции, не заменяется поддельным успехом |

Ошибки не содержат сырой ввод, initData, фотографии, токены, SQL/stack trace или существование чужой анкеты. Поле `details` имеет allowlist. Frontend сохраняет введённый текст, показывает имеющиеся error/toast/loading состояния, перечитывает серверную квоту при конфликте. Модераторская причина показывается только разрешённой аудитории.

## 7. Что ещё не зафиксировано

До B01–B14 нельзя считать контракт полного MVP стабильным OpenAPI. Фактический OpenAPI текущего каркаса генерируется FastAPI; health/reference-data проверены pytest и живыми HTTP-запросами. Персональные маршруты/DTO/адаптеры далее проверяются при реализации после согласования; несовместимые изменения выпускаются новой версией API. Административная панель, жалобы, опрос и настоящая надёжность пока не имеют пользовательских компонентов — их появление требует отдельных этапов ROADMAP, а не заявления, что нынешний frontend уже готов полностью.


Уточнение 11Б / 27.11.2026: GET /me/photo-verification дополнительно возвращает read-only retention={pending_hours,reviewed_hours} либо null при выключенной функции; клиент показывает актуальные сроки до согласия. GET /admin/photo-verifications возвращает waiting_minutes для каждой заявки, вычисленное на сервере и ограниченное снизу нулём. Эти поля не принимаются в командах и не добавляют новых бизнес-статусов/прав.
