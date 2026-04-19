"""Dataset handlers driven by the orchestrator.

Each handler exposes a single async ``run(ctx)`` coroutine returning a
``DatasetResult``. Add new datasets as sibling modules and register them
in :mod:`app.services.sync.registry`.
"""

from app.services.sync.datasets import (
    daily_prices,
    earnings_calendar,
    global_reference,
    symbol_alpha,
    symbol_financials,
    symbol_events,
)

__all__ = [
    "daily_prices",
    "earnings_calendar",
    "global_reference",
    "symbol_alpha",
    "symbol_events",
    "symbol_financials",
]
