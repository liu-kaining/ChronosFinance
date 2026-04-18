#!/usr/bin/env bash
# One-shot E2E verification: 3 symbols, all sync endpoints (no universe screener),
# poll until all flags are TRUE or timeout.
#
# Why it looks "stuck": POST /alpha/filings runs in the background and pulls
# several years of 10-K JSON per symbol — often 15–45 minutes for 3 tickers.
# The script is waiting on filings_synced, not frozen.
#
# Quick run (no SEC, ~3–8 min):
#   VERIFY_SKIP_FILINGS=1 bash scripts/verify_full.sh
#
# Full run (default timeout 3600s = 1h):
#   VERIFY_TIMEOUT=7200 bash scripts/verify_full.sh
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

# shellcheck disable=SC1091
set -a; source .env; set +a

APP_PORT="${APP_PORT:-8000}"
POSTGRES_USER="${POSTGRES_USER:-chronos}"
POSTGRES_DB="${POSTGRES_DB:-chronos_finance}"
API_BASE="http://localhost:${APP_PORT}"

if [[ "${VERIFY_SKIP_FILINGS:-0}" == "1" ]]; then
  DEFAULT_TIMEOUT=600
else
  DEFAULT_TIMEOUT=3600
fi
TIMEOUT_SECS="${VERIFY_TIMEOUT:-$DEFAULT_TIMEOUT}"

psql_exec() {
  docker-compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 "$@"
}

log()  { printf "\033[1;36m[verify]\033[0m %s\n" "$*"; }
pass() { printf "\033[1;32m[  ok  ]\033[0m %s\n" "$*"; }
fail() { printf "\033[1;31m[FAIL ]\033[0m %s\n" "$*"; }

log "API=${API_BASE}  timeout=${TIMEOUT_SECS}s  VERIFY_SKIP_FILINGS=${VERIFY_SKIP_FILINGS:-0}"

if ! curl -sf "${API_BASE}/health" > /dev/null; then
  fail "API not reachable at ${API_BASE}/health"
  exit 1
fi
pass "health"

log "DB: earnings_calendar.fiscal_period_end nullable (idempotent)"
psql_exec -c "ALTER TABLE earnings_calendar ALTER COLUMN fiscal_period_end DROP NOT NULL;" 2>/dev/null || true

log "Reset test symbols + clear their fact rows"
psql_exec <<'SQL'
-- Keep only our 3-ticker lab; park everyone else.
UPDATE stock_universe SET is_actively_trading = false
 WHERE symbol NOT IN ('AAPL','MSFT','GOOGL');

INSERT INTO stock_universe
  (symbol, company_name, exchange, exchange_short_name,
   is_etf, is_actively_trading,
   income_synced, balance_synced, cashflow_synced,
   ratios_synced, metrics_synced, scores_synced, ev_synced,
   compensation_synced, segments_synced, peers_synced,
   prices_synced, actions_synced, earnings_synced,
   insider_synced, estimates_synced, filings_synced,
   raw_payload)
VALUES
  ('AAPL',  'Apple Inc.',       'NASDAQ Global Select', 'NASDAQ', false, true,
    false,false,false,
    false,false,false,false,false,false,false,
    false,false,false,false,false,false,
    '{}'::jsonb),
  ('MSFT',  'Microsoft Corp.',  'NASDAQ Global Select', 'NASDAQ', false, true,
    false,false,false,
    false,false,false,false,false,false,false,
    false,false,false,false,false,false,
    '{}'::jsonb),
  ('GOOGL', 'Alphabet Inc.',    'NASDAQ Global Select', 'NASDAQ', false, true,
    false,false,false,
    false,false,false,false,false,false,false,
    false,false,false,false,false,false,
    '{}'::jsonb)
ON CONFLICT (symbol) DO UPDATE SET
  is_actively_trading = true,
  income_synced = false, balance_synced = false, cashflow_synced = false,
  ratios_synced = false, metrics_synced = false, scores_synced = false,
  ev_synced = false, compensation_synced = false, segments_synced = false,
  peers_synced = false,
  prices_synced = false, actions_synced = false, earnings_synced = false,
  insider_synced = false, estimates_synced = false, filings_synced = false;

DELETE FROM static_financials WHERE symbol IN ('AAPL','MSFT','GOOGL');
DELETE FROM daily_prices      WHERE symbol IN ('AAPL','MSFT','GOOGL');
DELETE FROM corporate_actions  WHERE symbol IN ('AAPL','MSFT','GOOGL');
DELETE FROM earnings_calendar  WHERE symbol IN ('AAPL','MSFT','GOOGL');
DELETE FROM insider_trades     WHERE symbol IN ('AAPL','MSFT','GOOGL');
DELETE FROM analyst_estimates  WHERE symbol IN ('AAPL','MSFT','GOOGL');
DELETE FROM sec_files          WHERE symbol IN ('AAPL','MSFT','GOOGL');
TRUNCATE TABLE macro_economics RESTART IDENTITY;
SQL

if [[ "${VERIFY_SKIP_FILINGS:-0}" == "1" ]]; then
  psql_exec -c "UPDATE stock_universe SET filings_synced = true WHERE symbol IN ('AAPL','MSFT','GOOGL');"
  log "VERIFY_SKIP_FILINGS=1 — filings_synced pre-marked TRUE (no SEC pull)"
