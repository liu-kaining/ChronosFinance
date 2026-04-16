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
    retry_if_exception_type,
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
        async with self._lock:
            now = time.monotonic()
            while self._timestamps and self._timestamps[0] <= now - self._period:
                self._timestamps.popleft()

            if len(self._timestamps) >= self._max_calls:
                sleep_for = self._period - (now - self._timestamps[0]) + 0.05
                if sleep_for > 0:
                    logger.debug("Rate limit reached, sleeping %.2fs", sleep_for)
                    await asyncio.sleep(sleep_for)
                now = time.monotonic()
                while self._timestamps and self._timestamps[0] <= now - self._period:
                    self._timestamps.popleft()

            self._timestamps.append(time.monotonic())


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

    async def _ensure_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=self._settings.FMP_BASE_URL,
                timeout=httpx.Timeout(
                    connect=10.0,
                    read=30.0,
                    write=15.0,
                    pool=5.0,
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
        retry=retry_if_exception_type(
            (httpx.HTTPStatusError, httpx.TransportError, FMPResponseError)
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
        - Retries transient failures (transport/5xx) with exponential backoff.
        - Retries FMP "soft errors" (HTTP 200 + error dict) too.
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
                pool=5.0,
            )

        resp = await client.get(endpoint, **request_kwargs)
        resp.raise_for_status()
        data = resp.json()

        if _is_logical_error_payload(data):
            raise FMPResponseError(
                f"FMP logical error on {endpoint}: {data}"
            )
        return data

    async def close(self) -> None:
        if self._client and not self._client.is_closed:
            await self._client.aclose()


fmp_client = FMPClient()
