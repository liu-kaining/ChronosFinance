#!/usr/bin/env python3
"""
Lightweight FMP connectivity check: one GET per endpoint Chronos uses.
Does NOT run sync jobs, does NOT touch Postgres — only verifies Stable returns
HTTP 200 and not an FMP logical-error JSON body.

Usage (from repo root, with .env loaded in shell or compose):
  cd chronos_finance
  docker-compose exec api python scripts/verify_fmp_endpoints.py

Optional:
  VERIFY_SYMBOL=MSFT docker-compose exec -e VERIFY_SYMBOL=MSFT api python scripts/verify_fmp_endpoints.py
"""
from __future__ import annotations

import json
import os
import sys

import httpx

SOFT_KEYS = ("Error Message", "error", "errorMessage")


def _is_logical_error(data: object) -> bool:
    if not isinstance(data, dict):
        return False
    for k in SOFT_KEYS:
        if data.get(k):
            return True
    st = data.get("status")
    return isinstance(st, str) and st.lower() == "error"


def _has_payload(data: object) -> bool:
    """Non-empty list or non-empty dict (excluding pure error dict)."""
    if data is None:
        return False
    if isinstance(data, list):
        return len(data) > 0
    if isinstance(data, dict):
        if _is_logical_error(data):
            return False
        return len(data) > 0
    return True


def main() -> int:
    base = os.environ.get("FMP_BASE_URL", "").rstrip("/")
    key = os.environ.get("FMP_API_KEY", "")
    sym = os.environ.get("VERIFY_SYMBOL", "AAPL")
    if not base or not key:
        print("Set FMP_BASE_URL and FMP_API_KEY (e.g. via docker-compose env)", file=sys.stderr)
        return 2

    # (label, path, params) — mirrors app/services/* sync code.
    cases: list[tuple[str, str, dict[str, object]]] = [
        ("profile", "/profile", {"symbol": sym}),
        (
            "company-screener",
            "/company-screener",
            {
                "marketCapMoreThan": 1_000_000_000,
                "limit": 5,
            },
        ),
        ("income-statement", "/income-statement", {"symbol": sym, "period": "annual", "limit": 2}),
        ("balance-sheet-statement", "/balance-sheet-statement", {"symbol": sym, "period": "annual", "limit": 2}),
        ("cash-flow-statement", "/cash-flow-statement", {"symbol": sym, "period": "annual", "limit": 2}),
        ("ratios", "/ratios", {"symbol": sym, "period": "annual", "limit": 2}),
        ("key-metrics", "/key-metrics", {"symbol": sym, "period": "annual", "limit": 2}),
        ("financial-scores", "/financial-scores", {"symbol": sym}),
        ("enterprise-values", "/enterprise-values", {"symbol": sym, "period": "annual", "limit": 2}),
        ("governance-executive-compensation", "/governance-executive-compensation", {"symbol": sym}),
        (
            "revenue-product-segmentation",
            "/revenue-product-segmentation",
            {"symbol": sym, "period": "annual", "structure": "flat"},
        ),
        (
            "revenue-geographic-segmentation",
            "/revenue-geographic-segmentation",
            {"symbol": sym, "period": "annual", "structure": "flat"},
        ),
        ("stock-peers", "/stock-peers", {"symbol": sym}),
        ("historical-price-eod-full", "/historical-price-eod/full", {"symbol": sym}),
        ("dividends", "/dividends", {"symbol": sym}),
        ("splits", "/splits", {"symbol": sym}),
        ("earnings", "/earnings", {"symbol": sym}),
        ("insider-trading-search", "/insider-trading/search", {"symbol": sym, "page": 0, "limit": 10}),
        (
            "analyst-estimates",
            "/analyst-estimates",
            {"symbol": sym, "period": "annual", "page": 0, "limit": 5},
        ),
        ("price-target-consensus", "/price-target-consensus", {"symbol": sym}),
        (
            "financial-reports-json",
            "/financial-reports-json",
            {"symbol": sym, "year": 2024, "period": "FY"},
        ),
        ("treasury-rates", "/treasury-rates", {}),
        ("economic-indicators-GDP", "/economic-indicators", {"name": "GDP"}),
    ]

    fails = 0
    warns = 0
    print(f"FMP_BASE_URL={base}\nVERIFY_SYMBOL={sym}\n")

    with httpx.Client(base_url=base, timeout=httpx.Timeout(60.0), params={"apikey": key}) as client:
        for label, path, extra in cases:
            try:
                r = client.get(path, params=extra)
                status = r.status_code
                if status != 200:
                    print(f"FAIL {label:36} HTTP {status}")
                    fails += 1
                    continue
                try:
                    data = r.json()
                except json.JSONDecodeError:
                    print(f"FAIL {label:36} non-JSON body (len={len(r.content)})")
                    fails += 1
                    continue
                if _is_logical_error(data):
                    print(f"FAIL {label:36} FMP logical error: {data!r:.200}")
                    fails += 1
                    continue
                if not _has_payload(data):
                    print(f"WARN {label:36} HTTP 200 but empty payload")
                    warns += 1
                else:
                    print(f"OK   {label:36} sample keys/types: {_sample(data)}")
            except httpx.RequestError as e:
                print(f"FAIL {label:36} transport: {e}")
                fails += 1

    print()
    if fails:
        print(f"Result: {fails} failed, {warns} empty-but-ok")
        return 1
    if warns:
        print(f"Result: all reachable; {warns} endpoint(s) returned empty (check symbol/plan).")
        return 0
    print("Result: all endpoints returned usable JSON.")
    return 0


def _sample(data: object) -> str:
    if isinstance(data, list):
        if not data:
            return "[]"
        el = data[0]
        if isinstance(el, dict):
            return f"list[{len(data)}] first keys={list(el.keys())[:8]}"
        return f"list[{len(data)}] first type={type(el).__name__}"
    if isinstance(data, dict):
        return f"dict keys={list(data.keys())[:12]}"
    return type(data).__name__


if __name__ == "__main__":
    raise SystemExit(main())
