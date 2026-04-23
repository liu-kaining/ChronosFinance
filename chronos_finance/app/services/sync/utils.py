"""Small shared helpers for the sync orchestrator."""

from __future__ import annotations

import hashlib
import json
from datetime import date, datetime
from typing import Any


def content_hash(payload: Any) -> str:
    """
    Deterministic SHA-1 hash of a JSON-serialisable payload.

    Used to short-circuit DB writes when the upstream response has not
    materially changed since the last successful sync. The hash is stable
    across runs because keys are sorted and whitespace is normalised.
    """
    blob = json.dumps(
        payload,
        sort_keys=True,
        ensure_ascii=False,
        default=_json_default,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()


def _json_default(obj: Any) -> Any:
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    if isinstance(obj, bytes):
        return obj.decode("utf-8", errors="replace")
    raise TypeError(f"Unsupported type for content_hash: {type(obj)!r}")


def estimate_bytes(payload: Any) -> int:
    """
    Rough byte count for bandwidth accounting. We use the UTF-8 length of the
    canonical JSON dump; FMP responses are JSON so this is close to what we
    actually pulled over the wire.
    """
    try:
        return len(
            json.dumps(
                payload,
                ensure_ascii=False,
                default=_json_default,
                separators=(",", ":"),
            ).encode("utf-8")
        )
    except (TypeError, ValueError):
        return 0
