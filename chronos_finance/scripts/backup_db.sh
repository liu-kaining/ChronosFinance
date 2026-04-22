#!/usr/bin/env bash
# One-shot PostgreSQL backup for Chronos Finance (Docker Compose `db` service).
#
# Uses pg_dump inside the db container (no password needed on the Docker network).
# For CSV slices of a single symbol, see scripts/export_symbol.sh.
#
# Usage:
#   cd chronos_finance
#   bash scripts/backup_db.sh
#
# Env (optional):
#   BACKUP_DIR=./my-backups     — output directory (default: ./backups)
#   BACKUP_FORMAT=custom        — custom (default, -Fc) or plain (SQL)
#   GZIP=1                      — if plain SQL, gzip the file (default 1)
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
BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/backups}"
BACKUP_FORMAT="${BACKUP_FORMAT:-custom}"
GZIP="${GZIP:-1}"

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d_%H%M%S)"
BASE_NAME="${POSTGRES_DB}_${STAMP}"

log() { printf "\033[1;36m[backup]\033[0m %s\n" "$*"; }

if ! docker-compose ps --status running --services 2>/dev/null | grep -qx db; then
  log "ERROR: db service is not running. Start with: docker-compose up -d db"
  exit 1
fi

case "$BACKUP_FORMAT" in
  custom|fc)
    OUT="$BACKUP_DIR/${BASE_NAME}.dump"
    log "pg_dump custom format → $OUT"
    docker-compose exec -T db \
      pg_dump -U "$POSTGRES_USER" -Fc --no-owner --no-acl "$POSTGRES_DB" > "$OUT"
    ;;
  plain|sql)
    OUT="$BACKUP_DIR/${BASE_NAME}.sql"
    log "pg_dump plain SQL → $OUT"
    docker-compose exec -T db \
      pg_dump -U "$POSTGRES_USER" --no-owner --no-acl "$POSTGRES_DB" > "$OUT"
    if [[ "$GZIP" == "1" ]]; then
      gzip -f "$OUT"
      OUT="$OUT.gz"
      log "compressed → $OUT"
    fi
    ;;
  *)
    echo "BACKUP_FORMAT must be 'custom' or 'plain' (got: $BACKUP_FORMAT)" >&2
    exit 1
    ;;
esac

ls -lh "$OUT"
log "Done."
