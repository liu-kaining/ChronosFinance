#!/usr/bin/env bash
#
# Chronos Finance — one-shot “full campaign”: universe + all sync jobs + wait until done.
#
# First run (no marker file): TRUNCATEs all fact tables + stock_universe, then pulls everything.
# Later runs (marker exists): does NOT truncate; refreshes universe; re-queues sync jobs —
#   the API only processes symbols whose *_synced flags are still false (resumable).
#
# Background (note stdin closed — avoids zsh “suspended (tty input)” on &):
#   cd chronos_finance
#   nohup bash scripts/full_sync_campaign.sh >> full_sync_campaign.log 2>&1 </dev/null &
#
# If logs look stuck, use GNU stdbuf (brew install coreutils) or run inside tmux.
#
# If you stop this script but leave the API running, in-flight BackgroundTasks continue.
# Re-running immediately can queue duplicate jobs for the same dataset. Safer resume:
#   FULL_SYNC_RESTART_API=1 bash scripts/full_sync_campaign.sh
#
# Env:
#   APP_READ_PORT         — host port for read API (stats/health; default API_PORT or 8000)
#   APP_WRITE_PORT        — host port for write API (sync trigger; default 8001)
#   FULL_SYNC_MARKER      — override path to marker file (default: .chronos_data_campaign_initialized)
#   FULL_SYNC_POLL_SECS   — poll interval (default 30)
#   FULL_SYNC_TIMEOUT_SECS — 0 = no limit; else exit 1 if not done in N seconds
#   FULL_SYNC_UNIVERSE_STABLE_POLLS — consecutive identical active count to treat universe as done (default 3)
#   FULL_SYNC_SKIP_FILINGS — 1 = skip SEC JSON (marks filings_synced true for all active; no POST alpha/filings)
#   FULL_SYNC_RESTART_API — 1 = docker-compose restart api-write before sync (reduces duplicate BG tasks on resume)
#   FULL_SYNC_MIN_MACRO_SERIES — distinct series_id rows required in macro_economics (default 8)
#   FULL_SYNC_QUEUE_ONLY — 1 = do not POST/wait on universe (use when active_symbols already set but
#                          downstream POSTs never ran, e.g. campaign stopped after universe). Implies marker exists.
#   FULL_SYNC_NO_PROGRESS_POLLS — consecutive no-growth polls before treating queue-drained stall
#                                 as terminal failure (default 4)
#   FULL_SYNC_QUEUE_GLOBALS — 1 = after the legacy /sync/* wave, also POST
#                             /api/v1/ingest/datasets/<global key>/run (calendars, treasury, etc.)
#                             (default 0; set to 1 to populate tables like dividend/split/ipo/economic)
#
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"
ROOT_DIR="$(cd "$PROJECT_DIR/.." && pwd)"
export COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.yml}"
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-chronosfinance}"

# Close stdin so this script is safe as a background job (no SIGTTIN / “suspended (tty input)” in zsh).
exec </dev/null

# Line-buffered stdio when stdout is a file (e.g. nohup >> log) so tail -f updates promptly.
if [[ -z "${CHRONOS_CAMPAIGN_LINEBUF:-}" && ! -t 1 ]] && command -v stdbuf >/dev/null 2>&1; then
  export CHRONOS_CAMPAIGN_LINEBUF=1
  exec stdbuf -oL -eL env CHRONOS_CAMPAIGN_LINEBUF=1 bash "$0" "$@"
fi

# shellcheck disable=SC1091
set -a
[[ -f "$PROJECT_DIR/../.env" ]] && source "$PROJECT_DIR/../.env"
set +a

APP_READ_PORT="${APP_READ_PORT:-${API_PORT:-8000}}"
APP_WRITE_PORT="${APP_WRITE_PORT:-${API_WRITE_PORT:-8001}}"
POSTGRES_USER="${POSTGRES_USER:-chronos}"
POSTGRES_DB="${POSTGRES_DB:-chronos_finance}"
READ_API_BASE="http://localhost:${APP_READ_PORT}"
WRITE_API_BASE="http://localhost:${APP_WRITE_PORT}"

