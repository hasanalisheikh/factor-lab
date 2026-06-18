from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from .ml_types import ML_RANDOM_SEED


def _compute_metrics(returns: pd.Series, turnover: float) -> dict[str, float]:
    """Compute annualised performance metrics from a daily returns series."""
    clean = returns.replace([np.inf, -np.inf], np.nan).dropna()
    if clean.empty:
        raise ValueError("No returns available for ML metrics")

    mean_period = float(clean.mean())
    vol_period = float(clean.std(ddof=0))
    ann_factor = np.sqrt(252.0)  # daily annualisation
    volatility = vol_period * ann_factor
    sharpe = (mean_period / vol_period) * ann_factor if vol_period > 0 else 0.0

    equity = (1.0 + clean).cumprod()
    peak = equity.cummax()
    drawdown = equity / peak - 1.0
    max_drawdown = float(drawdown.min())

    n = len(clean)
    cagr = float(equity.iloc[-1] ** (252.0 / n) - 1.0) if n > 0 else 0.0
    calmar = cagr / abs(max_drawdown) if max_drawdown < 0 else 0.0
    win_rate = float((clean > 0).mean())

    gains = float(clean[clean > 0].sum())
    losses = float(abs(clean[clean < 0].sum()))
    profit_factor = gains / losses if losses > 0 else 0.0

    return {
        "cagr": cagr,
        "sharpe": sharpe,
        "max_drawdown": max_drawdown,
        "turnover": float(turnover),
        "volatility": volatility,
        "win_rate": win_rate,
        "profit_factor": profit_factor,
        "calmar": calmar,
    }


def _build_model(strategy: str):
    if strategy == "ml_ridge":
        return make_pipeline(StandardScaler(), Ridge(alpha=1.0, random_state=ML_RANDOM_SEED))

    if strategy == "ml_lightgbm":
        try:
            from lightgbm import LGBMRegressor  # noqa: PLC0415
        except (ImportError, OSError) as exc:
            raise RuntimeError(
                "ml_lightgbm requires LightGBM and its native OpenMP library to be "
                "installed. No silent fallback will occur. "
                "Install with: pip install 'lightgbm>=4.5.0' and on macOS run: "
                "brew install libomp. "
                f"Original error: {exc}"
            ) from exc
        # Fewer estimators for daily refits (refit ~252x/year vs ~12x monthly)
        return LGBMRegressor(
            n_estimators=200,
            learning_rate=0.05,
            num_leaves=31,
            min_child_samples=10,
            verbose=-1,
            **_lightgbm_deterministic_params(),
        )

    raise ValueError(f"Unsupported ML strategy: {strategy}")


def _model_impl_for_strategy(strategy: str) -> str:
    if strategy == "ml_ridge":
        return "ridge"
    if strategy == "ml_lightgbm":
        return "lightgbm"
    raise ValueError(f"Unsupported ML strategy: {strategy}")


def _feature_importance(model: Any, feature_names: list[str]) -> dict[str, float]:
    estimator = model
    if hasattr(model, "named_steps"):
        estimator = model.named_steps.get("ridge", model)

    values: np.ndarray | None = None
    if hasattr(estimator, "coef_"):
        coef = np.asarray(estimator.coef_, dtype=float)
        values = np.abs(coef)
    elif hasattr(estimator, "feature_importances_"):
        values = np.asarray(estimator.feature_importances_, dtype=float)

    if values is None or values.size != len(feature_names):
        return {name: 0.0 for name in feature_names}

    denom = float(values.sum())
    if denom <= 0:
        return {name: 0.0 for name in feature_names}
    return {name: float(values[i] / denom) for i, name in enumerate(feature_names)}


def _lightgbm_version() -> str | None:
    try:
        import lightgbm
    except (ImportError, OSError):
        return None
    return str(getattr(lightgbm, "__version__", "unknown"))


def _lightgbm_deterministic_params() -> dict[str, Any]:
    return {
        "subsample": 1.0,
        "subsample_freq": 0,
        "colsample_bytree": 1.0,
        "n_jobs": 1,
        "random_state": ML_RANDOM_SEED,
        "deterministic": True,
        "force_row_wise": True,
        "data_random_seed": ML_RANDOM_SEED,
        "feature_fraction_seed": ML_RANDOM_SEED,
        "bagging_seed": ML_RANDOM_SEED,
        "extra_seed": ML_RANDOM_SEED,
        "drop_seed": ML_RANDOM_SEED,
        "objective_seed": ML_RANDOM_SEED,
    }
