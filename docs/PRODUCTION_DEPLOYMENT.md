# Этап 12 — первое production-развёртывание

Подготовка для HOSTKEY (Нидерланды), Ubuntu 24.04, 212.69.85.148, 2 vCPU / 4 GB / 60 GB / 2 GB swap. Характеристики и серверные Docker 29.10.1 / Compose 5.8.1 получены от пользователя, удалённо не проверялись. Во время этого этапа SSH/VPS/DNS/BotFather не изменялись, commit/push/deploy не выполнялись.

## Обязательные условия перед запуском

1. Выбрать собственный домен приложения и настроить DNS A на `212.69.85.148`; не оставлять AAAA на другой/неподготовленный IPv6. Адрес домена пока не предоставлен. Скрипт требует реальное DNS-имя; HTTPS на одном лишь IP здесь не настраивается
2. Просмотреть, закоммитить и отдельно разрешить отправку проверенного состояния `backend-dev`. В удалённом репозитории пока может не быть всех локальных изменений и новых миграций
3. Подготовить **production**-секреты и почту ACME. Репозиторий публичный: чтение по HTTPS не требует GitHub Deploy Key, PAT или GitHub SSH-ключа. Пароли локальной базы и `.env` разработки не переносить
4. Остановить локальный polling настоящего бота непосредственно перед включением production-бота. Между разными PostgreSQL его advisory lock не защищает от второго polling
5. Определить место хранения **зашифрованной копии вне VPS**, доступ к ключу восстановления и человека, получающего сигналы о проблемах. Успешный `pg_dump` без проверки восстановления не считается готовой системой резервирования
6. Фотоверификация: до отдельного утверждения production-текста согласия, сроков и политики копий сбор выключен. Локальные `pilot-v1`/72ч/0ч не являются production-согласием. Остальная анкета и знакомства работают независимо

Команды ниже предназначены для **будущего запуска оператором**, после подготовки условий и отдельного разрешения развёртывания. В них `APP_DOMAIN` заменяется вашим настоящим доменом.

## Схема и ресурсы

```text
Telegram / браузер → HTTPS Nginx :443
                    ├─ статический frontend (VITE_API_BASE_URL=/api/v1)
                    └─ /api/* → FastAPI :8001 → PostgreSQL :5432
                               ├─ прежние cleanup + archive loops
                               └─ private-media (API, без Nginx)
aiogram polling + NotificationWorker (один bot) → та же PostgreSQL
разовые migrate / ops / certbot → отдельные Compose profiles
```

`compose.production.yaml` — **самостоятельный** файл. Не добавлять к нему `-f compose.yaml`: иначе можно случайно унаследовать dev-порты/сервисы. Проект `poidem-production`, отдельные volumes `postgres-data` и `private-media`; локальные `poidem_*` volumes не используются. Единственные опубликованные production-порты — 80/443 у web, временно 80 у bootstrap. DB/API/bot/migrate/ops не имеют `ports` и Docker socket. Сеть data — internal; API/бот имеют исходящий доступ через edge.

API: один существующий процесс/worker (768 MiB, 1 CPU), bot: один (384 MiB, 0.5 CPU), PostgreSQL17 (1 GiB, shared_buffers256MiB, work_mem4MiB, max_connections40), Nginx128MiB. Лимиты CPU — верхние границы, не резервирование. Около 2.3GiB суммарных runtime-лимитов оставляют место ОС/Docker/кэшу; проверить фактический расход. Сборка Node ограничивает heap1024MiB; на 4GB предпочтительно собирать образы заранее либо последовательно, контролируя RAM/swap. `production.sh build/update` ограничивает параллельную сборку. Swap не заменяет RAM и не гарантирует отсутствие OOM.

API/бот работают прежним UID10001, read-only root, no-new-privileges, без capabilities, writable только `/tmp`/API media. API запускает прежний python -m poidem через exec с umask077 для новых приватных файлов. Боту медиа не подключено. Nginx сохраняет штатный контейнерный master для портов/TLS, не имеет БД/токена/медиа. Runtime не получает пароль мигратора или superuser. Их имеет только DB-bootstrap, мигратор — только свою роль. Доступ к Docker/root на VPS означает доступ к секретам контейнеров; `.env` не защищает от администратора хоста.

