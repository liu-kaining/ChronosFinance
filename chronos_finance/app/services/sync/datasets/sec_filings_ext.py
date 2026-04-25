"""Dataset handlers: ``symbol.alpha.sec_filings_10q`` and ``symbol.alpha.sec_filings_8k``.

Extends the existing SEC filing logic (10-K) to cover 10-Q quarterly reports
and 8-K current-event reports.  Reuses the same ``sec_files`` table with
``form_type`` as discriminator.

Cold-Hot Separation Architecture:
- Primary storage: R2 object storage (cold) - JSON files stored in R2
- Database index: sec_files table stores metadata + storage_path
- Optional cache: raw_content column (nullable, for hot data)

R2 Path Convention:
  sec_filings/{symbol}/{form_type}/{fiscal_year}_{fiscal_period}.json
  Example: sec_filings/AAPL/10-Q/2023_Q1.json

FMP endpoint: ``/financial-reports-json`` for 10-Q (structured JSON)
              ``/sec_filings`` for 8-K (filing metadata)

Incremental strategy:
- 10-Q: Skip (year, quarter) combinations already present in sec_files.
- 8-K:  Use filing_date cursor to only fetch filings newer than last sync.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.core.database import async_session_factory
from app.models.alpha import SECFile
from app.services.storage import StorageService, UploadError, get_storage_service
from app.services.sync.datasets._shared import (
    as_list,
    clean_jsonb,
    dedupe,
    parse_date,
)
from app.services.sync.orchestrator import DatasetContext, DatasetResult
from app.services.sync.utils import content_hash, estimate_bytes
from app.utils.fmp_client import FMPResponseError, fmp_client

logger = logging.getLogger(__name__)


def _fmp_no_data(exc: BaseException) -> bool:
    return isinstance(exc, FMPResponseError) and "no data" in str(exc).lower()


def _build_r2_path(symbol: str, form_type: str, fiscal_year: int, fiscal_period: str) -> str:
    """
    Construct R2 storage path for a SEC filing.

    Format: sec_filings/{symbol}/{form_type}/{fiscal_year}_{fiscal_period}.json
    Example: sec_filings/AAPL/10-Q/2023_Q1.json
    """
    return f"sec_filings/{symbol}/{form_type}/{fiscal_year}_{fiscal_period}.json"


async def _get_existing_10q_periods(symbol: str) -> set[tuple[int, str]]:
    """Query sec_files for existing 10-Q periods to skip re-fetching."""
    async with async_session_factory() as session:
        stmt = (
            select(SECFile.fiscal_year, SECFile.fiscal_period)
            .where(SECFile.symbol == symbol, SECFile.form_type == "10-Q")
        )
        result = await session.execute(stmt)
        return {(row[0], row[1]) for row in result.all()}


async def run_10q(ctx: DatasetContext) -> DatasetResult:
    """Pull structured 10-Q JSON for the last N years, skipping existing periods.

    Cold-Hot Separation:
    1. Fetch JSON from FMP
    2. Upload to R2 (primary storage)
    3. Store metadata + storage_path in DB
    4. raw_content is NOT populated (cold storage only)
    """
    cfg = ctx.spec.config or {}
    years = int(cfg.get("years", 3))
    symbol = ctx.symbol

    cal_year = datetime.now(timezone.utc).year
    last_completed_fy = cal_year - 1
    year_list = list(range(last_completed_fy - years + 1, last_completed_fy + 1))

    # Incremental: skip (year, quarter) already in DB
    existing_periods = await _get_existing_10q_periods(symbol)

    # Get storage service (may not be configured)
    storage = get_storage_service()
    use_r2 = storage.is_configured

    if not use_r2:
        logger.warning(
            "R2 storage not configured - SEC filings will be stored in DB only. "
            "Set R2_ENDPOINT_URL, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY to enable cold storage."
        )

    rows: list[dict[str, Any]] = []
    digest_rows: list[dict[str, Any]] = []
    bytes_total = 0
    requests = 0
    skipped_periods = 0
    upload_errors = 0

    for year in year_list:
        for quarter in ("Q1", "Q2", "Q3"):
            # Skip if already present
            if (year, quarter) in existing_periods:
                skipped_periods += 1
                logger.debug("10-Q %s %s already in DB, skipping", year, quarter)
                continue

            try:
                payload = await fmp_client.get(
                    "/financial-reports-json",
                    params={"symbol": symbol, "year": year, "period": quarter},
                    timeout_read=120.0,
                )
                requests += 1
            except FMPResponseError as e:
                if _fmp_no_data(e):
                    continue
                raise
            except httpx.HTTPStatusError as e:
                if e.response.status_code == 404:
                    continue
                raise
            if not payload or (isinstance(payload, list) and len(payload) == 0):
                continue

            cleaned = clean_jsonb(payload)
            bytes_total += estimate_bytes(cleaned)
            digest_rows.append({"fiscal_year": year, "period": quarter, "digest": content_hash(cleaned)})

            # Build R2 path and upload
            r2_path = _build_r2_path(symbol, "10-Q", year, quarter)
            storage_path: str | None = None

            if use_r2:
                try:
                    storage_path = await storage.upload_json(r2_path, cleaned)
                    logger.info("Uploaded 10-Q to R2: %s", r2_path)
                except UploadError as e:
                    upload_errors += 1
                    logger.error("Failed to upload 10-Q to R2: %s - falling back to DB-only storage", e)
                    # Fall back to DB-only storage - still store the data
                    storage_path = None

            rows.append(
                {
                    "symbol": symbol,
                    "form_type": "10-Q",
                    "fiscal_year": year,
                    "fiscal_period": quarter,
                    "filing_date": None,
                    "storage_path": storage_path,
                    # Store raw_content only if R2 upload failed (fallback)
                    "raw_content": cleaned if storage_path is None else None,
                }
            )

    rows = dedupe(rows, ("symbol", "form_type", "fiscal_year", "fiscal_period"))
    payload_hash = content_hash(digest_rows)

    # If all periods were skipped or no new data, return early
    if not rows:
        return DatasetResult(
            requests_count=requests,
            bytes_estimated=bytes_total,
            content_hash=payload_hash,
            skipped_reason="unchanged" if skipped_periods > 0 else "empty",
            cursor_value=str(last_completed_fy),
            details={
                "rows": 0,
                "years": year_list,
                "skipped_periods": skipped_periods,
                "requests": requests,
                "r2_enabled": use_r2,
            },
        )

    if ctx.previous_state and ctx.previous_state.content_hash_last == payload_hash:
        return DatasetResult(
            requests_count=requests,
            bytes_estimated=bytes_total,
            content_hash=payload_hash,
            skipped_reason="unchanged",
            cursor_value=str(last_completed_fy),
            details={"rows": len(rows), "years": year_list},
        )

    # Batch upsert to DB
    async with async_session_factory() as session:
        for row in rows:
            stmt = pg_insert(SECFile).values(row)
            stmt = stmt.on_conflict_do_update(
                constraint="uq_sec_file",
                set_={
                    "storage_path": stmt.excluded.storage_path,
                    "raw_content": stmt.excluded.raw_content,
                    "filing_date": stmt.excluded.filing_date,
                },
            )
            await session.execute(stmt)
        await session.commit()

    return DatasetResult(
        records_written=len(rows),
        requests_count=requests,
        bytes_estimated=bytes_total,
        content_hash=payload_hash,
        cursor_value=str(last_completed_fy),
        details={
            "rows_upserted": len(rows),
            "years": year_list,
            "skipped_periods": skipped_periods,
            "r2_enabled": use_r2,
            "r2_uploads": len(rows) - upload_errors,
            "r2_errors": upload_errors,
        },
    )


async def _get_max_8k_filing_date(symbol: str) -> date | None:
    """Query sec_files for the most recent 8-K filing_date."""
    async with async_session_factory() as session:
        stmt = (
            select(SECFile.filing_date)
            .where(SECFile.symbol == symbol, SECFile.form_type == "8-K")
            .order_by(SECFile.filing_date.desc())
            .limit(1)
        )
        result = await session.execute(stmt)
        return result.scalar_one_or_none()


async def run_8k(ctx: DatasetContext) -> DatasetResult:
    """Pull 8-K filing metadata via ``/sec_filings`` with incremental date filter.

    Cold-Hot Separation:
    1. Fetch JSON from FMP
    2. Upload to R2 (primary storage)
    3. Store metadata + storage_path in DB
    """
    cfg = ctx.spec.config or {}
    symbol = ctx.symbol
    limit = int(cfg.get("limit", 200))

    # Incremental: only fetch filings after the most recent one we have
    max_existing_date = await _get_max_8k_filing_date(symbol)
    from_date = max_existing_date + timedelta(days=1) if max_existing_date else None

    params: dict[str, Any] = {"symbol": symbol, "type": "8-K", "limit": limit}
    if from_date:
        params["from"] = from_date.isoformat()

    try:
        payload = await fmp_client.get("/sec_filings", params=params)
    except httpx.HTTPStatusError as exc:
        if exc.response is not None and exc.response.status_code == 404:
            return DatasetResult(
                requests_count=1,
                bytes_estimated=0,
                content_hash=content_hash([]),
                skipped_reason="empty",
                details={
                    "payload_entries": 0,
                    "from_date": str(from_date) if from_date else None,
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
            skipped_reason="empty",
            details={"payload_entries": 0, "from_date": str(from_date) if from_date else None},
        )

    if ctx.previous_state and ctx.previous_state.content_hash_last == payload_hash:
        return DatasetResult(
            requests_count=1,
            bytes_estimated=bytes_estimated,
            content_hash=payload_hash,
            skipped_reason="unchanged",
            details={"payload_entries": len(entries)},
        )

    # Get storage service
    storage = get_storage_service()
    use_r2 = storage.is_configured

    if not use_r2:
        logger.warning(
            "R2 storage not configured - SEC filings will be stored in DB only. "
            "Set R2_ENDPOINT_URL, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY to enable cold storage."
        )

    rows: list[dict[str, Any]] = []
    max_filing_date: date | None = None
    upload_errors = 0

    for entry in entries:
        filing_date = parse_date(entry.get("fillingDate") or entry.get("filingDate"))
        if filing_date is None:
            continue
        if max_filing_date is None or filing_date > max_filing_date:
            max_filing_date = filing_date

        # Derive a fiscal year from the filing date (best effort for 8-K).
        fy = filing_date.year
        # Build a pseudo fiscal_period from the filing date for uniqueness.
        fp = filing_date.isoformat()

        cleaned = clean_jsonb(entry)

        # Build R2 path and upload
        r2_path = _build_r2_path(symbol, "8-K", fy, fp)
        storage_path: str | None = None

        if use_r2:
            try:
                storage_path = await storage.upload_json(r2_path, cleaned)
                logger.debug("Uploaded 8-K to R2: %s", r2_path)
            except UploadError as e:
                upload_errors += 1
                logger.error("Failed to upload 8-K to R2: %s - falling back to DB-only storage", e)

        rows.append(
            {
                "symbol": symbol,
                "form_type": "8-K",
                "fiscal_year": fy,
                "fiscal_period": fp,
                "filing_date": filing_date,
                "storage_path": storage_path,
                # Store raw_content only if R2 upload failed (fallback)
                "raw_content": cleaned if storage_path is None else None,
            }
        )

    rows = dedupe(rows, ("symbol", "form_type", "fiscal_year", "fiscal_period"))

    if rows:
        async with async_session_factory() as session:
            for row in rows:
                stmt = pg_insert(SECFile).values(row)
                stmt = stmt.on_conflict_do_update(
                    constraint="uq_sec_file",
                    set_={
                        "storage_path": stmt.excluded.storage_path,
                        "raw_content": stmt.excluded.raw_content,
                        "filing_date": stmt.excluded.filing_date,
                    },
                )
                await session.execute(stmt)
            await session.commit()

    return DatasetResult(
        records_written=len(rows),
        requests_count=1,
        bytes_estimated=bytes_estimated,
        content_hash=payload_hash,
        cursor_date=max_filing_date,
        details={
            "rows_upserted": len(rows),
            "payload_entries": len(entries),
            "from_date": str(from_date) if from_date else None,
            "r2_enabled": use_r2,
            "r2_uploads": len(rows) - upload_errors,
            "r2_errors": upload_errors,
        },
    )
