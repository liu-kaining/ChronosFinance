#!/usr/bin/env bash
#
# Restore ChronosFinance DB dump from R2 manifest + chunk parts.
#
# Workflow:
# 1) Download manifest object from R2.
# 2) Download each part listed in manifest.
# 3) Verify each part SHA256 (if provided).
# 4) Concatenate parts into a local dump file.
# 5) Verify full-file SHA256 against manifest.
# 6) By default, call scripts/restore_db.sh to restore DB.
#
# Usage:
#   bash scripts/restore_from_r2_manifest.sh
#   bash scripts/restore_from_r2_manifest.sh --download-only
#   bash scripts/restore_from_r2_manifest.sh --output backups/restore_target.dump
#   bash scripts/restore_from_r2_manifest.sh --restore --clean --no-confirm
#
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

set -a
[[ -f "$PROJECT_DIR/.env" ]] && source "$PROJECT_DIR/.env"
set +a

R2_ENDPOINT_URL="${R2_ENDPOINT_URL:-}"
R2_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID:-}"
R2_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY:-}"
R2_BUCKET_NAME="${R2_BUCKET_NAME:-}"
R2_REGION="${R2_REGION:-auto}"
R2_OBJECT_KEY="${R2_OBJECT_KEY:-chronos_finance_latest.dump}"
R2_MANIFEST_KEY="${R2_MANIFEST_KEY:-${R2_OBJECT_KEY}.manifest.json}"
OUTPUT_FILE="${OUTPUT_FILE:-$PROJECT_DIR/backups/chronos_finance_latest_from_r2.dump}"

DO_RESTORE=true
RESTORE_CLEAN=false
RESTORE_NO_CONFIRM=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --download-only)
      DO_RESTORE=false
      shift
      ;;
    --restore)
      DO_RESTORE=true
      shift
      ;;
    --clean)
      RESTORE_CLEAN=true
      shift
      ;;
    --no-confirm)
      RESTORE_NO_CONFIRM=true
      shift
      ;;
    --output)
      OUTPUT_FILE="${2:-}"
      [[ -n "$OUTPUT_FILE" ]] || { echo "missing value for --output" >&2; exit 1; }
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

log() { printf "\033[1;36m[restore-r2]\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m[restore-r2]\033[0m %s\n" "$*"; }
die() { printf "\033[1;31m[restore-r2]\033[0m %s\n" "$*" >&2; exit 1; }

[[ -n "$R2_ENDPOINT_URL" ]] || die "R2_ENDPOINT_URL is required in .env"
[[ -n "$R2_ACCESS_KEY_ID" ]] || die "R2_ACCESS_KEY_ID is required in .env"
[[ -n "$R2_SECRET_ACCESS_KEY" ]] || die "R2_SECRET_ACCESS_KEY is required in .env"
[[ -n "$R2_BUCKET_NAME" ]] || die "R2_BUCKET_NAME is required in .env"

export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="$R2_REGION"

use_aws_cli=false
if command -v aws >/dev/null 2>&1; then
  use_aws_cli=true
else
  warn "aws cli not found on host, will use api-write container (boto3) for R2 operations."
  docker compose ps --status running --services 2>/dev/null | grep -qx api-write \
    || die "api-write service is not running. Start with: docker compose up -d api-write"
fi

r2_download_object() {
  local object_key="$1"
  local output_path="$2"

  if [[ "$use_aws_cli" == "true" ]]; then
    aws s3 cp "s3://$R2_BUCKET_NAME/$object_key" "$output_path" --endpoint-url "$R2_ENDPOINT_URL" >/dev/null
  else
    local container_file="/tmp/r2_restore_$(date +%s%N).bin"
    docker compose exec -T \
      -e R2_ENDPOINT_URL="$R2_ENDPOINT_URL" \
      -e R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
      -e R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
      -e R2_BUCKET_NAME="$R2_BUCKET_NAME" \
      -e R2_REGION="$R2_REGION" \
      -e OBJECT_KEY="$object_key" \
      -e CONTAINER_FILE="$container_file" \
      api-write python - <<'PY' >/dev/null
import os
import boto3
from botocore.config import Config

s3 = boto3.client(
    "s3",
    endpoint_url=os.environ["R2_ENDPOINT_URL"],
    aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
    aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
    region_name=os.environ.get("R2_REGION", "auto"),
    config=Config(connect_timeout=30, read_timeout=600, retries={"max_attempts": 10, "mode": "standard"}),
)
s3.download_file(os.environ["R2_BUCKET_NAME"], os.environ["OBJECT_KEY"], os.environ["CONTAINER_FILE"])
print("ok")
PY
    docker cp chronos-api-write:"$container_file" "$output_path" >/dev/null
    docker compose exec -T api-write rm -f "$container_file" >/dev/null 2>&1 || true
  fi
}

