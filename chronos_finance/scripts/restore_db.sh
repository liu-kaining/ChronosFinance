#!/usr/bin/env bash
# Restore Chronos Finance DB from a pg_dump file (DESTRUCTIVE: drops objects in DB).
#
# Usage:
#   cd chronos_finance
#   bash scripts/restore_db.sh backups/chronos_finance_YYYYMMDD_HHMMSS.dump
#   bash scripts/restore_db.sh backups/chronos_finance_YYYYMMDD_HHMMSS.sql
#   bash scripts/restore_db.sh backups/chronos_finance_YYYYMMDD_HHMMSS.sql.gz
#
# Stop the API first to avoid open connections:
#   docker-compose stop api
#
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"
ROOT_DIR="$(cd "$PROJECT_DIR/.." && pwd)"
export COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.yml}"
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-chronosfinance}"

# shellcheck disable=SC1091
set -a
[[ -f "$PROJECT_DIR/../.env" ]] && source "$PROJECT_DIR/../.env"
set +a

POSTGRES_USER="${POSTGRES_USER:-chronos}"
POSTGRES_DB="${POSTGRES_DB:-chronos_finance}"

FILE="${1:-}"
if [[ -z "$FILE" || ! -f "$FILE" ]]; then
  echo "Usage: $0 <backup.dump|backup.sql|backup.sql.gz>" >&2
  exit 1
fi

log() { printf "\033[1;33m[restore]\033[0m %s\n" "$*"; }
warn() { printf "\033[1;31m[restore]\033[0m %s\n" "$*"; }

running_apis="$(docker-compose ps --status running --services 2>/dev/null | rg '^(api-read|api-write)$' || true)"
if [[ -n "$running_apis" ]]; then
  warn "API services are still running ($(echo "$running_apis" | tr '\n' ' ')) — recommend: docker-compose stop api-read api-write"
  read -r -p "Continue anyway? [y/N] " ans
  [[ "${ans:-}" == "y" || "${ans:-}" == "Y" ]] || exit 1
fi

if ! docker-compose ps --status running --services 2>/dev/null | grep -qx db; then
  echo "ERROR: db service is not running." >&2
  exit 1
fi

if ! docker-compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -c "SELECT 1" >/dev/null 2>&1; then
  echo "ERROR: cannot access database '$POSTGRES_DB' as user '$POSTGRES_USER'." >&2
  exit 1
fi

case "$FILE" in
  *.dump)
    log "pg_restore (custom format) from $FILE"
    docker-compose exec -T db \
      pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
      --clean --if-exists --no-owner --no-acl - < "$FILE"
    ;;
  *.sql)
    log "psql plain SQL from $FILE"
    docker-compose exec -T db \
      psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 < "$FILE"
    ;;
  *.sql.gz)
    log "psql gzipped SQL from $FILE"
    gunzip -c "$FILE" | docker-compose exec -T db \
      psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1
    ;;
  *)
    echo "Unknown extension — use .dump (pg_dump -Fc), .sql, or .sql.gz" >&2
    exit 1
    ;;
esac

log "Done. Start APIs: docker-compose start api-read api-write"
