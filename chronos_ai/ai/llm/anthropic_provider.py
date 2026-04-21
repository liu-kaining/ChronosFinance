"""Anthropic Claude provider implementation."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import anthropic

from .base import LLMProvider, Message, StreamChunk, ToolDefinition

from ai.core.config import settings


class AnthropicProvider(LLMProvider):
    """Anthropic Claude API provider."""

    def __init__(self) -> None:
        self.client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        self.model = settings.ANTHROPIC_MODEL

    def get_model_name(self) -> str:
        return f"anthropic:{self.model}"

    def _convert_tools(self, tools: list[ToolDefinition]) -> list[dict[str, Any]]:
        return [
            {
                "name": t.name,
                "description": t.description,
                "input_schema": t.input_schema,
            }
            for t in tools
        ]

    def _convert_messages(self, messages: list[Message]) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = []
        for m in messages:
            if m.role == "tool":
                # Tool result message
                result.append(
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "tool_result",
                                "tool_use_id": m.tool_call_id,
                                "content": m.content if isinstance(m.content, str) else str(m.content),
                            }
                        ],
                    }
                )
            elif m.role == "assistant" and m.tool_calls:
                # Assistant message with tool calls
                content: list[dict[str, Any]] = []
                if isinstance(m.content, str) and m.content:
                    content.append({"type": "text", "text": m.content})
                for tc in m.tool_calls:
                    content.append(
                        {
                            "type": "tool_use",
                            "id": tc.id,
                            "name": tc.name,
                            "input": tc.input,
                        }
                    )
                result.append({"role": "assistant", "content": content})
            else:
                # Regular text message
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

        kwargs: dict[str, Any] = {
            "model": self.model,
            "messages": api_messages,
            "max_tokens": 4096,
        }
        if system_prompt:
            kwargs["system"] = system_prompt
        if tools:
            kwargs["tools"] = self._convert_tools(tools)

        async with self.client.messages.stream(**kwargs) as stream:
            async for event in stream:
                if event.type == "content_block_delta":
                    delta = event.delta
                    if hasattr(delta, "type"):
                        if delta.type == "text_delta":
                            yield StreamChunk(type="text_delta", text=delta.text)
                        elif delta.type == "input_json_delta":
                            yield StreamChunk(
                                type="tool_use_input_delta",
                                tool_id=event.index,  # type: ignore
                                tool_input_delta=delta.partial_json,
                            )
                elif event.type == "content_block_start":
                    block = event.content_block
                    if hasattr(block, "type") and block.type == "tool_use":
                        yield StreamChunk(
                            type="tool_use_start",
                            tool_id=block.id,  # type: ignore
                            tool_name=block.name,  # type: ignore
                        )

        yield StreamChunk(type="message_end")
