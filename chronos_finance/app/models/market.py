"""Phase 4 — market & corporate-action data models."""

from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Date,
    DateTime,
    Float,
    Index,
    Integer,
    PrimaryKeyConstraint,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class DailyPrice(Base):
    """Historical daily OHLCV bars. ~7500 rows per US symbol for 30-year history."""
    __tablename__ = "daily_prices"
    __table_args__ = (
        PrimaryKeyConstraint("symbol", "date", name="pk_daily_prices"),
        Index("ix_daily_prices_date", "date"),
    )

    symbol: Mapped[str] = mapped_column(String(20), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    open: Mapped[float | None] = mapped_column(Float)
    high: Mapped[float | None] = mapped_column(Float)
    low: Mapped[float | None] = mapped_column(Float)
    close: Mapped[float | None] = mapped_column(Float)
    adj_close: Mapped[float | None] = mapped_column(Float)
    volume: Mapped[int | None] = mapped_column(BigInteger)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class CorporateAction(Base):
    """Dividends and stock splits in a single normalized table."""
    __tablename__ = "corporate_actions"
    __table_args__ = (
        UniqueConstraint(
            "symbol", "action_type", "action_date",
            name="uq_corporate_action",
            postgresql_nulls_not_distinct=True,
        ),
        Index("ix_corporate_action_symbol_date", "symbol", "action_date"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    symbol: Mapped[str] = mapped_column(String(20), nullable=False)
    action_type: Mapped[str] = mapped_column(
        String(16), nullable=False, comment="'dividend' or 'split'"
    )
    action_date: Mapped[date] = mapped_column(Date, nullable=False)
    raw_payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class EarningsCalendar(Base):
    """Historical earnings-announcement schedule with est./actual EPS & revenue."""
    __tablename__ = "earnings_calendar"
    __table_args__ = (
        PrimaryKeyConstraint("symbol", "date", name="pk_earnings_calendar"),
        Index("ix_earnings_calendar_date", "date"),
    )

    symbol: Mapped[str] = mapped_column(String(20), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    fiscal_period_end: Mapped[date | None] = mapped_column(Date)
    eps_estimated: Mapped[float | None] = mapped_column(Float)
    eps_actual: Mapped[float | None] = mapped_column(Float)
    revenue_estimated: Mapped[float | None] = mapped_column(Float)
    revenue_actual: Mapped[float | None] = mapped_column(Float)
    raw_payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class DividendCalendarGlobal(Base):
    """Global dividend events calendar."""

    __tablename__ = "dividend_calendar_global"
    __table_args__ = (
        PrimaryKeyConstraint("symbol", "date", name="pk_dividend_calendar_global"),
        Index("ix_dividend_calendar_global_date", "date"),
    )

    symbol: Mapped[str] = mapped_column(String(20), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    dividend: Mapped[float | None] = mapped_column(Float)
    adjusted_dividend: Mapped[float | None] = mapped_column(Float)
    record_date: Mapped[date | None] = mapped_column(Date)
    payment_date: Mapped[date | None] = mapped_column(Date)
    declaration_date: Mapped[date | None] = mapped_column(Date)
    raw_payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class SplitCalendarGlobal(Base):
    """Global stock split events calendar."""

    __tablename__ = "split_calendar_global"
    __table_args__ = (
        PrimaryKeyConstraint("symbol", "date", name="pk_split_calendar_global"),
        Index("ix_split_calendar_global_date", "date"),
    )

    symbol: Mapped[str] = mapped_column(String(20), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    numerator: Mapped[float | None] = mapped_column(Float)
    denominator: Mapped[float | None] = mapped_column(Float)
    raw_payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class IPOCalendar(Base):
    """Global IPO calendar."""

    __tablename__ = "ipo_calendar"
    __table_args__ = (
        PrimaryKeyConstraint("symbol", "date", name="pk_ipo_calendar"),
        Index("ix_ipo_calendar_date", "date"),
    )

    symbol: Mapped[str] = mapped_column(String(20), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    company_name: Mapped[str | None] = mapped_column(String(255))
    exchange: Mapped[str | None] = mapped_column(String(64))
    price_range: Mapped[str | None] = mapped_column(String(64))
    shares: Mapped[int | None] = mapped_column(BigInteger)
    raw_payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class EconomicCalendar(Base):
    """Global economics release calendar."""

    __tablename__ = "economic_calendar"
    __table_args__ = (
        PrimaryKeyConstraint(
            "date", "event", "country", "currency", name="pk_economic_calendar"
        ),
        Index("ix_economic_calendar_date", "date"),
    )

    date: Mapped[date] = mapped_column(Date, nullable=False)
    event: Mapped[str] = mapped_column(String(255), nullable=False)
    country: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    currency: Mapped[str] = mapped_column(String(16), nullable=False, default="")
    actual: Mapped[str | None] = mapped_column(String(64))
    previous: Mapped[str | None] = mapped_column(String(64))
    estimate: Mapped[str | None] = mapped_column(String(64))
    raw_payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
