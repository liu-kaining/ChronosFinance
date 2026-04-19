# ChronosFinance Data Re-Architecture Plan

## 1. Purpose

This document is the single execution baseline for the next-stage data platform rebuild.
All future schema, ingestion, API, and library-data transparency changes should follow this plan unless explicitly revised.

Primary goals:

1. Maximize usable FMP data coverage without wasting subscription capacity.
2. Support reliable incremental sync (default every 3 hours) with clear freshness tracking.
3. Separate write/maintenance APIs from read/consumption APIs.
4. Guarantee full global datasets and long-span symbol datasets.
5. Provide transparent data coverage visibility ("what we have, how fresh, how complete").

---

## 2. Confirmed Operating Constraints

From current FMP account and docs:

- Plan tier: `Premium Annual`
- Request limit: `750 calls / minute`
- Bandwidth limit: `50 GB / rolling 30 days`

Implication: scheduling must optimize both QPS and bandwidth, not only calls/min.

---

## 3. Scope and Non-Goals

### In Scope

- Rebuild schema for long-term maintainability and incremental updates.
- Introduce dataset-driven orchestrated ingestion.
- Add `sync_state`-based freshness/completeness framework.
- Define tiered sync cadence and quota allocation.
- Split write APIs and read APIs.
- Keep library/read pages focused on transparent data inspection.

### Out of Scope (for this phase)

- Real-time streaming architecture.
- Vendor abstraction for non-FMP providers.
- Advanced analytics model training pipeline.

---

## 4. Core Decisions (Finalized)

1. **Core symbol pool = 1857 symbols** (full current universe), not 300.
2. **Default incremental cycle = every 3 hours** for core datasets.
3. **Write/read API separation**:
   - Write: `/api/v1/ingest/*`
   - Read: `/api/v1/data/*` and `/api/v1/library/*`
4. **Freshness state authority**: `sync_state` table (not per-table ad hoc flags).
5. Existing `*_synced` flags only represent initial backfill completion semantics.
6. Heavy payload datasets (large text/high frequency) use separate quotas and lower cadence.

---

## 5. Target Architecture

## 5.1 Layers

1. **Source layer**: FMP Stable endpoints.
2. **Ingestion layer**: dataset workers (`fetch -> normalize -> upsert -> update sync_state`).
3. **Storage layer**: normalized fact tables + global tables + sync control tables.
4. **Read API layer**: lightweight, indexed, and freshness-aware query endpoints.
5. **Presentation layer**: library/dashboard pages using read-only data APIs.

## 5.2 Dataset as Scheduling Unit

Each dataset is independently schedulable and stateful:

- Example dataset keys:
  - `symbol.daily_prices`
  - `symbol.financial.income_statement`
  - `global.earnings_calendar`
  - `global.macro_series.CPIAUCSL`

Each dataset has explicit:

- cadence,
- incremental cursor strategy,
- retry/backoff policy,
- quota class (`light`, `medium`, `heavy`),
- freshness SLA target.

---

## 6. Data Model Blueprint

## 6.1 Core Reference

- `stock_universe`
- `company_profile_history`
- `symbol_aliases` (if needed for symbol change continuity)

## 6.2 Symbol Fact Tables (time-span required)

- `daily_prices`
- `intraday_prices` (selected cadence/scope)
- `quotes_latest`
- `historical_market_cap`
- `shares_float`
- `statement_income`
- `statement_balance`
- `statement_cashflow`
- `metrics_kv` (key metrics/ratios/scores/EV unified by typed metric key)
- `analyst_price_targets`
- `analyst_ratings_history`
- `institutional_holders`
- `sec_filings_index`
- `company_press_releases`
- `upgrades_downgrades`
- `stock_news`
- `executive_compensation`
- `revenue_segmentation`

## 6.3 Global Fact Tables (must be complete)

- `earnings_calendar`
- `dividend_calendar_global`
- `split_calendar_global`
- `ipo_calendar`
- `economic_calendar`
- `macro_series_catalog`
- `macro_economics`
- `treasury_rates_wide`

## 6.4 Sync Control Tables (mandatory)

- `sync_datasets`
- `sync_state`
- `sync_runs`

`sync_state` minimum fields:

- `dataset_key`
- `symbol` (nullable for global)
- `cursor_date` / `cursor_value`
- `last_success_at`
- `last_attempt_at`
- `fresh_until`
- `records_written`
- `bytes_estimated`
- `content_hash_last`
- `status`
- `error_message` (nullable)

---

## 7. Incremental Strategy by Dataset Type

