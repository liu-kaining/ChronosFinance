#!/usr/bin/env python3
"""
Chronos AI Infra Core-12 tracking basket.

Uses the CSV produced by compare_ai_infra_50.py to simulate a 300k RMB
equal-weight allocation across the 12 curated names, then compares it
with the full 50-name universe and the Jan-4 "All-Star 6" basket.
"""

from __future__ import annotations

import csv
import statistics
from pathlib import Path

CSV_PATH = Path(__file__).resolve().parent / "ai_infra_50_jan4_to_apr17_2026.csv"
INITIAL_RMB = 300_000.0

CORE12: list[tuple[str, str]] = [
    ("LITE", "光电互联"),
    ("COHR", "光电互联"),
    ("CIEN", "光电互联"),
    ("MU", "HBM/存储"),
    ("SNDK", "HBM/存储"),
    ("WDC", "HBM/存储"),
    ("VRT", "散热骨架"),
    ("NVDA", "芯片/代工"),
    ("AVGO", "芯片/代工"),
    ("TSM", "芯片/代工"),
    ("VST", "能源基建"),
    ("NBIS", "Neocloud"),
]
CORE12_SYMBOLS = {s for s, _ in CORE12}

CORE8: list[tuple[str, str]] = [
    ("NVDA", "算力与定制双雄"),
    ("AVGO", "算力与定制双雄"),
    ("LITE", "光模块绝代双骄"),
    ("COHR", "光模块绝代双骄"),
    ("MU", "存储周期反转双核"),
    ("SNDK", "存储周期反转双核"),
    ("VRT", "液冷唯一真神"),
    ("VST", "核能火种"),
]

ALL_STARS = {"VST", "ORCL", "AVGO", "VRT", "MU", "TSM"}


def load() -> list[dict]:
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
                }
            )
    return rows


def equal_weight_value(rows: list[dict], budget: float) -> tuple[float, float]:
    per = budget / len(rows)
    end = sum((per / r["baseline_close"]) * r["close_end"] for r in rows)
    return end, (end / budget - 1) * 100


def fmt(x: float) -> str:
    return f"{x:+.2f}%"


def run_basket(
    name: str,
    basket: list[tuple[str, str]],
    by_sym: dict[str, dict],
    budget: float,
) -> tuple[float, float]:
    missing = [s for s, _ in basket if s not in by_sym]
    if missing:
        raise RuntimeError(f"Missing in CSV for {name}: {missing}")

    basket_rows = [by_sym[s] for s, _ in basket]
    n = len(basket)
    per_rmb = budget / n

    print("=" * 82)
    print(f"{name}  |  30万 RMB 等权回测")
    print("=" * 82)
    print("起点: 2026-01-02 收盘  |  终点: 2026-04-17 收盘")
    print(f"每只初始投入: RMB {per_rmb:,.2f}")
    print()

    print(f"{'代码':<6} {'主线':<22} {'起点':>10} {'终点':>10} {'涨幅':>10} {'终值 RMB':>14}")
    print("-" * 82)
    total_end = 0.0
    for sym, layer in basket:
        r = by_sym[sym]
        end_val = per_rmb / r["baseline_close"] * r["close_end"]
        total_end += end_val
        print(
            f"{sym:<6} {layer:<22} {r['baseline_close']:>10.2f} "
            f"{r['close_end']:>10.2f} {fmt(r['pct_change']):>10} "
            f"{end_val:>14,.0f}"
        )
    print("-" * 82)
    ret = (total_end / budget - 1) * 100
    pcts = [r["pct_change"] for r in basket_rows]
    print(
        f"{'合计':<6} {'':<22} {'':>10} {'':>10} {fmt(ret):>10} {total_end:>14,.0f}"
    )
    print()
    print(f"{name} 等权回报 : {fmt(ret)}")
    print(f"{name} 涨幅均值 : {fmt(statistics.mean(pcts))}")
    print(f"{name} 涨幅中位 : {fmt(statistics.median(pcts))}")
    print(
        f"{name} 上涨 / 下跌 : {sum(1 for p in pcts if p > 0)} / "
        f"{sum(1 for p in pcts if p < 0)}"
    )
    print(
        f"{name} 最高 : {max(basket_rows, key=lambda r: r['pct_change'])['symbol']} "
        f"{fmt(max(pcts))}"
    )
    print(
        f"{name} 最低 : {min(basket_rows, key=lambda r: r['pct_change'])['symbol']} "
        f"{fmt(min(pcts))}"
    )
    print()
    return total_end, ret


def main() -> None:
    all_rows = load()
    by_sym = {r["symbol"]: r for r in all_rows}

    core12_end, core12_ret = run_basket("Core-12", CORE12, by_sym, INITIAL_RMB)
    core8_end, core8_ret = run_basket("Core-8", CORE8, by_sym, INITIAL_RMB)

    print("=" * 82)
    print("横向对比：30 万 RMB 在不同策略下的终值")
    print("=" * 82)
    full50_end, full50_ret = equal_weight_value(all_rows, INITIAL_RMB)
    stars_rows = [r for r in all_rows if r["symbol"] in ALL_STARS]
    stars_end, stars_ret = equal_weight_value(stars_rows, INITIAL_RMB)

    print(f"{'策略':<40} {'终值 RMB':>14} {'回报':>10}")
    print("-" * 82)
    print(f"{'Core-8  等权（高信念浓缩）':<38} {core8_end:>14,.0f} {fmt(core8_ret):>10}")
    print(f"{'Core-12 等权（核心跟踪池）':<38} {core12_end:>14,.0f} {fmt(core12_ret):>10}")
    print(f"{'全 50 只 等权':<40} {full50_end:>14,.0f} {fmt(full50_ret):>10}")
    print(f"{'All-Star 6 只 等权':<40} {stars_end:>14,.0f} {fmt(stars_ret):>10}")
    print()
    print(
        f"Core-8 vs 50只    : {core8_ret - full50_ret:+.2f} pp  "
        f"(差额 RMB {core8_end - full50_end:+,.0f})"
    )
    print(
        f"Core-8 vs Core-12 : {core8_ret - core12_ret:+.2f} pp  "
        f"(差额 RMB {core8_end - core12_end:+,.0f})"
    )
    print(
        f"Core-8 vs 全明星  : {core8_ret - stars_ret:+.2f} pp  "
        f"(差额 RMB {core8_end - stars_end:+,.0f})"
    )


if __name__ == "__main__":
    main()
