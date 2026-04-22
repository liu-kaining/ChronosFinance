import logging
from typing import Awaitable, Callable

from fastapi import APIRouter, BackgroundTasks, Query

from app.schemas.sync import SyncTriggerResponse
from app.services.sync.orchestrator import run_dataset
from app.services.integrated_sync import (
    sync_analyst_estimates,
    sync_corporate_actions,
    sync_daily_prices,
    sync_earnings_calendar,
    sync_insider_trades,
    sync_macro_indicators,
    sync_sec_filings,
)
from app.services.static_data_sync import (
    sync_balance_sheets,
    sync_cash_flow_statements,
    sync_enterprise_values,
    sync_executive_compensation,
    sync_financial_ratios,
    sync_financial_scores,
    sync_income_statements,
    sync_key_metrics,
    sync_revenue_segmentation,
    sync_stock_peers,
    sync_stock_universe,
)

logger = logging.getLogger(__name__)
# Legacy write-side router. New scheduler/write traffic should use
# /api/v1/ingest/* instead (see spec M6 cutover plan).
router = APIRouter(prefix="/api/v1/sync", tags=["sync"])


async def _run_job(name: str, job: Callable[[], Awaitable[dict]]) -> None:
    """Uniform wrapper so every background task is logged and never crashes silently."""
    try:
        result = await job()
        logger.info("Background job %s finished: %s", name, result)
    except Exception:
        logger.exception("Background job %s failed", name)


async def _run_dataset_job(dataset_key: str, symbol: str | None = None) -> None:
    """Bridge old /sync routes to the new orchestrator."""
    try:
        result = await run_dataset(
            dataset_key,
            symbol=symbol.upper() if symbol else None,
            trigger="legacy_sync",
        )
        logger.info("Legacy sync route forwarded to %s: %s", dataset_key, result)
    except Exception:
        logger.exception("Legacy sync route failed for dataset=%s", dataset_key)


def _accepted(message: str) -> SyncTriggerResponse:
    return SyncTriggerResponse(status="accepted", message=message)


def _queue_symbol_dataset(
    bg: BackgroundTasks,
    dataset_key: str,
    symbol: str,
    label: str,
) -> SyncTriggerResponse:
    sym = symbol.strip().upper()
    bg.add_task(_run_dataset_job, dataset_key, sym)
    return _accepted(f"{label} sync queued for {sym} (forwarded to /api/v1/ingest).")


# ── Phase 1 ──────────────────────────────────────────────────
@router.post("/universe", response_model=SyncTriggerResponse,
             summary="Trigger US stock universe sync")
async def trigger_universe_sync(bg: BackgroundTasks) -> SyncTriggerResponse:
    bg.add_task(_run_job, "universe", sync_stock_universe)
    return _accepted("Stock universe sync queued.")


# ── Phase 2 ──────────────────────────────────────────────────
@router.post("/financials/income", response_model=SyncTriggerResponse,
             summary="Sync annual income statements")
async def trigger_income_sync(
    bg: BackgroundTasks,
    symbol: str | None = Query(None, min_length=1, description="Optional ticker symbol, e.g. AAPL"),
) -> SyncTriggerResponse:
    if symbol:
        return _queue_symbol_dataset(bg, "symbol.financials.income_statement", symbol, "Income-statement")
    bg.add_task(_run_job, "income_statements", sync_income_statements)
    return _accepted("Income-statement sync queued (full active universe).")


@router.post("/financials/balance", response_model=SyncTriggerResponse,
             summary="Sync annual balance-sheet statements")
async def trigger_balance_sync(
    bg: BackgroundTasks,
    symbol: str | None = Query(None, min_length=1, description="Optional ticker symbol, e.g. AAPL"),
) -> SyncTriggerResponse:
    if symbol:
        return _queue_symbol_dataset(bg, "symbol.financials.balance_sheet", symbol, "Balance-sheet")
    bg.add_task(_run_job, "balance_sheets", sync_balance_sheets)
    return _accepted("Balance-sheet sync queued (full active universe).")


