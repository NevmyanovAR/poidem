#!/usr/bin/env bash
set -euo pipefail

# psql variables quote secrets as SQL literals; never echo credentials.
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=ON_ERROR_STOP=1 \
  --set=app_password="$POSTGRES_APP_PASSWORD" \
  --set=migration_password="$POSTGRES_MIGRATION_PASSWORD" <<'SQL'
CREATE ROLE poidem_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'migration_password';
CREATE ROLE poidem_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'app_password';
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO poidem_migrator;
GRANT USAGE ON SCHEMA public TO poidem_app;
ALTER DEFAULT PRIVILEGES FOR ROLE poidem_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO poidem_app;
SQL
