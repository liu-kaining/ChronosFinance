#!/usr/bin/env python
"""
ChronosFinance Data Quality Audit Script

This script performs comprehensive data quality checks on the financial data
warehouse, including freshness, completeness, continuity, and uniqueness.

Usage:
    python scripts/audit_data_quality.py

Requirements:
    - asyncpg
    - tabulate (for pretty table output)
"""

from __future__ import annotations

import asyncio
import logging
import sys
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import asyncpg

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.config import get_settings

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

settings = get_settings()

# ═══════════════════════════════════════════════════════════════════════════
# Database Connection
# ═══════════════════════════════════════════════════════════════════════════


async def get_connection() -> asyncpg.Connection:
    """Create a direct asyncpg connection for efficient queries."""
    dsn = (
        f"postgresql://{settings.POSTGRES_USER}:{settings.POSTGRES_PASSWORD}"
        f"@{settings.POSTGRES_HOST}:{settings.POSTGRES_PORT}/{settings.POSTGRES_DB}"
    )
    return await asyncpg.connect(dsn)


# ═══════════════════════════════════════════════════════════════════════════
# Utility Functions
# ═══════════════════════════════════════════════════════════════════════════


def print_header(title: str) -> None:
    """Print a formatted section header."""
    print(f"\n{'═' * 70}")
    print(f"  {title}")
    print(f"{'═' * 70}\n")


def print_table(rows: list[dict], columns: list[str] | None = None) -> None:
    """Print rows as a formatted table."""
    if not rows:
        print("  (no data)")
        return

    try:
        from tabulate import tabulate

        headers = columns if columns else list(rows[0].keys())
        print(tabulate(rows, headers="keys", tablefmt="simple", numalign="right"))
    except ImportError:
        # Fallback without tabulate
        headers = columns if columns else list(rows[0].keys())
        print("  " + " | ".join(str(h) for h in headers))
        print("  " + "-+-".join("-" * len(str(h)) for h in headers))
        for row in rows:
            print("  " + " | ".join(str(row.get(h, "")) for h in headers))


def format_number(n: int | None) -> str:
    """Format large numbers with commas."""
    if n is None:
        return "N/A"
    return f"{n:,}"


# ═══════════════════════════════════════════════════════════════════════════
# 1. Data Freshness Check
# ═══════════════════════════════════════════════════════════════════════════


async def check_freshness(conn: asyncpg.Connection) -> dict[str, Any]:
    """Check freshness of time-series data tables."""
    print_header("1. Data Freshness Check")

    # Tables with date columns to check
    freshness_tables = [
        ("daily_prices", "date"),
        ("daily_market_cap", "date"),
        ("valuation_dcf", "date"),
        ("sector_performance_series", "date"),
        ("macro_economics", "date"),
        ("company_employees_history", "date"),
        ("equity_offerings", "filing_date"),
        ("insider_trades", "filing_date"),
        ("stock_news", "published_date"),
    ]

    rows = []
    for table, date_col in freshness_tables:
        try:
            result = await conn.fetchrow(
                f"""
                SELECT
                    MAX({date_col}) as max_date,
                    MIN({date_col}) as min_date,
                    COUNT(*) as total_rows
                FROM {table}
                """
            )
            rows.append({
                "Table": table,
                "Max Date": str(result["max_date"]) if result["max_date"] else "N/A",
                "Min Date": str(result["min_date"]) if result["min_date"] else "N/A",
                "Total Rows": format_number(result["total_rows"]),
            })
        except Exception as e:
            rows.append({
                "Table": table,
                "Max Date": f"ERROR: {e}",
                "Min Date": "-",
                "Total Rows": "-",
            })

    print_table(rows)

    # Find the global max date across daily prices as "market reference date"
    market_ref = await conn.fetchval(
        "SELECT MAX(date) FROM daily_prices"
    )

    if market_ref:
        print(f"\n  Market Reference Date (MAX date in daily_prices): {market_ref}")

        # Check for stale symbols (MAX date > 3 days behind market reference)
        stale_threshold = market_ref - timedelta(days=3)

        stale_prices = await conn.fetch(
            """
            SELECT symbol, MAX(date) as max_date
            FROM daily_prices
            GROUP BY symbol
            HAVING MAX(date) < $1
            ORDER BY max_date ASC
            LIMIT 20
            """,
            stale_threshold,
        )

        stale_count = await conn.fetchval(
            """
            SELECT COUNT(DISTINCT symbol)
            FROM daily_prices
            GROUP BY symbol
            HAVING MAX(date) < $1
            """,
            stale_threshold,
        )

        if stale_prices:
            print(f"\n  ⚠️  Stale Symbols in daily_prices (>{3} days behind market ref):")
            print(f"     Total stale symbols: {stale_count}")
            print("     Sample (first 20):")
            print_table([dict(s) for s in stale_prices])
        else:
            print(f"\n  ✓ No stale symbols in daily_prices (all within 3 days of market ref)")

        # Check stale symbols in daily_market_cap
        stale_mcap = await conn.fetch(
            """
            SELECT symbol, MAX(date) as max_date
            FROM daily_market_cap
            GROUP BY symbol
            HAVING MAX(date) < $1
            ORDER BY max_date ASC
            LIMIT 20
            """,
            stale_threshold,
        )

        stale_mcap_count = await conn.fetchval(
            """
            SELECT COUNT(DISTINCT symbol)
            FROM daily_market_cap
            GROUP BY symbol
            HAVING MAX(date) < $1
            """,
            stale_threshold,
        )

        if stale_mcap:
            print(f"\n  ⚠️  Stale Symbols in daily_market_cap (>{3} days behind market ref):")
            print(f"     Total stale symbols: {stale_mcap_count}")
            print("     Sample (first 20):")
            print_table([dict(s) for s in stale_mcap])
        else:
            print(f"\n  ✓ No stale symbols in daily_market_cap")

    return {"freshness_tables": rows}


