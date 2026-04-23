"""
Write-side ingestion API (``/api/v1/ingest/*``).

Responsibilities:

* trigger dataset runs (manual / cron / ops),
* expose the registered dataset catalog,
* expose ``sync_state`` and ``sync_runs`` for ops visibility.

This router is intentionally separate from the read-side ``/api/v1/data``
and ``/api/v1/library`` routers per the re-architecture spec §9.
"""

from __future__ import annotations

import logging
from typing import Awaitable, Callable

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from sqlalchemy import desc, select

from app.core.database import async_session_factory
from app.core.config import get_settings
from app.models.sync_control import (
    GLOBAL_SYMBOL_SENTINEL,
    SyncDataset,
    SyncRun,
    SyncState,
)
from app.schemas.ingest import (
    DatasetListResponse,
    DatasetSummary,
    BandwidthBudgetResponse,
    IngestTriggerResponse,
    SyncRunListResponse,
    SyncRunRow,
    SyncStateListResponse,
    SyncStateRow,
)
from app.services.sync.budget import get_bandwidth_usage
from app.services.sync.orchestrator import run_dataset
from app.services.sync.registry import DATASET_REGISTRY, get_dataset_spec

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/ingest", tags=["ingest"])
settings = get_settings()


async def _run_background(
    name: str, coro_factory: Callable[[], Awaitable[dict]]
) -> None:
    try:
        result = await coro_factory()
        logger.info("ingest job %s finished: %s", name, result)
    except Exception:
        logger.exception("ingest job %s failed", name)


async def _dataset_enabled(dataset_key: str) -> bool:
    """DB-first enabled check; fallback to registry when DB is empty."""
    async with async_session_factory() as session:
        row = await session.get(SyncDataset, dataset_key)
        if row is not None:
            return bool(row.enabled)
    # fallback when sync_datasets not seeded yet
    return get_dataset_spec(dataset_key) is not None


async def _enabled_symbol_dataset_keys() -> list[str]:
    async with async_session_factory() as session:
        rows = (
            await session.scalars(
                select(SyncDataset.dataset_key).where(
                    SyncDataset.enabled.is_(True),
                    SyncDataset.scope == "symbol",
                ).order_by(SyncDataset.priority_tier, SyncDataset.dataset_key)
            )
        ).all()
    if rows:
        return list(rows)
    return [spec.key for spec in DATASET_REGISTRY if spec.scope == "symbol"]


@router.get("/datasets", response_model=DatasetListResponse,
            summary="列出已注册的 dataset")
async def list_datasets() -> DatasetListResponse:
    async with async_session_factory() as session:
        rows = (
            await session.scalars(
                select(SyncDataset).order_by(
                    SyncDataset.priority_tier, SyncDataset.dataset_key
                )
            )
        ).all()
        # Fall back to the in-memory registry when the DB is empty (first boot
        # before seed_registry() has run).
        if not rows:
            items = [
                DatasetSummary(
                    dataset_key=s.key,
                    scope=s.scope,
                    description=s.description,
                    cadence_seconds=s.cadence_seconds,
                    cursor_strategy=s.cursor_strategy,
                    quota_class=s.quota_class,
                    priority_tier=s.priority_tier,
                    enabled=True,
                )
                for s in DATASET_REGISTRY
            ]
        else:
            items = [
                DatasetSummary(
                    dataset_key=r.dataset_key,
                    scope=r.scope,
                    description=r.description,
                    cadence_seconds=r.cadence_seconds,
                    cursor_strategy=r.cursor_strategy,
                    quota_class=r.quota_class,
                    priority_tier=r.priority_tier,
                    enabled=r.enabled,
                )
                for r in rows
            ]
    return DatasetListResponse(datasets=items)


@router.get("/budget", response_model=BandwidthBudgetResponse,
            summary="查看 30 天滚动带宽预算使用")
async def get_budget_usage() -> BandwidthBudgetResponse:
    usage = await get_bandwidth_usage()
    return BandwidthBudgetResponse(
        window_days=usage.window_days,
        bytes_used=usage.bytes_used,
        bytes_limit=usage.bytes_limit,
        usage_ratio=usage.ratio,
        heavy_throttle_ratio=settings.FMP_BANDWIDTH_HEAVY_THROTTLE_RATIO,
        medium_throttle_ratio=settings.FMP_BANDWIDTH_MEDIUM_THROTTLE_RATIO,
    )


@router.post(
    "/datasets/{dataset_key}/run",
    response_model=IngestTriggerResponse,
    summary="触发某个 dataset 的一次运行",
)
async def trigger_dataset_run(
    dataset_key: str,
    bg: BackgroundTasks,
    symbol: str | None = Query(None, description="可选：只跑某个标的"),
    symbols: list[str] | None = Query(None, description="可选：指定一组标的"),
    trigger: str = Query("manual"),
) -> IngestTriggerResponse:
    spec = get_dataset_spec(dataset_key)
    if spec is None:
        raise HTTPException(status_code=404, detail=f"unknown dataset_key: {dataset_key}")
    if not await _dataset_enabled(dataset_key):
        raise HTTPException(status_code=409, detail=f"dataset {dataset_key} is disabled")

    target_symbol = symbol.upper() if symbol else None
    target_symbols = [s.upper() for s in symbols] if symbols else None

    bg.add_task(
        _run_background,
        f"ingest::{dataset_key}",
        lambda dk=dataset_key, s=target_symbol, ss=target_symbols, t=trigger: run_dataset(
            dk,
            symbol=s,
            symbols=ss,
            trigger=t,
        ),
    )

    queued = None
    if spec.scope == "symbol":
        queued = 1 if target_symbol else (len(target_symbols) if target_symbols else None)

    return IngestTriggerResponse(
        status="accepted",
        dataset_key=dataset_key,
        message=f"dataset {dataset_key} queued ({spec.scope}).",
        symbols_queued=queued,
    )


