"""Historical employee count models."""

from datetime import date, datetime

from sqlalchemy import BigInteger, Date, DateTime, Float, PrimaryKeyConstraint, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class CompanyEmployeesHistory(Base):
    """
    Historical employee count per symbol from FMP.

    Uses `/historical/employee_count` API which returns employee headcount
    over time, useful for tracking company growth and workforce changes.

    Primary key: (symbol, date) — one row per symbol per reporting date.
    """

    __tablename__ = "company_employees_history"
    __table_args__ = (
        PrimaryKeyConstraint("symbol", "date", name="pk_company_employees_history"),
    )

    symbol: Mapped[str] = mapped_column(String(20), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    employee_count: Mapped[int | None] = mapped_column(BigInteger, comment="Number of employees")
    raw_payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