Health: API проверяет соединение и точный Alembic head; bot — свежесть двух **прежних** heartbeat (60с), web — выдачу ACME webroot. `restart: unless-stopped` восстанавливает завершившиеся процессы; **unhealthy сам по себе Docker не перезапускает**. Проверять health/логи/алерты оператором; второго worker/autoheal не добавлено. JSON-логи Docker ограничены 10MB ×3 на сервис. Nginx request/error access logs выключены, PostgreSQL не пишет SQL-параметры; приложение использует прежний безопасный JSON logger.

## Windows PowerShell — проверка исходников

Из корня проекта, Docker Desktop запущен:

```powershell
Set-Location C:\Users\arthur\Desktop\poidem
git status --short
git branch --show-current
docker compose up -d --wait db-test
New-Item -ItemType Directory -Force .local\stage12 | Out-Null
$stage12Run = Get-Date -Format 'yyyyMMdd-HHmmss'
.\backend\.venv\Scripts\python.exe -m pytest -p no:cacheprovider `
  --basetemp=".local/stage12/pytest-$stage12Run" -c backend/pyproject.toml backend/tests -q
.\backend\.venv\Scripts\python.exe -m ruff check backend
.\backend\.venv\Scripts\python.exe -m ruff format --check backend
.\backend\.venv\Scripts\python.exe -m ruff check --config backend/pyproject.toml `
  --config "lint.isort.known-first-party=['poidem']" deploy
.\backend\.venv\Scripts\python.exe -m alembic -c backend/alembic.ini heads
.\backend\.venv\Scripts\python.exe -m alembic -c backend/alembic.ini -x target=test check
# Дополнительный Linux-прогон — после завершения native pytest на той же *_test БД
docker compose --profile test run --rm -T --build test
Set-Location frontend
npm.cmd ci
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
npm.cmd run test:production
```

pytest и `test:auth` нельзя запускать одновременно на одной `_test` БД. Никакого SQLite, 8002 или засчитывания пропущенных интеграций. Локальная сборка без production env остаётся прежней: для Docker задаётся отдельный публичный build argument, корневой `.env` в неё не копируется. Не перенаправлять бинарный dump/tar через PowerShell5.1: делать архивы внутри Bash на VPS, а затем скачивать через `scp`.

### Рекомендуемый commit

Рабочая ветка `backend-dev`; перед этапом12 HEAD `b5d5030`, прежние изменения 11А–11Г уже находились в рабочем дереве. Не начинать с reset/clean/stash/drop и не терять их. Все 0011–0014, backend+frontend+документы должны попасть в один согласованный проверенный снимок; частичная отправка только frontend или только 0011–0013 несовместима с head0014.

После ручного просмотра **оператор** может подготовить индекс:

```powershell
git diff --stat
git diff -- backend frontend scripts compose.yaml .env.example
# Следующая команда — рекомендация, агент её не выполняет
git add -- backend frontend scripts docs deploy compose.yaml compose.production.yaml `
  .gitignore .gitattributes .env.example AGENTS.md README.md
