"""Symbol financial datasets stored in ``static_financials``."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.core.database import async_session_factory
from app.models.static_financials import StaticFinancials
from app.services.sync.datasets._shared import as_list, clean_jsonb, dedupe
from app.services.sync.orchestrator import DatasetContext, DatasetResult
from app.services.sync.utils import content_hash, estimate_bytes
from app.utils.fmp_client import fmp_client


def _extract_fiscal_year(row: dict[str, Any]) -> int | None:
    cy = row.get("calendarYear")
    if cy is not None:
        try:
            return int(cy)
        except (TypeError, ValueError):
            pass
    d = row.get("date")
    if isinstance(d, str) and len(d) >= 4 and d[:4].isdigit():
        return int(d[:4])
    return None


def _extract_fiscal_quarter(row: dict[str, Any]) -> int | None:
    p = row.get("period")
    if isinstance(p, str) and p.startswith("Q") and p[1:].isdigit():
        return int(p[1:])
    return None


def _current_year() -> int:
    return datetime.now(timezone.utc).year


def _year_field(row: dict[str, Any]) -> int | None:
    y = row.get("year")
    if isinstance(y, int):
        return y
    if isinstance(y, str):
        try:
            return int(y)
        except ValueError:
            return None
    return None


def _segmentation_rows(data: Any) -> list[dict[str, Any]]:
    if not isinstance(data, list):
        return []
    out: list[dict[str, Any]] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        nested = item.get("data")
        if isinstance(nested, dict) and nested:
            fy = item.get("fiscalYear")
            try:
                fy = int(fy) if fy is not None else None
            except (TypeError, ValueError):
                fy = None
            out.append(
                {
                    "date": item.get("date"),
                    "calendarYear": fy,
                    "segments": nested,
                }
            )
            continue
        for k, v in item.items():
            if not isinstance(v, dict):
                continue
            if k in {"symbol", "fiscalYear", "period", "reportedCurrency", "date", "data"}:
                continue
            out.append({"date": k, "segments": v})
    return out


async def _run_static_category(
    ctx: DatasetContext,
    *,
    endpoint: str,
    params: dict[str, Any],
    data_category: str,
    period: str,
    snapshot_year: bool = False,
) -> DatasetResult:
    symbol = ctx.symbol
    request_params = {"symbol": symbol, **params}
    payload = await fmp_client.get(endpoint, params=request_params)
    entries = as_list(payload)
    payload_hash = content_hash(entries)
    bytes_estimated = estimate_bytes(entries)

    if ctx.previous_state and ctx.previous_state.content_hash_last == payload_hash:
        return DatasetResult(
            requests_count=1,
            bytes_estimated=bytes_estimated,
            content_hash=payload_hash,
            cursor_value=ctx.previous_cursor_value,
            skipped_reason="unchanged",
            details={"payload_entries": len(entries), "category": data_category},
        )

    rows: list[dict[str, Any]] = []
    max_year: int | None = None
    year = _current_year()
    quarter = None

    if snapshot_year and len(entries) > 1:
        # Multiple entries share the same fiscal_year in snapshot mode.
        # Merge them into a single JSON array to avoid dedupe dropping data.
        rows = [
            {
                "symbol": symbol,
                "data_category": data_category,
                "period": period,
                "fiscal_year": year,
                "fiscal_quarter": quarter,
                "raw_payload": clean_jsonb(entries),
            }
        ]
        max_year = year
    else:
        for row in entries:
            if snapshot_year:
                fy = year
                fq = quarter
            else:
                fy = _extract_fiscal_year(row)
                fq = _extract_fiscal_quarter(row)
            if fy is None:
                continue
            max_year = fy if max_year is None or fy > max_year else max_year
            rows.append(
                {
                    "symbol": symbol,
                    "data_category": data_category,
                    "period": period,
                    "fiscal_year": fy,
                    "fiscal_quarter": fq,
                    "raw_payload": clean_jsonb(row),
                }
            )
    rows = dedupe(rows, ("symbol", "data_category", "period", "fiscal_year"))

    if rows:
        async with async_session_factory() as session:
            stmt = pg_insert(StaticFinancials).values(rows)
            stmt = stmt.on_conflict_do_update(
                constraint="uq_static_financials_key",
                set_={"raw_payload": stmt.excluded.raw_payload},
            )
            await session.execute(stmt)
            await session.commit()

    return DatasetResult(
        records_written=len(rows),
        requests_count=1,
        bytes_estimated=bytes_estimated,
        content_hash=payload_hash,
        cursor_value=str(max_year) if max_year is not None else ctx.previous_cursor_value,
        details={
            "payload_entries": len(entries),
            "rows_upserted": len(rows),
            "category": data_category,
        },
    )


async def run_income_statements(ctx: DatasetContext) -> DatasetResult:
    return await _run_static_category(
        ctx,
        endpoint="/income-statement",
        params={"period": "annual", "limit": 120},
        data_category="income_statement_annual",
        period="annual",
    )


async def run_balance_sheets(ctx: DatasetContext) -> DatasetResult:
    return await _run_static_category(
        ctx,
        endpoint="/balance-sheet-statement",
        params={"period": "annual", "limit": 120},
        data_category="balance_sheet_annual",
        period="annual",
    )


async def run_cashflow_statements(ctx: DatasetContext) -> DatasetResult:
    return await _run_static_category(
        ctx,
        endpoint="/cash-flow-statement",
        params={"period": "annual", "limit": 120},
        data_category="cash_flow_annual",
        period="annual",
    )


async def run_financial_ratios(ctx: DatasetContext) -> DatasetResult:
    return await _run_static_category(
        ctx,
        endpoint="/ratios",
        params={"period": "annual", "limit": 120},
        data_category="ratios_annual",
        period="annual",
    )


async def run_key_metrics(ctx: DatasetContext) -> DatasetResult:
    return await _run_static_category(
        ctx,
        endpoint="/key-metrics",
        params={"period": "annual", "limit": 120},
        data_category="metrics_annual",
        period="annual",
    )


async def run_financial_scores(ctx: DatasetContext) -> DatasetResult:
    return await _run_static_category(
        ctx,
        endpoint="/financial-scores",
        params={},
        data_category="scores_snapshot",
        period="snapshot",
        snapshot_year=True,
    )


async def run_enterprise_values(ctx: DatasetContext) -> DatasetResult:
    return await _run_static_category(
        ctx,
        endpoint="/enterprise-values",
        params={"period": "annual", "limit": 120},
        data_category="enterprise_values_annual",
        period="annual",
    )


async def run_executive_compensation(ctx: DatasetContext) -> DatasetResult:
    symbol = ctx.symbol
    payload = await fmp_client.get("/governance-executive-compensation", params={"symbol": symbol})
    entries = as_list(payload)
    payload_hash = content_hash(entries)
    bytes_estimated = estimate_bytes(entries)
    if ctx.previous_state and ctx.previous_state.content_hash_last == payload_hash:
        return DatasetResult(
            requests_count=1,
            bytes_estimated=bytes_estimated,
            content_hash=payload_hash,
            skipped_reason="unchanged",
            cursor_value=ctx.previous_cursor_value,
            details={"payload_entries": len(entries), "category": "executive_compensation"},
        )

    # group by year
    buckets: dict[int, list[dict[str, Any]]] = {}
    for r in entries:
        y = _year_field(r)
        if y is None:
            continue
        buckets.setdefault(y, []).append(r)

    rows = [
        {
            "symbol": symbol,
            "data_category": "executive_compensation",
            "period": "annual",
            "fiscal_year": y,
            "fiscal_quarter": None,
            "raw_payload": clean_jsonb({"year": y, "executives": arr}),
        }
        for y, arr in sorted(buckets.items())
    ]
    if rows:
        async with async_session_factory() as session:
            stmt = pg_insert(StaticFinancials).values(rows)
            stmt = stmt.on_conflict_do_update(
                constraint="uq_static_financials_key",
                set_={"raw_payload": stmt.excluded.raw_payload},
            )
            await session.execute(stmt)
            await session.commit()
    max_year = max((r["fiscal_year"] for r in rows), default=None)
    return DatasetResult(
        records_written=len(rows),
        requests_count=1,
        bytes_estimated=bytes_estimated,
        content_hash=payload_hash,
        cursor_value=str(max_year) if max_year is not None else ctx.previous_cursor_value,
        details={"rows_upserted": len(rows), "category": "executive_compensation"},
    )


async def run_revenue_segmentation(ctx: DatasetContext) -> DatasetResult:
    symbol = ctx.symbol
    all_rows: list[dict[str, Any]] = []
    requests = 0
    payload_for_hash: list[dict[str, Any]] = []

    for endpoint, category in (
        ("/revenue-product-segmentation", "segments_product_annual"),
        ("/revenue-geographic-segmentation", "segments_geographic_annual"),
    ):
        raw = await fmp_client.get(
            endpoint, params={"symbol": symbol, "period": "annual", "structure": "flat"}
        )
        requests += 1
        parsed = _segmentation_rows(raw)
        payload_for_hash.extend(parsed)
        for row in parsed:
            fy = _extract_fiscal_year(row)
            if fy is None:
                continue
            all_rows.append(
                {
                    "symbol": symbol,
                    "data_category": category,
                    "period": "annual",
                    "fiscal_year": fy,
                    "fiscal_quarter": None,
                    "raw_payload": clean_jsonb(row),
                }
            )

    all_rows = dedupe(all_rows, ("symbol", "data_category", "period", "fiscal_year"))
    payload_hash = content_hash(payload_for_hash)
    bytes_estimated = estimate_bytes(payload_for_hash)
    if ctx.previous_state and ctx.previous_state.content_hash_last == payload_hash:
        return DatasetResult(
            requests_count=requests,
            bytes_estimated=bytes_estimated,
            content_hash=payload_hash,
            skipped_reason="unchanged",
            cursor_value=ctx.previous_cursor_value,
            details={"rows": len(all_rows), "category": "segments"},
        )
    if all_rows:
        async with async_session_factory() as session:
            stmt = pg_insert(StaticFinancials).values(all_rows)
            stmt = stmt.on_conflict_do_update(
                constraint="uq_static_financials_key",
                set_={"raw_payload": stmt.excluded.raw_payload},
            )
            await session.execute(stmt)
            await session.commit()
    max_year = max((r["fiscal_year"] for r in all_rows), default=None)
    return DatasetResult(
        records_written=len(all_rows),
        requests_count=requests,
        bytes_estimated=bytes_estimated,
        content_hash=payload_hash,
        cursor_value=str(max_year) if max_year is not None else ctx.previous_cursor_value,
        details={"rows_upserted": len(all_rows), "category": "segments"},
    )


async def run_stock_peers(ctx: DatasetContext) -> DatasetResult:
    symbol = ctx.symbol
    payload = await fmp_client.get("/stock-peers", params={"symbol": symbol})
    entries = as_list(payload)
    payload_hash = content_hash(entries)
    bytes_estimated = estimate_bytes(entries)
    if ctx.previous_state and ctx.previous_state.content_hash_last == payload_hash:
        return DatasetResult(
            requests_count=1,
            bytes_estimated=bytes_estimated,
            content_hash=payload_hash,
            skipped_reason="unchanged",
            cursor_value=ctx.previous_cursor_value,
            details={"payload_entries": len(entries), "category": "peers_snapshot"},
        )
    year = _current_year()
    row = {
        "symbol": symbol,
        "data_category": "peers_snapshot",
        "period": "snapshot",
        "fiscal_year": year,
        "fiscal_quarter": None,
        "raw_payload": clean_jsonb(entries),
    }
    async with async_session_factory() as session:
        stmt = pg_insert(StaticFinancials).values(row)
        stmt = stmt.on_conflict_do_update(
            constraint="uq_static_financials_key",
            set_={"raw_payload": stmt.excluded.raw_payload},
        )
        await session.execute(stmt)
        await session.commit()
    return DatasetResult(
        records_written=1,
        requests_count=1,
        bytes_estimated=bytes_estimated,
        content_hash=payload_hash,
        cursor_value=str(year),
        details={"payload_entries": len(entries), "category": "peers_snapshot"},
    )
