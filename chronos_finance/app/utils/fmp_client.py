"""Async FMP API client with strict rate-limiting and exponential backoff."""

from __future__ import annotations

import asyncio
import logging
import time
from collections import deque
from typing import Any

import httpx
from tenacity import (
    retry,
    retry_if_exception,
    stop_after_attempt,
    wait_exponential,
)

from app.core.config import get_settings

logger = logging.getLogger(__name__)


class FMPResponseError(Exception):
    """
    FMP returned HTTP 200 but a logical-error payload
    (e.g. quota exhausted, invalid API key, invalid endpoint).
    """


class RateLimiter:
    """Sliding-window rate limiter (async-safe via asyncio.Lock)."""

    def __init__(self, max_calls: int, period: float):
        self._max_calls = max_calls
        self._period = period
        self._timestamps: deque[float] = deque()
        self._lock = asyncio.Lock()

    async def acquire(self) -> None:
        while True:
            sleep_for = 0.0
            async with self._lock:
                now = time.monotonic()
                while self._timestamps and self._timestamps[0] <= now - self._period:
                    self._timestamps.popleft()

                if len(self._timestamps) < self._max_calls:
                    self._timestamps.append(time.monotonic())
                    return
                # Need to wait — compute delay, then release lock before sleeping
                # so other coroutines aren't blocked unnecessarily.
                sleep_for = self._period - (now - self._timestamps[0]) + 0.05

            if sleep_for > 0:
                logger.debug("Rate limit reached, sleeping %.2fs", sleep_for)
                await asyncio.sleep(sleep_for)


_SOFT_ERROR_KEYS = ("Error Message", "error", "errorMessage")


def _is_logical_error_payload(data: Any) -> bool:
    """
    FMP signals quota / auth / path errors with HTTP 200 and a dict body
    like {"Error Message": "Limit Reach ..."}. Detect and surface as
    an exception so tenacity can retry.
    """
    if not isinstance(data, dict):
        return False
    for k in _SOFT_ERROR_KEYS:
        if data.get(k):
            return True
    status = data.get("status")
    if isinstance(status, str) and status.lower() == "error":
        return True
    return False


class FMPClient:
    """Thin wrapper around httpx.AsyncClient bound to the FMP v3 API."""

    def __init__(self) -> None:
        self._settings = get_settings()
        self._limiter = RateLimiter(
            max_calls=self._settings.FMP_RATE_LIMIT,
            period=self._settings.FMP_RATE_PERIOD,
        )
        self._client: httpx.AsyncClient | None = None
        self._client_lock = asyncio.Lock()

    async def _ensure_client(self) -> httpx.AsyncClient:
        if self._client is not None and not self._client.is_closed:
            return self._client
        async with self._client_lock:
            # Double-check after acquiring the lock.
            if self._client is not None and not self._client.is_closed:
                return self._client
            self._client = httpx.AsyncClient(
                base_url=self._settings.FMP_BASE_URL,
                timeout=httpx.Timeout(
                    connect=10.0,
                    read=30.0,
                    write=15.0,
                    pool=15.0,
                ),
                limits=httpx.Limits(
                    max_connections=20,
                    max_keepalive_connections=10,
                    keepalive_expiry=30.0,
                ),
                http2=False,
            )
        return self._client

    @retry(
        # Retry only transient failures:
        # - transport/network errors
        # - HTTP 5xx
        # Do NOT retry 4xx (esp. 404 endpoint mismatch), otherwise each bad
        # endpoint burns 5 retries and stalls queue throughput.
        retry=retry_if_exception(
            lambda exc: (
                isinstance(exc, httpx.TransportError)
                or (
                    isinstance(exc, httpx.HTTPStatusError)
                    and exc.response is not None
                    and exc.response.status_code >= 500
                )
            )
        ),
        wait=wait_exponential(multiplier=1, min=1, max=30),
        stop=stop_after_attempt(5),
        reraise=True,
    )
    async def get(
        self,
        endpoint: str,
        params: dict[str, Any] | None = None,
        timeout_read: float | None = None,
    ) -> Any:
        """
        Issue a GET request to FMP.

        - Honours the rate limiter.
        - Retries transient failures (transport errors, 5xx) with exponential backoff.
        - Does NOT retry FMP "soft errors" (HTTP 200 + error dict) — they are
          permanent-until-state-changes and callers expect them to surface fast.
        - `timeout_read`: override the per-request read timeout (seconds). Useful
          for endpoints that ship very large payloads (e.g. /financial-reports-json
          ~30MB 10-K blobs). Connect/write/pool timeouts stay at client defaults.
        """
        await self._limiter.acquire()

        client = await self._ensure_client()
        request_params = {"apikey": self._settings.FMP_API_KEY}
        if params:
            request_params.update(params)

        logger.info(
            "FMP GET %s params=%s",
            endpoint,
            {k: v for k, v in request_params.items() if k != "apikey"},
        )

        request_kwargs: dict[str, Any] = {"params": request_params}
        if timeout_read is not None:
            request_kwargs["timeout"] = httpx.Timeout(
                connect=10.0,
                read=timeout_read,
                write=15.0,
                pool=15.0,
            )

        resp = await client.get(endpoint, **request_kwargs)
        resp.raise_for_status()

        # Stable sometimes answers "no data available" with HTTP 200 + empty
        # body (e.g. /economic-indicators for a series it doesn't track, or
        # /financial-reports-json for a fiscal year not yet filed).
        # Treat that as an empty list so the callers' `if not payload: continue`
        # branches kick in instead of crashing `resp.json()` — which would
        # otherwise trip tenacity into a retry storm on the exact same URL.
        body = resp.content
        if not body or not body.strip():
            logger.debug("FMP %s returned empty body — coercing to []", endpoint)
            return []

        try:
            data = resp.json()
        except ValueError as exc:
            # Unparseable body (HTML error page, truncated JSON, etc.)
            # — raise as a soft error so `_sync_per_symbol` marks it failed
            # without flipping the flag. Tenacity will NOT retry this because
            # FMPResponseError is excluded from the retry set above.
            raise FMPResponseError(
                f"FMP returned non-JSON body on {endpoint}: {body[:200]!r}"
            ) from exc

        if _is_logical_error_payload(data):
            raise FMPResponseError(
                f"FMP logical error on {endpoint}: {data}"
            )
        return data

    async def close(self) -> None:
        if self._client and not self._client.is_closed:
            await self._client.aclose()


fmp_client = FMPClient()