git diff --cached --check
git diff --cached --stat
git diff --cached --name-only -- references/review .env deploy/production.env uploads backups
```

Последняя команда не должна показывать новые секреты/медиа/review-скриншоты. `references/review` **не включается автоматически**. Уже отслеживаемые исторические изображения требуют отдельного просмотра на личные данные перед публикацией; не удаляются этим этапом. Проверить новые untracked исходники через `git status`, поскольку `git diff` их не показывает. Commit и последующий push выполнять только по отдельному разрешению пользователя; возможное сообщение: `Prepare stages 11 and production deployment configuration`.

## Ubuntu VPS — первый запуск

### 1. Доступ к исходникам

SSH только пользователем deploy с уже настроенным ключом. Windows, **после разрешения**:

```powershell
ssh deploy@212.69.85.148
```

Ubuntu: проверить наличие python3/flock/Docker, свободное место и время (Telegram проверяет auth_date):

```bash
python3 --version
command -v flock
docker version
docker compose version
timedatectl status
free -h
df -h
sudo ss -lntp
```

Использовать `docker` от deploy, если доступ к daemon уже настроен; иначе осознанно настроить его через sudo. Членство в группе docker эквивалентно административному доступу. Не менять UFW/SSH/Fail2ban из этих инструкций.

Системный python3 Ubuntu3.12 нужен только для `deploy/configure.py` (stdlib). Сам backend требует3.13 и запускается в Docker, не системным интерпретатором.

По уточнению пользователя, `NevmyanovAR/poidem` — публичный репозиторий. Клонирование и fetch по HTTPS выполняются без GitHub Deploy Key, PAT, отдельной SSH-пары или SSH Host alias. ED25519-ключ для входа **на VPS** по-прежнему нужен; это отдельный доступ. Секреты, закрытые ключи, пользовательские медиа и материалы review не должны попадать в публикуемый снимок или его историю.

```bash
sudo install -d -o deploy -g deploy -m 750 /srv/poidem
git clone --branch backend-dev https://github.com/NevmyanovAR/poidem.git /srv/poidem
cd /srv/poidem
git status --short
git rev-parse HEAD
```

Не клонировать/запускать старый HEAD без новых файлов. Зафиксировать SHA проверенного релиза; образы помечаются этим SHA, старые образы не удалять до проверки обновления.

### 2. Конфигурация и образы

```bash
cd /srv/poidem
python3 deploy/configure.py init --domain YOUR_REAL_DOMAIN --email YOUR_ACME_EMAIL
# Telegram-токен вводится скрыто, три независимых пароля генерируются локально
chmod 600 deploy/production.env
bash deploy/production.sh check
bash deploy/production.sh build
```

`init` отказывается перезаписывать существующий файл. В `deploy/production.env.example` секретов нет; настоящий файл, TLS, ACME, архивы, release-state игнорируются Git и build context. `check` ничего не печатает о значениях. Не запускать публично `docker compose config`, `printenv`, `docker inspect` целиком, `set -x`: они могут раскрыть credentials.

Адреса: `MINI_APP_URL=https://DOMAIN`, `API_PUBLIC_URL=https://DOMAIN/api/v1`, CORS ровно `["https://DOMAIN"]`, trusted hosts ровно `["DOMAIN"]`. Preflight проверяет согласованность и парольный формат; API всегда production/INFO, Secure-cookie, без Swagger/OpenAPI. `SESSION_COOKIE_SAMESITE=none` в сочетании с Secure нужен для Telegram Web iframe; Origin/CSRF/account-context проверки прежние. При запрете сторонних cookies браузером Telegram Web может требовать дополнительной ручной проверки; native WebView и обычный браузер проверяются отдельно. Не разрешать wildcard origins/hosts и не отключать проверки ради входа.

Базовые образы Python3.13, Node22, PostgreSQL17, Nginx и Certbot5.10.0 закреплены digest, полученным во время локальной проверки. Обновление security patches — осознанная замена digest с повторной проверкой; автоматического major upgrade PostgreSQL нет. Перед реальным выпуском повторно проверить актуальные advisories/сканер. Записать image IDs релиза (`docker image inspect --format '{{.Id}}' IMAGE`). Старые build-кэши содержат зависимости, **не** production env; runtime-образ web не содержит Node/source/tests, runtime API не содержит pytest/mock-server.

### 3. TLS

До запуска DNS должен указывать на VPS, порт80 доступен извне, другие nginx/apache на80/443 не запущены. При использовании DNS-прокси Cloudflare сначала обеспечить прохождение ACME; не менять настройки Cloudflare автоматически.

```bash
bash deploy/production.sh tls-init
```

Временный bootstrap отдаёт только `/.well-known/acme-challenge/`, остальное503; API/анкета по HTTP не доступны. Certbot запрашивает настоящий сертификат Let's Encrypt. При ошибке bootstrap останавливается, сертификат не считается выпущенным. Production web получает только live/archive read-only (оба нужны относительным symlinks), без ACME account keys; приватные ключи не копируются в image. Перед запуском сертификат проверяет `nginx -t` внутри одноразового web-контейнера: deploy не требуется открывать root-owned каталоги/ключи или ослаблять их chmod. Не подменять ошибку самоподписанным сертификатом для пользователей. Локальный аудит использует самоподписанный **только для localhost**.