# ═══════════════════════════════════════════════════════════════════════════
# 2. Completeness & Orphan Check
# ═══════════════════════════════════════════════════════════════════════════


async def check_completeness(conn: asyncpg.Connection) -> dict[str, Any]:
    """Check table row counts and find orphan symbols missing key data."""
    print_header("2. Completeness & Orphan Check")

    # Row counts for all core tables
    tables = [
        "stock_universe",
        "static_financials",
        "daily_prices",
        "daily_market_cap",
        "corporate_actions",
        "earnings_calendar",
        "insider_trades",
        "analyst_estimates",
        "sec_files",
        "stock_news",
        "company_press_releases",
        "macro_economics",
        "valuation_dcf",
        "sector_performance_series",
        "company_employees_history",
        "equity_offerings",
        "dividend_calendar_global",
        "split_calendar_global",
        "ipo_calendar",
        "economic_calendar",
        "treasury_rates_wide",
    ]

    rows = []
    for table in tables:
        try:
            count = await conn.fetchval(f"SELECT COUNT(*) FROM {table}")
            rows.append({"Table": table, "Row Count": format_number(count)})
        except Exception as e:
            rows.append({"Table": table, "Row Count": f"ERROR: {e}"})

    print("  Table Row Counts:")
    print_table(rows)

    # Active symbols count
    active_count = await conn.fetchval(
        "SELECT COUNT(*) FROM stock_universe WHERE is_actively_trading = true"
    )
    print(f"\n  Active Symbols in stock_universe: {format_number(active_count)}")

    if active_count == 0:
        print("  ⚠️ No active symbols found - skipping orphan checks")
        return {"row_counts": rows, "active_symbols": 0}

    # Orphan check: Active symbols with NO daily_prices
    orphan_prices = await conn.fetch(
        """
        SELECT su.symbol, su.company_name
        FROM stock_universe su
        LEFT JOIN daily_prices dp ON su.symbol = dp.symbol
        WHERE su.is_actively_trading = true
          AND dp.symbol IS NULL
        ORDER BY su.symbol
        LIMIT 50
        """
    )

    orphan_prices_count = await conn.fetchval(
        """
        SELECT COUNT(*)
        FROM stock_universe su
        LEFT JOIN daily_prices dp ON su.symbol = dp.symbol
        WHERE su.is_actively_trading = true
          AND dp.symbol IS NULL
        """
    )

    print(f"\n  Orphan Check - Active symbols missing daily_prices:")
    if orphan_prices_count > 0:
        print(f"  ⚠️  Found {orphan_prices_count} active symbols with NO daily_prices:")
        print_table([dict(o) for o in orphan_prices[:20]])
        if orphan_prices_count > 20:
            print(f"     ... and {orphan_prices_count - 20} more")
    else:
        print("  ✓ All active symbols have daily_prices")

    # Orphan check: Missing core financial data categories
    core_categories = [
        "income_statement",
        "balance_sheet",
        "cash_flow",
        "ratios",
        "metrics",
        "scores",
    ]

    for category in core_categories:
        missing = await conn.fetch(
            """
            SELECT su.symbol
            FROM stock_universe su
            WHERE su.is_actively_trading = true
              AND NOT EXISTS (
                SELECT 1 FROM static_financials sf
                WHERE sf.symbol = su.symbol
                  AND sf.data_category = $1
              )
            ORDER BY su.symbol
            LIMIT 20
            """,
            category,
        )

        missing_count = await conn.fetchval(
            """
            SELECT COUNT(*)
            FROM stock_universe su
            WHERE su.is_actively_trading = true
              AND NOT EXISTS (
                SELECT 1 FROM static_financials sf
                WHERE sf.symbol = su.symbol
                  AND sf.data_category = $1
              )
            """,
            category,
        )

        if missing_count > 0:
            print(f"\n  ⚠️  Active symbols missing '{category}': {missing_count}")
            print_table([{"symbol": m["symbol"]} for m in missing[:10]])
        else:
            print(f"\n  ✓ All active symbols have '{category}'")

    return {"row_counts": rows, "active_symbols": active_count}


