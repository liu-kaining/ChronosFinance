#!/usr/bin/env python3
"""
Fetch baseline (last close on or before anchor) vs 2026-04-17 close for AI Infra 50.
Run from repo root: python3 scripts/compare_ai_infra_50.py
Requires FMP_API_KEY in chronos_finance/.env (or env).
"""

from __future__ import annotations

import csv
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime
from pathlib import Path

import httpx

TICKERS: list[tuple[str, str]] = [
    ("INTC", "Foundry"),
    ("TSM", "Foundry"),
    ("VRT", "Servers & Thermal"),
    ("DELL", "Servers & Thermal"),
    ("CRDO", "Networking"),
    ("ANET", "Networking"),
    ("APH", "Networking"),
    ("CIEN", "Networking"),
    ("GOOGL", "Hyperscale Cloud"),
    ("MSFT", "Hyperscale Cloud"),
    ("AMZN", "Hyperscale Cloud"),
    ("ORCL", "Hyperscale Cloud"),
    ("IREN", "Compute Mining"),
    ("WULF", "Compute Mining"),
    ("CIFR", "Compute Mining"),
    ("HUT", "Compute Mining"),
    ("CLS", "Manufacturing"),
    ("FLEX", "Manufacturing"),
    ("FN", "Manufacturing"),
    ("SANM", "Manufacturing"),
    ("NVDA", "Chip Design & Equipment"),
    ("AVGO", "Chip Design & Equipment"),
    ("AMD", "Chip Design & Equipment"),
    ("ASML", "Chip Design & Equipment"),
    ("ARM", "Chip Design & Equipment"),
    ("LITE", "Optics"),
    ("AAOI", "Optics"),
    ("ALAB", "Optics"),
    ("COHR", "Optics"),
    ("SMTC", "Optics"),
    ("SNDK", "Memory"),
    ("STX", "Memory"),
    ("MU", "Memory"),
    ("WDC", "Memory"),
    ("PSTG", "Memory"),
    ("NBIS", "Neocloud"),
    ("CRWV", "Neocloud"),
    ("APLD", "Neocloud"),
    ("GLXY", "Neocloud"),
    ("NUAI", "Neocloud"),
    ("EOSE", "Battery & Storage"),
    ("SLDP", "Battery & Storage"),
    ("FLNC", "Battery & Storage"),
    ("VST", "Energy Infrastructure"),
    ("CEG", "Energy Infrastructure"),
    ("LEU", "Energy Infrastructure"),
    ("OKLO", "Energy Infrastructure"),
    ("BE", "Energy Infrastructure"),
    ("TLN", "Energy Infrastructure"),
    ("GEV", "Energy Infrastructure"),
]

ANCHOR = date(2026, 1, 4)
END_COMPARE = date(2026, 4, 17)


