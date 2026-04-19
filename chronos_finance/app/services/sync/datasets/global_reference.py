"""Global dataset handlers: calendars, treasury rates, macro catalog."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.core.database import async_session_factory
from app.models.macro import MacroEconomic, MacroSeriesCatalog, TreasuryRateWide
from app.models.market import (
    DividendCalendarGlobal,
    EconomicCalendar,
    IPOCalendar,
    SplitCalendarGlobal,
)
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

ECONOMIC_UPSERT_CHUNK = 3000


def _window(cfg: dict[str, Any]) -> tuple[date, date]:
    today = date.today()
    lookback_days = int(cfg.get("lookback_days", 14))
    lookahead_days = int(cfg.get("lookahead_days", 120))
    return today - timedelta(days=lookback_days), today + timedelta(days=lookahead_days)


async def run_dividends_calendar(ctx: DatasetContext) -> DatasetResult:
    cfg = ctx.spec.config or {}
    endpoint = cfg.get("endpoint", "/dividends-calendar")
    date_from, date_to = _window(cfg)
    payload = await fmp_client.get(
        endpoint, params={"from": date_from.isoformat(), "to": date_to.isoformat()}
    )
    entries = as_list(payload)
    payload_hash = content_hash(entries)
    bytes_estimated = estimate_bytes(entries)

    rows: list[dict[str, Any]] = []
    max_seen: date | None = None
    for item in entries:
        d = parse_date(item.get("date"))
        sym = item.get("symbol")
        if not d or not sym:
            continue
        max_seen = d if max_seen is None or d > max_seen else max_seen
        rows.append(
            {
                "symbol": str(sym).upper(),
                "date": d,
                "dividend": safe_float(item.get("dividend")),
                "adjusted_dividend": safe_float(item.get("adjDividend")),
                "record_date": parse_date(item.get("recordDate")) or d,
                "payment_date": parse_date(item.get("paymentDate")) or d,
                # Some FMP rows omit declarationDate; fallback avoids hard DB failures.
                "declaration_date": parse_date(item.get("declarationDate")) or d,
                "raw_payload": clean_jsonb(item),
            }
        )
    rows = dedupe(rows, ("symbol", "date"))
    if ctx.previous_state and ctx.previous_state.content_hash_last == payload_hash:
        return DatasetResult(
            bytes_estimated=bytes_estimated,
            requests_count=1,
            cursor_date=max_seen,
            content_hash=payload_hash,
            skipped_reason="unchanged",
            details={"payload_entries": len(entries)},
        )
    if rows:
        async with async_session_factory() as session:
            for chunk in chunks(rows, BULK_CHUNK):
                stmt = pg_insert(DividendCalendarGlobal).values(list(chunk))
                stmt = stmt.on_conflict_do_update(
                    index_elements=["symbol", "date"],
                    set_={
                        "dividend": stmt.excluded.dividend,
                        "adjusted_dividend": stmt.excluded.adjusted_dividend,
                        "record_date": stmt.excluded.record_date,
                        "payment_date": stmt.excluded.payment_date,
                        "declaration_date": stmt.excluded.declaration_date,
                        "raw_payload": stmt.excluded.raw_payload,
                    },
                )
                await session.execute(stmt)
            await session.commit()
    return DatasetResult(
        records_written=len(rows),
        bytes_estimated=bytes_estimated,
        requests_count=1,
        cursor_date=max_seen,
        content_hash=payload_hash,
        details={"payload_entries": len(entries), "rows_upserted": len(rows)},
    )


async def run_splits_calendar(ctx: DatasetContext) -> DatasetResult:
    cfg = ctx.spec.config or {}
    endpoint = cfg.get("endpoint", "/splits-calendar")
    date_from, date_to = _window(cfg)
    payload = await fmp_client.get(
        endpoint, params={"from": date_from.isoformat(), "to": date_to.isoformat()}
    )
    entries = as_list(payload)
    payload_hash = content_hash(entries)
    bytes_estimated = estimate_bytes(entries)

    rows: list[dict[str, Any]] = []
    max_seen: date | None = None
    for item in entries:
        d = parse_date(item.get("date"))
        sym = item.get("symbol")
        if not d or not sym:
            continue
        max_seen = d if max_seen is None or d > max_seen else max_seen
        rows.append(
            {
                "symbol": str(sym).upper(),
                "date": d,
                "numerator": safe_float(item.get("numerator")),
                "denominator": safe_float(item.get("denominator")),
                "raw_payload": clean_jsonb(item),
            }
        )
    rows = dedupe(rows, ("symbol", "date"))
    if ctx.previous_state and ctx.previous_state.content_hash_last == payload_hash:
        return DatasetResult(
            bytes_estimated=bytes_estimated,
            requests_count=1,
            cursor_date=max_seen,
            content_hash=payload_hash,
            skipped_reason="unchanged",
            details={"payload_entries": len(entries)},
        )
    if rows:
        async with async_session_factory() as session:
            for chunk in chunks(rows, BULK_CHUNK):
                stmt = pg_insert(SplitCalendarGlobal).values(list(chunk))
                stmt = stmt.on_conflict_do_update(
                    index_elements=["symbol", "date"],
                    set_={
                        "numerator": stmt.excluded.numerator,
                        "denominator": stmt.excluded.denominator,
                        "raw_payload": stmt.excluded.raw_payload,
                    },
                )
                await session.execute(stmt)
            await session.commit()
    return DatasetResult(
        records_written=len(rows),
        bytes_estimated=bytes_estimated,
        requests_count=1,
        cursor_date=max_seen,
        content_hash=payload_hash,
        details={"payload_entries": len(entries), "rows_upserted": len(rows)},
    )


async def run_ipos_calendar(ctx: DatasetContext) -> DatasetResult:
    cfg = ctx.spec.config or {}
    endpoint = cfg.get("endpoint", "/ipos-calendar")
    date_from, date_to = _window(cfg)
    payload = await fmp_client.get(
        endpoint, params={"from": date_from.isoformat(), "to": date_to.isoformat()}
    )
    entries = as_list(payload)
    payload_hash = content_hash(entries)
    bytes_estimated = estimate_bytes(entries)

    rows: list[dict[str, Any]] = []
    max_seen: date | None = None
    for item in entries:
        d = parse_date(item.get("date"))
        sym = item.get("symbol")
        if not d or not sym:
            continue
        max_seen = d if max_seen is None or d > max_seen else max_seen
        rows.append(
            {
                "symbol": str(sym).upper(),
                "date": d,
                "company_name": item.get("company") or item.get("companyName"),
                "exchange": item.get("exchange"),
                "price_range": item.get("priceRange"),
                "shares": safe_int(item.get("shares")),
                "raw_payload": clean_jsonb(item),
            }
        )
    rows = dedupe(rows, ("symbol", "date"))
    if ctx.previous_state and ctx.previous_state.content_hash_last == payload_hash:
        return DatasetResult(
            bytes_estimated=bytes_estimated,
            requests_count=1,
            cursor_date=max_seen,
            content_hash=payload_hash,
            skipped_reason="unchanged",
            details={"payload_entries": len(entries)},
        )
    if rows:
        async with async_session_factory() as session:
            for chunk in chunks(rows, BULK_CHUNK):
                stmt = pg_insert(IPOCalendar).values(list(chunk))
                stmt = stmt.on_conflict_do_update(
                    index_elements=["symbol", "date"],
                    set_={
                        "company_name": stmt.excluded.company_name,
                        "exchange": stmt.excluded.exchange,
                        "price_range": stmt.excluded.price_range,
                        "shares": stmt.excluded.shares,
                        "raw_payload": stmt.excluded.raw_payload,
                    },
                )
                await session.execute(stmt)
            await session.commit()
    return DatasetResult(
        records_written=len(rows),
        bytes_estimated=bytes_estimated,
        requests_count=1,
        cursor_date=max_seen,
        content_hash=payload_hash,
        details={"payload_entries": len(entries), "rows_upserted": len(rows)},
    )


async def run_economic_calendar(ctx: DatasetContext) -> DatasetResult:
    cfg = ctx.spec.config or {}
    endpoint = cfg.get("endpoint", "/economic-calendar")
    date_from, date_to = _window(cfg)
    payload = await fmp_client.get(
        endpoint, params={"from": date_from.isoformat(), "to": date_to.isoformat()}
    )
    entries = as_list(payload)
    payload_hash = content_hash(entries)
    bytes_estimated = estimate_bytes(entries)

    rows: list[dict[str, Any]] = []
    max_seen: date | None = None
    for item in entries:
        d = parse_date(item.get("date"))
        event = item.get("event")
        if not d or not event:
            continue
        country = str(item.get("country") or "")
        currency = str(item.get("currency") or "")
        max_seen = d if max_seen is None or d > max_seen else max_seen
        rows.append(
            {
                "date": d,
                "event": str(event),
                "country": country,
                "currency": currency,
                "actual": str(item.get("actual")) if item.get("actual") is not None else None,
                "previous": str(item.get("previous")) if item.get("previous") is not None else None,
                "estimate": str(item.get("estimate")) if item.get("estimate") is not None else None,
                "raw_payload": clean_jsonb(item),
            }
        )
    rows = dedupe(rows, ("date", "event", "country", "currency"))
    if ctx.previous_state and ctx.previous_state.content_hash_last == payload_hash:
        return DatasetResult(
            bytes_estimated=bytes_estimated,
            requests_count=1,
            cursor_date=max_seen,
            content_hash=payload_hash,
            skipped_reason="unchanged",
            details={"payload_entries": len(entries)},
        )
    if rows:
        async with async_session_factory() as session:
            # economic_calendar has many columns; keep chunk below asyncpg's arg cap.
            for chunk in chunks(rows, ECONOMIC_UPSERT_CHUNK):
                stmt = pg_insert(EconomicCalendar).values(list(chunk))
                stmt = stmt.on_conflict_do_update(
                    index_elements=["date", "event", "country", "currency"],
                    set_={
                        "actual": stmt.excluded.actual,
                        "previous": stmt.excluded.previous,
                        "estimate": stmt.excluded.estimate,
                        "raw_payload": stmt.excluded.raw_payload,
                    },
                )
                await session.execute(stmt)
            await session.commit()
    return DatasetResult(
        records_written=len(rows),
        bytes_estimated=bytes_estimated,
        requests_count=1,
        cursor_date=max_seen,
        content_hash=payload_hash,
        details={"payload_entries": len(entries), "rows_upserted": len(rows)},
    )


async def run_treasury_rates(ctx: DatasetContext) -> DatasetResult:
    cfg = ctx.spec.config or {}
    endpoint = cfg.get("endpoint", "/treasury-rates")
    payload = await fmp_client.get(endpoint)
    entries = as_list(payload)
    payload_hash = content_hash(entries)
    bytes_estimated = estimate_bytes(entries)

    rows: list[dict[str, Any]] = []
    max_seen: date | None = None
    for item in entries:
        d = parse_date(item.get("date"))
        if not d:
            continue
        max_seen = d if max_seen is None or d > max_seen else max_seen
        rows.append(
            {
                "date": d,
                "month1": safe_float(item.get("month1")),
                "month2": safe_float(item.get("month2")),
                "month3": safe_float(item.get("month3")),
                "month6": safe_float(item.get("month6")),
                "year1": safe_float(item.get("year1")),
                "year2": safe_float(item.get("year2")),
                "year3": safe_float(item.get("year3")),
                "year5": safe_float(item.get("year5")),
                "year7": safe_float(item.get("year7")),
                "year10": safe_float(item.get("year10")),
                "year20": safe_float(item.get("year20")),
                "year30": safe_float(item.get("year30")),
                "raw_payload": clean_jsonb(item),
            }
        )
    rows = dedupe(rows, ("date",))
    if ctx.previous_state and ctx.previous_state.content_hash_last == payload_hash:
        return DatasetResult(
            bytes_estimated=bytes_estimated,
            requests_count=1,
            cursor_date=max_seen,
            content_hash=payload_hash,
            skipped_reason="unchanged",
            details={"payload_entries": len(entries)},
        )
    if rows:
        async with async_session_factory() as session:
            for chunk in chunks(rows, BULK_CHUNK):
                stmt = pg_insert(TreasuryRateWide).values(list(chunk))
                stmt = stmt.on_conflict_do_update(
                    index_elements=["date"],
                    set_={
                        "month1": stmt.excluded.month1,
                        "month2": stmt.excluded.month2,
                        "month3": stmt.excluded.month3,
                        "month6": stmt.excluded.month6,
                        "year1": stmt.excluded.year1,
                        "year2": stmt.excluded.year2,
                        "year3": stmt.excluded.year3,
                        "year5": stmt.excluded.year5,
                        "year7": stmt.excluded.year7,
                        "year10": stmt.excluded.year10,
                        "year20": stmt.excluded.year20,
                        "year30": stmt.excluded.year30,
                        "raw_payload": stmt.excluded.raw_payload,
                    },
                )
                await session.execute(stmt)
            await session.commit()
    return DatasetResult(
        records_written=len(rows),
        bytes_estimated=bytes_estimated,
        requests_count=1,
        cursor_date=max_seen,
        content_hash=payload_hash,
        details={"payload_entries": len(entries), "rows_upserted": len(rows)},
    )


async def run_macro_series_catalog(ctx: DatasetContext) -> DatasetResult:
    cfg = ctx.spec.config or {}
    series = cfg.get("series")
    if not isinstance(series, list):
        series = []
    rows = [
        {
            "series_id": str(item.get("series_id")),
            "display_name": item.get("display_name"),
            "category": item.get("category"),
            "source": item.get("source") or "FMP",
            "frequency": item.get("frequency"),
            "unit": item.get("unit"),
            "raw_payload": clean_jsonb(item),
        }
        for item in series
        if item.get("series_id")
    ]
    rows = dedupe(rows, ("series_id",))
    payload_hash = content_hash(rows)
    if ctx.previous_state and ctx.previous_state.content_hash_last == payload_hash:
        return DatasetResult(
            requests_count=0,
            content_hash=payload_hash,
            skipped_reason="unchanged",
            details={"rows": len(rows)},
        )
    if rows:
        async with async_session_factory() as session:
            stmt = pg_insert(MacroSeriesCatalog).values(rows)
            stmt = stmt.on_conflict_do_update(
                index_elements=["series_id"],
                set_={
                    "display_name": stmt.excluded.display_name,
                    "category": stmt.excluded.category,
                    "source": stmt.excluded.source,
                    "frequency": stmt.excluded.frequency,
                    "unit": stmt.excluded.unit,
                    "raw_payload": stmt.excluded.raw_payload,
                },
            )
            await session.execute(stmt)
            await session.commit()
    return DatasetResult(
        records_written=len(rows),
        requests_count=0,
        bytes_estimated=estimate_bytes(rows),
        content_hash=payload_hash,
        details={"rows": len(rows)},
    )


async def run_macro_economics(ctx: DatasetContext) -> DatasetResult:
    """
    Pull configured macro series from /economic-indicators and upsert into
    macro_economics. The tracker uses cursor_date=max(date) across all series.
    """
    cfg = ctx.spec.config or {}
    series = cfg.get("series")
    if not isinstance(series, list):
        series = []

    total_rows: list[dict[str, Any]] = []
    requests = 0
    for sid in [str(s) for s in series if s]:
        payload = await fmp_client.get("/economic-indicators", params={"name": sid})
        requests += 1
        entries = as_list(payload)
        for item in entries:
            d = parse_date(item.get("date"))
            if not d:
                continue
            total_rows.append(
                {
                    "series_id": sid,
                    "date": d,
                    "value": safe_float(item.get("value")),
                    "raw_payload": clean_jsonb(item),
                }
            )
    rows = dedupe(total_rows, ("series_id", "date"))
    rows_hash = content_hash(rows)
    if ctx.previous_state and ctx.previous_state.content_hash_last == rows_hash:
        return DatasetResult(
            requests_count=requests,
            bytes_estimated=estimate_bytes(rows),
            content_hash=rows_hash,
            cursor_date=max((r["date"] for r in rows), default=None),
            skipped_reason="unchanged",
            details={"rows": len(rows), "series_count": len(series)},
        )
    if rows:
        async with async_session_factory() as session:
            for chunk in chunks(rows, BULK_CHUNK):
                stmt = pg_insert(MacroEconomic).values(list(chunk))
                stmt = stmt.on_conflict_do_update(
                    index_elements=["series_id", "date"],
                    set_={
                        "value": stmt.excluded.value,
                        "raw_payload": stmt.excluded.raw_payload,
                    },
                )
                await session.execute(stmt)
            await session.commit()
    return DatasetResult(
        records_written=len(rows),
        requests_count=requests,
        bytes_estimated=estimate_bytes(rows),
        content_hash=rows_hash,
        cursor_date=max((r["date"] for r in rows), default=None),
        details={"rows": len(rows), "series_count": len(series)},
    )
