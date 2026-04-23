"""Dataset handler: ``global.sector_performance``.

Aggregates two FMP endpoints into ``sector_performance_series``:
- ``/historical-sectors-performance`` — daily sector return percentages
- ``/sector_price_earning_ratio``     — sector trailing P/E snapshots

Incremental strategy:
- Query max(date) from sector_performance_series and use ``from`` parameter
  to only fetch newer data from FMP.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.core.database import async_session_factory
from app.models.sector import SectorPerformanceSeries
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

# Sector name field varies between FMP endpoints.
_SECTOR_KEYS = ("sector", "sectorName", "name")

_UPDATE_COLS = ("value", "raw_payload")


def _extract_sector(item: dict[str, Any]) -> str | None:
    for k in _SECTOR_KEYS:
        v = item.get(k)
        if v and isinstance(v, str):
            return v
    return None


async def _get_max_date() -> date | None:
    """Query sector_performance_series for the most recent date."""
    async with async_session_factory() as session:
        stmt = select(func.max(SectorPerformanceSeries.date))
        result = await session.execute(stmt)
        return result.scalar_one_or_none()


async def run(ctx: DatasetContext) -> DatasetResult:
    all_rows: list[dict[str, Any]] = []
    requests = 0
    max_seen: date | None = None
    bytes_estimated = 0

    # Incremental: fetch only data after the most recent date we have
    max_existing_date = await _get_max_date()
    from_date = max_existing_date + timedelta(days=1) if max_existing_date else None

    # ── 1. Historical sector performance (daily return %) ──────
    perf_params: dict[str, Any] = {}
    if from_date:
        perf_params["from"] = from_date.isoformat()
    perf_payload = await fmp_client.get("/historical-sectors-performance", params=perf_params)
    requests += 1
    perf_entries = as_list(perf_payload)
    bytes_estimated += estimate_bytes(perf_entries)

    for item in perf_entries:
        d = parse_date(item.get("date"))
        if d is None:
            continue
        if max_seen is None or d > max_seen:
            max_seen = d
        # Each entry has sector-name keys like "technologyChangesPercentage"
        # with float values. Extract all *ChangesPercentage fields.
        for key, val in item.items():
            if not key.endswith("ChangesPercentage"):
                continue
            sector_name = key.replace("ChangesPercentage", "")
            if not sector_name:
                continue
            # Normalise to title-case for consistency.
            sector_name = sector_name[0].upper() + sector_name[1:]
            all_rows.append(
                {
                    "sector": sector_name,
                    "date": d,
                    "metric": "return_pct",
                    "value": safe_float(val),
                    "raw_payload": clean_jsonb({"date": item.get("date"), key: val}),
                }
            )

    # ── 2. Sector P/E ratios ───────────────────────────────────
    pe_params: dict[str, Any] = {}
    if from_date:
        pe_params["from"] = from_date.isoformat()
    pe_payload = await fmp_client.get("/sector_price_earning_ratio", params=pe_params)
    requests += 1
    pe_entries = as_list(pe_payload)
    bytes_estimated += estimate_bytes(pe_entries)

    for item in pe_entries:
        d = parse_date(item.get("date"))
        sector = _extract_sector(item)
        if d is None or sector is None:
            continue
        if max_seen is None or d > max_seen:
            max_seen = d
        all_rows.append(
            {
                "sector": sector,
                "date": d,
                "metric": "pe_ratio",
                "value": safe_float(item.get("pe")),
                "raw_payload": clean_jsonb(item),
            }
        )

    rows = dedupe(all_rows, ("sector", "date", "metric"))
    combined_hash = content_hash(rows)

    if not rows:
        return DatasetResult(
            requests_count=requests,
            bytes_estimated=bytes_estimated,
            content_hash=combined_hash,
            cursor_date=max_seen or max_existing_date,
            skipped_reason="empty",
            details={
                "perf_entries": len(perf_entries),
                "pe_entries": len(pe_entries),
                "from_date": str(from_date) if from_date else None,
            },
        )

    if ctx.previous_state and ctx.previous_state.content_hash_last == combined_hash:
        return DatasetResult(
            requests_count=requests,
            bytes_estimated=bytes_estimated,
            cursor_date=max_seen,
            content_hash=combined_hash,
            skipped_reason="unchanged",
            details={"rows": len(rows)},
        )

    async with async_session_factory() as session:
        for chunk in chunks(rows, BULK_CHUNK):
            stmt = pg_insert(SectorPerformanceSeries).values(list(chunk))
            stmt = stmt.on_conflict_do_update(
                index_elements=["sector", "date", "metric"],
                set_={c: getattr(stmt.excluded, c) for c in _UPDATE_COLS},
            )
            await session.execute(stmt)
        await session.commit()

    return DatasetResult(
        records_written=len(rows),
        bytes_estimated=bytes_estimated,
        requests_count=requests,
        cursor_date=max_seen,
        content_hash=combined_hash,
        details={
            "perf_entries": len(perf_entries),
            "pe_entries": len(pe_entries),
            "rows_upserted": len(rows),
            "from_date": str(from_date) if from_date else None,
        },
    )
