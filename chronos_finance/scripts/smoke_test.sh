#!/usr/bin/env bash
#
# Chronos Finance — full smoke test (Phase 2 + Phase 3).
#
# What it does:
#   1. Resets `static_financials` and the 10 sync-flag columns.
#   2. Seeds `stock_universe` with 3 large-cap symbols (AAPL, MSFT, GOOGL)
#      and parks all other symbols as inactive (so the jobs only touch these 3).
#   3. Fires all 10 sync endpoints in parallel:
#         Phase 2: income / balance / cashflow
#         Phase 3: ratios / metrics / scores / enterprise-values /
#                  compensation / segments / peers
#   4. Polls Postgres until every flag × every symbol has flipped TRUE
#      (or the timeout trips, default 300s).
#   5. Prints row counts per data_category and sanity-checks each
#      (symbol, category) pair has at least one row.
#
# Pre-requisites:
#   * Containers running:   `docker-compose up -d`
#   * Valid `FMP_API_KEY` in `.env` (Phase-3 endpoints require FMP Premium).
#
# Usage:
#   cd chronos_finance
#   bash scripts/smoke_test.sh
#
# Optional env:
#   SMOKE_TIMEOUT=600  bash scripts/smoke_test.sh

set -euo pipefail

# ──────────────────────────────────────────────
# Config (auto-detects APP_PORT / POSTGRES_USER from .env)
# ──────────────────────────────────────────────
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

# shellcheck disable=SC1091
set -a; source .env; set +a

APP_PORT="${APP_PORT:-8000}"
POSTGRES_USER="${POSTGRES_USER:-chronos}"
POSTGRES_DB="${POSTGRES_DB:-chronos_finance}"
API_BASE="http://localhost:${APP_PORT}"
TIMEOUT_SECS="${SMOKE_TIMEOUT:-300}"

SYMBOLS=("AAPL" "MSFT" "GOOGL")

# Every (endpoint → flag column) pair we are going to exercise.
SYNC_JOBS=(
  "financials/income       income_synced"
  "financials/balance      balance_synced"
  "financials/cashflow     cashflow_synced"
  "ratios                  ratios_synced"
  "metrics                 metrics_synced"
  "scores                  scores_synced"
  "enterprise-values       ev_synced"
  "compensation            compensation_synced"
  "segments                segments_synced"
  "peers                   peers_synced"
)

# Minimum rows expected in static_financials for each category × symbol.
# Snapshot datasets have exactly 1 row per year per symbol, so threshold=1.
# Annual history datasets should have at least 5 years of data.
declare -A MIN_ROWS=(
  [income_statement_annual]=5
  [balance_sheet_annual]=5
  [cash_flow_annual]=5
  [ratios_annual]=5
  [metrics_annual]=5
  [enterprise_values_annual]=5
  [scores_snapshot]=1
  [peers_snapshot]=1
  [executive_compensation]=1
  [segments_product_annual]=1
  [segments_geographic_annual]=1
)

log()  { printf "\033[1;36m[smoke]\033[0m %s\n" "$*"; }
pass() { printf "\033[1;32m[ ok ]\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m[warn]\033[0m %s\n" "$*"; }
fail() { printf "\033[1;31m[FAIL]\033[0m %s\n" "$*"; }

psql_exec() {
  docker-compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 "$@"
}

# ──────────────────────────────────────────────
# 0. Sanity checks
# ──────────────────────────────────────────────
log "Checking API health at ${API_BASE}/health …"
if ! curl -sf "${API_BASE}/health" > /dev/null; then
  fail "API is not reachable on ${API_BASE}. Is \`docker-compose up -d\` done?"
  exit 1
fi
pass "API healthy"

log "Checking DB connectivity …"
psql_exec -c "SELECT 1;" > /dev/null
pass "DB reachable"

# ──────────────────────────────────────────────
# 1. Reset + seed the universe with 3 test symbols
# ──────────────────────────────────────────────
log "Resetting static_financials and seeding 3 test symbols …"
psql_exec <<SQL
TRUNCATE TABLE static_financials RESTART IDENTITY;

INSERT INTO stock_universe
  (symbol, company_name, exchange, exchange_short_name,
   is_etf, is_actively_trading,
   income_synced, balance_synced, cashflow_synced,
   ratios_synced, metrics_synced, scores_synced, ev_synced,
   compensation_synced, segments_synced, peers_synced,
   raw_payload)
VALUES
  ('AAPL',  'Apple Inc.',       'NASDAQ Global Select', 'NASDAQ', false, true,
    false, false, false, false, false, false, false, false, false, false, '{}'::jsonb),
  ('MSFT',  'Microsoft Corp.',  'NASDAQ Global Select', 'NASDAQ', false, true,
    false, false, false, false, false, false, false, false, false, false, '{}'::jsonb),
  ('GOOGL', 'Alphabet Inc.',    'NASDAQ Global Select', 'NASDAQ', false, true,
    false, false, false, false, false, false, false, false, false, false, '{}'::jsonb)