fi

pass "seed + truncate"

SYNC_PATHS=(
  financials/income
  financials/balance
  financials/cashflow
  ratios metrics scores enterprise-values compensation segments peers
  market/prices market/actions events/earnings
  alpha/insider alpha/estimates
  macro/indicators
)
if [[ "${VERIFY_SKIP_FILINGS:-0}" != "1" ]]; then
  SYNC_PATHS+=(alpha/filings)
fi

log "Queue ${#SYNC_PATHS[@]} sync jobs"
for p in "${SYNC_PATHS[@]}"; do
  code=$(curl -sS -o /tmp/verify_resp.json -w "%{http_code}" -X POST "${API_BASE}/api/v1/sync/${p}")
  printf "   → %-26s HTTP %s %s\n" "$p" "$code" "$(head -c 80 /tmp/verify_resp.json; echo)"
  if [[ "$code" != "200" ]]; then
    fail "POST /api/v1/sync/${p} returned HTTP $code"
    cat /tmp/verify_resp.json
    exit 1
  fi
done
pass "all jobs accepted"

log "Poll until all required flags × 3 symbols (or timeout)…"
log "Tip: tail logs in another terminal: docker-compose logs -f api"
deadline=$(( $(date +%s) + TIMEOUT_SECS ))
start_ts=$(date +%s)
while :; do
  pending=$(psql_exec -tA <<'SQL'
SELECT COUNT(*) FROM stock_universe
 WHERE symbol IN ('AAPL','MSFT','GOOGL')
   AND (
     NOT income_synced OR NOT balance_synced OR NOT cashflow_synced
     OR NOT ratios_synced OR NOT metrics_synced OR NOT scores_synced
     OR NOT ev_synced OR NOT compensation_synced OR NOT segments_synced
     OR NOT peers_synced OR NOT prices_synced OR NOT actions_synced
     OR NOT earnings_synced OR NOT insider_synced OR NOT estimates_synced
     OR NOT filings_synced
   );
SQL
)
  pending=${pending//[[:space:]]/}
  if [[ "$pending" == "0" ]]; then
    pass "all required flags TRUE for AAPL, MSFT, GOOGL"
    break
  fi
  now=$(date +%s)
  elapsed=$((now - start_ts))
  printf "   [%4ds] symbols still incomplete: %s  (0=done)\n" "$elapsed" "$pending"
  psql_exec -c "
SELECT symbol,
  16 - (income_synced::int + balance_synced::int + cashflow_synced::int
    + ratios_synced::int + metrics_synced::int + scores_synced::int
    + ev_synced::int + compensation_synced::int + segments_synced::int
    + peers_synced::int + prices_synced::int + actions_synced::int
    + earnings_synced::int + insider_synced::int + estimates_synced::int
    + filings_synced::int) AS flags_left
FROM stock_universe
WHERE symbol IN ('AAPL','MSFT','GOOGL')
ORDER BY symbol;
" | sed 's/^/      /'

  now=$(date +%s)
  if (( now > deadline )); then
    fail "timeout with ${pending} symbol-row(s) still pending flags"
    psql_exec -c "
SELECT symbol,
  income_synced::int AS i, balance_synced::int AS b, cashflow_synced::int AS c,
  ratios_synced::int AS r, metrics_synced::int AS m, scores_synced::int AS s,
  ev_synced::int AS ev, compensation_synced::int AS comp, segments_synced::int AS seg,
  peers_synced::int AS p, prices_synced::int AS px, actions_synced::int AS ac,
  earnings_synced::int AS e, insider_synced::int AS in_, estimates_synced::int AS est,
  filings_synced::int AS f
FROM stock_universe WHERE symbol IN ('AAPL','MSFT','GOOGL') ORDER BY symbol;"
    docker-compose logs --tail=200 api
    exit 1
  fi
  sleep 10
done

log "Row counts"
psql_exec -c "
SELECT 'static_financials' AS t, COUNT(*)::text FROM static_financials WHERE symbol IN ('AAPL','MSFT','GOOGL')
UNION ALL SELECT 'daily_prices',      COUNT(*)::text FROM daily_prices      WHERE symbol IN ('AAPL','MSFT','GOOGL')
UNION ALL SELECT 'corporate_actions', COUNT(*)::text FROM corporate_actions WHERE symbol IN ('AAPL','MSFT','GOOGL')
UNION ALL SELECT 'earnings_calendar', COUNT(*)::text FROM earnings_calendar WHERE symbol IN ('AAPL','MSFT','GOOGL')
UNION ALL SELECT 'insider_trades',    COUNT(*)::text FROM insider_trades    WHERE symbol IN ('AAPL','MSFT','GOOGL')
UNION ALL SELECT 'analyst_estimates', COUNT(*)::text FROM analyst_estimates WHERE symbol IN ('AAPL','MSFT','GOOGL')
UNION ALL SELECT 'sec_files',         COUNT(*)::text FROM sec_files         WHERE symbol IN ('AAPL','MSFT','GOOGL')
UNION ALL SELECT 'macro_economics',   COUNT(*)::text FROM macro_economics;
"

pass "VERIFY_FULL PASSED"
