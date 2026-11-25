# Backend: выполненный этап 3.2

D55 / этап 7: реализованы жалобы, персональные ограничения, закрытые административные API и /admin. Head 0008, прежние 33 таблицы. Проверки и точные команды запуска/назначения роли — [SAFETY_STAGE7](SAFETY_STAGE7.md). Не запускать старый backend с новой frontend-функцией до применения миграции; production не меняется

Этот отчёт описывает завершённый каркас 3.2 (revision 0001). Последующие Telegram-вход/анкета/фото/удаление и revision 0002 описаны в [TELEGRAM_AUTH](TELEGRAM_AUTH.md); действующий запуск — [backend/README](../backend/README.md).

Дата: 20.11.2026. Основание — отдельная команда пользователя реализовать серверный каркас по архитектуре. Commit, push и внешняя публикация не выполнялись. Frontend/references не редактировались.

## Что реализовано

- `backend/`: устанавливаемый Python-пакет `poidem`, FastAPI app factory, Pydantic Settings/DTO, async SQLAlchemy 2 + psycopg 3, синхронный Alembic
- 27 таблиц: users/auth_sessions, photos/profiles/справочники/interests, plans/daily_plan_usage/plan_responses/matches, moderation_cases/decisions/reports/restrictions, bot_bindings/notification_jobs/telegram_updates, surveys/recipients/feedback_answers/reliability_events, analytics_events/admin_audit_log/idempotency_records
- UUID, Telegram BIGINT, UTC TIMESTAMPTZ; RESTRICT FK, уникальность аккаунта/отклика/мэтча/событий/уведомлений, владение фото, составные ссылки авторства/участников, частичный UNIQUE по занятому слоту и CHECK подтверждённых границ
- Явная revision `0001`, согласованная с metadata; без `create_all`, скрытых автоматических миграций и demo seed
- `compose.yaml`: PostgreSQL `db`, изолированная `db-test` в tmpfs, runtime `api`, отдельный `migrate`, Linux `test`. Основной volume сохраняется; порты привязаны к loopback
- Три разные роли PostgreSQL: bootstrap-admin, migrator без superuser/CREATEDB/CREATEROLE, app без DDL. App читает справочники/версию Alembic, история аудита/решений доступна ему только на добавление/чтение. Runtime-контейнер не получает пароль мигратора
- GET `/health`, `/health/ready` проверяют доступность БД и revision; `/health/live` — жив ли процесс; `/api/v1/reference-data` — только включённые неперсональные коды/подписи. До наполнения массивы пусты
- Безопасный формат ошибок, серверный request_id, no-store/nosniff, JSON-логи без query/тела/SQL/паролей. Проверка Host, точный CORS, строгая production-конфигурация без wildcard/local defaults; Swagger/OpenAPI только вне production
- `.env.example` с пустыми секретами, безопасный PowerShell-инициализатор игнорируемого `.env`, runtime/dev lock-файлы, непривилегированные Docker targets. Правило LF для Linux init-скрипта после Windows checkout

Точный состав файлов и все команды PowerShell — [backend/README](../backend/README.md). Порт API **8001** выбран потому, что 8000 занят другим приложением; этот контейнер не изменялся.

## Фактически выполненные проверки

| Проверка | Результат |
| --- | --- |
| Создание `.venv`, установка зависимостей | Выполнены на Python 3.13.5/Windows; реальные локальные пароли сгенерированы, не записаны в пример/логи |
| PostgreSQL/Compose | Docker Engine запущен; db и db-test достигли healthy. Сервер PostgreSQL 17.12 |
| Alembic upgrade | Revision 0001 применена к основной и отдельной тестовой БД; повтор upgrade идемпотентен |
| Alembic check | Обе БД соответствуют metadata: `No new upgrade operations detected` |
| Downgrade → upgrade → check | Выполнены только на изолированной тестовой БД после проверки, что все прикладные таблицы пусты; ошибок нет |
| pytest Windows | **62 passed** на настоящей PostgreSQL, предупреждения считаются ошибками |
| Unit-only | **16 passed, 46 deselected**, без запросов к БД |
| pytest Linux Docker | **62 passed**, Python 3.13.18, отдельная тестовая БД; dev lock установлен в новом image, старый httpx отсутствует |
| Docker build | Runtime api/migrate и test targets собраны успешно |
| Docker migrate/API | Миграции выполнены отдельным контейнером; runtime API достиг healthy; живой HTTP `/health` вернул 200 |
| Нативный FastAPI/HTTP | Команда `python -m poidem`; `/health` вернул `{status:ok,database:ready,migrations:current}`, reference-data — пустые массивы и `business_operations_enabled:false` |
| Основные данные | В рабочей локальной БД users/plans/matches = 0; тестовые/демоанкеты в неё не импортировались |
| Ruff | `check` и `format --check` пройдены, 34 Python-файла отформатированы |
| Зависимости | Editable-install обновлён после pyproject; `pip check`: `No broken requirements found` |
| Frontend/references | SHA-256 всех 78 защищённых файлов совпадает, новых файлов в этих каталогах нет |
| Документы и секреты | 92 локальные ссылки/якоря корректны; сгенерированные пароли не найдены в Git-visible файлах, `.env` и `.venv` игнорируются; `git diff --check` без ошибок |

