"""Symbol-level alpha/text datasets: insider, analyst, SEC filings."""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

import httpx
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.core.database import async_session_factory
from app.models.alpha import (
    AnalystEstimate,
    CompanyPressRelease,
    InsiderTrade,
    SECFile,
    StockNews,
)
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
from app.utils.fmp_client import FMPResponseError, fmp_client


def _parse_datetime(v: Any) -> datetime | None:
    if v is None:
        return None
    if isinstance(v, datetime):
        return v
    if not isinstance(v, str):
        return None
    for fmt, trim in (
        ("%Y-%m-%d %H:%M:%S", 19),
        ("%Y-%m-%dT%H:%M:%S", 19),
        ("%Y-%m-%d", 10),
    ):
        try:
            return datetime.strptime(v[:trim], fmt)
        except (TypeError, ValueError):
            continue
    return None


def _sec_fmp_error_is_missing_filing(exc: BaseException) -> bool:
    return isinstance(exc, FMPResponseError) and "no data" in str(exc).lower()


async def run_insider_trades(ctx: DatasetContext) -> DatasetResult:
    cfg = ctx.spec.config or {}
    max_pages = int(cfg.get("max_pages", 5))
    symbol = ctx.symbol

    all_entries: list[dict[str, Any]] = []
    requests = 0
    for page in range(max_pages):
        data = await fmp_client.get(
            "/insider-trading/search",
            params={"symbol": symbol, "page": page, "limit": 100},
        )
        requests += 1
        rows = as_list(data)
        if not rows:
            break
        all_entries.extend(rows)
        if len(rows) < 100:
            break

    payload_hash = content_hash(all_entries)
    bytes_estimated = estimate_bytes(all_entries)
    if ctx.previous_state and ctx.previous_state.content_hash_last == payload_hash:
        return DatasetResult(
            requests_count=requests,
            bytes_estimated=bytes_estimated,
            content_hash=payload_hash,
            skipped_reason="unchanged",
            details={"payload_entries": len(all_entries)},
        )

    db_rows: list[dict[str, Any]] = []
    for e in all_entries:
        db_rows.append(
            {
                "symbol": symbol,
                "filing_date": _parse_datetime(e.get("filingDate")),
                "transaction_date": parse_date(e.get("transactionDate")),
                "reporting_cik": str(e.get("reportingCik") or "") or None,
                "reporting_name": e.get("reportingName"),
                "transaction_type": e.get("transactionType"),
                "securities_transacted": safe_float(e.get("securitiesTransacted")),
                "price": safe_float(e.get("price")),
                "raw_payload": clean_jsonb(e),
            }
        )
    db_rows = dedupe(
        db_rows,
        (
            "symbol",
            "filing_date",
            "transaction_date",
            "reporting_cik",
            "transaction_type",
            "securities_transacted",
        ),
    )
    if db_rows:
        async with async_session_factory() as session:
            for chunk in chunks(db_rows, BULK_CHUNK):
                stmt = pg_insert(InsiderTrade).values(list(chunk))
                stmt = stmt.on_conflict_do_update(
                    constraint="uq_insider_trade",
                    set_={
                        "reporting_name": stmt.excluded.reporting_name,
                        "transaction_type": stmt.excluded.transaction_type,
                        "price": stmt.excluded.price,
                        "raw_payload": stmt.excluded.raw_payload,
                    },
                )
                await session.execute(stmt)
            await session.commit()
    return DatasetResult(
        records_written=len(db_rows),
        requests_count=requests,
        bytes_estimated=bytes_estimated,
        content_hash=payload_hash,
        details={"payload_entries": len(all_entries), "rows_upserted": len(db_rows)},
    )


