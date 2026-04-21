"""Chat agent for general conversations."""

from __future__ import annotations

from ai.llm.base import Message
from .base import Agent, get_agent


async def chat(messages: list[dict]) -> None:
    """Run the chat agent - deprecated, use get_agent().run() directly."""
    agent = get_agent()
    async for _ in agent.run([Message(role=m["role"], content=m["content"]) for m in messages]):
        pass


__all__ = ["Agent", "get_agent", "chat"]
