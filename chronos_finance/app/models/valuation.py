"""Historical daily DCF valuation models."""

from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, Index, PrimaryKeyConstraint, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class ValuationDCF(Base):
    """
    Historical daily DCF valuation data from FMP.

    Uses `/historical-discounted-cash-flow` API which returns one DCF value
    per trading day, allowing tracking of intrinsic value vs. market price
    over time (the "valuation thermometer").

    Primary key: (symbol, date) — one row per symbol per trading day.
    """

    __tablename__ = "valuation_dcf"
    __table_args__ = (
        PrimaryKeyConstraint("symbol", "date", name="pk_valuation_dcf"),
        Index("ix_valuation_dcf_date", "date"),
    )

    symbol: Mapped[str] = mapped_column(String(20), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    dcf: Mapped[float | None] = mapped_column(Float, comment="DCF intrinsic value per share")
    stock_price: Mapped[float | None] = mapped_column(Float, comment="Stock price on this date")
    raw_payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
