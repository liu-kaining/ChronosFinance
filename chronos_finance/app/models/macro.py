"""Phase 5 — macro-economic indicators (symbol-agnostic)."""

from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, PrimaryKeyConstraint, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class MacroEconomic(Base):
    """
    Macro time series (GDP, CPI, fed-funds rate, 10Y yield, etc.).
    Keyed by (series_id, date) so every indicator is an independent column family.
    """
    __tablename__ = "macro_economics"
    __table_args__ = (
        PrimaryKeyConstraint("series_id", "date", name="pk_macro_economics"),
    )

    series_id: Mapped[str] = mapped_column(String(64), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    value: Mapped[float | None] = mapped_column(Float)
    raw_payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class MacroSeriesCatalog(Base):
    """Catalog for macro/economic time-series IDs tracked by the system."""

    __tablename__ = "macro_series_catalog"
    __table_args__ = (
        PrimaryKeyConstraint("series_id", name="pk_macro_series_catalog"),
    )

    series_id: Mapped[str] = mapped_column(String(64), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(255))
    category: Mapped[str | None] = mapped_column(String(64))
    source: Mapped[str | None] = mapped_column(String(32))
    frequency: Mapped[str | None] = mapped_column(String(32))
    unit: Mapped[str | None] = mapped_column(String(64))
    raw_payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class TreasuryRateWide(Base):
    """Daily treasury rates in wide format from FMP /treasury-rates."""

    __tablename__ = "treasury_rates_wide"
    __table_args__ = (
        PrimaryKeyConstraint("date", name="pk_treasury_rates_wide"),
    )

    date: Mapped[date] = mapped_column(Date, nullable=False)
    month1: Mapped[float | None] = mapped_column(Float)
    month2: Mapped[float | None] = mapped_column(Float)
    month3: Mapped[float | None] = mapped_column(Float)
    month6: Mapped[float | None] = mapped_column(Float)
    year1: Mapped[float | None] = mapped_column(Float)
    year2: Mapped[float | None] = mapped_column(Float)
    year3: Mapped[float | None] = mapped_column(Float)
    year5: Mapped[float | None] = mapped_column(Float)
    year7: Mapped[float | None] = mapped_column(Float)
    year10: Mapped[float | None] = mapped_column(Float)
    year20: Mapped[float | None] = mapped_column(Float)
    year30: Mapped[float | None] = mapped_column(Float)
    raw_payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
