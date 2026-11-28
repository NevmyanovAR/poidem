# Серверная основа «Пойдём?»

Production VPS подготовлен отдельно от локального compose.yaml: [PRODUCTION_DEPLOYMENT](../docs/PRODUCTION_DEPLOYMENT.md). Не сливать Compose-файлы, не переносить локальный .env, не запускать второй polling и не публиковать8001/5432. Head0014; production пока не развёрнут

**D67 / этап 11В — актуальные требования:** свободные название/адрес без предварительного одобрения; необязательная проверка точной версии места, 0014/39 таблиц. Каталог D66 и исторические адреса сохранены, но не блокируют публикацию. Репутация — три независимых положительных признака, прежние фото/встречи + добровольные впечатления разных партнёров; старые приватные оценки не используются. [Устройство, формулы и API](../docs/FREE_PLACES_REPUTATION_STAGE11V.md)

**D66 / предыдущая реализация:** собственный каталог общественных мест без 2ГИС/внешних ключей, ручная модерация/CSV/0013 (38 таблиц), исторические адреса сохранены. Фотоверификация — компактный UI без изменения backend-проверки. Это заменяет прежние условия внешнего Places API. [Реализация, API и запуск](../docs/LOCAL_PLACES_AND_VERIFICATION_UX.md)

**D65 / head 0012:** ручная фотоверификация подготовлена в прежнем монолите, сбор по умолчанию выключен. Текст/сроки/согласование обязательны, значения в тестах не продуктовая политика. [Настройки, миграции и запуск](../docs/PHOTO_VERIFICATION_STAGE11B.md)

**D64 / история этапа 11А, head 0011:** прежняя внешняя интеграция заменена D66/D67. Старые миграции и адреса сохраняются; ключей и предварительной проверки для новой публикации не требуется. [Точные настройки, API и команды](../docs/PLACES_STAGE11A.md)

Этап 9Б / D62: head **0010**, редакционные идеи, команда/роли и heartbeat прежнего бота. Перед новым запуском применить миграцию; owner автоматически не назначается. [Матрица прав, CLI первого owner, API, резервные копии и проверки](../docs/ADMIN_STAGE9B.md)

Этап 7 / D55: миграция **0008**, жалобы/блокировки и административная очередь. Существующие PostgreSQL, сессия/CSRF и bot worker сохранены. Сначала `python -m alembic -c backend/alembic.ini upgrade head` из корня. Локальная команда роли — `python -m poidem.admin --help`. [API, безопасное назначение, PowerShell и ручной прогон](../docs/SAFETY_STAGE7.md)

D53 / этап 6 / revision 0007: aiogram-бот и worker в одном процессе `python -m poidem.bot`; `/start`, управление уведомлениями, transactional outbox, согласованный опрос. Прежние 33 таблицы/пользователи/сессии, frontend не меняется. [Все команды PowerShell, env и настоящая доставка](../docs/BOT_STAGE6.md)

D51 / revision 0006: исправления серверных DTO ролей и минимальной истории отказов; прежние API/таблицы/сессии, без новых бизнес-операций. Исторический поздний перенос отдельно согласован и отмечен source=legacy. [Изменения, проверки и запуск](../docs/CARDS_UX_REVIEW.md)


Дополнение этапа 5 / D50 / revision 0005: окончательный отказ по плану, 15 ожидающих, текстовый чат пары, прочитанность, автоматический архив и персональное скрытие, серверная пагинация «Все». 33 таблицы, прежние пользователи/планы/сессии. [API, миграция, проверки и PowerShell](../docs/CHAT_ARCHIVE_STAGE5.md). Технический антиспам CHAT_MESSAGES_PER_MINUTE=30. Бот/rating/admin UI не входят в этот объём


Этап 5 / revision 0004: реальные отклики, освобождение слота после отказа, история попыток, одна подтверждённая пара, контекстные публичные анкеты/фото и отдельный контакт после мэтча. Новых таблиц нет. [Контракт, PowerShell, проверки и сценарий двух Telegram-аккаунтов](../docs/MATCHES_STAGE5.md).

Реализованы этапы 3.2–3.5 и 4: серверная основа, Telegram-вход, анкета/фото и настоящие пользовательские планы с каталогом, квотой, фильтром, редактированием и отменой. Протокол авторизации — [TELEGRAM_AUTH](../docs/TELEGRAM_AUTH.md); точные API, правила, PowerShell и проверка планов двумя аккаунтами — [PLANS_STAGE4](../docs/PLANS_STAGE4.md). Миграция 0003, 29 прежних таблиц.

Служебные endpoints/справочники открыты. Персональные API и планы защищены сессией/правами владельца; запись проверяет Origin/CSRF. Переданный отдельно Telegram ID/роль не дают доступа. Настоящий вход проверен на двух аккаунтах через временный Quick Tunnel; production не публиковался. Отклики/мэтчи, бот и admin UI ещё не реализованы. Без токена login возвращает безопасный 503; скрытый ввод — scripts/Set-TelegramToken.ps1.