### 4. Данные, миграции и бот

Сначала на Windows штатно остановить именно ранее запущенный `python -m poidem.bot` (Ctrl+C в его консоли). API/Vite/туннель можно оставить для разработки, но не второй polling того же бота. Не использовать `Stop-Process -Name python`, это затронет чужие процессы.

```bash
bash deploy/production.sh first-start --confirm-local-bot-stopped
bash deploy/production.sh status
```

Порядок: DB healthy → разовый migrator `upgrade head` → `alembic check` → API/web healthy → один bot healthy. Новая пустая PostgreSQL получает разные bootstrap/migrator/app роли прежним postgres-init.sh. Migrator не superuser; app без DDL. Миграции **0001→0014** включают исходные справочники и редакционные идеи, без вымышленных пользователей. Не запускать миграции одновременно с обслуживанием записей старым API. Скрипт при ошибке update оставляет writers остановленными; не пытается автоматически понизить схему.

`first-start` разрешён только при остановленных writers и пустой БД. Для существующей среды — update. Если первый запуск уже применил миграции, но остановился на старте API/TLS, после устранения причины использовать resume, а не повторную инициализацию/удаление volume.

Ожидание DB/API/web ограничено120с, bot180с. Ошибка readiness после запуска останавливает api/bot, не оставляя частично запущенные writers; ошибка build до технического перерыва не останавливает прежний релиз. Resume также требует уже остановленные writers.

Локальные реальные тестовые аккаунты, фото и старая БД **не импортируются автоматически** на VPS. Первый пользователь должен войти через Telegram и создать анкету заново. Миграции 0011–0014 сохраняют legacy-адреса; 0014 не разбивает старые строки эвристически и не подтверждает места самостоятельно.

### 5. BotFather и owner

После проверки HTTPS обновить у @ShallWeGoo_bot **меню Mini App и Main Mini App**, если оба используются: URL `https://YOUR_REAL_DOMAIN/`. Изменить временную tunnel-ссылку и старую Pages-ссылку. BotFather URL не является backend endpoint: API доступен этому frontend через `/api/v1`. `/start` берёт URL из `MINI_APP_URL` окружения бота. Пользователям нужно открыть бота и нажать Start для уведомлений; opt-out сохраняется. Наличие username пользователя не обязательно для встроенного чата.

Первый owner — только существующий доверенный операторский CLI, после подтверждённого входа нужного аккаунта. Узнать **UUID собственной записи** из своего авторизованного `/api/v1/me` (не отправлять весь JSON с csrf-token в чат). Затем на VPS:

```bash
docker compose --env-file deploy/production.env -f compose.production.yaml run --rm -T migrate \
  python -m poidem.admin --user-id YOUR_USER_UUID --role owner \
  --confirm-user-id YOUR_USER_UUID --reason 'Первый владелец production'
```

Обычная анкета, Telegram username/ID, параметр URL или frontend flag не дают прав admin. Не подменять UUID числовым Telegram ID. Роли/последний owner/CSRF/версии/аудит сохранены. Доступ далее через `/admin` в Mini App.

### 6. Приёмка перед приглашением пользователей

- `curl --fail https://DOMAIN/health` → ready/current; http→https; прямые `/plans`, `/profile`, `/inspiration`, `/admin` отдают SPA
- Неверная подпись, отсутствие initData/сессии → отказ; production не предлагает demo/login bypass. Из обычного браузера чужая анкета не открывается
- Настоящий A/B: вход, фото, профиль после закрытия, планы/отклики/мэтч/чат, приватность чужих фото, счётчики/ограничения, bot deep links и opt-out. Не отправлять cookie/initData в отчёт
- Подтвердить закрытость5432/8001/8002/5173 извне; контейнеры db/api не имеют PortBindings. Не полагаться только на UFW
- `/api/v1/admin/*` без роли/CSRF отклоняется; `/uploads`, `/media`, `/.env`, `/backend` не раздают файлы. Фото выдаются прежними защищёнными API, а не alias Nginx
- Сделать копию и контрольное восстановление в отдельный stopped-проект; проверить owner/media/числа таблиц и head. Фотоверификация в production остаётся недоступна до отдельного утверждения