Проверены реальные нарушения FK/UNIQUE/CHECK, разные роли и запрет DDL/изменения аудита, Telegram ID больше 32 бит, авторский отклик/неверный автор, 15 занятых слотов и коллизии, подмена третьего участника мэтча, чужая фотография, дубликаты событий/уведомлений, максимум двух адресатов опроса и неизвестный факт встречи. API-тесты проверяют health/ревизию/недоступную БД, CORS/Host, отсутствие публичного персонального CRUD, скрытие validation input/исключений, request_id и публичные справочники.

## Найденные и исправленные проблемы запуска

1. Установленная Starlette требует новый httpx2 для TestClient. Первый запуск pytest остановился на deprecation warning; зависимость заменена и закреплена, предупреждение не подавлялось.
2. Uvicorn 0.54 выбирает Windows ProactorEventLoop даже при прежней настройке policy. API-тесты с SelectorEventLoop проходили, но живой HTTP первоначально вернул 503/InterfaceError. Команда запуска теперь передаёт явную `poidem.runtime:loop_factory`, создающую SelectorEventLoop. Регрессионный тест проверяет именно конфигурацию CLI. После исправления нативный HTTP и Linux-контейнер проверены успешно.
3. PowerShell запрещает исполнение `.ps1` политикой по умолчанию. Инициализатор запускается в отдельном процессе с `-ExecutionPolicy Bypass`, не меняет постоянную системную политику и сохраняется с UTF-8 BOM для русских сообщений PowerShell 5.1.

## Что ещё не реализовано

Нет Telegram-авторизации, cookie-сессий/CSRF и проверок прав пользовательских HTTP-команд: сами эти маршруты пока отсутствуют. Не реализованы загрузка/обработка фото, создание/поиск/публикация пользовательских планов, реальные отклики/мэтчи/контакты, moderation workflow, бот/worker/доставка, опрос, формула надёжности, расчёт дипломных показателей и admin UI. Тесты текущих таблиц не засчитываются за проверку отсутствующих бизнес-сервисов или настоящих клиентов Telegram.

В частности, CHECK `used<=3` и слоты 1–15 защищают данные, но сами по себе не расходуют квоту и не определяют её календарь. Уникальность/позиции интересов не гарантируют минимум три без сервисной транзакции. FK мэтча не доказывает личность нажавшего кнопку. Возраст 18+ в SQL не решает вопрос реалистичного верхнего предела. Эти ограничения описаны в [DATABASE_SCHEMA](DATABASE_SCHEMA.md); B01–B14 остаются открытыми до зависимых функций.

Frontend пока использует прежний локальный/демонстрационный provider; сетевого подключения и автоматического переноса localStorage в PostgreSQL нет. Поэтому работающая БД не превращает текущую форму в реальную регистрацию и не делает демонстрационные мэтчи настоящими.

Frontend TypeScript/ESLint/build/браузерные тесты в этом серверном задании не запускались: исходники/ресурсы frontend не менялись, сохранность проверена хешами. Настоящий Telegram и production-инфраструктура не проверялись. Проверочный API после HTTP-проверок остановлен, чтобы освободить порт 8001; локальные db/db-test оставлены запущенными. Все команды для повторного запуска приведены в backend/README.

Ближайший следующий этап — 3.3: серверная Telegram-авторизация/сессии/права после уточнения B14, затем анкеты/фото и API-адаптер с сохранением дизайна. Бизнес-политики B01–B13 согласуются до соответствующих команд. Автоматическая публикация не выполняется.
