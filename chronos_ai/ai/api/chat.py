"""Chat API endpoint with SSE streaming."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ai.agents import get_agent
from ai.llm.base import Message

router = APIRouter(prefix="/api/ai", tags=["ai"])


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    context: dict[str, Any] | None = None  # Optional context (e.g., current symbol)


@router.post("/chat", summary="Stream a chat response with tool use")
async def chat_endpoint(req: ChatRequest) -> StreamingResponse:
    """Stream an AI chat response using SSE.

    The AI can use tools to fetch financial data. Events:
    - message_start: {id, role}
    - text_delta: {text}
    - tool_use_start: {id, name}
    - tool_use_input_delta: {id, delta}
    - tool_result: {id, result}
    - message_end: {status}
    - error: {code, message}
    """
    if not req.messages:
        raise HTTPException(status_code=400, detail="messages is required")

    # Convert to internal Message format
    messages = [Message(role=m.role, content=m.content) for m in req.messages]

    # Add context if provided
    if req.context:
        context_str = f"\n\nContext: {req.context}"
        messages[-1] = Message(
            role=messages[-1].role,
            content=messages[-1].content + context_str if isinstance(messages[-1].content, str) else messages[-1].content,
        )

    agent = get_agent()

    async def generate():
        async for event in agent.run(messages):
            yield event

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/models", summary="List available LLM models")
async def list_models() -> dict[str, Any]:
    """Return information about the configured LLM."""
    from ai.llm import get_llm_provider

    provider = get_llm_provider()
    return {
        "provider": settings.LLM_PROVIDER,
        "model": provider.get_model_name(),
    }


from ai.core.config import settings  # Import at end to avoid circular import
