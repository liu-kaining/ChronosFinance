"""Dataset handler: ``symbol.valuation.dcf``.

Pulls historical daily DCF valuation from FMP
``/historical-discounted-cash-flow`` and upserts into ``valuation_dcf``.

Incremental strategy:
- Query MAX(date) from valuation_dcf for this symbol
- Use FMP API's ``from`` parameter to only fetch new dates
- Upsert with ON CONFLICT DO UPDATE for idempotency

This provides a "valuation thermometer" — tracking how intrinsic value
relates to market price on each trading day.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any

import httpx
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.core.database import async_session_factory
from app.models.valuation import ValuationDCF
from app.services.sync.datasets._shared import (
    BULK_CHUNK,
    as_list,
    chunks,
    clean_jsonb,
    dedupe,
    parse_date,
    safe_float,
)
from app.services.sync.orchestrator import DatasetContext, DatasetResult
from app.services.sync.utils import content_hash, estimate_bytes
from app.utils.fmp_client import fmp_client

logger = logging.getLogger(__name__)

_UPDATE_COLS = ("dcf", "stock_price", "raw_payload")


async def _resolve_cursor(ctx: DatasetContext, symbol: str) -> date | None:
    """Get the most recent date we have for this symbol."""
    if ctx.previous_cursor_date is not None:
        return ctx.previous_cursor_date
    async with async_session_factory() as session:
        stmt = select(func.max(ValuationDCF.date)).where(ValuationDCF.symbol == symbol)
        result = await session.execute(stmt)
        return result.scalar_one_or_none()


async def run(ctx: DatasetContext) -> DatasetResult:
    """Pull historical daily DCF for one symbol with incremental date filter."""
    cfg = ctx.spec.config or {}
    overlap_days = int(cfg.get("overlap_days", 5))
    limit = int(cfg.get("limit", 5000))
    symbol = ctx.symbol

    # Incremental: fetch only data after the most recent date we have
    cursor = await _resolve_cursor(ctx, symbol)
    params: dict[str, Any] = {"symbol": symbol, "limit": limit}
    if cursor is not None:
        params["from"] = (cursor - timedelta(days=overlap_days)).isoformat()

    try:
        # Stable endpoint currently exposes the latest DCF snapshot via
        # /discounted-cash-flow (not /historical-discounted-cash-flow).
        payload = await fmp_client.get("/discounted-cash-flow", params=params)
    except httpx.HTTPStatusError as exc:
        if exc.response is not None and exc.response.status_code == 404:
            return DatasetResult(
                requests_count=1,
                bytes_estimated=0,
                content_hash=content_hash([]),
                cursor_date=cursor,
                skipped_reason="empty",
                details={
                    "payload_entries": 0,
                    "from_date": params.get("from"),
                    "http_status": 404,
                },
            )
        raise
    entries = as_list(payload)
    payload_hash = content_hash(entries)
    bytes_estimated = estimate_bytes(entries)

    if not entries:
        return DatasetResult(
            requests_count=1,
            bytes_estimated=bytes_estimated,
            content_hash=payload_hash,
            cursor_date=cursor,
            skipped_reason="empty",
            details={"payload_entries": 0, "from_date": params.get("from")},
        )

    if ctx.previous_state and ctx.previous_state.content_hash_last == payload_hash:
        return DatasetResult(
            requests_count=1,
            bytes_estimated=bytes_estimated,
            content_hash=payload_hash,
            cursor_date=cursor,
            skipped_reason="unchanged",
            details={"payload_entries": len(entries)},
        )

    rows: list[dict[str, Any]] = []
    max_seen: date | None = None
    for entry in entries:
        d = parse_date(entry.get("date"))
        if d is None:
            continue
        if max_seen is None or d > max_seen:
            max_seen = d
        rows.append(
            {
                "symbol": symbol,
                "date": d,
                "dcf": safe_float(entry.get("dcf")),
                "stock_price": safe_float(
                    entry.get("stockPrice")
                    or entry.get("Stock Price")
                    or entry.get("price")
                ),
                "raw_payload": clean_jsonb(entry),
            }
        )

    rows = dedupe(rows, ("symbol", "date"))

    if not rows:
        return DatasetResult(
            requests_count=1,
            bytes_estimated=bytes_estimated,
            content_hash=payload_hash,
            cursor_date=max_seen or cursor,
            skipped_reason="empty",
            details={"payload_entries": len(entries), "from_date": params.get("from")},
        )

    async with async_session_factory() as session:
        for chunk in chunks(rows, BULK_CHUNK):
            stmt = pg_insert(ValuationDCF).values(list(chunk))
            stmt = stmt.on_conflict_do_update(
                index_elements=["symbol", "date"],
                set_={c: getattr(stmt.excluded, c) for c in _UPDATE_COLS},
            )
            await session.execute(stmt)
        await session.commit()

    return DatasetResult(
        records_written=len(rows),
        bytes_estimated=bytes_estimated,
        requests_count=1,
        content_hash=payload_hash,
        cursor_date=max_seen,
        details={
            "payload_entries": len(entries),
            "rows_upserted": len(rows),
            "from_date": params.get("from"),
        },
    )
