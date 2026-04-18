#!/usr/bin/env python3
"""
Derive portfolio-level stats for the AI Infra 50 from the CSV produced by
compare_ai_infra_50.py. Simulates an equal-weight RMB allocation and
prints sector-level aggregates.
"""

from __future__ import annotations

import csv
import statistics
from collections import defaultdict
from pathlib import Path

CSV_PATH = Path(__file__).resolve().parent / "ai_infra_50_jan4_to_apr17_2026.csv"

INITIAL_RMB = 300_000.0

ALL_STARS = {"VST", "ORCL", "AVGO", "VRT", "MU", "TSM"}


def fmt_pct(x: float) -> str:
    return f"{x:+.2f}%"


def main() -> None:
    rows: list[dict] = []
    with CSV_PATH.open(encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if not r["pct_change"]:
                continue
            rows.append(
                {
                    "symbol": r["symbol"],
                    "sector": r["sector"],
                    "baseline_close": float(r["baseline_close"]),
                    "close_end": float(r["close_end"]),
                    "pct_change": float(r["pct_change"]),
                    "end_trade_date": r["end_trade_date"],
                    "note": r.get("note", ""),
                }
            )

    n = len(rows)
    per_stock_rmb = INITIAL_RMB / n
    total_end_rmb = 0.0
    for r in rows:
        shares = per_stock_rmb / r["baseline_close"]
        end_val = shares * r["close_end"]
        r["end_rmb"] = end_val
        total_end_rmb += end_val

    pcts = [r["pct_change"] for r in rows]
    avg = statistics.mean(pcts)
    med = statistics.median(pcts)
    up = [r for r in rows if r["pct_change"] > 0]
    down = [r for r in rows if r["pct_change"] < 0]

    print(f"Universe: {n} stocks")
    print(f"Initial RMB per stock: {per_stock_rmb:.2f}")
    print(f"Initial total:  RMB {INITIAL_RMB:,.0f}")
    print(f"End total:      RMB {total_end_rmb:,.0f}")
    print(f"Abs gain:       RMB {total_end_rmb - INITIAL_RMB:+,.0f}")
    print(f"Equal-weight return: {fmt_pct((total_end_rmb/INITIAL_RMB - 1)*100)}")
    print(f"Mean of pct_change:  {fmt_pct(avg)}")
    print(f"Median pct_change:   {fmt_pct(med)}")
    print(f"Up: {len(up)}  Down: {len(down)}")
    print(f"Best:  {max(rows, key=lambda r: r['pct_change'])['symbol']}  "
          f"{fmt_pct(max(r['pct_change'] for r in rows))}")
    print(f"Worst: {min(rows, key=lambda r: r['pct_change'])['symbol']}  "
          f"{fmt_pct(min(r['pct_change'] for r in rows))}")

    print()
    print("=== Sector averages (equal-weight within sector) ===")
    buckets: dict[str, list[float]] = defaultdict(list)
    for r in rows:
        buckets[r["sector"]].append(r["pct_change"])
    sector_rows = [
        (sec, statistics.mean(v), statistics.median(v), len(v), min(v), max(v))
        for sec, v in buckets.items()
    ]
    sector_rows.sort(key=lambda x: -x[1])
    print(f"{'sector':26} {'n':>3} {'mean':>10} {'median':>10} {'min':>10} {'max':>10}")
    for sec, mean_, med_, k, mn, mx in sector_rows:
        print(f"{sec:26} {k:>3} {fmt_pct(mean_):>10} {fmt_pct(med_):>10} "
              f"{fmt_pct(mn):>10} {fmt_pct(mx):>10}")

    print()
    print("=== Single-sector all-in: 300k RMB equal-weight INSIDE each sector ===")
    sector_allin: list[tuple[str, int, float, float]] = []
    for sec, vals in buckets.items():
        sec_rows = [r for r in rows if r["sector"] == sec]
        per_rmb = INITIAL_RMB / len(sec_rows)
        end_val = sum((per_rmb / r["baseline_close"]) * r["close_end"] for r in sec_rows)
        sector_allin.append((sec, len(sec_rows), end_val, (end_val / INITIAL_RMB - 1) * 100))
    sector_allin.sort(key=lambda x: -x[2])
    print(f"{'sector':26} {'n':>3} {'end RMB':>14} {'return':>10}")
    for sec, k, ev, ret in sector_allin:
        print(f"{sec:26} {k:>3} {ev:>14,.0f} {fmt_pct(ret):>10}")

    print()
    print("=== All-Star basket (VST, ORCL, AVGO, VRT, MU, TSM) ===")
    stars = [r for r in rows if r["symbol"] in ALL_STARS]
    stars.sort(key=lambda r: -r["pct_change"])
    stars_pcts = [r["pct_change"] for r in stars]
    per_stock_rmb_stars = INITIAL_RMB / len(stars)
    end_stars = sum((per_stock_rmb_stars / r["baseline_close"]) * r["close_end"] for r in stars)
    for r in stars:
        print(f"  {r['symbol']:5} {fmt_pct(r['pct_change']):>10}")
    print(f"All-Star equal-weight return: {fmt_pct(statistics.mean(stars_pcts))}")
    print(f"If 300k RMB were split across only these 6: "
          f"RMB {end_stars:,.0f}  ({fmt_pct((end_stars/INITIAL_RMB - 1)*100)})")

    print()
    print("=== Top 10 / Bottom 10 contributors in RMB terms ===")
    rows.sort(key=lambda r: -r["end_rmb"])
    print("Top 10 by end RMB:")
    for r in rows[:10]:
        print(f"  {r['symbol']:5} {r['sector']:24} "
              f"end RMB {r['end_rmb']:>10,.0f}   {fmt_pct(r['pct_change']):>10}")
    print("Bottom 10 by end RMB:")
    for r in rows[-10:]:
        print(f"  {r['symbol']:5} {r['sector']:24} "
              f"end RMB {r['end_rmb']:>10,.0f}   {fmt_pct(r['pct_change']):>10}")


if __name__ == "__main__":
    main()
