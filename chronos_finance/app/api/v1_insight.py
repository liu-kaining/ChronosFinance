"""Read-only endpoints to inspect Postgres contents (no FMP calls)."""

from sqlalchemy import String, and_, cast, func, select

from fastapi import APIRouter, HTTPException, Query

from app.core.database import async_session_factory
from app.models.alpha import AnalystEstimate, InsiderTrade, SECFile
from app.models.macro import MacroEconomic
from app.models.market import CorporateAction, DailyPrice, EarningsCalendar
from app.models.static_financials import StaticFinancials
from app.models.stock_universe import StockUniverse
from app.schemas.insight import (
    AnalystKindAtlas,
    DateRangeStats,
    DateRangeWithJsonFootprint,
    MacroSeriesDataResponse,
    MacroSeriesListResponse,
    MacroSeriesPoint,
    MacroSeriesSummary,
    NamedCount,
    SecFormAtlas,
    SecFormInventory,
    StaticFinancialsBucketAtlas,
    StaticFinancialsSlice,
    StatsOverviewResponse,
    SymbolDataAtlasResponse,
    SymbolInventoryResponse,
    SyncProgressResponse,
    TableCounts,
    UniverseCounts,
    UniverseListResponse,
    UniverseRow,
)

router = APIRouter(prefix="/api/v1", tags=["data"])


async def _scalar_count(session, table) -> int:
    n = await session.scalar(select(func.count()).select_from(table))
    return int(n or 0)


async def _date_range_stats(session, model, symbol: str, date_col) -> DateRangeStats:
    row = (
        await session.execute(
            select(func.count(), func.min(date_col), func.max(date_col)).where(
                model.symbol == symbol
            )
        )
    ).one()
    return DateRangeStats(
        rows=int(row[0] or 0),
        date_min=row[1],
        date_max=row[2],
    )


@router.get(
    "/stats/overview",
    response_model=StatsOverviewResponse,
    summary="Row counts: stock_universe split + all fact tables",
)
async def stats_overview() -> StatsOverviewResponse:
    async with async_session_factory() as session:
        total = await _scalar_count(session, StockUniverse)
        active = await session.scalar(
            select(func.count())
            .select_from(StockUniverse)
            .where(StockUniverse.is_actively_trading.is_(True))
        )
        active = int(active or 0)
        tables = TableCounts(
            static_financials=await _scalar_count(session, StaticFinancials),
            daily_prices=await _scalar_count(session, DailyPrice),
            corporate_actions=await _scalar_count(session, CorporateAction),
            earnings_calendar=await _scalar_count(session, EarningsCalendar),
            insider_trades=await _scalar_count(session, InsiderTrade),
            analyst_estimates=await _scalar_count(session, AnalystEstimate),
            sec_files=await _scalar_count(session, SECFile),
            macro_economics=await _scalar_count(session, MacroEconomic),
        )
    return StatsOverviewResponse(
        universe=UniverseCounts(
            total=total,
            active=active,
            inactive=max(0, total - active),
        ),
        tables=tables,
    )


@router.get(
    "/stats/sync-progress",
    response_model=SyncProgressResponse,
    summary="How many active symbols have each *_synced flag true",
)
async def sync_progress() -> SyncProgressResponse:
    active_cond = StockUniverse.is_actively_trading.is_(True)

    def both(flag):
        return and_(active_cond, flag.is_(True))

    async with async_session_factory() as session:
        active = await session.scalar(
            select(func.count()).select_from(StockUniverse).where(active_cond)
        )
        inactive = await session.scalar(
            select(func.count())
            .select_from(StockUniverse)
            .where(StockUniverse.is_actively_trading.is_(False))
        )

        async def ac(flag) -> int:
            n = await session.scalar(
                select(func.count()).select_from(StockUniverse).where(both(flag))
            )
            return int(n or 0)

        return SyncProgressResponse(
            active_symbols=int(active or 0),
            inactive_symbols=int(inactive or 0),
            active_with_income_synced=await ac(StockUniverse.income_synced),
            active_with_balance_synced=await ac(StockUniverse.balance_synced),
            active_with_cashflow_synced=await ac(StockUniverse.cashflow_synced),
            active_with_ratios_synced=await ac(StockUniverse.ratios_synced),
            active_with_metrics_synced=await ac(StockUniverse.metrics_synced),
            active_with_scores_synced=await ac(StockUniverse.scores_synced),
            active_with_ev_synced=await ac(StockUniverse.ev_synced),
            active_with_compensation_synced=await ac(StockUniverse.compensation_synced),
            active_with_segments_synced=await ac(StockUniverse.segments_synced),
            active_with_peers_synced=await ac(StockUniverse.peers_synced),
            active_with_prices_synced=await ac(StockUniverse.prices_synced),
            active_with_actions_synced=await ac(StockUniverse.actions_synced),
            active_with_earnings_synced=await ac(StockUniverse.earnings_synced),
            active_with_insider_synced=await ac(StockUniverse.insider_synced),
            active_with_estimates_synced=await ac(StockUniverse.estimates_synced),
            active_with_filings_synced=await ac(StockUniverse.filings_synced),
            # Phase 6 — premium datasets
            active_with_float_synced=await ac(StockUniverse.float_synced),
            active_with_market_cap_synced=await ac(StockUniverse.market_cap_synced),
            active_with_dcf_synced=await ac(StockUniverse.dcf_synced),
        )