MARKER="${FULL_SYNC_MARKER:-$PROJECT_DIR/.chronos_data_campaign_initialized}"
POLL_SECS="${FULL_SYNC_POLL_SECS:-30}"
TIMEOUT_SECS="${FULL_SYNC_TIMEOUT_SECS:-0}"
STABLE_POLLS="${FULL_SYNC_UNIVERSE_STABLE_POLLS:-3}"
SKIP_FILINGS="${FULL_SYNC_SKIP_FILINGS:-0}"
RESTART_API="${FULL_SYNC_RESTART_API:-0}"
MIN_MACRO="${FULL_SYNC_MIN_MACRO_SERIES:-8}"
QUEUE_ONLY="${FULL_SYNC_QUEUE_ONLY:-0}"
NO_PROGRESS_POLLS="${FULL_SYNC_NO_PROGRESS_POLLS:-4}"
QUEUE_GLOBALS="${FULL_SYNC_QUEUE_GLOBALS:-0}"

log() { printf "\033[1;36m[campaign]\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m[campaign]\033[0m %s\n" "$*"; }
die() { printf "\033[1;31m[campaign]\033[0m %s\n" "$*" >&2; exit 1; }

psql_exec() {
  docker-compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 "$@"
}

http_post_sync() {
  local path="$1"
  local code
  code="$(curl -sS -o /tmp/campaign_sync_resp.json -w "%{http_code}" -X POST "${WRITE_API_BASE}/api/v1/sync/${path}")"
  if [[ "$code" != "200" ]]; then
    die "POST /api/v1/sync/${path} → HTTP ${code} $(head -c 200 /tmp/campaign_sync_resp.json)"
  fi
  log "queued: ${path}"
}

http_post_ingest() {
  local dataset_key="$1"
  local code
  code="$(curl -sS -o /tmp/campaign_ingest_resp.json -w "%{http_code}" -X POST "${WRITE_API_BASE}/api/v1/ingest/datasets/${dataset_key}/run")"
  if [[ "$code" != "200" && "$code" != "202" ]]; then
    warn "POST /api/v1/ingest/datasets/${dataset_key}/run → HTTP ${code} $(head -c 120 /tmp/campaign_ingest_resp.json)"
    return 1
  fi
  log "queued ingest: ${dataset_key}"
  return 0
}

queue_global_ingest_datasets() {
  if [[ "$QUEUE_GLOBALS" != "1" ]]; then
    log "FULL_SYNC_QUEUE_GLOBALS!=1 — skip global ingest wave (set FULL_SYNC_QUEUE_GLOBALS=1 to enable)."
    return 0
  fi
  log "Queue global ingest datasets (FMP global calendars + treasury + sector + macro catalog)…"
  local ds
  for ds in \
    global.dividends_calendar \
    global.splits_calendar \
    global.ipos_calendar \
    global.economic_calendar \
    global.earnings_calendar \
    global.treasury_rates_wide \
    global.macro_series_catalog \
    global.sector_performance \
    global.macro_economics
  do
    http_post_ingest "$ds" || true
  done
}

macro_distinct() {
  psql_exec -tA -c "SELECT COUNT(DISTINCT series_id) FROM macro_economics;"
}

reconcile_optional_flags_from_sync_state() {
  # Treat "skipped" as done for datasets where upstream may legitimately have
  # no payload for some symbols (e.g. DCF / market-cap).
  psql_exec <<'SQL' >/dev/null
UPDATE stock_universe su
SET dcf_synced = true
WHERE su.is_actively_trading = true
  AND su.dcf_synced = false
  AND EXISTS (
    SELECT 1
    FROM sync_state ss
    WHERE ss.dataset_key = 'symbol.valuation.dcf'
      AND ss.symbol = su.symbol
      AND ss.status IN ('ok', 'skipped')
  );

UPDATE stock_universe su
SET market_cap_synced = true
WHERE su.is_actively_trading = true
  AND su.market_cap_synced = false
  AND EXISTS (
    SELECT 1
    FROM sync_state ss
    WHERE ss.dataset_key = 'symbol.daily_market_cap'
      AND ss.symbol = su.symbol
      AND ss.status IN ('ok', 'skipped')
  );
SQL
}

