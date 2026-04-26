"""Read-only payloads for the /library UI (charts & tables)."""

from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, Field


class PriceBar(BaseModel):
    date: date
    open: float | None = None
    high: float | None = None
    low: float | None = None
    close: float | None = None
    adj_close: float | None = None
    volume: int | None = None


class PricesSeriesResponse(BaseModel):
    symbol: str
    rows: int
    items: list[PriceBar] = Field(default_factory=list)


class StaticCategoryInfo(BaseModel):
    data_category: str
    period: str
    rows: int
    fiscal_year_min: int | None = None
    fiscal_year_max: int | None = None


class StaticCategoriesResponse(BaseModel):
    symbol: str
    categories: list[StaticCategoryInfo] = Field(default_factory=list)


class StaticRow(BaseModel):
    fiscal_year: int
    fiscal_quarter: int | None = None
    raw_payload: dict[str, Any]


class StaticSeriesResponse(BaseModel):
    symbol: str
    data_category: str
    period: str
    rows: int
    items: list[StaticRow] = Field(default_factory=list)


class EarningsRow(BaseModel):
    date: date
    fiscal_period_end: date | None = None
    eps_estimated: float | None = None
    eps_actual: float | None = None
    revenue_estimated: float | None = None
    revenue_actual: float | None = None


class EarningsSeriesResponse(BaseModel):
    symbol: str
    rows: int
    items: list[EarningsRow] = Field(default_factory=list)


class CorporateActionRow(BaseModel):
    action_type: str
    action_date: date
    raw_payload: dict[str, Any]


class CorporateActionsResponse(BaseModel):
    symbol: str
    rows: int
    items: list[CorporateActionRow] = Field(default_factory=list)


class InsiderRow(BaseModel):
    filing_date: datetime | None = None
    transaction_date: date | None = None
    reporting_name: str | None = None
    transaction_type: str | None = None
    securities_transacted: float | None = None
    price: float | None = None


class InsiderSeriesResponse(BaseModel):
    symbol: str
    rows: int
    items: list[InsiderRow] = Field(default_factory=list)


class AnalystEstimateRow(BaseModel):
    kind: str
    ref_date: date | None = None
    published_date: date | None = None
    raw_payload: dict[str, Any]


class AnalystEstimatesResponse(BaseModel):
    symbol: str
    rows: int
    items: list[AnalystEstimateRow] = Field(default_factory=list)


class SecFilingMeta(BaseModel):
    id: int
    form_type: str
    fiscal_year: int
    fiscal_period: str
    filing_date: date | None = None
    content_keys_estimate: int | None = Field(
        default=None,
        description="Top-level key count in raw_content (rough size hint).",
    )


class SecFilingsListResponse(BaseModel):
    symbol: str
    rows: int
    items: list[SecFilingMeta] = Field(default_factory=list)


# =============================================================================
# Market Cap History (exposes daily_market_cap table)
# =============================================================================
class MarketCapItem(BaseModel):
    date: date
    market_cap: int | None = Field(default=None, description="Market cap in USD")


class MarketCapHistoryResponse(BaseModel):
    symbol: str
    rows: int
    items: list[MarketCapItem] = Field(default_factory=list)


# =============================================================================
# DCF Valuation (exposes valuation_dcf table)
# =============================================================================
class ValuationHistoryItem(BaseModel):
    date: date
    dcf: float | None = Field(default=None, description="DCF intrinsic value")
    stock_price: float | None = Field(default=None, description="Stock price at date")


class ValuationResponse(BaseModel):
    symbol: str
    latest_dcf: float | None = None
    latest_price: float | None = None
    upside_pct: float | None = Field(
        default=None,
        description="(dcf - price) / price * 100",
    )
    rows: int
    items: list[ValuationHistoryItem] = Field(default_factory=list)


# =============================================================================
# Dividend History (exposes dividend_calendar_global table)
# =============================================================================
class DividendItem(BaseModel):
    date: date
    dividend: float | None = None
    adjusted_dividend: float | None = None
    record_date: date | None = None
    payment_date: date | None = None
    declaration_date: date | None = None


class DividendHistoryResponse(BaseModel):
    symbol: str
    rows: int
    items: list[DividendItem] = Field(default_factory=list)


# =============================================================================
# Stock Split History (exposes split_calendar_global table)
# =============================================================================
class SplitItem(BaseModel):
    date: date
    numerator: float | None = None
    denominator: float | None = None
    ratio_str: str | None = Field(
        default=None,
        description="Human-readable ratio like '2:1'",
    )


class SplitHistoryResponse(BaseModel):
    symbol: str
    rows: int
    items: list[SplitItem] = Field(default_factory=list)
