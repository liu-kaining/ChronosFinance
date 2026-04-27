#!/usr/bin/env bash
#
# ChronosFinance DB backup -> Cloudflare R2 (single fixed object key)
#
# Behavior:
# 1) Create/refresh local dump with a fixed file name.
# 2) Compute SHA256 of local dump.
# 3) Compare with remote object's metadata.sha256.
# 4) If unchanged: do NOT upload.
# 5) If changed or missing remote object: upload and overwrite fixed key.
#
# Usage:
#   bash scripts/backup_to_r2_latest.sh
#   R2_OBJECT_KEY="db/chronos_finance_latest.dump" bash scripts/backup_to_r2_latest.sh
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
BACKUP_NAME="${BACKUP_NAME:-chronos_finance_latest}"
BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/backups}"
LOCAL_FILE="$BACKUP_DIR/${BACKUP_NAME}.dump"
R2_CONNECT_TIMEOUT="${R2_CONNECT_TIMEOUT:-30}"
R2_READ_TIMEOUT="${R2_READ_TIMEOUT:-600}"
R2_MAX_ATTEMPTS="${R2_MAX_ATTEMPTS:-10}"
R2_MULTIPART_CHUNK_MB="${R2_MULTIPART_CHUNK_MB:-64}"
R2_MAX_CONCURRENCY="${R2_MAX_CONCURRENCY:-2}"
R2_SPLIT_CHUNK_MB="${R2_SPLIT_CHUNK_MB:-128}"

log() { printf "\033[1;36m[backup-r2]\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m[backup-r2]\033[0m %s\n" "$*"; }
die() { printf "\033[1;31m[backup-r2]\033[0m %s\n" "$*" >&2; exit 1; }

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

r2_head_sha() {
  local object_key="$1"
  if [[ "$use_aws_cli" == "true" ]]; then
    aws s3api head-object \
      --endpoint-url "$R2_ENDPOINT_URL" \
      --bucket "$R2_BUCKET_NAME" \
      --key "$object_key" \
      --query 'Metadata.sha256' \
      --output text 2>/dev/null || true
  else
    docker compose exec -T \
      -e R2_ENDPOINT_URL="$R2_ENDPOINT_URL" \
      -e R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
      -e R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
      -e R2_BUCKET_NAME="$R2_BUCKET_NAME" \
      -e R2_REGION="$R2_REGION" \
      -e HEAD_OBJECT_KEY="$object_key" \
      -e R2_CONNECT_TIMEOUT="$R2_CONNECT_TIMEOUT" \
      -e R2_READ_TIMEOUT="$R2_READ_TIMEOUT" \
      -e R2_MAX_ATTEMPTS="$R2_MAX_ATTEMPTS" \
      api-write python - <<'PY' 2>/dev/null || true
import os
import boto3
from botocore.exceptions import ClientError
from botocore.config import Config

s3 = boto3.client(
    "s3",
    endpoint_url=os.environ["R2_ENDPOINT_URL"],
    aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
    aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
    region_name=os.environ.get("R2_REGION", "auto"),
    config=Config(
        connect_timeout=int(os.environ.get("R2_CONNECT_TIMEOUT", "30")),
        read_timeout=int(os.environ.get("R2_READ_TIMEOUT", "600")),
        retries={"max_attempts": int(os.environ.get("R2_MAX_ATTEMPTS", "10")), "mode": "standard"},
    ),
)

try:
    resp = s3.head_object(Bucket=os.environ["R2_BUCKET_NAME"], Key=os.environ["HEAD_OBJECT_KEY"])
    print((resp.get("Metadata") or {}).get("sha256", ""))
except ClientError:
    print("")
PY
  fi
}

r2_upload_file() {
  local file_path="$1"
  local object_key="$2"
  local metadata_csv="${3:-}"
  if [[ "$use_aws_cli" == "true" ]]; then
    aws s3 cp "$file_path" "s3://$R2_BUCKET_NAME/$object_key" \
      --endpoint-url "$R2_ENDPOINT_URL" \
      ${metadata_csv:+--metadata "$metadata_csv"}
  else
    local container_file="/tmp/chronos_backup_$(date +%s%N).bin"
    docker cp "$file_path" chronos-api-write:"$container_file"
    docker compose exec -T \
      -e R2_ENDPOINT_URL="$R2_ENDPOINT_URL" \
      -e R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
      -e R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
      -e R2_BUCKET_NAME="$R2_BUCKET_NAME" \
      -e R2_REGION="$R2_REGION" \
      -e TARGET_OBJECT_KEY="$object_key" \
      -e METADATA_SHA="$LOCAL_SHA" \
      -e METADATA_SOURCE="chronosfinance" \
      -e METADATA_EXTRA="$metadata_csv" \
      -e CONTAINER_FILE="$container_file" \
      -e R2_CONNECT_TIMEOUT="$R2_CONNECT_TIMEOUT" \
      -e R2_READ_TIMEOUT="$R2_READ_TIMEOUT" \
      -e R2_MAX_ATTEMPTS="$R2_MAX_ATTEMPTS" \
      -e R2_MULTIPART_CHUNK_MB="$R2_MULTIPART_CHUNK_MB" \
      -e R2_MAX_CONCURRENCY="$R2_MAX_CONCURRENCY" \
      api-write python - <<'PY'
import os
import boto3
from botocore.config import Config
from boto3.s3.transfer import TransferConfig

s3 = boto3.client(
    "s3",
    endpoint_url=os.environ["R2_ENDPOINT_URL"],
    aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
    aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
    region_name=os.environ.get("R2_REGION", "auto"),
    config=Config(
        connect_timeout=int(os.environ.get("R2_CONNECT_TIMEOUT", "30")),
        read_timeout=int(os.environ.get("R2_READ_TIMEOUT", "600")),
        retries={"max_attempts": int(os.environ.get("R2_MAX_ATTEMPTS", "10")), "mode": "standard"},
    ),
)

chunk_mb = int(os.environ.get("R2_MULTIPART_CHUNK_MB", "64"))
transfer_cfg = TransferConfig(
    multipart_threshold=8 * 1024 * 1024,
    multipart_chunksize=chunk_mb * 1024 * 1024,
    max_concurrency=int(os.environ.get("R2_MAX_CONCURRENCY", "2")),
    use_threads=True,
)

s3.upload_file(
    os.environ["CONTAINER_FILE"],
    os.environ["R2_BUCKET_NAME"],
    os.environ["TARGET_OBJECT_KEY"],
    Config=transfer_cfg,
    ExtraArgs={
        "Metadata": {
            "sha256": os.environ.get("METADATA_SHA", ""),
            "source": os.environ.get("METADATA_SOURCE", "chronosfinance"),
        }
    },
)
print("ok")
PY
    docker compose exec -T api-write rm -f "$container_file" >/dev/null 2>&1 || true
  fi
}

