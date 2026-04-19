"""Shared helpers reused across dataset handlers."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Iterable, Iterator, Sequence


# Postgres hard-caps a single statement at 65,535 bind parameters.
# We keep chunk sizes well under that to stay safe for the widest tables
# (daily_prices ≈ 8 cols/row).
BULK_CHUNK = 5000


def parse_date(v: Any) -> date | None:
    if v is None:
        return None
    if isinstance(v, date) and not isinstance(v, datetime):
        return v
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, str):
        try:
            return datetime.strptime(v[:10], "%Y-%m-%d").date()
        except (ValueError, TypeError):
            return None
    return None


def safe_float(v: Any) -> float | None:
    try:
        if v is None or v == "":
            return None
        return float(v)
    except (TypeError, ValueError):
        return None


def safe_int(v: Any) -> int | None:
    try:
        if v is None or v == "":
            return None
        return int(float(v))
    except (TypeError, ValueError):
        return None


def clean_jsonb(obj: Any) -> Any:
    """Recursively strip NUL chars that Postgres jsonb refuses to accept."""
    if isinstance(obj, str):
        return obj.replace("\x00", "") if "\x00" in obj else obj
    if isinstance(obj, dict):
        return {k: clean_jsonb(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [clean_jsonb(v) for v in obj]
    return obj


def dedupe(rows: list[dict], keys: Sequence[str]) -> list[dict]:
    seen: dict[tuple, dict] = {}
    for r in rows:
        k = tuple(r.get(c) for c in keys)
        seen[k] = r
    return list(seen.values())


def chunks(seq: Sequence[Any], size: int = BULK_CHUNK) -> Iterator[Sequence[Any]]:
    for i in range(0, len(seq), size):
        yield seq[i : i + size]


def as_list(payload: Any) -> list[Any]:
    """Accept the usual FMP shape variations and always return a list."""
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        # v3-style wrapper that stable sometimes still returns.
        historical = payload.get("historical")
        if isinstance(historical, list):
            return historical
    return []


def ensure_iterable(value: Any) -> Iterable[Any]:
    if value is None:
        return ()
    if isinstance(value, (list, tuple, set)):
        return value
    return (value,)