# ═══════════════════════════════════════════════════════════════════════════
# 3. Continuity / Gap Analysis
# ═══════════════════════════════════════════════════════════════════════════


async def check_continuity(conn: asyncpg.Connection) -> dict[str, Any]:
    """Check for date gaps in daily_prices."""
    print_header("3. Continuity / Gap Analysis (daily_prices)")

    # Use window function to find gaps > 4 days in the last 30 days
    gaps = await conn.fetch(
        """
        WITH recent_prices AS (
            SELECT
                symbol,
                date,
                LAG(date) OVER (PARTITION BY symbol ORDER BY date) as prev_date
            FROM daily_prices
            WHERE date >= CURRENT_DATE - INTERVAL '30 days'
        ),
        gaps AS (
            SELECT
                symbol,
                prev_date,
                date,
                date - prev_date as gap_days
            FROM recent_prices
            WHERE prev_date IS NOT NULL
              AND date - prev_date > 4
        )
        SELECT symbol, prev_date, date, gap_days
        FROM gaps
        ORDER BY symbol, prev_date
        LIMIT 100
        """
    )

    gap_count = await conn.fetchval(
        """
        WITH recent_prices AS (
            SELECT
                symbol,
                date,
                LAG(date) OVER (PARTITION BY symbol ORDER BY date) as prev_date
            FROM daily_prices
            WHERE date >= CURRENT_DATE - INTERVAL '30 days'
        )
        SELECT COUNT(*)
        FROM recent_prices
        WHERE prev_date IS NOT NULL
          AND date - prev_date > 4
        """
    )

    if gaps:
        print(f"  ⚠️  Found {gap_count} date gaps > 4 days in last 30 days:")
        print_table([dict(g) for g in gaps[:30]])
        if gap_count > 30:
            print(f"     ... and {gap_count - 30} more gaps")
    else:
        print("  ✓ No date gaps > 4 days found in daily_prices (last 30 days)")

    # Summary: Symbols with gaps
    symbols_with_gaps = await conn.fetch(
        """
        WITH recent_prices AS (
            SELECT
                symbol,
                date,
                LAG(date) OVER (PARTITION BY symbol ORDER BY date) as prev_date
            FROM daily_prices
            WHERE date >= CURRENT_DATE - INTERVAL '30 days'
        ),
        gaps AS (
            SELECT DISTINCT symbol
            FROM recent_prices
            WHERE prev_date IS NOT NULL
              AND date - prev_date > 4
        )
        SELECT symbol FROM gaps ORDER BY symbol
        """
    )

    if symbols_with_gaps:
        print(f"\n  Symbols with gaps: {len(symbols_with_gaps)}")
        print("  " + ", ".join(s["symbol"] for s in symbols_with_gaps[:20]))
        if len(symbols_with_gaps) > 20:
            print(f"  ... and {len(symbols_with_gaps) - 20} more")

    return {"gap_count": gap_count, "symbols_with_gaps": len(symbols_with_gaps)}


