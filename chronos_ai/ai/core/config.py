"""Application configuration via environment variables."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # App
    APP_ENV: Literal["development", "production"] = "development"
    LOG_LEVEL: str = "INFO"

    # Database (read from same DB as chronos_finance)
    DATABASE_URL: str = "postgresql+asyncpg://chronos:chronos_secret@db:5432/chronos"

    # LLM Provider: "anthropic" or "openai"
    LLM_PROVIDER: Literal["anthropic", "openai"] = "anthropic"

    # Anthropic
    ANTHROPIC_API_KEY: str = ""
    ANTHROPIC_BASE_URL: str = "https://api.anthropic.com"
    ANTHROPIC_MODEL: str = "claude-sonnet-4-20250514"

    # OpenAI-compatible (works with OpenAI, DeepSeek, Kimi, etc.)
    OPENAI_API_KEY: str = ""
    OPENAI_BASE_URL: str = "https://api.openai.com/v1"
    OPENAI_MODEL: str = "gpt-4o"

    # Chronos Finance API (for tool calls)
    CHRONOS_API_BASE: str = "http://api:8000"

    @property
    def async_database_url(self) -> str:
        return self.DATABASE_URL


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
