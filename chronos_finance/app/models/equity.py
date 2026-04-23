"""Equity offerings (secondary offerings, IPOs, follow-on) models."""

from datetime import date, datetime

from sqlalchemy import BigInteger, Date, DateTime, Float, Integer, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class EquityOffering(Base):
    """
    Equity offering events from FMP.

    Uses `/equity-offering-search` API which returns equity financing events
    like secondary offerings, follow-on offerings, etc.

    Unique constraint: (symbol, filing_date, offering_amount) to prevent duplicates.
    """

    __tablename__ = "equity_offerings"
    __table_args__ = (
        UniqueConstraint(
            "symbol", "filing_date", "offering_amount",
            name="uq_equity_offering",
            postgresql_nulls_not_distinct=True,
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    symbol: Mapped[str] = mapped_column(String(20), nullable=False)
    filing_date: Mapped[date | None] = mapped_column(Date)
    offering_date: Mapped[date | None] = mapped_column(Date, comment="Date of offering")
    offering_amount: Mapped[float | None] = mapped_column(Float, comment="Amount raised in USD")
    shares_offered: Mapped[int | None] = mapped_column(BigInteger, comment="Number of shares")
    offering_price: Mapped[float | None] = mapped_column(Float, comment="Price per share")
    offering_type: Mapped[str | None] = mapped_column(String(64), comment="Type of offering")
    raw_payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