## Обновление

Получить разрешение на новый релиз. Предварительно просмотренный commit, а не произвольный `git pull` во время работы:

```bash
cd /srv/poidem
git status --short
git fetch origin backend-dev
git log --oneline HEAD..origin/backend-dev
# Выбрать и проверить конкретный SHA, при чистом рабочем дереве
git switch --detach REVIEWED_COMMIT_SHA
python3 deploy/configure.py set-release REVIEWED_COMMIT_SHA
bash deploy/production.sh update --confirm-local-bot-stopped
```

Скрипт: проверяет env/checkout → собирает образы → останавливает api/bot → создаёт согласованную backup → применяет миграции/check → запускает новые api/web/bot. Web может показывать статический интерфейс при остановленном API с временной503; это плановый краткий перерыв, не zero-downtime. При неудаче ничего не удаляется, журнал/partial backup сохраняются. После успеха повторить health и A/B smoke; не удалять прежние образы/копию до приёмки. Пароли/токен `set-release` не перегенерирует.

## Резервные копии и восстановление

```bash
cd /srv/poidem
bash deploy/production.sh backup
# Напечатает закрытый каталог backups/TIMESTAMP-RANDOM, api/bot останутся остановленными
bash deploy/production.sh resume --confirm-local-bot-stopped
```

В архиве: pg_dump custom-format, media.tar с allowlist существующих Photo/EditorialIdea, SHA256SUMS, revision, checkout и фактически запущенные immutable image IDs. COMPLETE появляется только после успешного завершения. Отсутствующее основное фото — ошибка, а не успешная неполная копия. **Временные primary/selfie фотоверификации, orphan/очередь удаления, env/сертификаты не включаются.** БД содержит личные данные/переписку/согласия: доступ700/600, отдельно зашифровать и перенести вне VPS. TLS восстанавливается отдельным повторным выпуском; env/ключи доступа хранить отдельно в доверенном хранилище.

Рекомендуется ежедневная копия с коротким техническим перерывом, плюс перед каждым обновлением; оператор должен согласовать RPO/RTO и расписание с заказчицей. Никакого срока90дней/автоматического удаления БД или копий не вводится. Без контроля свободного места копии на60GB могут заполнить диск; контролировать минимум20% свободного места, рост media/DB/WAL/образов. План хранения/удаления backup согласуется отдельно.

Пример ручного шифрования проверенной копии на Ubuntu (нужен GnuPG; пароль вводить в prompt, не аргументом):

```bash
set -o pipefail
poidem_backup='EXACT_COMPLETE_BACKUP_DIRECTORY_NAME'
tar -C backups -czf - "$poidem_backup" | gpg --symmetric --cipher-algo AES256 \
  --pinentry-mode loopback --output "backups/$poidem_backup.tar.gz.gpg"
```

Скачать **только зашифрованный** файл на Windows вне репозитория:

```powershell
$poidemBackupDir = Join-Path $env:USERPROFILE 'poidem-private-backups'
New-Item -ItemType Directory -Force $poidemBackupDir | Out-Null
scp deploy@212.69.85.148:/srv/poidem/backups/EXACT_NAME.tar.gz.gpg $poidemBackupDir
```

Пароль архива и production env хранить отдельно в менеджере секретов, не рядом с архивом. Проверить возможность расшифровки прежде, чем считать off-host backup готовым. Для восстановления доверенного собственного архива:

```bash
install -d -m 700 .local/recovery
gpg --decrypt backups/EXACT_NAME.tar.gz.gpg | tar -xz -C .local/recovery
# Далее restore получает полный путь к распакованному каталогу с COMPLETE
```

Восстановление разрешено **только в пустую PostgreSQL и пустой media volume**, с тем же проверенным image/схемой. Старые данные не drop/truncate/overwrite. Для rehearsal или отката создать отдельный проект/volumes (порты web не запускать):