@router.get(
    "/data/universe",
    response_model=UniverseListResponse,
    summary="Paged stock_universe rows (sync flags; omits raw_payload JSONB)",
)
async def list_universe(
    active_only: bool = Query(True, description="Only is_actively_trading = true"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    symbol_prefix: str | None = Query(None, description="Optional ILIKE prefix, e.g. A"),
) -> UniverseListResponse:
    async with async_session_factory() as session:
        base = select(StockUniverse)
        count_stmt = select(func.count()).select_from(StockUniverse)
        if active_only:
            base = base.where(StockUniverse.is_actively_trading.is_(True))
            count_stmt = count_stmt.where(StockUniverse.is_actively_trading.is_(True))
        if symbol_prefix:
            pat = f"{symbol_prefix}%"
            base = base.where(StockUniverse.symbol.ilike(pat))
            count_stmt = count_stmt.where(StockUniverse.symbol.ilike(pat))

        total = await session.scalar(count_stmt)
        total = int(total or 0)

        stmt = (
            base.order_by(StockUniverse.symbol).limit(limit).offset(offset)
        )
        result = await session.scalars(stmt)
        rows = result.all()

    return UniverseListResponse(
        total_matching=total,
        limit=limit,
        offset=offset,
        items=[UniverseRow.model_validate(r) for r in rows],
    )


@router.get(
    "/data/symbols/{symbol}/inventory",
    response_model=SymbolInventoryResponse,
    summary="Per-symbol inventory: row counts & date/fiscal ranges (no raw JSONB)",
    description=(
        "Summarises what is stored for one ticker across all symbol-scoped tables. "
        "Does not return payloads — use SQL or future narrow endpoints for bulk JSON."
    ),
)
async def symbol_inventory(symbol: str) -> SymbolInventoryResponse:
    sym = symbol.strip().upper()
    if not sym or len(sym) > 20:
        raise HTTPException(status_code=400, detail="Invalid symbol")

    async with async_session_factory() as session:
        u = await session.scalar(
            select(StockUniverse).where(StockUniverse.symbol == sym)
        )
        universe = UniverseRow.model_validate(u) if u is not None else None

        sf_stmt = (
            select(
                StaticFinancials.data_category,
                StaticFinancials.period,
                func.count(),
                func.min(StaticFinancials.fiscal_year),
                func.max(StaticFinancials.fiscal_year),
            )
            .where(StaticFinancials.symbol == sym)
            .group_by(StaticFinancials.data_category, StaticFinancials.period)
            .order_by(
                func.max(StaticFinancials.fiscal_year).desc(),
                StaticFinancials.data_category,
                StaticFinancials.period,
            )
        )
        sf_rows = (await session.execute(sf_stmt)).all()
        static_slices = [
            StaticFinancialsSlice(
                data_category=r[0],
                period=r[1],
                rows=int(r[2]),
                fiscal_year_min=r[3],
                fiscal_year_max=r[4],
            )
            for r in sf_rows
        ]

        daily = await _date_range_stats(session, DailyPrice, sym, DailyPrice.date)
        earnings = await _date_range_stats(
            session, EarningsCalendar, sym, EarningsCalendar.date
        )
        insider = await _date_range_stats(
            session, InsiderTrade, sym, InsiderTrade.transaction_date
        )

        ca_row = (
            await session.execute(
                select(
                    func.count(),
                    func.min(CorporateAction.action_date),
                    func.max(CorporateAction.action_date),
                ).where(CorporateAction.symbol == sym)
            )
        ).one()
        corporate = DateRangeStats(
            rows=int(ca_row[0] or 0),
            date_min=ca_row[1],
            date_max=ca_row[2],
        )

        ca_types = (
            await session.execute(
                select(CorporateAction.action_type, func.count())
                .where(CorporateAction.symbol == sym)
                .group_by(CorporateAction.action_type)
                .order_by(CorporateAction.action_type)
            )
        ).all()
        corporate_by_type = [
            NamedCount(name=r[0], rows=int(r[1])) for r in ca_types
        ]

        ae_rows = (
            await session.execute(
                select(AnalystEstimate.kind, func.count())
                .where(AnalystEstimate.symbol == sym)
                .group_by(AnalystEstimate.kind)
                .order_by(AnalystEstimate.kind)
            )
        ).all()
        ae_by_kind = [NamedCount(name=r[0], rows=int(r[1])) for r in ae_rows]

        sec_rows = (
            await session.execute(
                select(
                    SECFile.form_type,
                    func.count(),
                    func.min(SECFile.fiscal_year),
                    func.max(SECFile.fiscal_year),
                )
                .where(SECFile.symbol == sym)
                .group_by(SECFile.form_type)
                .order_by(SECFile.form_type)
            )
        ).all()
        sec_inv = [
            SecFormInventory(
                form_type=r[0],
                rows=int(r[1]),
                fiscal_year_min=r[2],
                fiscal_year_max=r[3],
            )
            for r in sec_rows
        ]

    return SymbolInventoryResponse(
        symbol=sym,
        universe=universe,
        static_financials=static_slices,
        daily_prices=daily,
        corporate_actions=corporate,
        corporate_actions_by_type=corporate_by_type,
        earnings_calendar=earnings,
        insider_trades=insider,
        analyst_estimates_by_kind=ae_by_kind,
        sec_filings=sec_inv,
    )


def _len_sum_jsonb(col):
    return func.coalesce(func.sum(func.length(cast(col, String))), 0)


@router.get(
    "/data/macro/series",
    response_model=MacroSeriesListResponse,
    summary="List macro indicator series in macro_economics (row counts & date span)",
)
async def list_macro_series() -> MacroSeriesListResponse:
    async with async_session_factory() as session:
        stmt = (
            select(
                MacroEconomic.series_id,
                func.count().label("n"),
                func.min(MacroEconomic.date),
                func.max(MacroEconomic.date),
            )
            .group_by(MacroEconomic.series_id)
            .order_by(MacroEconomic.series_id)
        )
        rows = (await session.execute(stmt)).all()
    return MacroSeriesListResponse(
        series=[
            MacroSeriesSummary(
                series_id=r[0],
                rows=int(r[1] or 0),
                date_min=r[2],
                date_max=r[3],
            )
            for r in rows
        ]
    )


@router.get(
    "/data/macro/series/{series_id}",
    response_model=MacroSeriesDataResponse,
    summary="Time series points for one macro series_id (value + full raw_payload)",
)
async def get_macro_series_data(
    series_id: str,
    limit: int = Query(8000, ge=1, le=50_000),
    order: str = Query("asc", description="`asc` or `desc` by date"),
) -> MacroSeriesDataResponse:
    sid = series_id.strip()
    if not sid or len(sid) > 128:
        raise HTTPException(status_code=400, detail="Invalid series_id")
    order_desc = order.lower() == "desc"
    async with async_session_factory() as session:
        stmt = select(MacroEconomic).where(MacroEconomic.series_id == sid)
        stmt = stmt.order_by(MacroEconomic.date.desc() if order_desc else MacroEconomic.date.asc())
        stmt = stmt.limit(limit)
        mrows = (await session.scalars(stmt)).all()
    if order_desc:
        mrows = list(reversed(mrows))
    items = [
        MacroSeriesPoint(
            date=r.date,
            value=r.value,
            raw_payload=r.raw_payload or {},
        )
        for r in mrows
    ]
    return MacroSeriesDataResponse(series_id=sid, rows=len(items), items=items)


@router.get(
    "/data/symbols/{symbol}/data-atlas",
    response_model=SymbolDataAtlasResponse,
    summary="Per-symbol data footprint: counts, ranges, JSONB text-length sums",
)
async def symbol_data_atlas(symbol: str) -> SymbolDataAtlasResponse:
    sym = symbol.strip().upper()
    if not sym or len(sym) > 20:
        raise HTTPException(status_code=400, detail="Invalid symbol")

    async with async_session_factory() as session:
        u = await session.scalar(
            select(StockUniverse).where(StockUniverse.symbol == sym)
        )
        universe = UniverseRow.model_validate(u) if u is not None else None
        uni_bytes = 0
        if u is not None and u.raw_payload is not None:
            uni_b = await session.scalar(
                select(func.length(cast(StockUniverse.raw_payload, String))).where(
                    StockUniverse.symbol == sym
                )
            )
            uni_bytes = int(uni_b or 0)

        sf_stmt = (
            select(
                StaticFinancials.data_category,
                StaticFinancials.period,
                func.count(),
                func.min(StaticFinancials.fiscal_year),
                func.max(StaticFinancials.fiscal_year),
                _len_sum_jsonb(StaticFinancials.raw_payload),
            )
            .where(StaticFinancials.symbol == sym)
            .group_by(StaticFinancials.data_category, StaticFinancials.period)
            .order_by(
                func.max(StaticFinancials.fiscal_year).desc(),
                StaticFinancials.data_category,
                StaticFinancials.period,
            )
        )
        sf_rows = (await session.execute(sf_stmt)).all()
        static_buckets = [
            StaticFinancialsBucketAtlas(
                data_category=r[0],
                period=r[1],
                rows=int(r[2]),
                fiscal_year_min=r[3],
                fiscal_year_max=r[4],
                approx_json_text_bytes=int(r[5] or 0),
            )
            for r in sf_rows
        ]

        daily = await _date_range_stats(session, DailyPrice, sym, DailyPrice.date)

        ca_row = (
            await session.execute(
                select(
                    func.count(),
                    func.min(CorporateAction.action_date),
                    func.max(CorporateAction.action_date),
                    _len_sum_jsonb(CorporateAction.raw_payload),
                ).where(CorporateAction.symbol == sym)
            )
        ).one()
        corporate = DateRangeWithJsonFootprint(
            rows=int(ca_row[0] or 0),
            date_min=ca_row[1],
            date_max=ca_row[2],
            approx_json_text_bytes=int(ca_row[3] or 0),
        )

        ca_types = (
            await session.execute(
                select(CorporateAction.action_type, func.count())
                .where(CorporateAction.symbol == sym)
                .group_by(CorporateAction.action_type)
                .order_by(CorporateAction.action_type)
            )
        ).all()
        corporate_by_type = [
            NamedCount(name=r[0], rows=int(r[1])) for r in ca_types
        ]

        er_row = (
            await session.execute(
                select(
                    func.count(),
                    func.min(EarningsCalendar.date),
                    func.max(EarningsCalendar.date),
                    _len_sum_jsonb(EarningsCalendar.raw_payload),
                ).where(EarningsCalendar.symbol == sym)
            )
        ).one()
        earnings = DateRangeWithJsonFootprint(
            rows=int(er_row[0] or 0),
            date_min=er_row[1],
            date_max=er_row[2],
            approx_json_text_bytes=int(er_row[3] or 0),
        )

        ins_row = (
            await session.execute(
                select(
                    func.count(),
                    func.min(InsiderTrade.transaction_date),
                    func.max(InsiderTrade.transaction_date),
                    _len_sum_jsonb(InsiderTrade.raw_payload),
                ).where(InsiderTrade.symbol == sym)
            )
        ).one()
        insider = DateRangeWithJsonFootprint(
            rows=int(ins_row[0] or 0),
            date_min=ins_row[1],
            date_max=ins_row[2],
            approx_json_text_bytes=int(ins_row[3] or 0),
        )

        ae_stmt = (
            select(
                AnalystEstimate.kind,
                func.count(),
                _len_sum_jsonb(AnalystEstimate.raw_payload),
            )
            .where(AnalystEstimate.symbol == sym)
            .group_by(AnalystEstimate.kind)
            .order_by(AnalystEstimate.kind)
        )
        ae_rows = (await session.execute(ae_stmt)).all()
        ae_by_kind = [
            AnalystKindAtlas(kind=r[0], rows=int(r[1]), approx_json_text_bytes=int(r[2] or 0))
            for r in ae_rows
        ]

        sec_stmt = (
            select(
                SECFile.form_type,
                func.count(),
                func.min(SECFile.fiscal_year),
                func.max(SECFile.fiscal_year),
                _len_sum_jsonb(SECFile.raw_content),
            )
            .where(SECFile.symbol == sym)
            .group_by(SECFile.form_type)
            .order_by(SECFile.form_type)
        )
        sec_rows = (await session.execute(sec_stmt)).all()
        sec_inv = [
            SecFormAtlas(
                form_type=r[0],
                rows=int(r[1]),
                fiscal_year_min=r[2],
                fiscal_year_max=r[3],
                approx_json_text_bytes=int(r[4] or 0),
            )
            for r in sec_rows
        ]

    grand = uni_bytes + sum(b.approx_json_text_bytes for b in static_buckets)
    grand += corporate.approx_json_text_bytes
    grand += earnings.approx_json_text_bytes
    grand += insider.approx_json_text_bytes
    grand += sum(k.approx_json_text_bytes for k in ae_by_kind)
    grand += sum(s.approx_json_text_bytes for s in sec_inv)

    return SymbolDataAtlasResponse(
        symbol=sym,
        universe=universe,
        universe_raw_payload_approx_bytes=uni_bytes,
        static_financials_buckets=static_buckets,
        daily_prices=DateRangeWithJsonFootprint(
            rows=daily.rows,
            date_min=daily.date_min,
            date_max=daily.date_max,
            approx_json_text_bytes=0,
        ),
        corporate_actions=corporate,
        corporate_actions_by_type=corporate_by_type,
        earnings_calendar=earnings,
        insider_trades=insider,
        analyst_estimates_by_kind=ae_by_kind,
        sec_filings=sec_inv,
        grand_total_approx_json_text_bytes=grand,
    )
