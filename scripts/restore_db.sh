#!/usr/bin/env bash
#
# ChronosFinance Database Restore Script
#
# Safely restores a PostgreSQL backup created by backup_db.sh.
# Supports pre-restore validation and optional confirmation.
#
# Usage:
#   ./scripts/restore_db.sh backups/chronos_finance_20260423_120000.dump
#   ./scripts/restore_db.sh backups/pre_launch.dump --no-confirm  # Skip confirmation
#   ./scripts/restore_db.sh backups/latest.dump --clean          # Drop existing objects first
#
# WARNING: This will overwrite existing data!
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

log() { printf "\033[1;36m[restore]\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m[restore]\033[0m %s\n" "$*"; }
die() { printf "\033[1;31m[restore]\033[0m %s\n" "$*" >&2; exit 1; }

# Parse arguments
BACKUP_FILE="${1:-}"
NO_CONFIRM=false
CLEAN_MODE=false

if [[ -z "$BACKUP_FILE" ]]; then
    die "Usage: $0 <backup_file.dump> [--no-confirm] [--clean]"
fi

shift || true
for arg in "$@"; do
    case "$arg" in
        --no-confirm) NO_CONFIRM=true ;;
        --clean) CLEAN_MODE=true ;;
        *) die "Unknown argument: $arg" ;;
    esac
done

# Resolve backup file path
if [[ ! -f "$BACKUP_FILE" ]]; then
    # Try relative to project dir
    if [[ -f "$PROJECT_DIR/$BACKUP_FILE" ]]; then
        BACKUP_FILE="$PROJECT_DIR/$BACKUP_FILE"
    else
        die "Backup file not found: $BACKUP_FILE"
    fi
fi

# Validate backup file
if ! file "$BACKUP_FILE" | grep -q "PostgreSQL"; then
    warn "File does not appear to be a PostgreSQL backup: $BACKUP_FILE"
    warn "Attempting restore anyway..."
fi

SIZE=$(stat -f%z "$BACKUP_FILE" 2>/dev/null || stat -c%s "$BACKUP_FILE" 2>/dev/null)
SIZE_MB=$((SIZE / 1024 / 1024))

log "Backup file: $BACKUP_FILE (${SIZE_MB} MB)"

# Check if database container is running
if ! docker-compose ps --status running --services 2>/dev/null | grep -qx db; then
    die "Database container not running. Start with: docker-compose up -d db"
fi

# Validate target database is reachable and exists before restore.
if ! docker-compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -c "SELECT 1" >/dev/null 2>&1; then
    die "Cannot access database '$POSTGRES_DB' as user '$POSTGRES_USER'. Check .env POSTGRES_DB/POSTGRES_USER."
fi

# Warn if APIs are running (service names in this repo are api-read/api-write).
running_apis="$(docker-compose ps --status running --services 2>/dev/null | rg '^(api-read|api-write)$' || true)"
if [[ -n "$running_apis" ]]; then
    warn "API services are running ($(echo "$running_apis" | tr '\n' ' ')). Recommend stopping them before restore:"
    warn "  docker-compose stop api-read api-write"
fi

# Get current database stats for comparison
log "Current database state:"
CURRENT_STATS=$(docker-compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -c "
    SELECT
        (SELECT COUNT(*) FROM stock_universe) as universe,
        (SELECT COUNT(*) FROM daily_prices) as prices,
        (SELECT COUNT(*) FROM static_financials) as financials;
")
log "  stock_universe: $(echo "$CURRENT_STATS" | cut -d'|' -f1) rows"
log "  daily_prices: $(echo "$CURRENT_STATS" | cut -d'|' -f2) rows"
log "  static_financials: $(echo "$CURRENT_STATS" | cut -d'|' -f3) rows"

# Confirmation prompt
if [[ "$NO_CONFIRM" != "true" ]]; then
    echo ""
    warn "⚠️  This will OVERWRITE the existing database: $POSTGRES_DB"
    warn "    Backup file: $BACKUP_FILE"
    warn "    Size: ${SIZE_MB} MB"
    if [[ "$CLEAN_MODE" == "true" ]]; then
        warn "    Mode: CLEAN (will drop existing objects first)"
    fi
    echo ""
    read -p "Continue? [y/N] " -r
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log "Aborted."
        exit 1
    fi
fi

# Perform restore
log "Starting restore..."

# Build pg_restore options
RESTORE_OPTS=(
    "-U" "$POSTGRES_USER"
    "-d" "$POSTGRES_DB"
    "-v"                     # Verbose
)

if [[ "$CLEAN_MODE" == "true" ]]; then
    RESTORE_OPTS+=("--clean")  # Drop existing objects before recreating
    RESTORE_OPTS+=("--if-exists")
fi

# Use pg_restore for custom format dumps
if docker-compose exec -T db pg_restore "${RESTORE_OPTS[@]}" < "$BACKUP_FILE" 2>&1 | tee /tmp/restore.log; then
    log "Restore completed successfully."
else
    # pg_restore returns non-zero even for warnings, check if it actually failed
    if grep -q "ERROR" /tmp/restore.log; then
        die "Restore failed with errors. Check /tmp/restore.log"
    else
        warn "Restore completed with warnings. Check /tmp/restore.log"
    fi
fi

# Verify restore
log "Post-restore database state:"
NEW_STATS=$(docker-compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -c "
    SELECT
        (SELECT COUNT(*) FROM stock_universe) as universe,
        (SELECT COUNT(*) FROM daily_prices) as prices,
        (SELECT COUNT(*) FROM static_financials) as financials;
")
log "  stock_universe: $(echo "$NEW_STATS" | cut -d'|' -f1) rows"
log "  daily_prices: $(echo "$NEW_STATS" | cut -d'|' -f2) rows"
log "  static_financials: $(echo "$NEW_STATS" | cut -d'|' -f3) rows"

# Reindex for performance after bulk load
log "Reindexing database..."
docker-compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "REINDEX DATABASE $POSTGRES_DB;" || true

# Analyze for query planner statistics
log "Analyzing tables..."
docker-compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "ANALYZE;" || true

log "Restore complete. Database is ready."
