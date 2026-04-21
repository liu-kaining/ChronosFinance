"""LLM provider factory."""

from __future__ import annotations

from .base import LLMProvider
from .anthropic_provider import AnthropicProvider
from .openai_provider import OpenAIProvider

from ai.core.config import settings


def get_llm_provider() -> LLMProvider:
    """Get the configured LLM provider."""
    if settings.LLM_PROVIDER == "anthropic":
        return AnthropicProvider()
    else:
        return OpenAIProvider()


__all__ = ["get_llm_provider", "LLMProvider"]
