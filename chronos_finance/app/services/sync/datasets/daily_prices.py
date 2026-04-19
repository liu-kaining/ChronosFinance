"""
Dataset handler: ``symbol.daily_prices``.

Incremental strategy:

* On first run we pull the full history (~30 years) via
  ``/historical-price-eod/full?symbol=...``.
* On subsequent runs we compute the next ``from`` as
  ``max(date) - overlap_days`` based on ``sync_state.cursor_date`` (or — as a
  cheap safety net on the first run — ``max(date)`` from ``daily_prices``).
* Responses are JSON arrays of daily bars; we ``ON CONFLICT DO UPDATE`` into
  ``daily_prices`` so re-runs are idempotent.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.core.database import async_session_factory
from app.models.market import DailyPrice
from app.services.sync.datasets._shared import (
    BULK_CHUNK,
    as_list,
    chunks,
    dedupe,
    parse_date,
    safe_float,
    safe_int,
)
from app.services.sync.orchestrator import DatasetContext, DatasetResult
from app.services.sync.utils import content_hash, estimate_bytes
from app.utils.fmp_client import fmp_client

logger = logging.getLogger(__name__)

_UPDATE_COLS = ("open", "high", "low", "close", "adj_close", "volume")


async def run(ctx: DatasetContext) -> DatasetResult:
    cfg = ctx.spec.config or {}
    endpoint: str = cfg.get("endpoint", "/historical-price-eod/full")
    overlap_days: int = int(cfg.get("overlap_days", 5))
    symbol = ctx.symbol

    params: dict[str, Any] = {"symbol": symbol}
    cursor = await _resolve_cursor(ctx, symbol)
    if cursor is not None:
        params["from"] = (cursor - timedelta(days=overlap_days)).isoformat()

    payload = await fmp_client.get(endpoint, params=params)
    payload_list = as_list(payload)

    rows: list[dict] = []
    max_seen: date | None = None
    for bar in payload_list:
        d = parse_date(bar.get("date"))
        if d is None:
            continue
        if max_seen is None or d > max_seen:
            max_seen = d
        rows.append(
            {
                "symbol": symbol,
                "date": d,
                "open": safe_float(bar.get("open")),
                "high": safe_float(bar.get("high")),
                "low": safe_float(bar.get("low")),
                "close": safe_float(bar.get("close")),
                "adj_close": safe_float(bar.get("adjClose")),
                "volume": safe_int(bar.get("volume")),
            }
        )
    rows = dedupe(rows, ("symbol", "date"))

    bytes_est = estimate_bytes(payload_list)
    hash_value = content_hash(payload_list)

    if not rows:
        logger.info(
            "daily_prices %s empty payload (entries=%d)",
            symbol, len(payload_list),
        )
        return DatasetResult(
            records_written=0,
            bytes_estimated=bytes_est,
            requests_count=1,
            cursor_date=max_seen or cursor,
            content_hash=hash_value,
            skipped_reason="empty",
            details={"payload_entries": len(payload_list)},
        )

    if (
        ctx.previous_state is not None
        and ctx.previous_state.content_hash_last == hash_value
    ):
        logger.info(
            "daily_prices %s content hash unchanged — skip DB write", symbol
        )
        return DatasetResult(
            records_written=0,
            bytes_estimated=bytes_est,
            requests_count=1,
            cursor_date=max_seen,
            content_hash=hash_value,
            skipped_reason="unchanged",
            details={"payload_entries": len(payload_list)},
        )

    async with async_session_factory() as session:
        for chunk in chunks(rows, BULK_CHUNK):
            stmt = pg_insert(DailyPrice).values(list(chunk))
            stmt = stmt.on_conflict_do_update(
                index_elements=["symbol", "date"],
                set_={c: getattr(stmt.excluded, c) for c in _UPDATE_COLS},
            )
            await session.execute(stmt)
        await session.commit()

    return DatasetResult(
        records_written=len(rows),
        bytes_estimated=bytes_est,
        requests_count=1,
        cursor_date=max_seen,
        content_hash=hash_value,
        details={
            "payload_entries": len(payload_list),
            "rows_upserted": len(rows),
            "cursor_from": params.get("from"),
        },
    )


async def _resolve_cursor(ctx: DatasetContext, symbol: str) -> date | None:
    # Prefer the state cursor — it reflects what the orchestrator last
    # confirmed ingested. Fall back to the fact table's max(date) so that
    # existing DBs (with data but no sync_state yet) don't re-pull 30 years.
    if ctx.previous_cursor_date is not None:
        return ctx.previous_cursor_date

    async with async_session_factory() as session:
        stmt = select(func.max(DailyPrice.date)).where(DailyPrice.symbol == symbol)
        result = await session.execute(stmt)
        return result.scalar_one_or_none()
