"""Symbol-level event datasets migrated to the new orchestrator."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.core.database import async_session_factory
from app.models.market import CorporateAction, EarningsCalendar
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


async def run_symbol_corporate_actions(ctx: DatasetContext) -> DatasetResult:
    """
    Pull symbol-level dividends + splits and upsert into ``corporate_actions``.
    """
    symbol = ctx.symbol
    cfg = ctx.spec.config or {}
    overlap_days = int(cfg.get("overlap_days", 30))
    cursor = ctx.previous_cursor_date
    from_date = None
    if cursor is not None:
        from_date = (cursor - timedelta(days=overlap_days)).isoformat()

    requests_count = 0
    payload_union: list[dict[str, Any]] = []
    rows: list[dict[str, Any]] = []
    max_seen: date | None = None
    for action_type, endpoint in (("dividend", "/dividends"), ("split", "/splits")):
        params: dict[str, Any] = {"symbol": symbol}
        if from_date is not None:
            params["from"] = from_date
        payload = await fmp_client.get(endpoint, params=params)
        requests_count += 1
        entries = as_list(payload)
        payload_union.extend([{"_type": action_type, **e} for e in entries if isinstance(e, dict)])
        for entry in entries:
            d = parse_date(entry.get("date"))
            if d is None:
                continue
            max_seen = d if max_seen is None or d > max_seen else max_seen
            rows.append(
                {
                    "symbol": symbol,
                    "action_type": action_type,
                    "action_date": d,
                    "raw_payload": clean_jsonb(entry),
                }
            )
    rows = dedupe(rows, ("symbol", "action_type", "action_date"))
    union_hash = content_hash(payload_union)
    if ctx.previous_state and ctx.previous_state.content_hash_last == union_hash:
        return DatasetResult(
            requests_count=requests_count,
            bytes_estimated=estimate_bytes(payload_union),
            content_hash=union_hash,
            cursor_date=max_seen or cursor,
            skipped_reason="unchanged",
            details={"rows": len(rows), "from": from_date},
        )
    if rows:
        async with async_session_factory() as session:
            for chunk in chunks(rows, BULK_CHUNK):
                stmt = pg_insert(CorporateAction).values(list(chunk))
                stmt = stmt.on_conflict_do_update(
                    constraint="uq_corporate_action",
                    set_={"raw_payload": stmt.excluded.raw_payload},
                )
                await session.execute(stmt)
            await session.commit()
    return DatasetResult(
        records_written=len(rows),
        requests_count=requests_count,
        bytes_estimated=estimate_bytes(payload_union),
        content_hash=union_hash,
        cursor_date=max_seen or cursor,
        details={"rows": len(rows), "from": from_date},
    )


async def run_symbol_earnings_history(ctx: DatasetContext) -> DatasetResult:
    """Pull symbol-level earnings history from ``/earnings``."""
    symbol = ctx.symbol
    payload = await fmp_client.get("/earnings", params={"symbol": symbol})
    entries = as_list(payload)
    payload_hash = content_hash(entries)
    bytes_estimated = estimate_bytes(entries)

    rows: list[dict[str, Any]] = []
    max_seen: date | None = None
    for entry in entries:
        d = parse_date(entry.get("date"))
        if d is None:
            continue
        max_seen = d if max_seen is None or d > max_seen else max_seen
        fiscal_end = (
            entry.get("fiscalDateEnding")
            or entry.get("fiscalDate")
            or entry.get("fiscalPeriodEnd")
        )
        rows.append(
            {
                "symbol": symbol,
                "date": d,
                "fiscal_period_end": parse_date(fiscal_end),
                "eps_estimated": safe_float(
                    entry.get("epsEstimated") or entry.get("eps_estimate")
                ),
                "eps_actual": safe_float(entry.get("epsActual") or entry.get("eps")),
                "revenue_estimated": safe_float(
                    entry.get("revenueEstimated") or entry.get("revenue_estimate")
                ),
                "revenue_actual": safe_float(
                    entry.get("revenueActual") or entry.get("revenue")
                ),
                "raw_payload": clean_jsonb(entry),
            }
        )
    rows = dedupe(rows, ("symbol", "date"))

    if ctx.previous_state and ctx.previous_state.content_hash_last == payload_hash:
        return DatasetResult(
            requests_count=1,
            bytes_estimated=bytes_estimated,
            content_hash=payload_hash,
            cursor_date=max_seen or ctx.previous_cursor_date,
            skipped_reason="unchanged",
            details={"rows": len(rows)},
        )
    if rows:
        async with async_session_factory() as session:
            for chunk in chunks(rows, BULK_CHUNK):
                stmt = pg_insert(EarningsCalendar).values(list(chunk))
                stmt = stmt.on_conflict_do_update(
                    index_elements=["symbol", "date"],
                    set_={
                        "fiscal_period_end": stmt.excluded.fiscal_period_end,
                        "eps_estimated": stmt.excluded.eps_estimated,
                        "eps_actual": stmt.excluded.eps_actual,
                        "revenue_estimated": stmt.excluded.revenue_estimated,
                        "revenue_actual": stmt.excluded.revenue_actual,
                        "raw_payload": stmt.excluded.raw_payload,
                    },
                )
                await session.execute(stmt)
            await session.commit()
    return DatasetResult(
        records_written=len(rows),
        requests_count=1,
        bytes_estimated=bytes_estimated,
        content_hash=payload_hash,
        cursor_date=max_seen or ctx.previous_cursor_date,
        details={"rows": len(rows)},
    )
