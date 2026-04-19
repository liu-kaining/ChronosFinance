"""
Sync control-plane tables — defined by the data re-architecture spec
(see spec/DATA_REARCHITECTURE_PLAN_CN.md §6.4).

Three tables:

* ``sync_datasets``   registry of known datasets, seeded at startup.
* ``sync_state``      per-(dataset, symbol) freshness and cursor state.
                      ``symbol`` is empty string "" for global datasets so it
                      can participate in the primary key safely.
* ``sync_runs``       execution log (one row per run attempt).

These tables are the single source of truth for:

  - "what data do we have"          → sync_state.cursor_*, records_written
  - "how fresh is it"               → sync_state.last_success_at, fresh_until
  - "what changed last time"        → sync_state.content_hash_last
  - "why did the last run fail"     → sync_state.status, error_message,
                                      sync_runs.error_message
"""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Date,
    DateTime,
    Index,
    Integer,
    PrimaryKeyConstraint,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


# Sentinel used for the ``symbol`` column on global datasets. We cannot use
# NULL because PostgreSQL treats NULLs as distinct in primary keys / unique
# constraints, which would allow duplicate global rows to accumulate.
GLOBAL_SYMBOL_SENTINEL = ""


class SyncDataset(Base):
    """
    Registry of datasets known to the orchestrator.

    A dataset is the minimal scheduling unit. Rows here are seeded from
    ``app.services.sync.registry`` on startup and are safe to update in place
    as the registry evolves.
    """

    __tablename__ = "sync_datasets"

    dataset_key: Mapped[str] = mapped_column(String(128), primary_key=True)

    scope: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        comment="'global' or 'symbol'",
    )
    description: Mapped[str | None] = mapped_column(String(500))

    cadence_seconds: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        comment="Target refresh cadence in seconds.",
    )
    cursor_strategy: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        comment="'date' | 'fiscal_period' | 'snapshot' | 'event_window' | 'custom'",
    )
    quota_class: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        comment="'light' | 'medium' | 'heavy'",
    )
    priority_tier: Mapped[str] = mapped_column(
        String(8),
        nullable=False,
        default="P0",
        server_default="P0",
        comment="P0 / P1 / P2",
    )

    enabled: Mapped[bool] = mapped_column(
        nullable=False,
        default=True,
        server_default="true",
    )

    config: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
        server_default="{}",
        comment="Dataset-specific knobs (endpoint, params, lookback days, etc.).",
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class SyncState(Base):
    """
    Per-(dataset, symbol) freshness state. For global datasets the ``symbol``
    column is set to the empty-string sentinel so ``(dataset_key, symbol)``
    remains a clean primary key.
    """

    __tablename__ = "sync_state"
    __table_args__ = (
        PrimaryKeyConstraint("dataset_key", "symbol", name="pk_sync_state"),
        Index("ix_sync_state_last_success_at", "last_success_at"),
        Index("ix_sync_state_fresh_until", "fresh_until"),
        Index("ix_sync_state_status", "status"),
    )

    dataset_key: Mapped[str] = mapped_column(String(128), nullable=False)
    symbol: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default=GLOBAL_SYMBOL_SENTINEL,
        server_default="''",
        comment="Empty string for global datasets.",
    )

    # Cursors — only the relevant one is populated depending on the
    # dataset's cursor_strategy. We keep both to avoid schema churn.
    cursor_date: Mapped[date | None] = mapped_column(Date)
    cursor_value: Mapped[str | None] = mapped_column(String(64))

    status: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        default="idle",
        server_default="'idle'",
        comment="idle | running | ok | failed | throttled",
    )
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    fresh_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        comment="Hint for when the dataset is expected to go stale.",
    )

    records_written: Mapped[int] = mapped_column(
        BigInteger, nullable=False, default=0, server_default="0"
    )
    records_written_total: Mapped[int] = mapped_column(
        BigInteger, nullable=False, default=0, server_default="0"
    )
    bytes_estimated: Mapped[int] = mapped_column(
        BigInteger, nullable=False, default=0, server_default="0"
    )
    bytes_estimated_total: Mapped[int] = mapped_column(
        BigInteger, nullable=False, default=0, server_default="0"
    )
    requests_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    requests_count_total: Mapped[int] = mapped_column(
        BigInteger, nullable=False, default=0, server_default="0"
    )

    content_hash_last: Mapped[str | None] = mapped_column(String(64))
    error_message: Mapped[str | None] = mapped_column(Text)
    meta: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
        server_default="{}",
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class SyncRun(Base):
    """Execution log (one row per dataset/symbol attempt)."""

    __tablename__ = "sync_runs"
    __table_args__ = (
        Index("ix_sync_runs_started_at", "started_at"),
        Index("ix_sync_runs_dataset", "dataset_key", "started_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    dataset_key: Mapped[str] = mapped_column(String(128), nullable=False)
    symbol: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default=GLOBAL_SYMBOL_SENTINEL,
        server_default="''",
    )
    trigger: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        default="manual",
        server_default="'manual'",
        comment="manual | scheduler | backfill | reconcile",
    )

    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="running", server_default="'running'"
    )
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    records_written: Mapped[int] = mapped_column(
        BigInteger, nullable=False, default=0, server_default="0"
    )
    bytes_estimated: Mapped[int] = mapped_column(
        BigInteger, nullable=False, default=0, server_default="0"
    )
    requests_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )

    cursor_before: Mapped[str | None] = mapped_column(String(64))
    cursor_after: Mapped[str | None] = mapped_column(String(64))
    content_hash: Mapped[str | None] = mapped_column(String(64))
    error_message: Mapped[str | None] = mapped_column(Text)
    details: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict, server_default="{}"
    )