## Требования

- Windows PowerShell 5.1+; Python **3.13**, Docker Desktop с Linux containers и Compose v2+
- Порты: основная БД `127.0.0.1:5432`, отдельная тестовая `127.0.0.1:5433`, API `127.0.0.1:8001`. Порт 8000 занят другим локальным проектом и не используется
- Node/frontend запускаются по прежней инструкции, независимо от backend

Зависимости закреплены в `requirements.lock` и `requirements-dev.lock`. FastAPI 0.165.0, SQLAlchemy 2.0.58, Alembic 1.20.1, Pydantic 2.14.4, psycopg 3.3.9, Uvicorn 0.54.0, pytest 9.2.0. Установленная Starlette использует **httpx2** для TestClient; старый httpx не требуется. Runtime image не содержит pytest/Ruff.

## Первичная настройка Windows PowerShell

Все команды ниже выполняются из корня репозитория. Docker Desktop должен быть запущен.

```powershell
Set-Location C:\Users\arthur\Desktop\poidem

# Выполняется один раз; существующий .env не перезаписывается.
if (-not (Test-Path .env)) {
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Initialize-LocalEnvironment.ps1
}

python -m venv .\backend\.venv
.\backend\.venv\Scripts\python.exe -m pip install -r .\backend\requirements-dev.lock
.\backend\.venv\Scripts\python.exe -m pip install --no-deps -e .\backend
```

Скрипт генерирует три случайных локальных пароля, создаёт игнорируемый `.env`, заполняет URLs и ничего секретного не выводит. `ExecutionPolicy Bypass` действует только для запущенного процесса и не меняет системную политику. Активация `.venv` не нужна. При ручной настройке можно скопировать корневой `.env.example` в `.env` и заполнить переменные самостоятельно; незаполненные URL не позволяют запустить приложение.

Runtime URL: `postgresql+psycopg://poidem_app:<локальный-пароль>@127.0.0.1:5432/poidem`. Migration URL использует `poidem_migrator` и другой пароль. Test URLs указывают на порт 5433 и БД `poidem_test`. Пароли с особыми символами в ручных URL кодируются как URL-компонент; генерируемые скриптом hex-пароли этого не требуют.

При изменении POSTGRES_PORT/POSTGRES_TEST_PORT обновите соответствующие URL для нативного Python. BACKEND_PORT меняет порт Compose; для нативного API используйте `--port`.

## Запуск базы данных

```powershell
docker compose up -d --wait db
docker compose ps db
```

Compose ждёт `pg_isready`, привязывает порт только к loopback и хранит основную БД в `poidem_postgres-data`. Init script создаёт bootstrap-admin, отдельного несуперпользователя миграций и runtime-role без CREATE/DDL. API-контейнер не получает пароль мигратора. Справочники изменяются оператором; runtime может только читать их. История аудита и решений модерации доступна runtime только на добавление/чтение, версия Alembic — только на чтение.

Init script выполняется **только на новом volume**. Простое изменение пароля в `.env` не меняет существующие роли: для существующей БД нужен согласованный `ALTER ROLE` через оператора. Не удалять volume с данными ради исправления конфигурации. Здесь нет автоматического удаления БД или seed вымышленных пользователей.

## Применение миграций

```powershell
.\backend\.venv\Scripts\python.exe -m alembic -c .\backend\alembic.ini upgrade head
.\backend\.venv\Scripts\python.exe -m alembic -c .\backend\alembic.ini current
.\backend\.venv\Scripts\python.exe -m alembic -c .\backend\alembic.ini check
```

Текущая revision — `0014`, 39 прикладных таблиц плюс alembic_version; свободные места и репутация — в FREE_PLACES_REPUTATION_STAGE11V. Миграция 0002 добавляет очередь очистки файлов/rate windows, расширяет возраст до BIGINT и заполняет неперсональные справочники прежней формы; людей/планов не создаёт. create_all() не вызывается. Autogenerate требует ручной проверки. Downgrade удаляет таблицы/сужает тип возраста: не применять к рабочим данным без отдельного решения и резервной копии. Предыдущий roundtrip 0001 проверялся только на пустой тестовой БД.

## Запуск backend

```powershell
.\backend\.venv\Scripts\python.exe -m poidem
```

Адрес API: **http://127.0.0.1:8001**. Swagger: **http://127.0.0.1:8001/docs**. Остановка в собственном терминале — Ctrl+C. Другой порт при необходимости: `python -m poidem --port 8003` из установленного окружения.

