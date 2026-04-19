"""Pydantic schemas for the freshness/coverage read API."""

from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel


class FreshnessRow(BaseModel):
    dataset_key: str
    scope: str
    symbol: str | None = None
    status: str
    cursor_date: date | None = None
    cursor_value: str | None = None
    last_success_at: datetime | None = None
    fresh_until: datetime | None = None
    is_stale: bool = False
    records_written_total: int = 0


class FreshnessOverviewResponse(BaseModel):
    generated_at: datetime
    datasets_registered: int
    datasets_tracked: int
    datasets_stale: int
    items: list[FreshnessRow]


class SymbolFreshnessResponse(BaseModel):
    symbol: str
    generated_at: datetime
    items: list[FreshnessRow]


class CoverageGlobalEntry(BaseModel):
    dataset_key: str
    status: str
    cursor_date: date | None = None
    last_success_at: datetime | None = None
    records_written_total: int = 0


class CoverageGlobalResponse(BaseModel):
    generated_at: datetime
    items: list[CoverageGlobalEntry]


class CoverageSymbolEntry(BaseModel):
    dataset_key: str
    status: str
    cursor_date: date | None = None
    last_success_at: datetime | None = None
    records_written_total: int = 0


class CoverageSymbolResponse(BaseModel):
    symbol: str
    generated_at: datetime
    items: list[CoverageSymbolEntry]
