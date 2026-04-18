"""Response models for read-only DB insight endpoints."""

from datetime import date

from pydantic import BaseModel, Field


class TableCounts(BaseModel):
    """Fact / analytics tables (``stock_universe`` totals live under ``universe``)."""

    static_financials: int
    daily_prices: int
    corporate_actions: int
    earnings_calendar: int
    insider_trades: int
    analyst_estimates: int
    sec_files: int
    macro_economics: int


class UniverseCounts(BaseModel):
    total: int
    active: int
    inactive: int


class StatsOverviewResponse(BaseModel):
    universe: UniverseCounts
    tables: TableCounts


class SyncProgressResponse(BaseModel):
    """Per-flag completion among **active** symbols (``is_actively_trading``)."""

    active_symbols: int = Field(description="Count with is_actively_trading = true")
    inactive_symbols: int
    # Phase 2–5: how many *active* symbols have each flag true
    active_with_income_synced: int
    active_with_balance_synced: int
    active_with_cashflow_synced: int
    active_with_ratios_synced: int
    active_with_metrics_synced: int
    active_with_scores_synced: int
    active_with_ev_synced: int
    active_with_compensation_synced: int
    active_with_segments_synced: int
    active_with_peers_synced: int
    active_with_prices_synced: int
    active_with_actions_synced: int
    active_with_earnings_synced: int
    active_with_insider_synced: int
    active_with_estimates_synced: int
    active_with_filings_synced: int


class UniverseRow(BaseModel):
    symbol: str
    company_name: str | None
    exchange: str | None
    exchange_short_name: str | None
    sector: str | None
    industry: str | None
    market_cap: float | None
    is_actively_trading: bool
    income_synced: bool
    balance_synced: bool
    cashflow_synced: bool
    ratios_synced: bool
    metrics_synced: bool
    scores_synced: bool
    ev_synced: bool
    compensation_synced: bool
    segments_synced: bool
    peers_synced: bool
    prices_synced: bool
    actions_synced: bool
    earnings_synced: bool
    insider_synced: bool
    estimates_synced: bool
    filings_synced: bool

    model_config = {"from_attributes": True}


class UniverseListResponse(BaseModel):
    total_matching: int
    limit: int
    offset: int
    items: list[UniverseRow]


class StaticFinancialsSlice(BaseModel):
    """One (data_category, period) bucket in static_financials for a symbol."""

    data_category: str
    period: str
    rows: int
    fiscal_year_min: int | None = None
    fiscal_year_max: int | None = None


class DateRangeStats(BaseModel):
    rows: int
    date_min: date | None = None
    date_max: date | None = None


class NamedCount(BaseModel):
    name: str
    rows: int


class SecFormInventory(BaseModel):
    form_type: str
    rows: int
    fiscal_year_min: int | None = None
    fiscal_year_max: int | None = None


class SymbolInventoryResponse(BaseModel):
    """
    What is stored for one ticker — counts and ranges only (no raw JSONB).
    Use SQL / per-table APIs if you need full payloads.
    """

    symbol: str
    universe: UniverseRow | None = Field(
        default=None, description="Row in stock_universe if present"
    )
    static_financials: list[StaticFinancialsSlice] = Field(default_factory=list)
    daily_prices: DateRangeStats
    corporate_actions: DateRangeStats
    corporate_actions_by_type: list[NamedCount] = Field(default_factory=list)
    earnings_calendar: DateRangeStats
    insider_trades: DateRangeStats
    analyst_estimates_by_kind: list[NamedCount] = Field(default_factory=list)
    sec_filings: list[SecFormInventory] = Field(default_factory=list)
