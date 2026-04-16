from datetime import datetime

from pydantic import BaseModel


class StockUniverseOut(BaseModel):
    symbol: str
    company_name: str | None = None
    exchange: str | None = None
    exchange_short_name: str | None = None
    sector: str | None = None
    industry: str | None = None
    market_cap: float | None = None
    is_etf: bool = False
    is_actively_trading: bool = True
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}
