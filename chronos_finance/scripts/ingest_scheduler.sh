#!/usr/bin/env bash
set -euo pipefail

# Chronos ingest scheduler (v2)
# ----------------------------------------
# Drives the new write-side API: /api/v1/ingest/*
#
# Recommended cron:
#   */15 * * * * cd /path/to/chronos_finance && bash scripts/ingest_scheduler.sh >> ingest_scheduler.log 2>&1
#
# The script is idempotent and cadence-aware:
# - reads dataset registry from /api/v1/ingest/datasets
# - keeps last queued timestamps in a local state file
# - only queues datasets whose cadence window has elapsed
#
# Env:
#   APP_WRITE_PORT             default 8001
#   INGEST_SCHED_STATE_FILE    default .ingest_scheduler_state.json
#   INGEST_SCHED_FORCE_ALL     1 = ignore cadence and queue all enabled datasets once
#   INGEST_SCHED_DRY_RUN       1 = print due datasets without POST
#   INGEST_SCHED_TRIGGER       default scheduler

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

set -a
[[ -f .env ]] && source .env
set +a

APP_WRITE_PORT="${APP_WRITE_PORT:-8001}"
API_BASE="http://localhost:${APP_WRITE_PORT}"
STATE_FILE="${INGEST_SCHED_STATE_FILE:-$PROJECT_DIR/.ingest_scheduler_state.json}"
FORCE_ALL="${INGEST_SCHED_FORCE_ALL:-0}"
DRY_RUN="${INGEST_SCHED_DRY_RUN:-0}"
TRIGGER="${INGEST_SCHED_TRIGGER:-scheduler}"

log() { printf "\033[1;36m[ingest-scheduler]\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m[ingest-scheduler]\033[0m %s\n" "$*"; }
die() { printf "\033[1;31m[ingest-scheduler]\033[0m %s\n" "$*" >&2; exit 1; }

if ! curl -sf "${API_BASE}/health" > /dev/null; then
  die "API not reachable at ${API_BASE}/health"
fi

datasets_json="$(curl -sS "${API_BASE}/api/v1/ingest/datasets")" || die "failed to fetch datasets"

mkdir -p "$(dirname "$STATE_FILE")"
if [[ ! -f "$STATE_FILE" ]]; then
  echo '{}' > "$STATE_FILE"
fi

due_keys="$(
python3 - <<'PY' "$datasets_json" "$STATE_FILE" "$FORCE_ALL"
import json
import sys
import time
from pathlib import Path

datasets_raw = json.loads(sys.argv[1])
state_path = Path(sys.argv[2])
force_all = sys.argv[3] == "1"
now = int(time.time())

try:
    state = json.loads(state_path.read_text(encoding="utf-8"))
    if not isinstance(state, dict):
        state = {}
except Exception:
    state = {}

out = []
for ds in datasets_raw.get("datasets", []):
    if not ds.get("enabled", True):
        continue
    key = ds.get("dataset_key")
    if not key:
        continue
    cadence = int(ds.get("cadence_seconds") or 0)
    last = int(state.get(key, 0) or 0)
    due = force_all or cadence <= 0 or (now - last >= cadence)
    if due:
        out.append(key)

print("\n".join(out))
PY
)"

if [[ -z "${due_keys//[[:space:]]/}" ]]; then
  log "no dataset due"
  exit 0
fi

queued=0
failed=0
now_epoch="$(date +%s)"
tmp_state="$(mktemp)"
cp "$STATE_FILE" "$tmp_state"

while IFS= read -r key; do
  [[ -z "$key" ]] && continue
  if [[ "$DRY_RUN" == "1" ]]; then
    log "[dry-run] due: $key"
  else
    code="$(curl -sS -o /tmp/ingest_scheduler_resp.json -w "%{http_code}" -X POST "${API_BASE}/api/v1/ingest/datasets/${key}/run?trigger=${TRIGGER}")" || code="000"
    if [[ "$code" != "200" ]]; then
      warn "queue failed: $key (HTTP ${code})"
      failed=$((failed + 1))
      continue
    fi
    log "queued: $key"
  fi

  python3 - <<'PY' "$tmp_state" "$key" "$now_epoch"
import json
import sys
from pathlib import Path

p = Path(sys.argv[1])
key = sys.argv[2]
ts = int(sys.argv[3])
state = json.loads(p.read_text(encoding="utf-8"))
state[key] = ts
p.write_text(json.dumps(state, ensure_ascii=False, sort_keys=True, indent=2), encoding="utf-8")
PY
  queued=$((queued + 1))
done <<< "$due_keys"

mv "$tmp_state" "$STATE_FILE"

log "done: queued=${queued} failed=${failed} state=${STATE_FILE}"
if (( failed > 0 )); then
  exit 1
fi