```bash
cd /srv/poidem
POIDEM_COMPOSE_PROJECT=poidem-restore-drill bash deploy/production.sh restore \
  /ABSOLUTE/PATH/TO/COMPLETE_BACKUP --confirm-empty-target
```

Проверяются checksums, пустая БД, pg_restore одной транзакцией, безопасные имена jpg/размер/полнота media, без symlink/path traversal/extractall. Не импортировать недоверенные архивы. При неполном результате окружение остаётся stopped; не удалять исходную БД/volume для повторения — создать новый пустой проект и разобраться с ошибкой.

После восстановления старые сессии отзываются, пользователи входят заново. Проверочные селфи не восстанавливаются: прежний expire/clear_materials завершает pending как expired с причиной backup_restore, временные ссылки очищаются; approved результат и версия основного фото сохраняются. Это аварийная обработка отсутствующих временных материалов, не новый продуктовый TTL. Архивы/мэтчи/чаты/репутационные формулы не пересчитываются новыми правилами.

Перед включением bot после старой копии отдельно проверить outbox: восстановление старого состояния может повторить уже доставленное после даты backup уведомление. Универсальной exactly-once гарантии Telegram нет; не отправлять очередь автоматически до просмотра существующих suppress/retry/unknown в админке. Сам скрипт restore не запускает приложение/бота и не объявляет доставку проверенной.

Старая копия также может вернуть впоследствии удалённые записи, отозванные роли или прежние настройки согласий/уведомлений. Перед cutover оператору необходимо учесть известные удаления и отзывы после даты копии; отзыв сессий сам по себе не решает эту проблему. Политику хранения backup и журнал восстановления согласовать отдельно, не обещать автоматического выполнения неизвестных требований.

Для возврата из drill в production не использовать `down -v`, rename volumes или копирование работающего PGDATA. Сохранить повреждённый проект, сверить целевой commit/head/credentials/media, подготовить операторский план переключения на восстановленные volumes. Точный cutover выполняется отдельно, после проверки и разрешения.

После ручной проверки восстановленного проекта и отдельного разрешения переключения, с checkout/RELEASE_TAG соответствующей копии:

```bash
# Явно остановить прежние writers и web, освободить80/443; volumes сохраняются
docker compose --project-name poidem-production --env-file deploy/production.env \
  -f compose.production.yaml stop api bot web
# Сделать проверенный восстановленный проект активным для последующих ops/cron
python3 deploy/configure.py set-project poidem-restore-drill
bash deploy/production.sh resume --confirm-local-bot-stopped
bash deploy/production.sh status
```

Использовать имя фактически проверенного restored-проекта, не автоматически угадывать его. `set-project` атомарно меняет только `COMPOSE_PROJECT_NAME` в закрытом env, не копирует/удаляет volumes и не стартует сервисы. Обычные команды/cron далее используют этот проект; временный `POIDEM_COMPOSE_PROJECT` остаётся override для drill. Если текущий production уже имеет другое имя, в команде stop указать его явно. После cutover повторить health/A-B/outbox-приёмку. При ошибке не включать одновременно оба бота.

## Откат

Если схема **не менялась**, вернуть проверенный старый checkout, прежний RELEASE_TAG (из images.txt), убедиться, что нужные образы сохранились, и выполнить resume; readiness сравнит revision с образом. Если миграции уже изменили схему, старый API может быть несовместим и будет503: **не выполнять автоматический `alembic downgrade`**, некоторые исторические downgrade осознанно запрещены. Восстановить pre-update backup в отдельный пустой проект по процедуре выше, проверить и отдельно переключить трафик. Откат к копии теряет изменения после неё — это нужно оценить до действий.

При неизменной схеме и существующем предыдущем production-релизе:

```bash
bash deploy/production.sh backup
git switch --detach PREVIOUS_PRODUCTION_COMMIT
python3 deploy/configure.py set-release PREVIOUS_PRODUCTION_COMMIT
bash deploy/production.sh resume --confirm-local-bot-stopped
```

Во время update backup может содержать checkout нового commit, пока запущен ещё старый образ: для отката авторитетны images.txt + revision.txt, не один checkout.txt. Первый выпуск не имеет прежнего production-релиза: при его ошибке оставить writers остановленными и исправить причину, сохранив volumes/копии. Никогда не выполнять downgrade «для проверки» на рабочей БД.

