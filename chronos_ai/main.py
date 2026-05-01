"""Chronos AI - FastAPI application entry point."""

from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from ai.api import router as api_router
from ai.core.config import settings

# Logging setup
logging.basicConfig(
    level=getattr(logging, settings.LOG_LEVEL, logging.INFO),
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Chronos AI — Financial Assistant",
    description="LLM-powered financial analysis with tool use.",
    version="0.1.0",
)

# CORS
_cors_origins = ["*"]  # In production, restrict this
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

# Routes
app.include_router(api_router)


@app.get("/health", tags=["ops"])
async def health_check() -> dict[str, str]:
    return {"status": "ok", "env": settings.APP_ENV}


@app.on_event("startup")
async def startup() -> None:
    logger.info("Chronos AI starting up (env=%s, provider=%s)", settings.APP_ENV, settings.LLM_PROVIDER)


@app.on_event("shutdown")
async def shutdown() -> None:
    logger.info("Chronos AI shutting down")
    from ai.tools.registry import get_registry
    registry = get_registry()
    await registry.close()
