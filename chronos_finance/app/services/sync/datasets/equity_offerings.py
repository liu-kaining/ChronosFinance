"""Dataset handler: ``symbol.alpha.equity_offerings``.

Pulls equity offering events from FMP
``/equity-offering-search`` and upserts into ``equity_offerings``.

Incremental strategy:
- Query MAX(filing_date) from equity_offerings for this symbol
- Use FMP API's ``from`` parameter to only fetch new filings
- Upsert with ON CONFLICT DO UPDATE for idempotency
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any

import httpx
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.core.database import async_session_factory
from app.models.equity import EquityOffering
from app.services.sync.datasets._shared import (
    BULK_CHUNK,
    as_list,
    chunks,
    clean_jsonb,
    dedupe,
    parse_date,
    safe_float,
    safe_int,
)
from app.services.sync.orchestrator import DatasetContext, DatasetResult
from app.services.sync.utils import content_hash, estimate_bytes
from app.utils.fmp_client import fmp_client

logger = logging.getLogger(__name__)

_UPDATE_COLS = ("offering_date", "offering_amount", "shares_offered", "offering_price", "offering_type", "raw_payload")


async def _resolve_cursor(ctx: DatasetContext, symbol: str) -> date | None:
    """Get the most recent filing_date we have for this symbol."""
    if ctx.previous_cursor_date is not None:
        return ctx.previous_cursor_date
    async with async_session_factory() as session:
        stmt = select(func.max(EquityOffering.filing_date)).where(
            EquityOffering.symbol == symbol
        )
        result = await session.execute(stmt)
        return result.scalar_one_or_none()


async def run(ctx: DatasetContext) -> DatasetResult:
    """Pull equity offerings for one symbol with incremental date filter."""
    cfg = ctx.spec.config or {}
    overlap_days = int(cfg.get("overlap_days", 30))
    limit = int(cfg.get("limit", 1000))
    symbol = ctx.symbol

    # Incremental: fetch only filings after the most recent one we have
    cursor = await _resolve_cursor(ctx, symbol)
    params: dict[str, Any] = {"symbol": symbol, "limit": limit}
    if cursor is not None:
        params["from"] = (cursor - timedelta(days=overlap_days)).isoformat()

    try:
        payload = await fmp_client.get("/equity-offering-search", params=params)
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
        filing_date = parse_date(entry.get("filingDate") or entry.get("date"))
        offering_date = parse_date(entry.get("offeringDate") or entry.get("date"))
        if filing_date is None:
            continue
        if max_seen is None or filing_date > max_seen:
            max_seen = filing_date
        rows.append(
            {
                "symbol": symbol,
                "filing_date": filing_date,
                "offering_date": offering_date,
                "offering_amount": safe_float(entry.get("offeringAmount") or entry.get("amount")),
                "shares_offered": safe_int(entry.get("sharesOffered") or entry.get("shares")),
                "offering_price": safe_float(entry.get("offeringPrice") or entry.get("price")),
                "offering_type": entry.get("offeringType") or entry.get("type"),
                "raw_payload": clean_jsonb(entry),
            }
        )

    rows = dedupe(rows, ("symbol", "filing_date", "offering_amount"))

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
            stmt = pg_insert(EquityOffering).values(list(chunk))
            stmt = stmt.on_conflict_do_update(
                constraint="uq_equity_offering",
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