# ═══════════════════════════════════════════════════════════════════════════
# 4. Duplicates Check
# ═══════════════════════════════════════════════════════════════════════════


async def check_duplicates(conn: asyncpg.Connection) -> dict[str, Any]:
    """Check for logical duplicates that bypass unique constraints."""
    print_header("4. Duplicates Check")

    # Check sec_files duplicates
    sec_dups = await conn.fetch(
        """
        SELECT symbol, form_type, fiscal_year, fiscal_period, COUNT(*) as dup_count
        FROM sec_files
        GROUP BY symbol, form_type, fiscal_year, fiscal_period
        HAVING COUNT(*) > 1
        ORDER BY dup_count DESC, symbol
        LIMIT 50
        """
    )

    print("  Checking sec_files for duplicates (symbol, form_type, fiscal_year, fiscal_period):")
    if sec_dups:
        print(f"  ⚠️  Found {len(sec_dups)} duplicate groups:")
        print_table([dict(d) for d in sec_dups[:20]])
    else:
        print("  ✓ No duplicates found in sec_files")

    # Check static_financials duplicates
    sf_dups = await conn.fetch(
        """
        SELECT symbol, data_category, period, fiscal_year, COUNT(*) as dup_count
        FROM static_financials
        GROUP BY symbol, data_category, period, fiscal_year
        HAVING COUNT(*) > 1
        ORDER BY dup_count DESC, symbol
        LIMIT 50
        """
    )

    print("\n  Checking static_financials for duplicates (symbol, data_category, period, fiscal_year):")
    if sf_dups:
        print(f"  ⚠️  Found {len(sf_dups)} duplicate groups:")
        print_table([dict(d) for d in sf_dups[:20]])
    else:
        print("  ✓ No duplicates found in static_financials")

    # Check daily_prices duplicates (should be protected by PK)
    dp_dups = await conn.fetch(
        """
        SELECT symbol, date, COUNT(*) as dup_count
        FROM daily_prices
        GROUP BY symbol, date
        HAVING COUNT(*) > 1
        LIMIT 10
        """
    )

    print("\n  Checking daily_prices for duplicates (symbol, date):")
    if dp_dups:
        print(f"  ⚠️  CRITICAL: Found {len(dp_dups)} duplicate groups (PK violation):")
        print_table([dict(d) for d in dp_dups])
    else:
        print("  ✓ No duplicates found in daily_prices")

    # Check valuation_dcf duplicates
    dcf_dups = await conn.fetch(
        """
        SELECT symbol, date, COUNT(*) as dup_count
        FROM valuation_dcf
        GROUP BY symbol, date
        HAVING COUNT(*) > 1
        LIMIT 10
        """
    )

    print("\n  Checking valuation_dcf for duplicates (symbol, date):")
    if dcf_dups:
        print(f"  ⚠️  Found {len(dcf_dups)} duplicate groups:")
        print_table([dict(d) for d in dcf_dups])
    else:
        print("  ✓ No duplicates found in valuation_dcf")

    return {
        "sec_files_duplicates": len(sec_dups),
        "static_financials_duplicates": len(sf_dups),
        "daily_prices_duplicates": len(dp_dups),
        "valuation_dcf_duplicates": len(dcf_dups),
    }


# ═══════════════════════════════════════════════════════════════════════════
# 5. R2 Cold Storage Check
# ═══════════════════════════════════════════════════════════════════════════


