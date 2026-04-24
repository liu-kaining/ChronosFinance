# ChronosFinance Operations Runbook

This runbook collects the day-to-day commands for checking sync progress, logs, service health, and controlling long-running sync jobs.

All commands assume you are at repo root:

```bash
cd /Users/liukaining/Desktop/code/github/ChronosFinance
```

## 1) Service And API Health

Check container status:

```bash
docker compose ps
```

Read API health (`api-read`):

```bash
curl -s "http://localhost:8003/health" | python3 -m json.tool
```

Write API health (`api-write`):

```bash
curl -s "http://localhost:8004/health" | python3 -m json.tool
```

## 2) Core Data Status

Overall sync progress (read side):

```bash
curl -s "http://localhost:8003/api/v1/stats/sync-progress" | python3 -m json.tool
```

Data table overview (read side):

```bash
curl -s "http://localhost:8003/api/v1/stats/overview" | python3 -m json.tool
```

Ingest run queue/details (write side):

```bash
curl -s "http://localhost:8004/api/v1/ingest/runs?limit=20" | python3 -m json.tool
```

Quick summary of recent run statuses:

```bash
curl -s "http://localhost:8004/api/v1/ingest/runs?limit=50" | python3 -c "import sys,json;d=json.load(sys.stdin);items=d.get('items',[]);print('running',sum(1 for i in items if i.get('status')=='running'));print('ok',sum(1 for i in items if i.get('status')=='ok'));print('failed',sum(1 for i in items if i.get('status')=='failed'));print('skipped',sum(1 for i in items if i.get('status')=='skipped'))"
```

## 3) Logs

Write API recent logs:

```bash
docker compose logs --since=10m api-write
```

Stream write API logs:

```bash
docker compose logs -f api-write
```

DB recent logs:

```bash
docker compose logs --since=10m db
```

Campaign script log (if using full campaign):

```bash
tail -f chronos_finance/full_sync_campaign.log
```

Daily incremental script log (if run with nohup):

```bash
tail -f chronos_finance/daily_incremental.log
```

## 4) Start/Stop Full Sync Campaign

Run full campaign in background:

```bash
nohup bash chronos_finance/scripts/full_sync_campaign.sh >> chronos_finance/full_sync_campaign.log 2>&1 < /dev/null &
```

Check whether campaign script process exists:

```bash
pgrep -fl "full_sync_campaign.sh"
```

Stop campaign script only:

```bash
pkill -f "chronos_finance/scripts/full_sync_campaign.sh"
```

Hard-stop in-flight write-side background tasks (via write API restart):

```bash
docker compose restart api-write
```

Resume full campaign safely from current state (no full wipe):

```bash
cd chronos_finance
FULL_SYNC_RESTART_API=1 FULL_SYNC_QUEUE_ONLY=1 nohup bash scripts/full_sync_campaign.sh >> full_sync_campaign.log 2>&1 < /dev/null &
```

## 5) Trigger Specific Sync Jobs Manually

Requeue market cap:

```bash
curl -s -X POST "http://localhost:8004/api/v1/sync/market/market-cap"
```

Requeue DCF:

```bash
curl -s -X POST "http://localhost:8004/api/v1/sync/financials/dcf"
```

Requeue universe:

```bash
curl -s -X POST "http://localhost:8004/api/v1/sync/universe"
```

## 6) Run Daily Incremental Sync

Foreground:

```bash
bash chronos_finance/scripts/daily_incremental_sync.sh
```

Background:

```bash
nohup bash chronos_finance/scripts/daily_incremental_sync.sh >> chronos_finance/daily_incremental.log 2>&1 < /dev/null &
```

## 7) Data Quality Audit

Run audit inside container (recommended):

```bash
docker compose exec -T api-write python /opt/chronos/scripts/audit_data_quality.py
```

## 8) Practical Notes

- Read endpoints go to `8003`; write/sync endpoints go to `8004`.
- If progress appears stuck but script is still running, check:
  1) `docker compose logs -f api-write`
  2) `curl .../ingest/runs?limit=50`
  3) `curl .../stats/sync-progress`
- After code changes in `chronos_finance`, restart write service:

```bash
docker compose up -d --build api-write
```
