#!/usr/bin/env bash
#
# Chronos Finance — one-shot “full campaign”: universe + all sync jobs + wait until done.
#
# First run (no marker file): TRUNCATEs all fact tables + stock_universe, then pulls everything.
# Later runs (marker exists): does NOT truncate; refreshes universe; re-queues sync jobs —
#   the API only processes symbols whose *_synced flags are still false (resumable).
#
# Background:
#   cd chronos_finance
#   nohup bash scripts/full_sync_campaign.sh >> full_sync_campaign.log 2>&1 &
#
# If you stop this script but leave the API running, in-flight BackgroundTasks continue.
# Re-running immediately can queue duplicate jobs for the same dataset. Safer resume:
#   FULL_SYNC_RESTART_API=1 bash scripts/full_sync_campaign.sh
#
# Env:
#   APP_PORT              — host port for API (from .env; default 8000)
#   FULL_SYNC_MARKER      — override path to marker file (default: .chronos_data_campaign_initialized)
#   FULL_SYNC_POLL_SECS   — poll interval (default 30)
#   FULL_SYNC_TIMEOUT_SECS — 0 = no limit; else exit 1 if not done in N seconds
#   FULL_SYNC_UNIVERSE_STABLE_POLLS — consecutive identical active count to treat universe as done (default 3)
#   FULL_SYNC_SKIP_FILINGS — 1 = skip SEC JSON (marks filings_synced true for all active; no POST alpha/filings)
#   FULL_SYNC_RESTART_API — 1 = docker-compose restart api before sync (reduces duplicate BG tasks on resume)
#   FULL_SYNC_MIN_MACRO_SERIES — distinct series_id rows required in macro_economics (default 8)
#
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

# shellcheck disable=SC1091
set -a
[[ -f .env ]] && source .env
set +a

APP_PORT="${APP_PORT:-8000}"
POSTGRES_USER="${POSTGRES_USER:-chronos}"
POSTGRES_DB="${POSTGRES_DB:-chronos_finance}"
API_BASE="http://localhost:${APP_PORT}"

MARKER="${FULL_SYNC_MARKER:-$PROJECT_DIR/.chronos_data_campaign_initialized}"
POLL_SECS="${FULL_SYNC_POLL_SECS:-30}"
TIMEOUT_SECS="${FULL_SYNC_TIMEOUT_SECS:-0}"
STABLE_POLLS="${FULL_SYNC_UNIVERSE_STABLE_POLLS:-3}"
SKIP_FILINGS="${FULL_SYNC_SKIP_FILINGS:-0}"
RESTART_API="${FULL_SYNC_RESTART_API:-0}"
MIN_MACRO="${FULL_SYNC_MIN_MACRO_SERIES:-8}"

log() { printf "\033[1;36m[campaign]\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m[campaign]\033[0m %s\n" "$*"; }
die() { printf "\033[1;31m[campaign]\033[0m %s\n" "$*" >&2; exit 1; }

psql_exec() {
  docker-compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 "$@"
}

http_post_sync() {
  local path="$1"
  local code
  code="$(curl -sS -o /tmp/campaign_sync_resp.json -w "%{http_code}" -X POST "${API_BASE}/api/v1/sync/${path}")"
  if [[ "$code" != "200" ]]; then
    die "POST /api/v1/sync/${path} → HTTP ${code} $(head -c 200 /tmp/campaign_sync_resp.json)"
  fi
  log "queued: ${path}"
}

macro_distinct() {
  psql_exec -tA -c "SELECT COUNT(DISTINCT series_id) FROM macro_economics;"
}

wipe_database() {
  log "First run: truncating all campaign tables …"
  psql_exec <<'SQL'
TRUNCATE TABLE
  stock_universe,
  static_financials,
  daily_prices,
  corporate_actions,
  earnings_calendar,
  insider_trades,
  analyst_estimates,
  sec_files,
  macro_economics
RESTART IDENTITY CASCADE;
SQL
  log "Truncate done."
}

wait_for_universe_stable() {
  log "POST /sync/universe …"
  http_post_sync "universe"

  local last=-1 stable=0
  local zeros=0
  while true; do
    local json active
    json="$(curl -sS "${API_BASE}/api/v1/stats/sync-progress")" || die "sync-progress request failed"
    active="$(echo "$json" | python3 -c 'import json,sys; print(int(json.load(sys.stdin)["active_symbols"]))')"

    if (( active == last && active > 0 )); then
      stable=$((stable + 1))
    else
      stable=0
    fi
    last=$active

    log "universe poll: active_symbols=${active} (stable ${stable}/${STABLE_POLLS})"
    if (( stable >= STABLE_POLLS )); then
      log "Universe load looks stable."
      return 0
    fi

    if (( active == 0 )); then
      zeros=$((zeros + 1))
      if (( zeros >= 120 )); then
        die "active_symbols stayed 0 for ~${zeros} polls — universe sync failed or screener returned nothing. Check: docker-compose logs api"
      fi
    else
      zeros=0
    fi

    sleep "$POLL_SECS"
  done
}

