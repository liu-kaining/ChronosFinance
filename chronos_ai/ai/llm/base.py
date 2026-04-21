"""Abstract LLM provider interface."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, AsyncIterator


@dataclass
class ToolDefinition:
    """A tool that the LLM can call."""

    name: str
    description: str
    input_schema: dict[str, Any]


@dataclass
class ToolCall:
    """A tool call from the LLM."""

    id: str
    name: str
    input: dict[str, Any]


@dataclass
class Message:
    """A message in the conversation."""

    role: str  # "user" | "assistant" | "tool"
    content: str | list[dict[str, Any]]
    tool_calls: list[ToolCall] | None = None
    tool_call_id: str | None = None  # For tool result messages


@dataclass
class StreamChunk:
    """A chunk from the streaming response."""

    type: str  # "text_delta" | "tool_use_start" | "tool_use_input_delta" | "message_end"
    text: str | None = None
    tool_id: str | None = None
    tool_name: str | None = None
    tool_input_delta: str | None = None


class LLMProvider(ABC):
    """Abstract base class for LLM providers."""

    @abstractmethod
    async def stream(
        self,
        messages: list[Message],
        tools: list[ToolDefinition] | None = None,
        system_prompt: str | None = None,
    ) -> AsyncIterator[StreamChunk]:
        """Stream a response from the LLM.

        Args:
            messages: Conversation history
            tools: Available tools (optional)
            system_prompt: System prompt (optional)

        Yields:
            StreamChunk objects representing the streaming response.
        """
        ...

    @abstractmethod
    def get_model_name(self) -> str:
        """Return the model name being used."""
        ...
