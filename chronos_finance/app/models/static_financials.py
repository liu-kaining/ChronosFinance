from datetime import datetime

from sqlalchemy import DateTime, Integer, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class StaticFinancials(Base):
    __tablename__ = "static_financials"
    __table_args__ = (
        UniqueConstraint(
            "symbol", "data_category", "period", "fiscal_year",
            name="uq_static_financials_key",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    symbol: Mapped[str] = mapped_column(String(20), index=True, nullable=False)
    data_category: Mapped[str] = mapped_column(
        String(80), nullable=False, comment="e.g. income_statement, balance_sheet, cash_flow, ratios, key_metrics"
    )
    period: Mapped[str] = mapped_column(
        String(10), nullable=False, comment="annual / quarter"
    )
    fiscal_year: Mapped[int] = mapped_column(Integer, nullable=False)
    fiscal_quarter: Mapped[int | None] = mapped_column(Integer)
    raw_payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    def __repr__(self) -> str:
        return f"<StaticFinancials {self.symbol}/{self.data_category}/{self.period}/{self.fiscal_year}>"