async def run_analyst_estimates(ctx: DatasetContext) -> DatasetResult:
    symbol = ctx.symbol
    rows: list[dict[str, Any]] = []

    consensus = await fmp_client.get(
        "/analyst-estimates",
        params={"symbol": symbol, "period": "annual", "page": 0, "limit": 120},
    )
    consensus_rows = as_list(consensus)
    for e in consensus_rows:
        d = parse_date(e.get("date"))
        if d is None:
            continue
        rows.append(
            {
                "symbol": symbol,
                "kind": "consensus_annual",
                "ref_date": d,
                "published_date": None,
                "raw_payload": clean_jsonb(e),
            }
        )

    pt = await fmp_client.get("/price-target-consensus", params={"symbol": symbol})
    pt_payload = as_list(pt)
    pt_item = pt_payload[0] if pt_payload else (pt if isinstance(pt, dict) else None)
    if pt_item:
        rows.append(
            {
                "symbol": symbol,
                "kind": "price_target_consensus",
                "ref_date": None,
                "published_date": datetime.now(timezone.utc).date(),
                "raw_payload": clean_jsonb(pt_item),
            }
        )

    rows = dedupe(rows, ("symbol", "kind", "ref_date", "published_date"))
    payload_hash = content_hash(rows)
    bytes_estimated = estimate_bytes(rows)
    if ctx.previous_state and ctx.previous_state.content_hash_last == payload_hash:
        return DatasetResult(
            requests_count=2,
            bytes_estimated=bytes_estimated,
            content_hash=payload_hash,
            skipped_reason="unchanged",
            details={"rows": len(rows)},
        )
    if rows:
        async with async_session_factory() as session:
            stmt = pg_insert(AnalystEstimate).values(rows)
            stmt = stmt.on_conflict_do_update(
                constraint="uq_analyst_estimate",
                set_={"raw_payload": stmt.excluded.raw_payload},
            )
            await session.execute(stmt)
            await session.commit()
    return DatasetResult(
        records_written=len(rows),
        requests_count=2,
        bytes_estimated=bytes_estimated,
        content_hash=payload_hash,
        details={"rows_upserted": len(rows)},
    )


async def run_sec_filings(ctx: DatasetContext) -> DatasetResult:
    cfg = ctx.spec.config or {}
    years = int(cfg.get("years", 5))
    form_type = str(cfg.get("form_type", "10-K"))
    symbol = ctx.symbol

    cal_year = datetime.now(timezone.utc).year
    last_completed_fy = cal_year - 1
    year_list = list(range(last_completed_fy - years + 1, last_completed_fy + 1))

    rows: list[dict[str, Any]] = []
    digest_rows: list[dict[str, Any]] = []
    bytes_estimated_total = 0
    requests = 0
    for year in year_list:
        try:
            payload = await fmp_client.get(
                "/financial-reports-json",
                params={"symbol": symbol, "year": year, "period": "FY"},
                timeout_read=120.0,
            )
            requests += 1
        except FMPResponseError as e:
            if _sec_fmp_error_is_missing_filing(e):
                continue
            raise
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                continue
            raise
        if not payload or (isinstance(payload, list) and len(payload) == 0):
            continue
        cleaned = clean_jsonb(payload)
        bytes_estimated_total += estimate_bytes(cleaned)
        # Keep hash payload compact but still content-sensitive.
        digest_rows.append(
            {
                "fiscal_year": year,
                "digest": content_hash(cleaned),
            }
        )
        rows.append(
            {
                "symbol": symbol,
                "form_type": form_type,
                "fiscal_year": year,
                "fiscal_period": "FY",
                "filing_date": None,
                "raw_content": cleaned,
            }
        )
    rows = dedupe(rows, ("symbol", "form_type", "fiscal_year", "fiscal_period"))
    payload_hash = content_hash(digest_rows)
    bytes_estimated = bytes_estimated_total
    if ctx.previous_state and ctx.previous_state.content_hash_last == payload_hash:
        return DatasetResult(
            requests_count=requests,
            bytes_estimated=bytes_estimated,
            content_hash=payload_hash,
            skipped_reason="unchanged",
            cursor_value=str(max((r["fiscal_year"] for r in rows), default=last_completed_fy)),
            details={"rows": len(rows), "years": year_list},
        )
    if rows:
        async with async_session_factory() as session:
            for row in rows:
                stmt = pg_insert(SECFile).values(row)
                stmt = stmt.on_conflict_do_update(
                    constraint="uq_sec_file",
                    set_={
                        "raw_content": stmt.excluded.raw_content,
                        "filing_date": stmt.excluded.filing_date,
                    },
                )
                await session.execute(stmt)
            await session.commit()
    return DatasetResult(
        records_written=len(rows),
        requests_count=requests,
        bytes_estimated=bytes_estimated,
        content_hash=payload_hash,
        cursor_value=str(max((r["fiscal_year"] for r in rows), default=last_completed_fy)),
        details={"rows_upserted": len(rows), "years": year_list},
    )


