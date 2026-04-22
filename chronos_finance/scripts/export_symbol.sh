#!/usr/bin/env bash
# Export all symbol-scoped rows for one ticker to CSV files (host-side).
# Complements full `backup_db.sh` (pg_dump) when you only need one stock.
#
# Usage:
#   cd chronos_finance
#   bash scripts/export_symbol.sh AAPL
#   bash scripts/export_symbol.sh AAPL ./my_exports/aapl_bundle
#
# Env (optional):
#   EXPORT_MACRO=1   — also dump full macro_economics (not tied to symbol)
#
# Note: sec_files / static_financials JSON columns can make large CSVs.
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

RAW="${1:-}"
OUT="${2:-}"
if [[ -z "$RAW" ]]; then
  echo "Usage: $0 SYMBOL [output_directory]" >&2
  exit 1
fi

SYM=$(echo "$RAW" | tr '[:lower:]' '[:upper:]' | tr -d '[:space:]')
if ! [[ "$SYM" =~ ^[A-Z0-9.-]{1,20}$ ]]; then
  echo "Invalid symbol: $RAW" >&2
  exit 1
fi

STAMP="$(date +%Y%m%d_%H%M%S)"
OUT="${OUT:-$PROJECT_DIR/exports/${SYM}_${STAMP}}"
mkdir -p "$OUT"

log() { printf "\033[1;36m[export]\033[0m %s\n" "$*"; }

if ! docker-compose ps --status running --services 2>/dev/null | grep -qx db; then
  log "ERROR: db service is not running."
  exit 1
fi

# SYM is validated [A-Z0-9.-]{1,20} — safe to interpolate into SQL literals.
_psql_copy() {
  local file="$1"
  local sql="$2"
  docker-compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 \
    -c "\\copy ($sql) TO STDOUT CSV HEADER" > "$file"
}

log "→ $OUT (symbol=$SYM)"

_psql_copy "$OUT/stock_universe.csv" \
  "SELECT * FROM stock_universe WHERE symbol = '${SYM}'"

_psql_copy "$OUT/static_financials.csv" \
  "SELECT * FROM static_financials WHERE symbol = '${SYM}'"

_psql_copy "$OUT/daily_prices.csv" \
  "SELECT * FROM daily_prices WHERE symbol = '${SYM}' ORDER BY date"

_psql_copy "$OUT/corporate_actions.csv" \
  "SELECT * FROM corporate_actions WHERE symbol = '${SYM}' ORDER BY action_date"

_psql_copy "$OUT/earnings_calendar.csv" \
  "SELECT * FROM earnings_calendar WHERE symbol = '${SYM}' ORDER BY date"

_psql_copy "$OUT/insider_trades.csv" \
  "SELECT * FROM insider_trades WHERE symbol = '${SYM}' ORDER BY filing_date NULLS LAST, transaction_date NULLS LAST"

_psql_copy "$OUT/analyst_estimates.csv" \
  "SELECT * FROM analyst_estimates WHERE symbol = '${SYM}' ORDER BY kind, ref_date NULLS LAST, published_date NULLS LAST"

_psql_copy "$OUT/sec_files.csv" \
  "SELECT * FROM sec_files WHERE symbol = '${SYM}' ORDER BY form_type, fiscal_year, fiscal_period"

if [[ "${EXPORT_MACRO:-0}" == "1" ]]; then
  log "including macro_economics (full table)"
  docker-compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 \
    -c "\\copy (SELECT * FROM macro_economics ORDER BY series_id, date) TO STDOUT CSV HEADER" \
    > "$OUT/macro_economics.csv"
fi

log "Done. Files:"
ls -lh "$OUT"
