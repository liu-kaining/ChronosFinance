"""SSE (Server-Sent Events) utilities for streaming responses."""

from __future__ import annotations

import json
from typing import Any, AsyncIterator


def sse_event(event: str, data: Any) -> str:
    """Format a single SSE event.

    Args:
        event: Event type (e.g., 'text_delta', 'tool_use_start', 'message_end')
        data: Event payload (will be JSON-serialized)

    Returns:
        Formatted SSE string with event and data lines.
    """
    data_str = json.dumps(data, ensure_ascii=False) if not isinstance(data, str) else data
    return f"event: {event}\ndata: {data_str}\n\n"


async def sse_stream(chunks: AsyncIterator[tuple[str, Any]]) -> AsyncIterator[str]:
    """Convert an async iterator of (event, data) tuples to SSE strings."""
    async for event, data in chunks:
        yield sse_event(event, data)


def error_event(message: str, code: str = "error") -> str:
    """Format an error SSE event."""
    return sse_event("error", {"code": code, "message": message})


def message_start_event(message_id: str, role: str = "assistant") -> str:
    return sse_event("message_start", {"id": message_id, "role": role})


def text_delta_event(text: str) -> str:
    return sse_event("text_delta", {"text": text})


def tool_use_start_event(tool_id: str, tool_name: str) -> str:
    return sse_event("tool_use_start", {"id": tool_id, "name": tool_name})


def tool_use_input_delta_event(tool_id: str, delta: str) -> str:
    return sse_event("tool_use_input_delta", {"id": tool_id, "delta": delta})


def tool_result_event(tool_id: str, result: Any) -> str:
    return sse_event("tool_result", {"id": tool_id, "result": result})


def message_end_event() -> str:
    return sse_event("message_end", {"status": "done"})
