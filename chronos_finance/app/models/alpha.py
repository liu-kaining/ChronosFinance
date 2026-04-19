"""Phase 5 — alpha signals & text data models."""

from datetime import date, datetime

from sqlalchemy import (
    Date,
    DateTime,
    Float,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class InsiderTrade(Base):
    """Form-4 insider transactions (Section 16 officers / directors / 10%+ owners)."""
    __tablename__ = "insider_trades"
    __table_args__ = (
        UniqueConstraint(
            "symbol", "filing_date", "transaction_date",
            "reporting_cik", "transaction_type", "securities_transacted",
            name="uq_insider_trade",
            postgresql_nulls_not_distinct=True,
        ),
        Index("ix_insider_trade_symbol_filing", "symbol", "filing_date"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    symbol: Mapped[str] = mapped_column(String(20), nullable=False)
    filing_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    transaction_date: Mapped[date | None] = mapped_column(Date)
    reporting_cik: Mapped[str | None] = mapped_column(String(20))
    reporting_name: Mapped[str | None] = mapped_column(String(255))
    transaction_type: Mapped[str | None] = mapped_column(String(32))
    securities_transacted: Mapped[float | None] = mapped_column(Float)
    price: Mapped[float | None] = mapped_column(Float)
    raw_payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class AnalystEstimate(Base):
    """
    Analyst consensus estimates AND price targets in one table.

    `kind` controls shape of `raw_payload`:
      - 'consensus_annual' / 'consensus_quarter' — EPS & revenue forecasts
      - 'price_target'                          — per-analyst price target publications
    """
    __tablename__ = "analyst_estimates"
    __table_args__ = (
        UniqueConstraint(
            "symbol", "kind", "ref_date", "published_date",
            name="uq_analyst_estimate",
            postgresql_nulls_not_distinct=True,
        ),
        Index("ix_analyst_estimate_symbol_kind", "symbol", "kind"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    symbol: Mapped[str] = mapped_column(String(20), nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    ref_date: Mapped[date | None] = mapped_column(Date)
    published_date: Mapped[date | None] = mapped_column(Date)
    raw_payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class SECFile(Base):
    """
    10-K / 10-Q structured JSON text blocks from FMP.
    `raw_content` holds the full section tree as returned by
    /financial-reports-json so downstream NLP can address any section.
    """
    __tablename__ = "sec_files"
    __table_args__ = (
        UniqueConstraint(
            "symbol", "form_type", "fiscal_year", "fiscal_period",
            name="uq_sec_file",
            postgresql_nulls_not_distinct=True,
        ),
        Index("ix_sec_file_symbol_form", "symbol", "form_type"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    symbol: Mapped[str] = mapped_column(String(20), nullable=False)
    form_type: Mapped[str] = mapped_column(String(16), nullable=False, comment="'10-K' or '10-Q'")
    fiscal_year: Mapped[int] = mapped_column(Integer, nullable=False)
    fiscal_period: Mapped[str] = mapped_column(String(4), nullable=False, comment="'FY' | 'Q1'..'Q4'")
    filing_date: Mapped[date | None] = mapped_column(Date)
    raw_content: Mapped[dict] = mapped_column(JSONB, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class StockNews(Base):
    """Symbol-linked news articles."""

    __tablename__ = "stock_news"
    __table_args__ = (
        UniqueConstraint(
            "symbol", "published_date", "url",
            name="uq_stock_news",
            postgresql_nulls_not_distinct=True,
        ),
        Index("ix_stock_news_symbol_published", "symbol", "published_date"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    symbol: Mapped[str] = mapped_column(String(20), nullable=False)
    published_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    title: Mapped[str | None] = mapped_column(String(500))
    site: Mapped[str | None] = mapped_column(String(120))
    url: Mapped[str | None] = mapped_column(String(1000))
    raw_payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class CompanyPressRelease(Base):
    """Symbol-linked company press releases."""

    __tablename__ = "company_press_releases"
    __table_args__ = (
        UniqueConstraint(
            "symbol", "published_date", "url",
            name="uq_company_press_release",
            postgresql_nulls_not_distinct=True,
        ),
        Index(
            "ix_company_press_release_symbol_published", "symbol", "published_date"
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    symbol: Mapped[str] = mapped_column(String(20), nullable=False)
    published_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    title: Mapped[str | None] = mapped_column(String(500))
    site: Mapped[str | None] = mapped_column(String(120))
    url: Mapped[str | None] = mapped_column(String(1000))
    raw_payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
