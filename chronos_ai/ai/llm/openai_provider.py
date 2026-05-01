"""OpenAI-compatible provider implementation.

Works with OpenAI, DeepSeek, Kimi, and any OpenAI-compatible API.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any
import json

from openai import AsyncOpenAI

from .base import LLMProvider, Message, StreamChunk, ToolDefinition

from ai.core.config import settings


class OpenAIProvider(LLMProvider):
    """OpenAI-compatible API provider."""

    def __init__(self) -> None:
        self.client = AsyncOpenAI(
            api_key=settings.OPENAI_API_KEY,
            base_url=settings.OPENAI_BASE_URL,
        )
        self.model = settings.OPENAI_MODEL

    def get_model_name(self) -> str:
        return f"openai:{self.model}"

    def _convert_tools(self, tools: list[ToolDefinition]) -> list[dict[str, Any]]:
        return [
            {
                "type": "function",
                "function": {
                    "name": t.name,
                    "description": t.description,
                    "parameters": t.input_schema,
                },
            }
            for t in tools
        ]

    def _convert_messages(self, messages: list[Message]) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = []
        for m in messages:
            if m.role == "tool":
                result.append(
                    {
                        "role": "tool",
                        "tool_call_id": m.tool_call_id,
                        "content": m.content if isinstance(m.content, str) else json.dumps(m.content),
                    }
                )
            elif m.role == "assistant" and m.tool_calls:
                result.append(
                    {
                        "role": "assistant",
                        "content": m.content if isinstance(m.content, str) else None,
                        "tool_calls": [
                            {
                                "id": tc.id,
                                "type": "function",
                                "function": {
                                    "name": tc.name,
                                    "arguments": json.dumps(tc.input),
                                },
                            }
                            for tc in m.tool_calls
                        ],
                    }
                )
            else:
                content = m.content if isinstance(m.content, str) else str(m.content)
                result.append({"role": m.role, "content": content})
        return result

    async def stream(
        self,
        messages: list[Message],
        tools: list[ToolDefinition] | None = None,
        system_prompt: str | None = None,
    ) -> AsyncIterator[StreamChunk]:
        api_messages = self._convert_messages(messages)

        # Prepend system prompt if provided
        if system_prompt:
            api_messages.insert(0, {"role": "system", "content": system_prompt})

        kwargs: dict[str, Any] = {
            "model": self.model,
            "messages": api_messages,
            "stream": True,
            "max_tokens": 4096,
        }
        if tools:
            kwargs["tools"] = self._convert_tools(tools)

        stream = await self.client.chat.completions.create(**kwargs)

        # Track tool calls being built
        tool_calls: dict[int, dict[str, Any]] = {}

        async for chunk in stream:
            delta = chunk.choices[0].delta if chunk.choices else None
            if not delta:
                continue

            # Text content
            if delta.content:
                yield StreamChunk(type="text_delta", text=delta.content)

            # Tool calls
            if delta.tool_calls:
                for tc in delta.tool_calls:
                    idx = tc.index
                    if idx not in tool_calls:
                        tool_calls[idx] = {"id": tc.id, "name": "", "arguments": ""}
                        yield StreamChunk(
                            type="tool_use_start",
                            tool_id=tc.id or f"tc_{idx}",
                            tool_name=tc.function.name if tc.function else "",
                        )

                    if tc.function:
                        if tc.function.name:
                            tool_calls[idx]["name"] = tc.function.name
                        if tc.function.arguments:
                            tool_calls[idx]["arguments"] += tc.function.arguments
                            yield StreamChunk(
                                type="tool_use_input_delta",
                                tool_id=tc.id or f"tc_{idx}",
                                tool_input_delta=tc.function.arguments,
                            )

        yield StreamChunk(type="message_end")
