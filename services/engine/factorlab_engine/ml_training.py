from __future__ import annotations

import math
import os
from typing import Any, Callable

import numpy as np
import pandas as pd

from .ml_features import _feature_matrix, _sort_ml_rows, compute_daily_features
from .ml_training_models import (
    _build_model,
    _compute_metrics,
    _feature_importance,
    _lightgbm_deterministic_params,
    _lightgbm_version,
    _model_impl_for_strategy,
)
from .ml_types import (
    FEATURE_COLUMNS,
    LIGHTGBM_DETERMINISM_MODE,
    ML_RANDOM_SEED,
    MLArtifacts,
)
from .ml_validation import prepare_model_rows, validate_initial_training_window
from .turnover import annualize_turnover_from_position_rows, one_way_turnover


def run_walk_forward(
    *,
    run_id: str,
    strategy: str,
    prices: pd.DataFrame,
    start_date: str,
    end_date: str,
    benchmark_ticker: str,
    top_n: int | None = None,
    cost_bps: float | None = None,
    initial_capital: float = 100_000.0,
    progress_cb: Callable[[int, int], None] | None = None,
) -> MLArtifacts:
    """Daily walk-forward ML backtest.

    Training: rolling window of train_window_days trading days (configurable via
    ML_TRAIN_WINDOW_DAYS, default 504 ~= 2 years).

    Model refit: every ML_REFIT_FREQ_DAYS trading days (default 5 = weekly).
    Predictions and portfolio selection are still performed DAILY.

    Horizon: 1 trading day (target = next-day return).
    """
    model_impl = _model_impl_for_strategy(strategy)

    min_train_days = int(os.getenv("ML_MIN_TRAIN_DAYS", "252"))
    train_window_days = int(os.getenv("ML_TRAIN_WINDOW_DAYS", "504"))
    model_refit_freq = int(os.getenv("ML_REFIT_FREQ_DAYS", "5"))
    top_n_cfg = int(top_n if top_n is not None else int(os.getenv("ML_TOP_N", "5")))
    cost_bps_cfg = float(
        cost_bps if cost_bps is not None else float(os.getenv("ML_COST_BPS", "10"))
    )
    cost_rate = cost_bps_cfg / 10_000.0

    # Calendar-day equivalent for the rolling training window.
    train_window_cal_days = math.ceil(train_window_days * 365 / 252)

    print(
        f"[ML] daily pipeline active; run={run_id} strategy={strategy} "
        f"features={FEATURE_COLUMNS!r}, refit_freq={model_refit_freq}d, "
        f"train_window={train_window_days}d, min_train={min_train_days}d, horizon=1d"
    )

    feature_frame = compute_daily_features(prices, benchmark_ticker=benchmark_ticker)
    if feature_frame.empty:
        raise RuntimeError(
            "compute_daily_features returned an empty DataFrame — check prices and benchmark_ticker"
        )

    model_rows, in_window_rows, all_tickers = prepare_model_rows(
        feature_frame=feature_frame,
        prices=prices,
        start_date=start_date,
        end_date=end_date,
    )
    training_stats = validate_initial_training_window(
        model_rows=model_rows,
        in_window_rows=in_window_rows,
        all_tickers=all_tickers,
        train_window_cal_days=train_window_cal_days,
        min_train_days=min_train_days,
        top_n_cfg=top_n_cfg,
    )

    top_n_eff = max(1, min(top_n_cfg, len(all_tickers)))
    rebalance_dates: list[pd.Timestamp] = sorted(in_window_rows["date"].unique())

    print(
        f"[engine][ml] run={run_id} strategy={strategy} stage=features done "
        f"model_rows={len(model_rows)} rebalance_dates={len(rebalance_dates)} "
        f"universe={len(all_tickers)} top_n={top_n_eff}"
    )

    all_predictions: list[dict[str, Any]] = []
    position_rows: list[dict[str, Any]] = []
    daily_portfolio: list[float] = []
    daily_benchmark: list[float] = []
    equity_dates: list[pd.Timestamp] = []
    prev_weights = pd.Series(0.0, index=all_tickers)
    model: Any = None
    last_refit_idx = -model_refit_freq

    print(f"[engine][ml] run={run_id} strategy={strategy} stage=train_predict start")

    for step_idx, as_of_date in enumerate(rebalance_dates):
        window_start = as_of_date - pd.Timedelta(days=train_window_cal_days)
        train_slice = model_rows[
            (model_rows["date"] >= window_start)
            & (model_rows["date"] < as_of_date)
            & (model_rows["ticker"].isin(all_tickers))
        ]
        train_slice = _sort_ml_rows(train_slice)

        if train_slice["date"].nunique() < min_train_days:
            continue

        if step_idx - last_refit_idx >= model_refit_freq:
            model = _build_model(strategy)
            model.fit(_feature_matrix(train_slice), train_slice["target_return"].to_numpy())
            last_refit_idx = step_idx
            if progress_cb is not None:
                progress_cb(step_idx + 1, len(rebalance_dates))

        test_slice = in_window_rows[
            (in_window_rows["date"] == as_of_date) & in_window_rows["ticker"].isin(all_tickers)
        ].copy()
        test_slice = _sort_ml_rows(test_slice)
        if test_slice.empty:
            continue

        preds = model.predict(_feature_matrix(test_slice))  # type: ignore[union-attr]

        if not np.isfinite(preds).all():
            raise RuntimeError(
                f"ML walk-forward produced non-finite predictions at as_of={as_of_date.strftime('%Y-%m-%d')}."
            )
        if float(np.std(preds, ddof=0)) <= 1e-12:
            raise RuntimeError(
                f"ML walk-forward produced degenerate constant predictions at as_of={as_of_date.strftime('%Y-%m-%d')}."
            )

        test_slice = test_slice.copy()
        test_slice["predicted_return"] = preds
        test_slice = test_slice.sort_values(
            ["predicted_return", "ticker"], ascending=[False, True]
        ).reset_index(drop=True)
        test_slice["rank"] = np.arange(1, len(test_slice) + 1)
        test_slice["selected"] = test_slice["rank"] <= top_n_eff
        selected_count = int(test_slice["selected"].sum())
        selected_weight = 1.0 / selected_count if selected_count > 0 else 0.0
        test_slice["weight"] = np.where(test_slice["selected"], selected_weight, 0.0)
        selected = test_slice[test_slice["selected"]]

        new_weights = pd.Series(0.0, index=all_tickers)
        for _, row in selected.iterrows():
            new_weights.at[row["ticker"]] = selected_weight
        turnover = one_way_turnover(prev_weights, new_weights)
        prev_weights = new_weights

        gross_ret = float(selected["target_return"].mean()) if len(selected) > 0 else 0.0
        net_ret = gross_ret - cost_rate * turnover
        bench_ret_v = float(test_slice["benchmark_return"].iloc[0]) if len(test_slice) > 0 else 0.0
        target_date = pd.Timestamp(test_slice["target_date"].iloc[0])

        daily_portfolio.append(net_ret)
        daily_benchmark.append(bench_ret_v)
        equity_dates.append(target_date)

        as_of_str = as_of_date.strftime("%Y-%m-%d")
        target_date_str = target_date.strftime("%Y-%m-%d")
        for _, row in test_slice.iterrows():
            all_predictions.append(
                {
                    "run_id": run_id,
                    "model_name": strategy,
                    "as_of_date": as_of_str,
                    "target_date": target_date_str,
                    "ticker": str(row["ticker"]),
                    "predicted_return": float(row["predicted_return"]),
                    "realized_return": float(row["target_return"]),
                    "rank": int(row["rank"]),
                    "selected": bool(row["selected"]),
                    "weight": float(row["weight"]),
                }
            )

        for _, row in selected.iterrows():
            position_rows.append(
                {
                    "run_id": run_id,
                    "date": target_date_str,
                    "symbol": str(row["ticker"]),
                    "weight": float(row["weight"]),
                }
            )

    if not daily_portfolio:
        raise RuntimeError(
            "ML walk-forward produced no rebalances — check warmup period vs backtest window"
        )

    if progress_cb is not None and rebalance_dates:
        progress_cb(len(rebalance_dates), len(rebalance_dates))

    all_as_of = sorted({r["as_of_date"] for r in all_predictions})
    last_20 = set(all_as_of[-20:])
    prediction_rows = [r for r in all_predictions if r["as_of_date"] in last_20]

    print(
        f"[engine][ml] run={run_id} strategy={strategy} stage=train_predict done "
        f"rebalances={len(equity_dates)} predictions_stored={len(prediction_rows)} "
        f"positions={len(position_rows)}"
    )

    portfolio_ser = pd.Series(daily_portfolio, index=equity_dates)
    benchmark_ser = pd.Series(daily_benchmark, index=equity_dates)
    portfolio_nav = initial_capital * (1.0 + portfolio_ser).cumprod()
    benchmark_nav = initial_capital * (1.0 + benchmark_ser).cumprod()

    equity_rows = [
        {
            "date": dt.strftime("%Y-%m-%d"),
            "portfolio": float(portfolio_nav.loc[dt]),
            "benchmark": float(benchmark_nav.loc[dt]),
        }
        for dt in equity_dates
    ]

    metrics = _compute_metrics(
        portfolio_ser,
        turnover=annualize_turnover_from_position_rows(position_rows, periods_per_year=252.0),
    )

    if model is None:
        raise RuntimeError("Model was never trained")

    rows_after_dropna = len(model_rows)
    lightgbm_version = _lightgbm_version() if model_impl == "lightgbm" else None
    deterministic_model_params = (
        _lightgbm_deterministic_params() if model_impl == "lightgbm" else None
    )
    metadata = {
        "run_id": run_id,
        "model_name": strategy,
        "train_start": pd.Timestamp(model_rows["date"].min()).strftime("%Y-%m-%d"),
        "train_end": pd.Timestamp(model_rows["date"].max()).strftime("%Y-%m-%d"),
        "train_rows": training_stats.n_train_rows,
        "prediction_rows": len(prediction_rows),
        "rebalance_count": len(equity_rows),
        "top_n": top_n_eff,
        "cost_bps": cost_bps_cfg,
        "feature_columns": FEATURE_COLUMNS,
        "feature_importance": _feature_importance(model, FEATURE_COLUMNS),
        "model_params": {
            "model_impl": model_impl,
            "random_seed": ML_RANDOM_SEED,
            "horizon_days": 1,
            "train_window_days": train_window_days,
            "model_refit_frequency": model_refit_freq,
            "model_version": "factorlab_ml_daily_v1",
            "feature_set": "factorlab_daily_v1",
            "determinism_mode": (LIGHTGBM_DETERMINISM_MODE if model_impl == "lightgbm" else None),
            "lightgbm_version": lightgbm_version,
            "deterministic_model_params": deterministic_model_params,
            "rows_after_dropna": rows_after_dropna,
            "train_days": training_stats.n_train_days,
            "avg_symbols_per_day": round(training_stats.avg_symbols, 2),
            "training_window": {
                "min_train_days": min_train_days,
                "train_window_days": train_window_days,
                "train_start": pd.Timestamp(model_rows["date"].min()).strftime("%Y-%m-%d"),
                "train_end": pd.Timestamp(model_rows["date"].max()).strftime("%Y-%m-%d"),
            },
            "top_n": top_n_eff,
            "cost_bps": cost_bps_cfg,
            "warnings": [],
        },
    }

    print(f"[engine][ml] run={run_id} strategy={strategy} stage=report build")

    return MLArtifacts(
        equity_rows=equity_rows,
        metrics=metrics,
        feature_rows=[],
        prediction_rows=prediction_rows,
        metadata=metadata,
        position_rows=position_rows,
    )
