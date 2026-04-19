"""Read-only JSON APIs for the Library UI (prices, static financials, events)."""

from __future__ import annotations

from sqlalchemy import func, select

from fastapi import APIRouter, HTTPException, Query

from app.core.database import async_session_factory
from app.models.alpha import AnalystEstimate, InsiderTrade, SECFile
from app.models.market import CorporateAction, DailyPrice, EarningsCalendar
from app.models.static_financials import StaticFinancials
from app.schemas.library import (
    AnalystEstimateRow,
    AnalystEstimatesResponse,
    CorporateActionRow,
    CorporateActionsResponse,
    EarningsRow,
    EarningsSeriesResponse,
    InsiderRow,
    InsiderSeriesResponse,
    PriceBar,
    PricesSeriesResponse,
    SecFilingMeta,
    SecFilingsListResponse,
    StaticCategoriesResponse,
    StaticCategoryInfo,
    StaticRow,
    StaticSeriesResponse,
)

router = APIRouter(prefix="/api/v1/library", tags=["library"])


def _sym(symbol: str) -> str:
    s = symbol.strip().upper()
    if not s or len(s) > 20:
        raise HTTPException(status_code=400, detail="Invalid symbol")
    return s


@router.get(
    "/symbols/{symbol}/prices",
    response_model=PricesSeriesResponse,
    summary="Daily OHLCV for charts (newest first optional)",
)
async def library_prices(
    symbol: str,
    limit: int = Query(3000, ge=1, le=10_000),
    order: str = Query("asc", description="`asc` = oldest first (typical for charts), `desc`"),
) -> PricesSeriesResponse:
    sym = _sym(symbol)
    order_desc = order.lower() == "desc"
    async with async_session_factory() as session:
        stmt = select(DailyPrice).where(DailyPrice.symbol == sym)
        stmt = stmt.order_by(DailyPrice.date.desc() if order_desc else DailyPrice.date.asc())
        stmt = stmt.limit(limit)
        rows = (await session.scalars(stmt)).all()

    if order_desc:
        rows = list(reversed(rows))

    items = [
        PriceBar(
            date=r.date,
            open=r.open,
            high=r.high,
            low=r.low,
            close=r.close,
            adj_close=r.adj_close,
            volume=r.volume,
        )
        for r in rows
    ]
    return PricesSeriesResponse(symbol=sym, rows=len(items), items=items)


@router.get(
    "/symbols/{symbol}/static/categories",
    response_model=StaticCategoriesResponse,
    summary="Distinct static_financials buckets for this symbol",
)
async def library_static_categories(symbol: str) -> StaticCategoriesResponse:
    sym = _sym(symbol)
    async with async_session_factory() as session:
        stmt = (
            select(
                StaticFinancials.data_category,
                StaticFinancials.period,
                func.count().label("n"),
                func.min(StaticFinancials.fiscal_year),
                func.max(StaticFinancials.fiscal_year),
            )
            .where(StaticFinancials.symbol == sym)
            .group_by(StaticFinancials.data_category, StaticFinancials.period)
            .order_by(StaticFinancials.data_category, StaticFinancials.period)
        )
        result = await session.execute(stmt)
        cats = [
            StaticCategoryInfo(
                data_category=r[0],
                period=r[1],
                rows=int(r[2]),
                fiscal_year_min=r[3],
                fiscal_year_max=r[4],
            )
            for r in result.all()
        ]
    return StaticCategoriesResponse(symbol=sym, categories=cats)


@router.get(
    "/symbols/{symbol}/static",
    response_model=StaticSeriesResponse,
    summary="Rows for one (data_category, period) including raw_payload",
)
async def library_static_series(
    symbol: str,
    category: str = Query(..., min_length=1, max_length=80, description="e.g. income_statement_annual"),
    period: str = Query("annual", max_length=10),
    limit: int = Query(200, ge=1, le=500),
) -> StaticSeriesResponse:
    sym = _sym(symbol)
    async with async_session_factory() as session:
        stmt = (
            select(StaticFinancials)
            .where(
                StaticFinancials.symbol == sym,
                StaticFinancials.data_category == category,
                StaticFinancials.period == period,
            )
            .order_by(StaticFinancials.fiscal_year.desc())
            .limit(limit)
        )
        rows = (await session.scalars(stmt)).all()

    items = [
        StaticRow(
            fiscal_year=r.fiscal_year,
            fiscal_quarter=r.fiscal_quarter,
            raw_payload=r.raw_payload or {},
        )
        for r in rows
    ]
    # fiscal_year DESC — newest periods first for library tables.
    return StaticSeriesResponse(
        symbol=sym,
        data_category=category,
        period=period,
        rows=len(items),
        items=items,
    )


