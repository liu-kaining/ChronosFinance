"""Read-only endpoints to inspect Postgres contents (no FMP calls)."""

from datetime import UTC, datetime, timedelta

from sqlalchemy import String, and_, cast, func, select

from fastapi import APIRouter, HTTPException, Query

from app.core.database import async_session_factory
from app.models.alpha import AnalystEstimate, InsiderTrade, SECFile
from app.models.macro import MacroEconomic
from app.models.market import CorporateAction, DailyPrice, EarningsCalendar
from app.models.static_financials import StaticFinancials
from app.models.stock_universe import StockUniverse
from app.models.sync_control import SyncRun
from app.schemas.insight import (
    EventsStreamResponse,
    IngestHealthResponse,
    LatestEarningsSnapshot,
    LatestInsiderSnapshot,
    LatestPriceSnapshot,
    AnalystKindAtlas,
    DateRangeStats,
    DateRangeWithJsonFootprint,
    MarketSnapshotResponse,
    MacroSeriesDataResponse,
    MacroSeriesListResponse,
    MacroSeriesPoint,
    MacroSeriesSummary,
    MoverRow,
    NamedCount,
    SecFormCount,
    StreamEarningsRow,
    StreamInsiderRow,
    StreamSecRow,
    SecFormAtlas,
    SecFormInventory,
    SectorCoverageRow,
    StaticFinancialsBucketAtlas,
    StaticFinancialsSlice,
    StatsOverviewResponse,
    SymbolSnapshotResponse,
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


@router.get(
    "/data/market/snapshot",
    response_model=MarketSnapshotResponse,
    summary="Global market snapshot: sector mix, gainers/losers, most active",
)
async def market_snapshot(
    limit: int = Query(10, ge=3, le=50),
) -> MarketSnapshotResponse:
    async with async_session_factory() as session:
        active_symbols = int(
            (
                await session.scalar(
                    select(func.count())
                    .select_from(StockUniverse)
                    .where(StockUniverse.is_actively_trading.is_(True))
                )
            )
            or 0
        )

        sector_rows = (
            await session.execute(
                select(
                    func.coalesce(StockUniverse.sector, "Unknown"),
                    func.count(),
                    func.sum(StockUniverse.market_cap),
                    func.avg(change_expr),
                )
                .select_from(latest)
                .join(prev, prev.c.symbol == latest.c.symbol)
                .join(StockUniverse, StockUniverse.symbol == latest.c.symbol)
                .where(
                    StockUniverse.is_actively_trading.is_(True),
                    latest.c.close.is_not(None),
                    prev.c.close.is_not(None),
                )
                .group_by(func.coalesce(StockUniverse.sector, "Unknown"))
                .order_by(func.sum(StockUniverse.market_cap).desc().nulls_last(), func.count().desc())
                .limit(20)
            )
        ).all()
        sectors = [
            SectorCoverageRow(
                sector=r[0],
                symbols=int(r[1] or 0),
                market_cap_total=float(r[2]) if r[2] is not None else None,
                avg_change_pct=float(r[3]) if r[3] is not None else None,
            )
            for r in sector_rows
        ]

        ranked = (
            select(
                DailyPrice.symbol.label("symbol"),
                DailyPrice.date.label("date"),
                DailyPrice.close.label("close"),
                DailyPrice.volume.label("volume"),
                func.row_number()
                .over(partition_by=DailyPrice.symbol, order_by=DailyPrice.date.desc())
                .label("rn"),
            )
            .subquery()
        )
        latest = select(ranked).where(ranked.c.rn == 1).subquery()
        prev = select(ranked).where(ranked.c.rn == 2).subquery()
        change_expr = (latest.c.close - prev.c.close) / func.nullif(prev.c.close, 0)

        base_stmt = (
            select(
                latest.c.symbol,
                StockUniverse.company_name,
                latest.c.date,
                latest.c.close,
                prev.c.close.label("prev_close"),
                change_expr.label("change_pct"),
                latest.c.volume,
            )
            .join(prev, prev.c.symbol == latest.c.symbol)
            .join(StockUniverse, StockUniverse.symbol == latest.c.symbol)
            .where(
                StockUniverse.is_actively_trading.is_(True),
                latest.c.close.is_not(None),
                prev.c.close.is_not(None),
            )
        )

        as_of_date = await session.scalar(select(func.max(latest.c.date)))
        gain_rows = (await session.execute(base_stmt.order_by(change_expr.desc()).limit(limit))).all()
        lose_rows = (await session.execute(base_stmt.order_by(change_expr.asc()).limit(limit))).all()
        active_rows = (
            await session.execute(
                base_stmt.order_by(latest.c.volume.desc().nulls_last()).limit(limit)
            )
        ).all()

    def _to_mover(r) -> MoverRow:
        return MoverRow(
            symbol=r[0],
            company_name=r[1],
            date=r[2],
            close=float(r[3]) if r[3] is not None else None,
            prev_close=float(r[4]) if r[4] is not None else None,
            change_pct=float(r[5]) if r[5] is not None else None,
            volume=int(r[6]) if r[6] is not None else None,
        )

    return MarketSnapshotResponse(
        as_of_date=as_of_date,
        active_symbols=active_symbols,
        sectors=sectors,
        top_gainers=[_to_mover(r) for r in gain_rows],
        top_losers=[_to_mover(r) for r in lose_rows],
        most_active=[_to_mover(r) for r in active_rows],
    )


@router.get(
    "/data/symbols/{symbol}/snapshot",
    response_model=SymbolSnapshotResponse,
    summary="Single-symbol snapshot: latest market/event stats and sync flag coverage",
)
async def symbol_snapshot(symbol: str) -> SymbolSnapshotResponse:
    sym = symbol.strip().upper()
    if not sym or len(sym) > 20:
        raise HTTPException(status_code=400, detail="Invalid symbol")

    async with async_session_factory() as session:
        u = await session.scalar(select(StockUniverse).where(StockUniverse.symbol == sym))
        universe = UniverseRow.model_validate(u) if u is not None else None

        p_rows = (
            await session.execute(
                select(DailyPrice)
                .where(DailyPrice.symbol == sym)
                .order_by(DailyPrice.date.desc())
                .limit(2)
            )
        ).scalars().all()

        latest_price = LatestPriceSnapshot()
        if p_rows:
            latest_price.date = p_rows[0].date
            latest_price.close = p_rows[0].close
            latest_price.volume = p_rows[0].volume
            if len(p_rows) > 1 and p_rows[1].close not in (None, 0):
                latest_price.prev_close = p_rows[1].close
                latest_price.change_pct = (
                    ((p_rows[0].close or 0) - (p_rows[1].close or 0)) / (p_rows[1].close or 1)
                    if p_rows[0].close is not None
                    else None
                )

        e = await session.scalar(
            select(EarningsCalendar)
            .where(EarningsCalendar.symbol == sym)
            .order_by(EarningsCalendar.date.desc())
            .limit(1)
        )
        latest_earnings = (
            LatestEarningsSnapshot(
                date=e.date,
                eps_estimated=e.eps_estimated,
                eps_actual=e.eps_actual,
                revenue_estimated=e.revenue_estimated,
                revenue_actual=e.revenue_actual,
            )
            if e
            else None
        )

        ins = await session.scalar(
            select(InsiderTrade)
            .where(InsiderTrade.symbol == sym)
            .order_by(InsiderTrade.filing_date.desc().nulls_last())
            .limit(1)
        )
        latest_insider = (
            LatestInsiderSnapshot(
                filing_date=ins.filing_date.isoformat() if ins and ins.filing_date else None,
                transaction_date=ins.transaction_date if ins else None,
                reporting_name=ins.reporting_name if ins else None,
                transaction_type=ins.transaction_type if ins else None,
                securities_transacted=ins.securities_transacted if ins else None,
            )
            if ins
            else None
        )

        insider_rows_90d = int(
            (
                await session.scalar(
                    select(func.count())
                    .select_from(InsiderTrade)
                    .where(
                        InsiderTrade.symbol == sym,
                        InsiderTrade.filing_date >= datetime.now(UTC) - timedelta(days=90),
                    )
                )
            )
            or 0
        )

        sec_rows = (
            await session.execute(
                select(SECFile.form_type, func.count(), func.max(SECFile.filing_date))
                .where(SECFile.symbol == sym)
                .group_by(SECFile.form_type)
                .order_by(func.count().desc(), SECFile.form_type)
            )
        ).all()
        sec_by_form = [
            SecFormCount(form_type=r[0], rows=int(r[1] or 0), latest_filing_date=r[2])
            for r in sec_rows
        ]

        ae_rows = (
            await session.execute(
                select(AnalystEstimate.kind, func.count())
                .where(AnalystEstimate.symbol == sym)
                .group_by(AnalystEstimate.kind)
                .order_by(func.count().desc(), AnalystEstimate.kind)
            )
        ).all()
        analyst_by_kind = [NamedCount(name=r[0], rows=int(r[1] or 0)) for r in ae_rows]

    synced_flags_true = 0
    synced_flags_total = 0
    if universe is not None:
        flag_names = [
            "income_synced",
            "balance_synced",
            "cashflow_synced",
            "ratios_synced",
            "metrics_synced",
            "scores_synced",
            "ev_synced",
            "compensation_synced",
            "segments_synced",
            "peers_synced",
            "prices_synced",
            "actions_synced",
            "earnings_synced",
            "insider_synced",
            "estimates_synced",
            "filings_synced",
            "float_synced",
            "market_cap_synced",
            "dcf_synced",
        ]
        synced_flags_total = len(flag_names)
        synced_flags_true = sum(1 for n in flag_names if bool(getattr(universe, n, False)))

    return SymbolSnapshotResponse(
        symbol=sym,
        universe=universe,
        latest_price=latest_price,
        latest_earnings=latest_earnings,
        latest_insider=latest_insider,
        insider_rows_90d=insider_rows_90d,
        sec_by_form=sec_by_form,
        analyst_by_kind=analyst_by_kind,
        synced_flags_true=synced_flags_true,
        synced_flags_total=synced_flags_total,
    )


@router.get(
    "/data/events/stream",
    response_model=EventsStreamResponse,
    summary="Global event stream across active symbols (earnings/insider/SEC filings)",
)
async def events_stream(
    limit: int = Query(30, ge=5, le=200),
) -> EventsStreamResponse:
    async with async_session_factory() as session:
        earnings_rows = (
            await session.execute(
                select(
                    EarningsCalendar.symbol,
                    StockUniverse.company_name,
                    EarningsCalendar.date,
                    EarningsCalendar.eps_estimated,
                    EarningsCalendar.eps_actual,
                    EarningsCalendar.revenue_estimated,
                    EarningsCalendar.revenue_actual,
                )
                .join(StockUniverse, StockUniverse.symbol == EarningsCalendar.symbol)
                .where(StockUniverse.is_actively_trading.is_(True))
                .order_by(EarningsCalendar.date.desc())
                .limit(limit)
            )
        ).all()

        insider_rows = (
            await session.execute(
                select(
                    InsiderTrade.symbol,
                    StockUniverse.company_name,
                    InsiderTrade.filing_date,
                    InsiderTrade.transaction_date,
                    InsiderTrade.reporting_name,
                    InsiderTrade.transaction_type,
                    InsiderTrade.securities_transacted,
                )
                .join(StockUniverse, StockUniverse.symbol == InsiderTrade.symbol)
                .where(StockUniverse.is_actively_trading.is_(True))
                .order_by(InsiderTrade.filing_date.desc().nulls_last())
                .limit(limit)
            )
        ).all()

        sec_rows = (
            await session.execute(
                select(
                    SECFile.symbol,
                    StockUniverse.company_name,
                    SECFile.form_type,
                    SECFile.filing_date,
                    SECFile.fiscal_year,
                    SECFile.fiscal_period,
                )
                .join(StockUniverse, StockUniverse.symbol == SECFile.symbol)
                .where(StockUniverse.is_actively_trading.is_(True))
                .order_by(SECFile.filing_date.desc().nulls_last(), SECFile.fiscal_year.desc())
                .limit(limit)
            )
        ).all()

    return EventsStreamResponse(
        earnings=[
            StreamEarningsRow(
                symbol=r[0],
                company_name=r[1],
                date=r[2],
                eps_estimated=r[3],
                eps_actual=r[4],
                revenue_estimated=r[5],
                revenue_actual=r[6],
            )
            for r in earnings_rows
        ],
        insider=[
            StreamInsiderRow(
                symbol=r[0],
                company_name=r[1],
                filing_date=r[2].isoformat() if r[2] else None,
                transaction_date=r[3],
                reporting_name=r[4],
                transaction_type=r[5],
                securities_transacted=r[6],
            )
            for r in insider_rows
        ],
        sec_filings=[
            StreamSecRow(
                symbol=r[0],
                company_name=r[1],
                form_type=r[2],
                filing_date=r[3],
                fiscal_year=r[4],
                fiscal_period=r[5],
            )
            for r in sec_rows
        ],
    )


@router.get(
    "/stats/ingest-health",
    response_model=IngestHealthResponse,
    summary="Latest ingest run health counts (running/failed/ok/skipped)",
)
async def ingest_health(
    limit: int = Query(200, ge=20, le=2000),
) -> IngestHealthResponse:
    async with async_session_factory() as session:
        rows = (
            await session.execute(
                select(SyncRun.status)
                .order_by(SyncRun.started_at.desc())
                .limit(limit)
            )
        ).all()

    c = {"running": 0, "failed": 0, "ok": 0, "skipped": 0}
    for (status,) in rows:
        key = str(status or "").lower()
        if key in c:
            c[key] += 1
    return IngestHealthResponse(**c)
