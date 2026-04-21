from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # PostgreSQL
    POSTGRES_USER: str = "chronos"
    POSTGRES_PASSWORD: str = "changeme_strong_password"
    POSTGRES_DB: str = "chronos_finance"
    POSTGRES_HOST: str = "db"
    POSTGRES_PORT: int = 5432

    # FMP API
    FMP_API_KEY: str = ""
    FMP_BASE_URL: str = "https://financialmodelingprep.com/stable"
    FMP_RATE_LIMIT: int = 750
    FMP_RATE_PERIOD: int = 60
    FMP_BANDWIDTH_LIMIT_GB: int = 50
    FMP_BANDWIDTH_WINDOW_DAYS: int = 30
    FMP_BANDWIDTH_HEAVY_THROTTLE_RATIO: float = 0.90
    FMP_BANDWIDTH_MEDIUM_THROTTLE_RATIO: float = 0.98

    # App
    APP_ENV: str = "development"
    APP_PORT: int = 8000
    LOG_LEVEL: str = "INFO"
    DB_ECHO: bool = False

    # CORS — comma-separated origins. "*" allows any origin (dev only).
    # Example:
    #   CORS_ALLOW_ORIGINS=http://localhost:3000,http://localhost:5173,http://web
    CORS_ALLOW_ORIGINS: str = "*"

    @property
    def async_database_url(self) -> str:
        return (
            f"postgresql+asyncpg://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