@router.get(
    "/symbols/{symbol}/earnings",
    response_model=EarningsSeriesResponse,
    summary="Earnings calendar rows (EPS / revenue est. vs actual)",
)
async def library_earnings(
    symbol: str,
    limit: int = Query(200, ge=1, le=2000),
) -> EarningsSeriesResponse:
    sym = _sym(symbol)
    async with async_session_factory() as session:
        stmt = (
            select(EarningsCalendar)
            .where(EarningsCalendar.symbol == sym)
            .order_by(EarningsCalendar.date.desc())
            .limit(limit)
        )
        rows = (await session.scalars(stmt)).all()

    items = [
        EarningsRow(
            date=r.date,
            fiscal_period_end=r.fiscal_period_end,
            eps_estimated=r.eps_estimated,
            eps_actual=r.eps_actual,
            revenue_estimated=r.revenue_estimated,
            revenue_actual=r.revenue_actual,
        )
        for r in rows
    ]
    # Keep DB order: date DESC (newest first) for earnings calendar UI.
    return EarningsSeriesResponse(symbol=sym, rows=len(items), items=items)


@router.get(
    "/symbols/{symbol}/corporate-actions",
    response_model=CorporateActionsResponse,
)
async def library_corporate_actions(
    symbol: str,
    limit: int = Query(500, ge=1, le=5000),
) -> CorporateActionsResponse:
    sym = _sym(symbol)
    async with async_session_factory() as session:
        stmt = (
            select(CorporateAction)
            .where(CorporateAction.symbol == sym)
            .order_by(CorporateAction.action_date.desc())
            .limit(limit)
        )
        rows = (await session.scalars(stmt)).all()

    items = [
        CorporateActionRow(
            action_type=r.action_type,
            action_date=r.action_date,
            raw_payload=r.raw_payload or {},
        )
        for r in rows
    ]
    # Keep action_date DESC (newest corporate actions first).
    return CorporateActionsResponse(symbol=sym, rows=len(items), items=items)


@router.get(
    "/symbols/{symbol}/insider",
    response_model=InsiderSeriesResponse,
)
async def library_insider(
    symbol: str,
    limit: int = Query(200, ge=1, le=2000),
) -> InsiderSeriesResponse:
    sym = _sym(symbol)
    async with async_session_factory() as session:
        stmt = (
            select(InsiderTrade)
            .where(InsiderTrade.symbol == sym)
            .order_by(InsiderTrade.filing_date.desc().nulls_last())
            .limit(limit)
        )
        rows = (await session.scalars(stmt)).all()

    items = [
        InsiderRow(
            filing_date=r.filing_date,
            transaction_date=r.transaction_date,
            reporting_name=r.reporting_name,
            transaction_type=r.transaction_type,
            securities_transacted=r.securities_transacted,
            price=r.price,
        )
        for r in rows
    ]
    return InsiderSeriesResponse(symbol=sym, rows=len(items), items=items)


@router.get(
    "/symbols/{symbol}/analyst-estimates",
    response_model=AnalystEstimatesResponse,
)
async def library_analyst_estimates(
    symbol: str,
    limit: int = Query(300, ge=1, le=5000),
) -> AnalystEstimatesResponse:
    sym = _sym(symbol)
    async with async_session_factory() as session:
        stmt = (
            select(AnalystEstimate)
            .where(AnalystEstimate.symbol == sym)
            .order_by(
                AnalystEstimate.ref_date.desc().nulls_last(),
                AnalystEstimate.published_date.desc().nulls_last(),
                AnalystEstimate.kind,
            )
            .limit(limit)
        )
        rows = (await session.scalars(stmt)).all()

    items = [
        AnalystEstimateRow(
            kind=r.kind,
            ref_date=r.ref_date,
            published_date=r.published_date,
            raw_payload=r.raw_payload or {},
        )
        for r in rows
    ]
    return AnalystEstimatesResponse(symbol=sym, rows=len(items), items=items)


@router.get(
    "/symbols/{symbol}/sec-filings",
    response_model=SecFilingsListResponse,
    summary="SEC filing metadata (no full JSON body)",
)
async def library_sec_filings(
    symbol: str,
    limit: int = Query(100, ge=1, le=500),
) -> SecFilingsListResponse:
    sym = _sym(symbol)
    async with async_session_factory() as session:
        stmt = (
            select(SECFile)
            .where(SECFile.symbol == sym)
            .order_by(
                SECFile.fiscal_year.desc(),
                SECFile.filing_date.desc().nulls_last(),
                SECFile.form_type,
            )
            .limit(limit)
        )
        rows = (await session.scalars(stmt)).all()

    out: list[SecFilingMeta] = []
    for r in rows:
        rc = r.raw_content
        est = len(rc) if isinstance(rc, dict) else None
        out.append(
            SecFilingMeta(
                id=r.id,
                form_type=r.form_type,
                fiscal_year=r.fiscal_year,
                fiscal_period=r.fiscal_period,
                filing_date=r.filing_date,
                content_keys_estimate=est,
            )
        )
    return SecFilingsListResponse(symbol=sym, rows=len(out), items=out)
