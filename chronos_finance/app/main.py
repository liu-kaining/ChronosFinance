import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

import app.models  # noqa: F401 - ensure all SQLAlchemy models are registered
from app.api.v1_freshness import coverage_router, router as freshness_router
from app.api.v1_ingest import router as ingest_router
from app.api.v1_insight import router as insight_router
from app.api.v1_library import router as library_router
from app.api.v1_sync import router as sync_router
from app.core.config import get_settings
from app.core.database import init_db
from app.services.sync.registry import seed_registry
from app.utils.fmp_client import fmp_client

settings = get_settings()

logging.basicConfig(
    level=getattr(logging, settings.LOG_LEVEL, logging.INFO),
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(application: FastAPI):
    logger.info("Chronos Finance starting up (env=%s) …", settings.APP_ENV)
    await init_db()
    try:
        await seed_registry()
    except Exception:
        # Registry seed must never block boot — an orchestrator triggered
        # later will still read its config from the in-memory registry.
        logger.exception("seed_registry failed on startup; continuing anyway")
    yield
    logger.info("Chronos Finance shutting down …")
    await fmp_client.close()


app = FastAPI(
    title="Chronos Finance — Data Pipeline API",
    description="Quantitative & fundamental data center backed by FMP Premium.",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS — allow the chronos_web frontend (and chronos_ai service) to call the API.
# Configure via CORS_ALLOW_ORIGINS env (comma-separated). "*" = allow any (dev only).
_cors_raw = (settings.CORS_ALLOW_ORIGINS or "").strip()
if _cors_raw == "*" or not _cors_raw:
    _cors_origins: list[str] = ["*"]
    _cors_allow_credentials = False
else:
    _cors_origins = [o.strip() for o in _cors_raw.split(",") if o.strip()]
    _cors_allow_credentials = True

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=_cors_allow_credentials,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

app.include_router(sync_router)
app.include_router(ingest_router)
app.include_router(insight_router)
app.include_router(library_router)
app.include_router(freshness_router)
app.include_router(coverage_router)

_STATIC_DIR = Path(__file__).resolve().parent / "static"


@app.get(
    "/ui",
    tags=["ops"],
    summary="简易只读看板（HTML）",
    response_class=FileResponse,
)
async def data_dashboard() -> FileResponse:
    """单页：总览、同步进度、universe 分页、单标 inventory。不调用 FMP。"""
    path = _STATIC_DIR / "dashboard.html"
    return FileResponse(path, media_type="text/html; charset=utf-8")


@app.get(
    "/library",
    tags=["ops"],
    summary="资料库：搜索标的 + 图表与明细",
    response_class=FileResponse,
)
async def library_page() -> FileResponse:
    """搜索、行情图、财报/事件等只读展示；数据来自 /api/v1/library 与 /api/v1/data。"""
    path = _STATIC_DIR / "library.html"
    return FileResponse(path, media_type="text/html; charset=utf-8")


@app.get("/health", tags=["ops"])
async def health_check():
    return {"status": "ok", "env": settings.APP_ENV}
