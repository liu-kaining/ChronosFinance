"""
Ingestion orchestrator.

The orchestrator is intentionally thin:

1. resolve dataset spec from the registry,
2. for each target (global -> one run; symbol -> N runs),
   open a ``SyncRun`` row, invoke the handler, then update
   ``sync_state`` + the ``SyncRun`` row based on the returned
   :class:`DatasetResult`.

Dataset handlers are pure in the sense that they never touch
``sync_state`` / ``sync_runs`` directly — they just return a
:class:`DatasetResult`. That keeps every dataset uniform and makes
unit-testing straightforward.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.core.database import async_session_factory
from app.models.sync_control import GLOBAL_SYMBOL_SENTINEL, SyncRun, SyncState
from app.models.stock_universe import StockUniverse
from app.services.sync.budget import BudgetDecision, should_throttle
from app.services.sync.registry import DatasetSpec, get_dataset_spec

logger = logging.getLogger(__name__)

# Maximum number of symbols processed concurrently within a single dataset
# run. Keep this conservative to avoid saturating the shared HTTP connection
# pool under heavy full-market campaigns.
_SYMBOL_CONCURRENCY = 4


# ─────────────────────────── public types ───────────────────────────


@dataclass
class DatasetContext:
    """Everything a handler needs to run a single invocation."""

    spec: DatasetSpec
    symbol: str  # "" for global datasets
    previous_state: SyncState | None
    trigger: str = "manual"

    @property
    def is_global(self) -> bool:
        return self.spec.scope == "global"

    @property
    def previous_cursor_date(self) -> date | None:
        return self.previous_state.cursor_date if self.previous_state else None

    @property
    def previous_cursor_value(self) -> str | None:
        return self.previous_state.cursor_value if self.previous_state else None


@dataclass
class DatasetResult:
    """What a handler reports back to the orchestrator."""

    records_written: int = 0
    bytes_estimated: int = 0
    requests_count: int = 0
    cursor_date: date | None = None
    cursor_value: str | None = None
    content_hash: str | None = None
    skipped_reason: str | None = None
    details: dict[str, Any] = field(default_factory=dict)


# ─────────────────────────── orchestrator ───────────────────────────


async def run_dataset(
    dataset_key: str,
    *,
    symbol: str | None = None,
    trigger: str = "manual",
    symbols: list[str] | None = None,
) -> dict[str, Any]:
    """
    Execute a dataset.

    * For ``scope='global'`` datasets the ``symbol`` / ``symbols`` args are
      ignored — the handler runs once with ``symbol=""``.
    * For ``scope='symbol'`` datasets the orchestrator iterates the requested
      symbols (or the full active universe if none were given) and runs the
      handler once per symbol.
    """
    spec = get_dataset_spec(dataset_key)
    if spec is None:
        raise ValueError(f"unknown dataset_key: {dataset_key!r}")

    started_at = _utcnow()
    budget_decision = await should_throttle(spec.quota_class)

    if spec.scope == "global":
        result = await _run_single(
            spec,
            GLOBAL_SYMBOL_SENTINEL,
            trigger,
            budget_decision=budget_decision,
        )
        summary = _summarise([result])
    else:
        if (
            budget_decision.throttled
            and symbol is None
            and not symbols
        ):
            # Dataset-level short-circuit to avoid writing thousands of
            # throttled run rows when the budget is already exhausted.
            summary = {
                "runs": 0,
                "ok": 0,
                "failed": 0,
                "skipped": 0,
                "throttled": 1,
                "records_written": 0,
                "bytes_estimated": 0,
                "requests_count": 0,
                "throttled_reason": budget_decision.reason,
                "bandwidth_usage_ratio": budget_decision.usage_ratio,
                "bytes_used": budget_decision.bytes_used,
                "bytes_limit": budget_decision.bytes_limit,
            }
            summary["dataset_key"] = dataset_key
            summary["started_at"] = started_at.isoformat()
            summary["finished_at"] = _utcnow().isoformat()
            return summary
        target_symbols = await _resolve_symbols(symbols=symbols, single=symbol)
        semaphore = asyncio.Semaphore(_SYMBOL_CONCURRENCY)

        async def _run_with_sem(sym: str) -> tuple[str, _RunOutcome]:
            async with semaphore:
                return (
                    sym,
                    await _run_single(
                        spec,
                        sym,
                        trigger,
                        budget_decision=budget_decision,
                    ),
                )

        raw_results = await asyncio.gather(
            *[_run_with_sem(sym) for sym in target_symbols],
            return_exceptions=True,
        )
        per_symbol: list[tuple[str, _RunOutcome]] = []
        for i, r in enumerate(raw_results):
            if isinstance(r, BaseException):
                sym = target_symbols[i]
                logger.exception(
                    "dataset %s symbol=%s unexpected gather error: %s",
                    dataset_key, sym, r,
                )
                per_symbol.append(
                    (sym, _RunOutcome(status="failed", error_message=str(r)[:2000]))
                )
            else:
                per_symbol.append(r)
        summary = _summarise([r for _, r in per_symbol])
        summary["symbols_total"] = len(target_symbols)

    summary["dataset_key"] = dataset_key
    summary["started_at"] = started_at.isoformat()
    summary["finished_at"] = _utcnow().isoformat()
    return summary


# ─────────────────────────── internals ───────────────────────────


@dataclass
class _RunOutcome:
    status: str
    records_written: int = 0
    bytes_estimated: int = 0
    requests_count: int = 0
    skipped_reason: str | None = None
    error_message: str | None = None


async def _run_single(
    spec: DatasetSpec,
    symbol: str,
    trigger: str,
    budget_decision: BudgetDecision | None = None,
) -> _RunOutcome:
    """Run the handler for one (dataset, symbol) pair."""
    started_at = _utcnow()

    previous = await _load_state(spec.key, symbol)

    if budget_decision is None:
        budget_decision = await should_throttle(spec.quota_class)
    if budget_decision.throttled:
        reason = (
            f"{budget_decision.reason}; usage={budget_decision.usage_ratio:.2%} "
            f"({budget_decision.bytes_used}/{budget_decision.bytes_limit} bytes)"
        )
        run_id = await _open_run_row(
            dataset_key=spec.key,
            symbol=symbol,
            trigger=trigger,
            started_at=started_at,
            cursor_before=_cursor_repr(previous),
        )
        await _finalise_run(
            run_id=run_id,
            status="throttled",
            finished_at=_utcnow(),
            records_written=0,
            bytes_estimated=0,
            requests_count=0,
            cursor_after=_cursor_repr(previous),
            content_hash=None,
            error_message=reason[:2000],
            details={
                "quota_class": spec.quota_class,
                "bandwidth_usage_ratio": budget_decision.usage_ratio,
                "bytes_used": budget_decision.bytes_used,
                "bytes_limit": budget_decision.bytes_limit,
            },
        )
        await _mark_state_status(
            dataset_key=spec.key,
            symbol=symbol,
            status="throttled",
            error_message=reason[:2000],
        )
        return _RunOutcome(status="throttled", error_message=reason[:2000])

    ctx = DatasetContext(
        spec=spec,
        symbol=symbol,
        previous_state=previous,
        trigger=trigger,
    )

    run_id = await _open_run_row(
        dataset_key=spec.key,
        symbol=symbol,
        trigger=trigger,
        started_at=started_at,
        cursor_before=_cursor_repr(previous),
    )

    try:
        result = await spec.handler(ctx)
    except Exception as exc:  # noqa: BLE001 — orchestrator must survive
        logger.exception(
            "dataset %s symbol=%s handler raised", spec.key, symbol or "<global>"
        )
        await _finalise_run(
            run_id=run_id,
            status="failed",
            finished_at=_utcnow(),
            records_written=0,
            bytes_estimated=0,
            requests_count=0,
            cursor_after=_cursor_repr(previous),
            content_hash=None,
            error_message=str(exc)[:2000],
            details={"exception_type": type(exc).__name__},
        )
        await _mark_state_failed(
            dataset_key=spec.key,
            symbol=symbol,
            error_message=str(exc)[:2000],
        )
        return _RunOutcome(
            status="failed", error_message=str(exc)[:2000]
        )

    finished_at = _utcnow()
    status = "skipped" if result.skipped_reason else "ok"

    await _finalise_run(
        run_id=run_id,
        status=status,
        finished_at=finished_at,
        records_written=result.records_written,
        bytes_estimated=result.bytes_estimated,
        requests_count=result.requests_count,
        cursor_after=_cursor_repr_from_result(result, previous),
        content_hash=result.content_hash,
        error_message=None,
        details=result.details,
    )

    # Only mark last_success_at when data was actually written or confirmed
    # unchanged. "empty" skips should NOT reset the freshness clock — doing
    # so hides the fact that no data exists for this dataset/symbol.
    is_real_success = (
        status == "ok"
        or result.skipped_reason == "unchanged"
    )
    await _commit_state(
        spec=spec,
        symbol=symbol,
        result=result,
        finished_at=finished_at,
        previous=previous,
        status=status,
        update_success_at=is_real_success,
    )

    # Flip the legacy stock_universe.*_synced flag so the old /api/v1/sync/*
    # routes stay consistent during the migration period.
    if status == "ok" and spec.legacy_flag and symbol != GLOBAL_SYMBOL_SENTINEL:
        await _flip_legacy_flag(spec.legacy_flag, symbol)

    return _RunOutcome(
        status=status,
        records_written=result.records_written,
        bytes_estimated=result.bytes_estimated,
        requests_count=result.requests_count,
        skipped_reason=result.skipped_reason,
    )


async def _resolve_symbols(
    *, symbols: list[str] | None, single: str | None
) -> list[str]:
    if single:
        return [single.upper()]
    if symbols:
        return [s.upper() for s in symbols]
    async with async_session_factory() as session:
        stmt = (
            select(StockUniverse.symbol)
            .where(StockUniverse.is_actively_trading.is_(True))
            .order_by(StockUniverse.symbol)
        )
        return list((await session.scalars(stmt)).all())


async def _load_state(dataset_key: str, symbol: str) -> SyncState | None:
    async with async_session_factory() as session:
        stmt = select(SyncState).where(
            SyncState.dataset_key == dataset_key,
            SyncState.symbol == symbol,
        )
        return (await session.scalars(stmt)).first()


async def _open_run_row(
    *,
    dataset_key: str,
    symbol: str,
    trigger: str,
    started_at: datetime,
    cursor_before: str | None,
) -> int:
    async with async_session_factory() as session:
        run = SyncRun(
            dataset_key=dataset_key,
            symbol=symbol,
            trigger=trigger,
            status="running",
            started_at=started_at,
            cursor_before=cursor_before,
        )
        session.add(run)
        await session.commit()
        await session.refresh(run)
        return run.id


async def _finalise_run(
    *,
    run_id: int,
    status: str,
    finished_at: datetime,
    records_written: int,
    bytes_estimated: int,
    requests_count: int,
    cursor_after: str | None,
    content_hash: str | None,
    error_message: str | None,
    details: dict[str, Any],
) -> None:
    async with async_session_factory() as session:
        run = await session.get(SyncRun, run_id)
        if run is None:  # pragma: no cover — row should always exist
            return
        run.status = status
        run.finished_at = finished_at
        run.records_written = records_written
        run.bytes_estimated = bytes_estimated
        run.requests_count = requests_count
        run.cursor_after = cursor_after
        run.content_hash = content_hash
        run.error_message = error_message
        run.details = details or {}
        await session.commit()


async def _commit_state(
    *,
    spec: DatasetSpec,
    symbol: str,
    result: DatasetResult,
    finished_at: datetime,
    previous: SyncState | None,
    status: str,
    update_success_at: bool = True,
) -> None:
    new_cursor_date = result.cursor_date
    new_cursor_value = result.cursor_value
    # Sticky cursors — if the handler didn't advance the cursor (skipped /
    # no-op), preserve whatever was stored previously so we don't appear
    # to regress.
    if new_cursor_date is None and previous is not None:
        new_cursor_date = previous.cursor_date
    if new_cursor_value is None and previous is not None:
        new_cursor_value = previous.cursor_value

    prev_totals = (
        (previous.records_written_total, previous.bytes_estimated_total, previous.requests_count_total)
        if previous else (0, 0, 0)
    )

    # Only advance the freshness clock when we actually confirmed fresh data.
    if update_success_at:
        success_at = finished_at
        fresh_until = finished_at + timedelta(seconds=spec.cadence_seconds)
    else:
        success_at = previous.last_success_at if previous else None
        # For "empty" skips, still set fresh_until so the scheduler doesn't
        # immediately retry a symbol that genuinely has no data upstream.
        if result.skipped_reason == "empty":
            fresh_until = finished_at + timedelta(seconds=spec.cadence_seconds)
        else:
            fresh_until = previous.fresh_until if previous else None

    row = {
        "dataset_key": spec.key,
        "symbol": symbol,
        "cursor_date": new_cursor_date,
        "cursor_value": new_cursor_value,
        "status": status,
        "last_attempt_at": finished_at,
        "last_success_at": success_at,
        "fresh_until": fresh_until,
        "records_written": result.records_written,
        "records_written_total": prev_totals[0] + result.records_written,
        "bytes_estimated": result.bytes_estimated,
        "bytes_estimated_total": prev_totals[1] + result.bytes_estimated,
        "requests_count": result.requests_count,
        "requests_count_total": prev_totals[2] + result.requests_count,
        "content_hash_last": result.content_hash,
        "error_message": None,
        "meta": result.details or {},
    }
    async with async_session_factory() as session:
        stmt = pg_insert(SyncState).values(row)
        stmt = stmt.on_conflict_do_update(
            constraint="pk_sync_state",
            set_={
                "cursor_date": stmt.excluded.cursor_date,
                "cursor_value": stmt.excluded.cursor_value,
                "status": stmt.excluded.status,
                "last_attempt_at": stmt.excluded.last_attempt_at,
                "last_success_at": stmt.excluded.last_success_at,
                "fresh_until": stmt.excluded.fresh_until,
                "records_written": stmt.excluded.records_written,
                "records_written_total": stmt.excluded.records_written_total,
                "bytes_estimated": stmt.excluded.bytes_estimated,
                "bytes_estimated_total": stmt.excluded.bytes_estimated_total,
                "requests_count": stmt.excluded.requests_count,
                "requests_count_total": stmt.excluded.requests_count_total,
                "content_hash_last": stmt.excluded.content_hash_last,
                "error_message": stmt.excluded.error_message,
                "meta": stmt.excluded.meta,
            },
        )
        await session.execute(stmt)
        await session.commit()


async def _mark_state_failed(
    *, dataset_key: str, symbol: str, error_message: str
) -> None:
    await _mark_state_status(
        dataset_key=dataset_key,
        symbol=symbol,
        status="failed",
        error_message=error_message,
    )


async def _mark_state_status(
    *, dataset_key: str, symbol: str, status: str, error_message: str
) -> None:
    now = _utcnow()
    row = {
        "dataset_key": dataset_key,
        "symbol": symbol,
        "status": status,
        "last_attempt_at": now,
        "error_message": error_message,
    }
    async with async_session_factory() as session:
        stmt = pg_insert(SyncState).values(row)
        stmt = stmt.on_conflict_do_update(
            constraint="pk_sync_state",
            set_={
                "status": stmt.excluded.status,
                "last_attempt_at": stmt.excluded.last_attempt_at,
                "error_message": stmt.excluded.error_message,
            },
        )
        await session.execute(stmt)
        await session.commit()


async def _flip_legacy_flag(flag_name: str, symbol: str) -> None:
    """Flip a stock_universe boolean sync flag for backward compatibility."""
    from app.models.stock_universe import StockUniverse

    flag_column = getattr(StockUniverse, flag_name, None)
    if flag_column is None:
        logger.warning("legacy_flag %r not found on StockUniverse", flag_name)
        return
    async with async_session_factory() as session:
        await session.execute(
            update(StockUniverse)
            .where(StockUniverse.symbol == symbol)
            .values({flag_column: True})
        )
        await session.commit()


def _cursor_repr(state: SyncState | None) -> str | None:
    if state is None:
        return None
    if state.cursor_date is not None:
        return state.cursor_date.isoformat()
    return state.cursor_value


def _cursor_repr_from_result(
    result: DatasetResult, fallback: SyncState | None
) -> str | None:
    if result.cursor_date is not None:
        return result.cursor_date.isoformat()
    if result.cursor_value is not None:
        return result.cursor_value
    return _cursor_repr(fallback)


def _summarise(outcomes: list[_RunOutcome]) -> dict[str, Any]:
    ok = sum(1 for o in outcomes if o.status == "ok")
    failed = sum(1 for o in outcomes if o.status == "failed")
    skipped = sum(1 for o in outcomes if o.status == "skipped")
    throttled = sum(1 for o in outcomes if o.status == "throttled")
    return {
        "runs": len(outcomes),
        "ok": ok,
        "failed": failed,
        "skipped": skipped,
        "throttled": throttled,
        "records_written": sum(o.records_written for o in outcomes),
        "bytes_estimated": sum(o.bytes_estimated for o in outcomes),
        "requests_count": sum(o.requests_count for o in outcomes),
    }


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)
