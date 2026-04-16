"""
Static-data synchronization service.

Phase 1 — stock universe (symbol list).
Phase 2 — core statements (income / balance / cash-flow), resumable.
Phase 3 — premium feature datasets (ratios / metrics / scores / EV /
          executive compensation / revenue segmentation / peers), resumable.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from datetime import datetime
from typing import Any, Callable, Iterable

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.core.database import async_session_factory
from app.models.static_financials import StaticFinancials
from app.models.stock_universe import StockUniverse
from app.utils.fmp_client import fmp_client

logger = logging.getLogger(__name__)

US_EXCHANGES = {"NYSE", "NASDAQ", "AMEX"}
UNIVERSE_BATCH_SIZE = 500

# "Golden universe" screener criteria.
# Drops ~5,500 micro-caps / zombies / foreign listings / ETFs / funds out of
# the raw 7,000+ FMP list; keeps ~1,200 mid+ cap liquid US common stocks.
UNIVERSE_SCREENER_PARAMS: dict[str, Any] = {
    "marketCapMoreThan": 2_000_000_000,   # ≥ $2B — drops all sub-$1B micro-caps
    "volumeMoreThan": 500_000,            # ≥ 500k/day — drops zombie tickers
    "exchange": "NASDAQ,NYSE",            # the two real US exchanges
    "isEtf": "false",
    "isFund": "false",
    "limit": 10_000,                      # FMP screener caps default at 1000, bump to stay safe
}


def _current_year() -> int:
    return datetime.utcnow().year


# ══════════════════════════════════════════════════════════════
# Phase 1 — Stock universe
# ══════════════════════════════════════════════════════════════

async def sync_stock_universe() -> dict:
    """
    Re-materialise the 'golden universe' from FMP /stock-screener.

    Strategy — fetch-first, then reset, then upsert:

      1. Call FMP screener FIRST. If FMP is flaky we bail out before touching
         the DB, so the previous day's universe stays intact.
      2. Reset `is_actively_trading=False` on every existing row in one UPDATE
         (separate committed transaction). This is our "deactivation sweep".
      3. Upsert each screener hit with `is_actively_trading=True`, batched by
         UNIVERSE_BATCH_SIZE so a DB hiccup mid-way only loses the last batch.

    Every downstream sync (prices, financials, ratios, …) pulls only symbols
    with `is_actively_trading = True`, so this function is the single
    chokepoint defining what counts as a "tracked company".
    """
    logger.info("Starting stock universe sync (screener mode) …")
    logger.info("Screener criteria: %s", UNIVERSE_SCREENER_PARAMS)

    raw_list: Any = await fmp_client.get(
        "/company-screener", params=UNIVERSE_SCREENER_PARAMS
    )
    if not isinstance(raw_list, list):
        raise RuntimeError(f"Unexpected screener response type: {type(raw_list)}")

    total = len(raw_list)
    logger.info("Screener returned %d qualifying symbols", total)

    if total == 0:
        # Don't nuke yesterday's universe when FMP misbehaves.
        logger.warning("Screener returned 0 rows — aborting without touching DB")
        return {"screener_hits": 0, "upserted": 0, "deactivated": 0}

    # ── Step 1: deactivation sweep ────────────────────────────
    async with async_session_factory() as session:
        result = await session.execute(
            update(StockUniverse).values(is_actively_trading=False)
        )
        deactivated = result.rowcount or 0
        await session.commit()
    logger.info("Deactivation sweep: set is_actively_trading=False on %d rows", deactivated)

    # ── Step 2: upsert the golden set ─────────────────────────
    upserted = 0
    async with async_session_factory() as session:
        for i, stock in enumerate(raw_list, start=1):
            symbol = stock.get("symbol")
            if not symbol:
                continue

            # Screener returns `companyName`; /stock/list used `name`. Accept either.
            values = {
                "symbol": symbol,
                "company_name": stock.get("companyName") or stock.get("name"),
                "exchange": stock.get("exchange"),
                "exchange_short_name": stock.get("exchangeShortName"),
                "sector": stock.get("sector"),
                "industry": stock.get("industry"),
                "market_cap": stock.get("marketCap"),
                "is_etf": stock.get("isEtf", False),
                "is_actively_trading": True,
                "raw_payload": stock,
            }
            stmt = pg_insert(StockUniverse).values(**values).on_conflict_do_update(
                index_elements=["symbol"],
                set_={k: v for k, v in values.items() if k != "symbol"},
            )
            await session.execute(stmt)
            upserted += 1

            if i % UNIVERSE_BATCH_SIZE == 0:
                await session.commit()
                logger.info("Universe upsert progress: %d / %d", i, total)

        await session.commit()

    logger.info(
        "Universe sync complete — %d active symbols (after deactivation sweep of %d rows)",
        upserted, deactivated,
    )
    return {
        "screener_hits": total,
        "upserted": upserted,
        "deactivated": deactivated,
    }


# ══════════════════════════════════════════════════════════════
# Extractors (used to normalise wildly-different FMP payloads)
# ══════════════════════════════════════════════════════════════

def _extract_fiscal_year(row: dict) -> int | None:
    """`calendarYear` first, fall back to YYYY prefix of `date`."""
    cy = row.get("calendarYear")
    if cy:
        try:
            return int(cy)
        except (TypeError, ValueError):
            pass
    date = row.get("date")
    if isinstance(date, str) and len(date) >= 4:
        try:
            return int(date[:4])
        except ValueError:
            return None
    return None


def _extract_fiscal_quarter(row: dict) -> int | None:
    p = row.get("period")
    if isinstance(p, str) and p.startswith("Q") and p[1:].isdigit():
        return int(p[1:])
    return None


def _default_rows(data: Any) -> Iterable[dict]:
    return data if isinstance(data, list) else []


def _snapshot_year(row: dict) -> int:
    """For endpoints with no fiscal year (scores / peers), stamp CURRENT_YEAR."""
    return _current_year()


def _year_field(row: dict) -> int | None:
    """For endpoints whose row carries a plain `year` integer (executive comp)."""
    y = row.get("year")
    if isinstance(y, int):
        return y
    if isinstance(y, str):
        try:
            return int(y)
        except ValueError:
            return None
    return None


# ══════════════════════════════════════════════════════════════
# Generic resumable driver
# ══════════════════════════════════════════════════════════════

async def _fetch_pending_symbols(flag_column) -> list[str]:
    async with async_session_factory() as session:
        stmt = (
            select(StockUniverse.symbol)
            .where(StockUniverse.is_actively_trading.is_(True))
            .where(flag_column.is_(False))
            .order_by(StockUniverse.symbol)
        )
        return list((await session.scalars(stmt)).all())


async def _persist_symbol_rows(
    *,
    symbol: str,
    rows: Iterable[dict],
    data_category: str,
    period: str,
    flag_column,
    fiscal_year_extractor: Callable[[dict], int | None],
    fiscal_quarter_extractor: Callable[[dict], int | None],
) -> int:
    """
    Upsert `rows` into static_financials AND flip `flag_column` to TRUE
    for `symbol` within a single transaction.

    Returns: number of rows persisted (0 is valid — it still flips the flag).
    """
    persisted = 0
    async with async_session_factory() as session:
        for row in rows:
            fy = fiscal_year_extractor(row)
            if fy is None:
                logger.debug("%s/%s — skipping row without fiscal year", symbol, data_category)
                continue

            ins = pg_insert(StaticFinancials).values(
                symbol=symbol,
                data_category=data_category,
                period=period,
                fiscal_year=fy,
                fiscal_quarter=fiscal_quarter_extractor(row),
                raw_payload=row,
            ).on_conflict_do_update(
                constraint="uq_static_financials_key",
                set_={"raw_payload": row},
            )
            await session.execute(ins)
            persisted += 1

        await session.execute(
            update(StockUniverse)
            .where(StockUniverse.symbol == symbol)
            .values({flag_column: True})
        )
        await session.commit()
    return persisted


async def _sync_per_symbol(
    *,
    endpoint_fn: Callable[[str], str],
    params_fn: Callable[[str], dict],
    data_category: str,
    flag_column,
    period: str = "annual",
    rows_extractor: Callable[[Any], Iterable[dict]] = _default_rows,
    fiscal_year_extractor: Callable[[dict], int | None] = _extract_fiscal_year,
    fiscal_quarter_extractor: Callable[[dict], int | None] = lambda _row: None,
    job_name: str | None = None,
) -> dict:
    """
    Iterate every active symbol whose `flag_column` is False. For each:
      1. Fetch FMP (tenacity handles retry + soft-error exceptions).
      2. Normalise to rows via `rows_extractor`.
      3. Persist + flip flag in one transaction.

    Failures leave the flag unchanged so a rerun picks up where we stopped.
    """
    label = job_name or data_category
    logger.info("Starting %s sync …", label)

    symbols = await _fetch_pending_symbols(flag_column)
    total = len(symbols)
    logger.info("Pending symbols for %s: %d", label, total)
    if total == 0:
        return {"data_category": data_category, "total": 0, "synced": 0, "empty": 0, "failed": 0}

    synced = empty = 0
    failed: list[str] = []

    for idx, symbol in enumerate(symbols, start=1):
        endpoint = endpoint_fn(symbol)
        params = params_fn(symbol)
        logger.info("[%d/%d] %s — GET %s params=%s", idx, total, symbol, endpoint, params)

        try:
            data = await fmp_client.get(endpoint, params=params)
        except Exception:
            logger.exception("[%d/%d] %s — FMP fetch failed, flag unchanged", idx, total, symbol)
            failed.append(symbol)
            continue

        rows = list(rows_extractor(data))

        try:
            persisted = await _persist_symbol_rows(
                symbol=symbol,
                rows=rows,
                data_category=data_category,
                period=period,
                flag_column=flag_column,
                fiscal_year_extractor=fiscal_year_extractor,
                fiscal_quarter_extractor=fiscal_quarter_extractor,
            )
        except Exception:
            logger.exception("[%d/%d] %s — DB write failed, flag unchanged", idx, total, symbol)
            failed.append(symbol)
            continue

        if persisted == 0:
            empty += 1
            logger.warning("[%d/%d] %s — 0 rows persisted (empty/no data), flag flipped", idx, total, symbol)
        else:
            synced += 1
            logger.info("[%d/%d] %s — %d rows persisted, flag flipped", idx, total, symbol, persisted)

    logger.info("%s finished: total=%d synced=%d empty=%d failed=%d",
                label, total, synced, empty, len(failed))
    return {
        "data_category": data_category,
        "total": total,
        "synced": synced,
        "empty": empty,
        "failed": len(failed),
        "failed_symbols": failed[:50],
    }


# ══════════════════════════════════════════════════════════════
# Phase 2 — Core statements (use the generic driver)
# ══════════════════════════════════════════════════════════════

async def sync_income_statements(period: str = "annual") -> dict:
    return await _sync_per_symbol(
        endpoint_fn=lambda _s: "/income-statement",
        params_fn=lambda s: {"symbol": s, "period": period, "limit": 120},
        data_category=f"income_statement_{period}",
        flag_column=StockUniverse.income_synced,
        period=period,
        fiscal_quarter_extractor=_extract_fiscal_quarter if period == "quarter" else lambda _r: None,
        job_name="income_statements",
    )


async def sync_balance_sheets(period: str = "annual") -> dict:
    return await _sync_per_symbol(
        endpoint_fn=lambda _s: "/balance-sheet-statement",
        params_fn=lambda s: {"symbol": s, "period": period, "limit": 120},
        data_category=f"balance_sheet_{period}",
        flag_column=StockUniverse.balance_synced,
        period=period,
        fiscal_quarter_extractor=_extract_fiscal_quarter if period == "quarter" else lambda _r: None,
        job_name="balance_sheets",
    )


async def sync_cash_flow_statements(period: str = "annual") -> dict:
    return await _sync_per_symbol(
        endpoint_fn=lambda _s: "/cash-flow-statement",
        params_fn=lambda s: {"symbol": s, "period": period, "limit": 120},
        data_category=f"cash_flow_{period}",
        flag_column=StockUniverse.cashflow_synced,
        period=period,
        fiscal_quarter_extractor=_extract_fiscal_quarter if period == "quarter" else lambda _r: None,
        job_name="cash_flow_statements",
    )


# ══════════════════════════════════════════════════════════════
# Phase 3 — Premium feature datasets
# ══════════════════════════════════════════════════════════════

# ── 3.1  Financial ratios (annual array w/ calendarYear) ──────
async def sync_financial_ratios(period: str = "annual") -> dict:
    return await _sync_per_symbol(
        endpoint_fn=lambda _s: "/ratios",
        params_fn=lambda s: {"symbol": s, "period": period, "limit": 120},
        data_category=f"ratios_{period}",
        flag_column=StockUniverse.ratios_synced,
        period=period,
        job_name="financial_ratios",
    )


# ── 3.2  Key metrics (annual array w/ calendarYear) ───────────
async def sync_key_metrics(period: str = "annual") -> dict:
    return await _sync_per_symbol(
        endpoint_fn=lambda _s: "/key-metrics",
        params_fn=lambda s: {"symbol": s, "period": period, "limit": 120},
        data_category=f"metrics_{period}",
        flag_column=StockUniverse.metrics_synced,
        period=period,
        job_name="key_metrics",
    )


# ── 3.3  Financial scores (single snapshot row, no year) ──────
async def sync_financial_scores() -> dict:
    """Stable /financial-scores returns Altman-Z / Piotroski-F / etc."""
    return await _sync_per_symbol(
        endpoint_fn=lambda _s: "/financial-scores",
        params_fn=lambda s: {"symbol": s},
        data_category="scores_snapshot",
        flag_column=StockUniverse.scores_synced,
        period="snapshot",
        fiscal_year_extractor=_snapshot_year,
        job_name="financial_scores",
    )


# ── 3.4  Enterprise values (annual array, uses `date`) ────────
async def sync_enterprise_values(period: str = "annual") -> dict:
    return await _sync_per_symbol(
        endpoint_fn=lambda _s: "/enterprise-values",
        params_fn=lambda s: {"symbol": s, "period": period, "limit": 120},
        data_category=f"enterprise_values_{period}",
        flag_column=StockUniverse.ev_synced,
        period=period,
        job_name="enterprise_values",
    )


# ── 3.5  Executive compensation (multiple execs per year) ────
def _group_compensation(data: Any) -> Iterable[dict]:
    """
    FMP returns one row PER executive PER year — we'd collide on the unique
    key (symbol, data_category, period, fiscal_year). Group all execs of the
    same year into a single row whose `raw_payload` is the list of executives.
    """
    if not isinstance(data, list):
        return []
    buckets: dict[int, list[dict]] = defaultdict(list)
    for row in data:
        y = _year_field(row)
        if y is None:
            continue
        buckets[y].append(row)
    return [{"year": y, "executives": rows} for y, rows in sorted(buckets.items())]


async def sync_executive_compensation() -> dict:
    return await _sync_per_symbol(
        endpoint_fn=lambda _s: "/governance-executive-compensation",
        params_fn=lambda s: {"symbol": s},
        data_category="executive_compensation",
        flag_column=StockUniverse.compensation_synced,
        period="annual",
        rows_extractor=_group_compensation,
        fiscal_year_extractor=_year_field,
        job_name="executive_compensation",
    )


# ── 3.6  Revenue segmentation (2 endpoints, 1 flag) ───────────
def _segmentation_rows(data: Any) -> Iterable[dict]:
    """
    FMP segmentation responses look like:
      [ {"2023-09-30": {"iPhone": 200e9, "Mac": 40e9, ...}}, ... ]
    Flatten each date-keyed entry into a normal row with `date`
    and `segments` fields.
    """
    if not isinstance(data, list):
        return []
    out: list[dict] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        for date_key, segments in item.items():
            out.append({"date": date_key, "segments": segments})
    return out


async def sync_revenue_segmentation(period: str = "annual") -> dict:
    """
    Two sub-endpoints must BOTH succeed for a symbol before flipping
    `segments_synced`. We write each sub-response under its own
    data_category so later analytics can distinguish product vs. geo.
    """
    flag_column = StockUniverse.segments_synced
    logger.info("Starting revenue segmentation sync …")

    symbols = await _fetch_pending_symbols(flag_column)
    total = len(symbols)
    logger.info("Pending symbols for segmentation: %d", total)
    if total == 0:
        return {"data_category": "segments", "total": 0, "synced": 0, "empty": 0, "failed": 0}

    sub_specs = [
        ("/revenue-product-segmentation", "segments_product_annual"),
        ("/revenue-geographic-segmentation", "segments_geographic_annual"),
    ]

    synced = empty = 0
    failed: list[str] = []

    for idx, symbol in enumerate(symbols, start=1):
        logger.info("[%d/%d] %s — segmentation (product + geographic)", idx, total, symbol)

        sub_rows: list[tuple[str, list[dict]]] = []
        sub_failure = False

        for endpoint, category in sub_specs:
            try:
                raw = await fmp_client.get(
                    endpoint,
                    params={"symbol": symbol, "period": period, "structure": "flat"},
                )
            except Exception:
                logger.exception(
                    "[%d/%d] %s — FMP fetch failed on %s, flag unchanged",
                    idx, total, symbol, endpoint,
                )
                failed.append(symbol)
                sub_failure = True
                break
            sub_rows.append((category, list(_segmentation_rows(raw))))

        if sub_failure:
            continue

        try:
            total_persisted = 0
            async with async_session_factory() as session:
                for category, rows in sub_rows:
                    for row in rows:
                        fy = _extract_fiscal_year(row)
                        if fy is None:
                            continue
                        ins = pg_insert(StaticFinancials).values(
                            symbol=symbol,
                            data_category=category,
                            period=period,
                            fiscal_year=fy,
                            fiscal_quarter=None,
                            raw_payload=row,
                        ).on_conflict_do_update(
                            constraint="uq_static_financials_key",
                            set_={"raw_payload": row},
                        )
                        await session.execute(ins)
                        total_persisted += 1

                await session.execute(
                    update(StockUniverse)
                    .where(StockUniverse.symbol == symbol)
                    .values({flag_column: True})
                )
                await session.commit()
        except Exception:
            logger.exception(
                "[%d/%d] %s — DB write failed during segmentation, flag unchanged",
                idx, total, symbol,
            )
            failed.append(symbol)
            continue

        if total_persisted == 0:
            empty += 1
            logger.warning("[%d/%d] %s — segmentation: 0 rows total, flag flipped", idx, total, symbol)
        else:
            synced += 1
            logger.info("[%d/%d] %s — segmentation: %d rows persisted, flag flipped",
                        idx, total, symbol, total_persisted)

    logger.info("segmentation finished: total=%d synced=%d empty=%d failed=%d",
                total, synced, empty, len(failed))
    return {
        "data_category": "segments",
        "total": total,
        "synced": synced,
        "empty": empty,
        "failed": len(failed),
        "failed_symbols": failed[:50],
    }


# ── 3.7  Stock peers (snapshot, one row per symbol) ──────────
async def sync_stock_peers() -> dict:
    return await _sync_per_symbol(
        endpoint_fn=lambda _s: "/stock-peers",
        params_fn=lambda s: {"symbol": s},
        data_category="peers_snapshot",
        flag_column=StockUniverse.peers_synced,
        period="snapshot",
        fiscal_year_extractor=_snapshot_year,
        job_name="stock_peers",
    )
