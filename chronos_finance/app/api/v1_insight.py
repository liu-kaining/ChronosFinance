"""Read-only endpoints to inspect Postgres contents (no FMP calls)."""

from sqlalchemy import and_, func, select

from fastapi import APIRouter, HTTPException, Query

from app.core.database import async_session_factory
from app.models.alpha import AnalystEstimate, InsiderTrade, SECFile
from app.models.macro import MacroEconomic
from app.models.market import CorporateAction, DailyPrice, EarningsCalendar
from app.models.static_financials import StaticFinancials
from app.models.stock_universe import StockUniverse
from app.schemas.insight import (
    DateRangeStats,
    NamedCount,
    SecFormInventory,
    StaticFinancialsSlice,
    StatsOverviewResponse,
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
