#!/usr/bin/env bash
# Ubuntu only. Never source production.env; never enable shell tracing.
# Container variables in sh -c must expand inside db, never on the host.
# shellcheck disable=SC2016
set -euo pipefail
umask 077
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
action="${1:-help}"
if [[ "$action" == help || "$action" == --help || "$action" == -h ]]; then
  echo 'check | build | tls-init | renew | first-start --confirm-local-bot-stopped | update --confirm-local-bot-stopped | backup | resume --confirm-local-bot-stopped | restore BACKUP --confirm-empty-target | status | logs'
  exit 0
fi
ENV_FILE="${POIDEM_PRODUCTION_ENV:-$ROOT/deploy/production.env}"
export POIDEM_PRODUCTION_ENV="$ENV_FILE"
PROJECT="${POIDEM_COMPOSE_PROJECT:-$(python3 deploy/configure.py public-value COMPOSE_PROJECT_NAME)}"
[[ "$PROJECT" =~ ^poidem[-a-z0-9]*$ ]] || { echo 'Invalid Compose project' >&2; exit 1; }
DC=(docker compose --project-name "$PROJECT" --env-file "$ENV_FILE" -f "$ROOT/compose.production.yaml")
dc() { "${DC[@]}" "$@"; }
check() {
  python3 deploy/configure.py check
  dc config --quiet
}
release_check() {
  local expected actual
  expected="$(python3 deploy/configure.py public-value RELEASE_TAG)"
  actual="$(git rev-parse HEAD)"
  [[ "$actual" == "$expected"* ]] || { echo 'RELEASE_TAG does not match checkout' >&2; exit 1; }
  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo 'Commit/review source changes before release' >&2
    exit 1
  fi
  [[ -z "$(git ls-files --others --exclude-standard)" ]] || { echo 'Review untracked files before release' >&2; exit 1; }
}
stopped() {
  if dc ps --status running --services | grep -Eq '^(api|bot)$'; then
    echo 'Writers are still running; operation refused' >&2
    exit 1
  fi
}
public_tables() {
  dc exec -T db sh -c 'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT count(*) FROM pg_tables WHERE schemaname=current_schema()"'
}
backup() {
  dc stop -t 40 api bot
  stopped
  local folder
  folder="$ROOT/backups/$(date -u +%Y%m%dT%H%M%SZ)-${RANDOM}"
  mkdir -p "$ROOT/backups"
  mkdir -m 700 "$folder"
  # Binary redirection is performed by Bash, never Windows PowerShell 5.
  dc exec -T db sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$folder/database.dump"
  dc exec -T db pg_restore --list < "$folder/database.dump" > /dev/null
  dc run --rm --no-deps -T ops backup > "$folder/media.tar"
  local ids
  ids="$(dc ps -aq api bot web)"
  if [[ -n "$ids" ]]; then
    # Only immutable image references; never docker inspect's environment.
    # shellcheck disable=SC2086
    docker inspect --format '{{.Name}} {{.Config.Image}} {{.Image}}' $ids > "$folder/images.txt"
  fi
  git rev-parse HEAD > "$folder/checkout.txt"
  dc exec -T db sh -c 'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT version_num FROM alembic_version"' > "$folder/revision.txt"
  (cd "$folder"; sha256sum database.dump media.tar > SHA256SUMS)
  printf 'Writers stopped; verification materials excluded; sessions revoked on restore\n' > "$folder/COMPLETE"
  echo "Backup complete: $folder"
  echo 'API and bot remain stopped. Copy the archive off-host; resume explicitly when ready.'
}
start_app() {
  [[ "${1:-}" == '--confirm-local-bot-stopped' ]] || { echo 'Stop local polling and pass --confirm-local-bot-stopped' >&2; exit 1; }
  # Certbot's live/archive are root-owned; deploy must not read private keys.
  # Check through the web container instead of host-side -s / chmod widening.
  dc run --rm --no-deps -T web nginx -t
  if ! dc up -d --wait --wait-timeout 120 api web; then
    dc stop -t 40 api bot
    return 1
  fi
  if ! dc up -d --wait --wait-timeout 180 bot; then
    dc stop -t 40 api bot
    return 1
  fi
}

