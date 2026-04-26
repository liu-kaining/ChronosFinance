# ChronosFinance

ChronosFinance is a multi-service financial data workstation for market data ingestion, read analytics, and AI-assisted analysis.

## Architecture

Services in this repository:

- `api-read`: read/query API (`/api/v1/data/*`, `/api/v1/library/*`, `/api/v1/stats/*`)
- `api-write`: write/sync API (`/api/v1/sync/*`, `/api/v1/ingest/*`)
- `web`: frontend (React) + reverse proxy (nginx)
- `ai`: AI assistant API (`/api/ai/*`, SSE streaming chat)
- `db`: PostgreSQL

High-level request flow:

- Browser -> `web` (`localhost:3003`)
- `web` routes:
  - `/api/v1/sync/*`, `/api/v1/ingest/*` -> `api-write`
  - other `/api/v1/*` -> `api-read`
  - `/api/ai/*` -> `ai`

## Runtime Ports (Current Default)

- Web: `http://localhost:3003`
- Read API: `http://localhost:8003`
- Write API: `http://localhost:8004`
- AI API: `http://localhost:8100`
- Postgres: `localhost:5435`

## Bring Up The Stack

From repo root:

```bash
docker compose up -d
docker compose ps
```

Expected containers:

- `chronos-db`
- `chronos-api-read`
- `chronos-api-write`
- `chronos-web`
- `chronos-ai`

## First Minute Health Checklist

Run these in order:

```bash
curl -s "http://localhost:8003/health" | python3 -m json.tool
curl -s "http://localhost:8004/health" | python3 -m json.tool
curl -s "http://localhost:8100/health" | python3 -m json.tool
curl -s "http://localhost:3003/api/v1/stats/overview" | python3 -m json.tool
curl -s "http://localhost:3003/api/ai/models" | python3 -m json.tool
```

If all five return normal JSON, your end-to-end path is alive.

## Sync Modes

### 1) Daily Incremental (Recommended For Routine)

Script: `chronos_finance/scripts/daily_incremental_sync.sh`

Characteristics:

- does not truncate tables
- queues incremental datasets only
- fire-and-forget (does not block until all jobs finish)

Run foreground:

```bash
bash chronos_finance/scripts/daily_incremental_sync.sh
```

Run background:

```bash
nohup bash chronos_finance/scripts/daily_incremental_sync.sh >> chronos_finance/daily_incremental.log 2>&1 < /dev/null &
```

### 2) Full Campaign (Backfill / Recovery)

Script: `chronos_finance/scripts/full_sync_campaign.sh`

Background run:

```bash
nohup bash chronos_finance/scripts/full_sync_campaign.sh >> chronos_finance/full_sync_campaign.log 2>&1 < /dev/null &
```

Resume from current state (no full wipe):

```bash
cd chronos_finance
FULL_SYNC_RESTART_API=1 FULL_SYNC_QUEUE_ONLY=1 nohup bash scripts/full_sync_campaign.sh >> full_sync_campaign.log 2>&1 < /dev/null &
```

## How To Judge "Finished"

Use both dimensions:

1. **Queue state**: `running == 0` on ingest runs
2. **Coverage state**: key `*_synced` fields reach `active_symbols`

Check progress:

```bash
curl -s "http://localhost:8003/api/v1/stats/sync-progress" | python3 -m json.tool
```

Check recent queue:

```bash
curl -s "http://localhost:8004/api/v1/ingest/runs?limit=200" | python3 -c "import sys,json;d=json.load(sys.stdin);it=d.get('items',[]);print('running',sum(1 for i in it if i.get('status')=='running'));print('ok',sum(1 for i in it if i.get('status')=='ok'));print('failed',sum(1 for i in it if i.get('status')=='failed'));print('skipped',sum(1 for i in it if i.get('status')=='skipped'))"
```

Practical rule:

- `running=0` + few residual gaps means queue drained but not strict-full.
- For strict-full, manually requeue missing datasets or rerun campaign strategy.

## Manual Requeue Examples

```bash
curl -s -X POST "http://localhost:8004/api/v1/sync/market/prices"
curl -s -X POST "http://localhost:8004/api/v1/sync/events/earnings"
curl -s -X POST "http://localhost:8004/api/v1/sync/alpha/insider"
curl -s -X POST "http://localhost:8004/api/v1/sync/alpha/estimates"
curl -s -X POST "http://localhost:8004/api/v1/sync/segments"
curl -s -X POST "http://localhost:8004/api/v1/sync/alpha/filings"
```

## AI Capability

### Direct AI health and model check

```bash
curl -s "http://localhost:8100/health" | python3 -m json.tool
curl -s "http://localhost:8100/api/ai/models" | python3 -m json.tool
```

### Direct AI chat SSE smoke test

```bash
curl -sS -N --max-time 8 -X POST "http://localhost:8100/api/ai/chat" -H "Content-Type: application/json" -d '{"messages":[{"role":"user","content":"hello"}]}'
```

You should see SSE events like `message_start`, repeated `text_delta`, and `message_end`.

## Frontend + AI Troubleshooting

If frontend looks broken, run these quick checks:

```bash
curl -i -s "http://localhost:3003/api/v1/stats/overview"
curl -i -s "http://localhost:3003/api/ai/models"
```

Interpretation:

- `403` with write-only message on `/api/v1/...` => web proxy is misrouting read traffic to write API
- `502` on `/api/ai/...` but `8100` direct is healthy => web-to-ai proxy issue

Fast fix:

```bash
docker compose up -d --build web
```

## Logs You Actually Need

```bash
docker compose logs --since=10m api-write
docker compose logs --since=10m api-read
docker compose logs --since=10m ai
docker compose logs --since=10m web
docker compose logs -f api-write
```

Script logs:

```bash
tail -f chronos_finance/full_sync_campaign.log
tail -f chronos_finance/daily_incremental.log
```

## Data Safety

Backup and restore scripts:

- `scripts/backup_db.sh`
- `scripts/restore_db.sh`
- `chronos_finance/scripts/backup_db.sh`
- `chronos_finance/scripts/restore_db.sh`

Recommended backup habit:

- backup before schema/script changes
- validate backup file integrity
- keep at least one off-machine copy

## Where To Go Next

- Operations detail: `docs/OPERATIONS_RUNBOOK.md`
- Read API implementation: `chronos_finance/app/api/v1_insight.py`
- Frontend API client: `chronos_web/src/lib/api.ts`