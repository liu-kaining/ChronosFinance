#!/usr/bin/env bash
#
# ChronosFinance Database Backup Script
#
# Creates a compressed PostgreSQL backup of the chronos_finance database.
# Uses pg_dump with custom format (-Fc) for parallel restore support.
#
# Usage:
#   ./scripts/backup_db.sh                    # Default: full backup
#   ./scripts/backup_db.sh --schema-only      # Schema only (no data)
#   ./scripts/backup_db.sh --data-only        # Data only (no schema)
#   BACKUP_NAME="pre_launch" ./scripts/backup_db.sh  # Custom name
#
# Output:
#   backups/chronos_finance_YYYYMMDD_HHMMSS.dump
#
# Restore with:
#   ./scripts/restore_db.sh backups/chronos_finance_YYYYMMDD_HHMMSS.dump
#
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

# Load environment
set -a
[[ -f "$PROJECT_DIR/.env" ]] && source "$PROJECT_DIR/.env"
set +a

# Configuration
POSTGRES_USER="${POSTGRES_USER:-chronos}"
POSTGRES_DB="${POSTGRES_DB:-chronos_finance}"
BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/backups}"
BACKUP_NAME="${BACKUP_NAME:-}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"

# Determine backup type
BACKUP_TYPE="full"
if [[ "${1:-}" == "--schema-only" ]]; then
    BACKUP_TYPE="schema"
elif [[ "${1:-}" == "--data-only" ]]; then
    BACKUP_TYPE="data"
fi

# Build backup filename
if [[ -n "$BACKUP_NAME" ]]; then
    BACKUP_FILE="$BACKUP_DIR/${BACKUP_NAME}.dump"
else
    BACKUP_FILE="$BACKUP_DIR/${POSTGRES_DB}_${TIMESTAMP}.dump"
fi

log() { printf "\033[1;36m[backup]\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m[backup]\033[0m %s\n" "$*"; }
die() { printf "\033[1;31m[backup]\033[0m %s\n" "$*" >&2; exit 1; }

# Ensure backup directory exists
mkdir -p "$BACKUP_DIR"

# Check if database container is running
if ! docker-compose ps --status running --services 2>/dev/null | grep -qx db; then
    die "Database container not running. Start with: docker-compose up -d db"
fi

# Build pg_dump options
PG_OPTS=(
    "-U" "$POSTGRES_USER"
    "-d" "$POSTGRES_DB"
    "-Fc"                    # Custom format (compressed, parallel restore)
    "-v"                     # Verbose
)

case "$BACKUP_TYPE" in
    schema)
        PG_OPTS+=("--schema-only")
        log "Creating schema-only backup..."
        ;;
    data)
        PG_OPTS+=("--data-only")
        log "Creating data-only backup..."
        ;;
    full)
        log "Creating full backup (schema + data)..."
        ;;
esac

# Run backup
log "Database: $POSTGRES_DB"
log "Output: $BACKUP_FILE"

TEMP_FILE="${BACKUP_FILE}.tmp"

if docker-compose exec -T db pg_dump "${PG_OPTS[@]}" > "$TEMP_FILE"; then
    mv "$TEMP_FILE" "$BACKUP_FILE"

    # Get file size
    SIZE=$(stat -f%z "$BACKUP_FILE" 2>/dev/null || stat -c%s "$BACKUP_FILE" 2>/dev/null)
    SIZE_MB=$((SIZE / 1024 / 1024))

    log "Backup complete: ${SIZE_MB} MB"
    log "File: $BACKUP_FILE"

    # List recent backups
    echo ""
    log "Recent backups:"
    ls -lht "$BACKUP_DIR"/*.dump 2>/dev/null | head -5 || true

    exit 0
else
    rm -f "$TEMP_FILE"
    die "pg_dump failed. Check database logs: docker-compose logs db"
fi