wipe_database() {
  log "First run: truncating all campaign tables …"
  psql_exec <<'SQL'
TRUNCATE TABLE
  stock_universe,
  static_financials,
  daily_prices,
  daily_market_cap,
  corporate_actions,
  earnings_calendar,
  dividend_calendar_global,
  split_calendar_global,
  ipo_calendar,
  economic_calendar,
  insider_trades,
  analyst_estimates,
  sec_files,
  stock_news,
  company_press_releases,
  macro_economics,
  macro_series_catalog,
  treasury_rates_wide,
  valuation_dcf,
  sector_performance_series,
  company_employees_history,
  equity_offerings,
  sync_state,
  sync_runs
RESTART IDENTITY CASCADE;
SQL
  log "Truncate done."
}

wait_for_universe_stable() {
  log "POST /sync/universe …"
  http_post_sync "universe"
  log "Background job started — FMP screener + DB upsert can take 1–3 minutes; active_symbols may stay 0 until the first batch commits."
  log "“stable 0/3” while active=0 only means we are not yet stable at a positive count (that is normal early on)."

  local last=-1 stable=0
  local zeros=0
  while true; do
    local json active
    json="$(curl -sS "${READ_API_BASE}/api/v1/stats/sync-progress")" || die "sync-progress request failed"
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
        die "active_symbols stayed 0 for ~${zeros} polls — universe sync failed or screener returned nothing. Check: docker-compose logs api-write"
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
    # Phase 6 — premium datasets
    'active_with_float_synced',
    'active_with_market_cap_synced',
    'active_with_dcf_synced',
]
if os.environ.get('FULL_SYNC_SKIP_FILINGS', '0') == '1':
    keys = [k for k in keys if k != 'active_with_filings_synced']
for k in keys:
    if int(p.get(k) or 0) < a:
        sys.exit(0)
sys.exit(1)
"
}

progress_total() {
  printf '%s\n' "$1" | FULL_SYNC_SKIP_FILINGS="$SKIP_FILINGS" python3 -c "
import json, os, sys
p = json.load(sys.stdin)
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
    'active_with_float_synced',
    'active_with_market_cap_synced',
    'active_with_dcf_synced',
]
if os.environ.get('FULL_SYNC_SKIP_FILINGS', '0') == '1':
    keys = [k for k in keys if k != 'active_with_filings_synced']
print(sum(int(p.get(k) or 0) for k in keys))
"
}

running_ingest_jobs() {
  local runs_json
  if ! runs_json="$(curl -sS "${WRITE_API_BASE}/api/v1/ingest/runs?limit=200")"; then
    # If queue status cannot be fetched, fail open as "still running".
    echo "1"
    return 0
  fi

  printf '%s\n' "$runs_json" | python3 -c "
import json, sys
payload = json.load(sys.stdin)
items = payload.get('items') or []
print(sum(1 for i in items if i.get('status') == 'running'))
"
}

restart_write_api_service() {
  docker-compose restart api-write
  sleep 5
  for _ in $(seq 1 30); do
    if curl -sf "${WRITE_API_BASE}/health" > /dev/null; then
      return 0
    fi
    sleep 2
  done
  return 1
}

