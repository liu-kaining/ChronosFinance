"""
Dataset registry — the single source of truth for what the orchestrator
knows how to run.

Rows are upserted into ``sync_datasets`` on startup via :func:`seed_registry`,
so the registry can evolve in code without manual DB steps. A row stays in
``sync_datasets`` even if removed from this file, but ``enabled`` will be
flipped to ``False`` so the scheduler skips it.

Each :class:`DatasetSpec` describes:

* ``key``              globally unique dataset identifier.
* ``scope``            ``"global"`` or ``"symbol"``.
* ``handler``          async callable ``handler(ctx) -> DatasetResult``.
* ``cadence_seconds``  target refresh cadence.
* ``cursor_strategy``  informational marker for UI / tooling.
* ``quota_class``      ``"light" | "medium" | "heavy"`` — used later by the
                       bandwidth-aware scheduler.
* ``priority_tier``    ``"P0" | "P1" | "P2"``.
* ``config``           optional dataset-specific knobs persisted to DB.

The actual handlers live under :mod:`app.services.sync.datasets`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, TYPE_CHECKING

from sqlalchemy import update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.core.database import async_session_factory
from app.models.sync_control import SyncDataset

if TYPE_CHECKING:  # pragma: no cover — typing-only import
    from app.services.sync.orchestrator import DatasetContext, DatasetResult


DatasetHandler = Callable[["DatasetContext"], Awaitable["DatasetResult"]]


@dataclass(frozen=True)
class DatasetSpec:
    key: str
    scope: str  # "global" or "symbol"
    handler: DatasetHandler
    cadence_seconds: int
    cursor_strategy: str  # date | fiscal_period | snapshot | event_window | custom
    quota_class: str = "light"
    priority_tier: str = "P0"
    description: str = ""
    config: dict[str, Any] = field(default_factory=dict)
    # StockUniverse column name for backward-compatible legacy sync flag.
    # When set, the orchestrator flips this boolean flag to True on success
    # so the legacy /api/v1/sync/* routes stay consistent.
    legacy_flag: str | None = None


# --- Handler imports are done lazily to avoid circular imports at module
# load time — the orchestrator imports the registry, and the dataset
# modules import the orchestrator's types.
def _build_registry() -> list[DatasetSpec]:
    from app.services.sync.datasets import (
        daily_market_cap,
        daily_prices,
        earnings_calendar,
        employees_history,
        equity_offerings,
        global_reference,
        sec_filings_ext,
        sector_performance,
        share_float,
        symbol_alpha,
        symbol_financials,
        valuation_dcf,
        symbol_events,
    )

    return [
        DatasetSpec(
            key="global.earnings_calendar",
            scope="global",
            handler=earnings_calendar.run,
            cadence_seconds=3 * 3600,
            cursor_strategy="date",
            quota_class="light",
            priority_tier="P0",
            description="Global earnings calendar (FMP /earnings-calendar).",
            config={
                "endpoint": "/earnings-calendar",
                "lookback_days": 14,
                "lookahead_days": 90,
            },
        ),
        DatasetSpec(
            key="symbol.daily_prices",
            scope="symbol",
            handler=daily_prices.run,
            cadence_seconds=3 * 3600,
            cursor_strategy="date",
            quota_class="medium",
            priority_tier="P0",
            description="Daily OHLCV bars per symbol (FMP /historical-price-eod/full).",
            config={
                "endpoint": "/historical-price-eod/full",
                "overlap_days": 5,
            },
            legacy_flag="prices_synced",
        ),
        DatasetSpec(
            key="symbol.corporate_actions",
            scope="symbol",
            handler=symbol_events.run_symbol_corporate_actions,
            cadence_seconds=3 * 3600,
            cursor_strategy="date",
            quota_class="light",
            priority_tier="P0",
            description="Symbol dividends + splits history.",
            config={"overlap_days": 30},
            legacy_flag="actions_synced",
        ),
        DatasetSpec(
            key="symbol.earnings_history",
            scope="symbol",
            handler=symbol_events.run_symbol_earnings_history,
            cadence_seconds=3 * 3600,
            cursor_strategy="date",
            quota_class="light",
            priority_tier="P0",
            description="Symbol earnings history from /earnings.",
            legacy_flag="earnings_synced",
        ),
        DatasetSpec(
            key="symbol.financials.income_statement",
            scope="symbol",
            handler=symbol_financials.run_income_statements,
            cadence_seconds=3 * 3600,
            cursor_strategy="fiscal_period",
            quota_class="medium",
            priority_tier="P0",
            description="Annual income statements -> static_financials.",
            legacy_flag="income_synced",
        ),
        DatasetSpec(
            key="symbol.financials.balance_sheet",
            scope="symbol",
            handler=symbol_financials.run_balance_sheets,
            cadence_seconds=3 * 3600,
            cursor_strategy="fiscal_period",
            quota_class="medium",
            priority_tier="P0",
            description="Annual balance sheets -> static_financials.",
            legacy_flag="balance_synced",
        ),
        DatasetSpec(
            key="symbol.financials.cash_flow",
            scope="symbol",
            handler=symbol_financials.run_cashflow_statements,
            cadence_seconds=3 * 3600,
            cursor_strategy="fiscal_period",
            quota_class="medium",
            priority_tier="P0",
            description="Annual cash flow statements -> static_financials.",
            legacy_flag="cashflow_synced",
        ),
        DatasetSpec(
            key="symbol.financials.ratios",
            scope="symbol",
            handler=symbol_financials.run_financial_ratios,
            cadence_seconds=3 * 3600,
            cursor_strategy="fiscal_period",
            quota_class="medium",
            priority_tier="P0",
            description="Annual ratios -> static_financials.",
            legacy_flag="ratios_synced",
        ),
        DatasetSpec(
            key="symbol.financials.metrics",
            scope="symbol",
            handler=symbol_financials.run_key_metrics,
            cadence_seconds=3 * 3600,
            cursor_strategy="fiscal_period",
            quota_class="medium",
            priority_tier="P0",
            description="Annual key metrics -> static_financials.",
            legacy_flag="metrics_synced",
        ),
        DatasetSpec(
            key="symbol.financials.scores",
            scope="symbol",
            handler=symbol_financials.run_financial_scores,
            cadence_seconds=3 * 3600,
            cursor_strategy="snapshot",
            quota_class="light",
            priority_tier="P1",
            description="Financial scores snapshot -> static_financials.",
            legacy_flag="scores_synced",
        ),
        DatasetSpec(
            key="symbol.financials.enterprise_values",
            scope="symbol",
            handler=symbol_financials.run_enterprise_values,
            cadence_seconds=3 * 3600,
            cursor_strategy="fiscal_period",
            quota_class="medium",
            priority_tier="P0",
            description="Annual enterprise values -> static_financials.",
            legacy_flag="ev_synced",
        ),
        DatasetSpec(
            key="symbol.financials.executive_compensation",
            scope="symbol",
            handler=symbol_financials.run_executive_compensation,
            cadence_seconds=24 * 3600,
            cursor_strategy="fiscal_period",
            quota_class="medium",
            priority_tier="P1",
            description="Executive compensation grouped by fiscal year.",
            legacy_flag="compensation_synced",
        ),
        DatasetSpec(
            key="symbol.financials.revenue_segmentation",
            scope="symbol",
            handler=symbol_financials.run_revenue_segmentation,
            cadence_seconds=24 * 3600,
            cursor_strategy="fiscal_period",
            quota_class="medium",
            priority_tier="P1",
            description="Product + geographic revenue segmentation.",
            legacy_flag="segments_synced",
        ),
        DatasetSpec(
            key="symbol.financials.stock_peers",
            scope="symbol",
            handler=symbol_financials.run_stock_peers,
            cadence_seconds=24 * 3600,
            cursor_strategy="snapshot",
            quota_class="light",
            priority_tier="P1",
            description="Stock peers snapshot.",
            legacy_flag="peers_synced",
        ),
        DatasetSpec(
            key="symbol.alpha.insider_trades",
            scope="symbol",
            handler=symbol_alpha.run_insider_trades,
            cadence_seconds=6 * 3600,
            cursor_strategy="event_window",
            quota_class="medium",
            priority_tier="P1",
            description="Insider trades (paginated).",
            config={"max_pages": 5},
            legacy_flag="insider_synced",
        ),
        DatasetSpec(
            key="symbol.alpha.analyst_estimates",
            scope="symbol",
            handler=symbol_alpha.run_analyst_estimates,
            cadence_seconds=6 * 3600,
            cursor_strategy="snapshot",
            quota_class="medium",
            priority_tier="P1",
            description="Analyst estimates + price target consensus.",
            legacy_flag="estimates_synced",
        ),
        DatasetSpec(
            key="symbol.alpha.sec_filings_10k",
            scope="symbol",
            handler=symbol_alpha.run_sec_filings,
            cadence_seconds=24 * 3600,
            cursor_strategy="fiscal_period",
            quota_class="heavy",
            priority_tier="P2",
            description="SEC financial reports JSON (10-K).",
            config={"years": 5, "form_type": "10-K"},
            legacy_flag="filings_synced",
        ),
        DatasetSpec(
            key="symbol.alpha.stock_news",
            scope="symbol",
            handler=symbol_alpha.run_stock_news,
            cadence_seconds=6 * 3600,
            cursor_strategy="event_window",
            quota_class="heavy",
            priority_tier="P2",
            description="Stock news feed per symbol.",
            config={"limit": 200},
        ),
        DatasetSpec(
            key="symbol.alpha.press_releases",
            scope="symbol",
            handler=symbol_alpha.run_press_releases,
            cadence_seconds=12 * 3600,
            cursor_strategy="event_window",
            quota_class="heavy",
            priority_tier="P2",
            description="Company press releases per symbol.",
            config={"limit": 200},
        ),

        # ── Phase 6 — premium datasets ──────────────────────────────
        DatasetSpec(
            key="symbol.daily_market_cap",
            scope="symbol",
            handler=daily_market_cap.run,
            cadence_seconds=6 * 3600,
            cursor_strategy="date",
            quota_class="medium",
            priority_tier="P1",
            description="Historical daily market capitalisation per symbol.",
            config={"overlap_days": 5, "limit": 5000},
            legacy_flag="market_cap_synced",
        ),
        DatasetSpec(
            key="symbol.share_float",
            scope="symbol",
            handler=share_float.run,
            cadence_seconds=24 * 3600,
            cursor_strategy="snapshot",
            quota_class="light",
            priority_tier="P1",
            description="Company share float data -> stock_universe float columns.",
            legacy_flag="float_synced",
        ),
        DatasetSpec(
            key="symbol.alpha.sec_filings_10q",
            scope="symbol",
            handler=sec_filings_ext.run_10q,
            cadence_seconds=24 * 3600,
            cursor_strategy="fiscal_period",
            quota_class="heavy",
            priority_tier="P2",
            description="10-Q quarterly filings structured JSON -> sec_files.",
            config={"years": 3},
        ),
        DatasetSpec(
            key="symbol.alpha.sec_filings_8k",
            scope="symbol",
            handler=sec_filings_ext.run_8k,
            cadence_seconds=12 * 3600,
            cursor_strategy="event_window",
            quota_class="medium",
            priority_tier="P2",
            description="8-K current-event filings metadata -> sec_files.",
            config={"limit": 200},
        ),
        DatasetSpec(
            key="symbol.valuation.dcf",
            scope="symbol",
            handler=valuation_dcf.run,
            cadence_seconds=24 * 3600,
            cursor_strategy="date",
            quota_class="medium",
            priority_tier="P1",
            description="Historical daily DCF valuation per symbol (valuation thermometer).",
            config={"overlap_days": 5, "limit": 5000},
            legacy_flag="dcf_synced",
        ),
        DatasetSpec(
            key="symbol.company_employees_history",
            scope="symbol",
            handler=employees_history.run,
            cadence_seconds=24 * 3600,
            cursor_strategy="date",
            quota_class="light",
            priority_tier="P1",
            description="Historical employee count per symbol.",
            config={"overlap_days": 30, "limit": 5000},
        ),
        DatasetSpec(
            key="symbol.alpha.equity_offerings",
            scope="symbol",
            handler=equity_offerings.run,
            cadence_seconds=24 * 3600,
            cursor_strategy="date",
            quota_class="light",
            priority_tier="P1",
            description="Equity offering events (secondary offerings, follow-on).",
            config={"overlap_days": 30, "limit": 1000},
        ),

        DatasetSpec(
            key="global.dividends_calendar",
            scope="global",
            handler=global_reference.run_dividends_calendar,
            cadence_seconds=3 * 3600,
            cursor_strategy="date",
            quota_class="light",
            priority_tier="P0",
            description="Global dividends events calendar.",
            config={
                "endpoint": "/dividends-calendar",
                "lookback_days": 30,
                "lookahead_days": 365,
            },
        ),
        DatasetSpec(
            key="global.splits_calendar",
            scope="global",
            handler=global_reference.run_splits_calendar,
            cadence_seconds=3 * 3600,
            cursor_strategy="date",
            quota_class="light",
            priority_tier="P0",
            description="Global stock splits calendar.",
            config={
                "endpoint": "/splits-calendar",
                "lookback_days": 30,
                "lookahead_days": 365,
            },
        ),
        DatasetSpec(
            key="global.ipos_calendar",
            scope="global",
            handler=global_reference.run_ipos_calendar,
            cadence_seconds=12 * 3600,
            cursor_strategy="date",
            quota_class="light",
            priority_tier="P1",
            description="Global IPO calendar.",
            config={
                "endpoint": "/ipos-calendar",
                "lookback_days": 30,
                "lookahead_days": 365,
            },
        ),
        DatasetSpec(
            key="global.economic_calendar",
            scope="global",
            handler=global_reference.run_economic_calendar,
            cadence_seconds=3 * 3600,
            cursor_strategy="date",
            quota_class="light",
            priority_tier="P0",
            description="Global economic events calendar.",
            config={
                "endpoint": "/economic-calendar",
                "lookback_days": 14,
                "lookahead_days": 180,
            },
        ),
        DatasetSpec(
            key="global.treasury_rates_wide",
            scope="global",
            handler=global_reference.run_treasury_rates,
            cadence_seconds=3 * 3600,
            cursor_strategy="date",
            quota_class="light",
            priority_tier="P0",
            description="US treasury rates in wide shape from /treasury-rates.",
            config={"endpoint": "/treasury-rates"},
        ),
        DatasetSpec(
            key="global.macro_economics",
            scope="global",
            handler=global_reference.run_macro_economics,
            cadence_seconds=3 * 3600,
            cursor_strategy="date",
            quota_class="medium",
            priority_tier="P0",
            description="Macro economic series from /economic-indicators.",
            config={
                "series": [
                    "GDP",
                    "realGDP",
                    "CPI",
                    "inflationRate",
                    "federalFunds",
                    "unemploymentRate",
                    "retailSales",
                    "consumerSentiment",
                ]
            },
        ),
        DatasetSpec(
            key="global.macro_series_catalog",
            scope="global",
            handler=global_reference.run_macro_series_catalog,
            cadence_seconds=24 * 3600,
            cursor_strategy="snapshot",
            quota_class="light",
            priority_tier="P1",
            description="Catalog of macro series IDs tracked by the platform.",
            config={
                "series": [
                    {"series_id": "GDP", "display_name": "GDP", "category": "growth", "frequency": "quarterly"},
                    {"series_id": "realGDP", "display_name": "Real GDP", "category": "growth", "frequency": "quarterly"},
                    {"series_id": "CPI", "display_name": "CPI", "category": "inflation", "frequency": "monthly"},
                    {"series_id": "inflationRate", "display_name": "Inflation Rate", "category": "inflation", "frequency": "monthly"},
                    {"series_id": "federalFunds", "display_name": "Federal Funds Rate", "category": "rates", "frequency": "daily"},
                    {"series_id": "unemploymentRate", "display_name": "Unemployment Rate", "category": "labor", "frequency": "monthly"},
                    {"series_id": "retailSales", "display_name": "Retail Sales", "category": "consumption", "frequency": "monthly"},
                    {"series_id": "consumerSentiment", "display_name": "Consumer Sentiment", "category": "sentiment", "frequency": "monthly"},
                    {"series_id": "10Year", "display_name": "US 10Y Treasury", "category": "rates", "frequency": "daily"},
                    {"series_id": "2Year", "display_name": "US 2Y Treasury", "category": "rates", "frequency": "daily"},
                ]
            },
        ),
        DatasetSpec(
            key="global.sector_performance",
            scope="global",
            handler=sector_performance.run,
            cadence_seconds=6 * 3600,
            cursor_strategy="date",
            quota_class="light",
            priority_tier="P1",
            description="Historical sector performance (return %) and P/E ratios.",
        ),
    ]


# Public accessor — populated the first time it's requested so module import
# order stays clean.
_REGISTRY_CACHE: list[DatasetSpec] | None = None


def _registry() -> list[DatasetSpec]:
    global _REGISTRY_CACHE
    if _REGISTRY_CACHE is None:
        _REGISTRY_CACHE = _build_registry()
    return _REGISTRY_CACHE


# Lazy proxy exposed as ``DATASET_REGISTRY`` so callers can iterate it.
class _RegistryProxy:
    def __iter__(self):
        return iter(_registry())

    def __len__(self) -> int:
        return len(_registry())

    def __getitem__(self, item):
        return _registry()[item]


DATASET_REGISTRY: _RegistryProxy = _RegistryProxy()


def get_dataset_spec(key: str) -> DatasetSpec | None:
    for spec in _registry():
        if spec.key == key:
            return spec
    return None


async def seed_registry() -> None:
    """
    Upsert the in-memory registry into ``sync_datasets``. Disables any rows
    present in the DB that are not in the current registry — keeps the table
    in sync with the code without losing historical sync_state rows.
    """
    specs = list(_registry())
    known_keys = {s.key for s in specs}

    async with async_session_factory() as session:
        if specs:
            rows = [
                {
                    "dataset_key": s.key,
                    "scope": s.scope,
                    "description": s.description,
                    "cadence_seconds": s.cadence_seconds,
                    "cursor_strategy": s.cursor_strategy,
                    "quota_class": s.quota_class,
                    "priority_tier": s.priority_tier,
                    "enabled": True,
                    "config": s.config,
                }
                for s in specs
            ]
            stmt = pg_insert(SyncDataset).values(rows)
            stmt = stmt.on_conflict_do_update(
                index_elements=["dataset_key"],
                set_={
                    "scope": stmt.excluded.scope,
                    "description": stmt.excluded.description,
                    "cadence_seconds": stmt.excluded.cadence_seconds,
                    "cursor_strategy": stmt.excluded.cursor_strategy,
                    "quota_class": stmt.excluded.quota_class,
                    "priority_tier": stmt.excluded.priority_tier,
                    "enabled": True,
                    "config": stmt.excluded.config,
                },
            )
            await session.execute(stmt)

        # Disable anything no longer in the registry.
        await session.execute(
            update(SyncDataset)
            .where(SyncDataset.dataset_key.notin_(known_keys))
            .values(enabled=False)
        )
        await session.commit()
