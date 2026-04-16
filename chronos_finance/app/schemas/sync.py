from pydantic import BaseModel


class SyncTriggerResponse(BaseModel):
    status: str
    message: str


class UniverseStats(BaseModel):
    total_symbols: int
    active_symbols: int
    exchanges: dict[str, int]