@router.post("/financials/cashflow", response_model=SyncTriggerResponse,
             summary="Sync annual cash-flow statements")
async def trigger_cashflow_sync(
    bg: BackgroundTasks,
    symbol: str | None = Query(None, min_length=1, description="Optional ticker symbol, e.g. AAPL"),
) -> SyncTriggerResponse:
    if symbol:
        return _queue_symbol_dataset(bg, "symbol.financials.cash_flow", symbol, "Cash-flow")
    bg.add_task(_run_job, "cash_flow_statements", sync_cash_flow_statements)
    return _accepted("Cash-flow sync queued (full active universe).")


# ── Phase 3 ──────────────────────────────────────────────────
@router.post("/ratios", response_model=SyncTriggerResponse,
             summary="Sync annual financial ratios",
             description="Pulls /ratios/{symbol} history (up to ~30 years) and "
                         "persists into static_financials (ratios_annual).")
@router.post("/financials/ratios", response_model=SyncTriggerResponse,
             include_in_schema=False)
async def trigger_ratios_sync(
    bg: BackgroundTasks,
    symbol: str | None = Query(None, min_length=1, description="Optional ticker symbol, e.g. AAPL"),
) -> SyncTriggerResponse:
    if symbol:
        return _queue_symbol_dataset(bg, "symbol.financials.ratios", symbol, "Financial-ratios")
    bg.add_task(_run_job, "financial_ratios", sync_financial_ratios)
    return _accepted("Financial-ratios sync queued (full active universe).")


@router.post("/metrics", response_model=SyncTriggerResponse,
             summary="Sync annual key metrics",
             description="Pulls /key-metrics/{symbol} history and persists into "
                         "static_financials (metrics_annual).")
@router.post("/financials/metrics", response_model=SyncTriggerResponse,
             include_in_schema=False)
async def trigger_metrics_sync(
    bg: BackgroundTasks,
    symbol: str | None = Query(None, min_length=1, description="Optional ticker symbol, e.g. AAPL"),
) -> SyncTriggerResponse:
    if symbol:
        return _queue_symbol_dataset(bg, "symbol.financials.metrics", symbol, "Key-metrics")
    bg.add_task(_run_job, "key_metrics", sync_key_metrics)
    return _accepted("Key-metrics sync queued (full active universe).")


@router.post("/scores", response_model=SyncTriggerResponse,
             summary="Sync financial scores (Altman-Z / Piotroski-F)",
             description="Pulls /score?symbol= as a point-in-time snapshot. "
                         "Stored under category scores_snapshot with the "
                         "current calendar year.")
@router.post("/financials/scores", response_model=SyncTriggerResponse,
             include_in_schema=False)
async def trigger_scores_sync(
    bg: BackgroundTasks,
    symbol: str | None = Query(None, min_length=1, description="Optional ticker symbol, e.g. AAPL"),
) -> SyncTriggerResponse:
    if symbol:
        return _queue_symbol_dataset(bg, "symbol.financials.scores", symbol, "Financial-scores")
    bg.add_task(_run_job, "financial_scores", sync_financial_scores)
    return _accepted("Financial-scores sync queued (full active universe).")


@router.post("/enterprise-values", response_model=SyncTriggerResponse,
             summary="Sync annual enterprise values / market cap history",
             description="Pulls /enterprise-values/{symbol} history into "
                         "static_financials (enterprise_values_annual).")
@router.post("/financials/enterprise-values", response_model=SyncTriggerResponse,
             include_in_schema=False)
async def trigger_ev_sync(
    bg: BackgroundTasks,
    symbol: str | None = Query(None, min_length=1, description="Optional ticker symbol, e.g. AAPL"),
) -> SyncTriggerResponse:
    if symbol:
        return _queue_symbol_dataset(bg, "symbol.financials.enterprise_values", symbol, "Enterprise-values")
    bg.add_task(_run_job, "enterprise_values", sync_enterprise_values)
    return _accepted("Enterprise-values sync queued (full active universe).")


