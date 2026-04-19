"""
Dataset handler: ``global.earnings_calendar``.

Incremental strategy:

* Pull a rolling window ``[today - lookback_days, today + lookahead_days]``
  from FMP ``/earnings-calendar``.
* The handler returns the max announcement date so ``sync_state.cursor_date``
  reflects the most recent announcement we've ingested — useful for UI
  freshness badges.
* Writes go into the existing ``earnings_calendar`` fact table via
  ``ON CONFLICT DO UPDATE``, so running the orchestrator side-by-side with
  the legacy per-symbol pipeline is safe.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any

from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.core.database import async_session_factory
from app.models.market import EarningsCalendar
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

_UPDATE_COLS = (
    "fiscal_period_end",
    "eps_estimated",
    "eps_actual",
    "revenue_estimated",
    "revenue_actual",
    "raw_payload",
)


async def run(ctx: DatasetContext) -> DatasetResult:
    cfg = ctx.spec.config or {}
    endpoint: str = cfg.get("endpoint", "/earnings-calendar")
    lookback_days: int = int(cfg.get("lookback_days", 14))
    lookahead_days: int = int(cfg.get("lookahead_days", 90))

    today = date.today()
    date_from = today - timedelta(days=lookback_days)
    date_to = today + timedelta(days=lookahead_days)

    params: dict[str, Any] = {
        "from": date_from.isoformat(),
        "to": date_to.isoformat(),
    }

    payload = await fmp_client.get(endpoint, params=params)
    payload_list = as_list(payload)

    rows: list[dict] = []
    max_seen: date | None = None
    for entry in payload_list:
        d = parse_date(entry.get("date"))
        if d is None:
            continue
        if max_seen is None or d > max_seen:
            max_seen = d
        symbol = entry.get("symbol")
        if not symbol:
            continue
        rows.append(
            {
                "symbol": str(symbol).upper(),
                "date": d,
                "fiscal_period_end": parse_date(
                    entry.get("fiscalDateEnding")
                    or entry.get("fiscalDate")
                    or entry.get("fiscalPeriodEnd")
                ),
                "eps_estimated": safe_float(
                    entry.get("epsEstimated") or entry.get("eps_estimate")
                ),
                "eps_actual": safe_float(
                    entry.get("epsActual") or entry.get("eps")
                ),
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

    bytes_est = estimate_bytes(payload_list)
    hash_value = content_hash(payload_list)

    if not rows:
        logger.info(
            "earnings_calendar empty window from=%s to=%s (payload entries=%d)",
            date_from, date_to, len(payload_list),
        )
        return DatasetResult(
            records_written=0,
            bytes_estimated=bytes_est,
            requests_count=1,
            cursor_date=max_seen,
            content_hash=hash_value,
            skipped_reason="empty" if not payload_list else None,
            details={
                "window_from": date_from.isoformat(),
                "window_to": date_to.isoformat(),
                "payload_entries": len(payload_list),
            },
        )

    # If the payload hasn't changed at all since last run we can skip the DB
    # write entirely. This is the "write amplification" guard called out in
    # the spec §12.
    if (
        ctx.previous_state is not None
        and ctx.previous_state.content_hash_last == hash_value
    ):
        logger.info(
            "earnings_calendar content hash unchanged (%s) — skip DB write",
            hash_value,
        )
        return DatasetResult(
            records_written=0,
            bytes_estimated=bytes_est,
            requests_count=1,
            cursor_date=max_seen,
            content_hash=hash_value,
            skipped_reason="unchanged",
            details={
                "window_from": date_from.isoformat(),
                "window_to": date_to.isoformat(),
                "payload_entries": len(payload_list),
            },
        )

    async with async_session_factory() as session:
        for chunk in chunks(rows, BULK_CHUNK):
            stmt = pg_insert(EarningsCalendar).values(list(chunk))
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
            "window_from": date_from.isoformat(),
            "window_to": date_to.isoformat(),
            "payload_entries": len(payload_list),
            "rows_upserted": len(rows),
        },
    )