def load_api_key() -> str:
    env = os.environ.get("FMP_API_KEY", "").strip()
    if env:
        return env
    env_path = Path(__file__).resolve().parents[1] / "chronos_finance" / ".env"
    if env_path.is_file():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("FMP_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return ""


def fetch_range(
    client: httpx.Client, base: str, apikey: str, symbol: str, d_from: date, d_to: date
) -> list[dict]:
    r = client.get(
        f"{base}/historical-price-eod/full",
        params={
            "symbol": symbol,
            "from": d_from.isoformat(),
            "to": d_to.isoformat(),
            "apikey": apikey,
        },
        timeout=30.0,
    )
    r.raise_for_status()
    data = r.json()
    if isinstance(data, dict) and data.get("Error Message"):
        raise RuntimeError(data["Error Message"])
    if not isinstance(data, list):
        return []
    return data


def parse_rows(rows: list[dict]) -> dict[date, dict]:
    out: dict[date, dict] = {}
    for row in rows:
        ds = row.get("date")
        if not ds:
            continue
        d = datetime.strptime(str(ds)[:10], "%Y-%m-%d").date()
        out[d] = row
    return out


def last_on_or_before(by_date: dict[date, dict], cutoff: date) -> tuple[date, dict] | None:
    eligible = [d for d in by_date if d <= cutoff]
    if not eligible:
        return None
    d = max(eligible)
    return d, by_date[d]


def close_on_or_before(
    by_date: dict[date, dict], target: date
) -> tuple[date, dict, str] | None:
    """
    Prefer exact `target`; if missing (vendor lag / halt), use last session on or before target.
    Returns (trade_date, row, note).
    """
    if target in by_date:
        return target, by_date[target], ""
    b = last_on_or_before(by_date, target)
    if not b:
        return None
    d, row = b
    if d != target:
        return d, row, f"proxy_end_{d.isoformat()}"
    return d, row, ""


def main() -> int:
    apikey = load_api_key()
    if not apikey:
        print("Missing FMP_API_KEY", file=sys.stderr)
        return 1

    base = os.environ.get("FMP_BASE_URL", "https://financialmodelingprep.com/stable").rstrip(
        "/"
    )

    baseline_from = date(2025, 11, 1)
    baseline_to = date(2026, 1, 15)
    end_from = date(2026, 4, 1)
    end_to = date(2026, 4, 18)

    results: list[dict] = []

    def job(sym: str, sector: str) -> dict:
        with httpx.Client() as client:
            early = parse_rows(fetch_range(client, base, apikey, sym, baseline_from, baseline_to))
            late = parse_rows(fetch_range(client, base, apikey, sym, end_from, end_to))

        b = last_on_or_before(early, ANCHOR)
        end_pick = close_on_or_before(late, END_COMPARE)

        row: dict = {
            "symbol": sym,
            "sector": sector,
            "baseline_date": b[0].isoformat() if b else "",
            "baseline_close": float(b[1]["close"]) if b else None,
            "end_trade_date": end_pick[0].isoformat() if end_pick else "",
            "close_end": float(end_pick[1]["close"]) if end_pick else None,
        }
        if row["baseline_close"] and row["close_end"]:
            chg = (row["close_end"] - row["baseline_close"]) / row["baseline_close"] * 100
            row["pct_change"] = round(chg, 2)
            row["abs_change"] = round(row["close_end"] - row["baseline_close"], 4)
        else:
            row["pct_change"] = None
            row["abs_change"] = None
        notes: list[str] = []
        if end_pick and end_pick[2]:
            notes.append(end_pick[2])
        if not b:
            notes.append("no_baseline")
        elif not end_pick:
            notes.append("no_end_window")
        row["note"] = ";".join(notes)
        return row

    with ThreadPoolExecutor(max_workers=12) as ex:
        futs = {ex.submit(job, s, sec): (s, sec) for s, sec in TICKERS}
        for fut in as_completed(futs):
            results.append(fut.result())

    results.sort(key=lambda r: (-(r["pct_change"] or -9999), r["symbol"]))

    out_csv = Path(__file__).resolve().parent / "ai_infra_50_jan4_to_apr17_2026.csv"
    with out_csv.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(
            f,
            fieldnames=[
                "symbol",
                "sector",
                "baseline_date",
                "baseline_close",
                "end_trade_date",
                "close_end",
                "abs_change",
                "pct_change",
                "note",
            ],
        )
        w.writeheader()
        for r in sorted(results, key=lambda x: x["symbol"]):
            w.writerow(r)

    print(f"Wrote {out_csv}")
    print()
    print(
        f"Baseline rule: last trading day on or before {ANCHOR} (article date; "
        f"Jan 4, 2026 was Sunday → typically {date(2026,1,2)})."
    )
    print(f"End close: {END_COMPARE} (if missing in feed, last session on or before)")
    print()
    for r in sorted(results, key=lambda x: -(x["pct_change"] or -1e9)):
        pct = r["pct_change"]
        pct_s = f"{pct:+.2f}%" if pct is not None else "N/A"
        bc = r["baseline_close"]
        ec = r["close_end"]
        bd = r["baseline_date"]
        ed = r["end_trade_date"]
        print(
            f"{r['symbol']:5} {r['sector']:22} {bd:12} {bc!s:>12} → {ed} {ec!s:>12}  {pct_s:>10}  {r['note']}"
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
