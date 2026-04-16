"""
Phase 4 & 5 — market, corporate actions, events, alpha signals, SEC text, macro.

Design:
  * Reuses the same resumable pattern as Phase 2/3: a sync flag on
    `stock_universe` is flipped to TRUE only after the symbol's data lands
    AND its flag is updated in one transaction.
  * All FMP calls go through `fmp_client.get()` so the 750/min limiter and
    tenacity retry (including 200-soft-error handling) are always in effect.
  * Bulk writes use Postgres `INSERT … ON CONFLICT DO UPDATE` with a single
    `session.execute(stmt)` per symbol — O(1) round-trips even for 7500
    daily-price rows.
"""

from __future__ import annotations

import logging
from datetime import date, datetime
from typing import Any, Iterable, Iterator, Sequence

import httpx
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.core.database import async_session_factory
from app.models.alpha import AnalystEstimate, InsiderTrade, SECFile
from app.models.macro import MacroEconomic
from app.models.market import CorporateAction, DailyPrice, EarningsCalendar
from app.models.stock_universe import StockUniverse
from app.utils.fmp_client import FMPResponseError, fmp_client

logger = logging.getLogger(__name__)

# Postgres hard-caps a single statement at 65,535 bind parameters.
# DailyPrice has 8 cols × N rows — 30-year history (~8,000 bars) would blow past.
# Chunk every bulk insert to keep (cols × BULK_CHUNK) well under 65k.
BULK_CHUNK = 5000


# ══════════════════════════════════════════════════════════════
# Shared helpers
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


def _parse_date(v: Any) -> date | None:
    if v is None:
        return None
    if isinstance(v, date) and not isinstance(v, datetime):
        return v
    if isinstance(v, str):
        try:
            return datetime.strptime(v[:10], "%Y-%m-%d").date()
        except (ValueError, TypeError):
            return None
    return None


def _parse_datetime(v: Any) -> datetime | None:
    if v is None:
        return None
    if isinstance(v, datetime):
        return v
    if not isinstance(v, str):
        return None
    for fmt, trim in (
        ("%Y-%m-%d %H:%M:%S", 19),
        ("%Y-%m-%dT%H:%M:%S", 19),
        ("%Y-%m-%d", 10),
    ):
        try:
            return datetime.strptime(v[:trim], fmt)
        except (ValueError, TypeError):
            continue
    return None


def _safe_float(v: Any) -> float | None:
    try:
        if v is None or v == "":
            return None
        return float(v)
    except (TypeError, ValueError):
        return None


def _safe_int(v: Any) -> int | None:
    try:
        if v is None or v == "":
            return None
        return int(float(v))
    except (TypeError, ValueError):
        return None


async def _flip_flag(session, symbol: str, flag_column) -> None:
    await session.execute(
        update(StockUniverse)
        .where(StockUniverse.symbol == symbol)
        .values({flag_column: True})
    )


def _dedupe(rows: list[dict], keys: Sequence[str]) -> list[dict]:
    """
    Postgres refuses to `ON CONFLICT` resolve duplicate keys *within the same
    insert* — strip them here, last one wins.
    """
    seen: dict[tuple, dict] = {}
    for r in rows:
        k = tuple(r.get(c) for c in keys)
        seen[k] = r
    return list(seen.values())


def _chunks(seq: Sequence[Any], size: int) -> Iterator[Sequence[Any]]:
    """Yield `seq` in slices of length `size`. Used to stay under the
    PostgreSQL 65,535 bind-parameter limit on bulk inserts."""
    for i in range(0, len(seq), size):
        yield seq[i:i + size]


