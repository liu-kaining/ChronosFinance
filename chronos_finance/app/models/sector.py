"""Sector-level performance and valuation time series."""

from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, Index, PrimaryKeyConstraint, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class SectorPerformanceSeries(Base):
    """
    Historical sector performance and valuation data, aggregated from:
    - ``/historical-sectors-performance`` (daily return %)
    - ``/sector_price_earning_ratio`` (trailing P/E)

    One row per (sector, date, metric).
    ``metric`` discriminator allows performance and PE data to coexist cleanly.
    """

    __tablename__ = "sector_performance_series"
    __table_args__ = (
        PrimaryKeyConstraint("sector", "date", "metric", name="pk_sector_performance"),
        Index("ix_sector_performance_date", "date"),
        Index("ix_sector_performance_sector", "sector"),
    )

    sector: Mapped[str] = mapped_column(String(100), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    metric: Mapped[str] = mapped_column(
        String(32), nullable=False, comment="'return_pct' or 'pe_ratio'"
    )
    value: Mapped[float | None] = mapped_column(Float)
    raw_payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