ON CONFLICT (symbol) DO UPDATE SET
  is_actively_trading = EXCLUDED.is_actively_trading,
  income_synced       = false,
  balance_synced      = false,
  cashflow_synced     = false,
  ratios_synced       = false,
  metrics_synced      = false,
  scores_synced       = false,
  ev_synced           = false,
  compensation_synced = false,
  segments_synced     = false,
  peers_synced        = false;

-- Park every OTHER symbol as inactive so the sync jobs only touch our 3.
UPDATE stock_universe
   SET is_actively_trading = false
 WHERE symbol NOT IN ('AAPL', 'MSFT', 'GOOGL');
SQL
pass "Seeded 3 symbols, parked the rest"

# ──────────────────────────────────────────────
# 2. Fire every sync endpoint
# ──────────────────────────────────────────────
log "Firing 10 sync endpoints …"
for entry in "${SYNC_JOBS[@]}"; do
  path=$(echo "$entry" | awk '{print $1}')
  resp=$(curl -sf -X POST "${API_BASE}/api/v1/sync/${path}")
  printf "   → %-25s %s\n" "${path}" "${resp}"
done
pass "All 10 sync jobs queued"

# ──────────────────────────────────────────────
# 3. Poll until every flag flips (or timeout)
# ──────────────────────────────────────────────
log "Polling DB for completion (timeout = ${TIMEOUT_SECS}s) …"

deadline=$(( $(date +%s) + TIMEOUT_SECS ))
while :; do
  remaining=$(psql_exec -tA <<SQL
SELECT COUNT(*)
  FROM stock_universe
 WHERE symbol IN ('AAPL','MSFT','GOOGL')
   AND (NOT income_synced
        OR NOT balance_synced
        OR NOT cashflow_synced
        OR NOT ratios_synced
        OR NOT metrics_synced
        OR NOT scores_synced
        OR NOT ev_synced
        OR NOT compensation_synced
        OR NOT segments_synced
        OR NOT peers_synced);
SQL
)
  remaining=${remaining//[[:space:]]/}

  if [[ "$remaining" == "0" ]]; then
    pass "All 10 flags × 3 symbols are TRUE."
    break
  fi

  now=$(date +%s)
  if (( now > deadline )); then
    fail "Timeout — still ${remaining} symbol(s) have un-flipped flag(s) after ${TIMEOUT_SECS}s."
    log "Current flag state:"
    psql_exec -c "
SELECT symbol,
       income_synced::int     AS inc,
       balance_synced::int    AS bal,
       cashflow_synced::int   AS cf,
       ratios_synced::int     AS rat,
       metrics_synced::int    AS met,
       scores_synced::int     AS sco,
       ev_synced::int         AS ev,
       compensation_synced::int AS comp,
       segments_synced::int   AS seg,
       peers_synced::int      AS peer
  FROM stock_universe
 WHERE symbol IN ('AAPL','MSFT','GOOGL')
 ORDER BY symbol;
"
    log "Recent API logs:"
    docker-compose logs --tail=120 api
    exit 1
  fi

  printf "   … %s symbol(s) still have pending flags, sleeping 5s\n" "$remaining"
  sleep 5
done

# ──────────────────────────────────────────────
# 4. Row-count report per data_category
# ──────────────────────────────────────────────
log "static_financials row-count report:"
psql_exec -c "
SELECT symbol,
       data_category,
       COUNT(*)               AS rows,
       MIN(fiscal_year)       AS min_year,
       MAX(fiscal_year)       AS max_year
  FROM static_financials
 WHERE symbol IN ('AAPL','MSFT','GOOGL')
 GROUP BY symbol, data_category
 ORDER BY symbol, data_category;
"

# ──────────────────────────────────────────────
# 5. Per (symbol, category) threshold check
# ──────────────────────────────────────────────
log "Validating row-count thresholds …"
any_fail=0
for sym in "${SYMBOLS[@]}"; do
  for category in "${!MIN_ROWS[@]}"; do
    threshold=${MIN_ROWS[$category]}
    actual=$(psql_exec -tA -c "
SELECT COUNT(*) FROM static_financials
 WHERE symbol = '${sym}' AND data_category = '${category}';
")
    actual=${actual//[[:space:]]/}
    if (( actual < threshold )); then
      fail "${sym} / ${category}: ${actual} rows < ${threshold} expected"
      any_fail=1
    else
      printf "   %-35s %-8s rows=%-4s (>= %s)\n" "${category}" "${sym}" "${actual}" "${threshold}"
    fi
  done
done

if (( any_fail != 0 )); then
  fail "Smoke test FAILED — some (symbol, category) pairs are below threshold."
  exit 1
fi

pass "Smoke test PASSED — all 10 datasets synced for all 3 symbols with sane row counts."