queue_all_sync_jobs() {
  local paths=(
    financials/income financials/balance financials/cashflow
    ratios metrics scores enterprise-values compensation segments peers
    market/prices market/actions market/market-cap market/float
    events/earnings
    alpha/insider alpha/estimates
    alpha/filings-10q alpha/filings-8k alpha/equity-offerings
    financials/dcf
    company/employees
    global/sectors
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
if ! curl -sf "${READ_API_BASE}/health" > /dev/null; then
  die "Read API not reachable at ${READ_API_BASE}/health (check APP_READ_PORT/API_PORT in .env)"
fi
if ! curl -sf "${WRITE_API_BASE}/health" > /dev/null; then
  die "Write API not reachable at ${WRITE_API_BASE}/health (check APP_WRITE_PORT in .env)"
fi

if [[ ! -f "$MARKER" ]]; then
  if [[ "$QUEUE_ONLY" == "1" ]]; then
    die "FULL_SYNC_QUEUE_ONLY=1 but marker missing — run once without it (or touch $MARKER after a known-good universe)."
  fi
  wipe_database
  touch "$MARKER"
  log "Created marker: $MARKER (delete this file to force a full wipe next run)"
else
  log "Marker present — skipping truncate (resume / continue mode)."
fi

if [[ "$RESTART_API" == "1" ]]; then
  warn "FULL_SYNC_RESTART_API=1 — restarting api-write to clear duplicate background tasks …"
  restart_write_api_service || die "Write API did not come back after restart"
fi

log "DB: earnings_calendar.fiscal_period_end nullable (idempotent)"
psql_exec -c "ALTER TABLE earnings_calendar ALTER COLUMN fiscal_period_end DROP NOT NULL;" 2>/dev/null || true

if [[ "$QUEUE_ONLY" == "1" ]]; then
  log "FULL_SYNC_QUEUE_ONLY=1 — skipping POST /sync/universe and stability wait (assumes stock_universe is already populated)."
else
  wait_for_universe_stable
fi
log "Proceeding to queue downstream sync jobs …"

if [[ "$SKIP_FILINGS" == "1" ]]; then
  log "FULL_SYNC_SKIP_FILINGS=1 — marking filings_synced for all active symbols"
  psql_exec -c "UPDATE stock_universe SET filings_synced = true WHERE is_actively_trading = true;"
fi

log "Queue all sync jobs (one wave) …"
queue_all_sync_jobs

queue_global_ingest_datasets

log "Poll until every active symbol has all required flags and macro_economics is populated …"
log "Tip: docker-compose logs -f api-write"
start_ts="$(date +%s)"
last_macro_nudge=0
last_progress_total=-1
stalled_polls=0

while true; do
  now="$(date +%s)"
  if (( TIMEOUT_SECS > 0 && now - start_ts > TIMEOUT_SECS )); then
    die "FULL_SYNC_TIMEOUT_SECS=${TIMEOUT_SECS} elapsed — not finished. Check sync-progress and API logs."
  fi

  reconcile_optional_flags_from_sync_state
  prog="$(curl -sS "${READ_API_BASE}/api/v1/stats/sync-progress")" || die "sync-progress failed"
  mc="$(macro_distinct)"
  mc="${mc//[[:space:]]/}"

  sym_line="$(echo "$prog" | python3 -c "import json,sys; p=json.load(sys.stdin); a=p['active_symbols']; print('income %s/%s prices %s/%s filings %s/%s' % (p['active_with_income_synced'], a, p['active_with_prices_synced'], a, p['active_with_filings_synced'], a))")"
  sym_line="${sym_line} macro_series(distinct)=${mc}"

  current_progress_total="$(progress_total "$prog")"
  if (( last_progress_total >= 0 && current_progress_total <= last_progress_total )); then
    stalled_polls=$((stalled_polls + 1))
  else
    stalled_polls=0
  fi
  last_progress_total="$current_progress_total"

  log "progress: $sym_line aggregate_progress=${current_progress_total} stalled=${stalled_polls}/${NO_PROGRESS_POLLS}"

  sym_done=0
  if symbols_incomplete "$prog"; then
    sym_done=0
  else
    sym_done=1
  fi

  if (( sym_done == 1 )) && (( mc >= MIN_MACRO )); then
    running_jobs="$(running_ingest_jobs)"
    running_jobs="${running_jobs//[[:space:]]/}"
    if (( running_jobs == 0 )); then
      log "Campaign complete — all required symbol flags + macro (>= ${MIN_MACRO}) and no running ingest jobs."
      curl -sS "${READ_API_BASE}/api/v1/stats/overview" | python3 -m json.tool || true
      exit 0
    fi
    warn "Flags/macro look complete, but ingest queue still has ${running_jobs} running job(s); wait until queue drains."
  fi

  if (( stalled_polls >= NO_PROGRESS_POLLS )); then
    running_jobs="$(running_ingest_jobs)"
    running_jobs="${running_jobs//[[:space:]]/}"
    if (( running_jobs == 0 )); then
      die "No progress for ${stalled_polls} polls, queue is empty, and strict completion is still unmet. Treating campaign as failed terminal state."
    else
      warn "No progress for ${stalled_polls} polls and ${running_jobs} running job(s) remain; keep waiting."
    fi
  fi

  now="$(date +%s)"
  if (( mc < MIN_MACRO )) && (( now - last_macro_nudge > 300 )); then
    warn "macro series count ${mc} < ${MIN_MACRO} — re-queue macro/indicators"
    http_post_sync "macro/indicators"
    last_macro_nudge=$now
  fi

  sleep "$POLL_SECS"
done
