#!/usr/bin/env bash
set -euo pipefail

# One-shot full ingest launcher (manual, non-cron).
#
# What it does:
# 1) Trigger legacy universe refresh (still not datasetized).
# 2) Force-queue ALL enabled datasets via ingest scheduler.
#
# Run in background:
#   cd chronos_finance
#   nohup bash scripts/run_full_ingest_once.sh >> full_ingest_once.log 2>&1 </dev/null &
#
# Env:
#   APP_PORT   default 8000 (your compose currently maps to 8003)

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

set -a
[[ -f .env ]] && source .env
set +a

APP_PORT="${APP_PORT:-8000}"
API_BASE="http://localhost:${APP_PORT}"

log() { printf "[full-ingest-once] %s\n" "$*"; }
die() { printf "[full-ingest-once] ERROR: %s\n" "$*" >&2; exit 1; }

log "health check: ${API_BASE}/health"
curl -sf "${API_BASE}/health" >/dev/null || die "API is not reachable"

log "trigger universe refresh (legacy compatibility endpoint)"
code="$(curl -sS -o /tmp/full_ingest_once_universe.json -w "%{http_code}" -X POST "${API_BASE}/api/v1/sync/universe")" || code="000"
[[ "$code" == "200" ]] || die "POST /api/v1/sync/universe failed (HTTP ${code})"

log "force-queue all enabled datasets once"
APP_PORT="$APP_PORT" INGEST_SCHED_FORCE_ALL=1 INGEST_SCHED_TRIGGER=manual_full_once bash scripts/ingest_scheduler.sh

log "done: all enabled datasets have been queued once"
