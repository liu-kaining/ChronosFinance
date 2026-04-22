import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import JSONResponse
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

_STATIC_DIR = Path(__file__).resolve().parent / "static"


def _configure_cors(app: FastAPI) -> None:
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


def create_app(*, role: str) -> FastAPI:
    @asynccontextmanager
    async def lifespan(application: FastAPI):
        logger.info("Chronos Finance %s API starting up (env=%s) …", role, settings.APP_ENV)
        await init_db()
        try:
            await seed_registry()
        except Exception:
            logger.exception("seed_registry failed on startup; continuing anyway")
        yield
        logger.info("Chronos Finance %s API shutting down …", role)
        await fmp_client.close()

    app = FastAPI(
        title=f"Chronos Finance — {role} API",
        description="Quantitative & fundamental data center backed by FMP Premium.",
        version="0.1.0",
        lifespan=lifespan,
    )
    _configure_cors(app)

    if role == "write":
        app.include_router(sync_router)
        app.include_router(ingest_router)

        # Guard read-only routes on write API to make routing mistakes obvious.
        @app.api_route("/api/v1/data/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
        @app.api_route("/api/v1/library/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
        @app.api_route("/api/v1/stats/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
        @app.api_route("/ui", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
        @app.api_route("/library", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
        async def _reject_read_on_write(path: str = "") -> JSONResponse:
            return JSONResponse(
                status_code=403,
                content={
                    "detail": (
                        "This is write API (api-write). Read/query routes are blocked here. "
                        "Use api-read (API_PORT)."
                    )
                },
            )
    elif role == "read":
        app.include_router(insight_router)
        app.include_router(library_router)
        app.include_router(freshness_router)
        app.include_router(coverage_router)

        # Guard write routes on read API to enforce strict read/write isolation.
        @app.api_route("/api/v1/sync/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
        @app.api_route("/api/v1/ingest/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
        async def _reject_write_on_read(path: str = "") -> JSONResponse:
            return JSONResponse(
                status_code=403,
                content={
                    "detail": (
                        "This is read API (api-read). Write/sync routes are blocked here. "
                        "Use api-write (API_WRITE_PORT)."
                    )
                },
            )
    else:
        raise ValueError(f"unknown API role: {role}")

    @app.get("/health", tags=["ops"])
    async def health_check():
        return {"status": "ok", "env": settings.APP_ENV, "role": role}

    if role == "read":
        @app.get(
            "/ui",
            tags=["ops"],
            summary="简易只读看板（HTML）",
            response_class=FileResponse,
        )
        async def data_dashboard() -> FileResponse:
            path = _STATIC_DIR / "dashboard.html"
            return FileResponse(path, media_type="text/html; charset=utf-8")

        @app.get(
            "/library",
            tags=["ops"],
            summary="资料库：搜索标的 + 图表与明细",
            response_class=FileResponse,
        )
        async def library_page() -> FileResponse:
            path = _STATIC_DIR / "library.html"
            return FileResponse(path, media_type="text/html; charset=utf-8")

    return app