@router.post("/compensation", response_model=SyncTriggerResponse,
             summary="Sync executive compensation",
             description="Pulls /governance/executive_compensation per symbol. "
                         "Multiple executives in the same year are grouped into "
                         "one row whose raw_payload is a list of executives.")
@router.post("/governance/compensation", response_model=SyncTriggerResponse,
             include_in_schema=False)
async def trigger_compensation_sync(
    bg: BackgroundTasks,
    symbol: str | None = Query(None, min_length=1, description="Optional ticker symbol, e.g. AAPL"),
) -> SyncTriggerResponse:
    if symbol:
        return _queue_symbol_dataset(bg, "symbol.financials.executive_compensation", symbol, "Executive-compensation")
    bg.add_task(_run_job, "executive_compensation", sync_executive_compensation)
    return _accepted("Executive-compensation sync queued (full active universe).")


@router.post("/segments", response_model=SyncTriggerResponse,
             summary="Sync revenue segmentation (product + geographic)",
             description="Calls BOTH /revenue-product-segmentation and "
                         "/revenue-geographic-segmentation per symbol and "
                         "stores them under distinct categories. The "
                         "segments_synced flag only flips once BOTH succeed.")
@router.post("/financials/segments", response_model=SyncTriggerResponse,
             include_in_schema=False)
async def trigger_segments_sync(
    bg: BackgroundTasks,
    symbol: str | None = Query(None, min_length=1, description="Optional ticker symbol, e.g. AAPL"),
) -> SyncTriggerResponse:
    if symbol:
        return _queue_symbol_dataset(bg, "symbol.financials.revenue_segmentation", symbol, "Revenue-segmentation")
    bg.add_task(_run_job, "revenue_segmentation", sync_revenue_segmentation)
    return _accepted("Revenue-segmentation sync queued (full active universe).")


@router.post("/peers", response_model=SyncTriggerResponse,
             summary="Sync stock peers list",
             description="Pulls /stock_peers?symbol= as a snapshot. Stored "
                         "under category peers_snapshot with the current "
                         "calendar year.")
@router.post("/financials/peers", response_model=SyncTriggerResponse,
             include_in_schema=False)
async def trigger_peers_sync(
    bg: BackgroundTasks,
    symbol: str | None = Query(None, min_length=1, description="Optional ticker symbol, e.g. AAPL"),
) -> SyncTriggerResponse:
    if symbol:
        return _queue_symbol_dataset(bg, "symbol.financials.stock_peers", symbol, "Stock-peers")
    bg.add_task(_run_job, "stock_peers", sync_stock_peers)
    return _accepted("Stock-peers sync queued (full active universe).")


# ── Phase 4 — market & events ─────────────────────────────────
@router.post("/market/prices", response_model=SyncTriggerResponse,
             summary="Sync daily OHLCV prices",
             description="Pulls /historical-price-full/{symbol} (~30y of daily "
                         "bars) and bulk-upserts into daily_prices.")
async def trigger_prices_sync(
    bg: BackgroundTasks,
    symbol: str | None = Query(None, min_length=1, description="Optional ticker symbol, e.g. AAPL"),
) -> SyncTriggerResponse:
    if symbol:
        return _queue_symbol_dataset(bg, "symbol.daily_prices", symbol, "Daily-prices")
    bg.add_task(_run_job, "daily_prices", sync_daily_prices)
    return _accepted("Daily-prices sync queued (full active universe).")


@router.post("/market/actions", response_model=SyncTriggerResponse,
             summary="Sync dividends & splits",
             description="Pulls both /historical-price-full/stock_dividend and "
                         "/historical-price-full/stock_split per symbol; both "
                         "must succeed before the actions_synced flag flips.")
