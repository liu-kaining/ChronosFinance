"""Dataset handler: ``symbol.daily_market_cap``.

Pulls historical daily market-cap from FMP
``/historical-market-capitalization/{symbol}`` and upserts into
``daily_market_cap``.  Incremental via cursor_date (same strategy as
daily_prices).
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.core.database import async_session_factory
from app.models.market_cap import DailyMarketCap
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

_UPDATE_COLS = ("market_cap",)


async def run(ctx: DatasetContext) -> DatasetResult:
    cfg = ctx.spec.config or {}
    overlap_days: int = int(cfg.get("overlap_days", 5))
    limit: int = int(cfg.get("limit", 5000))
    symbol = ctx.symbol

    params: dict[str, Any] = {"symbol": symbol, "limit": limit}
    cursor = await _resolve_cursor(ctx, symbol)
    if cursor is not None:
        params["from"] = (cursor - timedelta(days=overlap_days)).isoformat()

    payload = await fmp_client.get(
        "/historical-market-capitalization", params=params
    )
    payload_list = as_list(payload)

    rows: list[dict] = []
    max_seen: date | None = None
    for item in payload_list:
        d = parse_date(item.get("date"))
        if d is None:
            continue
        if max_seen is None or d > max_seen:
            max_seen = d
        rows.append(
            {
                "symbol": symbol,
                "date": d,
                "market_cap": safe_float(item.get("marketCap")),
                "raw_payload": clean_jsonb(item),
            }
        )
    rows = dedupe(rows, ("symbol", "date"))

    bytes_est = estimate_bytes(payload_list)
    hash_value = content_hash(payload_list)

    if not rows:
        return DatasetResult(
            requests_count=1,
            bytes_estimated=bytes_est,
            cursor_date=max_seen or cursor,
            content_hash=hash_value,
            skipped_reason="empty",
            details={"payload_entries": len(payload_list)},
        )

    if (
        ctx.previous_state is not None
        and ctx.previous_state.content_hash_last == hash_value
    ):
        return DatasetResult(
            requests_count=1,
            bytes_estimated=bytes_est,
            cursor_date=max_seen,
            content_hash=hash_value,
            skipped_reason="unchanged",
            details={"payload_entries": len(payload_list)},
        )

    async with async_session_factory() as session:
        for chunk in chunks(rows, BULK_CHUNK):
            stmt = pg_insert(DailyMarketCap).values(list(chunk))
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
    if ctx.previous_cursor_date is not None:
        return ctx.previous_cursor_date
    async with async_session_factory() as session:
        stmt = select(func.max(DailyMarketCap.date)).where(
            DailyMarketCap.symbol == symbol
        )
        result = await session.execute(stmt)
        return result.scalar_one_or_none()
