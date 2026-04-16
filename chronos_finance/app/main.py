import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.v1_sync import router as sync_router
from app.core.config import get_settings
from app.core.database import init_db
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
    yield
    logger.info("Chronos Finance shutting down …")
    await fmp_client.close()


app = FastAPI(
    title="Chronos Finance — Data Pipeline API",
    description="Quantitative & fundamental data center backed by FMP Premium.",
    version="0.1.0",
    lifespan=lifespan,
)

app.include_router(sync_router)


@app.get("/health", tags=["ops"])
async def health_check():
    return {"status": "ok", "env": settings.APP_ENV}