@router.post(
    "/symbols/{symbol}/run",
    response_model=list[IngestTriggerResponse],
    summary="触发该标的所有 symbol-scope dataset 的一次运行",
)
async def trigger_symbol_run(
    symbol: str,
    bg: BackgroundTasks,
    trigger: str = Query("manual"),
) -> list[IngestTriggerResponse]:
    normalised = symbol.upper()
    responses: list[IngestTriggerResponse] = []
    enabled_keys = set(await _enabled_symbol_dataset_keys())
    for spec in DATASET_REGISTRY:
        if spec.scope != "symbol" or spec.key not in enabled_keys:
            continue
        bg.add_task(
            _run_background,
            f"ingest::{spec.key}::{normalised}",
            lambda k=spec.key: run_dataset(
                k, symbol=normalised, trigger=trigger
            ),
        )
        responses.append(
            IngestTriggerResponse(
                status="accepted",
                dataset_key=spec.key,
                message=f"dataset {spec.key} queued for {normalised}.",
                symbols_queued=1,
            )
        )
    if not responses:
        raise HTTPException(
            status_code=404,
            detail="no symbol-scope datasets are registered",
        )
    return responses


@router.get("/state", response_model=SyncStateListResponse,
            summary="查看 sync_state")
async def list_sync_state(
    dataset_key: str | None = Query(None),
    symbol: str | None = Query(None),
    status: str | None = Query(None),
    limit: int = Query(200, ge=1, le=5000),
) -> SyncStateListResponse:
    async with async_session_factory() as session:
        stmt = select(SyncState)
        if dataset_key:
            stmt = stmt.where(SyncState.dataset_key == dataset_key)
        if symbol:
            stmt = stmt.where(SyncState.symbol == symbol.upper())
        if status:
            stmt = stmt.where(SyncState.status == status)
        stmt = stmt.order_by(
            SyncState.dataset_key, SyncState.symbol
        ).limit(limit)
        rows = (await session.scalars(stmt)).all()

    items = [
        SyncStateRow(
            dataset_key=r.dataset_key,
            symbol=None if r.symbol == GLOBAL_SYMBOL_SENTINEL else r.symbol,
            status=r.status,
            cursor_date=r.cursor_date,
            cursor_value=r.cursor_value,
            last_attempt_at=r.last_attempt_at,
            last_success_at=r.last_success_at,
            fresh_until=r.fresh_until,
            records_written_total=r.records_written_total,
            bytes_estimated_total=r.bytes_estimated_total,
            requests_count_total=r.requests_count_total,
            content_hash_last=r.content_hash_last,
            error_message=r.error_message,
        )
        for r in rows
    ]
    return SyncStateListResponse(total=len(items), items=items)


@router.get("/runs", response_model=SyncRunListResponse,
            summary="查看最近的 sync_runs")
async def list_sync_runs(
    dataset_key: str | None = Query(None),
    symbol: str | None = Query(None),
    status: str | None = Query(None),
    limit: int = Query(100, ge=1, le=1000),
) -> SyncRunListResponse:
    async with async_session_factory() as session:
        stmt = select(SyncRun)
        if dataset_key:
            stmt = stmt.where(SyncRun.dataset_key == dataset_key)
        if symbol:
            stmt = stmt.where(SyncRun.symbol == symbol.upper())
        if status:
            stmt = stmt.where(SyncRun.status == status)
        stmt = stmt.order_by(desc(SyncRun.started_at)).limit(limit)
        rows = (await session.scalars(stmt)).all()

    items = [
        SyncRunRow(
            id=r.id,
            dataset_key=r.dataset_key,
            symbol=None if r.symbol == GLOBAL_SYMBOL_SENTINEL else r.symbol,
            trigger=r.trigger,
            status=r.status,
            started_at=r.started_at,
            finished_at=r.finished_at,
            records_written=r.records_written,
            bytes_estimated=r.bytes_estimated,
            requests_count=r.requests_count,
            cursor_before=r.cursor_before,
            cursor_after=r.cursor_after,
            content_hash=r.content_hash,
            error_message=r.error_message,
            details=r.details or {},
        )
        for r in rows
    ]
    return SyncRunListResponse(total=len(items), items=items)


@router.get("/runs/{run_id}", response_model=SyncRunRow,
            summary="查看单次 run 详情")
async def get_sync_run(run_id: int) -> SyncRunRow:
    async with async_session_factory() as session:
        row = await session.get(SyncRun, run_id)
        if row is None:
            raise HTTPException(status_code=404, detail=f"run_id {run_id} not found")
    return SyncRunRow(
        id=row.id,
        dataset_key=row.dataset_key,
        symbol=None if row.symbol == GLOBAL_SYMBOL_SENTINEL else row.symbol,
        trigger=row.trigger,
        status=row.status,
        started_at=row.started_at,
        finished_at=row.finished_at,
        records_written=row.records_written,
        bytes_estimated=row.bytes_estimated,
        requests_count=row.requests_count,
        cursor_before=row.cursor_before,
        cursor_after=row.cursor_after,
        content_hash=row.content_hash,
        error_message=row.error_message,
        details=row.details or {},
    )