## TLS-renew, состояние и логи

```bash
bash deploy/production.sh status
bash deploy/production.sh logs
docker stats --no-stream
df -h
bash deploy/production.sh renew
```

После первого успешного запуска и настройки уведомлений об ошибках добавить cron для deploy (путь `/srv/poidem` фиксированный):

```cron
17 3,15 * * * /usr/bin/bash /srv/poidem/deploy/production.sh renew
```

renew проверяет конфигурацию, запускает Certbot webroot и делает `nginx -t`/reload только после успешного renew. ACME health-файл создаётся tls-init и остаётся; не закрывать80. Проверить один раз `certbot renew --dry-run` через service certbot и реальное расписание на VPS. Уведомления cron должны доходить оператору; не перенаправлять ошибки в `/dev/null`. Если каталог репозитория другой, изменить cron. Docker socket в certbot не монтируется.

## Источники и границы проверки

Порты Docker могут обходить UFW: [официальная документация Docker](https://docs.docker.com/engine/network/packet-filtering-firewalls/#docker-and-ufw). Конфигурация поэтому не публикует внутренние сервисы. URI и заголовки прокси — [Nginx proxy module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_pass). HTTP-01 webroot/renew — [Certbot User Guide](https://eff-certbot.readthedocs.io/en/stable/using.html#webroot).

Локальный самоподписанный TLS не доказывает выпуск Let's Encrypt, настройки DNS/UFW/VPS или работу физического Telegram WebView. Новый домен требует ручного A/B smoke после развёртывания.

## Результаты аудита 28.11.2026

| Проверка | Фактический результат |
| --- | --- |
| Git | backend-dev, исходный HEAD b5d5030. Изменения11А–11Г/0011–0014 были незакоммичены и сохранены; reset/stage/commit/push не выполнялись |
| Windows pytest | Полный прежний набор **1103 passed**, затем итоговые ops/settings регрессии **42 passed**. Для tmp/cache использован разрешённый `.local/stage12`, не пропуск интеграций |
| Linux Docker pytest | Итоговый полный набор **1127 passed** на PostgreSQL17, Python3.13.18, 415.58с. Ранее 1125 passed/1 failed из-за наследования Secure-cookie тестовым helper; helper изолирован от окружения и полный прогон повторён |
| Ruff | backend check + format-check, deploy check + format-check успешны. Старые tunnel-скрипты не переформатировались ради косметики |
| TypeScript / ESLint / Vite | Успешны. Сохраняется предупреждение chunk>500kB, без изменения утверждённого UI |
| Browser production suite | **145 passed**, Chromium. Внешний Telegram transport и тестовые данные подменяются только в browser fixtures |
| Фактический Docker frontend / Nginx HTTPS | **20 случаев**: 10 маршрутов ×390/1366, без SDK, реальные static/API через proxy; защитные headers, отсутствие переполнения/раскрытия приватных fixtures/5xx; health200/no-store |
| Fresh Docker DB / Alembic | С нуля 0001→0014, 39 прикладных таблиц, runtime без CREATE и audit UPDATE. Linux `alembic check` и обе локальные main/test схемы: no new operations |
| Docker runtime | API/web healthy, Nginx -t успешен, pip check без конфликтов. API UID10001/read-only/umask0077; порты DB/API не опубликованы. Nginx видит только live/archive без ACME accounts |
| Bot configuration | Настоящий локальный `python -m poidem.bot --check` в runtime image: revision/getMe/username/HTTPS URL проверены, bot_configuration_verified. Новый polling/worker/рассылка не запускались; доступ к Telegram с VPS ещё не проверен |
| HTTPS API / auth / фото | Две синтетические роли: валидный HMAC, отказ подделке, Secure/HttpOnly/SameSite=None host-only cookie, раздельные профили/фото, чужое фото404, admin403/Origin403, draft→publish→чужой каталог. Токен синтетический, это не ручная Telegram-проверка |
| Backup / restore | Реальный pg_dump+tar → новый пустой Docker-проект. Совпали 4 синтетические users/photos, план, head и хэши фото. 4 временных verification файла исключены; approved сохранён, pending expired, все старые сессии отозваны. Restore не запускал API/бота |
| Защита восстановления | Повторный restore отказался перезаписывать непустую БД. Guard media проверен на пустом/непустом volume; traversal/symlink/неполные архивы покрыты unit tests |
| Bash / ShellCheck | Синтаксис и ShellCheck успешны. Реальные backup/restore команды проверены Git Bash на Docker Desktop; в этом harness flock заменялся последовательным stub. Отдельно проверен настоящий Linux flock на конкурирующем захвате. Переключение активного проекта сохраняет остальные настройки/секреты; help не требует env. Две имитации сбоя readiness (api/web и bot) подтвердили остановку обоих writers. Сам Ubuntu VPS не проверялся |
| Секреты / Git / images | Текущие Git-visible файлы и 966 исторических объектов без совпадений с локальными секретами; `.env`/keys/uploads/backups не tracked. Regex-совпадение в PDF оказалось бинарной JPEG-таблицей, PDF не изменялся. Слои/config runtime images просканированы без вывода значений; совпадений нет |
| npm audit | Production dependencies: **0 vulnerabilities**. Полного CVE-скана ОС/всех Docker layers этот результат не заменяет |

Синтетические fixtures создавались только в отдельном `poidem-stage12-audit`; восстановление — `poidem-stage12-restore`, проверка пустого медиа — `poidem-stage12-empty`. Настоящая локальная база/анкеты/бот/туннель не использовались для fixtures/backup/restore; отдельно выполнен только безопасный read-only bot --check на локальной конфигурации. Результаты сохранены в игнорируемой `.local/stage12`, снимки Docker frontend — `.local/stage12/browser/`. Контроль212 защищённых файлов подтвердил отсутствие изменений frontend/src/public, backend/src/миграций и references.

Исправлены проблемы подготовки: недоступные Windows cache/tmp; неполный test-only Docker context для репозиторных helper/JSON; зависимость unit cookie-теста от tunnel-env; YAML tmpfs со случайным вторым элементом; вложенный read-only bind mount; наследование security headers Nginx при настройке cache; потенциально видимый временный production.env.tmp теперь игнорируется. Не менялись модели, бизнес-сервисы, исходные миграции или дизайн.

## Файлы этого этапа

Новые:

- `compose.production.yaml`
- `deploy/Dockerfile.web`, `deploy/production.env.example`, `deploy/configure.py`, `deploy/production.sh`
- `deploy/nginx/app.conf.template`, `deploy/nginx/bootstrap.conf.template`, `deploy/ops/media.py`
- `frontend/.dockerignore`
- `backend/tests/test_production.py`
- `docs/PRODUCTION_DEPLOYMENT.md`

Изменены:

- `.gitignore`, `.gitattributes`
- `backend/Dockerfile` (фиксированный базовый digest), `backend/.dockerignore`
- `compose.yaml` (только read-only test mounts), `backend/tests/test_settings.py` (изоляция unit defaults)
- `AGENTS.md`, `README.md`, `backend/README.md`
- `docs/BACKEND_ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/ROADMAP.md`, `docs/SECURITY.md`

Остальные dirty-файлы принадлежат предшествующим этапам и не являются новыми изменениями12.

## Что ещё требуется перед реальным выпуском

Неизвестны домен/DNS, ACME email, production-секреты/их хранение и off-host backup-назначение/ключ/RPO/RTO. Нужны проверенный commit, отдельное разрешение на push/развёртывание, реальный Let's Encrypt/renew dry-run, BotFather URL, один polling после остановки локального и ручной A/B smoke нового домена. Для публичного GitHub Deploy Key не требуется. Ранее отправленный в переписку токен нельзя использовать в production без перевыпуска, если он ещё действует; сам токен не присылать. Сбор проверочных фото остаётся выключен до production-согласования текста/сроков/копий; preflight допускает включение только с заполненной явно одобренной политикой, не утверждает её за заказчицу. CVE/advisories закреплённых образов и нагрузку реального4GB VPS проверить перед приглашением пользователей. Возврат старой backup/ролей/согласий требует отдельной операторской приёмки.
