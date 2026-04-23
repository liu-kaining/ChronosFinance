from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, Float, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class StockUniverse(Base):
    __tablename__ = "stock_universe"

    symbol: Mapped[str] = mapped_column(String(20), primary_key=True)
    company_name: Mapped[str | None] = mapped_column(String(255))
    # stable returns full exchange names like "New York Stock Exchange" or
    # "NASDAQ Global Select Market"; v3 only returned short codes. Keep both
    # columns roomy so neither shape can blow up the insert.
    exchange: Mapped[str | None] = mapped_column(String(64), index=True)
    exchange_short_name: Mapped[str | None] = mapped_column(String(32))
    sector: Mapped[str | None] = mapped_column(String(100))
    industry: Mapped[str | None] = mapped_column(String(200))
    market_cap: Mapped[float | None]
    is_etf: Mapped[bool] = mapped_column(Boolean, default=False)
    is_actively_trading: Mapped[bool] = mapped_column(Boolean, default=True, index=True)

    # Share float data (Company Share Float API)
    free_float: Mapped[float | None] = mapped_column(Float, comment="free float percentage")
    float_shares: Mapped[int | None] = mapped_column(BigInteger, comment="float shares count")
    outstanding_shares: Mapped[int | None] = mapped_column(BigInteger, comment="total outstanding shares")

    # Resumable sync flags — flipped to True after that dataset
    # has been persisted for this symbol.
    # Phase 2 — core statements
    income_synced: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False, index=True
    )
    balance_synced: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False, index=True
    )
    cashflow_synced: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False, index=True
    )
    # Phase 3 — premium feature data
    ratios_synced: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False, index=True
    )
    metrics_synced: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False, index=True
    )
    scores_synced: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False, index=True
    )
    ev_synced: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False, index=True
    )
    compensation_synced: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False, index=True
    )
    segments_synced: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False, index=True
    )
    peers_synced: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False, index=True
    )
    # Phase 4 — market & corporate actions
    prices_synced: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False, index=True
    )
    actions_synced: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False, index=True
    )
    earnings_synced: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False, index=True
    )
    # Phase 5 — alpha signals & text
    insider_synced: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False, index=True
    )
    estimates_synced: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False, index=True
    )
    filings_synced: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False, index=True
    )
    # Phase 6 — premium datasets
    float_synced: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False, index=True
    )
    market_cap_synced: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False, index=True
    )
    dcf_synced: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False, index=True
    )

    raw_payload: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    def __repr__(self) -> str:
        return f"<StockUniverse {self.symbol} — {self.company_name}>"