def _clean_jsonb(obj: Any) -> Any:
    """
    Recursively strip NUL (\\u0000) characters from any strings in the payload.
    PostgreSQL's `jsonb` type rejects NULs outright (asyncpg raises
    `unsupported Unicode escape sequence`). FMP SEC filings and insider-trade
    free-text fields occasionally include stray NULs from PDF extraction.
    """
    if isinstance(obj, str):
        return obj.replace("\x00", "") if "\x00" in obj else obj
    if isinstance(obj, dict):
        return {k: _clean_jsonb(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_clean_jsonb(v) for v in obj]
    return obj


# ══════════════════════════════════════════════════════════════
# 4.1  Daily prices — bulk insert, ~7500 rows per symbol
# ══════════════════════════════════════════════════════════════

async def sync_daily_prices() -> dict:
    flag = StockUniverse.prices_synced
    symbols = await _fetch_pending_symbols(flag)
    total = len(symbols)
    logger.info("Pending symbols for daily_prices: %d", total)
    if total == 0:
        return {"dataset": "daily_prices", "total": 0, "synced": 0, "empty": 0, "failed": 0}

    synced = empty = 0
    failed: list[str] = []
    update_cols = ("open", "high", "low", "close", "adj_close", "volume")

    for idx, symbol in enumerate(symbols, start=1):
        logger.info("[%d/%d] %s — GET /historical-price-eod/full symbol=%s", idx, total, symbol, symbol)
        try:
            payload = await fmp_client.get(
                "/historical-price-eod/full", params={"symbol": symbol}
            )
        except Exception:
            logger.exception("[%d/%d] %s — fetch failed", idx, total, symbol)
            failed.append(symbol)
            continue

        # stable /historical-price-eod/full returns a plain list;
        # v3 /historical-price-full wrapped it in {"historical": [...]}.
        # Accept either shape so a future FMP tweak doesn't break us.
        if isinstance(payload, list):
            historical = payload
        elif isinstance(payload, dict):
            historical = payload.get("historical") or []
        else:
            historical = []
        rows: list[dict] = []
        for bar in historical:
            d = _parse_date(bar.get("date"))
            if d is None:
                continue
            rows.append({
                "symbol": symbol,
                "date": d,
                "open": _safe_float(bar.get("open")),
                "high": _safe_float(bar.get("high")),
                "low": _safe_float(bar.get("low")),
                "close": _safe_float(bar.get("close")),
                "adj_close": _safe_float(bar.get("adjClose")),
                "volume": _safe_int(bar.get("volume")),
            })
        rows = _dedupe(rows, ("symbol", "date"))

        try:
            async with async_session_factory() as session:
                for chunk in _chunks(rows, BULK_CHUNK):
                    stmt = pg_insert(DailyPrice).values(list(chunk))
                    stmt = stmt.on_conflict_do_update(
                        index_elements=["symbol", "date"],
                        set_={c: getattr(stmt.excluded, c) for c in update_cols},
                    )
                    await session.execute(stmt)
                await _flip_flag(session, symbol, flag)
                await session.commit()
        except Exception:
            logger.exception("[%d/%d] %s — DB write failed", idx, total, symbol)
            failed.append(symbol)
            continue

        if not rows:
            empty += 1
            logger.warning("[%d/%d] %s — 0 price rows, flag flipped", idx, total, symbol)
        else:
            synced += 1
            logger.info("[%d/%d] %s — %d price rows persisted", idx, total, symbol, len(rows))

    logger.info("daily_prices finished: total=%d synced=%d empty=%d failed=%d",
                total, synced, empty, len(failed))
    return {"dataset": "daily_prices", "total": total, "synced": synced,
            "empty": empty, "failed": len(failed), "failed_symbols": failed[:50]}


# ══════════════════════════════════════════════════════════════
# 4.2  Corporate actions — dividends + splits in one flag
# ══════════════════════════════════════════════════════════════

async def sync_corporate_actions() -> dict:
    flag = StockUniverse.actions_synced
    symbols = await _fetch_pending_symbols(flag)
    total = len(symbols)
    logger.info("Pending symbols for corporate_actions: %d", total)
    if total == 0:
        return {"dataset": "corporate_actions", "total": 0, "synced": 0, "empty": 0, "failed": 0}

    # In /stable each corporate action gets its own endpoint and the response
    # is a plain list — not wrapped in {"historical": [...]} like v3 was.
    sub_specs = [
        ("dividend", "/dividends"),
        ("split",    "/splits"),
    ]

    synced = empty = 0
    failed: list[str] = []

    for idx, symbol in enumerate(symbols, start=1):
        logger.info("[%d/%d] %s — corporate actions (dividend + split)", idx, total, symbol)

        all_rows: list[dict] = []
        sub_fail = False
        for action_type, endpoint in sub_specs:
            try:
                payload = await fmp_client.get(endpoint, params={"symbol": symbol})
            except Exception:
                logger.exception("[%d/%d] %s — %s fetch failed", idx, total, symbol, action_type)
                failed.append(symbol)
                sub_fail = True
                break
            if isinstance(payload, list):
                historical = payload
            elif isinstance(payload, dict):
                historical = payload.get("historical") or []
            else:
                historical = []
            for entry in historical:
                d = _parse_date(entry.get("date"))
                if d is None:
                    continue
                all_rows.append({
                    "symbol": symbol,
                    "action_type": action_type,
                    "action_date": d,
                    "raw_payload": _clean_jsonb(entry),
                })

        if sub_fail:
            continue
        all_rows = _dedupe(all_rows, ("symbol", "action_type", "action_date"))

        try:
            async with async_session_factory() as session:
                for chunk in _chunks(all_rows, BULK_CHUNK):
                    stmt = pg_insert(CorporateAction).values(list(chunk))
                    stmt = stmt.on_conflict_do_update(
                        constraint="uq_corporate_action",
                        set_={"raw_payload": stmt.excluded.raw_payload},
                    )
                    await session.execute(stmt)
                await _flip_flag(session, symbol, flag)
                await session.commit()
        except Exception:
            logger.exception("[%d/%d] %s — DB write failed", idx, total, symbol)
            failed.append(symbol)
            continue

        if not all_rows:
            empty += 1
        else:
            synced += 1
            logger.info("[%d/%d] %s — %d action rows persisted", idx, total, symbol, len(all_rows))

    logger.info("corporate_actions finished: total=%d synced=%d empty=%d failed=%d",
                total, synced, empty, len(failed))
    return {"dataset": "corporate_actions", "total": total, "synced": synced,
            "empty": empty, "failed": len(failed), "failed_symbols": failed[:50]}


# ══════════════════════════════════════════════════════════════
# 4.3  Earnings calendar
# ══════════════════════════════════════════════════════════════

async def sync_earnings_calendar() -> dict:
    flag = StockUniverse.earnings_synced
    symbols = await _fetch_pending_symbols(flag)
    total = len(symbols)
    logger.info("Pending symbols for earnings_calendar: %d", total)
    if total == 0:
        return {"dataset": "earnings_calendar", "total": 0, "synced": 0, "empty": 0, "failed": 0}

    synced = empty = 0
    failed: list[str] = []
    update_cols = ("fiscal_period_end", "eps_estimated", "eps_actual",
                   "revenue_estimated", "revenue_actual", "raw_payload")

    for idx, symbol in enumerate(symbols, start=1):
        logger.info("[%d/%d] %s — GET /earnings symbol=%s", idx, total, symbol, symbol)
        try:
            data = await fmp_client.get("/earnings", params={"symbol": symbol})
        except Exception:
            logger.exception("[%d/%d] %s — fetch failed", idx, total, symbol)
            failed.append(symbol)
            continue

        rows: list[dict] = []
        for entry in data if isinstance(data, list) else []:
            d = _parse_date(entry.get("date"))
            if d is None:
                continue
            # stable schema renamed a few fields (e.g. fiscalDateEnding → fiscalDate).
            # Fall back to either so we don't silently drop data.
            fiscal_end = (
                entry.get("fiscalDateEnding")
                or entry.get("fiscalDate")
                or entry.get("fiscalPeriodEnd")
            )
            rows.append({
                "symbol": symbol,
                "date": d,
                "fiscal_period_end": _parse_date(fiscal_end),
                "eps_estimated": _safe_float(entry.get("epsEstimated")),
                "eps_actual": _safe_float(entry.get("eps")),
                "revenue_estimated": _safe_float(entry.get("revenueEstimated")),
                "revenue_actual": _safe_float(entry.get("revenue")),
                "raw_payload": _clean_jsonb(entry),
            })
        rows = _dedupe(rows, ("symbol", "date"))

        try:
            async with async_session_factory() as session:
                for chunk in _chunks(rows, BULK_CHUNK):
                    stmt = pg_insert(EarningsCalendar).values(list(chunk))
                    stmt = stmt.on_conflict_do_update(
                        index_elements=["symbol", "date"],
                        set_={c: getattr(stmt.excluded, c) for c in update_cols},
                    )
                    await session.execute(stmt)
                await _flip_flag(session, symbol, flag)
                await session.commit()
        except Exception:
            logger.exception("[%d/%d] %s — DB write failed", idx, total, symbol)
            failed.append(symbol)
            continue

        if rows:
            synced += 1
            logger.info("[%d/%d] %s — %d earnings rows persisted", idx, total, symbol, len(rows))
        else:
            empty += 1

    logger.info("earnings_calendar finished: total=%d synced=%d empty=%d failed=%d",
                total, synced, empty, len(failed))
    return {"dataset": "earnings_calendar", "total": total, "synced": synced,
            "empty": empty, "failed": len(failed), "failed_symbols": failed[:50]}


# ══════════════════════════════════════════════════════════════
# 5.1  Insider trades
# ══════════════════════════════════════════════════════════════

async def sync_insider_trades(max_pages: int = 5) -> dict:
    """
    FMP `/insider-trading/search` (stable) is paginated 100 rows/page. We pull
    `max_pages` pages per symbol (~500 most-recent trades); older history rarely
    matters for alpha. Increase `max_pages` if you need more.
    """
    flag = StockUniverse.insider_synced
    symbols = await _fetch_pending_symbols(flag)
    total = len(symbols)
    logger.info("Pending symbols for insider_trades: %d", total)
    if total == 0:
        return {"dataset": "insider_trades", "total": 0, "synced": 0, "empty": 0, "failed": 0}

    synced = empty = 0
    failed: list[str] = []
    update_cols = ("reporting_name", "transaction_type", "price", "raw_payload")

    for idx, symbol in enumerate(symbols, start=1):
        logger.info("[%d/%d] %s — insider-trading (%d pages)", idx, total, symbol, max_pages)

        all_entries: list[dict] = []
        page_fail = False
        for page in range(max_pages):
            try:
                data = await fmp_client.get(
                    "/insider-trading/search",
                    params={"symbol": symbol, "page": page, "limit": 100},
                )
            except Exception:
                logger.exception("[%d/%d] %s — insider page=%d failed", idx, total, symbol, page)
                failed.append(symbol)
                page_fail = True
                break
            if not isinstance(data, list) or not data:
                break
            all_entries.extend(data)
            if len(data) < 100:
                break

        if page_fail:
            continue

        rows: list[dict] = []
        for e in all_entries:
            rows.append({
                "symbol": symbol,
                "filing_date": _parse_datetime(e.get("filingDate")),
                "transaction_date": _parse_date(e.get("transactionDate")),
                "reporting_cik": str(e.get("reportingCik") or "") or None,
                "reporting_name": e.get("reportingName"),
                "transaction_type": e.get("transactionType"),
                "securities_transacted": _safe_float(e.get("securitiesTransacted")),
                "price": _safe_float(e.get("price")),
                "raw_payload": _clean_jsonb(e),
            })
        rows = _dedupe(rows, (
            "symbol", "filing_date", "transaction_date",
            "reporting_cik", "transaction_type", "securities_transacted",
        ))

        try:
            async with async_session_factory() as session:
                for chunk in _chunks(rows, BULK_CHUNK):
                    stmt = pg_insert(InsiderTrade).values(list(chunk))
                    stmt = stmt.on_conflict_do_update(
                        constraint="uq_insider_trade",
                        set_={c: getattr(stmt.excluded, c) for c in update_cols},
                    )
                    await session.execute(stmt)
                await _flip_flag(session, symbol, flag)
                await session.commit()
        except Exception:
            logger.exception("[%d/%d] %s — DB write failed", idx, total, symbol)
            failed.append(symbol)
            continue

        if rows:
            synced += 1
            logger.info("[%d/%d] %s — %d insider rows persisted", idx, total, symbol, len(rows))
        else:
            empty += 1

    logger.info("insider_trades finished: total=%d synced=%d empty=%d failed=%d",
                total, synced, empty, len(failed))
    return {"dataset": "insider_trades", "total": total, "synced": synced,
            "empty": empty, "failed": len(failed), "failed_symbols": failed[:50]}


# ══════════════════════════════════════════════════════════════
# 5.2  Analyst estimates + price targets (same flag)
# ══════════════════════════════════════════════════════════════

async def sync_analyst_estimates() -> dict:
    flag = StockUniverse.estimates_synced
    symbols = await _fetch_pending_symbols(flag)
    total = len(symbols)
    logger.info("Pending symbols for analyst_estimates: %d", total)
    if total == 0:
        return {"dataset": "analyst_estimates", "total": 0, "synced": 0, "empty": 0, "failed": 0}

    synced = empty = 0
    failed: list[str] = []

    for idx, symbol in enumerate(symbols, start=1):
        logger.info("[%d/%d] %s — analyst estimates + price target", idx, total, symbol)

        rows: list[dict] = []
        sub_fail = False

        # Consensus annual estimates — stable uses query-params + pagination.
        try:
            data = await fmp_client.get(
                "/analyst-estimates",
                params={"symbol": symbol, "period": "annual", "page": 0, "limit": 120},
            )
        except Exception:
            logger.exception("[%d/%d] %s — analyst-estimates fetch failed", idx, total, symbol)
            failed.append(symbol); sub_fail = True
        else:
            for e in data if isinstance(data, list) else []:
                d = _parse_date(e.get("date"))
                if d is None:
                    continue
                rows.append({
                    "symbol": symbol, "kind": "consensus_annual",
                    "ref_date": d, "published_date": None,
                    "raw_payload": _clean_jsonb(e),
                })

        # Price target consensus — stable replaced v3's per-analyst /price-target
        # array with /price-target-consensus, which returns a SINGLE aggregate
        # snapshot per symbol (targetHigh / targetLow / targetConsensus / …).
        # We store that as one snapshot row with kind='price_target_consensus'
        # and published_date = today, so the existing unique key still works.
        if not sub_fail:
            try:
                data = await fmp_client.get(
                    "/price-target-consensus", params={"symbol": symbol}
                )
            except Exception:
                logger.exception("[%d/%d] %s — price-target-consensus fetch failed", idx, total, symbol)
                failed.append(symbol); sub_fail = True
            else:
                consensus = None
                if isinstance(data, list) and data:
                    consensus = data[0]
                elif isinstance(data, dict):
                    consensus = data
                if consensus:
                    rows.append({
                        "symbol": symbol,
                        "kind": "price_target_consensus",
                        "ref_date": None,
                        "published_date": datetime.utcnow().date(),
                        "raw_payload": _clean_jsonb(consensus),
                    })

        if sub_fail:
            continue
        rows = _dedupe(rows, ("symbol", "kind", "ref_date", "published_date"))

        try:
            async with async_session_factory() as session:
                if rows:
                    stmt = pg_insert(AnalystEstimate).values(rows)
                    stmt = stmt.on_conflict_do_update(
                        constraint="uq_analyst_estimate",
                        set_={"raw_payload": stmt.excluded.raw_payload},
                    )
                    await session.execute(stmt)
                await _flip_flag(session, symbol, flag)
                await session.commit()
        except Exception:
            logger.exception("[%d/%d] %s — DB write failed", idx, total, symbol)
            failed.append(symbol)
            continue

        if rows:
            synced += 1
            logger.info("[%d/%d] %s — %d estimate rows persisted", idx, total, symbol, len(rows))
        else:
            empty += 1

    logger.info("analyst_estimates finished: total=%d synced=%d empty=%d failed=%d",
                total, synced, empty, len(failed))
    return {"dataset": "analyst_estimates", "total": total, "synced": synced,
            "empty": empty, "failed": len(failed), "failed_symbols": failed[:50]}


# ══════════════════════════════════════════════════════════════
# 5.3  SEC filings (10-K structured JSON)
# ══════════════════════════════════════════════════════════════

async def sync_sec_filings(years: int = 5, form_type: str = "10-K") -> dict:
    """
    For every active symbol, enumerate the last `years` fiscal years and pull
    the FMP structured JSON for each. 10-K only by default — set form_type='10-Q'
    or call twice. raw_content is the full section tree.
    """
    flag = StockUniverse.filings_synced
    symbols = await _fetch_pending_symbols(flag)
    total = len(symbols)
    logger.info("Pending symbols for sec_filings: %d", total)
    if total == 0:
        return {"dataset": "sec_filings", "total": 0, "synced": 0, "empty": 0, "failed": 0}

    current_year = datetime.utcnow().year
    year_list = list(range(current_year - years, current_year + 1))

    synced = empty = 0
    failed: list[str] = []

    for idx, symbol in enumerate(symbols, start=1):
        logger.info("[%d/%d] %s — SEC %s for years %s", idx, total, symbol, form_type, year_list)

        rows: list[dict] = []
        had_fatal = False

        for year in year_list:
            try:
                # 10-K JSON blobs can run 10-30MB. Give the read socket 120s
                # so a slow upstream doesn't trip the default 60s read timeout.
                payload = await fmp_client.get(
                    "/financial-reports-json",
                    params={"symbol": symbol, "year": year, "period": "FY"},
                    timeout_read=120.0,
                )
            except FMPResponseError as e:
                # FMP soft error (rate limit / invalid key / logical failure).
                # Do NOT flip the flag; stop and mark this symbol failed so the
                # next run retries cleanly.
                logger.error(
                    "[%d/%d] %s — FMP soft error on %s %d: %s",
                    idx, total, symbol, form_type, year, e,
                )
                had_fatal = True
                break
            except httpx.HTTPStatusError as e:
                if e.response.status_code == 404:
                    # That company/year genuinely doesn't have this form.
                    logger.debug("[%d/%d] %s — no %s for %d (404)",
                                 idx, total, symbol, form_type, year)
                    continue
                logger.exception(
                    "[%d/%d] %s — HTTP %d on %s %d",
                    idx, total, symbol, e.response.status_code, form_type, year,
                )
                had_fatal = True
                break
            except Exception:
                # Transport error, JSON decode error, etc. — treat as fatal.
                logger.exception(
                    "[%d/%d] %s — unexpected error fetching %s %d",
                    idx, total, symbol, form_type, year,
                )
                had_fatal = True
                break

            if not payload or (isinstance(payload, list) and len(payload) == 0):
                continue

            rows.append({
                "symbol": symbol,
                "form_type": form_type,
                "fiscal_year": year,
                "fiscal_period": "FY",
                "filing_date": None,
                "raw_content": _clean_jsonb(payload),
            })

        if had_fatal:
            failed.append(symbol)
            continue

        rows = _dedupe(rows, ("symbol", "form_type", "fiscal_year", "fiscal_period"))

        try:
            async with async_session_factory() as session:
                # CRITICAL: never bulk-insert 5 × 30MB JSONB in one statement —
                # asyncpg copies every payload into the wire buffer before
                # flushing and can easily blow past 300MB RSS per symbol.
                # Insert one fiscal year at a time, all in the same transaction.
                for row in rows:
                    stmt = pg_insert(SECFile).values(row)
                    stmt = stmt.on_conflict_do_update(
                        constraint="uq_sec_file",
                        set_={"raw_content": stmt.excluded.raw_content,
                              "filing_date": stmt.excluded.filing_date},
                    )
                    await session.execute(stmt)
                await _flip_flag(session, symbol, flag)
                await session.commit()
        except Exception:
            logger.exception("[%d/%d] %s — DB write failed", idx, total, symbol)
            failed.append(symbol)
            continue

        if rows:
            synced += 1
            logger.info("[%d/%d] %s — %d filings persisted", idx, total, symbol, len(rows))
        else:
            empty += 1
            logger.warning("[%d/%d] %s — no %s filings available, flag flipped",
                           idx, total, symbol, form_type)

    logger.info("sec_filings finished: total=%d synced=%d empty=%d failed=%d",
                total, synced, empty, len(failed))
    return {"dataset": "sec_filings", "total": total, "synced": synced,
            "empty": empty, "failed": len(failed), "failed_symbols": failed[:50]}


# ══════════════════════════════════════════════════════════════
# 5.4  Macro indicators (symbol-agnostic, no flag on stock_universe)
# ══════════════════════════════════════════════════════════════

DEFAULT_MACRO_SERIES: tuple[str, ...] = (
    "GDP",
    "realGDP",
    "CPI",
    "inflationRate",
    "federalFunds",
    "unemploymentRate",
    "retailSales",
    "consumerSentiment",
    "10Year",
    "2Year",
)


async def sync_macro_indicators(series: Iterable[str] | None = None) -> dict:
    """
    Pulls each macro time series from FMP /economic-indicators and upserts into
    macro_economics. Not tied to the universe — one commit per series.
    """
    series_list = list(series) if series else list(DEFAULT_MACRO_SERIES)
    logger.info("Syncing %d macro series: %s", len(series_list), series_list)

    per_series: dict[str, int] = {}
    failed: list[str] = []

    for sid in series_list:
        logger.info("Macro — GET /economic-indicators?name=%s", sid)
        try:
            data = await fmp_client.get("/economic-indicators", params={"name": sid})
        except Exception:
            logger.exception("Macro %s — fetch failed", sid)
            failed.append(sid)
            continue

        rows: list[dict] = []
        for entry in data if isinstance(data, list) else []:
            d = _parse_date(entry.get("date"))
            if d is None:
                continue
            rows.append({
                "series_id": sid,
                "date": d,
                "value": _safe_float(entry.get("value")),
                "raw_payload": entry,
            })
        rows = _dedupe(rows, ("series_id", "date"))

        if not rows:
            per_series[sid] = 0
            continue

        try:
            async with async_session_factory() as session:
                stmt = pg_insert(MacroEconomic).values(rows)
                stmt = stmt.on_conflict_do_update(
                    index_elements=["series_id", "date"],
                    set_={"value": stmt.excluded.value,
                          "raw_payload": stmt.excluded.raw_payload},
                )
                await session.execute(stmt)
                await session.commit()
        except Exception:
            logger.exception("Macro %s — DB write failed", sid)
            failed.append(sid)
            continue

        per_series[sid] = len(rows)
        logger.info("Macro %s — %d rows persisted", sid, len(rows))

    logger.info("macro_indicators finished: series=%d failed=%d",
                len(per_series), len(failed))
    return {"dataset": "macro_indicators", "per_series": per_series,
            "failed": failed}
