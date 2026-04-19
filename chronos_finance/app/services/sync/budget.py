"""Bandwidth budget guard for rolling-window usage control."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select

from app.core.config import get_settings
from app.core.database import async_session_factory
from app.models.sync_control import SyncRun


@dataclass(frozen=True)
class BandwidthUsage:
    window_days: int
    bytes_used: int
    bytes_limit: int

    @property
    def ratio(self) -> float:
        if self.bytes_limit <= 0:
            return 0.0
        return self.bytes_used / self.bytes_limit


@dataclass(frozen=True)
class BudgetDecision:
    throttled: bool
    reason: str | None = None
    usage_ratio: float = 0.0
    bytes_used: int = 0
    bytes_limit: int = 0


async def get_bandwidth_usage() -> BandwidthUsage:
    settings = get_settings()
    window_days = int(settings.FMP_BANDWIDTH_WINDOW_DAYS)
    bytes_limit = int(settings.FMP_BANDWIDTH_LIMIT_GB * 1024 * 1024 * 1024)
    cutoff = datetime.now(timezone.utc) - timedelta(days=window_days)

    async with async_session_factory() as session:
        stmt = select(func.coalesce(func.sum(SyncRun.bytes_estimated), 0)).where(
            SyncRun.started_at >= cutoff
        )
        result = await session.execute(stmt)
        used = int(result.scalar_one() or 0)
    return BandwidthUsage(window_days=window_days, bytes_used=used, bytes_limit=bytes_limit)


async def should_throttle(quota_class: str) -> BudgetDecision:
    """
    Decide if a dataset should be throttled under the current bandwidth usage.

    Policy:
    - ratio >= 1.00: throttle all classes
    - ratio >= medium threshold: throttle medium + heavy
    - ratio >= heavy threshold: throttle heavy only
    """
    settings = get_settings()
    usage = await get_bandwidth_usage()
    ratio = usage.ratio

    if ratio >= 1.0:
        return BudgetDecision(
            throttled=True,
            reason="rolling bandwidth budget exhausted",
            usage_ratio=ratio,
            bytes_used=usage.bytes_used,
            bytes_limit=usage.bytes_limit,
        )

    medium_threshold = float(settings.FMP_BANDWIDTH_MEDIUM_THROTTLE_RATIO)
    heavy_threshold = float(settings.FMP_BANDWIDTH_HEAVY_THROTTLE_RATIO)
    q = (quota_class or "").lower()

    if ratio >= medium_threshold and q in {"medium", "heavy"}:
        return BudgetDecision(
            throttled=True,
            reason="near bandwidth cap; medium/heavy throttled",
            usage_ratio=ratio,
            bytes_used=usage.bytes_used,
            bytes_limit=usage.bytes_limit,
        )
    if ratio >= heavy_threshold and q == "heavy":
        return BudgetDecision(
            throttled=True,
            reason="near bandwidth cap; heavy throttled",
            usage_ratio=ratio,
            bytes_used=usage.bytes_used,
            bytes_limit=usage.bytes_limit,
        )
    return BudgetDecision(
        throttled=False,
        usage_ratio=ratio,
        bytes_used=usage.bytes_used,
        bytes_limit=usage.bytes_limit,
    )