mkdir -p "$BACKUP_DIR"

log "Creating local backup: $LOCAL_FILE"
BACKUP_NAME="$BACKUP_NAME" BACKUP_DIR="$BACKUP_DIR" bash "$PROJECT_DIR/scripts/backup_db.sh"
[[ -f "$LOCAL_FILE" ]] || die "Expected local backup not found: $LOCAL_FILE"

LOCAL_SHA="$(shasum -a 256 "$LOCAL_FILE" | awk '{print $1}')"
[[ -n "$LOCAL_SHA" ]] || die "Failed to compute local SHA256"
log "Local SHA256: $LOCAL_SHA"

REMOTE_SHA="$(r2_head_sha "$R2_MANIFEST_KEY")"

if [[ "$REMOTE_SHA" == "None" ]]; then
  REMOTE_SHA=""
fi

if [[ -n "$REMOTE_SHA" ]]; then
  log "Remote SHA256: $REMOTE_SHA"
else
  warn "Remote manifest missing or no sha256 metadata. Will upload."
fi

if [[ -n "$REMOTE_SHA" && "$REMOTE_SHA" == "$LOCAL_SHA" ]]; then
  log "No data change detected. Skip R2 upload."
  exit 0
fi

tmp_split_dir="$(mktemp -d)"
cleanup() { rm -rf "$tmp_split_dir"; }
trap cleanup EXIT

log "Splitting dump into ${R2_SPLIT_CHUNK_MB}MB parts..."
split -b "${R2_SPLIT_CHUNK_MB}m" -d -a 4 "$LOCAL_FILE" "$tmp_split_dir/part-"
part_files=()
while IFS= read -r file; do
  [[ -n "$file" ]] && part_files+=("$file")
done < <(ls -1 "$tmp_split_dir"/part-* 2>/dev/null | sort)
(( ${#part_files[@]} > 0 )) || die "No part files generated."

part_count="${#part_files[@]}"
file_size_bytes="$(stat -f%z "$LOCAL_FILE" 2>/dev/null || stat -c%s "$LOCAL_FILE" 2>/dev/null)"
log "Uploading ${part_count} parts to r2://$R2_BUCKET_NAME/${R2_OBJECT_KEY}.part-XXXX"

manifest_tmp="$tmp_split_dir/manifest.json"
{
  printf '{\n'
  printf '  "type": "chronos_backup_manifest",\n'
  printf '  "object_key": "%s",\n' "$R2_OBJECT_KEY"
  printf '  "file_sha256": "%s",\n' "$LOCAL_SHA"
  printf '  "file_size_bytes": %s,\n' "$file_size_bytes"
  printf '  "part_size_mb": %s,\n' "$R2_SPLIT_CHUNK_MB"
  printf '  "part_count": %s,\n' "$part_count"
  printf '  "generated_at": "%s",\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '  "parts": [\n'
} > "$manifest_tmp"

for i in "${!part_files[@]}"; do
  file="${part_files[$i]}"
  idx="$(printf '%04d' "$i")"
  key="${R2_OBJECT_KEY}.part-${idx}"
  part_sha="$(shasum -a 256 "$file" | awk '{print $1}')"
  part_size="$(stat -f%z "$file" 2>/dev/null || stat -c%s "$file" 2>/dev/null)"
  log "Uploading part ${idx} (${part_size} bytes)"
  r2_upload_file "$file" "$key" "sha256=$part_sha,source=chronosfinance,parent_sha256=$LOCAL_SHA,part_index=$idx"
  sep=","
  if [[ "$i" -eq $((part_count - 1)) ]]; then
    sep=""
  fi
  printf '    {"index":"%s","key":"%s","size_bytes":%s,"sha256":"%s"}%s\n' "$idx" "$key" "$part_size" "$part_sha" "$sep" >> "$manifest_tmp"
done

{
  printf '  ]\n'
  printf '}\n'
} >> "$manifest_tmp"

log "Uploading manifest to r2://$R2_BUCKET_NAME/$R2_MANIFEST_KEY"
r2_upload_file "$manifest_tmp" "$R2_MANIFEST_KEY" "sha256=$LOCAL_SHA,source=chronosfinance,part_count=$part_count,parent_key=$R2_OBJECT_KEY"

log "Upload complete (chunked)."