mkdir -p deploy/releases
exec 9>deploy/releases/operation.lock
flock -n 9 || { echo 'Another deployment operation is running' >&2; exit 1; }
check
case "$action" in
  check) ;;
  build)
    release_check
    COMPOSE_PARALLEL_LIMIT=1 dc build api web
    ;;
  tls-init)
    release_check
    mkdir -p deploy/acme/.well-known/acme-challenge deploy/letsencrypt
    chmod 755 deploy/acme deploy/acme/.well-known deploy/acme/.well-known/acme-challenge
    printf 'ok\n' > deploy/acme/.well-known/acme-challenge/health
    chmod 644 deploy/acme/.well-known/acme-challenge/health
    # Only port 80, no backend/auth over HTTP before certificate issuance.
    trap 'dc stop bootstrap >/dev/null 2>&1 || true' EXIT
    dc up -d --no-deps bootstrap
    dc run --rm -T certbot certonly --non-interactive --agree-tos --webroot -w /var/www/acme \
      --email "$(python3 deploy/configure.py public-value ACME_EMAIL)" \
      -d "$(python3 deploy/configure.py public-value APP_DOMAIN)"
    ;;
  renew)
    dc run --rm -T certbot renew --non-interactive --webroot -w /var/www/acme
    dc exec -T web nginx -t
    dc exec -T web nginx -s reload
    ;;
  first-start)
    release_check
    [[ "${2:-}" == '--confirm-local-bot-stopped' ]] || { echo 'Explicit polling confirmation required' >&2; exit 1; }
    stopped
    dc up -d --wait --wait-timeout 120 db
    [[ "$(public_tables)" == 0 ]] || { echo 'First start requires empty database; use update or resume' >&2; exit 1; }
    dc run --rm -T migrate
    dc run --rm -T migrate python -m alembic -c backend/alembic.ini check
    start_app "$2"
    ;;
  update)
    release_check
    [[ "${2:-}" == '--confirm-local-bot-stopped' ]] || { echo 'Explicit polling confirmation required' >&2; exit 1; }
    COMPOSE_PARALLEL_LIMIT=1 dc build api web
    backup
    # On any failure leave writers stopped; do not silently downgrade schema.
    dc run --rm -T migrate
    dc run --rm -T migrate python -m alembic -c backend/alembic.ini check
    start_app "$2"
    ;;
  backup) backup ;;
  resume) release_check; stopped; start_app "${2:-}" ;;
  restore)
    [[ "${3:-}" == '--confirm-empty-target' ]] || { echo 'Explicit empty-target confirmation required' >&2; exit 1; }
    folder="$(realpath -- "${2:?Set backup directory}")"
    [[ -f "$folder/COMPLETE" ]] || { echo 'Backup is incomplete' >&2; exit 1; }
    (cd "$folder"; sha256sum -c SHA256SUMS)
    expected="$(dc run --rm --no-deps -T ops schema-head)"
    [[ "$(cat "$folder/revision.txt")" == "$expected" ]] || { echo 'Use the image matching the backup revision' >&2; exit 1; }
    stopped
    dc up -d --wait --wait-timeout 120 db
    tables="$(public_tables)"
    [[ "$tables" == 0 ]] || { echo 'Restore refuses a nonempty database; use a fresh project/volume' >&2; exit 1; }
    dc run --rm --no-deps -T ops check-empty-media
    dc exec -T db sh -c 'exec pg_restore --exit-on-error --single-transaction -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$folder/database.dump"
    dc run --rm --no-deps -T ops restore < "$folder/media.tar"
    dc run --rm --no-deps -T ops finalize-restore
    echo 'Restored to stopped environment. Review revisions, roles, media and outbox before startup.'
    ;;
  status) dc ps ;;
  logs) dc logs --tail 100 api bot ;;
  *) echo 'Unknown operation' >&2; exit 1 ;;
esac
