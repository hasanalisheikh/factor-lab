from __future__ import annotations

from dataclasses import dataclass
from typing import Any

# ---------------------------------------------------------------------------
# Feature columns - daily, leakage-safe
# ---------------------------------------------------------------------------
FEATURE_COLUMNS = [
    "mom_5d",
    "mom_20d",
    "mom_60d",
    "mom_252d",
    "vol_20d",
    "vol_60d",
    "drawdown_252d",
    "beta_60d",
]
ML_RANDOM_SEED = 0
LIGHTGBM_DETERMINISM_MODE = "strict_same_deployment_v1"


@dataclass(frozen=True)
class MLArtifacts:
    equity_rows: list[dict[str, Any]]
    metrics: dict[str, float]
    feature_rows: list[dict[str, Any]]
    prediction_rows: list[dict[str, Any]]
    metadata: dict[str, Any]
    position_rows: list[dict[str, Any]]


@dataclass(frozen=True)
class MLTrainingWindowStats:
    n_train_rows: int
    n_train_days: int
    avg_symbols: float
    min_avg_symbols: int
    required_rows: int
