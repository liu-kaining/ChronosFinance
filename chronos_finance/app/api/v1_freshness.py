"""
Read-side freshness / coverage API.

Consumed by the library UI (spec §9.2) to show "what we have, how fresh,
how complete" without leaking any write/ops concerns. All endpoints read
exclusively from ``sync_datasets`` + ``sync_state``.
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from app.core.database import async_session_factory
from app.models.sync_control import (
    GLOBAL_SYMBOL_SENTINEL,
    SyncDataset,
    SyncState,
)
from app.schemas.freshness import (
    CoverageGlobalEntry,
    CoverageGlobalResponse,
    CoverageSymbolEntry,
    CoverageSymbolResponse,
    FreshnessOverviewResponse,
    FreshnessRow,
    SymbolFreshnessResponse,
)

router = APIRouter(prefix="/api/v1/data/freshness", tags=["freshness"])
coverage_router = APIRouter(prefix="/api/v1/data/coverage", tags=["coverage"])


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _is_stale(row: SyncState, cadence_seconds: int | None) -> bool:
    if row.last_success_at is None:
        return True
    if row.fresh_until is not None:
        return row.fresh_until < _utcnow()
    if cadence_seconds is None:
        return False
    return (_utcnow() - row.last_success_at).total_seconds() > cadence_seconds


@router.get("/overview", response_model=FreshnessOverviewResponse,
            summary="全量 dataset 的新鲜度总览")
async def freshness_overview() -> FreshnessOverviewResponse:
    async with async_session_factory() as session:
        datasets = (
            await session.scalars(
                select(SyncDataset).where(SyncDataset.enabled.is_(True))
            )
        ).all()
        by_key = {d.dataset_key: d for d in datasets}
        states = (await session.scalars(select(SyncState))).all()

    items: list[FreshnessRow] = []
    stale = 0
    for s in states:
        ds = by_key.get(s.dataset_key)
        if ds is None:
            continue
        stale_flag = _is_stale(s, ds.cadence_seconds)
        if stale_flag:
            stale += 1
        items.append(
            FreshnessRow(
                dataset_key=s.dataset_key,
                scope=ds.scope,
                symbol=None if s.symbol == GLOBAL_SYMBOL_SENTINEL else s.symbol,
                status=s.status,
                cursor_date=s.cursor_date,
                cursor_value=s.cursor_value,
                last_success_at=s.last_success_at,
                fresh_until=s.fresh_until,
                is_stale=stale_flag,
                records_written_total=s.records_written_total,
            )
        )
    items.sort(key=lambda r: (r.is_stale, r.dataset_key, r.symbol or ""))
    return FreshnessOverviewResponse(
        generated_at=_utcnow(),
        datasets_registered=len(datasets),
        datasets_tracked=len({s.dataset_key for s in states}),
        datasets_stale=stale,
        items=items,
    )


@router.get("/symbol/{symbol}", response_model=SymbolFreshnessResponse,
            summary="查看某标的的全部 dataset 新鲜度")
async def freshness_for_symbol(symbol: str) -> SymbolFreshnessResponse:
    sym = symbol.upper()
    async with async_session_factory() as session:
        datasets = (
            await session.scalars(
                select(SyncDataset).where(SyncDataset.enabled.is_(True))
            )
        ).all()
        by_key = {d.dataset_key: d for d in datasets}

        stmt = select(SyncState).where(SyncState.symbol == sym)
        states = (await session.scalars(stmt)).all()

    items: list[FreshnessRow] = []
    for s in states:
        ds = by_key.get(s.dataset_key)
        if ds is None or ds.scope != "symbol":
            continue
        items.append(
            FreshnessRow(
                dataset_key=s.dataset_key,
                scope=ds.scope,
                symbol=sym,
                status=s.status,
                cursor_date=s.cursor_date,
                cursor_value=s.cursor_value,
                last_success_at=s.last_success_at,
                fresh_until=s.fresh_until,
                is_stale=_is_stale(s, ds.cadence_seconds),
                records_written_total=s.records_written_total,
            )
        )

    items.sort(key=lambda r: (r.is_stale, r.dataset_key))
    return SymbolFreshnessResponse(
        symbol=sym, generated_at=_utcnow(), items=items
    )


@coverage_router.get("/global", response_model=CoverageGlobalResponse,
                     summary="全局 dataset 覆盖情况")
async def coverage_global() -> CoverageGlobalResponse:
    async with async_session_factory() as session:
        datasets = (
            await session.scalars(
                select(SyncDataset).where(
                    SyncDataset.enabled.is_(True),
                    SyncDataset.scope == "global",
                )
            )
        ).all()
        known_keys = {d.dataset_key for d in datasets}
        stmt = select(SyncState).where(
            SyncState.symbol == GLOBAL_SYMBOL_SENTINEL
        )
        states = {s.dataset_key: s for s in (await session.scalars(stmt)).all()}

    items: list[CoverageGlobalEntry] = []
    for ds in datasets:
        s = states.get(ds.dataset_key)
        items.append(
            CoverageGlobalEntry(
                dataset_key=ds.dataset_key,
                status=s.status if s else "never",
                cursor_date=s.cursor_date if s else None,
                last_success_at=s.last_success_at if s else None,
                records_written_total=s.records_written_total if s else 0,
            )
        )
    # Include orphan states (registry row was removed but state still exists).
    for s in states.values():
        if s.dataset_key not in known_keys:
            items.append(
                CoverageGlobalEntry(
                    dataset_key=s.dataset_key,
                    status=f"orphan:{s.status}",
                    cursor_date=s.cursor_date,
                    last_success_at=s.last_success_at,
                    records_written_total=s.records_written_total,
                )
            )
    items.sort(key=lambda r: r.dataset_key)
    return CoverageGlobalResponse(generated_at=_utcnow(), items=items)


@coverage_router.get("/symbol/{symbol}", response_model=CoverageSymbolResponse,
                     summary="单标的覆盖情况")
async def coverage_symbol(symbol: str) -> CoverageSymbolResponse:
    sym = symbol.upper()
    async with async_session_factory() as session:
        datasets = (
            await session.scalars(
                select(SyncDataset).where(
                    SyncDataset.enabled.is_(True),
                    SyncDataset.scope == "symbol",
                )
            )
        ).all()
        stmt = select(SyncState).where(SyncState.symbol == sym)
        state_map = {
            s.dataset_key: s for s in (await session.scalars(stmt)).all()
        }

    items: list[CoverageSymbolEntry] = []
    for ds in datasets:
        s = state_map.get(ds.dataset_key)
        items.append(
            CoverageSymbolEntry(
                dataset_key=ds.dataset_key,
                status=s.status if s else "never",
                cursor_date=s.cursor_date if s else None,
                last_success_at=s.last_success_at if s else None,
                records_written_total=s.records_written_total if s else 0,
            )
        )
    if not items:
        # Guard against a typo'd symbol — make sure we surface something
        # useful rather than an empty silent response.
        raise HTTPException(status_code=404, detail=f"no symbol datasets found for {sym}")
    items.sort(key=lambda r: r.dataset_key)
    return CoverageSymbolResponse(
        symbol=sym, generated_at=_utcnow(), items=items
    )