async def trigger_actions_sync(
    bg: BackgroundTasks,
    symbol: str | None = Query(None, min_length=1, description="Optional ticker symbol, e.g. AAPL"),
) -> SyncTriggerResponse:
    if symbol:
        return _queue_symbol_dataset(bg, "symbol.corporate_actions", symbol, "Corporate-actions")
    bg.add_task(_run_job, "corporate_actions", sync_corporate_actions)
    return _accepted("Corporate-actions sync queued (full active universe).")


@router.post("/events/earnings", response_model=SyncTriggerResponse,
             summary="Sync historical earnings calendar",
             description="Pulls /historical/earning_calendar/{symbol} and "
                         "bulk-upserts into earnings_calendar.")
async def trigger_earnings_sync(
    bg: BackgroundTasks,
    symbol: str | None = Query(None, min_length=1, description="Optional ticker symbol, e.g. AAPL"),
) -> SyncTriggerResponse:
    if symbol:
        return _queue_symbol_dataset(bg, "symbol.earnings_history", symbol, "Earnings-calendar")
    bg.add_task(_run_job, "earnings_calendar", sync_earnings_calendar)
    return _accepted("Earnings-calendar sync queued (full active universe).")


# ── Phase 5 — alpha & text ────────────────────────────────────
@router.post("/alpha/insider", response_model=SyncTriggerResponse,
             summary="Sync insider trading transactions",
             description="Pulls paginated /insider-trading?symbol=... per symbol "
                         "and bulk-upserts into insider_trades.")
async def trigger_insider_sync(
    bg: BackgroundTasks,
    symbol: str | None = Query(None, min_length=1, description="Optional ticker symbol, e.g. AAPL"),
) -> SyncTriggerResponse:
    if symbol:
        return _queue_symbol_dataset(bg, "symbol.alpha.insider_trades", symbol, "Insider-trades")
    bg.add_task(_run_job, "insider_trades", sync_insider_trades)
    return _accepted("Insider-trades sync queued (full active universe).")


@router.post("/alpha/estimates", response_model=SyncTriggerResponse,
             summary="Sync analyst estimates & price targets",
             description="Pulls /analyst-estimates/{symbol} (consensus) and "
                         "/price-target?symbol=... (per-analyst). Stored in "
                         "analyst_estimates with a `kind` discriminator.")
async def trigger_estimates_sync(
    bg: BackgroundTasks,
    symbol: str | None = Query(None, min_length=1, description="Optional ticker symbol, e.g. AAPL"),
) -> SyncTriggerResponse:
    if symbol:
        return _queue_symbol_dataset(bg, "symbol.alpha.analyst_estimates", symbol, "Analyst-estimates")
    bg.add_task(_run_job, "analyst_estimates", sync_analyst_estimates)
    return _accepted("Analyst-estimates sync queued (full active universe).")


@router.post("/alpha/filings", response_model=SyncTriggerResponse,
             summary="Sync 10-K structured JSON filings",
             description="For each active symbol pulls /financial-reports-json "
                         "for the last 5 fiscal years (FY). Stores the full "
                         "section tree as JSONB in sec_files.")
async def trigger_filings_sync(
    bg: BackgroundTasks,
    symbol: str | None = Query(None, min_length=1, description="Optional ticker symbol, e.g. AAPL"),
) -> SyncTriggerResponse:
    if symbol:
        return _queue_symbol_dataset(bg, "symbol.alpha.sec_filings_10k", symbol, "SEC-filings")
    bg.add_task(_run_job, "sec_filings", sync_sec_filings)
    return _accepted("SEC-filings sync queued (full active universe).")


@router.post("/macro/indicators", response_model=SyncTriggerResponse,
             summary="Sync macro-economic indicators",
             description="Pulls /economic?name=... for GDP / CPI / fed funds / "
                         "10-year yield / unemployment, etc. Not tied to the "
                         "universe; persists into macro_economics.")
async def trigger_macro_sync(bg: BackgroundTasks) -> SyncTriggerResponse:
    bg.add_task(_run_job, "macro_indicators", sync_macro_indicators)
    return _accepted("Macro-indicators sync queued.")
