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
