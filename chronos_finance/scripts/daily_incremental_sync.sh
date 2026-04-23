#!/usr/bin/env bash
#
# Chronos Finance — daily incremental sync (for cron jobs after market close).
#
# This script does NOT:
#   - Truncate any tables
#   - Depend on *_synced flags
#   - Block on completion (fire-and-forget via BackgroundTasks)
#
# It triggers the orchestrator's incremental dataset runs, which automatically:
#   - Query MAX(date) from the target table
#   - Use FMP API parameters like "from=YYYY-MM-DD" to only fetch new data
#   - Upsert with ON CONFLICT DO UPDATE for idempotency
#
# Typical usage:
#   # crontab -e
#   # Run at 5:30 PM ET (after US market close) on weekdays
#   30 17 * * 1-5 /path/to/daily_incremental_sync.sh >> /var/log/chronos/incremental.log 2>&1
#
# Env:
#   APP_WRITE_PORT — host port for write API (default 8001)
#
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"
ROOT_DIR="$(cd "$PROJECT_DIR/.." && pwd)"
export COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.yml}"
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-chronosfinance}"

# Close stdin for background safety
exec </dev/null

# shellcheck disable=SC1091
set -a
[[ -f "$PROJECT_DIR/../.env" ]] && source "$PROJECT_DIR/../.env"
set +a

APP_WRITE_PORT="${APP_WRITE_PORT:-${API_WRITE_PORT:-8001}}"
WRITE_API_BASE="http://localhost:${APP_WRITE_PORT}"

log() { printf "\033[1;36m[incremental]\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m[incremental]\033[0m %s\n" "$*"; }
die() { printf "\033[1;31m[incremental]\033[0m %s\n" "$*" >&2; exit 1; }

http_post_ingest() {
  local dataset_key="$1"
  local code
  code="$(curl -sS -o /tmp/ingest_resp.json -w "%{http_code}" -X POST "${WRITE_API_BASE}/api/v1/ingest/datasets/${dataset_key}/run")"
  if [[ "$code" != "200" && "$code" != "202" ]]; then
    warn "POST /api/v1/ingest/datasets/${dataset_key}/run → HTTP ${code}"
    return 1
  fi
  log "queued: ${dataset_key}"
}

# ── health checks ─────────────────────────────────────────────
if ! docker-compose ps --status running --services 2>/dev/null | grep -qx db; then
  die "db service not running. Start: docker-compose up -d"
fi
if ! curl -sf "${WRITE_API_BASE}/health" > /dev/null; then
  die "Write API not reachable at ${WRITE_API_BASE}/health"
fi

log "Starting daily incremental sync ($(date -Iseconds))"

# ── Symbol-scope datasets (incremental via cursor) ─────────────
# These use the orchestrator's date cursor to only fetch new data.
# Order matters: prices first (most time-sensitive), then others.

# Daily OHLCV prices — highest priority
http_post_ingest "symbol.daily_prices" || true

# Daily market cap
http_post_ingest "symbol.daily_market_cap" || true

# Corporate actions (dividends, splits) — may have new events
http_post_ingest "symbol.corporate_actions" || true

# Earnings calendar — new quarterly reports
http_post_ingest "symbol.earnings_history" || true

# Insider trades — new Form-4 filings
http_post_ingest "symbol.alpha.insider_trades" || true

# Equity Offerings — new stock dilution events
http_post_ingest "symbol.alpha.equity_offerings" || true

# Analyst estimates — updates
http_post_ingest "symbol.alpha.analyst_estimates" || true

# 8-K filings — current events (incremental by filing_date)
http_post_ingest "symbol.alpha.sec_filings_8k" || true

# 10-Q filings — quarterly reports (skips existing periods)
http_post_ingest "symbol.alpha.sec_filings_10q" || true

# Revenue Segmentation — geographic & product breakdowns
http_post_ingest "symbol.financials.revenue_segmentation" || true

# Financial Scores — Altman Z-Score, Piotroski F-Score (daily snapshots)
http_post_ingest "symbol.financials.scores" || true

# Historical Employee Count — yearly/quarterly updates
http_post_ingest "symbol.company_employees_history" || true

# Share float — occasional updates
http_post_ingest "symbol.share_float" || true

# DCF valuation — historical/daily updates
http_post_ingest "symbol.valuation.dcf" || true

# ── Global datasets ────────────────────────────────────────────
# These also use date cursors for incremental fetch.

# Sector performance & P/E ratios
http_post_ingest "global.sector_performance" || true

# Macro indicators (GDP, CPI, etc.)
http_post_ingest "global.macro_economics" || true

# Global calendars (earnings, dividends, splits, IPOs, economic events)
http_post_ingest "global.earnings_calendar" || true
http_post_ingest "global.dividends_calendar" || true
http_post_ingest "global.splits_calendar" || true
http_post_ingest "global.economic_calendar" || true

# Treasury rates
http_post_ingest "global.treasury_rates_wide" || true

log "All incremental jobs queued. Background tasks are running."
log "Monitor: docker-compose logs -f api-write"