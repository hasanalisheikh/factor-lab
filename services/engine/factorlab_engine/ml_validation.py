from __future__ import annotations

import numpy as np
import pandas as pd

from .ml_features import _sort_ml_rows
from .ml_types import FEATURE_COLUMNS, MLTrainingWindowStats


def prepare_model_rows(
    *,
    feature_frame: pd.DataFrame,
    prices: pd.DataFrame,
    start_date: str,
    end_date: str,
) -> tuple[pd.DataFrame, pd.DataFrame, list[str]]:
    feature_frame["date"] = pd.to_datetime(feature_frame["date"], utc=False)
    trading_dates = pd.Index(pd.to_datetime(prices.sort_index().index, utc=False))
    next_trading_dates = pd.Series(
        trading_dates[1:].to_numpy(),
        index=trading_dates[:-1],
    )
    feature_frame["target_date"] = feature_frame["date"].map(next_trading_dates)

    features_clean = feature_frame.replace([np.inf, -np.inf], np.nan)
    model_rows = features_clean.dropna(
        subset=FEATURE_COLUMNS + ["target_return", "target_date"]
    ).copy()
    model_rows = _sort_ml_rows(model_rows)

    start_ts = pd.to_datetime(start_date)
    end_ts = pd.to_datetime(end_date)

    in_window_rows = model_rows[
        (model_rows["target_date"] >= start_ts) & (model_rows["target_date"] <= end_ts)
    ].copy()
    in_window_rows = _sort_ml_rows(in_window_rows)
    if in_window_rows.empty:
        raise RuntimeError(
            f"No ML rows in backtest window {start_date}..{end_date} after feature dropna. "
            "Check that price data covers the requested backtest window."
        )

    all_tickers = sorted(in_window_rows["ticker"].unique().tolist())
    if not all_tickers:
        raise RuntimeError("No non-benchmark tickers available for ML portfolio")

    return model_rows, in_window_rows, all_tickers


def validate_initial_training_window(
    *,
    model_rows: pd.DataFrame,
    in_window_rows: pd.DataFrame,
    all_tickers: list[str],
    train_window_cal_days: int,
    min_train_days: int,
    top_n_cfg: int,
) -> MLTrainingWindowStats:
    first_rebalance_date = pd.Timestamp(in_window_rows["date"].min())
    initial_window_start = first_rebalance_date - pd.Timedelta(days=train_window_cal_days)
    pre_window = model_rows[
        (model_rows["date"] >= initial_window_start)
        & (model_rows["date"] < first_rebalance_date)
        & (model_rows["ticker"].isin(all_tickers))
    ]
    n_train_rows = len(pre_window)
    n_train_days = pre_window["date"].nunique()
    avg_symbols = n_train_rows / max(n_train_days, 1)
    min_avg_syms = max(top_n_cfg, 2)
    required_rows = min_train_days * top_n_cfg

    fail_reasons: list[str] = []
    if n_train_days < min_train_days:
        fail_reasons.append(f"train_days={n_train_days} < required {min_train_days}")
    if n_train_rows < required_rows:
        fail_reasons.append(f"train_rows={n_train_rows} < required {required_rows}")
    if avg_symbols < min_avg_syms:
        fail_reasons.append(f"avg_symbols/day={avg_symbols:.1f} < required {min_avg_syms}")

    if fail_reasons:
        raise RuntimeError(
            f"Insufficient ML training data: "
            f"train_rows={n_train_rows}, train_days={n_train_days}, "
            f"avg_symbols/day={avg_symbols:.1f}, "
            f"required: train_days>={min_train_days}, "
            f"avg_symbols/day>={min_avg_syms}, "
            f"train_rows>={required_rows}. "
            f"Failures: {'; '.join(fail_reasons)}. "
            "Choose an earlier start date or ingest a broader universe."
        )

    return MLTrainingWindowStats(
        n_train_rows=n_train_rows,
        n_train_days=int(n_train_days),
        avg_symbols=avg_symbols,
        min_avg_symbols=min_avg_syms,
        required_rows=required_rows,
    )