async def run_stock_news(ctx: DatasetContext) -> DatasetResult:
    cfg = ctx.spec.config or {}
    symbol = ctx.symbol
    limit = int(cfg.get("limit", 200))
    payload = await fmp_client.get("/stock-news", params={"symbol": symbol, "limit": limit})
    entries = as_list(payload)
    payload_hash = content_hash(entries)
    bytes_estimated = estimate_bytes(entries)

    if ctx.previous_state and ctx.previous_state.content_hash_last == payload_hash:
        return DatasetResult(
            requests_count=1,
            bytes_estimated=bytes_estimated,
            content_hash=payload_hash,
            skipped_reason="unchanged",
            details={"payload_entries": len(entries)},
        )

    rows: list[dict[str, Any]] = []
    max_published: datetime | None = None
    for item in entries:
        published_dt = _parse_datetime(item.get("publishedDate") or item.get("publishedDateTime"))
        if published_dt is not None and (max_published is None or published_dt > max_published):
            max_published = published_dt
        rows.append(
            {
                "symbol": symbol,
                "published_date": published_dt,
                "title": item.get("title"),
                "site": item.get("site"),
                "url": item.get("url"),
                "raw_payload": clean_jsonb(item),
            }
        )
    rows = dedupe(rows, ("symbol", "published_date", "url"))
    if rows:
        async with async_session_factory() as session:
            for chunk in chunks(rows, BULK_CHUNK):
                stmt = pg_insert(StockNews).values(list(chunk))
                stmt = stmt.on_conflict_do_update(
                    constraint="uq_stock_news",
                    set_={
                        "title": stmt.excluded.title,
                        "site": stmt.excluded.site,
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
        cursor_value=max_published.isoformat() if max_published else ctx.previous_cursor_value,
        details={"rows_upserted": len(rows), "payload_entries": len(entries)},
    )


async def run_press_releases(ctx: DatasetContext) -> DatasetResult:
    cfg = ctx.spec.config or {}
    symbol = ctx.symbol
    limit = int(cfg.get("limit", 200))
    payload = await fmp_client.get("/press-releases", params={"symbol": symbol, "limit": limit})
    entries = as_list(payload)
    payload_hash = content_hash(entries)
    bytes_estimated = estimate_bytes(entries)

    if ctx.previous_state and ctx.previous_state.content_hash_last == payload_hash:
        return DatasetResult(
            requests_count=1,
            bytes_estimated=bytes_estimated,
            content_hash=payload_hash,
            skipped_reason="unchanged",
            details={"payload_entries": len(entries)},
        )

    rows: list[dict[str, Any]] = []
    max_published: datetime | None = None
    for item in entries:
        published_dt = _parse_datetime(item.get("publishedDate") or item.get("publishedDateTime"))
        if published_dt is not None and (max_published is None or published_dt > max_published):
            max_published = published_dt
        rows.append(
            {
                "symbol": symbol,
                "published_date": published_dt,
                "title": item.get("title"),
                "site": item.get("site"),
                "url": item.get("url"),
                "raw_payload": clean_jsonb(item),
            }
        )
    rows = dedupe(rows, ("symbol", "published_date", "url"))
    if rows:
        async with async_session_factory() as session:
            for chunk in chunks(rows, BULK_CHUNK):
                stmt = pg_insert(CompanyPressRelease).values(list(chunk))
                stmt = stmt.on_conflict_do_update(
                    constraint="uq_company_press_release",
                    set_={
                        "title": stmt.excluded.title,
                        "site": stmt.excluded.site,
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
        cursor_value=max_published.isoformat() if max_published else ctx.previous_cursor_value,
        details={"rows_upserted": len(rows), "payload_entries": len(entries)},
    )

