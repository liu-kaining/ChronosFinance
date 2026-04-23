"""Historical daily market capitalisation per symbol."""

from datetime import date, datetime

from sqlalchemy import BigInteger, Date, DateTime, Float, Index, PrimaryKeyConstraint, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class DailyMarketCap(Base):
    """
    Daily market-cap snapshots from FMP ``/historical-market-capitalization``.

    Keyed by (symbol, date) — exactly the same grain as ``daily_prices``.
    """

    __tablename__ = "daily_market_cap"
    __table_args__ = (
        PrimaryKeyConstraint("symbol", "date", name="pk_daily_market_cap"),
        Index("ix_daily_market_cap_date", "date"),
    )

    symbol: Mapped[str] = mapped_column(String(20), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    market_cap: Mapped[float | None] = mapped_column(BigInteger)
    raw_payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