Используйте именно `python -m poidem`: команда задаёт совместимую с psycopg async фабрику SelectorEventLoop. Прямой запуск стандартного `uvicorn --loop asyncio` в Windows с этой версией Uvicorn выбирает ProactorEventLoop и приводит к отказу подключения; этот случай выявлен живой HTTP-проверкой и покрыт регрессионным тестом. Основания: [psycopg asyncio](https://www.psycopg.org/psycopg3/docs/advanced/async.html), фактический `uvicorn.Config.get_loop_factory` установленной версии.

В другом терминале:

```powershell
Invoke-RestMethod http://127.0.0.1:8001/health
Invoke-RestMethod http://127.0.0.1:8001/health/live
Invoke-RestMethod http://127.0.0.1:8001/api/v1/reference-data
```

- `/health` и `/health/ready`: 200 только при доступной PostgreSQL и текущей revision; иначе безопасный 503
- `/health/live`: жив ли HTTP-процесс, не доказывает готовность БД
- `/api/v1/reference-data`: включённые коды/подписи прежней формы, числа 3/15 и business_operations_enabled:true для планов, четыре категории; вымышленных пользователей/планов нет

## Тесты и линтер

```powershell
docker compose --profile test up -d --wait db-test
.\backend\.venv\Scripts\python.exe -m pytest -c .\backend\pyproject.toml .\backend\tests -q
.\backend\.venv\Scripts\python.exe -m ruff check .\backend
.\backend\.venv\Scripts\python.exe -m ruff format --check .\backend
```

pytest сам применяет Alembic к **DATABASE_URL_TEST / MIGRATION_DATABASE_URL_TEST**. До подключения проверяются разные имена основной/тестовой БД, суффикс `_test`, локальный host и разные роли. Недоступность БД завершает DB-тесты ошибкой, а не незаметным skip. Таблицы создаются миграциями, не подменяются SQLite. Тестовые записи откатываются/удаляются; основной volume не подключается к тестам. `db-test` использует отдельный tmpfs, не годится для хранения нужных данных. Не запускайте параллельно несколько комплектов тестов на одной этой БД.

Только unit-тесты без подключения к PostgreSQL:

```powershell
.\backend\.venv\Scripts\python.exe -m pytest -c .\backend\pyproject.toml .\backend\tests -m "not database" -q
```

## Полностью через Docker

Этот вариант запускает тот же пакет без локального Python. Не запускайте одновременно нативный API и контейнер на одном порту.

```powershell
docker compose --profile app --profile tools build api migrate
docker compose up -d --wait db
docker compose --profile tools run --rm migrate
docker compose --profile app up -d --wait api

docker compose --profile test build test
docker compose --profile test run --rm test
```

Test image устанавливает отдельный dev lock и запускает pytest непривилегированным пользователем; обычный runtime image содержит только серверные зависимости. Миграции не выполняются одновременно стартом каждой копии API.

Остановить контейнерный API: `docker compose --profile app stop api`. Остановить только основную БД: `docker compose stop db`. Не используйте `down -v` для обычной остановки.

## CORS, ошибки и границы безопасности

`CORS_ORIGINS` и `TRUSTED_HOSTS` — JSON-массивы точных origins/имён. Локально разрешены localhost/127.0.0.1:5173/:4173, GET/POST/PUT/DELETE/OPTIONS и credentials; wildcard запрещён. Запись дополнительно требует Origin/CSRF. Production требует HTTPS origins, публичные hosts и Secure cookie, отключает Swagger. MINI_APP_URL/API_PUBLIC_URL/VITE_API_BASE_URL описаны в TELEGRAM_AUTH; сами они не создают Pages proxy.

Ошибки имеют `{error:{code,message,fields,details,request_id}}`. Исходный input/SQL/traceback/секреты не выдаются. JSON-логи содержат метод, шаблон маршрута, status, длительность и серверный request_id, без raw path/query/тела/initData/token. Access log Uvicorn отключён; SQL-параметры скрыты. Персональные ответы/фото — no-store, фотографии доступны владельцу через API, не через статический CDN.

Анкета проверяет целый возраст 18+ без верхней продуктовой границы и ровно три разных интереса, версию и собственный photo_id. В схеме есть counter 0–3/slots 1–15/парность, но расход квот, согласия, модерация и рейтинг требуют следующих сервисов. Удаление аккаунта/фото/всех сессий работает в текущем объёме; будущая совместная история вызывает 409 до любых изменений, пока B13 не согласован.

Структура:

```text
backend/
  src/poidem/{api/routers,schemas,db/models,security,services}/
  src/poidem/{main.py,__main__.py,runtime.py,settings.py,logging.py}
  migrations/{env.py,versions/0001_initial_schema.py,versions/0002_telegram_profiles_and_private_media.py}
  docker/postgres-init.sh
  tests/{conftest.py,test_api.py,test_database.py,test_settings.py,test_runtime.py}
  pyproject.toml, requirements.lock, requirements-dev.lock, alembic.ini, Dockerfile
```

Результаты каркаса — [BACKEND_IMPLEMENTATION](../docs/BACKEND_IMPLEMENTATION.md), текущей авторизации/анкеты — [TELEGRAM_AUTH](../docs/TELEGRAM_AUTH.md); бизнес-контракт будущих этапов — [API_CONTRACT](../docs/API_CONTRACT.md).
