"""Dataset handler: ``symbol.share_float``.

Pulls share-float data from FMP ``/shares-float`` and updates the
``stock_universe`` table's float columns in place.
"""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.core.database import async_session_factory
from app.models.stock_universe import StockUniverse
from app.services.sync.datasets._shared import as_list, safe_float, safe_int
from app.services.sync.orchestrator import DatasetContext, DatasetResult
from app.services.sync.utils import content_hash, estimate_bytes
from app.utils.fmp_client import fmp_client

logger = logging.getLogger(__name__)


async def run(ctx: DatasetContext) -> DatasetResult:
    symbol = ctx.symbol

    payload = await fmp_client.get("/shares-float", params={"symbol": symbol})
    entries = as_list(payload)
    entry = entries[0] if entries else (payload if isinstance(payload, dict) else None)

    payload_hash = content_hash(entries or payload)
    bytes_estimated = estimate_bytes(entries or payload)

    if not entry:
        return DatasetResult(
            requests_count=1,
            bytes_estimated=bytes_estimated,
            content_hash=payload_hash,
            skipped_reason="empty",
            details={"payload_entries": 0},
        )

    if (
        ctx.previous_state is not None
        and ctx.previous_state.content_hash_last == payload_hash
    ):
        return DatasetResult(
            requests_count=1,
            bytes_estimated=bytes_estimated,
            content_hash=payload_hash,
            skipped_reason="unchanged",
            details={"payload_entries": len(entries)},
        )

    free_float = safe_float(entry.get("freeFloat"))
    float_shares = safe_int(entry.get("floatShares"))
    outstanding = safe_int(entry.get("outstandingShares"))

    async with async_session_factory() as session:
        await session.execute(
            update(StockUniverse)
            .where(StockUniverse.symbol == symbol)
            .values(
                free_float=free_float,
                float_shares=float_shares,
                outstanding_shares=outstanding,
            )
        )
        await session.commit()

    return DatasetResult(
        records_written=1,
        bytes_estimated=bytes_estimated,
        requests_count=1,
        content_hash=payload_hash,
        details={
            "free_float": free_float,
            "float_shares": float_shares,
            "outstanding_shares": outstanding,
        },
    )