# Exit 0 = still incomplete; exit 1 = all required symbol flags match active count.
symbols_incomplete() {
  printf '%s\n' "$1" | FULL_SYNC_SKIP_FILINGS="$SKIP_FILINGS" python3 -c "
import json, os, sys
p = json.load(sys.stdin)
a = int(p.get('active_symbols') or 0)
if a < 1:
    sys.exit(0)
keys = [
    'active_with_income_synced',
    'active_with_balance_synced',
    'active_with_cashflow_synced',
    'active_with_ratios_synced',
    'active_with_metrics_synced',
    'active_with_scores_synced',
    'active_with_ev_synced',
    'active_with_compensation_synced',
    'active_with_segments_synced',
    'active_with_peers_synced',
    'active_with_prices_synced',
    'active_with_actions_synced',
    'active_with_earnings_synced',
    'active_with_insider_synced',
    'active_with_estimates_synced',
    'active_with_filings_synced',
]
if os.environ.get('FULL_SYNC_SKIP_FILINGS', '0') == '1':
    keys = [k for k in keys if k != 'active_with_filings_synced']
for k in keys:
    if int(p.get(k) or 0) < a:
        sys.exit(0)
sys.exit(1)
"
}

queue_all_sync_jobs() {
  local paths=(
    financials/income financials/balance financials/cashflow
    ratios metrics scores enterprise-values compensation segments peers
    market/prices market/actions events/earnings
    alpha/insider alpha/estimates
    macro/indicators
  )
  if [[ "$SKIP_FILINGS" != "1" ]]; then
    paths+=(alpha/filings)
  fi
  local p
  for p in "${paths[@]}"; do
    http_post_sync "$p"
  done
}

# ── main ─────────────────────────────────────────────────────

if ! docker-compose ps --status running --services 2>/dev/null | grep -qx db; then
  die "db service not running. Start: docker-compose up -d"
fi
if ! curl -sf "${API_BASE}/health" > /dev/null; then
  die "API not reachable at ${API_BASE}/health (check APP_PORT in .env)"
fi

if [[ ! -f "$MARKER" ]]; then
  wipe_database
  touch "$MARKER"
  log "Created marker: $MARKER (delete this file to force a full wipe next run)"
else
  log "Marker present — skipping truncate (resume / continue mode)."
fi

if [[ "$RESTART_API" == "1" ]]; then
  warn "FULL_SYNC_RESTART_API=1 — restarting api to clear duplicate background tasks …"
  docker-compose restart api
  sleep 5
  for _ in $(seq 1 30); do
    if curl -sf "${API_BASE}/health" > /dev/null; then
      break
    fi
    sleep 2
  done
  curl -sf "${API_BASE}/health" > /dev/null || die "API did not come back after restart"
fi

log "DB: earnings_calendar.fiscal_period_end nullable (idempotent)"
psql_exec -c "ALTER TABLE earnings_calendar ALTER COLUMN fiscal_period_end DROP NOT NULL;" 2>/dev/null || true

wait_for_universe_stable

if [[ "$SKIP_FILINGS" == "1" ]]; then
  log "FULL_SYNC_SKIP_FILINGS=1 — marking filings_synced for all active symbols"
  psql_exec -c "UPDATE stock_universe SET filings_synced = true WHERE is_actively_trading = true;"
fi

log "Queue all sync jobs (one wave) …"
queue_all_sync_jobs

log "Poll until every active symbol has all required flags and macro_economics is populated …"
log "Tip: docker-compose logs -f api"
start_ts="$(date +%s)"
last_macro_nudge=0

while true; do
  now="$(date +%s)"
  if (( TIMEOUT_SECS > 0 && now - start_ts > TIMEOUT_SECS )); then
    die "FULL_SYNC_TIMEOUT_SECS=${TIMEOUT_SECS} elapsed — not finished. Check sync-progress and API logs."
  fi

  prog="$(curl -sS "${API_BASE}/api/v1/stats/sync-progress")" || die "sync-progress failed"
  mc="$(macro_distinct)"
  mc="${mc//[[:space:]]/}"

  sym_line="$(echo "$prog" | python3 -c "import json,sys; p=json.load(sys.stdin); a=p['active_symbols']; print('income %s/%s prices %s/%s filings %s/%s' % (p['active_with_income_synced'], a, p['active_with_prices_synced'], a, p['active_with_filings_synced'], a))")"
  sym_line="${sym_line} macro_series(distinct)=${mc}"

  log "progress: $sym_line"

  sym_done=0
  if symbols_incomplete "$prog"; then
    sym_done=0
  else
    sym_done=1
  fi

  if (( sym_done == 1 )) && (( mc >= MIN_MACRO )); then
    log "Campaign complete — all required symbol flags and macro (>= ${MIN_MACRO} series)."
    curl -sS "${API_BASE}/api/v1/stats/overview" | python3 -m json.tool || true
    exit 0
  fi

  now="$(date +%s)"
  if (( mc < MIN_MACRO )) && (( now - last_macro_nudge > 300 )); then
    warn "macro series count ${mc} < ${MIN_MACRO} — re-queue macro/indicators"
    http_post_sync "macro/indicators"
    last_macro_nudge=$now
  fi

  sleep "$POLL_SECS"
done