tmp_dir="$(mktemp -d)"
cleanup() { rm -rf "$tmp_dir"; }
trap cleanup EXIT

manifest_file="$tmp_dir/manifest.json"
log "Downloading manifest: r2://$R2_BUCKET_NAME/$R2_MANIFEST_KEY"
r2_download_object "$R2_MANIFEST_KEY" "$manifest_file"
[[ -s "$manifest_file" ]] || die "Manifest is empty or missing."

manifest_meta=()
while IFS= read -r line; do
  manifest_meta+=("$line")
done < <(python3 - <<'PY' "$manifest_file"
import json,sys
with open(sys.argv[1], "r", encoding="utf-8") as f:
    m = json.load(f)
print(m.get("file_sha256",""))
print(m.get("part_count",""))
PY
)

expected_file_sha="${manifest_meta[0]:-}"
expected_part_count="${manifest_meta[1]:-}"
[[ -n "$expected_part_count" ]] || die "Invalid manifest: missing part_count"

log "Manifest part_count=$expected_part_count file_sha256=${expected_file_sha:-<none>}"

part_rows=()
while IFS= read -r line; do
  part_rows+=("$line")
done < <(python3 - <<'PY' "$manifest_file"
import json,sys
with open(sys.argv[1], "r", encoding="utf-8") as f:
    m = json.load(f)
for p in m.get("parts", []):
    print(f"{p.get('index','')}\t{p.get('key','')}\t{p.get('sha256','')}")
PY
)

[[ "${#part_rows[@]}" -gt 0 ]] || die "Manifest contains no parts."

mkdir -p "$(dirname "$OUTPUT_FILE")"
assembled_tmp="$tmp_dir/assembled.dump"
>"$assembled_tmp"

for row in "${part_rows[@]}"; do
  idx="$(echo "$row" | awk -F'\t' '{print $1}')"
  key="$(echo "$row" | awk -F'\t' '{print $2}')"
  sha="$(echo "$row" | awk -F'\t' '{print $3}')"
  [[ -n "$key" ]] || die "Invalid manifest part key."

  part_file="$tmp_dir/part-${idx}.bin"
  log "Downloading part $idx: $key"
  r2_download_object "$key" "$part_file"
  [[ -s "$part_file" ]] || die "Downloaded part is empty: $key"

  if [[ -n "$sha" ]]; then
    got_sha="$(shasum -a 256 "$part_file" | awk '{print $1}')"
    [[ "$got_sha" == "$sha" ]] || die "Part SHA mismatch for $key (expected=$sha got=$got_sha)"
  fi

  cat "$part_file" >> "$assembled_tmp"
done

mv "$assembled_tmp" "$OUTPUT_FILE"
log "Assembled dump: $OUTPUT_FILE"

if [[ -n "$expected_file_sha" ]]; then
  got_file_sha="$(shasum -a 256 "$OUTPUT_FILE" | awk '{print $1}')"
  [[ "$got_file_sha" == "$expected_file_sha" ]] || die "Final dump SHA mismatch (expected=$expected_file_sha got=$got_file_sha)"
  log "Final SHA256 verified."
fi

if [[ "$DO_RESTORE" == "false" ]]; then
  log "Download-only mode. Skip DB restore."
  exit 0
fi

restore_cmd=(bash "$PROJECT_DIR/scripts/restore_db.sh" "$OUTPUT_FILE")
[[ "$RESTORE_CLEAN" == "true" ]] && restore_cmd+=(--clean)
[[ "$RESTORE_NO_CONFIRM" == "true" ]] && restore_cmd+=(--no-confirm)

log "Starting restore via scripts/restore_db.sh"
"${restore_cmd[@]}"
log "Restore complete."
