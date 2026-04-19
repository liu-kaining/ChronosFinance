"""
Sync control plane (see spec/DATA_REARCHITECTURE_PLAN_CN.md).

This package provides the orchestrator, dataset registry, and helpers that
drive the new incremental ingestion pipeline. The old
``app.services.integrated_sync`` / ``app.services.static_data_sync`` remain
in place during the migration and will be retired in Phase M6.
"""

from app.services.sync.orchestrator import (
    DatasetContext,
    DatasetResult,
    run_dataset,
)
from app.services.sync.registry import (
    DATASET_REGISTRY,
    get_dataset_spec,
    seed_registry,
)

__all__ = [
    "DatasetContext",
    "DatasetResult",
    "run_dataset",
    "DATASET_REGISTRY",
    "get_dataset_spec",
    "seed_registry",
]
