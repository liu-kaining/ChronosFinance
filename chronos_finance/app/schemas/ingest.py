"""Pydantic schemas for the ingestion (write-side) API."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, Field


class IngestTriggerResponse(BaseModel):
    status: str
    dataset_key: str
    message: str
    symbols_queued: int | None = None


class DatasetSummary(BaseModel):
    dataset_key: str
    scope: str
    description: str | None = None
    cadence_seconds: int
    cursor_strategy: str
    quota_class: str
    priority_tier: str
    enabled: bool


class DatasetListResponse(BaseModel):
    datasets: list[DatasetSummary]


class SyncStateRow(BaseModel):
    dataset_key: str
    symbol: str | None = None
    status: str
    cursor_date: date | None = None
    cursor_value: str | None = None
    last_attempt_at: datetime | None = None
    last_success_at: datetime | None = None
    fresh_until: datetime | None = None
    records_written_total: int = 0
    bytes_estimated_total: int = 0
    requests_count_total: int = 0
    content_hash_last: str | None = None
    error_message: str | None = None


class SyncStateListResponse(BaseModel):
    total: int
    items: list[SyncStateRow]


class SyncRunRow(BaseModel):
    id: int
    dataset_key: str
    symbol: str | None = None
    trigger: str
    status: str
    started_at: datetime
    finished_at: datetime | None = None
    records_written: int = 0
    bytes_estimated: int = 0
    requests_count: int = 0
    cursor_before: str | None = None
    cursor_after: str | None = None
    content_hash: str | None = None
    error_message: str | None = None
    details: dict[str, Any] = Field(default_factory=dict)


class SyncRunListResponse(BaseModel):
    total: int
    items: list[SyncRunRow]


class BandwidthBudgetResponse(BaseModel):
    window_days: int
    bytes_used: int
    bytes_limit: int
    usage_ratio: float
    heavy_throttle_ratio: float
    medium_throttle_ratio: float