1. **Date-series datasets**: use max date cursor (`cursor_date`) with overlap window for safety.
2. **Fiscal-period datasets**: use `(fiscal_year, fiscal_period)` cursor.
3. **Snapshot datasets**: upsert latest snapshot by natural key + `as_of` timestamp.
4. **Event feed datasets**: fetch rolling lookback window and deduplicate by natural unique key.
5. **Text-heavy datasets**: event-driven pull + daily reconciliation scan.
6. **Idempotence**:
   - `INSERT ... ON CONFLICT DO UPDATE`
   - update only when `content_hash` changed to reduce write load.

---

## 8. Cadence and Quota Policy

## 8.1 Symbol Segmentation

- `P0` = all `1857` symbols (core)
- `P1` = active subset within P0 (configurable, e.g. 300-600)
- `P2` = heavy dataset target subset (configurable)

## 8.2 Default Cadence

- **Every 3 hours**: P0 core incremental datasets.
- **Hourly to 3-hour**: P1 selected medium/heavier datasets.
- **Daily/weekly**: P2 heavy payload and low-volatility datasets.
- **Daily reconciliation run**: gap fill, late-arrival recovery, and consistency checks.

## 8.3 Quota Allocation

Two-level control:

1. Global limiter (`<=750 calls/min` with headroom).
2. Rolling bandwidth budget guard (`<=50GB/30d` with warning thresholds).

Recommended policy:

- Reserve fixed capacity for global must-have datasets.
- Allocate symbol datasets by priority class.
- Throttle heavy datasets first when nearing bandwidth budget.

---

## 9. API Design

## 9.1 Ingestion/Maintenance APIs (Write Side)

- `POST /api/v1/ingest/run`
- `POST /api/v1/ingest/datasets/{dataset_key}/run`
- `POST /api/v1/ingest/symbols/{symbol}/run`
- `GET /api/v1/ingest/runs/{run_id}`
- `GET /api/v1/ingest/state` (ops-focused view)

Write side is for cron/ops/internal control only.

## 9.2 Read/Consumption APIs (Read Side)

- Existing data/library endpoints continue.
- Add/maintain freshness visibility endpoints:
  - `GET /api/v1/data/freshness/overview`
  - `GET /api/v1/data/freshness/symbol/{symbol}`
  - `GET /api/v1/data/coverage/symbol/{symbol}`
  - `GET /api/v1/data/coverage/global`

Read responses should include a `meta.freshness` block where applicable.

---

## 10. Execution Plan

## Phase M0: Alignment and Freeze

- Freeze final architecture decisions (this document).
- Define dataset registry v1.
- Define DDL migration package list.

## Phase M1: Control Plane Foundations

- Create `sync_datasets`, `sync_state`, `sync_runs`.
- Implement shared orchestration utilities:
  - rate limiter,
  - retry/backoff,
  - cursor helpers,
  - run logging.

## Phase M2: Global Dataset Migration

- Migrate global calendars and macro/treasury pipelines.
- Add freshness and coverage read APIs for globals.

## Phase M3: Symbol Core Dataset Migration

- Migrate P0 symbol datasets to new schema and sync state.
- Keep full span backfill then incremental.

## Phase M4: Heavy Dataset Layer

- Add heavy datasets with quota-aware scheduling.
- Implement payload budgeting and graceful throttling.

## Phase M5: Read API Consolidation + Library Transparency

- Finish data atlas/freshness endpoints.
- Ensure UI surfaces completeness and freshness clearly.

## Phase M6: Cutover and Legacy Decommission

- Switch cron to new ingest APIs only.
- Disable legacy sync paths after parity checks.
- Keep rollback scripts for one release cycle.

---

## 11. Acceptance Criteria

1. All 1857 symbols included in core incremental cycle.
2. Global datasets have explicit freshness states and coverage metrics.
3. Symbol datasets expose clear time span and freshness metadata.
4. Ingestion and read APIs are fully separated by responsibility.
5. Pipeline runs are idempotent and resumable.
6. QPS and bandwidth usage stay within plan limits with alerting.

---

## 12. Observability and Alerts

Track and alert on:

- sync success rate by dataset,
- stale dataset count (freshness SLA breach),
- per-run bytes and rolling 30-day bytes estimate,
- write amplification (rows attempted vs rows changed),
- frequent failure signatures per endpoint.

---

## 13. Change Governance

Any change to cadence, schema keys, dataset registry, or API contracts must update this file first, then code.

Suggested workflow:

1. Update this plan.
2. Create implementation TODO checklist from changed sections.
3. Execute code changes in small milestones.
4. Run validation and update status notes.

---

## 14. Immediate Next Implementation Deliverables

1. DDL v1 for `sync_*` tables and first batch of refactored fact tables.
2. Dataset registry seed file (dataset key, cadence, cursor strategy, quota class).
3. Ingestion orchestrator skeleton and one end-to-end migrated dataset pair:
   - one global dataset,
   - one symbol dataset.
4. Freshness/coverage read endpoint v1.