async def check_r2_storage(conn: asyncpg.Connection) -> dict[str, Any]:
    """Check SEC files R2 cold storage status."""
    print_header("5. R2 Cold Storage Check (sec_files)")

    # Total SEC files count
    total_count = await conn.fetchval("SELECT COUNT(*) FROM sec_files")
    print(f"  Total SEC filings: {format_number(total_count)}")

    if total_count == 0:
        print("  ⚠️ No SEC filings found - skipping R2 storage check")
        return {"total": 0, "with_storage_path": 0, "without_storage_path": 0, "coverage": 0}

    # Count by form_type
    by_type = await conn.fetch(
        """
        SELECT form_type, COUNT(*) as count
        FROM sec_files
        GROUP BY form_type
        ORDER BY count DESC
        """
    )
    print("\n  Filings by form_type:")
    print_table([{"Form Type": r["form_type"], "Count": format_number(r["count"])} for r in by_type])

    # Count with storage_path
    with_storage = await conn.fetchval(
        "SELECT COUNT(*) FROM sec_files WHERE storage_path IS NOT NULL"
    )
    without_storage = total_count - with_storage
    coverage = (with_storage / total_count * 100) if total_count > 0 else 0

    print(f"\n  R2 Storage Coverage:")
    print(f"    With storage_path:    {format_number(with_storage)} ({coverage:.1f}%)")
    print(f"    Without storage_path: {format_number(without_storage)} ({100 - coverage:.1f}%)")

    # Check for orphan records (no storage_path AND no raw_content)
    orphans = await conn.fetch(
        """
        SELECT symbol, form_type, fiscal_year, fiscal_period
        FROM sec_files
        WHERE storage_path IS NULL AND raw_content IS NULL
        LIMIT 50
        """
    )
    orphan_count = await conn.fetchval(
        "SELECT COUNT(*) FROM sec_files WHERE storage_path IS NULL AND raw_content IS NULL"
    )

    if orphan_count > 0:
        print(f"\n  ⚠️  Orphan filings (no storage_path AND no raw_content): {orphan_count}")
        print("     These records have no data source!")
        print_table([dict(o) for o in orphans[:10]])
        if orphan_count > 10:
            print(f"     ... and {orphan_count - 10} more")
    else:
        print(f"\n  ✓ All filings have either R2 storage or in-DB content")

    # Sample storage_path values
    sample_paths = await conn.fetch(
        """
        SELECT storage_path
        FROM sec_files
        WHERE storage_path IS NOT NULL
        LIMIT 5
        """
    )
    if sample_paths:
        print("\n  Sample R2 paths:")
        for p in sample_paths:
            print(f"    - {p['storage_path']}")

    return {
        "total": total_count,
        "with_storage_path": with_storage,
        "without_storage_path": without_storage,
        "orphan_count": orphan_count,
        "coverage": coverage,
    }


# ═══════════════════════════════════════════════════════════════════════════
# Main Entry Point
# ═══════════════════════════════════════════════════════════════════════════


async def main() -> None:
    """Run all data quality checks."""
    print("\n" + "═" * 70)
    print("  ChronosFinance Data Quality Audit Report")
    print(f"  Database: {settings.POSTGRES_DB}@{settings.POSTGRES_HOST}")
    print(f"  Generated: {date.today().isoformat()}")
    print("═" * 70)

    conn = await get_connection()

    try:
        results = {}

        # Run all checks
        results["freshness"] = await check_freshness(conn)
        results["completeness"] = await check_completeness(conn)
        results["continuity"] = await check_continuity(conn)
        results["duplicates"] = await check_duplicates(conn)
        results["r2_storage"] = await check_r2_storage(conn)

        # Summary
        print_header("Summary")

        issues = []

        if results["duplicates"]["sec_files_duplicates"] > 0:
            issues.append(f"sec_files: {results['duplicates']['sec_files_duplicates']} duplicate groups")
        if results["duplicates"]["static_financials_duplicates"] > 0:
            issues.append(f"static_financials: {results['duplicates']['static_financials_duplicates']} duplicate groups")
        if results["duplicates"]["daily_prices_duplicates"] > 0:
            issues.append(f"daily_prices: {results['duplicates']['daily_prices_duplicates']} CRITICAL duplicates")
        if results["continuity"]["gap_count"] > 0:
            issues.append(f"daily_prices: {results['continuity']['gap_count']} date gaps > 4 days")
        if results["r2_storage"].get("orphan_count", 0) > 0:
            issues.append(f"sec_files: {results['r2_storage']['orphan_count']} orphan records (no data source)")

        if issues:
            print("  ⚠️  Issues found:")
            for issue in issues:
                print(f"     - {issue}")
        else:
            print("  ✓ All data quality checks passed!")

        print("\n")

    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
